"""Build public/data/urgent_care_sites.json from the federal NPI registry.

Usage:
    python scripts/build_urgent_care.py
    python scripts/build_urgent_care.py --retry-approximate   # re-geocode zip-centroid fallbacks only

Source: the NPPES NPI Registry API (npiregistry.cms.hhs.gov). Keeps active
organizations (NPI-2) whose PRIMARY taxonomy is 261QU0200X, "Clinic/Center,
Urgent Care", at a practice location in the 50 states + DC, one record per
practice address. Registry listings are self-reported, so this is "listed
as urgent care", not a verified list of walk-in clinics.

The API returns at most 1,200 results per query, so a state that hits the
cap is re-queried by 3-digit ZIP prefix.
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_data  # noqa: E402  (reuses the Census geocoder and zip centroids)

ROOT = build_data.ROOT
RAW_CACHE = build_data.RAW / "nppes_urgent_care.json"
OUT = ROOT / "public" / "data" / "urgent_care_sites.json"
API = "https://npiregistry.cms.hhs.gov/api/"
TAXONOMY = "261QU0200X"
PAGE, MAX_SKIP = 200, 1000
# Fields every site shares; written once per file and merged back by readers.
DEFAULTS = {"type": "urgent_care", "ownership": "Urgent care (federal NPI registry listing)", "has_er": False,
            "star_rating": None, "county": "", "drg_charges": {}, "charity_care_participant": False}


def slim_sites(sites: list[dict], defaults: dict) -> list[dict]:
    """Drop per-site fields equal to the file-level defaults (readers merge them back)."""
    return [{k: v for k, v in s.items() if k not in defaults or s[k] != defaults[k]} for s in sites]


def _query(**params) -> list[dict]:
    """Every result for one query (up to the API's 1,200 cap)."""
    out = []
    for skip in range(0, MAX_SKIP + 1, PAGE):
        q = {"version": "2.1", "enumeration_type": "NPI-2", "taxonomy_description": "Urgent Care",
             "limit": PAGE, "skip": skip, **params}
        url = f"{API}?{urllib.parse.urlencode(q)}"
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=60) as resp:
                    page = json.loads(resp.read()).get("results", [])
                break
            except Exception:  # transient network / 5xx: back off and retry
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))
        out.extend(page)
        if len(page) < PAGE:
            break
        time.sleep(0.15)
    return out


def _zip3_prefixes(state: str) -> list[str]:
    """3-digit ZIP prefixes seen for a state in CareMap's own hospital and clinic data."""
    prefixes = set()
    for f in json.loads((ROOT / "public" / "data" / "states" / f"{state}.json").read_text())["facilities"]:
        prefixes.add(f["zip"][:3])
    fqhc = ROOT / "public" / "data" / "fqhc_sites.json"
    if fqhc.exists():
        prefixes |= {s["zip"][:3] for s in json.loads(fqhc.read_text())["sites"] if s["state"] == state}
    return sorted(p for p in prefixes if len(p) == 3)


def fetch_all(states: list[str]) -> dict[str, dict]:
    if RAW_CACHE.exists():
        return json.loads(RAW_CACHE.read_text())
    by_npi: dict[str, dict] = {}
    for st in states:
        results = _query(state=st)
        if len(results) >= MAX_SKIP + PAGE:  # hit the cap: split by ZIP prefix
            results = [r for p in _zip3_prefixes(st) for r in _query(state=st, postal_code=f"{p}*")]
        for r in results:
            by_npi[r["number"]] = r
        print(f"  {st}: {len(results)} results, {len(by_npi)} unique so far", file=sys.stderr)
    RAW_CACHE.parent.mkdir(parents=True, exist_ok=True)
    RAW_CACHE.write_text(json.dumps(by_npi))
    return by_npi


def _clean(s: str) -> str:
    return (s or "").replace('"', "").strip()


