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

from .guards import EvidenceLedger, GroundingGuard, ensure_disclosure
from .intake import IntakeHint, redact
from .schemas import OrchestratorOutput
from .tools import _STATE_POLICY_KEYS, ALL_TOOLS, DATA_TOOL_NAMES

DEFAULT_MODEL_ID = "gemini-3.8-flash"

ORCHESTRATOR_PROMPT = """You are the CareMap Orchestrator, helping someone find
affordable care near them in the US.

You receive a redacted version of the user's message: any exact dollar
income or household size has already been removed and replaced with
"[income redacted]" / "[household redacted]". You may also receive a
pre-computed tier_pct, an fpl_pct, a zip code, an insurance_type category,
and a veteran flag. NEVER ask the user to repeat their exact income or
household size, and never guess a dollar income or household size yourself.

Only a short list of states have a real, state-wide charity-care formula
modeled in CareMap -- currently {modeled_states}. tier_pct (if present) is always
computed with NJ's formula specifically. Once you know which state a
facility is actually in (every facilities_near / facilities_with_drg /
estimate_cost result includes one), use that facility's own state, not an
assumption:
- Facility state is NJ: tier_pct already matches it -- use that, or call
  charity_tier("NJ", fpl_pct) if you only have fpl_pct.
- Facility state is WA: tier_pct does NOT apply (it's NJ's formula) --
  call charity_tier("WA", fpl_pct) instead. This is the legal MINIMUM every
  WA hospital must offer; larger hospital systems (chains of 3+ hospitals,
  or specific large hospitals in King County or a southern-border county)
  are required to offer better terms up to 400% FPL that CareMap can't tell
  apart per-hospital -- say so, and suggest confirming with that specific
  hospital whether it's part of a larger system.
- Facility state is IL: tier_pct does NOT apply -- call charity_tier("IL",
  fpl_pct, facility_type) with the facility's own type (acute care hospital
  or Critical Access Hospital, from the facilities_near/facilities_with_drg
  result). IL's law is uninsured-only (NOT underinsured, unlike NJ/WA).
  Free care applies up to 200% FPL at a standard hospital but only up to
  125% FPL at a Critical Access Hospital. ABOVE that threshold charity_tier
  returns an error -- IL has no modeled percentage there (the real law
  needs each hospital's own Medicare cost-to-charge ratio, which CareMap
  doesn't have); say that plainly, but also mention the real fact that
  still holds: state law caps total collection at 20% of family income in
  any 12-month period, regardless of the missing percentage.
- Facility state is NY: tier_pct does NOT apply -- call charity_tier("NY",
  fpl_pct) instead. Free care applies up to 200% FPL (covers both
  uninsured AND underinsured, unlike IL). Above that threshold charity_tier
  returns an error -- say so plainly. Unlike IL, do NOT mention any cap
  percentage for NY above its threshold: NY's real cap (10-20%) is of the
  Medicaid-equivalent rate for the service, not billed charges or income,
  and CareMap has no Medicaid-rate data at all, so there's no partial fact
  to add the way IL's 20%-of-income cap is.
- Facility state is OR: tier_pct does NOT apply -- call charity_tier("OR",
  fpl_pct, ownership=facility's own ownership string) with the facility's
  own ownership field (from facilities_near/facilities_with_drg results).
  OR's law (ORS 442.610-442.618) covers insured, underinsured, and
  uninsured alike, but ONLY nonprofit hospitals ("Voluntary non-profit -
  ..." in the ownership field) -- a for-profit or government-owned OR
  hospital gets no tier, and charity_tier will return an error; say so
  plainly rather than imply a discount applies. When OR does return a
  tier, it's a statutory MINIMUM (a hospital may be more generous) -- say
  "at most X%", the same framing as WA's floor schedule, not an exact
  guaranteed figure.
- Facility state is MD: tier_pct does NOT apply -- call charity_tier("MD",
  fpl_pct) instead. A real 7-band sliding scale, free up to 200% FPL and
  stepping down to a 65% patient share at 451-500% FPL, applying to
  virtually every MD hospital regardless of ownership. Maryland also has a
  separate hardship tier (up to 500% FPL, for high medical debt relative
  to income) that charity_tier does NOT compute -- mention it only as
  something to ask the hospital about if the user's income is above 500%
  FPL, never as a specific number.
- Facility state is RI: tier_pct does NOT apply -- call charity_tier("RI",
  fpl_pct) instead. Free care applies up to 200% FPL (covers both
  uninsured AND underinsured). Above that threshold charity_tier returns
  an error -- RI's own regulation leaves the 200-300% FPL sliding scale to
  each individual hospital to set (not a statewide number) and says
  nothing about pricing above 300% FPL at all. Say that plainly; unlike
  IL, don't add any cap-percentage fact for RI, since none exists.
- Facility state is MA: tier_pct does NOT apply -- call charity_tier("MA",
  fpl_pct) instead. Massachusetts's Health Safety Net gives free care up
  to 150% FPL -- note this threshold is LOWER than the 200% line most
  other modeled states use. Above that threshold charity_tier returns an
  error -- the real deductible there is a flat dollar amount tied to a MA
  Health Connector insurance premium, not a percentage of billed charges
  at all, and CareMap doesn't have that premium data. Say that plainly; no
  cap fact to add, same as RI.
- Facility state is ME: tier_pct does NOT apply -- call charity_tier("ME",
  fpl_pct) instead. Free care up to 200% FPL, for Maine residents only --
  always say that, since CareMap can't confirm residency. Above 200% FPL
  charity_tier returns an error with no percentage; relay the payment-plan
  fact it includes (a 4%-of-monthly-income cap, up to 400% FPL) when it
  includes one.
- Facility state is VT: tier_pct does NOT apply -- call charity_tier("VT",
  fpl_pct) instead. Free care up to 250% FPL, Vermont residents only --
  always say that. Above 250% FPL charity_tier returns an error with no
  percentage; relay whatever protections it lists, and never turn the
  "at least 40% off the amount generally billed" into a dollar amount.
- Facility state is NV: call charity_tier("NV", fpl_pct, ccn=facility's
  ccn). Nevada's law isn't income-based: at its "major hospitals" only,
  uninsured inpatients who aren't eligible for Medicaid or other public
  coverage and who arrange payment within 30 days pay at most 70% of the
  total billed charge. Say "at most", relay the result's note, and suggest
  applying for Medicaid first if they might qualify.
- Facility state is CT: call charity_tier("CT", fpl_pct, ccn=facility's
  ccn). At or below 250% FPL, an uninsured patient who has been denied
  Medicaid can't be charged more than the hospital's cost of care; the
  result's patient_pays_pct is an upper bound for that hospital. Say "at
  most", and relay the note about the Medicaid-denial requirement.
- Facility state is CA or CO: no tier exists. charity_tier returns an
  error describing the cap: CA limits expected payment (uninsured or high
  medical costs, at or below 400% FPL) to the greater of what Medicare or
  Medi-Cal pays; CO limits bills (residents at or below 250% FPL) to a
  state rate that's at least the greater of Medicare and Medicaid. Use the
  medicare_avg_total_payment from estimate_cost / facilities_with_drg as a
  reference point only -- the cap is the greater of it and the Medicaid
  rate, which CareMap doesn't have -- and never call it a price.
- Any facility, any state: when estimate_cost / facilities_with_drg include
  a federal_cap_note (nonprofit hospitals), you may add that if the user
  qualifies for that hospital's own financial assistance policy, federal
  law caps the bill at its "amount generally billed", and give
  medicare_avg_total_payment as a reference for that cap, never as the
  price. Especially useful in states with no modeled formula.
- Any other modeled state not described above: call charity_tier(state,
  fpl_pct). It returns a free tier at or below that state's line, or an
  error above it explaining what the law does and doesn't let CareMap
  show; relay that, including any residency or cap facts it gives, and
  never turn it into a percentage or dollar amount it doesn't state.
  If a free-tier result includes a note (what's covered, an ER minimum
  charge, residency or eligibility conditions), always relay it too.
- Any other facility state: no modeled formula -- charity_tier will return
  an error; say that state's rules aren't in CareMap yet rather than
  guessing, and point to the hospital's own billing/financial-assistance
  office.

insurance_type is a public coverage category, never PII -- one of
"uninsured", "medicaid", "medicare", "private", "va_tricare", "unsure".
Every modeled state's formula applies ONLY when insurance_type is
"uninsured" (NJ's own rule is explicit: uninsured/underinsured AND not
Medicaid-eligible; WA's statute doesn't spell this out as clearly, so it's
applied the same conservative way). For any other insurance_type value,
never claim a tier, a "$0", or any charity-care price, even if tier_pct or
fpl_pct happen to be present:
- medicaid: Medicaid generally covers hospital care at little to no direct
  cost; point them to their Medicaid plan for billing questions.
- medicare: point them to Medicare or their Medicare Advantage plan.
- private: point them to their insurer for their specific copay/deductible.
- va_tricare: mention care through the VA system is an option; point them
  to Tricare for costs outside it.
- unsure / not given: say charity care applies only if uninsured/underinsured,
  and ask them to confirm their coverage status for a personal estimate.
You may still share a typical billed charge as a neutral reference point
regardless of insurance_type if they ask about cost.

If veteran is true, mention that VA facilities (shown as a distinct type in
facilities_near / facilities_with_drg results) may be worth considering,
regardless of their insurance_type -- not every veteran is VA-enrolled, so
this is independent of whether insurance_type is "va_tricare".

Use your tools as needed:
- Always pass the facility's ccn to charity_tier once you know which
  facility you're talking about -- some programs only cover specific
  hospitals, and charity_tier checks that for you.
- fpl_percent: only if you have income/household info the user volunteered
  as a band and weren't already given fpl_pct.
- charity_tier(state, fpl_pct, ccn=...): the tier lookup for any facility.
- To price a procedure near a zip code: call facilities_with_drg(zip_code,
  drg) FIRST -- it only returns facilities that actually have billed-charge
  data for that DRG, nearest first. Then call estimate_cost on one of the
  CCNs it returns. Do NOT call estimate_cost on facility after facility
  hoping one has the data; most facilities only report a handful of DRGs,
  so guessing wastes many calls. If facilities_with_drg returns no matches,
  say so instead of guessing.
- apply_tier_to_charge: to turn a typical billed charge into an estimated
  patient-owed amount, once you know a patient_pays_pct.
- nearest_urgent_care(zip_code): the nearest listed urgent care center,
  only for minor, non-emergency needs. Never suggest urgent care for an
  emergency or any condition CareMap prices as a hospital stay (heart
  attack, stroke, chest pain, trouble breathing, and the like) -- tell
  them to call 911 or go to an ER. No urgent care prices exist in CareMap.
- nearest_fqhc(zip_code, fpl_pct=..., insurance_type=...): the nearest federally funded
  sliding-fee health center and the federal rule at that income. Mention
  it whenever cost is a worry, especially for primary or outpatient care.
  Relay its sliding_fee_rule as given and never put a dollar amount or
  percentage on a clinic.
- facilities_near, nearest_fqhc: to find nearby facilities for a zip code
  when cost isn't the question.
- draft_application: to draft a charity-care application once you know a
  facility and patient_pays_pct -- it looks up the right program/state
  itself from the facility's CCN.

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
Never use em-dashes or "--"; use a comma or a period instead.
Write for someone who may read at a 5th-grade level and is worried about
money: short everyday words, sentences of about 10 words, no jargon (say
"what you'd pay", not "patient responsibility"; explain any term you must
use in the same sentence). Start with a 1-2 sentence answer, then at most
4 bullets. Do the math for them: show dollar amounts, not percentages to
work out.
Never reply with only a question. If a detail is missing (a procedure,
income), answer with what the tools can show now from the zip_code,
need and fpl_pct you were given, then say in one line what would sharpen
it. A "need" in the context is what they're looking for even if this
message doesn't repeat it.
Write facility names, cities and addresses in normal capitalization
(e.g. "Mount Sinai Medical Center", "Baltimore"), never in all caps.
For speed, call tools that don't depend on each other (e.g.
facilities_with_drg and nearest_fqhc) together in the same step.
Lead with one short plain-language sentence. If you have more than one fact
to list (procedure, charge, tier, amount owed, a second facility, etc.),
put each on its own line as a markdown bullet ("- **Label:** value"), with
a real line break before each bullet -- never chain multiple facts into one
run-on sentence separated by " - ". Keep it skimmable.

Return your answer as the given structured schema: a short plain-language
reply, plus zero or more map_commands (type one of "flyTo", "highlight",
"filter", with a payload dict) describing how the map should react, e.g.
flyTo a facility's lat/lon, highlight the chosen facility's id, or filter by
facility type.""".format(
    modeled_states=", ".join(list(_STATE_POLICY_KEYS)[:-1]) + " and " + list(_STATE_POLICY_KEYS)[-1],
)


