# Methods

How Monsoon Lens turns ECMWF Open Data into the numbers on screen, and what each step
assumes. Written so the figures can be audited rather than taken on trust.

**Source:** ECMWF Open Data, `tp` (total precipitation), 0.25° global grid, CC BY 4.0.
**Models:** IFS HRES (`oper`/`fc`) and AIFS Single (`aifs-single`, `oper`/`fc`).
**Domain:** 65–100°E, 5–40°N — 141 × 141 cells at 0.25°.
**Horizon:** T+240h (day 10).

---

## 1. Choosing the run

ECMWF publishes open data 7–9 hours after a run's nominal time. Two constraints shape
which run is used:

- **IFS reaches day 15 only at 00z and 12z.** The 06z and 18z cycles stop at T+90h.
  Resolving "the latest run" naively returns a short cycle whose later steps 404, so
  `fetch.latest_run` asks for the newest run that *has the final step*
  (`client.latest(..., step=240)`), which pins the result to a long cycle without
  hardcoding which those are.
- **The two models are not released together.** AIFS runs all four cycles to day 15 and
  is released sooner. Comparing forecasts from different analysis times would confound
  "the models disagree" with "they started from different states", so `fetch.common_run`
  takes the earliest of the models' latest runs and the CLI aligns every model to it.

Raw GRIB is cached under `.cache/grib/` by model and run, so re-running costs nothing.

## 2. Decoding and the India window

Fields are read one step at a time with `cfgrib` and subset immediately, so peak memory
stays near one global field (~8 MB) rather than the whole forecast (~270 MB).

**The window is derived from the decoded coordinates, never hardcoded.** ECMWF's
open-data GRIB is stored with `longitudeOfFirstGridPoint = 180`, so the native column
order runs −180 → 179.75 and cfgrib labels it that way. 65°E is therefore column **980**,
not column 260 as a 0–360 layout would imply. Indexing on the wrong assumption returns
the eastern Pacific — with entirely plausible-looking rainfall values.
`config.window_slices` computes the indices from the actual latitude and longitude
arrays and asserts that the corners land on 65/100°E and 5/40°N.

## 3. Units

`tp` is published in different units by different models:

| Model | GRIB `units` | Factor to mm |
|---|---|---|
| IFS HRES | `m` | × 1000 |
| AIFS Single | `kg m**-2` | × 1 |

1 kg m⁻² of water is 1 mm of depth. The measured ratio of AIFS `tp` to IFS `tp` *in
their published units*, averaged over the domain at T+24h on the 2026-11-12 12Z run, was
**949.7**. That number is two separate things multiplied together, and it is worth
separating them:

- **×1000 from units**, which is the whole reason the ratio is near a thousand at all.
  Treating an AIFS field as metres would overstate rainfall thousandfold.
- **×0.9497 from the models themselves.** Once the unit factor is divided out, AIFS
  carries about **5% less** total water than IFS over India at that lead time, on that
  same 2026-11-12 12Z run. That residual is a genuine model difference, not a rounding
  artefact — it is the same smoothing tendency that shows up far more dramatically in
  peak intensity (§6). The 5% is one run's figure, not a constant.

So the right reading is "a thousandfold unit factor, with a few per cent of real
disagreement riding on top", not "a clean 1000×". Units are read from each file and
converted in `decode.decode_window`; an unrecognised unit raises rather than being
guessed. Everything downstream works in millimetres.

## 4. De-accumulation

`tp` is accumulated from the start of the forecast, so interval precipitation is the
difference between consecutive steps. **N accumulation steps give N−1 interval frames.**

IFS steps are 3-hourly to T+144h and 6-hourly after, so each difference is divided by
**its own interval length**, not a constant:

```
rate[i] = (tp[i+1] − tp[i]) / (step[i+1] − step[i])     mm/h
```

A constant divisor of 3 would double every rate after T+144h. For IFS, 65 steps become
**64 frames** (48 × 3 h, 16 × 6 h); for AIFS, 41 steps become **40 frames** (all 6 h).

Frames are labelled by the valid time at the **end** of their interval.

