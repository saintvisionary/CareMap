"""Strands agent: a single Orchestrator with the eligibility, cost, quality
and advocate tools attached directly, returning {reply, map_commands} as
structured output (caremap.schemas.OrchestratorOutput). An EvidenceLedger +
GroundingGuard on the Orchestrator ground every $ figure / tier in the final
reply against what those tools actually returned (the "grounding hook"
design).

Earlier version wrapped each tool group in its own sub-agent, called via
Strands' agents-as-tools pattern (Orchestrator -> 4 specialist Agents, each
running its own tool-calling loop). That's a nice demonstration of the
pattern, but it chains 5+ sequential Gemini calls per user message, which
under free-tier latency/throttling pushed well past a reasonable Lambda
timeout. Collapsing to one Agent with all tools cuts that to 1-2 calls.

Privacy: caremap.intake.redact() runs BEFORE any of this, stripping raw
income/household size out of the user's message and replacing them with a
pre-computed tier_pct (hard rule: "Income/household size stay in
browser. Agent gets only tier + facility IDs."). Only the redacted message
and the tier_pct/zip/insured hints are ever put in a prompt here.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from strands import Agent

from .guards import EvidenceLedger, GroundingGuard
from .intake import IntakeHint, redact
from .schemas import OrchestratorOutput
from .tools import ALL_TOOLS, DATA_TOOL_NAMES

DEFAULT_MODEL_ID = "gemini-3.8-flash"

ORCHESTRATOR_PROMPT = """You are the CareMap Orchestrator, helping someone find
affordable care near them in the US.

You receive a redacted version of the user's message: any exact dollar
income or household size has already been removed and replaced with
"[income redacted]" / "[household redacted]". You may also receive a
pre-computed tier_pct, a zip code, and an insured flag. NEVER ask the user to
repeat their exact income or household size, and never guess a dollar income
or household size yourself.

Use your tools as needed:
- fpl_percent, nj_charity_tier: only if you have income/household info the
  user volunteered as a band, or need to turn an fpl_pct into a tier; prefer
  the given tier_pct when it is already present.
- estimate_cost, apply_tier_to_charge: to price a procedure at a facility,
  once you know a CCN, DRG and tier_pct.
- facilities_near, nearest_fqhc: to find nearby facilities for a zip code.
- draft_application: to draft a charity-care application once you know a
  facility and tier_pct.

Every dollar figure or percent tier in your reply MUST come from one of
these tools, copied exactly. Never compute or round a number yourself. Call
any billed-charge number a "typical billed charge", never "your price", and
always add that it is an estimate to confirm with the billing office.

Return your answer as the given structured schema: a short plain-language
reply, plus zero or more map_commands (type one of "flyTo", "highlight",
"filter", with a payload dict) describing how the map should react, e.g.
flyTo a facility's lat/lon, highlight the chosen facility's id, or filter by
facility type."""


def make_model(model_id: str | None = None):
    from strands.models.gemini import GeminiModel

    return GeminiModel(
        client_args={"api_key": os.environ["GEMINI_API_KEY"]},
        model_id=model_id or os.getenv("CAREMAP_MODEL_ID", DEFAULT_MODEL_ID),
        params={"temperature": 0.2},
    )


@dataclass
class Orchestrator:
    agent: Agent
    ledger: EvidenceLedger
    guard: GroundingGuard


def build_orchestrator(model=None) -> Orchestrator:
    model = model or make_model()
    ledger = EvidenceLedger(data_tools=DATA_TOOL_NAMES)
    guard = GroundingGuard(ledger=ledger)
    orchestrator = Agent(name="orchestrator", model=model, system_prompt=ORCHESTRATOR_PROMPT,
                          tools=ALL_TOOLS, hooks=[ledger, guard], callback_handler=None)
    return Orchestrator(agent=orchestrator, ledger=ledger, guard=guard)


def _prompt_for(message: str, hint: IntakeHint) -> str:
    context = [f"User message (redacted): {hint.redacted_message}"]
    if hint.zip_code:
        context.append(f"zip_code: {hint.zip_code}")
    if hint.insured is not None:
        context.append(f"insured: {hint.insured}")
    if hint.tier_pct is not None:
        context.append(f"tier_pct (already computed, NJ Charity Care): {hint.tier_pct}")
    return "\n".join(context)


def handle_message(message: str, orchestrator: Orchestrator | None = None, model=None) -> dict:
    """Entry point for the Lambda handler. Redacts, then runs the Orchestrator.

    Returns {reply, map_commands, audit, guard} -- audit/guard are for the
    grounding-hook log, not shown to the user.
    """
    orchestrator = orchestrator or build_orchestrator(model=model)
    hint = redact(message)
    prompt = _prompt_for(message, hint)
    result = orchestrator.agent(prompt, structured_output_model=OrchestratorOutput)
    output: OrchestratorOutput = result.structured_output
    return {
        "reply": output.reply,
        "map_commands": [c.model_dump() for c in output.map_commands],
        "audit": orchestrator.ledger.audit,
        "guard": orchestrator.guard.final,
    }
