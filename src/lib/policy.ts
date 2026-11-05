// Mirrors caremap/policy.py exactly (same numbers, same formula). Runs in
// the browser so eligibility shows in under a second with no AI call, and
// so raw income/household size never has to leave the browser at all --
// not even to a Lambda the user trusts, per the hard privacy rule.

export const FPL_2026: Record<number, number> = {
  1: 15_960,
  2: 21_640,
  3: 27_320,
  4: 33_000,
};
const FPL_ADDITIONAL_PERSON = 5_680;

export function fplAmount(householdSize: number): number {
  if (householdSize < 1) throw new Error("householdSize must be >= 1");
  if (householdSize in FPL_2026) return FPL_2026[householdSize];
  return FPL_2026[4] + FPL_ADDITIONAL_PERSON * (householdSize - 4);
}

export function fplPercent(annualIncome: number, householdSize: number): number {
  if (annualIncome < 0) throw new Error("annualIncome must be >= 0");
  return Math.round((annualIncome / fplAmount(householdSize)) * 100);
}

export interface CharityTier {
  patientPaysPct: number;
  fplPct: number;
  maxFplPct: number | null;
}

type TierTable = { maxFplPct: number | null; patientPaysPct: number }[];

function lookupTier(tiers: TierTable, fplPct: number): CharityTier {
  for (const tier of tiers) {
    if (tier.maxFplPct === null || fplPct <= tier.maxFplPct) {
      return { patientPaysPct: tier.patientPaysPct, fplPct, maxFplPct: tier.maxFplPct };
    }
  }
  throw new Error("unreachable");
}

const NJ_CHARITY_TIERS: TierTable = [
  { maxFplPct: 200, patientPaysPct: 0 },
  { maxFplPct: 225, patientPaysPct: 20 },
  { maxFplPct: 250, patientPaysPct: 40 },
  { maxFplPct: 275, patientPaysPct: 60 },
  { maxFplPct: 300, patientPaysPct: 80 },
  { maxFplPct: null, patientPaysPct: 100 },
];

export function njCharityTier(fplPct: number): CharityTier {
  return lookupTier(NJ_CHARITY_TIERS, fplPct);
}

// RCW 70.170.060(5)(b) -- the floor every WA hospital must offer. Larger
// hospital systems/hospitals (3+ acute hospitals under one owner, or
// specific large hospitals in King County or a southern-border county) are
// required to offer better terms up to 400% FPL under a separate schedule
// (5)(a) this app can't apply per-hospital without bed-count/ownership data
// it doesn't have -- see src/components/InfoPanel.tsx for the disclosure.
const WA_CHARITY_TIERS: TierTable = [
  { maxFplPct: 200, patientPaysPct: 0 },
  { maxFplPct: 250, patientPaysPct: 25 },
  { maxFplPct: 300, patientPaysPct: 50 },
  { maxFplPct: null, patientPaysPct: 100 },
];

export function waCharityTier(fplPct: number): CharityTier {
  return lookupTier(WA_CHARITY_TIERS, fplPct);
}

// 210 ILCS 89/5, 89/10 -- verified directly against the current codified
// statute text. Below the free-care threshold this is a real, exact 0% --
// no gap. Returns null above it: the statute's actual sliding-scale
// discount is charges x (1 - cost_to_charge_ratio x 1.35), which needs each
// hospital's own Medicare cost-to-charge ratio, a different CMS dataset
// this app doesn't have loaded, so a percentage there would be a guess, not
// a grounded number. A 20%-of-family-income-per-12-months collection cap
// still applies in that range regardless -- see InfoPanel.tsx for the
// disclosure. isCriticalAccess picks the correct one of the two free-care
// thresholds the statute sets (125% vs 200% FPL).
const IL_FREE_CARE_MAX_FPL_STANDARD = 200;
const IL_FREE_CARE_MAX_FPL_RURAL = 125;

