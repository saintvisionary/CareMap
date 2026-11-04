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
and the tier_pct/zip/insurance_type/veteran hints are ever put in a prompt
here -- insurance_type is a public coverage category (e.g. "medicaid"),
never a plan name or member ID.
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
pre-computed tier_pct, a zip code, an insurance_type category, and a
veteran flag. NEVER ask the user to repeat their exact income or household
size, and never guess a dollar income or household size yourself.

insurance_type is a public coverage category, never PII -- one of
"uninsured", "medicaid", "medicare", "private", "va_tricare", "unsure".
NJ Charity Care applies ONLY when insurance_type is "uninsured" (per its
own rule: uninsured/underinsured AND not Medicaid-eligible). For any other
value, never claim a tier, a "$0", or any charity-care price, even if a
tier_pct happens to be present:
- medicaid: Medicaid generally covers hospital care at little to no direct
  cost; point them to their Medicaid plan for billing questions.
- medicare: point them to Medicare or their Medicare Advantage plan.
- private: point them to their insurer for their specific copay/deductible.
- va_tricare: mention care through the VA system is an option; point them
  to Tricare for costs outside it.
- unsure / not given: say Charity Care applies only if uninsured/underinsured,
  and ask them to confirm their coverage status for a personal estimate.
You may still share a typical billed charge as a neutral reference point
regardless of insurance_type if they ask about cost.

If veteran is true, mention that VA facilities (shown as a distinct type in
facilities_near / facilities_with_drg results) may be worth considering,
regardless of their insurance_type -- not every veteran is VA-enrolled, so
this is independent of whether insurance_type is "va_tricare".

Use your tools as needed:
- fpl_percent, nj_charity_tier: only if you have income/household info the
  user volunteered as a band, or need to turn an fpl_pct into a tier; prefer
  the given tier_pct when it is already present.
- To price a procedure near a zip code: call facilities_with_drg(zip_code,
  drg) FIRST -- it only returns facilities that actually have billed-charge
  data for that DRG, nearest first. Then call estimate_cost on one of the
  CCNs it returns. Do NOT call estimate_cost on facility after facility
  hoping one has the data; most facilities only report a handful of DRGs,
  so guessing wastes many calls. If facilities_with_drg returns no matches,
  say so instead of guessing.
- apply_tier_to_charge: to turn a typical billed charge into an estimated
  patient-owed amount, once you know a tier_pct.
- facilities_near, nearest_fqhc: to find nearby facilities for a zip code
  when cost isn't the question.
- draft_application: to draft a charity-care application once you know a
  facility and tier_pct.

Every dollar figure or percent tier in your reply MUST come from one of
these tools. Never compute a new number yourself (e.g. never multiply a
charge by a percent by hand -- call apply_tier_to_charge for that). You may
round a tool-returned dollar figure to the nearest whole dollar for display
(e.g. 139950.8 -> "$139,951"), and MUST always format dollar amounts with
thousand-separator commas -- never write a raw unformatted number like
"$349877" or a figure with more than 2 decimal places like "$139950.8".
Call any billed-charge number a "typical billed charge", never "your price",
and always add that it is an estimate to confirm with the billing office.

Formatting: write for someone reading on a phone, not a billing report.
Lead with one short plain-language sentence. If you have more than one fact
to list (procedure, charge, tier, amount owed, a second facility, etc.),
put each on its own line as a markdown bullet ("- **Label:** value"), with
a real line break before each bullet -- never chain multiple facts into one
run-on sentence separated by " - ". Keep it skimmable.

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


def _prompt_for(hint: IntakeHint) -> str:
    context = [f"User message (redacted): {hint.redacted_message}"]
    if hint.zip_code:
        context.append(f"zip_code: {hint.zip_code}")
    if hint.insurance_type is not None:
        context.append(f"insurance_type: {hint.insurance_type}")
    context.append(f"veteran: {hint.veteran}")
    if hint.tier_pct is not None:
        context.append(f"tier_pct (already computed, NJ Charity Care): {hint.tier_pct}")
    return "\n".join(context)


def handle_message(
    message: str,
    orchestrator: Orchestrator | None = None,
    model=None,
    zip_code: str | None = None,
    insurance_type: str | None = None,
    veteran: bool | None = None,
    tier_pct: float | None = None,
) -> dict:
    """Entry point for the Lambda handler. Redacts, then runs the Orchestrator.

    zip_code/insurance_type/veteran/tier_pct are hints the caller already
    computed client-side (the browser's own redact() pass) and sent as
    separate fields alongside the redacted message text -- they take
    precedence over anything redact() re-derives from the message text
    here, since the message text alone may not restate them (e.g. a
    guided-form submission where the frontend sends the zip as structured
    data, not prose).

    Returns {reply, map_commands, audit, guard} -- audit/guard are for the
    grounding-hook log, not shown to the user.
    """
    orchestrator = orchestrator or build_orchestrator(model=model)
    hint = redact(message)
    if zip_code is not None:
        hint.zip_code = zip_code
    if insurance_type is not None:
        hint.insurance_type = insurance_type  # type: ignore[assignment]
    if veteran is not None:
        hint.veteran = veteran
    if tier_pct is not None:
        hint.tier_pct = tier_pct
    prompt = _prompt_for(hint)
    result = orchestrator.agent(prompt, structured_output_model=OrchestratorOutput)
    output: OrchestratorOutput = result.structured_output
    return {
        "reply": output.reply,
        "map_commands": [c.model_dump() for c in output.map_commands],
        "audit": orchestrator.ledger.audit,
        "guard": orchestrator.guard.final,
    }
