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


def _free_tier(policy_key: str, fpl_pct: float) -> dict | None:
    """A real 0% at or below the state's free-care line, else None (no guessed tier)."""
    rule = POLICY[policy_key]
    threshold = rule["free_care_max_fpl_pct"]
    if fpl_pct > threshold or (rule.get("free_care_strictly_below") and fpl_pct >= threshold):
        return None
    tier = {
        "patient_pays_pct": 0,
        "fpl_pct": fpl_pct,
        "max_fpl_pct": threshold,
        "source": rule["source"],
    }
    if "free_tier_note" in rule:
        tier["note"] = rule["free_tier_note"]
    return tier


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


def il_charity_tier(fpl_pct: float, is_critical_access: bool = False) -> dict | None:
    """IL hospital charity-care tier (210 ILCS 89/5, 89/10) for a percent of FPL.

    Verified directly against the current codified statute text. Below the
    free-care threshold this is a real, exact 0% -- no gap. Returns None
    above it: the statute's actual sliding-scale discount is charges x
    (1 - cost_to_charge_ratio x 1.35), which needs each hospital's own
    Medicare cost-to-charge ratio -- a different CMS dataset (cost reports)
    CareMap doesn't have loaded, so a percentage there would be a guess, not
    a grounded number. A 20%-of-family-income-per-12-months collection cap
    still applies in that range regardless -- see policy.json's "note" for
    the caller to disclose, since it's real even though the exact percentage
    isn't computable here. is_critical_access picks the correct one of the
    two free-care thresholds the statute sets (125% vs 200% FPL) -- pass
    True for a Critical Access Hospital, False for a standard one.
    """
    band = POLICY["il_charity_care"]["rural_critical_access" if is_critical_access else "standard"]
    threshold = band["free_care_max_fpl_pct"]
    if fpl_pct <= threshold:
        return {
            "patient_pays_pct": 0,
            "fpl_pct": fpl_pct,
            "max_fpl_pct": threshold,
            "source": POLICY["il_charity_care"]["source"],
        }
    return None


def ri_charity_tier(fpl_pct: float) -> dict | None:
    """RI hospital charity-care tier (216-RICR-40-10-23.14) for a percent of FPL.

    Verified directly against the current regulatory text. Below the
    free-care threshold this is a real, exact 0%. Returns None above it:
    unlike IL/NY, this isn't a missing-data problem -- the regulation
    itself delegates the 200-300% FPL sliding-scale percentage to each
    individual hospital, and says nothing about pricing above 300% FPL at
    all. There's no disclosable cap fact here the way IL has its
    20%-of-income cap -- showing anything above the free line would be a
    guess, not a grounded number.
    """
    return _free_tier("ri_charity_care", fpl_pct)


def ma_charity_tier(fpl_pct: float) -> dict | None:
    """MA Health Safety Net tier (101 CMR 613.00) for a percent of FPL.

    Verified directly against the current regulatory text. Below 150%
    FPL (note: lower than the 200% line most other modeled states use)
    this is a real, exact 0% -- HSN's Primary/Secondary categories have no
    deductible. Returns None above it: 150-300% FPL's deductible is a flat
    annual dollar amount (not a percentage of billed charges) equal to the
    greater of a MA Health Connector premium CareMap doesn't have, or a
    computable formula -- but since it's legally the GREATER of the two,
    the true amount isn't knowable without the premium data. Above 300%
    FPL, HSN's general categories don't apply at all. No disclosable cap
    fact here, same as RI.
    """
    return _free_tier("ma_charity_care", fpl_pct)


def me_charity_tier(fpl_pct: float) -> dict | None:
    """ME free hospital care (22 M.R.S. 1716-A) for a percent of FPL.

    A real, exact 0% at or below 200% FPL. Returns None above it: Maine
    sets no sliding scale there, only a payment-plan cap (4% of monthly
    income, up to 400% FPL) that callers should disclose instead of a
    percentage. Maine residents only -- callers must disclose that too.
    """
    return _free_tier("me_charity_care", fpl_pct)