def to_sites(by_npi: dict[str, dict], states: set[str]) -> list[dict]:
    sites, seen = [], set()
    for npi, r in by_npi.items():
        if r.get("basic", {}).get("status") != "A":
            continue
        if not any(t["code"] == TAXONOMY and t.get("primary") for t in r.get("taxonomies", [])):
            continue
        loc = next((a for a in r.get("addresses", []) if a["address_purpose"] == "LOCATION"), None)
        if loc is None or loc.get("state") not in states or loc.get("country_code") != "US":
            continue
        street = _clean(loc.get("address_1"))
        if re.match(r"^(P\.?\s*O\.?\s*BOX|POST OFFICE BOX)\b", street, re.I):
            continue
        zip5 = (loc.get("postal_code") or "")[:5]
        key = (re.sub(r"[^A-Z0-9]", "", street.upper()), zip5)
        if key in seen:
            continue
        seen.add(key)
        sites.append({
            "ccn": f"NPI-{npi}",
            "name": _clean(r["basic"].get("organization_name")),
            "type": "urgent_care",
            "ownership": "Urgent care (federal NPI registry listing)",
            "has_er": False,
            "star_rating": None,
            "address": street,
            "city": _clean(loc.get("city")).title(),
            "state": loc["state"],
            "zip": zip5,
            "county": "",
            "phone": _clean(loc.get("telephone_number")),
            "drg_charges": {},
            "charity_care_participant": False,
        })
    return sites


def _geocode_chunk(chunk: list[dict], zip_centroids: dict[str, dict]) -> bool:
    try:
        build_data._geocode_batch(chunk, zip_centroids)
        return True
    except Exception as exc:
        print(f"  batch of {len(chunk)} failed ({exc})", file=sys.stderr)
        return False


def geocode(sites: list[dict], zip_centroids: dict[str, dict]) -> None:
    """Census batch geocoding in 1,000-row chunks. The service often 502s or
    times out on big batches, so a failed chunk is retried as 250-row pieces
    after a pause; only pieces that still fail fall back to zip centroids."""
    for i in range(0, len(sites), 1000):
        chunk = sites[i : i + 1000]
        print(f"  geocoding {i + 1}-{i + len(chunk)} of {len(sites)}...", file=sys.stderr)
        if _geocode_chunk(chunk, zip_centroids):
            continue
        for j in range(0, len(chunk), 250):
            piece = chunk[j : j + 250]
            time.sleep(5)
            if not _geocode_chunk(piece, zip_centroids):
                for s in piece:  # geocoder down: keep the site, approximately placed
                    c = zip_centroids.get(s["zip"])
                    if c:
                        s["lat"], s["lon"], s["lat_lon_approximate"] = c["lat"], c["lon"], True


def retry_approximate() -> None:
    """Re-geocode only the sites a flaky earlier run left at their zip centroid."""
    data = json.loads(OUT.read_text())
    data["sites"] = [{**data.get("defaults", {}), **s} for s in data["sites"]]
    approx = [s for s in data["sites"] if s.get("lat_lon_approximate")]
    for s in approx:
        s.pop("lat_lon_approximate", None)
    print(f"  retrying {len(approx)} approximately placed sites", file=sys.stderr)
    geocode(approx, build_data.build_zip_centroids())
    data["defaults"] = DEFAULTS
    data["sites"] = slim_sites(data["sites"], DEFAULTS)
    OUT.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    left = sum(1 for s in data["sites"] if s.get("lat_lon_approximate"))
    print(f"Wrote {OUT} ({len(data['sites'])} sites, {left} still approximate)", file=sys.stderr)


def main() -> None:
    if "--retry-approximate" in sys.argv:
        retry_approximate()
        return
    states = json.loads((ROOT / "public" / "data" / "states" / "index.json").read_text())
    sites = to_sites(fetch_all(states), set(states))
    geocode(sites, build_data.build_zip_centroids())
    sites = [s for s in sites if s.get("lat") is not None]
    OUT.write_text(json.dumps({"source": API, "taxonomy": TAXONOMY, "defaults": DEFAULTS,
                              "sites": slim_sites(sites, DEFAULTS)}, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT} ({len(sites)} sites)", file=sys.stderr)


if __name__ == "__main__":
    main()
