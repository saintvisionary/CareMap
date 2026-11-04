"""Redaction pre-pass: runs BEFORE any text reaches an LLM.

Hard rule: "Income/household size stay in browser. Agent gets
only tier + facility IDs." In production this same logic runs as JS in the
browser before a chat message ever leaves the client -- this module is the
reference implementation and the source to port to JS. It is pure regex +
caremap.policy math, no model call, so it costs nothing and leaks nothing.

If a message states both a dollar income and a household size (e.g. "family
of 4, $52k"), we compute the NJ Charity Care tier right here and strip the
raw numbers out of the text before anything downstream -- an Intake agent, an
Eligibility agent, an audit log -- ever sees it.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from . import policy

_ZIP = re.compile(r"\b(\d{5})\b")
_DOLLAR_K = re.compile(r"\$\s?(\d+(?:\.\d+)?)\s*k\b", re.IGNORECASE)
# Matches both "$52,000" (comma-grouped) and "$52000" (plain digits).
_DOLLAR = re.compile(r"\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\b")
_HOUSEHOLD = re.compile(
    r"family of (\d+)|household of (\d+)|(\d+)[\s-]*person household", re.IGNORECASE
)
_UNINSURED = re.compile(r"\buninsured\b", re.IGNORECASE)
_INSURED = re.compile(r"\binsured\b", re.IGNORECASE)


@dataclass
class IntakeHint:
    zip_code: str | None
    insured: bool | None
    tier_pct: float | None
    redacted_message: str


def _parse_dollar_amount(text: str) -> tuple[float, str] | None:
    m = _DOLLAR_K.search(text)
    if m:
        return float(m.group(1)) * 1000, m.group(0)
    m = _DOLLAR.search(text)
    if m:
        return float(m.group(1).replace(",", "")), m.group(0)
    return None


def _parse_household_size(text: str) -> tuple[int, str] | None:
    m = _HOUSEHOLD.search(text)
    if not m:
        return None
    size = next(g for g in m.groups() if g)
    return int(size), m.group(0)


def redact(message: str) -> IntakeHint:
    zip_match = _ZIP.search(message)
    zip_code = zip_match.group(1) if zip_match else None

    insured: bool | None = None
    if _UNINSURED.search(message):
        insured = False
    elif _INSURED.search(message):
        insured = True

    redacted = message
    tier_pct = None
    dollar = _parse_dollar_amount(message)
    household = _parse_household_size(message)
    if dollar and household:
        income, dollar_span = dollar
        size, household_span = household
        # NJ Charity Care only applies to uninsured/underinsured patients --
        # an insured person gets no tier at all, not a $0 one. Raw numbers
        # are still redacted either way; only whether a tier is exposed
        # changes.
        if insured is not True:
            fpl_pct = policy.fpl_percent(income, size)
            tier = policy.nj_charity_tier(fpl_pct)
            tier_pct = tier["patient_pays_pct"]
        redacted = redacted.replace(dollar_span, "[income redacted]")
        redacted = redacted.replace(household_span, "[household redacted]")

    return IntakeHint(zip_code=zip_code, insured=insured, tier_pct=tier_pct, redacted_message=redacted)