export function ilCharityTier(fplPct: number, isCriticalAccess: boolean): CharityTier | null {
  const threshold = isCriticalAccess ? IL_FREE_CARE_MAX_FPL_RURAL : IL_FREE_CARE_MAX_FPL_STANDARD;
  if (fplPct <= threshold) {
    return { patientPaysPct: 0, fplPct, maxFplPct: threshold };
  }
  return null;
}

// NY Public Health Law 2807-k(9-a) -- verified directly against the
// current codified text (post the 2024-04-20 amendment). Below the
// free-care threshold this is a real, exact 0% -- the statute's own words
// are "no nominal payment shall be collected". Returns null above it: NY's
// real cap there is 10-20% of the MEDICAID-EQUIVALENT rate for the
// service, a completely different dollar base than the typical billed
// charge this app has, and this app has no Medicaid-rate data loaded at
// all -- unlike IL (whose 20%-of-income cap needs no extra dataset),
// there's no disclosable cap fact to show here either.
const NY_FREE_CARE_MAX_FPL = 200;

export function nyCharityTier(fplPct: number): CharityTier | null {
  if (fplPct <= NY_FREE_CARE_MAX_FPL) {
    return { patientPaysPct: 0, fplPct, maxFplPct: NY_FREE_CARE_MAX_FPL };
  }
  return null;
}

// ORS 442.610-442.618 -- verified directly against the current codified
// text. Unlike IL/NY, the dollar base here is real billed charges, so the
// full sliding scale is computable. These are statutory MINIMUM discounts
// (a hospital may be more generous, never less), the same floor-schedule
// pattern as waCharityTier -- so the returned patientPaysPct is the
// maximum a patient is guaranteed not to exceed, not an exact guess.
// Scope: ORS 442.612(8) only covers NONPROFIT hospitals -- a for-profit or
// government-owned OR hospital gets no tier at all, never a guessed one.
// ownership is CMS's own Hospital General Information field; anything
// other than a confirmed "Voluntary non-profit - ..." string (including
// undefined/unknown) is treated as NOT confirmed nonprofit, the safe
// default.
const OR_CHARITY_TIERS: TierTable = [
  { maxFplPct: 200, patientPaysPct: 0 },
  { maxFplPct: 300, patientPaysPct: 25 },
  { maxFplPct: 350, patientPaysPct: 50 },
  { maxFplPct: 400, patientPaysPct: 75 },
  { maxFplPct: null, patientPaysPct: 100 },
];

export function orCharityTier(fplPct: number, ownership?: string): CharityTier | null {
  if (!ownership?.startsWith("Voluntary non-profit")) return null;
  return lookupTier(OR_CHARITY_TIERS, fplPct);
}

// Md. Code, Health-General 19-214.1 -- verified directly against the
// current codified text. A real 7-band sliding scale, applies to
// virtually every MD hospital regardless of ownership (Maryland's
// all-payer rate-setting system). One honesty note: the statute discounts
// "out-of-pocket expense", not "charges" by name -- for this app's
// uninsured-only use case that collapses to the same billed-charge base
// already used for NJ/WA/OR, but that's an inference from the
// uninsured-only restriction, not a literal statutory statement. A
// separate hardship tier (up to 500% FPL, for high medical debt relative
// to income) exists in the statute but needs data this app doesn't have,
// so it is NOT computed here.
const MD_CHARITY_TIERS: TierTable = [
  { maxFplPct: 200, patientPaysPct: 0 },
  { maxFplPct: 250, patientPaysPct: 25 },
  { maxFplPct: 300, patientPaysPct: 40 },
  { maxFplPct: 350, patientPaysPct: 50 },
  { maxFplPct: 400, patientPaysPct: 55 },
  { maxFplPct: 450, patientPaysPct: 60 },
  { maxFplPct: 500, patientPaysPct: 65 },
  { maxFplPct: null, patientPaysPct: 100 },
];

