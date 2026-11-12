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
pytest pipeline/tests             # 37 tests, no network needed

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

## Verification

`pytest pipeline/tests` covers the de-accumulation maths, the 3 h → 6 h interval change,
GRIB packing tolerance, the cube/metadata contract, and timezone handling (37 tests, no
network needed). Beyond that, two checks confirm the output means what it claims:

**Independent cross-check.** Daily totals compared against Open-Meteo's ECMWF IFS feed —
same source model, entirely separate pipeline. A units error would show as a 1000×
factor, the interval bug as 2×:

| Thiruvananthapuram (8.52 N, 76.94 E) | 13 Nov | 14 Nov | 15 Nov | 16 Nov | 17 Nov | 18 Nov | Total |
|---|---|---|---|---|---|---|---|
| This pipeline (mm) | 5.4 | 2.2 | 2.0 | 1.0 | 0.2 | 4.2 | **14.9** |
| Open-Meteo ECMWF (mm) | 4.9 | 2.1 | 2.1 | 1.2 | 0.3 | 4.2 | **14.8** |

(IFS 2026-11-12 12Z run. Chennai agreed to 1.5 vs 1.2 mm; Kolkata was dry in both.)

**Seasonal plausibility.** Mid-November in India is the *northeast* monsoon, so the rain
should sit over Tamil Nadu, coastal Andhra, Kerala and Sri Lanka, with the Thar desert
and the Himalaya dry. The 10-day mean south of 15 °N came out **12× wetter** than north
of 28 °N, with Delhi, Mumbai and Jaisalmer at or near zero. A window extracted from the
wrong longitudes would fail this immediately.

### Three things that were not what the documentation implied

Each was found by checking against live data rather than trusting an assumption, and
each is now covered by a test:

1. **The GRIB is stored starting at longitude 180**, so cfgrib presents it as
   −180…179.75, and 65 °E is column 980 — not column 260 as a 0…360 layout would give.
   The wrong indexing returns the eastern Pacific with entirely plausible-looking
   values. Window indices are now derived from the decoded coordinates and asserted.
2. **Only the 00z and 12z IFS cycles reach day 15**; 06z and 18z stop at T+90h. A plain
   `latest()` happily returns a short run whose later steps then 404, so run selection
   is pinned to a run that actually carries the final step.
3. **`ecmwf-opendata` returns naive datetimes that are already UTC.** Treating one as
   local time shifted every timestamp by −5:30 on an IST machine — correct in CI, wrong
   in development. Run times are normalised at the boundary, and the encoder now refuses
   a naive datetime outright.

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
