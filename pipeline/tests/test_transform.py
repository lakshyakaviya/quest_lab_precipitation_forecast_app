"""Tests for de-accumulation and quality control.

The headline case is the IFS step-spacing change from 3 h to 6 h at T+144 h: dividing
every interval by a constant 3 would double the apparent rain rate for the whole second
half of the forecast.
"""

from __future__ import annotations

import numpy as np
import pytest

from precipitation import config, transform


def test_ifs_steps_span_day_10_with_the_spacing_change():
    steps = config.ifs_steps()
    assert steps[0] == 0
    assert steps[-1] == 240
    assert len(steps) == 65, "49 three-hourly values plus 16 six-hourly values"
    hours = transform.interval_hours(steps)
    assert len(hours) == 64, "65 accumulation values give 64 intervals"
    assert list(hours).count(3) == 48
    assert list(hours).count(6) == 16
    # The change happens exactly at T+144h.
    assert steps[48] == 144
    assert hours[47] == 3 and hours[48] == 6


def test_aifs_steps_are_uniformly_six_hourly():
    steps = config.aifs_steps()
    assert steps[0] == 0 and steps[-1] == 240
    hours = transform.interval_hours(steps)
    assert len(hours) == 40
    assert set(hours) == {6}


def test_rate_uses_each_intervals_own_length():
    """1 mm falling in every interval must give 1/3 mm/h then 1/6 mm/h, not a constant."""
    steps = [0, 3, 6, 144, 150, 156]
    # Cumulative millimetres: 1 mm added per interval.
    accum = np.zeros((len(steps), 2, 2), dtype=np.float32)
    for i in range(len(steps)):
        accum[i] = i * 1.0

    rate = transform.deaccumulate(accum, steps).rate_mm_h

    assert rate.shape == (5, 2, 2)
    expected_hours = [3, 3, 138, 6, 6]
    for i, hours in enumerate(expected_hours):
        np.testing.assert_allclose(rate[i], 1.0 / hours, rtol=1e-5)


def test_constant_divisor_bug_would_be_caught():
    """A 6 h interval must not be reported at the 3 h rate."""
    steps = [0, 3, 150]
    accum = np.array([[[0.0]], [[3.0]], [[9.0]]], dtype=np.float32)
    rate = transform.deaccumulate(accum, steps).rate_mm_h
    # 3 mm over 3 h = 1.0 mm/h; 6 mm over 147 h = 0.0408 mm/h.
    np.testing.assert_allclose(rate[0, 0, 0], 1.0, rtol=1e-5)
    np.testing.assert_allclose(rate[1, 0, 0], 6.0 / 147.0, rtol=1e-5)


def test_rate_is_millimetres_per_hour():
    """Input is already mm (decode normalises IFS metres and AIFS kg m-2)."""
    steps = [0, 1]
    accum = np.array([[[0.0]], [[25.0]]], dtype=np.float32)  # 25 mm in 1 h
    rate = transform.deaccumulate(accum, steps).rate_mm_h
    np.testing.assert_allclose(rate[0, 0, 0], 25.0, rtol=1e-5)


def test_unit_table_maps_both_models_to_millimetres():
    """IFS publishes metres; AIFS Single publishes kg m-2, which is already mm.

    Treating an AIFS field as metres overstates rainfall by 1000x. Measured ratio of
    AIFS to IFS accumulated tp at T+24 on the 2026-11-12 12Z run was 949.7.
    """
    assert config.UNITS_TO_MM["m"] == 1000.0
    assert config.UNITS_TO_MM["kg m**-2"] == 1.0


# --------------------------------------------------------------------------------------
# Packing noise. Open-data tp uses 12-bit grid_ccsds packing, so consecutive
# accumulations are independently quantised and a few cells genuinely decrease. Measured
# on the IFS 2026-11-12 00Z run, the worst decrement was exactly one quantum (2**-13 m)
# and 0.37% of cells were affected.
# --------------------------------------------------------------------------------------


