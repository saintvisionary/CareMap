from caremap.tools import (
    apply_tier_to_charge,
    charity_tier,
    draft_application,
    estimate_cost,
    facilities_near,
    facilities_with_drg,
    fpl_percent,
    nearest_fqhc,
    nj_charity_tier,
)


def test_eligibility_tools_demo_case():
    fpl = fpl_percent(annual_income=52_000, household_size=4)
    assert fpl["fpl_pct"] == 158
    tier = nj_charity_tier(fpl_pct=fpl["fpl_pct"])
    assert tier["patient_pays_pct"] == 0


def test_estimate_cost_known_facility():
    # Morristown Medical Center, DRG 419 (laparoscopic cholecystectomy), real
    # CMS Medicare Inpatient by Provider and Service figure.
    r = estimate_cost(ccn="310015", drg="419")
    assert r["typical_billed_charge"] == 70_584
    assert "estimate" in r["label"]


def test_estimate_cost_unknown_facility():
    r = estimate_cost(ccn="nope", drg="419")
    assert "error" in r


def test_facilities_with_drg_finds_morristown():
    # Replaces the blind facility-by-facility guessing an agent would
    # otherwise do with estimate_cost: one deterministic call.
    r = facilities_with_drg(zip_code="07960", drg="419", radius_miles=10)
    ccns = {f["ccn"] for f in r["facilities"]}
    assert "310015" in ccns
    match = next(f for f in r["facilities"] if f["ccn"] == "310015")
    assert match["typical_billed_charge"] == 70_584


def test_facilities_with_drg_no_match():
    r = facilities_with_drg(zip_code="07018", drg="419", radius_miles=1)
    assert "error" in r


def test_apply_tier_to_charge_zero_pct():
    r = apply_tier_to_charge(typical_billed_charge=70_584, patient_pays_pct=0)
    assert r["estimated_patient_owed"] == 0


def test_facilities_near_east_orange():
    # 07018 is Carewell Health Medical Center's own zip (East Orange, NJ).
    r = facilities_near(zip_code="07018", radius_miles=5, types=["acute_care_hospital"])
    names = [f["name"] for f in r["facilities"]]
    assert "CAREWELL HEALTH MEDICAL CENTER" in names
    # sorted nearest-first
    dists = [f["distance_miles"] for f in r["facilities"]]
    assert dists == sorted(dists)


def test_nearest_fqhc_not_yet_in_dataset():
    # FQHC data (HRSA sites) hasn't been pulled in yet.
    # Should fail gracefully, not crash or invent a facility.
    r = nearest_fqhc(zip_code="07018", radius_miles=25)
    assert "error" in r


def test_draft_application():
    r = draft_application(ccn="310015", patient_pays_pct=0)
    assert "MORRISTOWN MEDICAL CENTER" in r["letter"]
    assert len(r["checklist"]) >= 4


def test_charity_tier_dispatches_by_facility_state():
    assert charity_tier(state="NJ", fpl_pct=150)["patient_pays_pct"] == 0
    assert charity_tier(state="WA", fpl_pct=220)["patient_pays_pct"] == 25


def test_charity_tier_unmodeled_state_errors_not_guesses():
    r = charity_tier(state="TX", fpl_pct=150)
    assert "error" in r


def test_draft_application_wa_facility():
    # PROVIDENCE ST MARY MEDICAL CENTER, a real WA acute care hospital.
    r = draft_application(ccn="500002", patient_pays_pct=25)
    assert "PROVIDENCE ST MARY MEDICAL CENTER" in r["letter"]
    assert "Washington hospital charity care" in r["letter"]
    assert "WA residency" in r["checklist"][0]
    # WA's policy.json entry has no confirmed apply-window/help-phone (unlike
    # NJ) -- must not be fabricated into the output.
    assert "help_phone" not in r
    assert not any("Submit within" in item for item in r["checklist"])


def test_draft_application_unmodeled_state_errors_not_guesses():
    # Any non-NJ/WA facility -- draft_application must say so, not invent a
    # charity-care program that doesn't exist for that state.
    r = facilities_near(zip_code="90001", radius_miles=50, types=["acute_care_hospital"])
    ca_ccn = next((f["ccn"] for f in r.get("facilities", []) if f.get("state") == "CA"), None)
    if ca_ccn is None:
        return  # CA data not loaded in this environment -- nothing to assert
    result = draft_application(ccn=ca_ccn, patient_pays_pct=0)
    assert "error" in result


