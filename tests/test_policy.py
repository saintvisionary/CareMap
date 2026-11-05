from caremap.policy import apply_tier, charity_tier, fpl_amount, fpl_percent, il_charity_tier, ma_charity_tier, md_charity_tier, me_charity_tier, nj_charity_tier, ny_charity_tier, or_charity_tier, ri_charity_tier, vt_charity_tier, wa_charity_tier


def test_demo_case_family_of_4():
    # Demo case: family of 4, $52,000 -> 158% FPL -> NJ tier 0%
    pct = fpl_percent(52_000, 4)
    assert pct == 158
    tier = nj_charity_tier(pct)
    assert tier["patient_pays_pct"] == 0


def test_fpl_amount_known_sizes():
    assert fpl_amount(1) == 15_960
    assert fpl_amount(4) == 33_000


def test_fpl_amount_extrapolates_above_4():
    assert fpl_amount(5) == 33_000 + 5_680
    assert fpl_amount(6) == 33_000 + 5_680 * 2


def test_nj_tier_boundaries():
    assert nj_charity_tier(200)["patient_pays_pct"] == 0
    assert nj_charity_tier(201)["patient_pays_pct"] == 20
    assert nj_charity_tier(225)["patient_pays_pct"] == 20
    assert nj_charity_tier(226)["patient_pays_pct"] == 40
    assert nj_charity_tier(300)["patient_pays_pct"] == 80
    assert nj_charity_tier(301)["patient_pays_pct"] == 100
    assert nj_charity_tier(1000)["patient_pays_pct"] == 100


def test_apply_tier():
    assert apply_tier(42_750, 0) == 0
    assert apply_tier(42_750, 20) == 8_550
    assert apply_tier(42_750, 100) == 42_750


def test_wa_tier_boundaries():
    # RCW 70.170.060(5)(b), the floor every WA hospital must offer --
    # verified against the current codified statute (app.leg.wa.gov), not
    # the 2022 bill text alone (a 2025 amendment changed it).
    assert wa_charity_tier(200)["patient_pays_pct"] == 0
    assert wa_charity_tier(201)["patient_pays_pct"] == 25
    assert wa_charity_tier(250)["patient_pays_pct"] == 25
    assert wa_charity_tier(251)["patient_pays_pct"] == 50
    assert wa_charity_tier(300)["patient_pays_pct"] == 50
    assert wa_charity_tier(301)["patient_pays_pct"] == 100
    assert wa_charity_tier(1000)["patient_pays_pct"] == 100


def test_charity_tier_dispatches_by_state():
    assert charity_tier("NJ", 150)["patient_pays_pct"] == nj_charity_tier(150)["patient_pays_pct"]
    assert charity_tier("WA", 150)["patient_pays_pct"] == wa_charity_tier(150)["patient_pays_pct"]


def test_charity_tier_unmodeled_state_returns_none():
    # Most states have no state-wide formula -- federal 501(r) just requires
    # each nonprofit hospital to have *a* policy, with no public structured
    # dataset of what it says. Returning None (not a guessed tier) here is
    # the whole point.
    assert charity_tier("TX", 150) is None
    assert charity_tier("CA", 150) is None


def test_il_tier_free_care_thresholds():
    # 210 ILCS 89/10 -- verified directly against the current codified text.
    # Standard hospitals: free up to 200% FPL. Critical Access: up to 125%.
    assert il_charity_tier(200, is_critical_access=False)["patient_pays_pct"] == 0
    assert il_charity_tier(201, is_critical_access=False) is None
    assert il_charity_tier(125, is_critical_access=True)["patient_pays_pct"] == 0
    assert il_charity_tier(126, is_critical_access=True) is None
    # Same income, different threshold depending on hospital type -- the
    # whole reason this needs an is_critical_access parameter at all.
    assert il_charity_tier(150, is_critical_access=False)["patient_pays_pct"] == 0
    assert il_charity_tier(150, is_critical_access=True) is None


def test_il_tier_above_free_threshold_returns_none_not_a_guess():
    # The real statutory discount above the free-care line is charges x
    # (1 - cost_to_charge_ratio x 1.35) -- needs a per-hospital CMS cost
    # report value CareMap doesn't have loaded. Must never approximate a
    # percentage here; None is the honest answer until that data exists.
    assert il_charity_tier(400, is_critical_access=False) is None
    assert il_charity_tier(250, is_critical_access=True) is None


