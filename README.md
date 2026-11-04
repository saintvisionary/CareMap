# CareMap

Find affordable care near you, before you go.

Type a plain-language message like:

> "07018, family of 4, $52k, uninsured, need gallbladder surgery"

and CareMap finds nearby hospitals, estimates what you'd actually owe under
New Jersey's Documented Charity Care program, and shows it on a map colored
by what you'd pay: green for free care, amber for a reduced rate, gray for
full price.

## Why

Hospital bills are often negotiable or forgivable under programs most
people never hear about. CareMap makes the eligibility math and the typical
billed charges visible up front, from public data, before a bill ever
arrives.

## How it works

- **Privacy first.** Household income and size never leave your browser.
  A regex pre-pass (`src/lib/intake.ts`, mirrored server-side in
  `caremap/intake.py`) extracts them locally, computes your charity-care
  tier on the spot, and only ever sends that tier (not the raw numbers)
  anywhere else.
- **Works with no AI call.** Eligibility, nearby facilities, and typical
  billed charges are all computed client-side in under a second
  (`src/hooks/useCareMap.ts`). An optional AI agent (Strands SDK, Python)
  can add a richer natural-language reply on top, but the map and the
  numbers never depend on it.
- **Every dollar figure is grounded.** The agent side
  (`caremap/guards.py`) enforces that any $ figure or tier percentage in an
  AI reply must trace back to an actual tool result, labeled a "typical
  billed charge" and never "your price," with an estimate disclaimer.

## Data

All public domain, real, and current as of the last `scripts/build_data.py`
run:

- Hospital names, addresses, ER/star rating: CMS Hospital General
  Information
- Typical billed charges per procedure (DRG): CMS Medicare Inpatient by
  Provider and Service
- Geocoding: US Census batch geocoder, with a zip-centroid fallback
- Zip code centroids: US Census ZCTA Gazetteer
- NJ Documented Charity Care tier formula: NJ Department of Health fact
  sheet
- Federal poverty guidelines: HHS annual update

Currently covers New Jersey's 61 acute care hospitals. The pipeline is
state-agnostic (`python scripts/build_data.py --states XX`); adding a state
is a data pull, not a rewrite.

## Running it

Backend (Python, Strands agents + policy math):

```
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest
```

Frontend (React + Vite + MapLibre):

```
npm install
npm run dev
```

The map and eligibility answers work with no setup. To enable the optional
AI chat enhancement, set `VITE_AGENT_URL` to a deployed agent endpoint (see
`.env.example`); `GEMINI_API_KEY` is required on that backend.

## What's not in yet

- Only NJ Charity Care's tier formula; other states show "state rules
  coming" plus federal rules
- FQHC / urgent care layer (HRSA, NPPES) -- hospitals only so far
- A national point layer (currently one state's worth of markers, loaded
  directly as GeoJSON; a `.pmtiles` tile layer is the next step for scale)