def vt_charity_tier(fpl_pct: float) -> dict | None:
    """VT hospital financial assistance (18 V.S.A. 9482) for a percent of FPL.

    A real, exact 0% at or below 250% FPL. Returns None above it: the
    250-400% discount is taken off each hospital's own "amount generally
    billed", not the CMS billed charge CareMap has, so no share of the
    charge can be computed. Callers disclose that and the 20%-of-income
    catastrophic cap (up to 600% FPL) instead. Vermont residents only.
    """
    return _free_tier("vt_charity_care", fpl_pct)


def nv_charity_tier(fpl_pct: float) -> dict:
    """NV major-hospital discount (NRS 439B.260): at least 30% off total billed charges.

    Income-independent, so the share is the same at any fpl_pct. Only
    applies at a "major hospital" -- callers must gate on the facility's
    charity_care_participant flag (set from a CCN list in build_data.py).
    """
    tier = _tier_lookup("nv_charity_care", fpl_pct)
    tier["note"] = POLICY["nv_charity_care"]["tier_note"]
    return tier


def md_charity_tier(fpl_pct: float) -> dict:
    """MD hospital financial assistance tier (Md. Code, Health-General 19-214.1) for a percent of FPL.

    Verified directly against the current codified text -- a real 7-band
    sliding scale (free up to 200% FPL, down to 35% discount at 451-500%
    FPL). Applies to virtually every MD hospital under HSCRC jurisdiction,
    regardless of ownership (Maryland's all-payer rate-setting system
    makes this different from OR's nonprofit-only gate).

    One honesty note worth carrying in code, not just prose: the statute
    discounts the patient's "out-of-pocket expense", not "charges" by
    name. For CareMap's uninsured-only use case there's no insurer
    payment to net against, so this collapses to the same billed-charge
    base already used for NJ/WA/OR -- but that's an inference from the
    uninsured-only restriction, not a literal statutory statement. A
    separate hardship tier (medical debt over 25% of family income, up to
    500% FPL) exists in the statute but needs the patient's actual debt
    history CareMap doesn't have, so it is NOT computed here.
    """
    return _tier_lookup("md_charity_care", fpl_pct)


def or_charity_tier(fpl_pct: float, ownership: str | None = None) -> dict | None:
    """OR hospital financial assistance tier (ORS 442.610-442.618) for a percent of FPL.

    Verified directly against the current codified statute text. Unlike
    IL/NY, the dollar base here is real billed charges, so the full sliding
    scale is computable -- this is CareMap's first state with more than
    just a free floor plus a disclosed/undisclosed gap. These are
    statutory MINIMUM discounts (a hospital may be more generous, never
    less), the same floor-schedule pattern as wa_charity_tier -- so the
    returned patient_pays_pct is the maximum a patient is guaranteed not to
    exceed, not an exact guess.

    Scope: ORS 442.612(8) only covers NONPROFIT hospitals -- a for-profit
    or government-owned OR hospital gets no tier at all here, never a
    guessed one. ownership is CMS's own Hospital General Information
    field (e.g. "Voluntary non-profit - Private", "Proprietary",
    "Government - Local"); None (ownership unknown/not passed) is treated
    as NOT confirmed nonprofit, the safe default.
    """
    if ownership is None or not ownership.startswith("Voluntary non-profit"):
        return None
    return _tier_lookup("or_charity_care", fpl_pct)


def ny_charity_tier(fpl_pct: float) -> dict | None:
    """NY Hospital Financial Assistance Law (PBH 2807-k(9), (9-a)) for a percent of FPL.

    Verified directly against the current codified statute text (post the
    2024-04-20 amendment). Below the free-care threshold this is a real,
    exact 0% -- the statute's own words are "no nominal payment shall be
    collected". Returns None above it: NY's real cap there is 10% (201-300%
    FPL) or 20% (301-400% FPL) of the MEDICAID-EQUIVALENT rate for the
    service -- a completely different dollar base than the typical billed
    charge CareMap has (CMS Medicare Inpatient by Provider and Service).
    CareMap has no Medicaid-rate data loaded at all, so unlike IL (whose
    20%-of-income cap needs no extra dataset), there isn't even a
    disclosable cap fact to surface here -- showing anything above the free
    line would be a guess, not a grounded number.
    """
    return _free_tier("ny_charity_care", fpl_pct)


