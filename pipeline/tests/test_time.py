"""Tests for run-time timezone handling.

`ecmwf.opendata.Client.latest()` returns naive datetimes that are already UTC. Treating
one as local time shifts the whole forecast by the machine's UTC offset -- on a laptop
in IST that is -5:30, which makes the app correct in UTC CI and wrong in development.
This was a real bug; these tests keep it fixed.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from precipitation import config, encode, fetch

IST = timezone(timedelta(hours=5, minutes=30))


def test_naive_run_time_is_treated_as_utc_not_local():
    naive = datetime(2026, 11, 12, 0, 0)
    assert fetch.ensure_utc(naive) == datetime(2026, 11, 12, 0, 0, tzinfo=timezone.utc)


def test_aware_run_time_is_converted_to_utc():
    ist_morning = datetime(2026, 11, 12, 5, 30, tzinfo=IST)
    assert fetch.ensure_utc(ist_morning) == datetime(
        2026, 11, 12, 0, 0, tzinfo=timezone.utc
    )


def test_ensure_utc_is_idempotent():
    aware = datetime(2026, 11, 12, 0, 0, tzinfo=timezone.utc)
    assert fetch.ensure_utc(fetch.ensure_utc(aware)) == aware


def test_client_date_is_naive_utc():
    """`ecmwf.opendata` compares the requested date against naive constants.

    Passing it an aware datetime raises "can't compare offset-naive and offset-aware
    datetimes". This only shows up on a cache miss, so it survived local testing and
    was caught by CI.
    """
    aware = datetime(2026, 11, 12, 0, 0, tzinfo=timezone.utc)
    client_date = fetch.as_client_date(aware)
    assert client_date.tzinfo is None
    assert client_date == datetime(2026, 11, 12, 0, 0)


def test_client_date_converts_before_stripping_the_zone():
    """An IST-aware 05:30 is 00:00 UTC, and must not be sent as a naive 05:30."""
    ist_morning = datetime(2026, 11, 12, 5, 30, tzinfo=IST)
    assert fetch.as_client_date(ist_morning) == datetime(2026, 11, 12, 0, 0)


def test_meta_records_the_run_hour_unshifted(tmp_path):
    """A 00Z run must be published as 00:00:00Z, not 18:30Z the previous day."""
    from precipitation import transform

    run_time = fetch.ensure_utc(datetime(2026, 11, 12, 0, 0))  # as latest() returns it
    steps = [0, 3]
    rate = np.zeros((1, config.NLAT, config.NLON), dtype=np.float32)
    rate[0, 0, 0] = 3.0
    deacc = transform.Deaccumulated(rate, 0, 0.0, 0.0, 0.0, 0.0)

    meta = encode.write_cube(
        deacc,
        model=config.IFS,
        run_time=run_time,
        steps=steps,
        valid_times=[run_time, run_time + timedelta(hours=3)],
        out_dir=tmp_path,
    )

    assert meta["run"]["datetime"] == "2026-11-12T00:00:00Z"
    assert meta["run"]["date"] == "20261112"
    assert meta["run"]["hour"] == "00"
    assert meta["frames"][0]["valid_time"] == "2026-11-12T03:00:00Z"


def test_naive_run_time_is_rejected_by_the_encoder(tmp_path):
    from precipitation import transform

    run_time = datetime(2026, 11, 12, 0, 0)  # naive: must not be accepted
    rate = np.zeros((1, config.NLAT, config.NLON), dtype=np.float32)
    rate[0, 0, 0] = 3.0
    with pytest.raises(ValueError, match="timezone-naive"):
        encode.write_cube(
            transform.Deaccumulated(rate, 0, 0.0, 0.0, 0.0, 0.0),
            model=config.IFS,
            run_time=run_time,
            steps=[0, 3],
            valid_times=[run_time, run_time + timedelta(hours=3)],
            out_dir=tmp_path,
        )
