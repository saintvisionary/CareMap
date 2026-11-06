"""Policy-as-code guardrails, enforced with Strands hooks.

EvidenceLedger   records every number a data tool returns, plus an audit trail.
GroundingGuard   blocks a reply that contains a $/tier number not found in the
                 ledger, or that mislabels a cost, and makes the agent rewrite.

Adapted from ../lumina-navigator/lumina_navigator/guards.py for CareMap's
rule: "Every $ figure / tier shown must come from a tool result.
Label costs 'typical billed charge', never 'your price'. Always say
'estimate, confirm with billing office'."
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

from strands.hooks import AfterInvocationEvent, AfterToolCallEvent, HookProvider, HookRegistry

POLICY = json.loads((Path(__file__).resolve().parent.parent / "policy" / "guardrails.json").read_text(encoding="utf-8"))

_NUM = re.compile(r"(?<![\w.])\$?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)%?(?!\w)")


def extract_numbers(text: str) -> list[float]:
    out = []
    for m in _NUM.findall(text):
        try:
            out.append(float(m.replace(",", "")))
        except ValueError:
            continue
    return out


def _result_text(result: dict) -> str:
    parts = []
    for block in (result or {}).get("content", []):
        if "text" in block:
            parts.append(block["text"])
        elif "json" in block:
            parts.append(json.dumps(block["json"]))
    return "\n".join(parts)


def has_dollar_figure(text: str) -> bool:
    return "$" in text


_NEGATED = re.compile(r"(?:\bnot|n't|\bnever|\bno|\bnor)\s+(?:a\s+|an\s+|the\s+)?$")


def forbidden_phrases(text: str) -> list[str]:
    """A forbidden phrase counts only when it's asserted: "not guaranteed"
    and "not your price" are the honest framing the rule wants."""
    lower = text.lower()
    found = []
    for p in POLICY["labeling"]["forbidden_phrases"]:
        for m in re.finditer(re.escape(p), lower):
            if not _NEGATED.search(lower[max(0, m.start() - 20):m.start()]):
                found.append(f"Forbidden phrase used: '{p}'.")
                break
    return found


def missing_disclosures(text: str) -> list[str]:
    if not has_dollar_figure(text):
        return []
    lower = text.lower()
    return [f"Missing required disclosure phrase: '{p}'." for p in POLICY["labeling"]["required_when_dollar_figure_present"]
            if p not in lower]


def labeling_violations(text: str) -> list[str]:
    return forbidden_phrases(text) + missing_disclosures(text)


DISCLOSURE = "These are estimates, confirm with billing office."


def ensure_disclosure(text: str) -> str:
    """Append the required disclosure when a reply with a dollar figure lacks
    it. Deterministic, so a forgotten phrase never costs a model rewrite."""
    if missing_disclosures(text):
        return text.rstrip() + "\n\n" + DISCLOSURE
    return text


def reply_text(result) -> str:
    """The user-visible reply only. str(result) on a structured result is the
    whole JSON, including map coordinates and zoom levels nobody reads."""
    reply = getattr(getattr(result, "structured_output", None), "reply", None)
    return reply if isinstance(reply, str) else str(result)


@dataclass
class EvidenceLedger(HookProvider):
    data_tools: set[str]
    numbers: set[float] = field(default_factory=set)
    audit: list[dict] = field(default_factory=list)

    def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
        registry.add_callback(AfterToolCallEvent, self.on_tool)

    def on_tool(self, event: AfterToolCallEvent) -> None:
        name = event.tool_use.get("name")
        print(f"[ledger] tool call: {name} duration={event.duration}", flush=True)
        self.audit.append({
            "ts": round(time.time(), 3),
            "agent": getattr(event.agent, "name", None),
            "tool": name,
            "input": event.tool_use.get("input"),
            "status": (event.result or {}).get("status"),
            "duration_s": round(event.duration, 3) if event.duration else None,
        })
        if name in self.data_tools:
            self.numbers.update(extract_numbers(_result_text(event.result)))

    def is_grounded(self, x: float) -> bool:
        if x in POLICY["grounding"]["always_allowed_numbers"]:
            return True
        for v in self.numbers:
            if abs(v - x) < 1e-9 or round(v) == x or round(v, 1) == x:
                return True
        return False


@dataclass
class GroundingGuard(HookProvider):
    ledger: EvidenceLedger
    max_rewrites: int = POLICY["grounding"]["max_rewrites"]
    rewrites: int = 0
    history: list[dict] = field(default_factory=list)

    def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
        registry.add_callback(AfterInvocationEvent, self.on_done)

    def check(self, text: str) -> dict:
        ungrounded = sorted({x for x in extract_numbers(text) if not self.ledger.is_grounded(x)})
        violations = labeling_violations(text)
        return {"ungrounded_numbers": ungrounded, "label_violations": violations,
                "passed": not ungrounded and not violations}

    def on_done(self, event: AfterInvocationEvent) -> None:
        if event.result is None:
            return
        text = reply_text(event.result)
        report = self.check(text)
        report["attempt"] = self.rewrites + 1
        self.history.append(report)
        # A missing disclosure alone is fixed by ensure_disclosure() after the
        # run; only invented numbers and forbidden wording need the model.
        forbidden = forbidden_phrases(text)
        if (not report["ungrounded_numbers"] and not forbidden) or self.rewrites >= self.max_rewrites:
            return
        self.rewrites += 1
        problems = []
        if report["ungrounded_numbers"]:
            problems.append(
                "These numbers do not appear in any tool result and must be removed or corrected: "
                + ", ".join(f"{n:g}" for n in report["ungrounded_numbers"]))
        problems.extend(forbidden)
        event.resume = ("POLICY CHECK FAILED. Rewrite the full reply and fix this:\n- " + "\n- ".join(problems)
                        + "\nReturn only the corrected reply.")

    @property
    def final(self) -> dict | None:
        return self.history[-1] if self.history else None