# Keyed by the two-letter state code on a facility record. Add an entry here
# (plus the matching policy.json block and a state-specific function above)
# for each additional state with a real, codified, state-wide formula --
# most states have no such law (just federal 501(r): each nonprofit hospital
# must have *a* policy, with no public structured dataset of what it says),
# so this registry is deliberately short and should stay that way unless a
# new state is actually verified against its own statute.
STATE_CHARITY_TIER_FNS = {
    "NJ": lambda fpl_pct, facility_type=None, ownership=None: nj_charity_tier(fpl_pct),
    "WA": lambda fpl_pct, facility_type=None, ownership=None: wa_charity_tier(fpl_pct),
    "IL": lambda fpl_pct, facility_type=None, ownership=None: il_charity_tier(fpl_pct, is_critical_access=facility_type == "critical_access_hospital"),
    "NY": lambda fpl_pct, facility_type=None, ownership=None: ny_charity_tier(fpl_pct),
    "OR": lambda fpl_pct, facility_type=None, ownership=None: or_charity_tier(fpl_pct, ownership=ownership),
    "MD": lambda fpl_pct, facility_type=None, ownership=None: md_charity_tier(fpl_pct),
    "RI": lambda fpl_pct, facility_type=None, ownership=None: ri_charity_tier(fpl_pct),
    "MA": lambda fpl_pct, facility_type=None, ownership=None: ma_charity_tier(fpl_pct),
    "ME": lambda fpl_pct, facility_type=None, ownership=None: me_charity_tier(fpl_pct),
    "VT": lambda fpl_pct, facility_type=None, ownership=None: vt_charity_tier(fpl_pct),
    "NC": lambda fpl_pct, facility_type=None, ownership=None: _free_tier("nc_charity_care", fpl_pct),
    "OH": lambda fpl_pct, facility_type=None, ownership=None: _free_tier("oh_charity_care", fpl_pct),
    "SC": lambda fpl_pct, facility_type=None, ownership=None: _free_tier("sc_charity_care", fpl_pct),
    "NV": lambda fpl_pct, facility_type=None, ownership=None: nv_charity_tier(fpl_pct),
}


def charity_tier(state: str, fpl_pct: float, facility_type: str | None = None, ownership: str | None = None) -> dict | None:
    """Look up the charity-care tier for whichever state a facility is in.

    facility_type matters for IL (standard vs Critical Access Hospital picks
    a different free-care threshold) -- ignored by states whose formula
    doesn't depend on it. ownership matters for OR (nonprofit-only scope)
    -- ignored elsewhere. Returns None for a state with no modeled formula,
    for IL above its free-care threshold (the real sliding-scale discount
    needs cost-to-charge-ratio data CareMap doesn't have), for NY above its
    free-care threshold (needs Medicaid-rate data CareMap doesn't have), or
    for an OR facility not confirmed nonprofit -- caller should say so
    rather than claim a tier that doesn't exist, isn't computable, or
    doesn't apply to this facility.
    """
    fn = STATE_CHARITY_TIER_FNS.get(state)
    return fn(fpl_pct, facility_type, ownership) if fn else None


def apply_tier(typical_charge: float, patient_pays_pct: float) -> float:
    """Dollar amount the patient owes, given a typical billed charge and a tier's patient_pays_pct."""
    return round(typical_charge * (patient_pays_pct / 100), 2)


def good_faith_estimate_days_ok(business_days_notice: int) -> bool:
    return business_days_notice >= POLICY["good_faith_estimate"]["min_business_days_notice"]
