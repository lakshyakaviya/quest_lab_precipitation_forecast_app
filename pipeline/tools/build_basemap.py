"""Build the app's self-contained basemap from Natural Earth data.

Run once (or whenever the boundaries need refreshing); the output is committed as a
static asset so the deployed app depends on no external tile server.

    python pipeline/tools/build_basemap.py <natural_earth_dir> <output.json>

Inputs (download from https://github.com/nvkelso/natural-earth-vector/tree/master/geojson):
    ne_50m_admin_0_countries.geojson
    ne_50m_admin_1_states_provinces.geojson

Natural Earth is public domain (CC0). Administrative boundaries as rendered here are
Natural Earth's depiction and are not an authoritative statement on any border.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

# A little wider than the data window so the map has context at the edges.
PAD = 2.0
LON_MIN, LON_MAX = 65.0 - PAD, 100.0 + PAD
LAT_MIN, LAT_MAX = 5.0 - PAD, 40.0 + PAD
CLIP = box(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX)

# ~2 km: far finer than the 0.25 degree (~28 km) forecast grid it sits under.
SIMPLIFY_DEG = 0.02
COORD_DECIMALS = 3  # ~110 m


def _round_coords(obj):
    """Recursively round coordinate numbers to shrink the JSON payload."""
    if isinstance(obj, (int, float)):
        return round(float(obj), COORD_DECIMALS)
    if isinstance(obj, (list, tuple)):
        return [_round_coords(v) for v in obj]
    return obj


def _prepare(geom):
    """Clip to the map window and simplify. Returns None if nothing remains."""
    if geom.is_empty:
        return None
    clipped = geom.intersection(CLIP)
    if clipped.is_empty:
        return None
    simplified = clipped.simplify(SIMPLIFY_DEG, preserve_topology=True)
    return None if simplified.is_empty else simplified


def _feature(geom, props):
    g = mapping(geom)
    g["coordinates"] = _round_coords(g["coordinates"])
    return {"type": "Feature", "properties": props, "geometry": g}


def _load(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)["features"]


def _prop(props: dict, *names: str, default: str = "") -> str:
    for n in names:
        value = props.get(n)
        if value:
            return str(value)
    return default


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    src = Path(argv[0])
    out = Path(argv[1])

    countries = _load(src / "ne_50m_admin_0_countries.geojson")
    states = _load(src / "ne_50m_admin_1_states_provinces.geojson")

    land_parts = []
    country_features = []
    for feat in countries:
        geom = _prepare(shape(feat["geometry"]))
        if geom is None:
            continue
        props = feat["properties"]
        land_parts.append(geom)
        country_features.append(
            _feature(
                geom,
                {
                    "name": _prop(props, "NAME", "name"),
                    "iso": _prop(props, "ADM0_A3", "adm0_a3"),
                },
            )
        )

    state_features = []
    for feat in states:
        props = feat["properties"]
        if _prop(props, "adm0_a3", "ADM0_A3").upper() != "IND":
            continue
        geom = _prepare(shape(feat["geometry"]))
        if geom is None:
            continue
        state_features.append(
            _feature(geom, {"name": _prop(props, "name", "NAME")})
        )

    # One dissolved landmass for a single clean coastline stroke and land fill.
    land = _prepare(unary_union(land_parts))

    payload = {
        "bbox": [LON_MIN, LAT_MIN, LON_MAX, LAT_MAX],
        "attribution": "Boundaries: Natural Earth (public domain)",
        "note": (
            "Administrative boundaries are Natural Earth's depiction and are not an "
            "authoritative statement on any border."
        ),
        "land": {
            "type": "FeatureCollection",
            "features": [_feature(land, {})] if land else [],
        },
        "countries": {"type": "FeatureCollection", "features": country_features},
        "india_states": {"type": "FeatureCollection", "features": state_features},
    }

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(
        f"wrote {out} ({out.stat().st_size:,} bytes): "
        f"{len(country_features)} countries, {len(state_features)} Indian states"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
