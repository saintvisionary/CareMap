"""Strands tools. All arithmetic and data access lives here, not in the model.

Every dollar figure or tier the UI shows must come from one of these tool
results (see the project's "grounding hook" design). Tools never see raw household
income or size -- the browser computes fpl_pct client-side too, and only
sends the agent a tier + facility IDs when it does call the agent.
"""
from __future__ import annotations

from strands import tool

from . import data as facility_data
from . import policy as policy_mod


def _money(amount: float) -> str:
    """Comma-formatted whole-dollar string, e.g. 349877 -> "$349,877".

    A convenience field alongside the raw numeric one (never a replacement
    for it) -- gives the model an exact, already-correct string to copy
    instead of relying on it to reformat "349877.0" itself every time. The
    raw number stays in the result too, so grounding (which matches on
    numeric value, not formatting) is unaffected either way.
    """
    return f"${round(amount):,}"


@tool
def fpl_percent(annual_income: float, household_size: int) -> dict:
    """Compute household income as a percent of the 2026 federal poverty line.

    Args:
        annual_income: Total annual household income in dollars.
        household_size: Number of people in the household (>= 1).
    """
    pct = policy_mod.fpl_percent(annual_income, household_size)
    return {"fpl_pct": pct, "household_size": household_size, "source": policy_mod.POLICY["fpl_2026_48_states"]}


@tool
def nj_charity_tier(fpl_pct: float) -> dict:
    """Look up the NJ Documented Charity Care tier for a percent of the federal poverty line.

    Only tells you the dollar-share tier (patient_pays_pct). Does not confirm
    insurance status, assets or Medicaid eligibility -- those must also hold
    for NJ Charity Care to apply.

    Args:
        fpl_pct: Household income as a percent of the federal poverty line (e.g. 158 for 158%).
    """
    return policy_mod.nj_charity_tier(fpl_pct)


@tool
def charity_tier(state: str, fpl_pct: float, facility_type: str = "acute_care_hospital") -> dict:
    """Look up the charity-care tier for a hospital's state, for a percent of the federal poverty line.

    Only a short list of states have a real, codified, state-wide formula --
    currently NJ, WA, IL, NY. For every other state, returns an error; say
    the state's rules aren't modeled in CareMap yet rather than guessing a
    tier.
    For WA specifically, this is the legal MINIMUM floor every hospital must
    offer (RCW 70.170.060(5)(b)) -- larger hospital systems are required to
    offer better terms up to 400% FPL that this can't apply per-hospital
    without bed-count/ownership data CareMap doesn't have; say so if the
    state is WA.
    For IL specifically, facility_type matters: free care applies up to 200%
    FPL at a standard hospital but only up to 125% FPL at a Critical Access
    Hospital (facility_type "critical_access_hospital"). Above that
    threshold IL has NO modeled percentage -- the real statutory discount
    needs each hospital's own Medicare cost-to-charge ratio, which CareMap
    doesn't have (a different CMS dataset than what's loaded). Say so if the
    state is IL and this returns an error -- but still mention IL's real cap:
    a hospital can never collect more than 20% of the patient's family
    income in any 12-month period, regardless of the missing percentage.
    For NY specifically: free care applies up to 200% FPL (PBH
    2807-k(9-a)). Above that threshold NY has NO modeled percentage either,
    and unlike IL there's no disclosable cap fact to add -- NY's real cap
    (10-20%) is of the Medicaid-equivalent rate for the service, a dataset
    CareMap doesn't have at all (not just a missing ratio on an otherwise-
    known base). Say that plainly if the state is NY and this returns an
    error -- don't imply any specific cap percentage applies.

    Args:
        state: Two-letter state code of the facility (e.g. "NJ", "WA", "IL", "NY"), not the user's own state.
        fpl_pct: Household income as a percent of the federal poverty line (e.g. 158 for 158%).
        facility_type: The facility's own type (e.g. "acute_care_hospital", "critical_access_hospital") -- only matters for IL.
    """
    tier = policy_mod.charity_tier(state, fpl_pct, facility_type)
    if tier is not None:
        return tier
    if state == "IL":
        return {
            "error": (
                "IL has no modeled percentage above its free-care threshold (needs a cost-to-charge ratio "
                "CareMap doesn't have) -- say that, and that state law still caps total collection at 20% of "
                "family income per 12 months regardless, per policy.json's il_charity_care."
            )
        }
    if state == "NY":
        return {
            "error": (
                "NY has no modeled percentage above its free-care threshold -- the real cap there is 10-20% "
                "of the Medicaid-equivalent rate for the service, not of billed charges, and CareMap has no "
                "Medicaid-rate data loaded at all. Say that plainly; don't state or imply a specific cap "
                "percentage, per policy.json's ny_charity_care."
            )
        }
    return {"error": f"No state-wide charity-care formula modeled for '{state}' -- direct the user to that hospital's billing/financial-assistance office."}


