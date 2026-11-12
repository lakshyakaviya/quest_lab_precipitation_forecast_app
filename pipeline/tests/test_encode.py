"""Tests for the India window selection and the cube/meta file contract."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from precipitation import config, encode, transform


def _global_lats() -> np.ndarray:
    return 90.0 - np.arange(config.GLOBAL_NLAT) * config.GRID_DEG


def _lons_from(first: float) -> np.ndarray:
    return first + np.arange(config.GLOBAL_NLON) * config.GRID_DEG


# --------------------------------------------------------------------------------------
# Window selection
# --------------------------------------------------------------------------------------
# ECMWF open data stores its 0.25 degree fields starting at longitude 180, so cfgrib
# presents them as -180..179.75. An earlier draft of this pipeline assumed 0..359.75 and
# would have silently extracted the eastern Pacific. Both conventions are tested.


@pytest.mark.parametrize("lon_first", [-180.0, 0.0])
def test_window_lands_on_india_in_either_longitude_convention(lon_first):
    lats = _global_lats()
    lons = _lons_from(lon_first)
    lat_s, lon_s = config.window_slices(lats, lons)

    assert lats[lat_s].size == config.NLAT == 141
    assert lons[lon_s].size == config.NLON == 141
    assert lats[lat_s][0] == config.LAT_MAX == 40.0
    assert lats[lat_s][-1] == config.LAT_MIN == 5.0
    assert lons[lon_s][0] == config.LON_MIN == 65.0
    assert lons[lon_s][-1] == config.LON_MAX == 100.0


def test_window_index_differs_between_conventions():
    """Guards the specific bug: 65E is column 980 in the real data, not column 260."""
    lats = _global_lats()
    _, lon_native = config.window_slices(lats, _lons_from(-180.0))
    _, lon_zero = config.window_slices(lats, _lons_from(0.0))
    assert lon_native.start == 980
    assert lon_zero.start == 260


def test_window_rejects_a_south_first_latitude_axis():
    lats = -90.0 + np.arange(config.GLOBAL_NLAT) * config.GRID_DEG
    with pytest.raises(ValueError, match="north -> south"):
        config.window_slices(lats, _lons_from(-180.0))


def test_window_rejects_an_unexpected_grid_size():
    with pytest.raises(ValueError, match="unexpected global grid"):
        config.window_slices(_global_lats()[:100], _lons_from(-180.0))


# --------------------------------------------------------------------------------------
# Cube encoding
# --------------------------------------------------------------------------------------


def test_expected_cube_size_for_ifs():
    """The documented figure: 64 frames x 141 x 141 x 2 bytes."""
    assert config.IFS.n_frames == 64
    assert encode.cube_bytes(config.IFS.n_frames) == 2_544_768


def _deacc(rate: np.ndarray) -> transform.Deaccumulated:
    """Wrap a bare rate field as if it came from de-accumulation with no clamping."""
    return transform.Deaccumulated(
        rate_mm_h=rate,
        clamped_cells=0,
        clamped_fraction=0.0,
        worst_decrement_m=0.0,
        worst_decrement_quanta=0.0,
        mass_added_fraction=0.0,
    )


def _write(tmp_path, steps, rate):
    run_time = datetime(2026, 11, 12, 6, tzinfo=timezone.utc)
    valid_times = [run_time + timedelta(hours=s) for s in steps]
    return encode.write_cube(
        _deacc(rate),
        model=config.IFS,
        run_time=run_time,
        steps=steps,
        valid_times=valid_times,
        out_dir=tmp_path,
    )


def test_cube_round_trips_through_float16(tmp_path):
    rng = np.random.default_rng(0)
    steps = [0, 3, 6, 9]
    rate = (rng.random((3, config.NLAT, config.NLON)) * 20.0).astype(np.float32)

    meta = _write(tmp_path, steps, rate)

    cube_path = tmp_path / meta["cube"]["file"]
    assert cube_path.stat().st_size == encode.cube_bytes(3)
    read_back = np.frombuffer(cube_path.read_bytes(), dtype="<f2").reshape(
        3, config.NLAT, config.NLON
    )
    # float16 keeps ~3 decimal digits; well inside what a rain rate needs.
    np.testing.assert_allclose(read_back, rate, rtol=1e-3, atol=1e-3)


def test_meta_describes_frames_by_interval_end(tmp_path):
    steps = [0, 3, 6, 144, 150]
    rate = np.zeros((4, config.NLAT, config.NLON), dtype=np.float32)
    rate[0, 0, 0] = 5.0

    meta = _write(tmp_path, steps, rate)

    assert meta["cube"]["n_frames"] == 4 == len(steps) - 1
    assert meta["cube"]["units"] == "mm/h"
    assert meta["cube"]["layout"] == "[frame][lat][lon]"
    frames = meta["frames"]
    assert [f["hours"] for f in frames] == [3, 3, 138, 6]
    assert [f["step_end"] for f in frames] == [3, 6, 144, 150]
    # Run is 2026-11-12 06Z, so the first frame is valid at 09Z.
    assert frames[0]["valid_time"] == "2026-11-12T09:00:00Z"
    assert frames[-1]["valid_time"] == "2026-11-18T12:00:00Z"


def test_meta_records_north_first_row_order(tmp_path):
    steps = [0, 3]
    rate = np.zeros((1, config.NLAT, config.NLON), dtype=np.float32)
    rate[0, 0, 0] = 1.0
    meta = _write(tmp_path, steps, rate)
    grid = meta["grid"]
    assert grid["lat_first"] == 40.0
    assert grid["lat_last"] == 5.0
    assert grid["lat_step"] == -0.25
    assert grid["lon_first"] == 65.0
    assert grid["lon_step"] == 0.25


def test_frame_count_must_match_steps(tmp_path):
    rate = np.ones((5, config.NLAT, config.NLON), dtype=np.float32)
    with pytest.raises(ValueError, match="do not match"):
        _write(tmp_path, [0, 3, 6], rate)


def test_wrong_frame_shape_is_rejected(tmp_path):
    rate = np.ones((1, 10, 10), dtype=np.float32)
    with pytest.raises(ValueError, match="expected frames of"):
        _write(tmp_path, [0, 3], rate)


def test_meta_reports_deaccumulation_clamping(tmp_path):
    """Clamping negative rainfall adds mass, so meta.json must disclose how much."""
    steps = [0, 3]
    rate = np.zeros((1, config.NLAT, config.NLON), dtype=np.float32)
    rate[0, 0, 0] = 4.0
    run_time = datetime(2026, 11, 12, 0, tzinfo=timezone.utc)
    deacc = transform.Deaccumulated(
        rate_mm_h=rate,
        clamped_cells=4742,
        clamped_fraction=0.003727,
        worst_decrement_m=-config.GRIB_PACKING_QUANTUM_M,
        worst_decrement_quanta=-1.0,
        mass_added_fraction=0.000693,
    )

    meta = encode.write_cube(
        deacc,
        model=config.IFS,
        run_time=run_time,
        steps=steps,
        valid_times=[run_time, run_time + timedelta(hours=3)],
        out_dir=tmp_path,
    )

    d = meta["deaccumulation"]
    assert d["clamped_cells"] == 4742
    assert d["worst_decrement_quanta"] == pytest.approx(-1.0)
    assert d["mass_added_fraction"] == pytest.approx(0.000693)
    assert d["packing_quantum_m"] == pytest.approx(2.0**-13)


def test_index_lists_every_model(tmp_path):
    steps = [0, 3]
    rate = np.zeros((1, config.NLAT, config.NLON), dtype=np.float32)
    rate[0, 0, 0] = 2.0
    meta = _write(tmp_path, steps, rate)

    encode.write_index([meta], tmp_path)

    index = json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))
    assert [m["key"] for m in index["models"]] == ["ifs"]
    assert index["models"][0]["cube"] == "ifs.f16"
    assert index["source"]["licence"] == "CC BY 4.0"
