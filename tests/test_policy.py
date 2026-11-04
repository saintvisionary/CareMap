from caremap.policy import apply_tier, charity_tier, fpl_amount, fpl_percent, nj_charity_tier, wa_charity_tier


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
