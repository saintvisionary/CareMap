import { describe, expect, it } from "vitest";
import policy from "../../policy/policy.json";
import { charityTier, fqhcSlidingFee, FREE_TIER_STATES, fplPercent } from "./policy";

// The TS tiers mirror caremap/policy.py by hand; both must match the
// numbers in policy/policy.json, which the Python side reads directly.
type Tier = { max_fpl_pct: number | null; patient_pays_pct: number };
const P = policy as unknown as Record<string, { tiers?: Tier[]; free_care_max_fpl_pct?: number; free_care_strictly_below?: boolean }>;

function tableShare(key: string, fpl: number): number {
  for (const t of P[key].tiers!) if (t.max_fpl_pct === null || fpl <= t.max_fpl_pct) return t.patient_pays_pct;
  throw new Error("unreachable");
}

const FPLS = Array.from({ length: 701 }, (_, i) => i);

describe("tier tables match policy.json", () => {
  it.each([
    ["NJ", "nj_charity_care"],
    ["WA", "wa_charity_care"],
    ["MD", "md_charity_care"],
  ])("%s", (state, key) => {
    for (const fpl of FPLS) expect(charityTier(state, fpl)?.patientPaysPct).toBe(tableShare(key, fpl));
  });

  it("OR (nonprofit hospitals only)", () => {
    for (const fpl of FPLS) {
      expect(charityTier("OR", fpl, "acute_care_hospital", "Voluntary non-profit - Private")?.patientPaysPct).toBe(
        tableShare("or_charity_care", fpl),
      );
    }
    expect(charityTier("OR", 150, "acute_care_hospital", "Proprietary")).toBeNull();
    expect(charityTier("OR", 150)).toBeNull();
  });
});

describe("free-care lines match policy.json", () => {
  const freeTierKeys: Record<string, string> = {
    NY: "ny_charity_care",
    RI: "ri_charity_care",
    MA: "ma_charity_care",
    ME: "me_charity_care",
    VT: "vt_charity_care",
    NC: "nc_charity_care",
    OH: "oh_charity_care",
    SC: "sc_charity_care",
  };
  it.each(Object.entries(freeTierKeys))("%s", (state, key) => {
    const line = P[key].free_care_max_fpl_pct!;
    const strict = P[key].free_care_strictly_below === true;
    for (const fpl of FPLS) {
      const free = strict ? fpl < line : fpl <= line;
      expect(charityTier(state, fpl)?.patientPaysPct ?? null).toBe(free ? 0 : null);
    }
  });

  it("every FREE_TIER_STATES row has a policy.json block with the same line", () => {
    for (const [state, row] of Object.entries(FREE_TIER_STATES)) {
      expect(row.maxFplPct).toBe(P[freeTierKeys[state]].free_care_max_fpl_pct);
    }
  });

  it("IL: 200% at standard hospitals, 125% at Critical Access Hospitals", () => {
    expect(charityTier("IL", 200, "acute_care_hospital")?.patientPaysPct).toBe(0);
    expect(charityTier("IL", 201, "acute_care_hospital")).toBeNull();
    expect(charityTier("IL", 125, "critical_access_hospital")?.patientPaysPct).toBe(0);
    expect(charityTier("IL", 126, "critical_access_hospital")).toBeNull();
  });
});

describe("per-hospital and flat rules", () => {
  it("CT needs the hospital's cost cap and stops above 250% FPL", () => {
    expect(charityTier("CT", 250, "acute_care_hospital", "", 37)?.patientPaysPct).toBe(37);
    expect(charityTier("CT", 251, "acute_care_hospital", "", 37)).toBeNull();
    expect(charityTier("CT", 150)).toBeNull();
  });

  it("NV is a flat 70% at any income", () => {
    expect(charityTier("NV", 50)?.patientPaysPct).toBe(70);
    expect(charityTier("NV", 900)?.patientPaysPct).toBe(70);
  });

  it("unmodeled states and the Medicare-cap states have no tier", () => {
    for (const st of ["TX", "CA", "CO", "PA"]) expect(charityTier(st, 100)).toBeNull();
  });
});

describe("federal FQHC sliding fee", () => {
  it("bands by income, never a dollar figure", () => {
    expect(fqhcSlidingFee(100, false).hero).toBe("Free or small fee");
    expect(fqhcSlidingFee(150, false).hero).toBe("Discount by income");
    expect(fqhcSlidingFee(201, false).hero).toBe("No discount");
    expect(fqhcSlidingFee(90, true).hero).toBe("Bills your plan");
    for (const fpl of [null, 50, 150, 300]) expect(fqhcSlidingFee(fpl, false).label).not.toMatch(/\$\d/);
  });
});

it("fplPercent matches the demo case", () => {
  expect(fplPercent(52_000, 4)).toBe(158);
});
