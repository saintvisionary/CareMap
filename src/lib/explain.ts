// "What the law says" for one place, in plain words and in dollars for the
// person's own household, so nobody has to know what "200% of the poverty
// line" means. Written short (about a 5th-grade reading level). Every rule
// here comes from the same verified tables as the prices: charityTier(),
// FREE_TIER_STATES, MEDICARE_CAP_STATES and the federal rules in policy.ts.
import type { InsuranceType } from "./intake";
import { INSURANCE_LABELS } from "./insurance";
import { STATE_FULL_NAMES } from "./places";
import { charityTier, CHARITY_PROGRAM_NAMES, fplAmount, isFederalCapHospital, MEDICARE_CAP_STATES, UPPER_BOUND_STATES } from "./policy";
import { NEED_TO_DRG, needLabel } from "./drg";
import type { Facility } from "./types";

export interface Explanation {
  title: string;
  /** What the rule is, in dollars for this household. */
  rule: string;
  /** Where this person fits, when we know their income. */
  you?: string;
  /** What to do next. */
  next: string;
  /** The calculation, one step per line: [what, value]. */
  math?: [string, string][];
}

/** The person's own numbers, used to show the math. Stays in the browser. */
export interface MathInputs {
  income: string;
  incomeRange: number | null;
  need: string | null;
}

const exact = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const times = (pct: number) => `${(pct / 100).toFixed(1)} ×`;

/** Poverty line, the person's multiple of it, and (when there's a price)
 * the bill times their share. Nothing is shown that we can't compute. */
function mathSteps(f: Facility, household: number, m: MathInputs | undefined, sharePct: number | null | undefined, ruleName: string): [string, string][] | undefined {
  if (!m || (m.income === "" && m.incomeRange == null)) return undefined;
  const line = fplAmount(household);
  const steps: [string, string][] = [[`Poverty line for ${people(household)} (2026)`, `${exact(line)} a year`]];
  let pct: number;
  if (m.income !== "") {
    pct = Math.round((Number(m.income) / line) * 100);
    steps.push(["Your income", `${exact(Number(m.income))} ÷ ${exact(line)} = ${times(pct)} the line`]);
  } else {
    pct = m.incomeRange!;
    steps.push(["Your income", pct >= 1000 ? "over 4.0 × the line" : `up to ${exact((line * pct) / 100)} = up to ${times(pct)} the line`]);
  }
  if (sharePct == null) return steps;
  steps.push([`${ruleName} at ${pct >= 1000 ? "over 4.0" : (pct / 100).toFixed(1)} ×`, sharePct === 0 ? "you pay 0% (free)" : `you pay ${UPPER_BOUND_STATES.has(f.state) ? "at most " : ""}${sharePct}%`]);
  const drg = m.need ? NEED_TO_DRG[m.need] : null;
  const charge = drg ? f.drg_charges[drg.code]?.avg_charge : undefined;
  if (drg && charge != null) {
    steps.push([`${needLabel(m.need!)} bill here`, `${exact(charge)} × ${sharePct}% = ${exact((charge * sharePct) / 100)}`]);
  }
  return steps;
}

const money = (n: number) => `$${(Math.round(n / 1000) * 1000).toLocaleString("en-US")}`;

/** The yearly income at a percent of the poverty line, rounded to $1,000. */
function incomeAt(pct: number, household: number): string {
  return money((fplAmount(household) * pct) / 100);
}