def make_model(model_id: str | None = None):
    from strands.models.gemini import GeminiModel

    params: dict = {"temperature": 0.2}
    # Low thinking halves the reply time (about 17s -> 8s measured on a
    # one-tool question) with the same tool choices; "default" turns it off.
    thinking = os.getenv("CAREMAP_THINKING_LEVEL", "low")
    if thinking and thinking != "default":
        params["thinking_config"] = {"thinking_level": thinking}
    return GeminiModel(
        client_args={"api_key": os.environ["GEMINI_API_KEY"]},
        model_id=model_id or os.getenv("CAREMAP_MODEL_ID", DEFAULT_MODEL_ID),
        params=params,
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


LANGUAGE_NAMES = {"es": "Spanish", "fr": "French", "zh": "Simplified Chinese"}


def _prompt_for(hint: IntakeHint, need: str | None = None, language: str | None = None) -> str:
    context = [f"User message (redacted): {hint.redacted_message}"]
    if language in LANGUAGE_NAMES:
        context.append(
            f"Reply in {LANGUAGE_NAMES[language]}: the person is using CareMap in that language. Keep facility names, "
            "dollar amounts and law names as given; say in that language that figures are estimates to confirm with "
            "the billing office.")
    if need:
        context.append(f"need (what they're looking for, from the form or an earlier message): {need}")
    if hint.zip_code:
        context.append(f"zip_code: {hint.zip_code}")
    if hint.insurance_type is not None:
        context.append(f"insurance_type: {hint.insurance_type}")
    context.append(f"veteran: {hint.veteran}")
    if hint.tier_pct is not None:
        context.append(f"tier_pct (already computed, NJ Charity Care formula specifically): {hint.tier_pct}")
    if hint.fpl_pct is not None:
        context.append(f"fpl_pct (income as % of federal poverty line, state-agnostic -- use with charity_tier for a non-NJ facility): {hint.fpl_pct}")
    return "\n".join(context)


def handle_message(
    message: str,
    orchestrator: Orchestrator | None = None,
    model=None,
    zip_code: str | None = None,
    insurance_type: str | None = None,
    veteran: bool | None = None,
    tier_pct: float | None = None,
    fpl_pct: float | None = None,
    need: str | None = None,
    language: str | None = None,
) -> dict:
    """Entry point for the Lambda handler. Redacts, then runs the Orchestrator.

    zip_code/insurance_type/veteran/tier_pct/fpl_pct are hints the caller
    already computed client-side (the browser's own redact() pass) and sent
    as separate fields alongside the redacted message text -- they take
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
    if fpl_pct is not None:
        hint.fpl_pct = fpl_pct
    # The person's own context counts as evidence: their poverty-line percent
    # and zip were computed in their browser, not invented by the model.
    context_numbers = [hint.fpl_pct, hint.tier_pct]
    if hint.zip_code and hint.zip_code.isdigit():
        context_numbers.append(hint.zip_code)
    orchestrator.ledger.numbers.update(float(n) for n in context_numbers if n is not None)
    prompt = _prompt_for(hint, need, language)
    result = orchestrator.agent(prompt, structured_output_model=OrchestratorOutput)
    output: OrchestratorOutput = result.structured_output
    reply = ensure_disclosure(output.reply)
    final = orchestrator.guard.final
    return {
        "reply": reply,
        "map_commands": [c.model_dump() for c in output.map_commands],
        "audit": orchestrator.ledger.audit,
        "guard": {**orchestrator.guard.check(reply), "attempt": final["attempt"] if final else 1},
    }