def test_charity_tier_dispatch_passes_facility_type_for_il():
    assert charity_tier("IL", 150, "acute_care_hospital")["patient_pays_pct"] == 0
    assert charity_tier("IL", 150, "critical_access_hospital") is None
    # Other states' formulas don't depend on facility_type -- must not break
    # when it's passed anyway (IL's own dispatch entry ignores it) or
    # omitted (existing NJ/WA callers predate this parameter).
    assert charity_tier("NJ", 150, "critical_access_hospital")["patient_pays_pct"] == 0
    assert charity_tier("WA", 150)["patient_pays_pct"] == 0


def test_ny_tier_free_care_threshold():
    # PBH 2807-k(9-a), post 2024-04-20 amendment -- verified directly
    # against the current codified text. Free up to 200% FPL.
    assert ny_charity_tier(200)["patient_pays_pct"] == 0
    assert ny_charity_tier(201) is None
    assert ny_charity_tier(0)["patient_pays_pct"] == 0


def test_ny_tier_above_free_threshold_returns_none_not_a_guess():
    # Above 200% FPL, NY caps payment at 10-20% of the MEDICAID-EQUIVALENT
    # rate for the service -- a different dollar base than the billed
    # charges CareMap has, and CareMap has no Medicaid-rate data at all.
    # Unlike IL (whose 20%-of-income cap needed no extra dataset), there
    # isn't even a disclosable cap fact here. Must return None, never a
    # guessed percentage.
    assert ny_charity_tier(250) is None
    assert ny_charity_tier(400) is None
    assert ny_charity_tier(1000) is None


def test_charity_tier_dispatches_ny():
    assert charity_tier("NY", 150)["patient_pays_pct"] == 0
    assert charity_tier("NY", 300) is None


NONPROFIT = "Voluntary non-profit - Private"


def test_or_tier_full_sliding_scale():
    # ORS 442.614(1)(a) -- verified directly against the current codified
    # text. Statutory MINIMUM discounts, so these are the floor (maximum
    # a patient is guaranteed not to exceed), the same framing as WA.
    assert or_charity_tier(200, ownership=NONPROFIT)["patient_pays_pct"] == 0
    assert or_charity_tier(201, ownership=NONPROFIT)["patient_pays_pct"] == 25
    assert or_charity_tier(300, ownership=NONPROFIT)["patient_pays_pct"] == 25
    assert or_charity_tier(301, ownership=NONPROFIT)["patient_pays_pct"] == 50
    assert or_charity_tier(350, ownership=NONPROFIT)["patient_pays_pct"] == 50
    assert or_charity_tier(351, ownership=NONPROFIT)["patient_pays_pct"] == 75
    assert or_charity_tier(400, ownership=NONPROFIT)["patient_pays_pct"] == 75
    assert or_charity_tier(401, ownership=NONPROFIT)["patient_pays_pct"] == 100
    assert or_charity_tier(1000, ownership=NONPROFIT)["patient_pays_pct"] == 100


def test_or_tier_requires_confirmed_nonprofit_ownership():
    # ORS 442.612(8) only covers nonprofit hospitals -- a for-profit or
    # government-owned OR hospital gets no tier, never a guessed one, and
    # neither does an unknown ownership (the safe default).
    assert or_charity_tier(150, ownership="Proprietary") is None
    assert or_charity_tier(150, ownership="Government - Local") is None
    assert or_charity_tier(150, ownership=None) is None


def test_charity_tier_dispatches_or():
    assert charity_tier("OR", 250, ownership=NONPROFIT)["patient_pays_pct"] == 25
    assert charity_tier("OR", 250, ownership="Proprietary") is None


def test_md_tier_full_sliding_scale():
    # Md. Code, Health-General 19-214.1 -- verified directly against the
    # current codified text. A real 7-band scale, applies regardless of
    # ownership (unlike OR's nonprofit-only gate).
    assert md_charity_tier(200)["patient_pays_pct"] == 0
    assert md_charity_tier(201)["patient_pays_pct"] == 25
    assert md_charity_tier(250)["patient_pays_pct"] == 25
    assert md_charity_tier(251)["patient_pays_pct"] == 40
    assert md_charity_tier(300)["patient_pays_pct"] == 40
    assert md_charity_tier(301)["patient_pays_pct"] == 50
    assert md_charity_tier(350)["patient_pays_pct"] == 50
    assert md_charity_tier(351)["patient_pays_pct"] == 55
    assert md_charity_tier(400)["patient_pays_pct"] == 55
    assert md_charity_tier(401)["patient_pays_pct"] == 60
    assert md_charity_tier(450)["patient_pays_pct"] == 60
    assert md_charity_tier(451)["patient_pays_pct"] == 65
    assert md_charity_tier(500)["patient_pays_pct"] == 65
    assert md_charity_tier(501)["patient_pays_pct"] == 100


