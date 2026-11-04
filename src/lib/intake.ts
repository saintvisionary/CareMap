// Mirrors caremap/intake.py. Runs entirely in the browser, before any
// network call: strips raw dollar income and household size out of the
// message and replaces them with an already-computed NJ Charity Care tier.
// If a Lambda chat call is ever made, only the redacted text + tier should
// be sent -- never this module's income/household inputs.
import { fplPercent, njCharityTier } from "./policy";

export interface IntakeHint {
  zipCode: string | null;
  insured: boolean | null;
  tierPct: number | null;
  need: string | null;
  redactedMessage: string;
}

const ZIP_RE = /\b(\d{5})\b/;
const DOLLAR_K_RE = /\$\s?(\d+(?:\.\d+)?)\s*k\b/i;
// Matches both "$52,000" (comma-grouped) and "$52000" (plain digits).
const DOLLAR_RE = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\b/;
const HOUSEHOLD_RE = /family of (\d+)|household of (\d+)|(\d+)[\s-]*person household/i;
const UNINSURED_RE = /\buninsured\b/i;
const INSURED_RE = /\binsured\b/i;

const NEED_KEYWORDS: { pattern: RegExp; need: string }[] = [
  { pattern: /gallbladder|cholecystectomy/i, need: "gallbladder surgery" },
  { pattern: /pneumonia/i, need: "pneumonia" },
  { pattern: /heart failure/i, need: "heart failure" },
  { pattern: /kidney|urinary|uti\b/i, need: "kidney/urinary infection" },
  { pattern: /copd|chronic obstructive/i, need: "COPD" },
];

function parseDollarAmount(text: string): [number, string] | null {
  const k = DOLLAR_K_RE.exec(text);
  if (k) return [parseFloat(k[1]) * 1000, k[0]];
  const d = DOLLAR_RE.exec(text);
  if (d) return [parseFloat(d[1].replace(/,/g, "")), d[0]];
  return null;
}

function parseHouseholdSize(text: string): [number, string] | null {
  const m = HOUSEHOLD_RE.exec(text);
  if (!m) return null;
  const size = m[1] ?? m[2] ?? m[3];
  return [parseInt(size, 10), m[0]];
}

export function parseNeed(text: string): string | null {
  for (const { pattern, need } of NEED_KEYWORDS) {
    if (pattern.test(text)) return need;
  }
  return null;
}

export function redact(message: string): IntakeHint {
  const zipMatch = ZIP_RE.exec(message);
  const zipCode = zipMatch ? zipMatch[1] : null;

  let insured: boolean | null = null;
  if (UNINSURED_RE.test(message)) insured = false;
  else if (INSURED_RE.test(message)) insured = true;

  let redacted = message;
  let tierPct: number | null = null;
  const dollar = parseDollarAmount(message);
  const household = parseHouseholdSize(message);
  if (dollar && household) {
    const [income, dollarSpan] = dollar;
    const [size, householdSpan] = household;
    const fplPct = fplPercent(income, size);
    tierPct = njCharityTier(fplPct).patientPaysPct;
    redacted = redacted.replace(dollarSpan, "[income redacted]").replace(householdSpan, "[household redacted]");
  }

  return { zipCode, insured, tierPct, need: parseNeed(message), redactedMessage: redacted };
}
