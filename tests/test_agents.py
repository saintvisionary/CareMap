"""Tests for the hint hand-off between the Lambda payload and the prompt sent
to the model -- regression coverage for a real bug: the frontend sends
zip_code/insured/tier_pct as separate JSON fields (not restated in the
redacted message text), and handle_message must fold them into the hint
redact() builds from the message text, not silently drop them.
"""
from caremap.agents import _prompt_for
from caremap.intake import redact


def test_prompt_includes_hints_not_present_in_message_text():
    # Mirrors what the frontend actually sends: a message that has already
    # been redacted client-side (no zip code in the text itself) plus
    # separate zip_code/insured/tier_pct fields.
    hint = redact("[income redacted], [household redacted], uninsured, need gallbladder surgery")
    assert hint.zip_code is None  # confirms the text alone has no zip

    hint.zip_code = "07018"
    hint.insured = False
    hint.tier_pct = 0

    prompt = _prompt_for(hint)
    assert "zip_code: 07018" in prompt
    assert "insured: False" in prompt
    assert "tier_pct (already computed, NJ Charity Care): 0" in prompt


def test_prompt_omits_unset_hints():
    hint = redact("need gallbladder surgery")
    prompt = _prompt_for(hint)
    assert "zip_code" not in prompt
    assert "insured" not in prompt
    assert "tier_pct" not in prompt
