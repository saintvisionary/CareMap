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


def test_nearest_fqhc_returns_clinic_with_federal_rule():
    # HRSA health center site near the East Orange demo case.
    r = nearest_fqhc(zip_code="07018", radius_miles=25, fpl_pct=90)
    assert r["name"] == "EAST ORANGE PRIMARY CARE CENTER"
    assert "nominal fee" in r["sliding_fee_rule"]
    assert "drg_charges" not in r  # trimmed: clinics have no charge data


def test_nearest_fqhc_none_in_range_errors():
    assert "error" in nearest_fqhc(zip_code="07018", radius_miles=0.01)


def test_charity_tier_for_a_clinic_gives_federal_rule_not_a_tier():
    clinic = nearest_fqhc(zip_code="07018")
    r = charity_tier(state="NJ", fpl_pct=150, ccn=clinic["ccn"])
    assert r["facility_type"] == "fqhc" and "patient_pays_pct" not in r
    assert "sliding scale" in r["sliding_fee_rule"]


def test_facilities_near_default_excludes_clinics():
    r = facilities_near(zip_code="07018", radius_miles=5)
    assert r["facilities"] and all(f["type"] != "fqhc" for f in r["facilities"])


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


def test_charity_tier_md_full_sliding_scale():
    assert charity_tier(state="MD", fpl_pct=150)["patient_pays_pct"] == 0
    assert charity_tier(state="MD", fpl_pct=480)["patient_pays_pct"] == 65


def test_draft_application_md_facility():
    # MERITUS MEDICAL CENTER, a real MD acute care hospital (CCN 210001).
    r = draft_application(ccn="210001", patient_pays_pct=0)
    assert "MERITUS MEDICAL CENTER" in r["letter"]
    assert "Maryland hospital financial assistance law" in r["letter"]
    assert "MD residency" in r["checklist"][0]
    assert "Submit within 240 days" in r["checklist"][-1]


def test_charity_tier_ri_free_care_and_gap():
    assert charity_tier(state="RI", fpl_pct=150)["patient_pays_pct"] == 0
    r = charity_tier(state="RI", fpl_pct=250)
    assert "error" in r
    assert "each individual hospital" in r["error"]


def test_draft_application_ri_facility():
    # ROGER WILLIAMS MEDICAL CENTER, a real RI acute care hospital (CCN 410004).
    r = draft_application(ccn="410004", patient_pays_pct=0)
    assert "ROGER WILLIAMS MEDICAL CENTER" in r["letter"]
    assert "Rhode Island" in r["letter"]
    assert "RI residency" in r["checklist"][0]
    assert "help_phone" not in r


def test_charity_tier_ma_free_care_and_gap():
    assert charity_tier(state="MA", fpl_pct=100)["patient_pays_pct"] == 0
    r = charity_tier(state="MA", fpl_pct=250)
    assert "error" in r
    assert "Health Connector" in r["error"]


def test_charity_tier_me_gap_discloses_payment_plan_cap_only_up_to_400():
    # 1716-A(8): payment plans capped at 4% of monthly income up to 400% FPL.
    r = charity_tier(state="ME", fpl_pct=300)
    assert "4% of monthly family income" in r["error"]
    assert "residents only" in r["error"]
    r = charity_tier(state="ME", fpl_pct=450)
    assert "4% of monthly" not in r["error"]


def test_draft_application_me_facility():
    # ST JOSEPH HOSPITAL, a real ME acute care hospital (CCN 200001).
    r = draft_application(ccn="200001", patient_pays_pct=0)
    assert "ST JOSEPH HOSPITAL" in r["letter"]
    assert "Maine's free hospital care law" in r["letter"]
    assert "ME residency" in r["checklist"][0]


def test_charity_tier_vt_gap_lists_only_protections_that_apply():
    r = charity_tier(state="VT", fpl_pct=300)["error"]
    assert "at least 40%" in r and "20% of household income" in r
    r = charity_tier(state="VT", fpl_pct=500)["error"]
    assert "at least 40%" not in r and "20% of household income" in r
    r = charity_tier(state="VT", fpl_pct=700)["error"]
    assert "at least 40%" not in r and "20% of household income" not in r
    assert "residents only" in r


def test_draft_application_vt_facility():
    # CENTRAL VERMONT MEDICAL CENTER, a real VT acute care hospital (CCN 470001).
    r = draft_application(ccn="470001", patient_pays_pct=0)
    assert "CENTRAL VERMONT MEDICAL CENTER" in r["letter"]
    assert "Vermont's hospital financial assistance law" in r["letter"]
    assert "VT residency" in r["checklist"][0]


def test_draft_application_ma_facility():
    # UMASS MEMORIAL HEALTHALLIANCE HOSPITALS, a real MA acute care hospital (CCN 220001).
    r = draft_application(ccn="220001", patient_pays_pct=0)
    assert "UMASS MEMORIAL HEALTHALLIANCE HOSPITALS" in r["letter"]
    assert "Health Safety Net" in r["letter"]
    assert "MA residency" in r["checklist"][0]


def test_charity_tier_gap_disclosures_nc_oh_sc():
    assert "5% of monthly household income" in charity_tier(state="NC", fpl_pct=250)["error"]
    assert "100% FPL" in charity_tier(state="OH", fpl_pct=150)["error"]
    assert "county" in charity_tier(state="SC", fpl_pct=150)["error"]


def test_draft_application_nc_oh_sc_facilities():
    for ccn, name, st in [
        ("340001", "CAROLINAS MEDICAL CENTER-NORTHEAST", "NC"),
        ("360180", "CLEVELAND CLINIC", "OH"),
        ("420004", "MUSC MEDICAL CENTER", "SC"),
    ]:
        r = draft_application(ccn=ccn, patient_pays_pct=0)
        assert name in r["letter"]
        assert f"{st} residency" in r["checklist"][0]


def test_charity_tier_nv_requires_major_hospital():
    assert "error" in charity_tier(state="NV", fpl_pct=150)  # no ccn: can't tell
    r = charity_tier(state="NV", fpl_pct=150, ccn="290003")  # Sunrise, 834 beds
    assert r["patient_pays_pct"] == 70 and "30 days" in r["note"]
    # University Medical Center: county-run, so not a "major hospital" even
    # though CMS labels it nonprofit.
    assert "error" in charity_tier(state="NV", fpl_pct=150, ccn="290007")


def test_non_participant_never_gets_a_tier():
    # Novant Ballantyne isn't on NCDHHS's participating list.
    assert "error" in charity_tier(state="NC", fpl_pct=150, ccn="340195")
    assert "error" in draft_application(ccn="340195", patient_pays_pct=0)
    r = draft_application(ccn="290003", patient_pays_pct=70)
    assert "Nevada" in r["letter"]
