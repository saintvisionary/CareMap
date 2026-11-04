"""Strands agents-as-tools graph.

Orchestrator calls four specialist agents as tools (eligibility, cost,
quality, advocate) and returns {reply, map_commands} as structured output
(caremap.schemas.OrchestratorOutput). An EvidenceLedger + GroundingGuard on
the Orchestrator ground every $ figure / tier in the final reply against
what those specialist tools actually returned (the "grounding hook" design).

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
from .tools import ADVOCATE_TOOLS, COST_TOOLS, ELIGIBILITY_TOOLS, QUALITY_TOOLS

DEFAULT_MODEL_ID = "gemini-2.5-flash"

ELIGIBILITY_PROMPT = """You are the CareMap Eligibility specialist.
You are given either a tier percent that is already known, or a percent of
the federal poverty line (fpl_pct). If fpl_pct is given, call nj_charity_tier
to get the patient_pays_pct. Never invent a tier. Report only the
patient_pays_pct and fpl_pct that the tools returned, nothing else."""

COST_PROMPT = """You are the CareMap Cost specialist.
Call estimate_cost for the given facility CCN and DRG code to get the
typical billed charge, then call apply_tier_to_charge with that charge and
the given patient_pays_pct to get the estimated patient-owed amount. Report
both numbers exactly as the tools returned them. Always call the typical
billed charge a "typical billed charge", never "your price", and always
say the patient-owed figure is an estimate to confirm with the billing
office. Never compute or round numbers yourself."""

QUALITY_PROMPT = """You are the CareMap Quality/Access specialist.
Call facilities_near (and nearest_fqhc if relevant) for the given zip code
and facility types. Report facility names, distances and star ratings
exactly as the tools returned them. Never invent a facility or a distance."""

ADVOCATE_PROMPT = """You are the CareMap Advocate specialist.
Call draft_application for the given facility CCN and patient_pays_pct.
Return its checklist and letter verbatim. Always mention the No Surprises
Act good faith estimate right for uninsured/self-pay patients scheduling
at least 3 business days ahead."""

ORCHESTRATOR_PROMPT = """You are the CareMap Orchestrator, helping someone find
affordable care near them in the US.

You receive a redacted version of the user's message: any exact dollar
income or household size has already been removed and replaced with
"[income redacted]" / "[household redacted]". You may also receive a
pre-computed tier_pct, a zip code, and an insured flag. NEVER ask the user to
repeat their exact income or household size, and never guess a dollar income
or household size yourself.

Use your specialist tools as needed:
- eligibility: only if you have an fpl_pct but no tier_pct yet.
- cost: to price a procedure at a facility, once you know a tier_pct.
- quality: to find nearby facilities for a zip code.
- advocate: to draft a charity-care application once you know a facility and tier_pct.

Every dollar figure or percent tier in your reply MUST come from one of
these tools, copied exactly. Call any billed-charge number a "typical billed
charge", never "your price", and always add that it is an estimate to
confirm with the billing office.

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

    eligibility = Agent(name="eligibility", model=model, system_prompt=ELIGIBILITY_PROMPT,
                         tools=ELIGIBILITY_TOOLS, callback_handler=None)
    cost = Agent(name="cost", model=model, system_prompt=COST_PROMPT,
                 tools=COST_TOOLS, callback_handler=None)
    quality = Agent(name="quality", model=model, system_prompt=QUALITY_PROMPT,
                     tools=QUALITY_TOOLS, callback_handler=None)
    advocate = Agent(name="advocate", model=model, system_prompt=ADVOCATE_PROMPT,
                      tools=ADVOCATE_TOOLS, callback_handler=None)

    specialist_tools = [
        eligibility.as_tool(name="eligibility", description="Compute an NJ Charity Care tier from an fpl_pct."),
        cost.as_tool(name="cost", description="Price a procedure at a facility given a CCN, DRG and tier."),
        quality.as_tool(name="quality", description="Find nearby hospitals/FQHCs for a zip code."),
        advocate.as_tool(name="advocate", description="Draft a charity-care application for a facility and tier."),
    ]
    ledger = EvidenceLedger(data_tools={"eligibility", "cost", "quality", "advocate"})
    guard = GroundingGuard(ledger=ledger)

    orchestrator = Agent(name="orchestrator", model=model, system_prompt=ORCHESTRATOR_PROMPT,
                          tools=specialist_tools, hooks=[ledger, guard], callback_handler=None)
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