@tool
def estimate_cost(ccn: str, drg: str) -> dict:
    """Estimate the typical billed charge for a procedure at a facility, and what a patient
    in a given NJ Charity Care tier would owe.

    Args:
        ccn: CMS Certification Number of the facility.
        drg: Medicare Diagnosis-Related Group code, e.g. "419" for laparoscopic cholecystectomy.
    """
    facility = facility_data.facility_by_ccn(ccn)
    if facility is None:
        return {"error": f"No facility found for CCN '{ccn}'."}
    charge_info = facility.get("drg_charges", {}).get(drg)
    if charge_info is None:
        return {"error": f"No charge data for DRG '{drg}' at facility '{ccn}'."}
    return {
        "ccn": ccn,
        "facility_name": facility["name"],
        "drg": drg,
        "drg_description": charge_info["description"],
        "typical_billed_charge": charge_info["avg_charge"],
        "typical_billed_charge_formatted": _money(charge_info["avg_charge"]),
        "label": "typical billed charge, estimate, confirm with billing office",
    }


@tool
def facilities_with_drg(zip_code: str, drg: str, radius_miles: float = 25) -> dict:
    """Find facilities near a zip code that have billed-charge data for a specific
    procedure (DRG code), nearest first. Prefer this over guessing facility-by-facility
    with estimate_cost: most facilities only report a handful of DRGs, so a blind guess
    usually misses. Call this first, then estimate_cost on one of the CCNs it returns.

    Args:
        zip_code: 5-digit US zip code.
        drg: Medicare Diagnosis-Related Group code, e.g. "419" for laparoscopic cholecystectomy.
        radius_miles: Search radius in miles (default 25).
    """
    matches = facility_data.facilities_with_drg(zip_code, drg, radius_miles=radius_miles)
    if not matches:
        return {"error": f"No facility within {radius_miles} miles of '{zip_code}' has billed-charge data for DRG '{drg}'."}
    return {
        "zip_code": zip_code,
        "drg": drg,
        "facilities": [
            {"ccn": f["ccn"], "name": f["name"], "distance_miles": f["distance_miles"],
             "typical_billed_charge": f["drg_charges"][drg]["avg_charge"],
             "typical_billed_charge_formatted": _money(f["drg_charges"][drg]["avg_charge"])}
            for f in matches
        ],
    }


@tool
def apply_tier_to_charge(typical_billed_charge: float, patient_pays_pct: float) -> dict:
    """Apply a charity-care tier's patient_pays_pct to a typical billed charge to get the
    estimated patient-owed amount.

    Args:
        typical_billed_charge: Dollar amount from estimate_cost.
        patient_pays_pct: Dollar-share percent from nj_charity_tier (0-100).
    """
    owed = policy_mod.apply_tier(typical_billed_charge, patient_pays_pct)
    return {
        "estimated_patient_owed": owed,
        "estimated_patient_owed_formatted": _money(owed),
        "patient_pays_pct": patient_pays_pct,
        "label": "estimate, confirm with billing office",
    }


@tool
def facilities_near(zip_code: str, radius_miles: float = 15, types: list[str] | None = None) -> dict:
    """Find hospitals, urgent care, FQHCs or clinics near a zip code.

    Args:
        zip_code: 5-digit US zip code.
        radius_miles: Search radius in miles (default 15).
        types: Optional filter, any of "acute_care_hospital", "va_hospital", "fqhc".
    """
    matches = facility_data.facilities_near(zip_code, radius_miles=radius_miles, types=types)
    return {"zip_code": zip_code, "radius_miles": radius_miles, "facilities": matches}


