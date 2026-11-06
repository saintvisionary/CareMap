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
    assert no_em_dashes("Go to the ER\u2014do not drive.") == "Go to the ER, do not drive."
    assert no_em_dashes("a \u2014 b") == "a, b"
    assert no_em_dashes("a -- b") == "a, b"
    assert no_em_dashes("no dashes here, 2025-26") == "no dashes here, 2025-26"


def test_warmup_never_calls_the_model(monkeypatch):
    import json
    import caremap.lambda_handler as lh
    monkeypatch.setattr(lh, "_model", None)
    monkeypatch.setattr(lh, "make_model", lambda: "model")
    monkeypatch.setattr(lh, "handle_message", lambda *a, **k: (_ for _ in ()).throw(AssertionError("called")))
    out = lh.handler({"body": json.dumps({"warmup": True}), "requestContext": {"http": {"sourceIp": "w"}}}, None)
    assert out["statusCode"] == 200 and lh._model == "model"


def test_missing_disclosure_is_appended_not_rewritten():
    from caremap.guards import ensure_disclosure
    text = ensure_disclosure("The typical billed charge is $42,750.")
    assert text.endswith("confirm with billing office.")
    assert ensure_disclosure(text) == text
    assert ensure_disclosure("No dollar figures here.") == "No dollar figures here."


def test_each_lambda_request_gets_a_fresh_agent(monkeypatch):
    # Regression: a module-level agent kept every user's conversation and
    # tool numbers, so one user's session leaked into the next answer.
    import json
    import caremap.lambda_handler as lh
    built, used = [], []
    monkeypatch.setattr(lh, "_model", None)
    monkeypatch.setattr(lh, "make_model", lambda: "model")
    monkeypatch.setattr(lh, "build_orchestrator", lambda model=None: built.append(model) or object())
    monkeypatch.setattr(lh, "handle_message",
                        lambda message, orchestrator=None, **kw: used.append(orchestrator) or {"reply": "ok", "map_commands": []})
    event = {"requestContext": {"http": {"method": "POST", "sourceIp": "203.0.113.9"}}, "headers": {},
             "body": json.dumps({"message": "hospitals near 07018", "zipCode": "07018"})}
    assert lh.handler(event, None)["statusCode"] == 200
    assert lh.handler(event, None)["statusCode"] == 200
    assert built == ["model", "model"]  # model client reused, agent rebuilt
    assert used[0] is not used[1]


def test_prompt_carries_the_need_from_earlier_context():
    from caremap.agents import _prompt_for
    from caremap.intake import redact
    prompt = _prompt_for(redact("which one is cheapest?"), "gallbladder surgery")
    assert "need (what they're looking for" in prompt and "gallbladder surgery" in prompt
    assert "need" not in _prompt_for(redact("which one is cheapest?")).split("\n", 1)[-1]
