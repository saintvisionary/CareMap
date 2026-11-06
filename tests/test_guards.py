from caremap.guards import EvidenceLedger, GroundingGuard, extract_numbers, labeling_violations


def test_extract_numbers():
    assert extract_numbers("You'd pay $0, typical charge $42,750, tier 0%") == [0.0, 42750.0, 0.0]


def test_ledger_grounding():
    led = EvidenceLedger(data_tools=set())
    led.numbers = {42750.0, 20.0}
    g = GroundingGuard(ledger=led)
    assert g.check("estimate, confirm with billing office: $42,750 at 20%")["ungrounded_numbers"] == []
    assert g.check("your price is $99,000")["ungrounded_numbers"] == [99000.0]


def test_labeling_forbidden_phrase():
    assert labeling_violations("Your price is $100, estimate, confirm with billing office.")


def test_labeling_requires_disclosure():
    violations = labeling_violations("The typical billed charge is $42,750.")
    assert any("estimate" in v for v in violations)


def test_labeling_passes_with_disclosure():
    assert labeling_violations(
        "The typical billed charge is $42,750. This is an estimate, confirm with billing office."
    ) == []


def test_guard_flags_missing_disclosure_and_requests_rewrite():
    led = EvidenceLedger(data_tools=set())
    led.numbers = {42750.0}
    g = GroundingGuard(ledger=led)
    report = g.check("The typical billed charge is $42,750.")
    assert report["passed"] is False
    assert report["ungrounded_numbers"] == []
    assert report["label_violations"]


def test_negated_forbidden_phrases_are_allowed():
    assert labeling_violations("A reference, not a guaranteed price. Estimate, confirm with billing office.") == []
    assert labeling_violations("This isn't your price.") == []
    assert labeling_violations("Your price is low.")
    assert labeling_violations("Free care is guaranteed.")
