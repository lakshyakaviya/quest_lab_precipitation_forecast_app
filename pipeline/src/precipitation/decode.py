"""Decode GRIB2 into a numpy stack covering the India window.

Fields are read one step at a time and subset immediately, so peak memory stays near
one global field (~8 MB) rather than the whole forecast (~270 MB). That matters because
the development machine has 8 GB of RAM.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import xarray as xr

from . import config


def _step_hours(value) -> int:
    """Convert an xarray step coordinate value to whole hours."""
    return int(np.asarray(value).astype("timedelta64[h]").astype(np.int64))


def decode_window(
    grib_path: Path, steps: Sequence[int]
) -> tuple[np.ndarray, list[datetime]]:
    """Read accumulated `tp` for `steps`, subset to India, and convert to millimetres.

    Returns:
        (n_steps, 141, 141) float32 accumulated precipitation in **mm**, ordered to
        match `steps`, and the list of valid times (UTC) for those steps.

    The unit conversion happens here because the models disagree: IFS publishes tp in
    metres and AIFS Single in kg m**-2, which is numerically millimetres. Treating an
    AIFS field as metres overstates rainfall by 1000x. The units are read from the file
    rather than assumed per model, and an unrecognised unit is an error.

    Raises if any requested step is missing, so a partially published run fails loudly
    instead of producing a cube with silently repeated frames.
    """
    ds = xr.open_dataset(
        grib_path,
        engine="cfgrib",
        decode_timedelta=True,
        backend_kwargs={"indexpath": ""},  # don't litter .idx files next to the data
    )
    try:
        if "tp" not in ds:
            raise ValueError(f"no `tp` variable in {grib_path}")
        tp = ds["tp"]

        lats = np.asarray(ds["latitude"].values, dtype=np.float64)
        lons = np.asarray(ds["longitude"].values, dtype=np.float64)
        lat_s, lon_s = config.window_slices(lats, lons)

        if "step" not in tp.dims:
            tp = tp.expand_dims("step")
        available = {_step_hours(v): i for i, v in enumerate(ds["step"].values)}
        missing = [s for s in steps if s not in available]
        if missing:
            raise ValueError(
                f"{grib_path.name} is missing {len(missing)} requested steps: "
                f"{missing[:8]}{'...' if len(missing) > 8 else ''}"
            )

        run_time = _as_utc(ds["time"].values)

        units = tp.attrs.get("units")
        if units not in config.UNITS_TO_MM:
            raise ValueError(
                f"unrecognised tp units {units!r} in {grib_path.name}; "
                f"known units are {sorted(config.UNITS_TO_MM)}"
            )
        to_mm = config.UNITS_TO_MM[units]

        step_type = tp.attrs.get("GRIB_stepType")
        if step_type != "accum":
            raise ValueError(f"expected accumulated tp, got stepType={step_type!r}")

        out = np.empty((len(steps), config.NLAT, config.NLON), dtype=np.float32)
        for i, step in enumerate(steps):
            field = tp.isel(step=available[step]).values  # reads one GRIB message
            out[i] = field[lat_s, lon_s] * to_mm
        valid_times = [run_time + timedelta(hours=int(s)) for s in steps]

        print(
            f"[decode] {grib_path.name}: {len(steps)} steps, run "
            f"{run_time:%Y-%m-%d %H}Z, units {units!r} (x{to_mm:g} -> mm), window "
            f"{config.NLAT}x{config.NLON} lat {lats[lat_s][0]}..{lats[lat_s][-1]} "
            f"lon {lons[lon_s][0]}..{lons[lon_s][-1]}"
        )
        return out, valid_times
    finally:
        ds.close()


def _as_utc(value) -> datetime:
    """numpy datetime64 -> timezone-aware UTC datetime."""
    ts = np.asarray(value).astype("datetime64[s]").astype(np.int64)
    return datetime.fromtimestamp(int(ts), tz=timezone.utc)