### Why a rate and not a total

Storing mm/h gives one physical quantity that spans both the 3 h → 6 h change and the
two models' different resolutions. The app multiplies back by each frame's interval
length to show mm per interval. It also makes the charts honest: the rate chart is a
histogram whose bar *height* is mm/h and whose *width* is the interval's real duration,
so area is millimetres and a 6-hourly bar is twice as wide rather than twice as tall.

### Negative decrements

Consecutive accumulations are independently quantised by GRIB packing (`grid_ccsds`,
12 bits, binary scale factor ≈ −13), so a small fraction of cells decrease. One IFS
quantum is 2⁻¹³ m = **0.122 mm**.

Measured on the IFS 2026-11-12 00Z run (64 frames, 1,272,384 cells):

| | value |
|---|---|
| Cells that decreased | 4,742 (0.37%) |
| Worst decrement | exactly −1.000 quantum |
| Mass added by clamping to zero | +0.069% |

The next run's worst case was **−2 quanta**, so a tolerance of one quantum would have
broken production. The tolerance is 8 quanta (≈ 0.98 mm): far above packing noise, far
below a real fault, since mis-ordered or mismatched steps lose tens to hundreds of
millimetres. Per-run figures are published in each `meta.json` under `deaccumulation`
rather than hidden.

## 5. Storage

Each model is written as a raw float16 array, `[frame][lat][lon]`, row-major,
little-endian, rows north → south, in mm/h:

| Model | Frames | Bytes | Gzipped on the wire |
|---|---|---|---|
| IFS | 64 | 2,544,768 | ~330 KB |
| AIFS | 40 | 1,590,480 | ~210 KB |

The byte counts are fixed by the grid and frame count and never vary. The gzipped
figures are from the 2026-11-13 00Z run and move with the forecast — precipitation is
mostly zeros, so a wetter run compresses less well.

float16 holds about three significant digits — irrelevant for reading a forecast, but
the cube is not the artefact to use for numerical verification; use the source GRIB.

`meta.json` carries the grid definition, every frame's interval length and valid time,
units, run time, min/max/mean, wet fraction, a SHA-256 of the cube, and the
de-accumulation diagnostics. `.github/scripts/verify_data.py` re-checks the published
files before deployment: exact byte length, checksum, strictly increasing valid times,
each frame's valid time equal to run + step_end, no negatives, and run age under 48 h.

## 6. Comparing the two models

Differences are computed over **6-hourly windows** — the coarsest interval the two share
— by averaging the finer model up (`Cube.windowMeanRate`, weighted by overlap) rather
than interpolating the coarser one down. The disagreement layer shows
*physics minus AI* mean rate on a diverging scale with a neutral, fully transparent
midpoint, so "they agree" reads as no signal.

Neither model is ground truth, and **this app never verifies either against
observations**. It can show that two forecasts differ; it cannot say which is right.

### Peak intensity and wet area move at different speeds

The two summary figures in the app's "What is this?" panel behave very differently from
run to run, which is worth knowing before reading anything into either:

| 2026-11-13 00Z | IFS HRES | AIFS Single |
|---|---|---|
| Peak rate | 66.08 mm/h | 11.54 mm/h |
| Area raining (> 0.1 mm/h, all frames) | 14.23% | 18.73% |

The 2026-11-12 12Z run gave peaks of 64.44 and 13.00 mm/h, and wet areas that rounded to
the same 14% and 19% as above. (That run's `meta.json` has since been replaced by the
next deployment — only the rounded figures were recorded at the time, so the exact
decimals are no longer recoverable.) **The peaks moved by one to two mm/h while the areas
did not move enough to change a whole percentage point** — a peak is one cell out of 1.27
million and is set by whatever the single most convective moment in the forecast happens
to be, whereas the wet area averages over the entire cube and is therefore far more
stable. Two consecutive runs showing the same 14% and 19% is a real property of the data,
not a stale figure.

