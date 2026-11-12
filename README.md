# Monsoon Lens

**Ten-day precipitation forecast for India, built from ECMWF Open Data.**

Live: **https://lakshyakaviya.github.io/quest_lab_precipitation_forecast_app/**

Built for the QUEST Lab Full Stack AI pre-doctoral application by Lakshya Kaviya,
November 2026.

---

## What it does

Fetches total precipitation from ECMWF's operational forecast twice a day, converts it
into a compact forecast cube for the India region, and serves an animated map where you
can scrub through the next ten days and click anywhere for a rainfall timeline.

- **Animated rain field** over India at 0.25° (~28 km), 64 frames from T+3h to T+240h.
- **Time scrubber** with play/pause, speed control, and keyboard control
  (`space`, `←`/`→`, `Home`/`End`).
- **Click anywhere** for that grid cell's rainfall: per-interval totals, cumulative
  build-up, peak intensity, when the rain starts, and a table view of every value.
- **No backend.** The whole forecast is ~350 KB over the wire, so every query is an
  array lookup in the browser.

## How it works

```
ECMWF Open Data  ──fetch──▶  GRIB2 (65 steps, ~33 MB)
                                 │
                             de-accumulate, convert m ▶ mm/h, subset to India
                                 │
                             cube.f16  (64 × 141 × 141 float16 = 2.54 MB)
                             meta.json (valid times, interval lengths, provenance)
                                 │
   GitHub Actions ──twice daily──▶ build the web app ──▶ GitHub Pages
```

**The data.** ECMWF's `tp` (total precipitation) is *accumulated from the start of the
forecast* and expressed in **metres**. The pipeline differences consecutive steps and
divides each difference by its own interval length — which matters because IFS changes
step spacing from 3 h to 6 h at T+144h, so a constant divisor would overstate rain rates
across the whole second half of the forecast. 65 accumulation steps therefore become
**64 interval frames**, each labelled by the valid time at the *end* of its interval.

Values are stored as a **rain rate in mm/h** rather than an interval total, so one
physical quantity spans the spacing change; the app multiplies back up by each frame's
interval length to show mm/3h or mm/6h.

**The front end.** The India window is 141 × 141 cells, small enough that the entire
forecast ships to the browser as one float16 array. The field is coloured through a
log-scaled single-hue ramp into a 141 × 141 canvas and handed to MapLibre as a raster
source. The basemap is a 137 KB Natural Earth extract bundled into the app — no tile
server, no API key, no glyph server, nothing to rate-limit.

## Running it locally

Requires Python 3.11+ and Node 20.19+.

```bash
# 1. Pipeline
python -m venv .venv
.venv/Scripts/activate            # Windows;  source .venv/bin/activate elsewhere
pip install -e "./pipeline[dev]"
pytest pipeline/tests             # 35 tests, no network needed

python -m precipitation.cli latest                        # what runs are published
python -m precipitation.cli run --model ifs --out web/public/data

# 2. Web app
cd web
npm install
npm run dev                       # http://localhost:5173
```

The pipeline caches raw GRIB under `.cache/grib/`, so re-running is free. Pass
`--no-cache` to force a fresh download, or `--date 20261112 --time 0` for a specific run.

Rebuilding the bundled basemap (rarely needed):

```bash
# Download ne_50m_admin_0_countries.geojson and
# ne_50m_admin_1_states_provinces.geojson from
# https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
pip install shapely
python pipeline/tools/build_basemap.py <download_dir> web/src/assets/basemap.json
```

## Deploying

The repository deploys itself to GitHub Pages. Once:

1. Push to GitHub as a **public** repo named `quest_lab_precipitation_forecast_app`
   (the name is the Pages base path, set as `REPO_BASE` in `web/vite.config.ts` — change
   both together if you rename the repo).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Run the **Build and deploy forecast** workflow once by hand
   (Actions → Build and deploy forecast → Run workflow).

After that it runs itself at 09:30 and 21:30 UTC, picking up the 00z and 12z runs.
Forecast data is republished with each deployment rather than committed, so the git
history never accumulates binaries.

## Repository layout

| Path | What it is |
|---|---|
| `pipeline/src/precipitation/config.py` | grid, steps, models, QC thresholds — one source of truth |
| `pipeline/src/precipitation/fetch.py` | ECMWF retrieval, run selection, GRIB cache |
| `pipeline/src/precipitation/decode.py` | GRIB2 → numpy, subset to the India window |
| `pipeline/src/precipitation/transform.py` | de-accumulation, units, quality gates |
| `pipeline/src/precipitation/encode.py` | `cube.f16` + `meta.json` contract |
| `pipeline/tools/build_basemap.py` | one-off Natural Earth → bundled basemap |
| `web/src/lib/cube.ts` | cube decode, point sampling, frame colouring |
| `web/src/map/RainLayer.ts` | the rain raster surface |
| `web/src/components/PointPanel.tsx` | point timeline and charts |
| `.github/workflows/forecast.yml` | twice-daily fetch → build → deploy |
| `.github/scripts/verify_data.py` | gate that stops a bad forecast from deploying |

## Known limitations

- **Deterministic, not probabilistic.** This is the single IFS HRES forecast, so it says
  what one model run expects, not how likely it is. Rain beyond about day 5 should be
  read as a pattern, not a schedule. Ensemble probabilities are the natural next step.
- **Grid-cell averages.** Each value is the mean over a ~28 km cell, so it will
  understate intense, small convective cells and does not resolve terrain within a cell.
  Values at a point are the cell containing it, not an interpolation.
- **float16 storage.** Rain rates are stored at ~3 significant digits. Irrelevant for
  reading a forecast, but the cube is not the right artefact for numerical verification —
  use the source GRIB for that.
- **Negative-decrement clamping.** Consecutive accumulations are independently quantised
  by GRIB packing, so ~0.4% of cells decrease slightly (worst case: one 1.22e-4 m
  quantum). Those are clamped to zero, which adds about 0.07% to total rainfall. The
  exact figures for each run are published in `meta.json` under `deaccumulation`.
- **Forecast horizon capped at day 10** even though IFS runs to day 15.
- **One model, one run.** No comparison against AIFS, observations, or the previous run.
- **Boundaries** are Natural Earth's depiction and are not an authoritative statement on
  any border.
- **Dark theme only** — deliberate: a rain field only reads against a dark surface.

## Attribution and licence

Forecast data: [ECMWF Open Data](https://www.ecmwf.int/en/forecasts/datasets/open-data),
© ECMWF, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). ECMWF does not accept any
liability for errors or omissions in the data, or for its use.

Administrative boundaries: [Natural Earth](https://www.naturalearthdata.com/), public
domain.

Code in this repository is released under the MIT licence (see `LICENSE`).
