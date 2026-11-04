"""Facility data access, backed by public/data/ built by scripts/build_data.py
from CMS Hospital General Information + Medicare Inpatient by Provider and
Service + the Census ZCTA gazetteer.

Loads every public/data/states/{ST}.json present, so adding a new state is
just running the build script again with --states and committing the result
-- nothing here needs to change. A facility with no DRG charges yet still
appears in search results; estimate_cost just returns an error for it.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATES_DIR = ROOT / "public" / "data" / "states"
ZIPS_PATH = ROOT / "public" / "data" / "zip_centroids.json"


def _load_facilities() -> list[dict]:
    out = []
    for path in sorted(STATES_DIR.glob("*.json")):
        out.extend(json.loads(path.read_text(encoding="utf-8"))["facilities"])
    return out


_FACILITIES = _load_facilities()
_ZIPS = json.loads(ZIPS_PATH.read_text(encoding="utf-8")) if ZIPS_PATH.exists() else {}
_BY_CCN = {f["ccn"]: f for f in _FACILITIES}


def facility_by_ccn(ccn: str) -> dict | None:
    return _BY_CCN.get(ccn)


def zip_centroid(zip_code: str) -> dict | None:
    return _ZIPS.get(zip_code)


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 3958.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def facilities_near(zip_code: str, radius_miles: float = 15, types: list[str] | None = None) -> list[dict]:
    """Facilities within radius_miles of a zip code centroid, nearest first.

    types filters on the facility "type" field (e.g. "acute_care_hospital",
    "fqhc"); omit for all types.
    """
    center = zip_centroid(zip_code)
    if center is None:
        return []
    out = []
    for f in _FACILITIES:
        if types and f["type"] not in types:
            continue
        if f.get("lat") is None or f.get("lon") is None:
            continue
        dist = haversine_miles(center["lat"], center["lon"], f["lat"], f["lon"])
        if dist <= radius_miles:
            out.append({**f, "distance_miles": round(dist, 1)})
    return sorted(out, key=lambda f: f["distance_miles"])


def nearest_fqhc(zip_code: str, radius_miles: float = 25) -> dict | None:
    matches = facilities_near(zip_code, radius_miles=radius_miles, types=["fqhc"])
    return matches[0] if matches else None


def facilities_with_drg(zip_code: str, drg: str, radius_miles: float = 25) -> list[dict]:
    """Facilities within radius_miles that have billed-charge data for a given
    DRG, nearest first. Most facilities only report a handful of DRGs (CMS
    only publishes ones with enough Medicare discharge volume), so this
    exists specifically to avoid an agent guessing facility-by-facility with
    estimate_cost -- one deterministic lookup instead of N blind tries.
    """
    return [f for f in facilities_near(zip_code, radius_miles=radius_miles) if drg in f.get("drg_charges", {})]