Both numbers are **recomputed for every run** in `transform.check_rates`
(`wet_fraction = (rate > 0.1 mm/h).mean()`), stored in `meta.json` under `stats`, and
read live by the UI from `comparison.physics.meta.stats.wet_fraction`. Nothing in the
app is hardcoded. Figures quoted in prose *in this file and in the README* are
necessarily snapshots and are labelled with the run they came from.

The direction of the difference is the part that matters and it is consistent across
runs: the AI model wets a **wider area at a lower peak**, which is the smoothing
tendency AIFS is known for, and the same tendency that showed up as the residual 5% in
§3.

The sharpest instance found so far is worked through in the README: on the 2026-11-13 00Z
run both models carry one organised system across the Bay of Bengal, but by day six their
cores are **370 km apart** and differ **six-fold** in peak rate. Each then deposits about
180 mm on the east coast — IFS at Visakhapatnam (181 mm, against the AI's 42 mm), AIFS
500–600 km south at Nellore and Chennai (179 and 180 mm, against the physics model's 7 and
14 mm). Two caveats travel with that example: `tp` alone cannot establish that such a
feature *is* a cyclone, since no wind or pressure field is ingested, and a day 6–7
divergence says as much about deterministic skill at that range as it does about the two
models.

## 7. "Now"

A run is already several hours old when published and stays newest for another twelve,
so a large part of the forecast is history by the time anyone opens the page. One
reference frame — `Cube.frameNearestTime(now)` — drives the opening position of the
timeline, the past/future boundary in every chart and table, and the start of every
forward-looking figure (peak, onset, remaining total). Times shown to the reader are
relative to the present, not to the run.

---

## Verification

### Independent cross-check

Daily totals against Open-Meteo's ECMWF IFS feed — same source model, entirely separate
processing chain. A units error would appear as a 1000× factor, the interval bug as 2×.

**Days are UTC days** (00:00–24:00Z) on both sides, requested from Open-Meteo with
`timezone=GMT`. They are *not* Indian calendar days: an IST day runs from 18:30Z the
previous evening, so "13 Nov" here is not the 13 Nov a reader in India experiences, and
the two partition rainfall differently. UTC is used because it is the convention the
GRIB steps are already in, and mixing the two is how day-shift errors get in.

| Thiruvananthapuram (8.52 N, 76.94 E) | 13 Nov | 14 Nov | 15 Nov | 16 Nov | 17 Nov | 18 Nov | Total |
|---|---|---|---|---|---|---|---|
| This pipeline (mm) | 5.4 | 2.2 | 2.0 | 1.0 | 0.2 | 4.2 | 14.9 |
| Open-Meteo ECMWF (mm) | 4.9 | 2.1 | 2.1 | 1.2 | 0.3 | 4.2 | 14.8 |

IFS 2026-11-12 12Z run.

**On the arithmetic:** each column is rounded to 0.1 mm independently and each total is
the sum of the *unrounded* daily values, so the printed columns need not add up to the
printed total. Here the pipeline columns sum to 15.0 against a stated 14.9 — the gap is
accumulated rounding across six columns, not a missing day. The same effect is visible
on the current run, where Chennai's ten daily values sum to 13.5 as printed and 13.55
unrounded, which prints as 13.6. Reproducible figures are therefore quoted unrounded
below.

Chennai on the 12Z run came out at **1.5 mm against Open-Meteo's 1.2 mm**. On totals that
small, agreement to within a few tenths is weak evidence: the two differ by 25% in
relative terms, and either could round to the other with a small change. It rules out a
unit or interval error, which is all it was asked to do — it is not a demonstration that
the two pipelines agree closely. Kolkata was dry in both, which is a still weaker test.

**Re-run on the 2026-11-13 00Z run** (ten-day totals, unrounded both sides):

| Point | This pipeline | Open-Meteo ECMWF | Difference |
|---|---|---|---|
| Thiruvananthapuram (8.52 N, 76.94 E) | 32.96 mm | 31.80 mm | −3.5% |
| Kochi (9.93 N, 76.27 E) | 23.25 mm | 23.40 mm | +0.6% |
| Chennai (13.08 N, 80.27 E) | 13.55 mm | 15.40 mm | +13.7% |

Two caveats keep this honest. Open-Meteo serves **whichever ECMWF cycle is current**,
which was the 06Z run by the time this was measured while the app had deployed 00Z, so
day-level rows legitimately differ by a forecast cycle and only the ten-day totals are
comparable. And Open-Meteo interpolates to the requested coordinate while this pipeline
returns the containing 0.25° cell, so the two are not sampling identical areas — enough
to explain Chennai, which sits on a sharp coastal gradient. What the check establishes is
the absence of a 1000× or 2× error, not agreement to the last tenth.

### The interval divisor

If each difference were divided by a constant 3 h, every 6-hourly frame after T+144h
would be inflated twofold and the hottest frame would tend to land on frame 48, the
first 6-hourly interval. On the 2026-11-12 12Z run:

- The peak, **64.44 mm/h**, is on **frame 25** — a 3-hour interval, T+75h → T+78h, valid
  2026-11-15 18:00Z, at 11.50°N 85.00°E in the Bay of Bengal. Not frame 48.
- Maximum over all 3 h frames: 64.44 mm/h. Over all 6 h frames: 40.53 mm/h.
- Mean of per-frame maxima: **22.18 mm/h for 3 h frames, 15.07 for 6 h frames.**

Six-hourly frames are *lower*, which is what longer averaging must do to peaks. A wrong
divisor would have made them higher.

### Seasonal plausibility

Mid-November in India is the *northeast* monsoon: rain over Tamil Nadu, coastal Andhra,
Kerala and Sri Lanka, while the northern plains and the Thar desert stay dry. The test is
that **the far south is an order of magnitude wetter than the far north**, and that the
dry areas are the ones that should be dry.

On the 2026-11-13 00Z run the 10-day mean accumulation was **71.7 mm south of 15°N
against 3.4 mm north of 28°N — a ratio of 21×**. The 2026-11-12 12Z run gave 12×. The
ratio is a threshold, not a constant: it moves run to run with where the systems sit, and
anything from roughly 5× upward passes. A window extracted from the wrong longitudes
fails it outright, because the eastern Pacific has no such gradient.

**The far north is not uniformly dry, and saying so would contradict the snow caveat.**
Separating the north makes the picture consistent:

| Region (2026-11-13 00Z) | 10-day mean | Note |
|---|---|---|
| Northwest desert belt, 25–40°N / 68–75°E | 4.1 mm | genuinely dry; Jaisalmer 2.6 mm |
| Western Himalaya, 30–36°N / 74–80°E | 6.4 mm, max **70.8 mm** | the wettest part of the north |

So the dry areas are the plains and the desert — Delhi and Mumbai both at 0.0 mm — while
the Himalayan arc carries modest means with individual cells well above anything in the
northwest, which is what a passing western disturbance looks like. Srinagar reads
**16.4 mm** on the 2026-11-13 00Z run. Nearly all of that is **snow**, reported as the depth of water it
would melt into (§ *Known sources of error* and the README's limitations), so roughly
16 cm of snow rather than 16 mm of rain. "The Himalaya is dry in November" would be both
wrong and inconsistent with that caveat; the correct statement is that the north is dry
*except* along the mountains, and what falls there is frozen.

### Automated

`pytest pipeline/tests` (45 tests, no network) covers interval arithmetic across the
3 h → 6 h change, unit conversion for both models, packing tolerance, the cube and
metadata contract, run alignment, and timezone handling. `npm run check` typechecks the
front end and asserts the rounding rule used for displayed differences.

## Known sources of error, roughly ordered

1. **Forecast error itself**, which dominates everything below and grows with lead time.
2. **Grid-cell averaging** over ~28 km, which understates intense convective cells and
   resolves no terrain within a cell.
3. **Deterministic only** — one run of each model, no ensemble, so no uncertainty range.
4. **Comparison resolution** of 6 h, coarser than IFS's native 3 h for the first six days.
5. **Clamping** of negative decrements — +0.069% mass on the 2026-11-12 00Z run, and
   published per run in `meta.json` rather than assumed constant.
6. **float16 storage**, about three significant digits.