export function mdCharityTier(fplPct: number): CharityTier {
  return lookupTier(MD_CHARITY_TIERS, fplPct);
}

// 216-RICR-40-10-23.14 -- verified directly against the current
// regulatory text. Below the free-care threshold this is a real, exact
// 0%. Returns null above it: unlike IL/NY, this isn't a missing-data
// problem -- the regulation itself delegates the 200-300% FPL
// sliding-scale percentage to each individual hospital, and says nothing
// about pricing above 300% FPL at all. No disclosable cap fact here the
// way IL has its 20%-of-income cap.
const RI_FREE_CARE_MAX_FPL = 200;

export function riCharityTier(fplPct: number): CharityTier | null {
  if (fplPct <= RI_FREE_CARE_MAX_FPL) {
    return { patientPaysPct: 0, fplPct, maxFplPct: RI_FREE_CARE_MAX_FPL };
  }
  return null;
}

// 101 CMR 613.00, Health Safety Net -- verified directly against the
// current regulatory text. Below 150% FPL (note: lower than the 200%
// line most other modeled states use) this is a real, exact 0%. Returns
// null above it: the 150-300% FPL deductible is a flat annual dollar
// amount (not a percentage of billed charges) equal to the greater of a
// MA Health Connector premium this app doesn't have, or a computable
// formula -- but since it's legally the GREATER of the two, the true
// amount isn't knowable without the premium data.
const MA_FREE_CARE_MAX_FPL = 150;

export function maCharityTier(fplPct: number): CharityTier | null {
  if (fplPct <= MA_FREE_CARE_MAX_FPL) {
    return { patientPaysPct: 0, fplPct, maxFplPct: MA_FREE_CARE_MAX_FPL };
  }
  return null;
}

// 22 M.R.S. 1716-A (effective 2026-07-01): free care at or below 200% FPL,
// Maine residents only. No sliding scale above it -- only a payment-plan
// cap (4% of monthly income, up to 400% FPL) that summarize.ts discloses.
const ME_FREE_CARE_MAX_FPL = 200;
export const ME_PAYMENT_PLAN_MAX_FPL = 400;
export const ME_PAYMENT_PLAN_MAX_PCT_OF_MONTHLY_INCOME = 4;

export function meCharityTier(fplPct: number): CharityTier | null {
  if (fplPct <= ME_FREE_CARE_MAX_FPL) {
    return { patientPaysPct: 0, fplPct, maxFplPct: ME_FREE_CARE_MAX_FPL };
  }
  return null;
}

// 18 V.S.A. 9482: free care at or below 250% FPL, Vermont residents only.
// Above it the 40%-minimum discount is off each hospital's own "amount
// generally billed" (not this app's billed charge), so no share is
// computed; summarize.ts discloses it and the 20%-of-income cap instead.
const VT_FREE_CARE_MAX_FPL = 250;
export const VT_AGB_DISCOUNT_MAX_FPL = 400;
export const VT_CATASTROPHIC_CAP_MAX_FPL = 600;

export function vtCharityTier(fplPct: number): CharityTier | null {
  if (fplPct <= VT_FREE_CARE_MAX_FPL) {
    return { patientPaysPct: 0, fplPct, maxFplPct: VT_FREE_CARE_MAX_FPL };
  }
  return null;
}

// Free-tier-only states with nothing state-specific beyond these fields.
// Each mirrors a caremap/policy.py registry entry and its policy.json
// block. At or below maxFplPct the tier is a real 0%; above it the tier is
// null and aboveLine explains what the law does say.
export interface FreeTierState {
  programName: string;
  heading: string;
  law: string;
  scope: string;
  maxFplPct: number;
  aboveLine: string;
  freeNote?: string;
  strictlyBelow?: boolean;
}

