"""Tests for the two-model setup and run alignment.

Comparing a physics forecast against an AI forecast only means anything if both start
from the same analysis. They are not published together, so the alignment logic is the
thing that keeps the comparison honest.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from precipitation import config, fetch, transform


def test_aifs_is_uniformly_six_hourly_to_day_ten():
    assert config.AIFS.steps[0] == 0
    assert config.AIFS.steps[-1] == config.MAX_STEP_H == 240
    assert config.AIFS.n_frames == 40
    assert set(transform.interval_hours(config.AIFS.steps)) == {6}


def test_the_two_models_have_different_frame_counts():
    """They are deliberately not resampled to match; the UI aligns them instead."""
    assert config.IFS.n_frames == 64
    assert config.AIFS.n_frames == 40
    assert config.IFS.steps[-1] == config.AIFS.steps[-1]


def test_models_registry_round_trips_keys():
    for key, model in config.MODELS.items():
        assert model.key == key
        assert model.opendata_model
        assert model.n_frames == len(model.steps) - 1


def _patch_latest(monkeypatch, mapping: dict[str, datetime]):
    monkeypatch.setattr(fetch, "latest_run", lambda m: mapping[m.key])


def test_common_run_takes_the_earliest_latest(monkeypatch):
    """AIFS is released sooner, so the shared run is the one IFS has reached."""
    _patch_latest(
        monkeypatch,
        {
            "ifs": datetime(2026, 11, 12, 12, tzinfo=timezone.utc),
            "aifs": datetime(2026, 11, 13, 0, tzinfo=timezone.utc),
        },
    )
    assert fetch.common_run([config.IFS, config.AIFS]) == datetime(
        2026, 11, 12, 12, tzinfo=timezone.utc
    )


def test_common_run_is_order_independent(monkeypatch):
    _patch_latest(
        monkeypatch,
        {
            "ifs": datetime(2026, 11, 12, 12, tzinfo=timezone.utc),
            "aifs": datetime(2026, 11, 13, 0, tzinfo=timezone.utc),
        },
    )
    assert fetch.common_run([config.AIFS, config.IFS]) == fetch.common_run(
        [config.IFS, config.AIFS]
    )


def test_common_run_of_a_single_model_is_its_own_latest(monkeypatch):
    when = datetime(2026, 11, 12, 0, tzinfo=timezone.utc)
    _patch_latest(monkeypatch, {"ifs": when})
    assert fetch.common_run([config.IFS]) == when


def test_common_run_rejects_an_empty_model_list():
    with pytest.raises(ValueError, match="no models"):
        fetch.common_run([])
