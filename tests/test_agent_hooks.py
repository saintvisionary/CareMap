"""Integration test: a real Strands Agent wired with our hooks, driven by a
ScriptedModel (no network, no API key). Proves EvidenceLedger/GroundingGuard
actually attach to AfterToolCallEvent/AfterInvocationEvent on a live Agent,
not just that the .check()/.on_tool() methods work in isolation
(tests/test_guards.py already covers that)."""
from strands import Agent

from caremap.guards import EvidenceLedger, GroundingGuard
from caremap.tools import COST_TOOLS, DATA_TOOL_NAMES
from tests.scripted_model import ScriptedModel

COST_CALLS = [("estimate_cost", {"ccn": "310015", "drg": "419"}),
              ("apply_tier_to_charge", {"typical_billed_charge": 70584, "patient_pays_pct": 0})]
GOOD_REPLY = ("The typical billed charge is $70,584. At your tier you owe an estimated $0. "
              "This is an estimate, confirm with billing office.")
BAD_REPLY = GOOD_REPLY.replace("$0", "$99,000")


def _build_agent(model):
    ledger = EvidenceLedger(data_tools=DATA_TOOL_NAMES)
    guard = GroundingGuard(ledger=ledger)
    agent = Agent(name="cost", model=model, tools=COST_TOOLS, hooks=[ledger, guard], callback_handler=None)
    return agent, ledger, guard


def test_ledger_captures_numbers_from_real_tool_calls():
    model = ScriptedModel([COST_CALLS, GOOD_REPLY])
    agent, ledger, guard = _build_agent(model)
    agent("price gallbladder surgery at Morristown Medical Center")
    assert 70584.0 in ledger.numbers
    assert 0.0 in ledger.numbers or ledger.is_grounded(0.0)
    assert guard.final["passed"] is True
    assert guard.rewrites == 0


def test_guard_forces_rewrite_on_ungrounded_number():
    model = ScriptedModel([COST_CALLS, BAD_REPLY, GOOD_REPLY])
    agent, ledger, guard = _build_agent(model)
    agent("price gallbladder surgery at Morristown Medical Center")
    assert guard.rewrites == 1
    assert guard.history[0]["ungrounded_numbers"] == [99000.0]
    assert guard.history[-1]["passed"] is True
