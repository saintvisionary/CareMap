from caremap.intake import redact


def test_demo_sentence_redacts_income_and_household():
    hint = redact("East Orange, family of 4, $52k, uninsured, need gallbladder surgery")
    assert hint.zip_code is None  # no 5-digit zip in this sentence
    assert hint.insurance_type == "uninsured"
    assert hint.tier_pct == 0
    assert "$52k" not in hint.redacted_message
    assert "family of 4" not in hint.redacted_message
    assert "[income redacted]" in hint.redacted_message
    assert "[household redacted]" in hint.redacted_message
    assert "52" not in hint.redacted_message


def test_plain_digit_dollar_amount_no_commas():
    # The guided-form UI builds messages like "$52000" (no thousands comma) --
    # regression test for a regex that originally only matched "$52,000".
    hint = redact("07018, family of 4, $52000, uninsured, need gallbladder surgery")
    assert hint.tier_pct == 0
    assert "$52000" not in hint.redacted_message
    assert "[income redacted]" in hint.redacted_message


def test_zip_extracted():
    hint = redact("I'm in 07019, private insurance, need a checkup")
    assert hint.zip_code == "07019"
    assert hint.insurance_type == "private"
    assert hint.tier_pct is None


def test_no_tier_without_both_income_and_household():
    hint = redact("family of 4, uninsured, need surgery")
    assert hint.tier_pct is None
    hint2 = redact("$52k income, uninsured")
    assert hint2.tier_pct is None


def test_insured_person_gets_no_charity_care_tier():
    # NJ Charity Care is uninsured/underinsured only. A privately insured
    # person must never get a tier_pct (e.g. a false "$0"), even though the
    # FPL math would otherwise produce one. Raw numbers are still redacted.
    hint = redact("07018, family of 4, $52k, private insurance, need gallbladder surgery")
    assert hint.insurance_type == "private"
    assert hint.tier_pct is None
    assert "[income redacted]" in hint.redacted_message
    assert "[household redacted]" in hint.redacted_message


def test_medicaid_gets_no_charity_care_tier():
    # policy.json's own rule: must be uninsured/underinsured AND not
    # Medicaid-eligible. Medicaid coverage must never produce a tier.
    hint = redact("07018, family of 4, $52k, medicaid, need gallbladder surgery")
    assert hint.insurance_type == "medicaid"
    assert hint.tier_pct is None


def test_medicare_detected():
    hint = redact("medicare, need a checkup")
    assert hint.insurance_type == "medicare"


def test_va_tricare_detected():
    assert redact("I have tricare, need a checkup").insurance_type == "va_tricare"
    assert redact("I have VA insurance, need a checkup").insurance_type == "va_tricare"
    assert redact("covered through veterans affairs, need a checkup").insurance_type == "va_tricare"


def test_va_does_not_false_positive_on_state_abbreviation():
    # "VA" alone (e.g. a state abbreviation) must not be read as VA/Tricare
    # coverage -- only specific phrases like "VA insurance" or "tricare" count.
    hint = redact("Richmond VA, private insurance, need a checkup")
    assert hint.insurance_type == "private"


def test_unsure_detected():
    hint = redact("not sure about my insurance, need a checkup")
    assert hint.insurance_type == "unsure"
    assert hint.tier_pct is None


def test_veteran_flag_independent_of_insurance_type():
    # A veteran can still be uninsured and eligible for NJ Charity Care --
    # veteran status and insurance_type are separate, orthogonal facts.
    hint = redact("07018, family of 4, $52k, uninsured, veteran, need gallbladder surgery")
    assert hint.veteran is True
    assert hint.insurance_type == "uninsured"
    assert hint.tier_pct == 0


def test_not_a_veteran_by_default():
    assert redact("uninsured, need a checkup").veteran is False
