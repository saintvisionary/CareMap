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

Insurance is a category, not a yes/no: NJ Charity Care's actual rule is
"uninsured/underinsured and not Medicaid-eligible", so Medicaid needs its
own answer (not a tier), distinct from "privately insured" or "not sure".
No PII here -- these are public coverage-type categories, never a plan
name, member ID, or similar identifying detail.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from . import policy

InsuranceType = Literal["uninsured", "medicaid", "medicare", "private", "va_tricare", "unsure"]

_ZIP = re.compile(r"\b(\d{5})\b")
_DOLLAR_K = re.compile(r"\$\s?(\d+(?:\.\d+)?)\s*k\b", re.IGNORECASE)
# Matches both "$52,000" (comma-grouped) and "$52000" (plain digits).
_DOLLAR = re.compile(r"\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\b")
_HOUSEHOLD = re.compile(
    r"family of (\d+)|household of (\d+)|(\d+)[\s-]*person household", re.IGNORECASE
)
_VETERAN = re.compile(r"\bveteran\b", re.IGNORECASE)
# Redaction runs on its own, independent of whether a tier can be computed:
# every income-like and household-like span is removed, even when only one of
# them appears, when there are several, or when there is no "$". ZIP codes are
# left alone; a bare 5-digit number only counts as income when an income word
# follows it. Mirrors src/lib/intake.ts redactSensitiveSpans().
_INCOME_SPANS = [
    re.compile(r"\$\s?\d[\d,]*(?:\.\d+)?\s*k?\b", re.IGNORECASE),
    re.compile(r"\b\d+(?:\.\d+)?\s*k\b", re.IGNORECASE),
    re.compile(r"\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b"),
    re.compile(r"\b\d{4,7}(?:\.\d+)?\s*(?:dollars|usd|a year|per year|a month|per month|annually|yearly|monthly|/\s*(?:yr|year|mo|month)|income)\b", re.IGNORECASE),
]
_HOUSEHOLD_SPANS = [
    re.compile(r"\b(?:family|household) of \d+\b", re.IGNORECASE),
    re.compile(r"\b\d+[\s-]*person household\b", re.IGNORECASE),
    re.compile(r"\b\d+\s+(?:people|persons|kids|children|dependents|of us)\b", re.IGNORECASE),
]


def redact_sensitive_spans(text: str) -> str:
    for pat in _INCOME_SPANS:
        text = pat.sub("[income redacted]", text)
    for pat in _HOUSEHOLD_SPANS:
        text = pat.sub("[household redacted]", text)
    return text

# Order matters: checked top to bottom, first match wins. "uninsured" must
# come before "insured" since the plain word "insured" is a substring of it.
_INSURANCE_PATTERNS: list[tuple[InsuranceType, re.Pattern[str]]] = [
    ("uninsured", re.compile(r"\buninsured\b", re.IGNORECASE)),
    ("medicaid", re.compile(r"\bmedicaid\b", re.IGNORECASE)),
    ("medicare", re.compile(r"\bmedicare\b", re.IGNORECASE)),
    ("va_tricare", re.compile(r"\btricare\b|\bva (coverage|insurance|health|benefits)\b|\bveterans? affairs\b", re.IGNORECASE)),
    ("unsure", re.compile(r"\b(not sure|unsure|don't know|dont know)\b.*\binsur", re.IGNORECASE)),
    ("private", re.compile(r"\b(private insurance|privately insured|\binsured\b)", re.IGNORECASE)),
]


@dataclass
class IntakeHint:
    zip_code: str | None
    insurance_type: InsuranceType | None
    veteran: bool
    tier_pct: float | None
    fpl_pct: float | None
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


def _parse_insurance_type(text: str) -> InsuranceType | None:
    for insurance_type, pattern in _INSURANCE_PATTERNS:
        if pattern.search(text):
            return insurance_type
    return None


def redact(message: str) -> IntakeHint:
    zip_match = _ZIP.search(message)
    zip_code = zip_match.group(1) if zip_match else None

    insurance_type = _parse_insurance_type(message)
    veteran = bool(_VETERAN.search(message))

    redacted = message
    tier_pct = None
    fpl_pct = None
    dollar = _parse_dollar_amount(message)
    household = _parse_household_size(message)
    if dollar and household:
        income, _ = dollar
        size, _ = household
        # NJ/WA charity care both apply only to the uninsured/underinsured
        # (applied conservatively for WA too -- see policy.json's wa_charity_care
        # "eligibility" note) -- any other category (including Medicaid, per
        # NJ's own "not Medicaid-eligible" rule) gets no tier at all, not a $0
        # one. Raw numbers are still redacted either way; only whether a tier
        # is exposed changes.
        if insurance_type == "uninsured":
            fpl_pct = policy.fpl_percent(income, size)
            # tier_pct keeps assuming NJ's formula -- unchanged from before,
            # since most callers (today, only NJ facilities ever display a
            # tier from it) still expect that shape. fpl_pct is the new,
            # state-agnostic value: a facility in a different modeled state
            # (currently just WA) gets its own tier via policy.charity_tier(
            # facility_state, fpl_pct) instead of this one.
            tier = policy.nj_charity_tier(fpl_pct)
            tier_pct = tier["patient_pays_pct"]
    redacted = redact_sensitive_spans(redacted)

    return IntakeHint(
        zip_code=zip_code,
        insurance_type=insurance_type,
        veteran=veteran,
        tier_pct=tier_pct,
        fpl_pct=fpl_pct,
        redacted_message=redacted,
    )