def test_charity_tier_dispatches_md():
    assert charity_tier("MD", 220)["patient_pays_pct"] == 25
    # ownership/facility_type must be ignored, not required or error.
    assert charity_tier("MD", 220, "critical_access_hospital", "Proprietary")["patient_pays_pct"] == 25


def test_ri_tier_free_care_threshold():
    # 216-RICR-40-10-23.14 -- verified directly against the current
    # regulatory text. Free up to 200% FPL.
    assert ri_charity_tier(200)["patient_pays_pct"] == 0
    assert ri_charity_tier(201) is None


def test_ri_tier_above_threshold_returns_none_not_a_guess():
    # Unlike IL, RI has no disclosable cap fact above its free-care line --
    # the regulation delegates 200-300% FPL to each hospital and says
    # nothing above 300% at all. Must return None, never a guessed figure.
    assert ri_charity_tier(250) is None
    assert ri_charity_tier(400) is None


def test_charity_tier_dispatches_ri():
    assert charity_tier("RI", 150)["patient_pays_pct"] == 0
    assert charity_tier("RI", 250) is None


def test_ma_tier_free_care_threshold():
    # 101 CMR 613.04 -- verified directly against the current regulatory
    # text. Free up to 150% FPL, LOWER than the 200% line most other
    # modeled states use.
    assert ma_charity_tier(150)["patient_pays_pct"] == 0
    assert ma_charity_tier(151) is None


def test_ma_tier_above_threshold_returns_none_not_a_guess():
    # 150-300% FPL's deductible is a flat dollar amount needing MA Health
    # Connector premium data CareMap doesn't have -- must return None.
    assert ma_charity_tier(250) is None
    assert ma_charity_tier(400) is None


def test_charity_tier_dispatches_ma():
    assert charity_tier("MA", 100)["patient_pays_pct"] == 0
    assert charity_tier("MA", 200) is None


def test_me_tier_free_care_threshold():
    # 22 M.R.S. 1716-A(2): free at or below 200% FPL, no sliding scale above.
    assert me_charity_tier(200)["patient_pays_pct"] == 0
    assert me_charity_tier(201) is None
    assert charity_tier("ME", 150)["patient_pays_pct"] == 0
    assert charity_tier("ME", 350) is None


def test_vt_tier_free_care_threshold():
    # 18 V.S.A. 9482(b)(2)(A): free at or below 250% FPL. Above it the
    # discount is off each hospital's own AGB, so no tier is computed.
    assert vt_charity_tier(250)["patient_pays_pct"] == 0
    assert vt_charity_tier(251) is None
    assert charity_tier("VT", 220)["patient_pays_pct"] == 0


def test_free_tier_states_nc_oh_sc():
    # NC: "100% for individuals with incomes below 200% FPL" -- strictly below.
    assert charity_tier("NC", 199)["patient_pays_pct"] == 0
    assert charity_tier("NC", 200) is None
    assert "$35" in charity_tier("NC", 150)["note"]
    # OH (OAC 5160-2-17) and SC (Regs. 126-520(C)): at or below 100% FPL.
    assert charity_tier("OH", 100)["patient_pays_pct"] == 0
    assert charity_tier("OH", 101) is None
    assert charity_tier("SC", 100)["patient_pays_pct"] == 0
    assert charity_tier("SC", 101) is None


def test_nv_flat_share_any_income():
    # NRS 439B.260: at least 30% off total billed charges, no income test.
    assert charity_tier("NV", 50)["patient_pays_pct"] == 70
    assert charity_tier("NV", 900)["patient_pays_pct"] == 70


def test_fqhc_sliding_fee_bands():
    # 42 CFR 51c.303(f): full discount at or below 100% FPL (nominal fee
    # allowed), clinic's own scale to 200%, no discount required above.
    from caremap.policy import fqhc_sliding_fee
    assert "Full discount" in fqhc_sliding_fee(100)["sliding_fee_rule"]
    assert "sliding scale" in fqhc_sliding_fee(150)["sliding_fee_rule"]
    assert "No income-based discount" in fqhc_sliding_fee(201)["sliding_fee_rule"]
    assert "can't deny service" in fqhc_sliding_fee(None)["cannot_be_turned_away"]


def test_ct_tier_needs_a_ratio_and_income_line():
    assert charity_tier("CT", 250, cost_cap_pct=30)["patient_pays_pct"] == 30
    assert charity_tier("CT", 251, cost_cap_pct=30) is None
    assert charity_tier("CT", 150) is None
