"""Build public/data/fqhc_sites.json from HRSA's health center site list.

Usage:
    python scripts/build_fqhc.py

Source: HRSA Data Warehouse, "Health Center Service Delivery and Look-Alike
Sites" (public, already geocoded by HRSA). Keeps only permanent,
public-facing clinic sites in the 50 states + DC, the same coverage as the
hospital data. School-based, mobile, seasonal, administrative and
correctional/nursing-home sites are left out because they aren't open to the
general public year-round at a fixed address. Dental-only sites (by name)
are left out too, since CareMap is about hospital and medical costs.
"""
from __future__ import annotations

import csv
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from textcase import apply_display_case  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "data" / "fqhc_sites.json"
STATES_INDEX = ROOT / "public" / "data" / "states" / "index.json"
SOURCE_URL = "https://data.hrsa.gov/DataDownload/DD_Files/Health_Center_Service_Delivery_and_LookAlike_Sites.csv"
PUBLIC_SETTINGS = {"All Other Clinic Types", "Unknown", "Hospital"}
# HRSA's site list has no service-type field, so dental-only sites are
# recognized by name: "dental"/"dentistry" with no sign of medical care.
DENTAL = re.compile(r"\bDENT(AL|ISTRY)\b", re.I)
MEDICAL = re.compile(r"MEDICAL|PRIMARY|PEDIATRIC|FAMILY MEDICINE|FAMILY PRACTICE", re.I)


# Fields every site shares; written once per file and merged back by readers
# (caremap/data.py, src/hooks/useCareMapData.ts).
DEFAULTS = {"type": "fqhc", "ownership": "Federally Qualified Health Center", "has_er": False,
            "star_rating": None, "drg_charges": {}, "charity_care_participant": False}


def slim_sites(sites: list[dict], defaults: dict) -> list[dict]:
    """Drop per-site fields equal to the file-level defaults (readers merge
    them back), with names and places in readable case."""
    return [{k: v for k, v in apply_display_case(dict(s)).items() if k not in defaults or s[k] != defaults[k]} for s in sites]

def load_rows() -> list[dict]:
    path = RAW / "hrsa_sites.csv"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(SOURCE_URL, timeout=300) as resp:
            path.write_bytes(resp.read())
    text = path.read_bytes().decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


def main() -> None:
    states = set(json.loads(STATES_INDEX.read_text(encoding="utf-8")))
    sites = []
    for r in load_rows():
        x, y = r["Geocoding Artifact Address Primary X Coordinate"], r["Geocoding Artifact Address Primary Y Coordinate"]
        if (
            r["Site Status Description"] != "Active"
            or r["Health Center Location Type Description"] != "Permanent"
            or r["Health Center Type Description"] == "Administrative"
            or r["Health Center Service Delivery Site Location Setting Description"] not in PUBLIC_SETTINGS
            or r["Site State Abbreviation"] not in states
            or not x
            or not y
            or (DENTAL.search(r["Site Name"]) and not MEDICAL.search(r["Site Name"]))
        ):
            continue
        lookalike = "Look-Alike" in r["Health Center Type"]
        sites.append({
            "ccn": r["BPHC Assigned Number"],
            "name": r["Site Name"].strip(),
            "type": "fqhc",
            "ownership": "FQHC Look-Alike" if lookalike else "Federally Qualified Health Center",
            "operator": r["Health Center Name"].strip(),
            "has_er": False,
            "star_rating": None,
            "address": r["Site Address"].strip(),
            "city": r["Site City"].strip(),
            "state": r["Site State Abbreviation"],
            "zip": r["Site Postal Code"][:5],
            "county": r["County Equivalent Name"].strip(),
            "phone": r["Site Telephone Number"].strip(),
            "website": r["Site Web Address"].strip(),
            "lat": round(float(y), 6),
            "lon": round(float(x), 6),
            "drg_charges": {},
            "charity_care_participant": False,
        })
    OUT.write_text(json.dumps({"source": SOURCE_URL, "defaults": DEFAULTS, "sites": slim_sites(sites, DEFAULTS)},
                              separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT} ({len(sites)} sites)", file=sys.stderr)


if __name__ == "__main__":
    main()
