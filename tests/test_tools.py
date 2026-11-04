from caremap.tools import (
    apply_tier_to_charge,
    draft_application,
    estimate_cost,
    facilities_near,
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
