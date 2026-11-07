import { NEED_TO_DRG } from "./drg";
import { facilityTier } from "./geo";
import { insuranceGuidance } from "./insurance";
import type { InsuranceType } from "./intake";
import { STATE_FULL_NAMES } from "./places";
import {
  applyTier,
  charityTier,
  CHARITY_PROGRAM_NAMES,
  FEDERAL_CAP_LINE,
  FREE_TIER_STATES,
  fqhcSlidingFee,
  isFederalCapHospital,
  MEDICARE_CAP_STATES,
  UPPER_BOUND_STATES,
} from "./policy";
import type { Facility } from "./types";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const CONFIRM = "Estimate, confirm with billing office.";

export interface CardHero {
  hero: string;
  label: string;
}

/** The one big number on a result card and the line under it. Every dollar
 * figure is a CMS typical billed charge, a tier applied to one, or Medicare's
 * average payment as a reference, always labeled as an estimate. */
export function cardHero(facility: Facility, fplPct: number | null, insuranceType: InsuranceType | null, need: string | null): CardHero {
  if (facility.type === "fqhc") {
    return fqhcSlidingFee(fplPct, insuranceType != null && insuranceType !== "uninsured");
  }
  if (facility.type === "urgent_care") {
    return {
      hero: "No price data",
      label: "For minor, non-emergency care. Ask about self-pay rates. For anything life-threatening, call 911.",
    };
  }

  const tier = facilityTier(facility, fplPct, insuranceType);
  const program = CHARITY_PROGRAM_NAMES[facility.state] ?? "charity care";
  const patientPaysPct =
    fplPct != null && facility.charity_care_participant
      ? charityTier(facility.state, fplPct, facility.type, facility.ownership, facility.cost_cap_pct)?.patientPaysPct
      : undefined;
  const drg = need ? NEED_TO_DRG[need] : null;
  const charge = drg ? facility.drg_charges[drg.code]?.avg_charge : undefined;
  const medicarePayment = drg ? facility.drg_charges[drg.code]?.avg_total_payment : undefined;
  const freeNote = FREE_TIER_STATES[facility.state]?.freeNote;
  const upper = UPPER_BOUND_STATES.has(facility.state);

  let out: CardHero;
  if (tier === "insured") {
    // Charity care is for the uninsured: never a charity-care price here.
    out = {
      hero: charge != null ? money(charge) : "Check your plan",
      label: `${charge != null ? "Typical billed charge. " : ""}${insuranceType ? insuranceGuidance(insuranceType) : "Check your plan for your costs."}`,
    };
  } else if (charge != null && patientPaysPct != null) {
    out = {
      hero: money(applyTier(charge, patientPaysPct)),
      label: `${upper && patientPaysPct > 0 ? "At most, estimated" : "Estimated"} amount owed on a ${money(charge)} typical billed charge. ${CONFIRM}${
        patientPaysPct === 0 && freeNote ? ` ${freeNote}` : ""
      }`,
    };
  } else if (charge != null) {
    out = { hero: money(charge), label: `Typical billed charge. ${CONFIRM}` };
  } else if (tier === "free") {
    out = { hero: "$0", label: `Covered by ${program}. ${CONFIRM}${freeNote ? ` ${freeNote}` : ""}` };
  } else if (tier === "reduced") {
    out = {
      hero: `${upper ? "Up to " : ""}${patientPaysPct}%`,
      label: `Of the typical billed charge${upper ? " (a legal maximum)" : ""}. ${CONFIRM}`,
    };
  } else if (tier === "full") {
    out = { hero: "Full price", label: `Your income is above the limit for ${program}.` };
  } else if (facility.type === "va_hospital") {
    out = {
      hero: "VA care",
      label: "For enrolled veterans: costs depend on your VA enrollment and priority group, not state charity care. Ask the VA about eligibility.",
    };
  } else if (facility.charity_care_participant) {
    out =
      fplPct == null
        ? { hero: "Add income", label: "Add your household income under Your costs to see what you'd pay here." }
        : { hero: "Ask about aid", label: `${sentence(program)} sets no share CareMap can compute at this income. Ask the billing office.` };
  } else if (CHARITY_PROGRAM_NAMES[facility.state]) {
    out = { hero: "Ask about aid", label: `Not confirmed as part of ${program}. Ask this hospital's billing office about financial assistance.` };
  } else {
    const state = STATE_FULL_NAMES[facility.state] ?? facility.state;
    out = {
      hero: "Ask about aid",
      label: `${state}'s charity-care rules aren't in CareMap yet.${
        isFederalCapHospital(facility) ? " As a nonprofit hospital, it must have a financial assistance policy under federal law." : ""
      } Ask the billing office.`,
    };
  }

  // CA/CO: a cap tied to Medicare/Medicaid rates, shown with CMS's Medicare
  // average as a reference, never as the price.
  const cap = MEDICARE_CAP_STATES[facility.state];
  const capApplies = cap != null && facility.charity_care_participant && tier !== "insured" && fplPct != null;
  if (capApplies && fplPct > cap.maxFplPct) {
    out = { hero: out.hero, label: `Above ${cap.maxFplPct}% of the poverty line, ${cap.programName}'s cap doesn't apply. Ask the billing office.` };
  } else if (capApplies && medicarePayment != null && charge != null) {
    out = {
      hero: money(medicarePayment),
      label: `Medicare's average payment here (CMS, 2024), vs a ${money(charge)} typical billed charge. ${sentence(cap.programName)} ${cap.capLine}; ${cap.medicaidName}'s rate isn't in CareMap's data, so your cap could be higher. ${CONFIRM}`,
    };
  } else if (capApplies) {
    out = { hero: out.hero, label: `${sentence(cap.programName)} ${cap.capLine}. ${CONFIRM}` };
  }

  // Any state: when no state rule produced a figure, a nonprofit hospital's
  // federal cap, with Medicare's average as the reference point.
  const stateFigure = patientPaysPct != null || (capApplies && fplPct <= cap.maxFplPct);
  if (!stateFigure && tier !== "insured" && isFederalCapHospital(facility) && medicarePayment != null && charge != null) {
    out = {
      hero: money(medicarePayment),
      label: `Medicare's average payment here (CMS, 2024), vs a ${money(charge)} typical billed charge. ${FEDERAL_CAP_LINE}. ${CONFIRM}`,
    };
  }
  if (drg && charge == null && tier !== "insured" && facility.type !== "va_hospital") {
    out = { hero: out.hero, label: `${out.label} No price data here for ${drg.label.charAt(0).toLowerCase()}${drg.label.slice(1)}.` };
  }
  return out;
}
