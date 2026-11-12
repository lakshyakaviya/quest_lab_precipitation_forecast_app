"""Retrieve total precipitation from ECMWF Open Data.

Downloads every requested accumulation step for one model run into a single GRIB2 file
under `.cache/grib/`, so repeated local runs do not re-download ~33 MB.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from ecmwf.opendata import Client

from . import config


def ensure_utc(dt: datetime) -> datetime:
    """Attach UTC to a naive datetime; convert an aware one.

    `ecmwf.opendata.Client.latest()` returns **naive** datetimes that are already UTC.
    Calling `.astimezone(utc)` on those would reinterpret them as local time -- on a
    machine in IST that silently shifts every run by -5:30, so the app would be correct
    in UTC CI and wrong on a developer's laptop. Run times are normalised here, at the
    boundary where they enter the pipeline.
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def as_client_date(dt: datetime) -> datetime:
    """Strip the timezone back off for `ecmwf.opendata`.

    The client compares the requested date against naive module constants, so handing
    it a timezone-aware datetime raises
    `TypeError: can't compare offset-naive and offset-aware datetimes`. We keep aware
    datetimes everywhere in our own code and convert only at this boundary.
    """
    return ensure_utc(dt).replace(tzinfo=None)


@dataclass(frozen=True)
class Run:
    """An identified model run and the local GRIB file holding its precipitation."""

    model_key: str
    run_time: datetime
    path: Path

    @property
    def date_str(self) -> str:
        return self.run_time.strftime("%Y%m%d")

    @property
    def time_str(self) -> str:
        return self.run_time.strftime("%H")


def _client(model: config.Model) -> Client:
    return Client(
        source="ecmwf", model=model.opendata_model, resol=config.RESOLUTION
    )


def latest_run(model: config.Model) -> datetime:
    """Date/time of the most recent run that reaches this model's full horizon.

    IFS HRES only runs to T+90h at 06z and 18z; the day-15 forecast exists only at 00z
    and 12z. A plain `latest()` therefore returns a short run whose later steps 404.
    Asking for the newest run that *has* the final step pins the result to a long run
    without hardcoding which cycles those are.
    """
    return ensure_utc(
        _client(model).latest(
            stream=model.stream,
            type=model.type,
            param=config.PARAM,
            step=model.steps[-1],
        )
    )


def fetch(
    model: config.Model,
    *,
    run_time: datetime | None = None,
    cache_dir: Path | None = None,
    use_cache: bool = True,
    attempts: int = 4,
) -> Run:
    """Download `tp` for every step of one run.

    ECMWF publishes data 7-9 hours after the nominal run time, so `latest()` is used to
    resolve the newest *complete* run rather than assuming one. Transient failures are
    retried with exponential backoff; the open-data portal caps concurrent connections
    and occasionally refuses.
    """
    cache_dir = cache_dir or config.CACHE_DIR
    client = _client(model)
    run_time = ensure_utc(run_time) if run_time else latest_run(model)

    target = cache_dir / (
        f"{model.key}_{run_time.strftime('%Y%m%d%H')}_tp.grib2"
    )
    target.parent.mkdir(parents=True, exist_ok=True)

    if use_cache and target.exists() and target.stat().st_size > 0:
        print(f"[fetch] cache hit: {target} ({target.stat().st_size:,} bytes)")
        return Run(model.key, run_time, target)

    partial = target.with_suffix(".partial")
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            print(
                f"[fetch] {model.key} {run_time:%Y-%m-%d %H}Z "
                f"{len(model.steps)} steps (attempt {attempt}/{attempts})"
            )
            client.retrieve(
                date=as_client_date(run_time),
                stream=model.stream,
                type=model.type,
                param=config.PARAM,
                step=list(model.steps),
                target=str(partial),
            )
            partial.replace(target)
            print(f"[fetch] wrote {target} ({target.stat().st_size:,} bytes)")
            return Run(model.key, run_time, target)
        except Exception as exc:  # noqa: BLE001 - retried and re-raised below
            last_error = exc
            partial.unlink(missing_ok=True)
            if attempt == attempts:
                break
            backoff = 2**attempt
            print(f"[fetch] failed ({exc}); retrying in {backoff}s")
            time.sleep(backoff)

    raise RuntimeError(
        f"could not retrieve {model.key} {run_time:%Y-%m-%d %H}Z after "
        f"{attempts} attempts"
    ) from last_error
