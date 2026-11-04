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

// Keyed by a facility's own state. Only states with a real, codified,
// state-wide formula belong here -- most states have no such law (just
// federal 501(r): each nonprofit hospital must have *a* policy, with no
// public structured dataset of what it says), so this stays short.
const STATE_CHARITY_TIER_FNS: Record<string, (fplPct: number) => CharityTier> = {
  NJ: njCharityTier,
  WA: waCharityTier,
};

export const MODELED_CHARITY_STATES = Object.keys(STATE_CHARITY_TIER_FNS);

// Only used to name the program in a sentence -- the actual numbers always
// come from charityTier(), never hardcoded here. WA's note (confirm with
// the specific hospital whether it's part of a larger system) matters
// enough to state inline, not just in the info panel.
export const CHARITY_PROGRAM_NAMES: Record<string, string> = {
  NJ: "NJ Charity Care",
  WA: "Washington's charity care law (the minimum every hospital must offer -- some larger hospital systems must offer better terms)",
};

/** Charity-care tier for whichever state a facility is in, or null if that
 * state has no modeled formula -- caller should say so, never guess a tier. */
export function charityTier(state: string, fplPct: number): CharityTier | null {
  const fn = STATE_CHARITY_TIER_FNS[state];
  return fn ? fn(fplPct) : null;
}

export function applyTier(typicalCharge: number, patientPaysPct: number): number {
  return Math.round(typicalCharge * (patientPaysPct / 100) * 100) / 100;
}
