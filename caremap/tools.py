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


def _medicare_reference(charge_info: dict) -> dict:
    """CMS's average Medicare total payment for the procedure, when the data has it.

    A reference point for states whose cap is tied to Medicare rates (CA,
    CO) -- never a price on its own.
    """
    if "avg_total_payment" not in charge_info:
        return {}
    return {
        "medicare_avg_total_payment": charge_info["avg_total_payment"],
        "medicare_avg_total_payment_formatted": _money(charge_info["avg_total_payment"]),
        "medicare_reference_label": "Medicare's average total payment for this procedure here (CMS, 2024 data), a reference, not a price",
    }


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
def charity_tier(state: str, fpl_pct: float, facility_type: str = "acute_care_hospital", ownership: str = "", ccn: str = "") -> dict:
    """Look up the charity-care tier for a facility's state at a percent of the federal poverty line.

    Returns patient_pays_pct (0-100) plus any note to relay, or an error
    explaining what that state's law does and doesn't let CareMap show. Never
    guess a tier when this returns an error; relay the error's facts instead.
    Per-state rules (thresholds, caps, residency) are described in the system
    prompt and repeated in each result.

    Always pass the facility's ccn once you know it: it's required for NC, NV
    and CT, and the facility's own state, type, ownership and participation
    then win over the other arguments (VA hospitals, clinics and urgent care
    get their own answers).

    Args:
        state: Two-letter state code of the facility, not the user's own state.
        fpl_pct: Household income as a percent of the federal poverty line (e.g. 158 for 158%).
        facility_type: The facility's type (e.g. "critical_access_hospital"); only matters for IL without a ccn.
        ownership: The facility's CMS ownership string; only matters for OR without a ccn.
        ccn: The facility's CMS Certification Number (or clinic id).
    """
    cost_cap_pct = None
    if ccn:
        facility = facility_data.facility_by_ccn(ccn)
        if facility is None:
            return {"error": f"No facility found for CCN '{ccn}'."}
        if facility.get("type") == "fqhc":
            return {"facility_type": "fqhc", **policy_mod.fqhc_sliding_fee(fpl_pct)}
        if facility.get("type") == "urgent_care":
            return {"error": "This is an urgent care center: no charity-care program covers it in CareMap's data, and CareMap has no urgent care prices."}
        if facility.get("type") == "va_hospital":
            return {"error": "This is a VA hospital: the VA's own eligibility rules apply, not state charity care."}
        # The facility's own record wins over whatever the caller passed.
        state, facility_type = facility["state"], facility.get("type", facility_type)
        ownership = facility.get("ownership", ownership)
        if not facility.get("charity_care_participant") and state != "OR":
            return {
                "error": (
                    f"{facility['name']} isn't covered by {state}'s modeled charity-care program (CareMap's data "
                    "doesn't confirm it as a participant) -- say that, and direct the user to its own billing/"
                    "financial-assistance office."
                )
            }
        cost_cap_pct = facility.get("cost_cap_pct")
    elif state in ("NV", "CT", "NC"):
        return {"error": f"{state}'s rule depends on the specific hospital -- call charity_tier again with the facility's ccn."}
    tier = policy_mod.charity_tier(state, fpl_pct, facility_type, ownership or None, cost_cap_pct)
    if tier is not None:
        if not ccn:
            tier["scope"] = (f"Applies only at participating {state} hospitals (never VA hospitals) -- call again with a "
                             "facility's ccn before stating it for a specific hospital.")
        return tier
    if state == "OR":
        return {
            "error": (
                "This facility isn't confirmed as a nonprofit hospital -- OR's charity-care law (ORS 442.610) "
                "only covers nonprofit hospitals, not for-profit or government-owned ones. Say that, and direct "
                "the user to that hospital's own billing/financial-assistance office."
            )
        }
    if state == "IL":
        il = policy_mod.POLICY["il_charity_care"]
        band = il["rural_critical_access" if facility_type == "critical_access_hospital" else "standard"]
        ceiling = band["eligibility_ceiling_fpl_pct"]
        if fpl_pct > ceiling:
            return {"error": f"IL's uninsured discount law doesn't apply above {ceiling}% FPL at this type of hospital -- say so, and direct the user to the hospital's own financial assistance policy."}
        return {
            "error": (
                "IL has no modeled percentage above its free-care threshold (needs a cost-to-charge ratio "
                "CareMap doesn't have) -- say that, and that state law still caps total collection at "
                f"{il['max_collection_pct_of_family_income_per_12mo']}% of family income per 12 months at this "
                f"income (it applies up to {ceiling}% FPL at this type of hospital)."
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
    if state == "RI":
        return {
            "error": (
                "RI has no modeled percentage above its free-care threshold -- the state regulation itself "
                "leaves the 200-300% FPL sliding scale to each individual hospital to set, and says nothing "
                "about pricing above 300% FPL. Say that plainly; direct the user to that hospital's own "
                "billing/financial-assistance office for its specific sliding scale, per policy.json's "
                "ri_charity_care."
            )
        }
    if state == "MA":
        return {
            "error": (
                "MA has no modeled percentage above its 150% FPL free-care threshold -- the real deductible "
                "there is a flat dollar amount tied to a MA Health Connector insurance premium, not a "
                "percentage of billed charges, and CareMap has no premium data loaded. Say that plainly, per "
                "policy.json's ma_charity_care."
            )
        }
    if state == "ME":
        me = policy_mod.POLICY["me_charity_care"]
        cap = (
            f" State law does require this hospital to offer a payment plan capped at "
            f"{me['payment_plan_max_monthly_pct_of_income']}% of monthly family income, since income is at or below "
            f"{me['payment_plan_max_fpl_pct']}% FPL -- mention that."
            if fpl_pct <= me["payment_plan_max_fpl_pct"]
            else " Income is also above the 400% FPL payment-plan protection, so there's no state cap fact to add."
        )
        return {
            "error": (
                "ME has no modeled percentage above its 200% FPL free-care threshold -- Maine law sets no sliding "
                f"scale there. Say that plainly.{cap} Maine's law covers Maine residents only."
            )
        }
    if state == "VT":
        vt = policy_mod.POLICY["vt_charity_care"]
        facts = []
        if fpl_pct <= vt["agb_discount_max_fpl_pct"]:
            facts.append(
                f"the hospital must give at least {vt['agb_min_discount_pct']}% off its own 'amount generally billed' "
                "(a hospital-specific rate CareMap doesn't have, so give no dollar figure for it)"
            )
        if fpl_pct <= vt["catastrophic_cap_max_fpl_pct"]:
            facts.append(
                f"if the hospital's bills exceed {vt['catastrophic_cap_pct_of_household_income']}% of household income, "
                f"it must cut the amount due to {vt['catastrophic_cap_pct_of_household_income']}% of household income"
            )
        detail = (" State law still says: " + "; and ".join(facts) + ".") if facts else ""
        return {
            "error": (
                "VT has no computable percentage above its 250% FPL free-care threshold -- say that plainly."
                f"{detail} Vermont's law covers Vermont residents only."
            )
        }
    policy_key = _STATE_POLICY_KEYS.get(state)
    if policy_key and "gap_disclosure" in policy_mod.POLICY[policy_key]:
        return {"error": policy_mod.POLICY[policy_key]["gap_disclosure"]}
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
        "state": facility["state"],
        "facility_type": facility["type"],
        "ownership": facility["ownership"],
        "drg": drg,
        "drg_description": facility_data.drg_description(drg) or charge_info.get("description"),
        "typical_billed_charge": charge_info["avg_charge"],
        "typical_billed_charge_formatted": _money(charge_info["avg_charge"]),
        "label": "typical billed charge, estimate, confirm with billing office",
        **_medicare_reference(charge_info),
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
             "state": f["state"], "facility_type": f["type"], "ownership": f["ownership"],
             "typical_billed_charge": f["drg_charges"][drg]["avg_charge"],
             "typical_billed_charge_formatted": _money(f["drg_charges"][drg]["avg_charge"]),
             **_medicare_reference(f["drg_charges"][drg])}
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


_NEAR_FIELDS = ("ccn", "name", "type", "ownership", "address", "city", "state", "zip", "distance_miles",
                "has_er", "star_rating", "charity_care_participant", "phone", "lat", "lon")
_NEAR_LIMIT = 20


@tool
def facilities_near(zip_code: str, radius_miles: float = 15, types: list[str] | None = None) -> dict:
    """Find the nearest hospitals near a zip code (up to 20, nearest first), or other facility
    types if asked for. Returns locations and basic facts only, not prices: use
    facilities_with_drg / estimate_cost for a procedure's typical billed charge.

    Args:
        zip_code: 5-digit US zip code.
        radius_miles: Search radius in miles (default 15).
        types: Optional filter, any of "acute_care_hospital", "critical_access_hospital",
            "va_hospital", "fqhc", "urgent_care". Omitted means hospitals only.
    """
    matches = facility_data.facilities_near(zip_code, radius_miles=radius_miles, types=types)
    # Full records carry every procedure's charge data (~2k tokens per hospital), which the
    # model doesn't need here and which made one city search cost ~90k tokens.
    return {
        "zip_code": zip_code,
        "radius_miles": radius_miles,
        "total_found": len(matches),
        "facilities": [
            {**{k: f[k] for k in _NEAR_FIELDS if k in f}, "procedures_with_charge_data": len(f.get("drg_charges", {}))}
            for f in matches[:_NEAR_LIMIT]
        ],
    }


@tool
def nearest_fqhc(zip_code: str, radius_miles: float = 25, fpl_pct: float | None = None, insurance_type: str = "") -> dict:
    """Find the nearest Federally Qualified Health Center (sliding-fee clinic) to a zip code,
    with the federal sliding-fee rule that applies there. Useful for primary and outpatient
    care, or whenever cost is a worry. Never quote a dollar amount for a clinic: CareMap has
    no clinic charge data.

    Args:
        zip_code: 5-digit US zip code.
        radius_miles: Search radius in miles (default 25).
        fpl_pct: Household income as a percent of the federal poverty line, if known.
        insurance_type: The user's coverage category, if known (e.g. "uninsured", "private").
    """
    match = facility_data.nearest_fqhc(zip_code, radius_miles=radius_miles)
    if match is None:
        return {"error": f"No FQHC found within {radius_miles} miles of '{zip_code}'."}
    keep = ("ccn", "name", "operator", "ownership", "address", "city", "state", "zip", "phone", "website",
            "lat", "lon", "distance_miles")
    site = {k: match[k] for k in keep if k in match}
    if insurance_type and insurance_type not in ("uninsured", "unsure"):
        # No claims about how the sliding scale treats insured patients' costs.
        return {**site, "coverage_note": "Federally funded health centers bill your coverage and can't deny service for inability to pay.",
                "source": policy_mod.POLICY["fqhc_sliding_fee"]["source"]}
    return {**site, **policy_mod.fqhc_sliding_fee(fpl_pct)}


@tool
def nearest_urgent_care(zip_code: str, radius_miles: float = 25) -> dict:
    """Find the nearest listed urgent care center to a zip code, for minor, non-emergency care.
    Never suggest it for an emergency (chest pain, trouble breathing, stroke signs, severe
    bleeding, or anything life-threatening) -- say to call 911 or go to an ER instead.
    CareMap has no urgent care prices, so never quote one.

    Args:
        zip_code: 5-digit US zip code.
        radius_miles: Search radius in miles (default 25).
    """
    match = facility_data.nearest_urgent_care(zip_code, radius_miles=radius_miles)
    if match is None:
        return {"error": f"No listed urgent care center within {radius_miles} miles of '{zip_code}'."}
    keep = ("ccn", "name", "address", "city", "state", "zip", "phone", "lat", "lon", "distance_miles")
    return {
        **{k: match[k] for k in keep if k in match},
        "source": "Federal NPI registry listing (self-reported urgent care taxonomy), not a verified walk-in list",
        "pricing": "No price data for urgent care in CareMap -- suggest asking the center about self-pay rates.",
    }


_STATE_PROGRAM_NAMES = {
    "NJ": "NJ Documented Charity Care",
    "WA": "the Washington hospital charity care program (RCW 70.170.060)",
    "IL": "the Illinois Hospital Uninsured Patient Discount Act (210 ILCS 89)",
    "NY": "the New York Hospital Financial Assistance Law (PBH 2807-k)",
    "OR": "the Oregon hospital financial assistance law (ORS 442.610)",
    "MD": "the Maryland hospital financial assistance law (Health-General 19-214.1)",
    "RI": "Rhode Island's hospital charity care regulation (216-RICR-40-10-23.14)",
    "MA": "Massachusetts's Health Safety Net (101 CMR 613.00)",
    "ME": "Maine's free hospital care law (22 M.R.S. 1716-A)",
    "VT": "Vermont's hospital financial assistance law (18 V.S.A. 9482)",
    "NC": "North Carolina's Medical Debt Mitigation program (NCDHHS HASP hospital commitment)",
    "OH": "Ohio's Hospital Care Assurance Program (OAC 5160-2-17)",
    "SC": "South Carolina's Medically Indigent Assistance Program (S.C. Code 44-6-150)",
    "NV": "Nevada's major-hospital discount law (NRS 439B.260)",
    "CA": "California's Hospital Fair Pricing Act (H&SC 127405)",
    "CO": "Colorado Hospital Discounted Care (C.R.S. 25.5-3-503)",
    "CT": "Connecticut's uninsured cost-of-care limit (Conn. Gen. Stat. 19a-673)",
}
_STATE_POLICY_KEYS = {
    "NJ": "nj_charity_care", "WA": "wa_charity_care", "IL": "il_charity_care",
    "NY": "ny_charity_care", "OR": "or_charity_care", "MD": "md_charity_care",
    "RI": "ri_charity_care", "MA": "ma_charity_care", "ME": "me_charity_care",
    "VT": "vt_charity_care", "NC": "nc_charity_care", "OH": "oh_charity_care",
    "SC": "sc_charity_care", "NV": "nv_charity_care", "CA": "ca_charity_care",
    "CO": "co_charity_care", "CT": "ct_charity_care",
}


@tool
def draft_application(ccn: str, patient_pays_pct: float) -> dict:
    """Draft a charity-care application checklist and cover letter for a facility and tier.

    Works for any facility in a state CareMap has a modeled formula for
    (currently NJ, WA, IL, NY, OR, MD, RI, MA, ME, VT, NC, OH, SC, NV, CT, CA, CO) -- looks up the facility's own state, not
    a fixed program. Fields the matching policy.json entry doesn't have
    (e.g. WA has no confirmed apply-window or help-phone, unlike NJ) are
    left out of the checklist/letter rather than guessed. For OR
    specifically, this refuses to draft anything for a facility not
    confirmed as nonprofit-owned, since ORS 442.610-442.618 doesn't cover
    for-profit or government-owned hospitals at all.

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
    if state == "OR" and not facility.get("ownership", "").startswith("Voluntary non-profit"):
        return {
            "error": (
                f"{facility['name']} isn't confirmed as a nonprofit hospital -- OR's charity-care law only "
                "covers nonprofit hospitals. Direct the user to this hospital's own billing/financial-"
                "assistance office instead."
            )
        }
    if not facility.get("charity_care_participant"):
        return {
            "error": (
                f"{facility['name']} isn't confirmed as a participant in {state}'s modeled charity-care program -- "
                "direct the user to this hospital's own billing/financial-assistance office instead."
            )
        }
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
        "charges referenced above. "
        + (program["letter_basis"] + " " if "letter_basis" in program else
           "Based on my household income and size, I believe I qualify for a reduced-charge tier "
           f"(patient responsibility: {patient_pays_pct}% of billed charges). ")
        + "I have enclosed proof of income, residency and insurance status. "
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


# nj_charity_tier stays importable for older callers, but the agent only needs charity_tier.
ELIGIBILITY_TOOLS = [fpl_percent, charity_tier]
COST_TOOLS = [facilities_with_drg, estimate_cost, apply_tier_to_charge]
QUALITY_TOOLS = [facilities_near, nearest_fqhc, nearest_urgent_care]
ADVOCATE_TOOLS = [draft_application]

ALL_TOOLS = ELIGIBILITY_TOOLS + COST_TOOLS + QUALITY_TOOLS + ADVOCATE_TOOLS
DATA_TOOL_NAMES = {t.tool_name for t in ALL_TOOLS}
