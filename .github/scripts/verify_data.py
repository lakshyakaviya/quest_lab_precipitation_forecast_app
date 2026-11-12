"""Quality gate between the pipeline and deployment.

The pipeline already refuses to write an implausible cube; this re-checks the published
*files* so a deploy can never ship a truncated or inconsistent payload. If this fails,
the workflow stops and the previous good deployment keeps serving.

    python .github/scripts/verify_data.py web/public/data
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    sys.exit(1)


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__)
        return 2
    data_dir = Path(argv[0])

    index_path = data_dir / "index.json"
    if not index_path.exists():
        fail(f"{index_path} is missing")
    index = json.loads(index_path.read_text(encoding="utf-8"))

    if not index.get("models"):
        fail("index.json lists no models")

    for entry in index["models"]:
        meta_path = data_dir / entry["meta"]
        if not meta_path.exists():
            fail(f"{meta_path} is missing")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))

        cube_path = data_dir / meta["cube"]["file"]
        if not cube_path.exists():
            fail(f"{cube_path} is missing")

        payload = cube_path.read_bytes()
        grid = meta["grid"]
        expected = meta["cube"]["n_frames"] * grid["nlat"] * grid["nlon"] * 2
        if len(payload) != expected:
            fail(
                f"{cube_path.name} is {len(payload):,} bytes, "
                f"expected {expected:,} for {meta['cube']['n_frames']} frames"
            )
        if len(payload) != meta["cube"]["bytes"]:
            fail(
                f"{cube_path.name} is {len(payload):,} bytes, metadata claims "
                f"{meta['cube']['bytes']:,}"
            )

        digest = hashlib.sha256(payload).hexdigest()
        if digest != meta["cube"]["sha256"]:
            fail(f"{cube_path.name} checksum does not match its metadata")

        frames = meta["frames"]
        if len(frames) != meta["cube"]["n_frames"]:
            fail(
                f"{meta_path.name} lists {len(frames)} frames but declares "
                f"{meta['cube']['n_frames']}"
            )

        times = [datetime.fromisoformat(f["valid_time"]) for f in frames]
        if any(b <= a for a, b in zip(times, times[1:])):
            fail(f"{meta_path.name} valid times are not strictly increasing")

        # Each frame's valid time must equal run + step_end, or the UI will mislabel it.
        run = datetime.fromisoformat(meta["run"]["datetime"])
        if run.tzinfo is None:
            fail("run datetime has no timezone")
        for frame, valid in zip(frames, times):
            if valid != run + timedelta(hours=frame["step_end"]):
                fail(
                    f"frame {frame['i']} valid time {frame['valid_time']} does not "
                    f"match run + T+{frame['step_end']}h"
                )

        stats = meta["stats"]
        if stats["max_mm_h"] <= 0:
            fail("the forecast is entirely dry, which means the data is wrong")
        if stats["min_mm_h"] < 0:
            fail(f"negative rain rate in the cube: {stats['min_mm_h']}")

        # Staleness: the archive is rolling, so a run older than ~2 days means the
        # pipeline has been failing silently and the site would serve a stale forecast.
        age = datetime.now(timezone.utc) - run
        if age > timedelta(hours=48):
            fail(f"run {meta['run']['datetime']} is {age} old")

        print(
            f"OK  {entry['key']:5s} run {meta['run']['datetime']} "
            f"{meta['cube']['n_frames']} frames {len(payload):,} B "
            f"peak {stats['max_mm_h']:.1f} mm/h age {age}"
        )

    print("all published data verified")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
