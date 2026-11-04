// Mirrors caremap/intake.py. Runs entirely in the browser, before any
// network call: strips raw dollar income and household size out of the
// message and replaces them with an already-computed NJ Charity Care tier.
// If a Lambda chat call is ever made, only the redacted text + tier should
// be sent -- never this module's income/household inputs.
//
// Insurance is a category, not a yes/no: NJ Charity Care's actual rule is
// "uninsured/underinsured and not Medicaid-eligible", so Medicaid needs its
// own answer (not a tier), distinct from "privately insured" or "not sure".
// No PII here -- these are public coverage-type categories, never a plan
// name, member ID, or similar identifying detail.
import { fplPercent, njCharityTier } from "./policy";

export type InsuranceType = "uninsured" | "medicaid" | "medicare" | "private" | "va_tricare" | "unsure";

export interface IntakeHint {
  zipCode: string | null;
  insuranceType: InsuranceType | null;
  veteran: boolean;
  tierPct: number | null;
  need: string | null;
  redactedMessage: string;
}

const ZIP_RE = /\b(\d{5})\b/;
const DOLLAR_K_RE = /\$\s?(\d+(?:\.\d+)?)\s*k\b/i;
// Matches both "$52,000" (comma-grouped) and "$52000" (plain digits).
const DOLLAR_RE = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\b/;
const HOUSEHOLD_RE = /family of (\d+)|household of (\d+)|(\d+)[\s-]*person household/i;
const VETERAN_RE = /\bveteran\b/i;

// Order matters: checked top to bottom, first match wins. "uninsured" must
// come before the bare "insured" match since "insured" is a substring of it.
const INSURANCE_PATTERNS: { type: InsuranceType; pattern: RegExp }[] = [
  { type: "uninsured", pattern: /\buninsured\b/i },
  { type: "medicaid", pattern: /\bmedicaid\b/i },
  { type: "medicare", pattern: /\bmedicare\b/i },
  { type: "va_tricare", pattern: /\btricare\b|\bva (coverage|insurance|health|benefits)\b|\bveterans? affairs\b/i },
  { type: "unsure", pattern: /\b(not sure|unsure|don't know|dont know)\b.*\binsur/i },
  { type: "private", pattern: /\b(private insurance|privately insured|insured)\b/i },
];

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

function parseInsuranceType(text: string): InsuranceType | null {
  for (const { type, pattern } of INSURANCE_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return null;
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

  const insuranceType = parseInsuranceType(message);
  const veteran = VETERAN_RE.test(message);

  let redacted = message;
  let tierPct: number | null = null;
  const dollar = parseDollarAmount(message);
  const household = parseHouseholdSize(message);
  if (dollar && household) {
    const [income, dollarSpan] = dollar;
    const [size, householdSpan] = household;
    // NJ Charity Care applies only to the uninsured/underinsured -- any
    // other category (including Medicaid, per policy.json's own "not
    // Medicaid-eligible" rule) gets no tier at all, not a $0 one. Raw
    // numbers are still redacted either way; only whether a tier is
    // exposed changes.
    if (insuranceType === "uninsured") {
      const fplPct = fplPercent(income, size);
      tierPct = njCharityTier(fplPct).patientPaysPct;
    }
    redacted = redacted.replace(dollarSpan, "[income redacted]").replace(householdSpan, "[household redacted]");
  }

  return { zipCode, insuranceType, veteran, tierPct, need: parseNeed(message), redactedMessage: redacted };
}