export const FREE_TIER_STATES: Record<string, FreeTierState> = {
  // NCDHHS Medical Debt Mitigation program (HASP hospital commitment):
  // "100% for individuals with incomes below 200% FPL" -- strictly below.
  NC: {
    programName: "North Carolina's Medical Debt Mitigation program (NC residents only)",
    heading: "North Carolina Medical Debt Mitigation program",
    law: "NCDHHS Medical Debt Initiative toolkit, Appendix 2 (a condition of NC Medicaid hospital payments, not a state law)",
    scope:
      "Applies at the hospitals participating in the program (nearly every NC hospital), for North Carolina residents, insured or uninsured. Emergency room visits may still cost $35.",
    maxFplPct: 200,
    strictlyBelow: true,
    aboveLine:
      "From 200% to 300% of the poverty line, participating hospitals must still give at least 75% or 50% off what they generally bill (each hospital's own rate, so no dollar figure here) and offer a payment plan of up to 36 months with payments no more than 5% of monthly household income.",
    freeNote: "Emergency room visits may still cost $35.",
  },
  // OAC 5160-2-17 (Hospital Care Assurance Program): free at or below 100% FPL.
  OH: {
    programName: "Ohio's Hospital Care Assurance Program (Ohio residents not on Medicaid)",
    heading: "Ohio Hospital Care Assurance Program",
    law: "OAC 5160-2-17 (Hospital Care Assurance Program)",
    scope:
      "Applies at Ohio's general hospitals, for Ohio residents who aren't on Medicaid. Free care covers basic, medically necessary services (what Medicaid covers, except transplants).",
    maxFplPct: 100,
    aboveLine: "Ohio sets no statewide discount above this line -- ask the hospital about its own financial assistance policy.",
    freeNote: "Covers basic, medically necessary services, not transplants.",
  },
  // S.C. Code 44-6-150 and Regs. 126-500 to 126-560 (Medically Indigent
  // Assistance Program): full sponsorship at or below 100% FPL.
  SC: {
    programName: "South Carolina's Medically Indigent Assistance Program",
    heading: "South Carolina Medically Indigent Assistance Program",
    law: "S.C. Code 44-6-150 and S.C. Code Regs. 126-500 to 126-560",
    scope:
      "Covers inpatient hospital care (not physician bills) at SC general hospitals for patients the program sponsors. Your county decides eligibility, liquid assets must be $500 or less, you must apply for Medicaid first if you might qualify, and it's limited to SC residents who are US citizens or lawful permanent residents.",
    maxFplPct: 100,
    aboveLine:
      "From 100% to 200% of the poverty line the program offers partial sponsorship, but the share depends on a state payment figure CareMap doesn't have, so no amount is shown. Your county decides eligibility.",
    freeNote: "Inpatient care only, if your county approves you for the program ($500 liquid-asset limit; apply for Medicaid first if you might qualify).",
  },
};

// Keyed by a facility's own state. Only states with a real, codified,
// state-wide formula belong here -- most states have no such law (just
// federal 501(r): each nonprofit hospital must have *a* policy, with no
// public structured dataset of what it says), so this stays short.
const STATE_CHARITY_TIER_FNS: Record<string, (fplPct: number, facilityType?: string, ownership?: string) => CharityTier | null> = {
  NJ: (fplPct) => njCharityTier(fplPct),
  WA: (fplPct) => waCharityTier(fplPct),
  IL: (fplPct, facilityType) => ilCharityTier(fplPct, facilityType === "critical_access_hospital"),
  NY: (fplPct) => nyCharityTier(fplPct),
  OR: (fplPct, _facilityType, ownership) => orCharityTier(fplPct, ownership),
  MD: (fplPct) => mdCharityTier(fplPct),
  RI: (fplPct) => riCharityTier(fplPct),
  MA: (fplPct) => maCharityTier(fplPct),
  ME: (fplPct) => meCharityTier(fplPct),
  VT: (fplPct) => vtCharityTier(fplPct),
  // NRS 439B.260: at least 30% off total billed charges for uninsured
  // inpatients at NV "major hospitals" (gated by charity_care_participant),
  // regardless of income -- so a flat, upper-bound 70% share.
  NV: (fplPct) => ({ patientPaysPct: 70, fplPct, maxFplPct: null }),
};

