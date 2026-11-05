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
FQHC_PATH = ROOT / "public" / "data" / "fqhc_sites.json"
URGENT_CARE_PATH = ROOT / "public" / "data" / "urgent_care_sites.json"
DRG_DESCRIPTIONS_PATH = ROOT / "public" / "data" / "drg_descriptions.json"
# Clinic-type layers: only returned when asked for by type (there are many).
CLINIC_TYPES = {"fqhc", "urgent_care"}


def _with_defaults(data: dict) -> list[dict]:
    """Site files store shared fields once, under "defaults"."""
    defaults = data.get("defaults", {})
    return [{**defaults, **s} for s in data["sites"]]


def _load_facilities() -> list[dict]:
    out = []
    for path in sorted(STATES_DIR.glob("*.json")):
        if path.stem == "index":  # build_data.py's state-list manifest, not facility data
            continue
        out.extend(json.loads(path.read_text(encoding="utf-8"))["facilities"])
    if FQHC_PATH.exists():  # HRSA health center sites, built by scripts/build_fqhc.py
        out.extend(_with_defaults(json.loads(FQHC_PATH.read_text(encoding="utf-8"))))
    if URGENT_CARE_PATH.exists():  # NPI registry urgent care sites, built by scripts/build_urgent_care.py
        out.extend(_with_defaults(json.loads(URGENT_CARE_PATH.read_text(encoding="utf-8"))))
    return out


_FACILITIES = _load_facilities()
_ZIPS = json.loads(ZIPS_PATH.read_text(encoding="utf-8")) if ZIPS_PATH.exists() else {}
_BY_CCN = {f["ccn"]: f for f in _FACILITIES}
_DRG_DESCRIPTIONS = json.loads(DRG_DESCRIPTIONS_PATH.read_text(encoding="utf-8")) if DRG_DESCRIPTIONS_PATH.exists() else {}


def drg_description(drg: str) -> str | None:
    return _DRG_DESCRIPTIONS.get(drg)


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
    "fqhc", "urgent_care"). Omitted, it means every hospital type but not
    FQHC or urgent care sites: there are many thousands of those, and a city
    can have dozens within a few miles, so they're only returned by name.
    """
    center = zip_centroid(zip_code)
    if center is None:
        return []
    out = []
    for f in _FACILITIES:
        if (f["type"] not in types) if types else f["type"] in CLINIC_TYPES:
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


def nearest_urgent_care(zip_code: str, radius_miles: float = 25) -> dict | None:
    matches = facilities_near(zip_code, radius_miles=radius_miles, types=["urgent_care"])
    return matches[0] if matches else None


def facilities_with_drg(zip_code: str, drg: str, radius_miles: float = 25) -> list[dict]:
    """Facilities within radius_miles that have billed-charge data for a given
    DRG, nearest first. Most facilities only report a handful of DRGs (CMS
    only publishes ones with enough Medicare discharge volume), so this
    exists specifically to avoid an agent guessing facility-by-facility with
    estimate_cost -- one deterministic lookup instead of N blind tries.
    """
    return [f for f in facilities_near(zip_code, radius_miles=radius_miles) if drg in f.get("drg_charges", {})]
