from caremap.policy import apply_tier, fpl_amount, fpl_percent, nj_charity_tier


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
