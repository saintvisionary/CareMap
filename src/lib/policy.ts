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

export interface NjCharityTier {
  patientPaysPct: number;
  fplPct: number;
  maxFplPct: number | null;
}

const NJ_CHARITY_TIERS: { maxFplPct: number | null; patientPaysPct: number }[] = [
  { maxFplPct: 200, patientPaysPct: 0 },
  { maxFplPct: 225, patientPaysPct: 20 },
  { maxFplPct: 250, patientPaysPct: 40 },
  { maxFplPct: 275, patientPaysPct: 60 },
  { maxFplPct: 300, patientPaysPct: 80 },
  { maxFplPct: null, patientPaysPct: 100 },
];

export function njCharityTier(fplPct: number): NjCharityTier {
  for (const tier of NJ_CHARITY_TIERS) {
    if (tier.maxFplPct === null || fplPct <= tier.maxFplPct) {
      return { patientPaysPct: tier.patientPaysPct, fplPct, maxFplPct: tier.maxFplPct };
    }
  }
  throw new Error("unreachable");
}

export function applyTier(typicalCharge: number, patientPaysPct: number): number {
  return Math.round(typicalCharge * (patientPaysPct / 100) * 100) / 100;
}
