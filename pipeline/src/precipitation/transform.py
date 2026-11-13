"""De-accumulation and quality control.

This is the correctness core of the pipeline. ECMWF's `tp` is *accumulated from the
start of the forecast*, so a forecast of N accumulation steps yields N-1 interval
frames. Input here is already in **millimetres** — `decode.decode_window` normalises
the units, because IFS publishes metres and AIFS Single publishes kg m**-2.

The subtlety that makes this worth its own tested module: IFS HRES changes step spacing
from 3 h to 6 h at T+144 h. Dividing every interval by a constant 3 would overstate rain
rates in the second half of the forecast by a factor of two. Each interval is therefore
divided by its own length.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from . import config


@dataclass(frozen=True)
class Deaccumulated:
    """A de-accumulated rain-rate field plus what it cost to produce it.

    The clamping diagnostics are reported rather than hidden, because silently setting
    negative rainfall to zero adds mass to the forecast and a reader should be able to
    see how much.
    """

    rate_mm_h: np.ndarray  # (n_frames, n_lat, n_lon) float32, mm/h
    clamped_cells: int
    clamped_fraction: float
    worst_decrement_mm: float
    worst_decrement_quanta: float
    mass_added_fraction: float


def interval_hours(steps: Sequence[int]) -> np.ndarray:
    """Length in hours of each interval between consecutive accumulation steps.

    For IFS this is 48 intervals of 3 h followed by 16 of 6 h.
    """
    s = np.asarray(steps, dtype=np.int32)
    if s.ndim != 1 or s.size < 2:
        raise ValueError("need at least two accumulation steps")
    if s[0] != 0:
        raise ValueError(f"accumulation must start at step 0, got {s[0]}")
    d = np.diff(s)
    if np.any(d <= 0):
        raise ValueError(f"steps must be strictly increasing, got {list(steps)}")
    return d


def deaccumulate(
    accum_mm: np.ndarray,
    steps: Sequence[int],
    *,
    negative_tolerance_mm: float = config.NEGATIVE_TOLERANCE_MM,
) -> Deaccumulated:
    """Convert cumulative total precipitation into a per-interval rain *rate*.

    Args:
        accum_mm: (n_steps, n_lat, n_lon) cumulative precipitation in millimetres.
        steps: the accumulation step values in hours, starting at 0.
        negative_tolerance_mm: decrements more negative than this are an error rather
            than GRIB packing noise.

    Returns:
        A `Deaccumulated` holding an (n_steps - 1, n_lat, n_lon) float32 rain rate in
        **mm/h**, plus clamping diagnostics.

    A rate is stored rather than an interval total so that one physical quantity spans
    the 3 h -> 6 h spacing change; the front end multiplies back up by each frame's
    interval length to show mm/3h or mm/6h.
    """
    accum = np.asarray(accum_mm)
    if accum.ndim != 3:
        raise ValueError(f"expected (step, lat, lon), got shape {accum.shape}")
    hours = interval_hours(steps)
    if accum.shape[0] != hours.size + 1:
        raise ValueError(
            f"{accum.shape[0]} accumulation fields do not match "
            f"{hours.size + 1} step values"
        )
    if np.isnan(accum).any():
        raise ValueError("NaNs present in accumulated precipitation")

    delta_mm = np.diff(accum, axis=0).astype(np.float64)

    worst = float(delta_mm.min()) if delta_mm.size else 0.0
    if worst < -negative_tolerance_mm:
        raise ValueError(
            f"accumulated precipitation decreased by {worst:.3g} mm, beyond the "
            f"{negative_tolerance_mm:.3g} mm packing tolerance "
            f"({worst / config.GRIB_PACKING_QUANTUM_MM:.1f} quanta) -- steps are "
            "probably out of order or mismatched"
        )

    negative = delta_mm < 0.0
    clamped_cells = int(negative.sum())
    raw_total = float(delta_mm.sum())
    np.clip(delta_mm, 0.0, None, out=delta_mm)
    clamped_total = float(delta_mm.sum())

    rate = delta_mm / hours[:, None, None]
    return Deaccumulated(
        rate_mm_h=rate.astype(np.float32, copy=False),
        clamped_cells=clamped_cells,
        clamped_fraction=clamped_cells / delta_mm.size if delta_mm.size else 0.0,
        worst_decrement_mm=worst,
        worst_decrement_quanta=worst / config.GRIB_PACKING_QUANTUM_MM,
        mass_added_fraction=(
            (clamped_total - raw_total) / clamped_total if clamped_total else 0.0
        ),
    )


def check_rates(
    rate_mm_h: np.ndarray,
    *,
    max_plausible: float = config.MAX_PLAUSIBLE_RATE_MM_H,
) -> dict[str, float]:
    """Quality gate on the finished field. Raises if the data is not publishable.

    Returns summary statistics for `meta.json`.
    """
    if np.isnan(rate_mm_h).any():
        raise ValueError("NaNs present in rain rate")
    if np.isinf(rate_mm_h).any():
        raise ValueError("infinities present in rain rate")

    lo = float(rate_mm_h.min())
    hi = float(rate_mm_h.max())
    if lo < 0.0:
        raise ValueError(f"negative rain rate present: {lo:.3g} mm/h")
    if hi > max_plausible:
        raise ValueError(
            f"implausible peak rain rate {hi:.1f} mm/h (ceiling {max_plausible}) -- "
            "check decoding and de-accumulation"
        )
    if hi == 0.0:
        raise ValueError("field is entirely dry, which means the data is wrong")

    return {
        "min_mm_h": lo,
        "max_mm_h": hi,
        "mean_mm_h": float(rate_mm_h.mean()),
        "wet_fraction": float((rate_mm_h > 0.1).mean()),
    }
