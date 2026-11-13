"""Single source of truth for grid, steps, models and paths.

Everything downstream (fetch, decode, transform, encode) reads its parameters from
here so that the India window and the step list are defined exactly once.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

# --------------------------------------------------------------------------------------
# ECMWF open-data global grid (0.25 degree)
# --------------------------------------------------------------------------------------
# Verified against live data on 2026-11-12: fields are 1440 x 721 and latitude runs
# 90 -> -90 (north first).
#
# IMPORTANT: the GRIB messages are stored with longitudeOfFirstGridPoint = 180.0, so the
# native column order runs -180 -> 179.75, NOT 0 -> 359.75. cfgrib labels this correctly.
# Assuming a 0..360 layout silently extracts the eastern Pacific instead of India, with
# entirely plausible-looking values, so window indices are DERIVED from the decoded
# coordinate arrays and then asserted -- never hardcoded.
GLOBAL_NLON = 1440
GLOBAL_NLAT = 721
GRID_DEG = 0.25

# --------------------------------------------------------------------------------------
# India window
# --------------------------------------------------------------------------------------
# A square 141 x 141 window covering mainland India plus the Arabian Sea and the Bay of
# Bengal, so systems can be seen arriving from offshore.
LON_MIN = 65.0
LON_MAX = 100.0
LAT_MIN = 5.0
LAT_MAX = 40.0

NLON = int(round((LON_MAX - LON_MIN) / GRID_DEG)) + 1  # 141
NLAT = int(round((LAT_MAX - LAT_MIN) / GRID_DEG)) + 1  # 141

# Rows of the cube run north -> south, matching the source field and image row order.
LAT_FIRST = LAT_MAX
LAT_LAST = LAT_MIN
LAT_STEP = -GRID_DEG


def window_slices(
    lats: np.ndarray, lons: np.ndarray
) -> tuple[slice, slice]:
    """Return (lat_slice, lon_slice) selecting the India window from a global field.

    Derived from the decoded coordinate arrays rather than assumed, then asserted, so a
    change in the source grid convention fails loudly instead of silently returning the
    wrong part of the world.
    """
    if lats.size != GLOBAL_NLAT or lons.size != GLOBAL_NLON:
        raise ValueError(
            f"unexpected global grid {lats.size} x {lons.size}, "
            f"expected {GLOBAL_NLAT} x {GLOBAL_NLON}"
        )
    if not (lats[0] > lats[-1]):
        raise ValueError("expected latitude to run north -> south")

    lat_i0 = int(round((lats[0] - LAT_MAX) / GRID_DEG))
    lon_i0 = int(round((LON_MIN - lons[0]) / GRID_DEG))
    lat_s = slice(lat_i0, lat_i0 + NLAT)
    lon_s = slice(lon_i0, lon_i0 + NLON)

    got_lat = lats[lat_s]
    got_lon = lons[lon_s]
    if got_lat.size != NLAT or got_lon.size != NLON:
        raise ValueError("India window ran off the edge of the global grid")
    if not (
        np.isclose(got_lat[0], LAT_MAX)
        and np.isclose(got_lat[-1], LAT_MIN)
        and np.isclose(got_lon[0], LON_MIN)
        and np.isclose(got_lon[-1], LON_MAX)
    ):
        raise ValueError(
            "India window does not land on the expected coordinates: "
            f"lat {got_lat[0]}..{got_lat[-1]}, lon {got_lon[0]}..{got_lon[-1]}"
        )
    return lat_s, lon_s


# --------------------------------------------------------------------------------------
# Forecast steps
# --------------------------------------------------------------------------------------
# Deterministic rainfall stops being meaningful well before the model's 360 h horizon,
# so the cube is capped at day 10.
MAX_STEP_H = 240


def ifs_steps() -> list[int]:
    """IFS HRES oper/fc accumulation steps up to MAX_STEP_H.

    Native spacing is 3 h out to 144 h, then 6 h. These are *accumulation* step values;
    de-accumulation turns N of them into N-1 interval frames.

    Note: only the 00z and 12z IFS cycles reach this horizon -- 06z and 18z stop at
    T+90h. `fetch.latest_run` pins the run selection accordingly.
    """
    steps = list(range(0, 145, 3)) + list(range(150, 361, 6))
    return [s for s in steps if s <= MAX_STEP_H]


def aifs_steps() -> list[int]:
    """AIFS Single oper/fc accumulation steps up to MAX_STEP_H (uniform 6 h)."""
    return list(range(0, MAX_STEP_H + 1, 6))


@dataclass(frozen=True)
class Model:
    """A model configuration for the ecmwf-opendata client."""

    key: str  # short name used in filenames and the UI
    label: str  # human-readable name for the UI
    opendata_model: str  # `model=` for ecmwf.opendata.Client
    stream: str
    type: str
    steps: list[int]

    @property
    def n_frames(self) -> int:
        """Number of interval frames after de-accumulation."""
        return len(self.steps) - 1


IFS = Model(
    key="ifs",
    label="IFS HRES",
    opendata_model="ifs",
    stream="oper",
    type="fc",
    steps=ifs_steps(),
)

AIFS = Model(
    key="aifs",
    label="AIFS Single",
    opendata_model="aifs-single",
    stream="oper",
    type="fc",
    steps=aifs_steps(),
)

MODELS: dict[str, Model] = {IFS.key: IFS, AIFS.key: AIFS}

PARAM = "tp"  # total precipitation, accumulated from T+0, units metres
RESOLUTION = "0p25"

# --------------------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[3]
CACHE_DIR = REPO_ROOT / ".cache" / "grib"
DEFAULT_OUT_DIR = REPO_ROOT / "web" / "public" / "data"

# --------------------------------------------------------------------------------------
# Quality control
# --------------------------------------------------------------------------------------
# Everything downstream of `decode` works in MILLIMETRES. The source files do not agree
# on units -- IFS publishes tp in metres, AIFS Single in kg m**-2 (numerically mm, a
# 1000x difference) -- so `decode.decode_window` converts to mm and the rest of the
# pipeline never has to know which model it came from.
#
# De-accumulated GRIB carries small negative values because consecutive accumulations
# are independently quantised. Open-data tp uses grid_ccsds packing at 12 bits with a
# binary scale factor around -13, so one IFS quantum is 2**-13 m = 0.122 mm.
#
# Measured on the IFS 2026-11-12 00Z run (65 steps, India window, 1,272,384 cells):
# 0.37% of cells decreased, the worst by exactly -1.000 quantum, and clamping those to
# zero added 0.069% to total accumulated mass. The next run's worst case was -2 quanta,
# so a tolerance of one quantum would have broken production.
#
# The tolerance is ~8 quanta. That comfortably absorbs packing noise while still
# separating it from a genuine fault: steps retrieved out of order or mismatched produce
# decreases of the order of the accumulated total, i.e. tens to hundreds of millimetres.
GRIB_PACKING_QUANTUM_MM = (2.0**-13) * 1000.0  # 0.1220703125 mm
NEGATIVE_TOLERANCE_MM = 8 * GRIB_PACKING_QUANTUM_MM  # ~0.977 mm

# How each source unit converts to millimetres.
UNITS_TO_MM = {
    "m": 1000.0,  # IFS
    "kg m**-2": 1.0,  # AIFS Single: 1 kg m-2 of water is 1 mm depth
}

# Sanity ceiling on a grid-cell-average rain rate. The wettest short-period rates in
# India reach roughly 50-80 mm/h at a point; a 0.25 degree cell average far above that
# means decoding or de-accumulation has gone wrong.
MAX_PLAUSIBLE_RATE_MM_H = 150.0

SOURCE_ATTRIBUTION = {
    "name": "ECMWF Open Data",
    "licence": "CC BY 4.0",
    "licence_url": "https://creativecommons.org/licenses/by/4.0/",
    "url": "https://www.ecmwf.int/en/forecasts/datasets/open-data",
}
