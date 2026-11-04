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


def _tier_lookup(policy_key: str, fpl_pct: float) -> dict:
    tiers = POLICY[policy_key]["tiers"]
    for tier in tiers:
        if tier["max_fpl_pct"] is None or fpl_pct <= tier["max_fpl_pct"]:
            return {
                "patient_pays_pct": tier["patient_pays_pct"],
                "fpl_pct": fpl_pct,
                "max_fpl_pct": tier["max_fpl_pct"],
                "source": POLICY[policy_key]["source"],
            }
    raise AssertionError(f"unreachable: last tier in {policy_key} has max_fpl_pct = null")


def nj_charity_tier(fpl_pct: float) -> dict:
    """NJ Documented Charity Care tier for a given percent of FPL.

    Returns patient_pays_pct and the FPL band, per policy.json. Does not check
    the non-numeric eligibility conditions (insurance status, assets,
    Medicaid eligibility) -- caller must confirm those separately.
    """
    return _tier_lookup("nj_charity_care", fpl_pct)


def wa_charity_tier(fpl_pct: float) -> dict:
    """WA hospital charity care tier (RCW 70.170.060(5)(b) floor schedule) for a percent of FPL.

    This is the legal MINIMUM every WA hospital must offer -- larger hospital
    systems/hospitals are required to offer better terms up to 400% FPL under
    a separate schedule (5)(a) that CareMap can't apply per-hospital without
    bed-count/ownership data it doesn't have. See policy.json's "note" field.
    Does not check eligibility conditions -- caller must confirm those too.
    """
    return _tier_lookup("wa_charity_care", fpl_pct)


# Keyed by the two-letter state code on a facility record. Add an entry here
# (plus the matching policy.json block and a state-specific function above)
# for each additional state with a real, codified, state-wide formula --
# most states have no such law (just federal 501(r): each nonprofit hospital
# must have *a* policy, with no public structured dataset of what it says),
# so this registry is deliberately short and should stay that way unless a
# new state is actually verified against its own statute.
STATE_CHARITY_TIER_FNS = {
    "NJ": nj_charity_tier,
    "WA": wa_charity_tier,
}


def charity_tier(state: str, fpl_pct: float) -> dict | None:
    """Look up the charity-care tier for whichever state a facility is in.

    Returns None for a state with no modeled formula -- caller should say so
    rather than claim a tier that doesn't exist.
    """
    fn = STATE_CHARITY_TIER_FNS.get(state)
    return fn(fpl_pct) if fn else None


def apply_tier(typical_charge: float, patient_pays_pct: float) -> float:
    """Dollar amount the patient owes, given a typical billed charge and a tier's patient_pays_pct."""
    return round(typical_charge * (patient_pays_pct / 100), 2)


def good_faith_estimate_days_ok(business_days_notice: int) -> bool:
    return business_days_notice >= POLICY["good_faith_estimate"]["min_business_days_notice"]
