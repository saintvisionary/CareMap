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
        "label": "typical billed charge, estimate, confirm with billing office",
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
        "patient_pays_pct": patient_pays_pct,
        "label": "estimate, confirm with billing office",
    }


@tool
def facilities_near(zip_code: str, radius_miles: float = 15, types: list[str] | None = None) -> dict:
    """Find hospitals, urgent care, FQHCs or clinics near a zip code.

    Args:
        zip_code: 5-digit US zip code.
        radius_miles: Search radius in miles (default 15).
        types: Optional filter, any of "acute_care_hospital", "fqhc".
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


@tool
def draft_application(ccn: str, patient_pays_pct: float) -> dict:
    """Draft an NJ Charity Care application checklist and cover letter for a facility and tier.

    Args:
        ccn: CMS Certification Number of the facility.
        patient_pays_pct: Dollar-share percent from nj_charity_tier (0-100).
    """
    facility = facility_data.facility_by_ccn(ccn)
    if facility is None:
        return {"error": f"No facility found for CCN '{ccn}'."}
    nj = policy_mod.POLICY["nj_charity_care"]
    checklist = [
        "Proof of NJ residency (lease, utility bill, or ID).",
        "Proof of household income (pay stubs, tax return, or benefits letter).",
        "Proof of insurance status (denial letter or statement of no insurance).",
        "Hospital bill or account number for the service in question.",
        f"Submit within {nj['apply_window_days_after_service']} days of the date of service.",
    ]
    letter = (
        f"To the Business Office of {facility['name']}:\n\n"
        "I am requesting consideration for NJ Documented Charity Care for the hospital "
        "charges referenced above. Based on my household income and size, I believe I "
        f"qualify for a reduced-charge tier (patient responsibility: {patient_pays_pct}% of billed charges). "
        "I have enclosed proof of income, residency and insurance status. "
        f"Per NJ Charity Care policy, I understand a decision is due within "
        f"{nj['decision_window_business_days']} business days. "
        "I am also requesting a Good Faith Estimate for any scheduled services under the No Surprises Act.\n\n"
        "Thank you for your consideration."
    )
    return {
        "facility_name": facility["name"],
        "checklist": checklist,
        "letter": letter,
        "help_phone": nj["help_phone"],
        "source": nj["source"],
    }


ELIGIBILITY_TOOLS = [fpl_percent, nj_charity_tier]
COST_TOOLS = [estimate_cost, apply_tier_to_charge]
QUALITY_TOOLS = [facilities_near, nearest_fqhc]
ADVOCATE_TOOLS = [draft_application]

ALL_TOOLS = ELIGIBILITY_TOOLS + COST_TOOLS + QUALITY_TOOLS + ADVOCATE_TOOLS
DATA_TOOL_NAMES = {t.tool_name for t in ALL_TOOLS}
