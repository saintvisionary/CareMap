"""Tests for the hint hand-off between the Lambda payload and the prompt sent
to the model -- regression coverage for a real bug: the frontend sends
zip_code/insurance_type/tier_pct as separate JSON fields (not restated in
the redacted message text), and handle_message must fold them into the
hint redact() builds from the message text, not silently drop them.
"""
from caremap.agents import _prompt_for
from caremap.intake import redact


def test_prompt_includes_hints_not_present_in_message_text():
    # Mirrors what the frontend actually sends: a message that has already
    # been redacted client-side (no zip code in the text itself) plus
    # separate zip_code/insurance_type/tier_pct fields.
    hint = redact("[income redacted], [household redacted], uninsured, need gallbladder surgery")
    assert hint.zip_code is None  # confirms the text alone has no zip

    hint.zip_code = "07018"
    hint.insurance_type = "uninsured"
    hint.veteran = True
    hint.tier_pct = 0
    hint.fpl_pct = 158

    prompt = _prompt_for(hint)
    assert "zip_code: 07018" in prompt
    assert "insurance_type: uninsured" in prompt
    assert "veteran: True" in prompt
    assert "tier_pct (already computed, NJ Charity Care formula specifically): 0" in prompt
    # fpl_pct is the state-agnostic value -- lets the model look up a
    # non-NJ facility's own tier (e.g. WA) via charity_tier instead.
    assert "fpl_pct (income as % of federal poverty line" in prompt
    assert "158" in prompt


def test_prompt_omits_unset_hints_but_always_states_veteran():
    hint = redact("need gallbladder surgery")
    prompt = _prompt_for(hint)
    assert "zip_code" not in prompt
    assert "insurance_type" not in prompt
    assert "tier_pct" not in prompt
    assert "fpl_pct" not in prompt
    # veteran always appears (defaults False) -- unlike the others, there's
    # no "we don't know yet" state worth representing for it.
    assert "veteran: False" in prompt


def test_no_em_dashes_in_replies():
    from caremap.lambda_handler import no_em_dashes
    assert no_em_dashes("Go to the ER\u2014do not drive.") == "Go to the ER -- do not drive."
    assert no_em_dashes("a \u2014 b") == "a -- b"
    assert no_em_dashes("no dashes here") == "no dashes here"