@tool
def nearest_fqhc(zip_code: str, radius_miles: float = 25) -> dict:
    """Find the nearest Federally Qualified Health Center (sliding-fee clinic) to a zip code.

    Args:
        zip_code: 5-digit US zip code.
        radius_miles: Search radius in miles (default 25).
    """
    match = facility_data.nearest_fqhc(zip_code, radius_miles=radius_miles)
    if match is None:
        return {"error": f"No FQHC found within {radius_miles} miles of '{zip_code}'."}
    return match


_STATE_PROGRAM_NAMES = {
    "NJ": "NJ Documented Charity Care",
    "WA": "the Washington hospital charity care program (RCW 70.170.060)",
    "IL": "the Illinois Hospital Uninsured Patient Discount Act (210 ILCS 89)",
    "NY": "the New York Hospital Financial Assistance Law (PBH 2807-k)",
}
_STATE_POLICY_KEYS = {"NJ": "nj_charity_care", "WA": "wa_charity_care", "IL": "il_charity_care", "NY": "ny_charity_care"}


@tool
def draft_application(ccn: str, patient_pays_pct: float) -> dict:
    """Draft a charity-care application checklist and cover letter for a facility and tier.

    Works for any facility in a state CareMap has a modeled formula for
    (currently NJ or WA) -- looks up the facility's own state, not a fixed
    program. Fields the matching policy.json entry doesn't have (e.g. WA has
    no confirmed apply-window or help-phone, unlike NJ) are left out of the
    checklist/letter rather than guessed.

    Args:
        ccn: CMS Certification Number of the facility.
        patient_pays_pct: Dollar-share percent from charity_tier (0-100).
    """
    facility = facility_data.facility_by_ccn(ccn)
    if facility is None:
        return {"error": f"No facility found for CCN '{ccn}'."}
    state = facility["state"]
    policy_key = _STATE_POLICY_KEYS.get(state)
    if policy_key is None:
        return {"error": f"No charity-care formula modeled for '{state}' -- direct the user to {facility['name']}'s billing/financial-assistance office instead."}
    program = policy_mod.POLICY[policy_key]
    program_name = _STATE_PROGRAM_NAMES[state]

    checklist = [
        f"Proof of {state} residency (lease, utility bill, or ID).",
        "Proof of household income (pay stubs, tax return, or benefits letter).",
        "Proof of insurance status (denial letter or statement of no insurance).",
        "Hospital bill or account number for the service in question.",
    ]
    if "apply_window_days_after_service" in program:
        checklist.append(f"Submit within {program['apply_window_days_after_service']} days of the date of service.")

    letter = (
        f"To the Business Office of {facility['name']}:\n\n"
        f"I am requesting consideration for {program_name} for the hospital "
        "charges referenced above. Based on my household income and size, I believe I "
        f"qualify for a reduced-charge tier (patient responsibility: {patient_pays_pct}% of billed charges). "
        "I have enclosed proof of income, residency and insurance status. "
    )
    if "decision_window_business_days" in program:
        letter += f"I understand a decision is due within {program['decision_window_business_days']} business days. "
    letter += (
        "I am also requesting a Good Faith Estimate for any scheduled services under the No Surprises Act.\n\n"
        "Thank you for your consideration."
    )

    result = {
        "facility_name": facility["name"],
        "checklist": checklist,
        "letter": letter,
        "source": program["source"],
    }
    if "help_phone" in program:
        result["help_phone"] = program["help_phone"]
    return result


ELIGIBILITY_TOOLS = [fpl_percent, nj_charity_tier, charity_tier]
COST_TOOLS = [facilities_with_drg, estimate_cost, apply_tier_to_charge]
QUALITY_TOOLS = [facilities_near, nearest_fqhc]
ADVOCATE_TOOLS = [draft_application]

ALL_TOOLS = ELIGIBILITY_TOOLS + COST_TOOLS + QUALITY_TOOLS + ADVOCATE_TOOLS
DATA_TOOL_NAMES = {t.tool_name for t in ALL_TOOLS}
