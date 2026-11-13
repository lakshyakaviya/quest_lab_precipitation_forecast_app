# Monsoon Lens

**Ten-day precipitation forecast for India, built from ECMWF Open Data.**

Live: **https://lakshyakaviya.github.io/quest_lab_precipitation_forecast_app/**

Built for the QUEST Lab Full Stack AI pre-doctoral application by Lakshya Kaviya,
November 2026.

---

## What it does

Fetches total precipitation from ECMWF twice a day — from **both** its physics model
and its AI model — converts them into compact forecast cubes for the India region, and
serves an animated map where you can scrub through the next ten days, click anywhere
for a rainfall timeline, and put the two forecasts against each other.

- **Animated rain field** over India at 0.25° (~28 km), T+3h to T+240h.
- **Physics vs AI.** IFS HRES (physics) and AIFS Single (data-driven), always from the
  same analysis time. Four views: either model alone, a draggable swipe between them,
  and a diverging **disagreement** layer showing where and by how much they part company.
- **Time scrubber** with play/pause, speed control, and keyboard control
  (`space`, `←`/`→`, `Home`/`End`). It opens on the present moment, and the part of the
  forecast that has already elapsed is marked as past throughout the UI.
- **Click anywhere** for that cell's rainfall from both models: rate over time,
  cumulative build-up, peak intensity, when the rain starts, a plain-language verdict
  on whether the models agree, and a table view.
- **No backend.** Both forecasts together are a little over 500 KB on the wire, so every
  query is an array lookup in the browser.

### What the comparison shows

AI weather models are known to produce smoother, less extreme precipitation than
physics models, and the app makes that visible rather than asserting it. On the
2026-11-12 12Z run over India:

| | IFS HRES (physics) | AIFS Single (AI) |
|---|---|---|
| Peak rate | 64.5 mm/h | 13.0 mm/h |
| Share of cells raining | 14% | 19% |

The AI model spreads rain over a wider area at lower intensity. In the swipe view the
physics side is granular and speckled while the AI side is made of large smooth blobs.
Neither is ground truth; this app does not verify either against observations.

## How it works

![Architecture: two ECMWF forecasts aligned to a shared run, processed into compact float16 cubes, deployed to GitHub Pages four times a day, read entirely in the browser](docs/architecture.svg)

Full detail, including every figure quoted here and how it was checked, is in
**[docs/METHODS.md](docs/METHODS.md)**.

```
ECMWF Open Data ──▶ IFS  GRIB2 (65 steps, 31 MB) ──▶ ifs.f16   64 frames, 2.54 MB
                └─▶ AIFS GRIB2 (41 steps, 17 MB) ──▶ aifs.f16  40 frames, 1.59 MB
                         de-accumulate · normalise units · subset to India
                         meta.json: valid times, interval lengths, provenance
                                           │
            GitHub Actions ──twice daily──▶ build the web app ──▶ GitHub Pages
```

**The data.** ECMWF's `tp` (total precipitation) is *accumulated from the start of the
forecast*. The pipeline differences consecutive steps and divides each difference by its
own interval length — which matters because IFS changes step spacing from 3 h to 6 h at
T+144h, so a constant divisor would overstate rain rates across the whole second half of
the forecast. 65 accumulation steps therefore become **64 interval frames**, each
labelled by the valid time at the *end* of its interval.

**Units differ by model and are read from the file, never assumed:** IFS publishes `tp`
in **metres**, AIFS Single in **kg m⁻²** (numerically millimetres). Treating an AIFS
field as metres overstates rainfall by 1000×. Everything downstream of `decode` works in
millimetres.

Values are stored as a **rain rate in mm/h** rather than an interval total, so one
physical quantity spans both the spacing change and the two models' different
resolutions; the app multiplies back up by each frame's interval length to show mm/3h
or mm/6h.

**Comparing fairly.** The two models' newest complete runs do not line up — AIFS is
released sooner and runs all four cycles, while IFS reaches day 15 only at 00z and 12z —
so the pipeline resolves one shared run for both and refuses to pretend otherwise.
Differences are computed over **6-hourly windows**, the coarsest interval the two share,
by averaging the finer model up rather than interpolating the coarser one down.

**The front end.** The India window is 141 × 141 cells, small enough that the entire
forecast ships to the browser as one float16 array. The field is coloured through a
log-scaled single-hue ramp into a 141 × 141 canvas and handed to MapLibre as a raster
source. The basemap is a 157 KB Natural Earth extract bundled into the app — no tile
server, no API key, no glyph server, nothing to rate-limit.

## Running it locally

Requires Python 3.11+ and Node 20.19+.

```bash
# 1. Pipeline
python -m venv .venv
.venv/Scripts/activate            # Windows;  source .venv/bin/activate elsewhere
pip install -e "./pipeline[dev]"
pytest pipeline/tests             # 45 tests, no network needed

python -m precipitation.cli latest                        # what runs are published
python -m precipitation.cli run --model ifs --model aifs --out web/public/data

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
| `.github/workflows/forecast.yml` | scheduled fetch → build → deploy |
| `.github/scripts/verify_data.py` | gate that stops a bad forecast from deploying |
| `docs/METHODS.md` | the maths, the unit handling, and how every figure was checked |

## Verification

`pytest pipeline/tests` covers the de-accumulation maths, the 3 h → 6 h interval change,
GRIB packing tolerance, the cube/metadata contract, units, and timezone handling (45 tests, no
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
   a naive datetime outright. (The fix then broke CI, because the client compares the
   requested date against a naive constant internally; the local GRIB cache had hidden
   it by skipping the download entirely.)
4. **AIFS publishes `tp` in kg m⁻², not metres.** Measured ratio of AIFS to IFS
   accumulated `tp` at T+24h was 949.7 — a thousandfold unit difference, not a physical
   one. Units are read from each file and converted, and an unknown unit is an error
   rather than a guess.

## Known limitations

- **Deterministic, not probabilistic.** This is the single IFS HRES forecast, so it says
  what one model run expects, not how likely it is. Rain beyond about day 5 should be
  read as a pattern, not a schedule. Ensemble probabilities are the natural next step.
- **It is precipitation, not rain.** ECMWF's `tp` is *total* precipitation, so over the
  Himalaya, Kashmir and high Ladakh — especially in winter — much of what the map shows
  is snow, reported as the depth of water it would melt into. A 10 mm signal over
  Srinagar is roughly 10 cm of snow, not 10 mm of rain. The app says "rainfall"
  throughout because that is what it means almost everywhere in the domain, but the
  distinction matters in the north.
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
- **No verification.** The two models are compared against each other, never against
  observations, so the app can show *that* they disagree but never which is right.
- **The models are compared at 6-hourly resolution**, the coarsest interval they share,
  even though IFS is 3-hourly for the first six days.
- **One run.** No comparison against the previous run, so forecast-to-forecast
  consistency is not visible.
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
