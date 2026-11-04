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

// Keyed by a facility's own state. Only states with a real, codified,
// state-wide formula belong here -- most states have no such law (just
// federal 501(r): each nonprofit hospital must have *a* policy, with no
// public structured dataset of what it says), so this stays short.
const STATE_CHARITY_TIER_FNS: Record<string, (fplPct: number, facilityType?: string) => CharityTier | null> = {
  NJ: (fplPct) => njCharityTier(fplPct),
  WA: (fplPct) => waCharityTier(fplPct),
  IL: (fplPct, facilityType) => ilCharityTier(fplPct, facilityType === "critical_access_hospital"),
};

export const MODELED_CHARITY_STATES = Object.keys(STATE_CHARITY_TIER_FNS);

// Only used to name the program in a sentence -- the actual numbers always
// come from charityTier(), never hardcoded here. WA's note (confirm with
// the specific hospital whether it's part of a larger system) matters
// enough to state inline, not just in the info panel.
export const CHARITY_PROGRAM_NAMES: Record<string, string> = {
  NJ: "NJ Charity Care",
  WA: "Washington's charity care law (the minimum every hospital must offer -- some larger hospital systems must offer better terms)",
  IL: "the Illinois Hospital Uninsured Patient Discount Act (uninsured patients only)",
};

/** Charity-care tier for whichever state a facility is in, or null if that
 * state has no modeled formula -- caller should say so, never guess a tier.
 * facilityType matters for IL (standard vs Critical Access Hospital picks a
 * different free-care threshold) -- ignored by states whose formula doesn't
 * depend on it. */
export function charityTier(state: string, fplPct: number, facilityType?: string): CharityTier | null {
  const fn = STATE_CHARITY_TIER_FNS[state];
  return fn ? fn(fplPct, facilityType) : null;
}

export function applyTier(typicalCharge: number, patientPaysPct: number): number {
  return Math.round(typicalCharge * (patientPaysPct / 100) * 100) / 100;
}
