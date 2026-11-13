"""Record the README's demo GIF by driving the built app in a headless browser.

Run whenever the UI changes enough that the GIF misrepresents it; the output is
committed as a static asset so the README works on a cold clone.

    python pipeline/tools/capture_demo.py <app_url> <output_dir>

Dependencies are ad hoc rather than part of the pipeline package, since this touches
no forecast code:

    pip install playwright pillow
    playwright install chromium

Point it at a *production* build served under the app's base path, not the dev server,
so what is recorded is what deploys:

    cd web && npm run build
    # serve web/dist/ at /quest_lab_precipitation_forecast_app/, then:
    python pipeline/tools/capture_demo.py \
        http://127.0.0.1:4173/quest_lab_precipitation_forecast_app/ docs/media

The tour is driven entirely through the UI — no injected state, no direct access to the
map object — so a run that completes is also a smoke test that the controls, the
rankings boards, the swipe and the mode switch all still work against real data. Any
console error is reported at the end rather than silently recorded into the GIF.

The forecast changes twice a day, so the recording will differ from run to run. Check
what it actually captured before committing it, and keep any figures quoted in the
README's caption in step with it.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import Page, sync_playwright

# Wide enough for the map and the side panel to both be legible when GitHub scales the
# GIF down to README width, small enough to keep the file within a few megabytes.
VIEWPORT = (1180, 740)
TARGET_W = 900

# Frame timings in milliseconds. Steps are quick; the beats that need reading get held.
STEP_MS = 130
HOLD_OPENING = 900
HOLD_BEAT = 1100
HOLD_SELECTION = 1500
HOLD_FINAL = 1800

# WebGL in software, because CI and headless desktops have no GPU.
CHROME_ARGS = [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--hide-scrollbars",
]


class Recorder:
    """Collects PNG stills and the time each should be shown for."""

    def __init__(self, page: Page, shots: Path) -> None:
        self.page = page
        self.shots = shots
        self.frames: list[tuple[Path, int]] = []

    def shot(self, hold: int = STEP_MS) -> None:
        path = self.shots / f"f{len(self.frames):03d}.png"
        self.page.screenshot(path=str(path))
        self.frames.append((path, hold))

    def step(self, key: str = "ArrowRight", times: int = 1, settle: int = 220) -> None:
        for _ in range(times):
            self.page.keyboard.press(key)
            self.page.wait_for_timeout(settle)
            self.shot()


def record(page: Page, rec: Recorder) -> None:
    """The tour. Each act answers a question a reviewer would actually ask."""

    # 1. "What does ten days of rain over India look like?"
    rec.shot(HOLD_OPENING)
    rec.step(times=15)

    # 2. "Where do the two models disagree?"
    page.click(".ranks__tabs button:text-is('Models differ')")
    page.wait_for_timeout(500)
    rec.shot(HOLD_BEAT)

    # 3. "Show me the worst case." The top row selects that point on the map.
    page.click(".ranks__row button")
    page.wait_for_timeout(1200)
    rec.shot(HOLD_SELECTION)
    rec.step(times=3)

    # 4. "Show them side by side." The divider splits the field in data space.
    page.click(".switch__group button:text-is('Compare')")
    page.wait_for_timeout(900)
    rec.shot(HOLD_BEAT)
    _drag_divider(page, rec)

    # 5. "Where exactly do they part company?"
    page.click(".switch__group button:text-is('Disagree')")
    page.wait_for_timeout(900)
    rec.shot(HOLD_BEAT + 200)
    rec.step(times=8)
    rec.shot(HOLD_FINAL)  # pause before the loop restarts


def _drag_divider(page: Page, rec: Recorder) -> None:
    """Sweep the swipe divider left and right, then leave it near the middle."""
    grip = page.locator(".swipe").bounding_box()
    area = page.locator(".map").bounding_box()
    if grip is None or area is None:
        raise RuntimeError("compare mode did not render a divider over the map")

    y = area["y"] + area["height"] * 0.5
    page.mouse.move(grip["x"] + grip["width"] / 2, y)
    page.mouse.down()
    try:
        for frac in (0.46, 0.38, 0.30, 0.24, 0.34, 0.46,
                     0.58, 0.70, 0.78, 0.72, 0.60, 0.50):
            page.mouse.move(area["x"] + area["width"] * frac, y, steps=4)
            page.wait_for_timeout(170)
            rec.shot(150)
    finally:
        page.mouse.up()
    page.wait_for_timeout(400)
    rec.shot(HOLD_OPENING)


def assemble(frames: list[tuple[Path, int]], out: Path) -> Path:
    """Quantise the stills against one shared palette and write the GIF."""
    imgs, durations = [], []
    for path, hold in frames:
        im = Image.open(path).convert("RGB")
        height = round(im.height * TARGET_W / im.width)
        imgs.append(im.resize((TARGET_W, height), Image.LANCZOS))
        durations.append(hold)

    # One palette for the whole animation, not one per frame: a per-frame palette makes
    # the dark basemap shimmer as the quantiser picks slightly different greys.
    #
    # Dithering is off deliberately. The rain field is fine-grained speckle, and error
    # diffusion perturbs almost every pixel between frames, defeating the GIF's
    # inter-frame compression — 6.2 MB dithered against 3.9 MB without, with no visible
    # difference at this size on a 128-colour ramp.
    base = imgs[0].quantize(colors=128, method=Image.MEDIANCUT)
    quant = [im.quantize(palette=base, dither=Image.NONE) for im in imgs]

    quant[0].save(
        out,
        save_all=True,
        append_images=quant[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )
    return out


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    url, out_dir = argv[1], Path(argv[2])
    shots = out_dir / "shots"
    shots.mkdir(parents=True, exist_ok=True)

    errors: list[str] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=CHROME_ARGS)
        page = browser.new_page(
            viewport={"width": VIEWPORT[0], "height": VIEWPORT[1]},
            device_scale_factor=1,
        )
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
        page.on(
            "console",
            lambda m: errors.append(f"[console] {m.text}") if m.type == "error" else None,
        )

        page.goto(url, wait_until="networkidle", timeout=90_000)
        # The cube is a megabyte of float16 that still has to be decoded and painted;
        # networkidle only says the bytes arrived.
        page.wait_for_timeout(6000)

        rec = Recorder(page, shots)
        try:
            record(page, rec)
        finally:
            browser.close()

    gif = assemble(rec.frames, out_dir / "monsoon-lens.gif")
    size_mb = gif.stat().st_size / 1_048_576
    print(f"{gif}  {size_mb:.2f} MB  {len(rec.frames)} frames  {TARGET_W}px wide")
    print(f"{len(errors)} console/page error(s)")
    for err in errors[:8]:
        print("  ", err)

    # A recording made while the app was throwing is not fit to ship.
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
