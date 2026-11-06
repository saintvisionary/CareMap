"""Readable capitalization for the all-caps names, cities and addresses in
CMS and NPPES data ("ST LUKE'S HOSPITAL - EASTON CAMPUS" -> "St Luke's
Hospital - Easton Campus"). Strings that already have lowercase letters
(most HRSA clinic names) are left as published.

Used by the build scripts and by scripts/patch_textcase.py, so the browser
and the agent both get the same display text.
"""
from __future__ import annotations

import re

# Kept in capitals wherever they appear.
ACRONYMS = {
    "AHN", "AMC", "ARH", "BMG", "CAH", "CHC", "CHI", "CHOP", "CMC", "CUNY", "DBA", "ECU", "ER", "FQHC", "HCA", "HMC",
    "HSC", "HSHS", "II", "III", "IU", "IV", "KU", "LAC", "LLC", "LLP", "LP", "LSU", "MCV", "MD", "MUSC", "NW", "NE", "NYC",
    "NYU", "OHSU", "OSF", "OSU", "OU", "PA", "PC", "PHS", "PLLC", "PLC", "PSC", "SE", "SSM", "SUNY", "SW", "TMC",
    "UAB", "UC", "UCI", "UCLA", "UCSD", "UCSF", "UH", "UMC", "UNC", "UNM", "UPMC", "US", "USA", "USC", "UT", "UVA",
    "UW", "VA", "VCU", "VI", "WVU", "YMCA", "N", "S", "E", "W",
    # Address abbreviations: PO Box, rural/state/county routes, farm-to-market roads.
    "PO", "RR", "FM", "SR", "CR", "HC",
}
# Brand spellings plain title case gets wrong.
SPECIAL = {
    "MEDSTAR": "MedStar", "UMASS": "UMass", "MAINEHEALTH": "MaineHealth", "UCHEALTH": "UCHealth",
    "PEACEHEALTH": "PeaceHealth", "MEDEXPRESS": "MedExpress", "PROHEALTH": "ProHealth", "OHIOHEALTH": "OhioHealth",
    "NORTHBAY": "NorthBay", "INTEGRIS": "INTEGRIS", "HONORHEALTH": "HonorHealth", "BAYCARE": "BayCare",
    "CHRISTIANACARE": "ChristianaCare", "MERCYONE": "MercyOne", "UNITYPOINT": "UnityPoint", "CAREWELL": "CareWell",
    "CHRISTUS": "CHRISTUS", "WELLSPAN": "WellSpan", "CAREMOUNT": "CareMount", "CITYMD": "CityMD",
    "AFC": "AFC", "MEDFIRST": "MedFirst", "FASTMED": "FastMed", "CAREFIRST": "CareFirst", "CARENOW": "CareNow",
    "MEDCENTER": "MedCenter", "HEALTHPARTNERS": "HealthPartners", "SANFORD": "Sanford", "TRUSTCARE": "TrustCare",
    "GOHEALTH": "GoHealth", "NEXTCARE": "NextCare", "PATIENTS": "Patients", "MYMICHIGAN": "MyMichigan",
    "ADVENTHEALTH": "AdventHealth", "SEARHC": "SEARHC", "LTC": "LTC", "MULTICARE": "MultiCare", "DUPAGE": "DuPage",
    "TRIHEALTH": "TriHealth", "CENTRACARE": "CentraCare", "WAKEMED": "WakeMed", "PROMEDICA": "ProMedica",
    "METROHEALTH": "MetroHealth", "MERCYHEALTH": "MercyHealth", "MIDMICHIGAN": "MidMichigan", "NORTHSHORE": "NorthShore",
    "MEDCENTRAL": "MedCentral", "HEALTHALLIANCE": "HealthAlliance", "BJC": "BJC", "HCMC": "HCMC", "UNMH": "UNMH",
}
SMALL_WORDS = {"of", "and", "the", "at", "for", "in", "on", "with", "to", "by"}
LEGAL_SUFFIX = re.compile(r"[\s,]+(INC\.?|L\.?L\.?C\.?|PLLC|P\.?C\.?|P\.?A\.?|LLP|LP|LTD\.?|CORP\.?)$", re.I)
_ORDINAL = re.compile(r"^(\d+)(ST|ND|RD|TH)$")
_INITIALS = re.compile(r"^(?:[A-Z]\.){2,}$")
_TOKEN = re.compile(r"[A-Za-z0-9.']+|[^A-Za-z0-9.']+")


def _word(w: str, first: bool) -> str:
    bare = w.rstrip(".")
    dot = w[len(bare):]
    up = bare.upper()
    if up in SPECIAL:
        return SPECIAL[up] + dot
    if _INITIALS.match(w):
        return w
    m = _ORDINAL.match(up)
    if m:
        return m.group(1) + m.group(2).lower() + dot
    if up in ACRONYMS and (len(up) > 1 or not first):
        return up + dot
    if any(c.isdigit() for c in bare):
        return bare + dot
    low = bare.lower()
    if not first and low in SMALL_WORDS:
        return low + dot
    if low.startswith("mc") and len(low) > 3:
        return "Mc" + low[2:].capitalize() + dot
    if "'" in low:
        head, _, tail = low.partition("'")
        return head.capitalize() + "'" + (tail if len(tail) <= 1 else tail.capitalize()) + dot
    return low.capitalize() + dot


def smart_case(text: str | None) -> str | None:
    """Title-case an all-caps string; anything with lowercase is returned
    unchanged."""
    if not text or any(c.islower() for c in text):
        return text
    out, first = [], True
    for tok in _TOKEN.findall(text):
        if tok[0].isalnum() or tok[0] in ".'":
            out.append(_word(tok, first))
            first = False
        else:
            out.append(tok)
            # A new clause ("Hospital - Easton", "Center/University") starts fresh.
            if tok.strip() in {"-", "/", "(", ","} or tok.strip().endswith(("-", "/")):
                first = True
    return "".join(out)


def display_name(name: str | None) -> str | None:
    """Facility name for display: readable case, "X,THE" -> "The X", and no
    trailing legal suffix (", INC", " LLC")."""
    if not name:
        return name
    n = name.strip()
    m = re.match(r"^(.*?),\s*THE$", n, re.I)
    if m:
        n = "THE " + m.group(1) if n.isupper() else "The " + m.group(1)
    stripped = LEGAL_SUFFIX.sub("", n)
    if stripped.strip():
        n = stripped.rstrip(" ,")
    return smart_case(n)


# Display fields per facility record; the CCN/NPI keys and state codes never change.
NAME_FIELDS = ("name", "operator")
PLACE_FIELDS = ("address", "city", "county")


def apply_display_case(record: dict) -> dict:
    for k in NAME_FIELDS:
        if isinstance(record.get(k), str):
            record[k] = display_name(record[k])
    for k in PLACE_FIELDS:
        if isinstance(record.get(k), str):
            record[k] = smart_case(record[k])
    return record
