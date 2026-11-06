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
  /** NJ-formula-specific, kept for callers that only ever dealt with NJ
   * facilities. New code should prefer fplPct + charityTier(facility.state,
   * fplPct) from src/lib/policy.ts, which works for any modeled state. */
  tierPct: number | null;
  /** Income as a percent of the federal poverty line -- state-agnostic.
   * Pass this and a specific facility's own state to charityTier() rather
   * than assuming tierPct's NJ formula applies. */
  fplPct: number | null;
  need: string | null;
  /** True for words that signal an emergency (trouble breathing, overdose,
   * stroke, ...). Urgent care must never be offered for these; the reply
   * leads with 911 instead. UI-only, so not mirrored in caremap/intake.py. */
  emergency: boolean;
  /** Set only for "traveling to X" messages (the guided form's traveler
   * mode, or free chat text). When present, callers should use the
   * international (OpenStreetMap, location-only) path instead of the
   * domestic zip-based one -- see src/lib/international.ts. */
  destination: string | null;
  redactedMessage: string;
}

const ZIP_RE = /\b(\d{5})\b/;
const DOLLAR_K_RE = /\$\s?(\d+(?:\.\d+)?)\s*k\b/i;
// Matches both "$52,000" (comma-grouped) and "$52000" (plain digits).
const DOLLAR_RE = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\b/;
const HOUSEHOLD_RE = /family of (\d+)|household of (\d+)|(\d+)[\s-]*person household/i;
const VETERAN_RE = /\bveteran\b/i;
const EMERGENCY_RE =
  /\b(emergency|911|can'?t breathe|cannot breathe|trouble breathing|difficulty breathing|short(ness)? of breath|unconscious|passed out|not breathing|overdos(e|ed|ing)|suicid(e|al)|kill (myself|themselves)|severe(ly)? bleeding|bleeding (heavily|a lot)|stroke|seizure|anaphyla(xis|ctic)|choking|heart attack|chest pain)\b/i;
// Stops the capture at the next recognized field rather than at a bare
// comma, since a destination itself usually contains one ("Cancun,
// Mexico"). Best-effort for free chat text; the guided form's traveler
// mode always produces the comma-separated form this is tuned for.
const DESTINATION_RE =
  /\btraveling (?:to|abroad to)\s+(.+?)(?=,?\s*(?:family of \d|household of \d|\$|uninsured\b|medicaid\b|medicare\b|private insurance\b|VA insurance\b|not sure about insurance\b|veteran\b|need\s|for\s)|$)/i;

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

// Order matters: checked top to bottom, first match wins. More specific
// patterns (e.g. "kidney stones") must come before a broader one that would
// otherwise also match their words (e.g. the old bare /kidney|urinary/ for
// "kidney/urinary infection" used to swallow "kidney stones", "kidney
// transplant" and "kidney failure" too -- tightened below now that those
// have their own entries).
const NEED_KEYWORDS: { pattern: RegExp; need: string }[] = [
  // Heart & circulation
  { pattern: /heart attack|myocardial infarction/i, need: "heart attack" },
  { pattern: /\bfaint(ed|ing)?\b|passed out|syncope/i, need: "fainting" },
  { pattern: /\btavr\b|heart valve|valve replacement|aortic stenosis/i, need: "heart valve replacement (TAVR)" },
  { pattern: /peripheral (artery|arterial|vascular)|poor circulation/i, need: "poor circulation in the legs" },
  { pattern: /respiratory failure|pulmonary edema|fluid in (my |the )?lungs/i, need: "respiratory failure" },
  { pattern: /dehydrat(ed|ion)|electrolyte/i, need: "dehydration or electrolyte imbalance" },
  { pattern: /irregular heartbeat|arrhythmia|atrial fibrillation|\bafib\b/i, need: "irregular heartbeat" },
  { pattern: /chest pain/i, need: "chest pain" },
  { pattern: /heart failure/i, need: "heart failure" },
  { pattern: /\bstent\b|angioplasty/i, need: "stent or angioplasty" },
  { pattern: /coronary bypass|heart bypass/i, need: "heart bypass surgery" },
  { pattern: /pacemaker/i, need: "pacemaker implant" },
  { pattern: /hypertensive crisis|high blood pressure/i, need: "high blood pressure crisis" },

  // Lungs & breathing
  { pattern: /pneumonia/i, need: "pneumonia" },
  { pattern: /copd|chronic obstructive/i, need: "COPD" },
  { pattern: /asthma|bronchitis/i, need: "asthma or bronchitis flare" },
  { pattern: /pulmonary embolism|blood clot in (my |the )?lung/i, need: "blood clot in the lung" },
  { pattern: /collapsed lung|pneumothorax/i, need: "collapsed lung" },
  { pattern: /respiratory infection/i, need: "serious respiratory infection" },

  // Stomach & digestion
  { pattern: /gallbladder|cholecystectomy/i, need: "gallbladder surgery" },
  { pattern: /stomach bleeding|gi bleed|gastrointestinal hemorrhage/i, need: "stomach bleeding" },
  { pattern: /bowel (blockage|obstruction)|intestinal blockage/i, need: "stomach or bowel blockage" },
  { pattern: /bowel (surgery|resection)|colectomy|colon surgery/i, need: "bowel surgery" },
  { pattern: /acid reflux|gastritis|heartburn|\bgerd\b/i, need: "acid reflux or gastritis" },
  { pattern: /pancreatitis/i, need: "pancreatitis" },
  { pattern: /cirrhosis|liver disease|hepatitis/i, need: "liver disease" },
  { pattern: /\bhernia\b/i, need: "hernia repair" },
  { pattern: /appendix|appendicitis/i, need: "appendix removal" },

  // Kidney & bladder
  { pattern: /kidney stone/i, need: "kidney stones" },
  { pattern: /kidney transplant/i, need: "kidney transplant" },
  { pattern: /kidney failure|renal failure/i, need: "kidney failure" },
  { pattern: /bladder (problem|issue)|urinary retention/i, need: "bladder problems" },
  { pattern: /kidney infection|urinary tract infection|\buti\b/i, need: "kidney/urinary infection" },

  // Bones, joints & muscles
  { pattern: /hip fracture|femur fracture|broke(n)? (my |a )?(hip|femur)/i, need: "hip or femur fracture" },
  { pattern: /hip replacement|knee replacement/i, need: "hip or knee replacement" },
  { pattern: /spinal fusion/i, need: "spinal fusion surgery" },
  { pattern: /back pain|spine problem|herniated disc/i, need: "back or spine problems" },
  { pattern: /\bsprain(ed)?\b|dislocat(ed|ion)|broken (bone|arm|leg|wrist|ankle|toe|finger)/i, need: "broken bone, sprain or dislocation" },
  { pattern: /arthritis|osteoporosis|bone disease/i, need: "bone or joint disease" },
  { pattern: /arm (surgery|injury)|leg (surgery|injury)/i, need: "arm or leg procedure" },

  // Brain & nervous system
  { pattern: /\btia\b|mini[- ]?stroke|transient ischemic/i, need: "mini-stroke (TIA)" },
  { pattern: /\bstroke\b|cerebral infarction/i, need: "stroke" },
  { pattern: /seizure/i, need: "seizures" },
  { pattern: /head injury|concussion|hit (my |)?head/i, need: "head injury" },
  { pattern: /dizz(y|iness)|balance problem|vertigo/i, need: "dizziness or balance problems" },
  { pattern: /migraine|severe headache/i, need: "migraine or severe headaches" },
  { pattern: /nerve (disorder|damage|pain)|neuropathy/i, need: "nerve disorder" },

  // Mental health & substance use
  { pattern: /severe depression/i, need: "severe depression" },
  { pattern: /psychosis|psychotic episode/i, need: "psychosis or severe mental health crisis" },
  { pattern: /alcohol withdrawal|drug withdrawal|detox/i, need: "alcohol or drug withdrawal" },
  { pattern: /panic attack|mental health crisis|psychiatric emergency/i, need: "acute stress or crisis" },

  // Ear, nose, mouth & throat
  { pattern: /ear infection|throat infection|strep throat|tonsillitis/i, need: "ear or throat infection" },
  { pattern: /dental infection|tooth infection|oral infection|abscess(ed)? tooth/i, need: "severe dental or oral infection" },

  // Eyes
  { pattern: /eye infection|eye disorder|pink eye|conjunctivitis/i, need: "eye disorder or infection" },

  // Skin
  { pattern: /cellulitis|skin infection/i, need: "skin infection (cellulitis)" },
  { pattern: /\bburn(ed|s)?\b/i, need: "burn injury" },

  // Blood, immune system & cancer care
  { pattern: /\banemia\b|blood disorder/i, need: "anemia or blood disorder" },
  { pattern: /clotting disorder|blood clot(?! in)/i, need: "blood clotting disorder" },
  { pattern: /chemotherapy|\bchemo\b/i, need: "chemotherapy" },
  { pattern: /leukemia|lymphoma/i, need: "leukemia or lymphoma" },

  // Diabetes & hormones
  { pattern: /diabet/i, need: "diabetes complications" },
  { pattern: /thyroid|endocrine disorder/i, need: "thyroid or hormone disorder" },

  // Women's reproductive health
  { pattern: /ovarian cancer|uterine cancer|cervical cancer|gynecologic cancer/i, need: "gynecologic cancer care" },
  { pattern: /ovarian cyst|uterine fibroid|ovarian condition/i, need: "uterine or ovarian condition" },

  // Men's reproductive health
  { pattern: /enlarged prostate|\bbph\b|prostate problem/i, need: "enlarged prostate" },

  // Serious infection
  { pattern: /\bsepsis\b|septic\b|bloodstream infection/i, need: "sepsis or bloodstream infection" },
  { pattern: /surgical site infection|post-?op(erative)? infection|wound infection/i, need: "infection after surgery or injury" },

  // Weight-loss surgery
  { pattern: /bariatric|gastric bypass|gastric sleeve|weight.?loss surgery/i, need: "weight-loss (bariatric) surgery" },
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

function parseDestination(text: string): string | null {
  const m = DESTINATION_RE.exec(text);
  return m ? m[1].trim() : null;
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
  let fplPct: number | null = null;
  const dollar = parseDollarAmount(message);
  const household = parseHouseholdSize(message);
  if (dollar && household) {
    const [income, dollarSpan] = dollar;
    const [size, householdSpan] = household;
    // Every modeled state's formula (currently NJ, WA) applies only to the
    // uninsured/underinsured -- any other category (including Medicaid, per
    // NJ's own "not Medicaid-eligible" rule) gets no tier at all, not a $0
    // one. Raw numbers are still redacted either way; only whether a tier
    // is exposed changes.
    if (insuranceType === "uninsured") {
      fplPct = fplPercent(income, size);
      // tierPct keeps assuming NJ's formula specifically, unchanged from
      // before. fplPct is the new, state-agnostic value -- pass it with a
      // specific facility's own state to charityTier() instead.
      tierPct = njCharityTier(fplPct).patientPaysPct;
    }
    redacted = redacted.replace(dollarSpan, "[income redacted]").replace(householdSpan, "[household redacted]");
  }

  return {
    zipCode,
    insuranceType,
    veteran,
    tierPct,
    fplPct,
    need: parseNeed(message),
    emergency: EMERGENCY_RE.test(message),
    destination: parseDestination(message),
    redactedMessage: redacted,
  };
}
