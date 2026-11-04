from caremap.intake import redact


def test_demo_sentence_redacts_income_and_household():
    hint = redact("East Orange, family of 4, $52k, uninsured, need gallbladder surgery")
    assert hint.zip_code is None  # no 5-digit zip in this sentence
    assert hint.insured is False
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
    hint = redact("I'm in 07019, insured, need a checkup")
    assert hint.zip_code == "07019"
    assert hint.insured is True
    assert hint.tier_pct is None


def test_no_tier_without_both_income_and_household():
    hint = redact("family of 4, uninsured, need surgery")
    assert hint.tier_pct is None
    hint2 = redact("$52k income, uninsured")
    assert hint2.tier_pct is None
