"""Pure-Python policy math. No model calls, no I/O beyond loading policy.json.

Income and household size never leave the browser. The agent
only ever sees the output of fpl_percent / nj_charity_tier: a tier label and
percent, never the dollar income or household size that produced it.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

POLICY = json.loads((Path(__file__).resolve().parent.parent / "policy" / "policy.json").read_text(encoding="utf-8"))


def fpl_amount(household_size: int) -> int:
    """Dollar amount at 100% of the 2026 federal poverty line for a household size."""
    if household_size < 1:
        raise ValueError("household_size must be >= 1")
    fpl = POLICY["fpl_2026_48_states"]
    amounts = fpl["household_amounts"]
    key = str(household_size)
    if key in amounts:
        return amounts[key]
    base_size = max(int(k) for k in amounts)
    base_amount = amounts[str(base_size)]
    return base_amount + fpl["additional_person_amount"] * (household_size - base_size)


def fpl_percent(annual_income: float, household_size: int) -> int:
    """Household income as a percent of the federal poverty line, rounded to nearest whole percent."""
    if annual_income < 0:
        raise ValueError("annual_income must be >= 0")
    pct = (annual_income / fpl_amount(household_size)) * 100
    return round(pct)


def nj_charity_tier(fpl_pct: float) -> dict:
    """NJ Documented Charity Care tier for a given percent of FPL.

    Returns patient_pays_pct and the FPL band, per policy.json. Does not check
    the non-numeric eligibility conditions (insurance status, assets,
    Medicaid eligibility) -- caller must confirm those separately.
    """
    tiers = POLICY["nj_charity_care"]["tiers"]
    for tier in tiers:
        if tier["max_fpl_pct"] is None or fpl_pct <= tier["max_fpl_pct"]:
            return {
                "patient_pays_pct": tier["patient_pays_pct"],
                "fpl_pct": fpl_pct,
                "max_fpl_pct": tier["max_fpl_pct"],
                "source": POLICY["nj_charity_care"]["source"],
            }
    raise AssertionError("unreachable: last tier has max_fpl_pct = null")


def apply_tier(typical_charge: float, patient_pays_pct: float) -> float:
    """Dollar amount the patient owes, given a typical billed charge and a tier's patient_pays_pct."""
    return round(typical_charge * (patient_pays_pct / 100), 2)


def good_faith_estimate_days_ok(business_days_notice: int) -> bool:
    return business_days_notice >= POLICY["good_faith_estimate"]["min_business_days_notice"]
