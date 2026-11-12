"""Command line entry point for the forecast pipeline.

    python -m precipitation.cli run --model ifs --out web/public/data
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import config, decode, encode, fetch, transform


def build(
    model: config.Model,
    *,
    out_dir: Path,
    run_time: datetime | None,
    use_cache: bool,
) -> dict:
    """Fetch, decode, de-accumulate and encode one model run."""
    run = fetch.fetch(model, run_time=run_time, use_cache=use_cache)
    accum_m, valid_times = decode.decode_window(run.path, model.steps)
    deacc = transform.deaccumulate(accum_m, model.steps)
    return encode.write_cube(
        deacc,
        model=model,
        run_time=run.run_time,
        steps=model.steps,
        valid_times=valid_times,
        out_dir=out_dir,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="precipitation",
        description="Build India precipitation cubes from ECMWF Open Data.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    run_cmd = sub.add_parser("run", help="build cubes for one or more models")
    run_cmd.add_argument(
        "--model",
        action="append",
        choices=sorted(config.MODELS),
        help="model to build; repeatable. Defaults to ifs.",
    )
    run_cmd.add_argument(
        "--out",
        type=Path,
        default=config.DEFAULT_OUT_DIR,
        help="output directory for the cube and metadata",
    )
    run_cmd.add_argument(
        "--date",
        help="run date as YYYYMMDD; defaults to the latest published run",
    )
    run_cmd.add_argument(
        "--time",
        type=int,
        choices=[0, 6, 12, 18],
        help="run hour UTC; required with --date",
    )
    run_cmd.add_argument(
        "--no-cache",
        action="store_true",
        help="ignore cached GRIB and re-download",
    )

    sub.add_parser("latest", help="report the newest published run for each model")

    args = parser.parse_args(argv)

    if args.command == "latest":
        for key in sorted(config.MODELS):
            model = config.MODELS[key]
            print(f"{key:6s} {fetch.latest_run(model):%Y-%m-%d %H}Z")
        return 0

    run_time: datetime | None = None
    if args.date:
        if args.time is None:
            parser.error("--time is required when --date is given")
        run_time = datetime.strptime(
            f"{args.date}{args.time:02d}", "%Y%m%d%H"
        ).replace(tzinfo=timezone.utc)
    elif args.time is not None:
        parser.error("--date is required when --time is given")

    keys = args.model or [config.IFS.key]
    out_dir: Path = args.out
    metas = []
    for key in keys:
        metas.append(
            build(
                config.MODELS[key],
                out_dir=out_dir,
                run_time=run_time,
                use_cache=not args.no_cache,
            )
        )
    encode.write_index(metas, out_dir)
    print(f"[cli] wrote {len(metas)} model(s) to {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