function people(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

/** The highest poverty-line percent where a state's share is 0 (free), and
 * the highest where any discount applies, for this kind of hospital. */
function cutoffs(f: Facility): { free: number | null; discount: number | null } {
  let free: number | null = null;
  let discount: number | null = null;
  for (let pct = 0; pct <= 700; pct++) {
    const t = charityTier(f.state, pct, f.type, f.ownership, f.cost_cap_pct);
    if (t == null) continue;
    if (t.patientPaysPct === 0) free = pct;
    if (t.patientPaysPct < 100) discount = pct;
  }
  return { free, discount };
}

export function explain(f: Facility, fplPct: number | null, insuranceType: InsuranceType | null, household: number, m?: MathInputs): Explanation {
  const stateName = STATE_FULL_NAMES[f.state] ?? f.state;
  const fam = people(household);

  if (f.type === "fqhc") {
    const you =
      fplPct == null
        ? undefined
        : fplPct <= 100
          ? "Based on your answers, your visit should be free or a small fee."
          : fplPct <= 200
            ? "Based on your answers, you should get a discount."
            : "Based on your answers, no discount is required. They still can't turn you away.";
    return {
      title: "What the law says",
      rule: `Health centers that get federal money must charge by income. For ${fam}: under ${incomeAt(100, household)} a year, care is free or a small fee. Up to ${incomeAt(200, household)}, you get a discount. They can't turn you away because you can't pay.`,
      you: insuranceType && insuranceType !== "uninsured" ? "With insurance, they'll bill your plan." : you,
      next: "Call and ask for their sliding fee. Bring proof of income.",
      math: insuranceType && insuranceType !== "uninsured" ? undefined : mathSteps(f, household, m, undefined, ""),
    };
  }

  if (f.type === "urgent_care") {
    return {
      title: "What you should know",
      rule: "Urgent care centers set their own prices. No law makes them give a discount. They're for minor problems like a sprain or the flu.",
      next: "Ask for the self-pay price before you're seen. For anything life-threatening, call 911.",
    };
  }

  if (f.type === "va_hospital") {
    return {
      title: "What you should know",
      rule: "This hospital is run by the Department of Veterans Affairs, for veterans. State charity-care laws don't apply here.",
      next: "If you're a veteran, ask the VA what you'd pay. It depends on your VA enrollment. If you're not a veteran, choose another hospital.",
    };
  }

  if (insuranceType && insuranceType !== "uninsured") {
    return {
      title: "What you should know",
      rule: "Charity-care laws are mostly for people without insurance.",
      you: `With ${INSURANCE_LABELS[insuranceType].toLowerCase()}, what you pay depends on your plan.`,
      next: "Call your plan to ask what you'd pay here. If the bill is still too high, ask the hospital about financial help.",
    };
  }

  // California and Colorado: a cap tied to Medicare/Medicaid rates.
  const cap = MEDICARE_CAP_STATES[f.state];
  if (cap && f.charity_care_participant) {
    return {
      title: "What the law says",
      rule: `${stateName} law: if your family makes up to ${incomeAt(cap.maxFplPct, household)} a year (for ${fam}), this hospital can't charge you more than about what ${cap.medicaidName} or Medicare would pay it. That's usually much less than the full bill.`,
      you: fplPct == null ? undefined : fplPct <= cap.maxFplPct ? "Based on your answers, this limit should apply to you." : "Based on your answers, your income is above this limit.",
      next: "Ask the billing office for the financial help application.",
    };
  }

  const program = CHARITY_PROGRAM_NAMES[f.state];
  if (program && f.charity_care_participant) {
    if (f.state === "NV") {
      return {
        title: "What the law says",
        rule: "Nevada law: large hospitals must take at least 30% off the bill for a hospital stay for people without insurance, at any income. So you'd pay at most 70%.",
        next: "Ask the billing office about the uninsured discount. Arrange payment within 30 days of their notice.",
      };
    }
    const { free, discount } = cutoffs(f);
    const share = fplPct != null ? charityTier(f.state, fplPct, f.type, f.ownership, f.cost_cap_pct)?.patientPaysPct : undefined;
    const parts: string[] = [];
    if (f.state === "CT" && discount != null) {
      parts.push(
        `Connecticut law: if you don't have insurance, were denied Medicaid, and your family makes up to ${incomeAt(discount, household)} a year (for ${fam}), this hospital can only charge what the care costs it. That's about ${f.cost_cap_pct}% of the bill here.`,
      );
    } else {
      if (free != null) parts.push(`${stateName} law: this hospital must give free care to families who make up to ${incomeAt(free, household)} a year (for ${fam}).`);
      if (discount != null && (free == null || discount > free)) {
        parts.push(`${free != null ? "It" : `${stateName} law: this hospital`} must give a discount up to ${incomeAt(discount, household)} a year.`);
      }
    }
    if (parts.length === 0) parts.push(`${stateName} has a charity-care law, ${program}.`);
    const you =
      fplPct == null
        ? "Add your income to see where you fit."
        : share === 0
          ? "Based on your answers, your care here should be free."
          : share != null && share < 100
            ? `Based on your answers, you'd pay ${UPPER_BOUND_STATES.has(f.state) ? "at most " : "about "}${share}% of the bill.`
            : "Based on your answers, your income is above the limit, so no discount is required. You can still ask for a payment plan.";
    return {
      title: "What the law says",
      rule: parts.join(" "),
      you,
      next: "Ask the billing office for the financial help application.",
      math: mathSteps(f, household, m, share ?? null, `${stateName} rule`),
    };
  }

  if (program) {
    return {
      title: "What you should know",
      rule: `${stateName} has a charity-care law, but this hospital isn't confirmed as part of it.`,
      next: "Ask the billing office if it offers financial help.",
    };
  }

  if (isFederalCapHospital(f)) {
    const drg = m?.need ? NEED_TO_DRG[m.need] : null;
    const c = drg ? f.drg_charges[drg.code] : undefined;
    const math: [string, string][] | undefined =
      drg && c && c.avg_total_payment != null
        ? [
            [`${needLabel(m!.need!)} bill here`, exact(c.avg_charge)],
            ["What Medicare usually pays here", exact(c.avg_total_payment)],
            ["Difference", `${exact(c.avg_charge - c.avg_total_payment)} less`],
          ]
        : undefined;
    return {
      math,
      title: "What the law says",
      rule: `This is a nonprofit hospital. Federal law says it must have a plan to help people who can't pay. If you qualify, it can't charge you more than what insured patients usually pay. The hospital sets its own income limits. ${stateName}'s own rules aren't in CareMap yet.`,
      next: "Ask the billing office for its financial assistance policy and application.",
    };
  }

  return {
    title: "What you should know",
    rule: `${stateName}'s rules aren't in CareMap yet, and this hospital isn't a nonprofit, so the federal nonprofit rule doesn't apply.`,
    next: "Ask the billing office if it offers financial help or a self-pay discount.",
  };
}