def test_one_quantum_decrement_is_clamped_not_rejected():
    steps = [0, 3, 6]
    dip = config.GRIB_PACKING_QUANTUM_MM  # 0.122 mm, the real worst case
    accum = np.array([[[0.0]], [[5.0]], [[5.0 - dip]]], dtype=np.float64)
    result = transform.deaccumulate(accum, steps)
    assert result.rate_mm_h[1, 0, 0] == 0.0
    assert result.rate_mm_h.min() >= 0.0
    assert result.clamped_cells == 1
    assert result.worst_decrement_quanta == pytest.approx(-1.0, abs=1e-6)


def test_clamping_diagnostics_quantify_the_mass_added():
    steps = [0, 3, 6]
    # 10 mm then a one-quantum dip: clamping adds that quantum back.
    accum = np.array(
        [[[0.0]], [[10.0]], [[10.0 - config.GRIB_PACKING_QUANTUM_MM]]],
        dtype=np.float64,
    )
    result = transform.deaccumulate(accum, steps)
    assert result.clamped_fraction == pytest.approx(0.5)
    assert result.mass_added_fraction == pytest.approx(
        config.GRIB_PACKING_QUANTUM_MM / 10.0, rel=1e-6
    )


def test_a_clean_field_reports_no_clamping():
    steps = [0, 3, 6]
    accum = np.array([[[0.0]], [[2.0]], [[5.0]]], dtype=np.float64)
    result = transform.deaccumulate(accum, steps)
    assert result.clamped_cells == 0
    assert result.mass_added_fraction == 0.0


def test_real_decrease_beyond_tolerance_is_an_error():
    """A mis-ordered or mismatched step loses millimetres, not quanta."""
    steps = [0, 3, 6]
    accum = np.array([[[0.0]], [[10.0]], [[4.0]]], dtype=np.float32)
    with pytest.raises(ValueError, match="decreased"):
        transform.deaccumulate(accum, steps)


def test_tolerance_sits_between_packing_noise_and_real_faults():
    q = config.GRIB_PACKING_QUANTUM_MM
    # A real run showed a -2 quantum decrement, so one quantum is not enough headroom.
    assert config.NEGATIVE_TOLERANCE_MM > 2 * q
    assert config.NEGATIVE_TOLERANCE_MM < 1.0, "must stay below a millimetre"


def test_steps_must_start_at_zero():
    accum = np.zeros((2, 1, 1), dtype=np.float32)
    with pytest.raises(ValueError, match="start at step 0"):
        transform.deaccumulate(accum, [3, 6])


def test_steps_must_be_strictly_increasing():
    accum = np.zeros((3, 1, 1), dtype=np.float32)
    with pytest.raises(ValueError, match="strictly increasing"):
        transform.deaccumulate(accum, [0, 6, 6])


def test_field_count_must_match_step_count():
    accum = np.zeros((3, 1, 1), dtype=np.float32)
    with pytest.raises(ValueError, match="do not match"):
        transform.deaccumulate(accum, [0, 3])


def test_nans_in_input_are_rejected():
    accum = np.array([[[0.0]], [[np.nan]]], dtype=np.float32)
    with pytest.raises(ValueError, match="NaN"):
        transform.deaccumulate(accum, [0, 3])


def test_check_rates_returns_stats_for_a_plausible_field():
    rate = np.zeros((4, 10, 10), dtype=np.float32)
    rate[1, 5, 5] = 12.0
    stats = transform.check_rates(rate)
    assert stats["max_mm_h"] == pytest.approx(12.0)
    assert stats["min_mm_h"] == 0.0
    assert 0.0 < stats["wet_fraction"] < 1.0


def test_check_rates_rejects_implausible_peaks():
    rate = np.zeros((2, 4, 4), dtype=np.float32)
    rate[0, 0, 0] = 5000.0
    with pytest.raises(ValueError, match="implausible"):
        transform.check_rates(rate)


def test_check_rates_rejects_an_entirely_dry_field():
    with pytest.raises(ValueError, match="entirely dry"):
        transform.check_rates(np.zeros((2, 4, 4), dtype=np.float32))