export const MODELED_CHARITY_STATES = [...Object.keys(STATE_CHARITY_TIER_FNS), ...Object.keys(FREE_TIER_STATES)];

// Only used to name the program in a sentence -- the actual numbers always
// come from charityTier(), never hardcoded here. WA's note (confirm with
// the specific hospital whether it's part of a larger system) matters
// enough to state inline, not just in the info panel.
export const CHARITY_PROGRAM_NAMES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(FREE_TIER_STATES).map(([st, f]) => [st, f.programName])),
  NJ: "NJ Charity Care",
  WA: "Washington's charity care law (the minimum every hospital must offer -- some larger hospital systems must offer better terms)",
  IL: "the Illinois Hospital Uninsured Patient Discount Act (uninsured patients only)",
  NY: "the New York Hospital Financial Assistance Law",
  OR: "Oregon's hospital financial assistance law (nonprofit hospitals only)",
  MD: "Maryland's hospital financial assistance law",
  RI: "Rhode Island's hospital charity care regulation",
  MA: "Massachusetts's Health Safety Net",
  ME: "Maine's free hospital care law (Maine residents only)",
  VT: "Vermont's hospital financial assistance law (Vermont residents only)",
  NV: "Nevada's major-hospital discount law (uninsured inpatients)",
};

/** Charity-care tier for whichever state a facility is in, or null if that
 * state has no modeled formula -- caller should say so, never guess a tier.
 * facilityType matters for IL (standard vs Critical Access Hospital picks a
 * different free-care threshold); ownership matters for OR (nonprofit-only
 * scope) -- each is ignored by states whose formula doesn't depend on it. */
export function charityTier(state: string, fplPct: number, facilityType?: string, ownership?: string): CharityTier | null {
  const fn = STATE_CHARITY_TIER_FNS[state];
  if (fn) return fn(fplPct, facilityType, ownership);
  const free = FREE_TIER_STATES[state];
  if (free && (free.strictlyBelow ? fplPct < free.maxFplPct : fplPct <= free.maxFplPct)) {
    return { patientPaysPct: 0, fplPct, maxFplPct: free.maxFplPct };
  }
  return null;
}

// 42 CFR 51c.303(f), (u): the federal sliding-fee rule for FQHCs and
// Look-Alikes, the same in every state. Full discount at or below 100% FPL
// (a nominal fee may still apply, with no federal cap), each clinic's own
// sliding scale up to 200%, no discount required above. There's no clinic
// charge data, so this never produces a dollar figure or percentage.
export function fqhcSlidingFee(fplPct: number | null, insured: boolean): { hero: string; label: string } {
  const noDenial = "It can't turn you away for inability to pay.";
  if (insured) return { hero: "Health center", label: `Federally funded health center that bills your coverage. ${noDenial}` };
  if (fplPct == null) return { hero: "Sliding fee", label: `Federally funded health center: discounts by income up to 200% of the poverty line. ${noDenial}` };
  if (fplPct <= 100) {
    return { hero: "Free or small fee", label: `Federal rule at your income: a full discount, though the clinic may charge a small flat fee. ${noDenial}` };
  }
  if (fplPct <= 200) return { hero: "Sliding scale", label: `Federal rule at your income: discounted on this clinic's own sliding scale. ${noDenial}` };
  return { hero: "Regular fee", label: `No income discount is required above 200% of the poverty line. ${noDenial}` };
}

export function applyTier(typicalCharge: number, patientPaysPct: number): number {
  return Math.round(typicalCharge * (patientPaysPct / 100) * 100) / 100;
}
