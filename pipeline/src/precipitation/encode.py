"""Write the forecast cube and its metadata for the web app.

The whole India forecast is small enough to ship to the browser as one file, which is
why the app needs no query API: clicking a point is an array lookup, not a round trip.

Layout: float16, little-endian, C order, `[frame][lat][lon]`, rows north -> south.
For IFS that is 64 frames x 141 x 141 x 2 B = 2,544,768 bytes.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import config, transform

SCHEMA_VERSION = 1


def cube_bytes(n_frames: int) -> int:
    """Expected byte length of a cube with `n_frames` frames."""
    return n_frames * config.NLAT * config.NLON * 2


def write_cube(
    deacc: transform.Deaccumulated,
    *,
    model: config.Model,
    run_time: datetime,
    steps: Sequence[int],
    valid_times: Sequence[datetime],
    out_dir: Path,
) -> dict:
    """Write `<model>.f16` and `<model>.json`, returning the metadata written.

    `deacc` holds the de-accumulated field, one frame per interval, plus the clamping
    diagnostics. `steps` and `valid_times` are the N accumulation steps that produced
    those N-1 frames.
    """
    # A naive datetime here would be reinterpreted as local time by astimezone() and
    # silently shift every timestamp by the machine's UTC offset. Refuse it outright.
    for label, value in [("run_time", run_time), *(
        (f"valid_times[{i}]", v) for i, v in enumerate(valid_times)
    )]:
        if value.tzinfo is None:
            raise ValueError(
                f"{label} is timezone-naive; normalise with fetch.ensure_utc first"
            )

    rate_mm_h = deacc.rate_mm_h
    n_frames = rate_mm_h.shape[0]
    if n_frames != len(steps) - 1:
        raise ValueError(
            f"{n_frames} frames do not match {len(steps)} accumulation steps"
        )
    if rate_mm_h.shape[1:] != (config.NLAT, config.NLON):
        raise ValueError(
            f"expected frames of {config.NLAT}x{config.NLON}, "
            f"got {rate_mm_h.shape[1:]}"
        )

    stats = transform.check_rates(rate_mm_h)

    quantised = np.ascontiguousarray(rate_mm_h, dtype="<f2")
    payload = quantised.tobytes()
    expected = cube_bytes(n_frames)
    if len(payload) != expected:
        raise ValueError(f"cube is {len(payload)} bytes, expected {expected}")

    out_dir.mkdir(parents=True, exist_ok=True)
    cube_path = out_dir / f"{model.key}.f16"
    cube_path.write_bytes(payload)

    hours = transform.interval_hours(steps)
    frames = [
        {
            "i": i,
            "step_start": int(steps[i]),
            "step_end": int(steps[i + 1]),
            "hours": int(hours[i]),
            "valid_time": valid_times[i + 1]
            .astimezone(timezone.utc)
            .strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        for i in range(n_frames)
    ]

    meta = {
        "schema": SCHEMA_VERSION,
        "model": {
            "key": model.key,
            "label": model.label,
            "opendata_model": model.opendata_model,
            "stream": model.stream,
            "type": model.type,
            "resolution": config.RESOLUTION,
        },
        "run": {
            "datetime": run_time.astimezone(timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            ),
            "date": run_time.strftime("%Y%m%d"),
            "hour": run_time.strftime("%H"),
        },
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "grid": {
            "nlon": config.NLON,
            "nlat": config.NLAT,
            "lon_min": config.LON_MIN,
            "lon_max": config.LON_MAX,
            "lat_min": config.LAT_MIN,
            "lat_max": config.LAT_MAX,
            "step_deg": config.GRID_DEG,
            # Row 0 is the NORTHERNMOST row, matching image row order.
            "lat_first": config.LAT_FIRST,
            "lat_last": config.LAT_LAST,
            "lat_step": config.LAT_STEP,
            "lon_first": config.LON_MIN,
            "lon_step": config.GRID_DEG,
        },
        "cube": {
            "file": cube_path.name,
            "dtype": "float16",
            "byte_order": "little",
            "layout": "[frame][lat][lon]",
            "units": "mm/h",
            "n_frames": n_frames,
            "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        },
        "frames": frames,
        "stats": stats,
        # Reported openly: consecutive accumulations are independently quantised, so a
        # few cells decrease. Clamping them to zero adds a little mass to the forecast.
        "deaccumulation": {
            "clamped_cells": deacc.clamped_cells,
            "clamped_fraction": deacc.clamped_fraction,
            "worst_decrement_mm": deacc.worst_decrement_mm,
            "worst_decrement_quanta": deacc.worst_decrement_quanta,
            "mass_added_fraction": deacc.mass_added_fraction,
            "packing_quantum_mm": config.GRIB_PACKING_QUANTUM_MM,
        },
        "source": config.SOURCE_ATTRIBUTION,
    }

    meta_path = out_dir / f"{model.key}.json"
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print(
        f"[encode] {cube_path.name}: {n_frames} frames, {len(payload):,} bytes, "
        f"peak {stats['max_mm_h']:.1f} mm/h, "
        f"wet fraction {stats['wet_fraction']:.1%}"
    )
    print(
        f"[encode] de-accumulation clamped {deacc.clamped_cells:,} cells "
        f"({deacc.clamped_fraction:.3%}), worst "
        f"{deacc.worst_decrement_quanta:.2f} quanta, "
        f"mass added {deacc.mass_added_fraction:.4%}"
    )
    return meta


def write_index(metas: Sequence[dict], out_dir: Path) -> None:
    """Write `index.json` listing every published model, newest run first."""
    index = {
        "schema": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "models": [
            {
                "key": m["model"]["key"],
                "label": m["model"]["label"],
                "cube": m["cube"]["file"],
                "meta": f"{m['model']['key']}.json",
                "run": m["run"]["datetime"],
                "n_frames": m["cube"]["n_frames"],
            }
            for m in metas
        ],
        "source": config.SOURCE_ATTRIBUTION,
    }
    (out_dir / "index.json").write_text(
        json.dumps(index, indent=2), encoding="utf-8"
    )
    print(f"[encode] index.json: {len(metas)} model(s)")
