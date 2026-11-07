import { describe, expect, it } from "vitest";
import { explain } from "./explain";
import type { Facility } from "./types";

const f = (over: Partial<Facility>): Facility =>
  ({
    ccn: "1", name: "Test", type: "acute_care_hospital", ownership: "Voluntary non-profit - Private", has_er: true, star_rating: 3,
    address: "", city: "", state: "NJ", zip: "07018", county: "", lat: 0, lon: 0, drg_charges: {}, charity_care_participant: true, ...over,
  }) as Facility;

describe("what the law says, in dollars for the household", () => {
  it("NJ: free and discount limits for 4 people, and where they fit", () => {
    const e = explain(f({}), 158, "uninsured", 4);
    expect(e.rule).toMatch(/free care to families who make up to \$66,000 a year \(for 4 people\)/);
    expect(e.rule).toMatch(/discount up to \$99,000/);
    expect(e.you).toMatch(/should be free/);
    expect(explain(f({}), 400, "uninsured", 4).you).toMatch(/above the limit/);
  });

  it("health centers: the federal sliding fee in dollars", () => {
    expect(explain(f({ type: "fqhc", charity_care_participant: false }), 90, "uninsured", 1).rule).toMatch(/under \$16,000 a year.*can't turn you away/);
  });

  it("states CareMap doesn't model: the federal nonprofit rule, or nothing for for-profits", () => {
    expect(explain(f({ state: "FL", charity_care_participant: false }), 150, "uninsured", 2).rule).toMatch(/nonprofit hospital. Federal law/);
    expect(explain(f({ state: "FL", ownership: "Proprietary", charity_care_participant: false }), 150, "uninsured", 2).rule).toMatch(/isn't a nonprofit/);
  });

  it("VA and insured get plain guidance, never a percent", () => {
    for (const e of [explain(f({ type: "va_hospital", charity_care_participant: false }), 150, "uninsured", 2), explain(f({}), 150, "private", 2)]) {
      expect(`${e.rule} ${e.you ?? ""} ${e.next}`).not.toMatch(/%|poverty line/);
    }
  });
});

describe("the math is shown step by step", () => {
  const nj = f({ drg_charges: { "419": { avg_charge: 70_000, avg_total_payment: 12_000 } } });
  it("exact income: divide by the line, apply the share, multiply the bill", () => {
    const e = explain(nj, 158, "uninsured", 4, { income: "52000", incomeRange: null, need: "gallbladder surgery" });
    expect(e.math).toEqual([
      ["Poverty line for 4 people (2026)", "$33,000 a year"],
      ["Your income", "$52,000 ÷ $33,000 = 1.6 × the line"],
      ["New Jersey rule at 1.6 ×", "you pay 0% (free)"],
      ["Gallbladder surgery bill here", "$70,000 × 0% = $0"],
    ]);
  });
  it("a range uses its top, and a 40% share is multiplied out", () => {
    const e = explain(nj, 250, "uninsured", 4, { income: "", incomeRange: 250, need: "gallbladder surgery" });
    expect(e.math?.at(-1)).toEqual(["Gallbladder surgery bill here", "$70,000 × 40% = $28,000"]);
  });
  it("no income, no math", () => expect(explain(nj, null, "uninsured", 4, { income: "", incomeRange: null, need: null }).math).toBeUndefined());
});
