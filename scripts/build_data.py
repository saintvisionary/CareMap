#!/usr/bin/env python3
"""Build public/data/states/{ST}.json and public/data/zip_centroids.json from
public CMS + Census sources.

Usage:
    python scripts/build_data.py --states NJ

Pipeline: download -> filter -> join on CCN -> geocode -> write state JSON.
Raw downloads are cached in data/raw/ (gitignored, not committed -- GitHub
has a 100MB file limit and these are regeneratable).

Not yet wired in (left for later):
- NJ Documented Charity Care PDF (per-hospital $ amounts; the tier formula
  itself does not need this, see caremap/policy.py)
- HRSA FQHC sites, NPPES urgent care filter
- tippecanoe/.pmtiles national point layer (only needed once >1 state ships)
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT_STATES = ROOT / "public" / "data" / "states"
OUT_ZIP_CENTROIDS = ROOT / "public" / "data" / "zip_centroids.json"

HGI_METASTORE_URL = "https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/xubh-q36u"
DRG_DATA_API = "https://data.cms.gov/data-api/v1/dataset/690ddc6c-2767-4618-b277-420ffb2bf27c/data"
ZCTA_GAZETTEER_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip"
CENSUS_BATCH_GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
CENSUS_ONELINE_GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"

# A handful of CMS-listed zips are PO-box-only and have no ZCTA centroid
# (e.g. Morristown Medical Center is listed under 07962, a PO box; its
# physical zip is 07960). Used only as a last-resort fallback key.
PO_BOX_ZIP_TO_PHYSICAL_ZIP = {"07962": "07960"}

def _get(url: str, retries: int = 3) -> bytes:
    # No custom User-Agent: data.cms.gov's bot protection blocks non-browser-looking
    # UA strings, but is fine with urllib/curl's plain defaults (verified via curl).
    req = Request(url)
    for attempt in range(retries):
        try:
            with urlopen(req, timeout=60) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            if exc.code < 500 or attempt == retries - 1:
                raise
            print(f"  {url} -> HTTP {exc.code}, retrying ({attempt + 1}/{retries})...", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    raise AssertionError("unreachable")


def _cached(path: Path, fetch) -> bytes:
    if path.exists():
        return path.read_bytes()
    data = fetch()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data


def resolve_hgi_csv_url() -> str:
    meta = json.loads(_get(HGI_METASTORE_URL))
    return meta["distribution"][0]["downloadURL"]


HOSPITAL_TYPE_TO_FACILITY_TYPE = {
    "Acute Care Hospitals": "acute_care_hospital",
    "Acute Care - Veterans Administration": "va_hospital",
    "Critical Access Hospitals": "critical_access_hospital",
}


def load_hospital_general_info(states: set[str]) -> list[dict]:
    csv_bytes = _cached(RAW / "hospital_general_information.csv", lambda: _get(resolve_hgi_csv_url()))
    reader = csv.DictReader(io.StringIO(csv_bytes.decode("utf-8")))
    out = []
    for row in reader:
        if row["State"] not in states:
            continue
        facility_type = HOSPITAL_TYPE_TO_FACILITY_TYPE.get(row["Hospital Type"])
        if facility_type is None:
            continue
        rating = row["Hospital overall rating"]
        out.append({
            "ccn": row["Facility ID"],
            "name": row["Facility Name"].strip(),
            "type": facility_type,
            "ownership": row["Hospital Ownership"],
            "has_er": row["Emergency Services"] == "Yes",
            "star_rating": int(rating) if rating.isdigit() else None,
            "address": row["Address"].strip(),
            "city": row["City/Town"].strip(),
            "state": row["State"],
            "zip": row["ZIP Code"],
            "county": row["County/Parish"].strip(),
        })
    return out


def load_all_drg_charges() -> dict[str, dict[str, dict]]:
    """All DRG charges nationally, keyed by CCN then DRG code. Cached in full
    (not pre-filtered to a CCN subset) so a later run with a different
    --states selection doesn't silently reuse a stale, narrower cache --
    an earlier version of this function cached only the CCNs it was asked
    for, so an NJ-only run's cache would have wrongly short-circuited a
    later national run.
    """
    cache_path = RAW / "drg_charges_national.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text())

    by_ccn: dict[str, dict[str, dict]] = {}
    offset = 0
    page_size = 6500
    while True:
        url = f"{DRG_DATA_API}?size={page_size}&offset={offset}"
        page = json.loads(_get(url))
        if not page:
            break
        for row in page:
            ccn = row["Rndrng_Prvdr_CCN"]
            by_ccn.setdefault(ccn, {})[row["DRG_Cd"]] = {
                "description": row["DRG_Desc"],
                "avg_charge": round(float(row["Avg_Submtd_Cvrd_Chrg"])),
            }
        print(f"  drg page offset={offset} rows={len(page)} facilities_so_far={len(by_ccn)}", file=sys.stderr)
        offset += page_size
        time.sleep(0.2)

    RAW.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(by_ccn))
    return by_ccn


def build_zip_centroids() -> dict[str, dict]:
    if OUT_ZIP_CENTROIDS.exists():
        return json.loads(OUT_ZIP_CENTROIDS.read_text())

    zip_bytes = _cached(RAW / "zcta_gazetteer.zip", lambda: _get(ZCTA_GAZETTEER_URL))
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        name = next(n for n in zf.namelist() if n.endswith(".txt"))
        text = zf.read(name).decode("utf-8")

    out = {}
    lines = text.splitlines()
    for line in lines[1:]:
        cols = line.split("\t")
        if len(cols) < 7:
            continue
        zip_code, lat, lon = cols[0].strip(), cols[5].strip(), cols[6].strip()
        if not lat or not lon:
            continue
        out[zip_code] = {"lat": float(lat), "lon": float(lon)}

    OUT_ZIP_CENTROIDS.parent.mkdir(parents=True, exist_ok=True)
    OUT_ZIP_CENTROIDS.write_text(json.dumps(out))
    return out


def geocode_facilities(facilities: list[dict], zip_centroids: dict[str, dict]) -> None:
    """Fills in lat/lon on each facility dict in place, via the free Census geocoder.

    Falls back to the facility's zip centroid (approximate, but keeps every
    facility on the map) if even the single-address geocoder has no match.
    Chunked at 1,000 records per batch call -- under the documented 10,000
    limit, but a smaller chunk fails (and can be retried) cheaply instead of
    losing a multi-thousand-record batch to one dropped connection.
    """
    chunk_size = 1000
    for i in range(0, len(facilities), chunk_size):
        chunk = facilities[i : i + chunk_size]
        print(f"  geocoding {i + 1}-{i + len(chunk)} of {len(facilities)}...", file=sys.stderr)
        _geocode_batch(chunk, zip_centroids)


def _geocode_batch(facilities: list[dict], zip_centroids: dict[str, dict]) -> None:
    rows = "\n".join(
        f'{f["ccn"]},"{f["address"]}","{f["city"]}","{f["state"]}","{f["zip"]}"' for f in facilities
    )
    boundary = "----caremapboundary"
    body_parts = [
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="addressFile"; filename="addresses.csv"\r\n'
        "Content-Type: text/csv\r\n\r\n" + rows + "\r\n",
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="benchmark"\r\n\r\n'
        "Public_AR_Current\r\n",
        f"--{boundary}--\r\n",
    ]
    body = "".join(body_parts).encode("utf-8")
    req = urllib.request.Request(
        CENSUS_BATCH_GEOCODER_URL, data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    result_csv = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                result_csv = resp.read().decode("utf-8")
            break
        except urllib.error.HTTPError as exc:
            if exc.code < 500 or attempt == 2:
                raise
            print(f"  batch geocode -> HTTP {exc.code}, retrying ({attempt + 1}/3)...", file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    assert result_csv is not None

    by_ccn = {f["ccn"]: f for f in facilities}
    unmatched = []
    for row in csv.reader(io.StringIO(result_csv)):
        ccn = row[0]
        matched = row[2] == "Match"
        if matched:
            lon, lat = row[5].split(",")
            by_ccn[ccn]["lat"] = float(lat)
            by_ccn[ccn]["lon"] = float(lon)
        else:
            unmatched.append(ccn)

    for ccn in unmatched:
        f = by_ccn[ccn]
        query = f'{f["address"]}, {f["city"]}, {f["state"]} {f["zip"]}'
        try:
            url = f"{CENSUS_ONELINE_GEOCODER_URL}?address={urllib.parse.quote(query)}&benchmark=Public_AR_Current&format=json"
            result = json.loads(_get(url))
            matches = result["result"]["addressMatches"]
            if matches:
                coords = matches[0]["coordinates"]
                f["lat"], f["lon"] = coords["y"], coords["x"]
            else:
                raise ValueError("no addressMatches")
        except Exception as exc:  # noqa: BLE001
            zip_for_centroid = PO_BOX_ZIP_TO_PHYSICAL_ZIP.get(f["zip"], f["zip"])
            centroid = zip_centroids.get(zip_for_centroid)
            if centroid:
                print(f"  no street match for {ccn} ({exc}); using zip centroid for {zip_for_centroid}",
                      file=sys.stderr)
                f["lat"], f["lon"] = centroid["lat"], centroid["lon"]
                f["lat_lon_approximate"] = True
            else:
                print(f"  WARNING: no geocode match at all for {ccn} {query}", file=sys.stderr)
                f["lat"], f["lon"] = None, None
        time.sleep(0.3)


US_STATES_AND_DC = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN",
    "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
    "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT",
    "VT", "VA", "WA", "WV", "WI", "WY",
}


def build_states(states: set[str], zip_centroids: dict[str, dict]) -> dict[str, dict]:
    """One combined pass across every requested state: a single CSV parse, a
    single (chunked) geocoding run, and a single DRG lookup, then grouped
    back into per-state output. Geocoding ~3,000 addresses one state at a
    time would mean 50 separate batch calls; doing it once is both faster
    and friendlier to the free Census geocoder.
    """
    print(f"Loading Hospital General Information for {len(states)} state(s)...", file=sys.stderr)
    facilities = load_hospital_general_info(states)
    print(f"  {len(facilities)} acute care hospitals", file=sys.stderr)

    print("Geocoding addresses (Census batch geocoder)...", file=sys.stderr)
    geocode_facilities(facilities, zip_centroids)
    matched = sum(1 for f in facilities if f.get("lat") is not None)
    approximate = sum(1 for f in facilities if f.get("lat_lon_approximate"))
    print(f"  geocoded {matched}/{len(facilities)} ({approximate} approximate via zip centroid)",
          file=sys.stderr)

    print("Loading DRG charges (pages through the full national dataset once, cached after)...", file=sys.stderr)
    drg_by_ccn = load_all_drg_charges()

    by_state: dict[str, list[dict]] = {}
    for f in facilities:
        f["drg_charges"] = drg_by_ccn.get(f["ccn"], {})
        # True when this facility's state has a real, codified, state-wide
        # charity-care formula modeled in CareMap (see caremap/policy.py's
        # STATE_CHARITY_TIER_FNS -- currently NJ, WA, IL) and the facility is
        # a type the formula actually applies to. VA hospitals are federal
        # and run their own separate means-tested eligibility system
        # entirely outside state charity-care programs, so they're excluded
        # even in a modeled state. IL's law (210 ILCS 89) covers Critical
        # Access Hospitals too, unlike NJ/WA which only cover acute care.
        if f["state"] == "IL":
            f["charity_care_participant"] = f["type"] in {"acute_care_hospital", "critical_access_hospital"}
        else:
            f["charity_care_participant"] = f["state"] in {"NJ", "WA"} and f["type"] == "acute_care_hospital"
        by_state.setdefault(f["state"], []).append(f)

    return {state: {"state": state, "facilities": fs} for state, fs in by_state.items()}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--states", nargs="+", default=["NJ"],
                         help='State codes, e.g. "NJ NY CA", or "all" for every US state + DC')
    args = parser.parse_args()
    states = US_STATES_AND_DC if args.states == ["all"] else set(args.states)

    print("Loading national zip centroid lookup (Census ZCTA gazetteer)...", file=sys.stderr)
    centroids = build_zip_centroids()
    print(f"  {len(centroids)} zip centroids -> {OUT_ZIP_CENTROIDS}", file=sys.stderr)

    OUT_STATES.mkdir(parents=True, exist_ok=True)
    results = build_states(states, centroids)
    for state, data in sorted(results.items()):
        out_path = OUT_STATES / f"{state}.json"
        out_path.write_text(json.dumps(data, indent=2))
        print(f"Wrote {out_path} ({len(data['facilities'])} facilities)", file=sys.stderr)

    # Authoritative list of every state file currently on disk (not just the
    # ones this run touched) -- the frontend fetches this first to know what
    # to load, instead of hardcoding a second copy of the state list that
    # could drift out of sync with what's actually been built.
    available = sorted(p.stem for p in OUT_STATES.glob("*.json") if p.stem != "index")
    (OUT_STATES / "index.json").write_text(json.dumps(available))
    print(f"Wrote {OUT_STATES / 'index.json'} ({len(available)} states)", file=sys.stderr)


if __name__ == "__main__":
    main()