def test_charity_tier_il_free_care():
    assert charity_tier(state="IL", fpl_pct=150, facility_type="acute_care_hospital")["patient_pays_pct"] == 0
    # Same income, different threshold at a Critical Access Hospital (125%
    # FPL, not 200%) -- above its threshold, so no tier.
    r = charity_tier(state="IL", fpl_pct=150, facility_type="critical_access_hospital")
    assert "error" in r


def test_charity_tier_il_above_threshold_discloses_ccr_gap_and_income_cap():
    # Above IL's free-care line the real law has no clean percentage (needs
    # a cost-to-charge ratio CareMap doesn't have) -- must say that AND the
    # real 20%-of-income cap, not just a generic "not modeled" message.
    r = charity_tier(state="IL", fpl_pct=400, facility_type="acute_care_hospital")
    assert "error" in r
    assert "cost-to-charge ratio" in r["error"]
    assert "20%" in r["error"]


def test_draft_application_il_facility():
    # GRAHAM HOSPITAL ASSOCIATION, a real IL acute care hospital (CCN 140001).
    r = draft_application(ccn="140001", patient_pays_pct=0)
    assert "GRAHAM HOSPITAL ASSOCIATION" in r["letter"]
    assert "Illinois Hospital Uninsured Patient Discount Act" in r["letter"]
    assert "IL residency" in r["checklist"][0]
    # IL's policy.json entry has no confirmed apply-window/help-phone either.
    assert "help_phone" not in r
    assert not any("Submit within" in item for item in r["checklist"])


def test_charity_tier_ny_free_care():
    assert charity_tier(state="NY", fpl_pct=150)["patient_pays_pct"] == 0


def test_charity_tier_ny_above_threshold_discloses_no_cap_fact():
    # Unlike IL, NY has no disclosable cap fact above its free-care line --
    # the real cap is of a Medicaid-equivalent rate CareMap doesn't have at
    # all. Must say that plainly and NOT state or imply a specific cap
    # percentage like IL's 20%-of-income cap.
    r = charity_tier(state="NY", fpl_pct=300)
    assert "error" in r
    assert "Medicaid-equivalent" in r["error"]


def test_draft_application_ny_facility():
    # KALEIDA HEALTH, a real NY acute care hospital (CCN 330005).
    r = draft_application(ccn="330005", patient_pays_pct=0)
    assert "KALEIDA HEALTH" in r["letter"]
    assert "New York Hospital Financial Assistance Law" in r["letter"]
    assert "NY residency" in r["checklist"][0]
    assert "help_phone" not in r
    assert not any("Submit within" in item for item in r["checklist"])


def test_charity_tier_or_requires_ownership():
    # MID-COLUMBIA MEDICAL CENTER's real ownership string.
    assert charity_tier(state="OR", fpl_pct=250, ownership="Voluntary non-profit - Private")["patient_pays_pct"] == 25
    r = charity_tier(state="OR", fpl_pct=150, ownership="Government - Local")
    assert "error" in r
    assert "nonprofit" in r["error"]
    # Omitting ownership entirely must not silently assume nonprofit.
    assert "error" in charity_tier(state="OR", fpl_pct=150)


def test_draft_application_or_nonprofit_facility():
    # MID-COLUMBIA MEDICAL CENTER, a real OR nonprofit acute care hospital.
    r = draft_application(ccn="380001", patient_pays_pct=0)
    assert "MID-COLUMBIA MEDICAL CENTER" in r["letter"]
    assert "Oregon hospital financial assistance law" in r["letter"]
    assert "OR residency" in r["checklist"][0]


def test_draft_application_or_non_nonprofit_facility_errors():
    # BAY AREA HOSPITAL is government-owned (Hospital District or
    # Authority) -- ORS 442.610 doesn't cover it, so draft_application must
    # refuse rather than draft a letter citing a law that doesn't apply.
    r = draft_application(ccn="380090", patient_pays_pct=0)
    assert "error" in r
    assert "nonprofit" in r["error"]
