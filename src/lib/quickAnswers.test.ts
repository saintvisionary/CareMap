import { describe, expect, it } from "vitest";
import type { FacilityWithDistance } from "./geo";
import { quickAnswer, quickQuestions, type Intent, type QuickContext } from "./quickAnswers";

function at(over: Partial<FacilityWithDistance>): FacilityWithDistance {
  return {
    ccn: "1",
    name: "Near Hospital",
    type: "acute_care_hospital",
    ownership: "Voluntary non-profit - Private",
    has_er: true,
    star_rating: 3,
    address: "1 Main St",
    city: "East Orange",
    state: "NJ",
    zip: "07018",
    county: "Essex",
    lat: 40.7,
    lon: -74.2,
    drg_charges: {},
    charity_care_participant: true,
    distanceMiles: 1,
    ...over,
  };
}

const near = at({ ccn: "A", name: "Near Hospital", distanceMiles: 1, drg_charges: { "419": { avg_charge: 90_000 } } });
const far = at({ ccn: "B", name: "Far Hospital", distanceMiles: 9, drg_charges: { "419": { avg_charge: 60_000 } } });
const clinic = at({ ccn: "C", name: "Community Clinic", type: "fqhc", charity_care_participant: false, distanceMiles: 0.5 });
const base: QuickContext = { facilities: [clinic, near, far], fplPct: null, insuranceType: "uninsured", need: null, veteran: false, active: null };

describe("questions follow what's been entered", () => {
  const labels = (ctx: Partial<QuickContext>, place = true) => quickQuestions({ ...base, ...ctx }, place).map((q) => q.label);
  it("no place yet: general questions", () => expect(labels({}, false)).toContain("How does hospital charity care work?"));
  it("a procedure with income: costs me the least", () => expect(labels({ need: "gallbladder surgery", fplPct: 158 })).toContain("Which hospital costs me the least?"));
  it("a procedure, no income: charges the least, and do I qualify", () => {
    expect(labels({ need: "gallbladder surgery" })).toEqual(expect.arrayContaining(["Which hospital charges the least?", "Do I qualify for free care?"]));
  });
  it("everyday care: visit cost and what to bring", () => expect(labels({ need: "checkup" })).toEqual(expect.arrayContaining(["What would a visit cost me?", "What should I bring?"])));
  it("an open card names that hospital", () => expect(labels({ active: far, fplPct: 158 })).toContain("Help me apply at Far Hospital"));
  it("insured: no charity-care application prompt", () => expect(labels({ insuranceType: "private" }).join()).not.toMatch(/apply|qualify/i));
});

describe("answers use the person's inputs", () => {
  const answer = (intent: Intent, ctx: Partial<QuickContext>) => quickAnswer(intent, { ...base, ...ctx });

  it("ranks by what they'd owe: $0 everywhere, closest first", () => {
    const a = answer("affordable", { need: "gallbladder surgery", fplPct: 158 });
    expect(a).toMatch(/2 nearby hospitals .* estimated \$0 under NJ Charity Care/);
    expect(a.indexOf("Near Hospital")).toBeLessThan(a.indexOf("Far Hospital"));
  });

  it("ranks by owed amount when there's a share", () => {
    const a = answer("affordable", { need: "gallbladder surgery", fplPct: 260 });
    expect(a.indexOf("Far Hospital")).toBeLessThan(a.indexOf("Near Hospital"));
    expect(a).toMatch(/\$36,000 \(60% of a \$60,000 typical billed charge\)/);
  });

  it("without income, ranks by typical billed charge and asks for income", () => {
    const a = answer("affordable", { need: "gallbladder surgery" });
    expect(a.indexOf("Far Hospital")).toBeLessThan(a.indexOf("Near Hospital"));
    expect(a).toMatch(/Add your income/);
  });

  it("unmodeled state: billed charges plus the federal nonprofit rule", () => {
    const fl = [near, far].map((f) => ({ ...f, state: "FL", charity_care_participant: false }));
    expect(answer("affordable", { facilities: fl, need: "gallbladder surgery", fplPct: 158 })).toMatch(/Nonprofit hospitals must offer financial assistance/);
  });

  it("qualify uses the computed poverty-line percent", () => {
    expect(answer("qualify", { fplPct: 158 })).toMatch(/^Likely yes\. At 158% of the poverty line, NJ Charity Care covers hospital care in full/);
    expect(answer("qualify", {})).toMatch(/Add your household size and income/);
  });

  it("billing questions name the program and the Good Faith Estimate", () => {
    const a = answer("billing", {});
    expect(a).toMatch(/NJ Charity Care/);
    expect(a).toMatch(/Good Faith Estimate/);
  });

  it("every dollar answer carries the disclosure; nothing uses double hyphens", () => {
    for (const intent of ["affordable", "qualify", "billing", "apply", "visitCost", "bring", "charityCare", "slidingFee"] as Intent[]) {
      for (const ctx of [{}, { need: "gallbladder surgery", fplPct: 158 }, { need: "checkup", fplPct: 90 }, { insuranceType: "private" as const, need: "gallbladder surgery" }]) {
        const a = answer(intent, ctx);
        expect(a).not.toMatch(/ -- |—/);
        if (/\$\d/.test(a)) expect(a).toMatch(/confirm with billing office/);
      }
    }
  });
});

it("a metro area spanning states doesn't credit one state's law for all of it", () => {
  const ny = at({ ccn: "N", name: "City Hospital", state: "NY", distanceMiles: 3, drg_charges: { "419": { avg_charge: 80_000 } } });
  const a = quickAnswer("affordable", { ...base, facilities: [near, ny], need: "gallbladder surgery", fplPct: 158 });
  expect(a).toMatch(/under each state's charity-care rules/);
  expect(a).toMatch(/City Hospital\*\* \(3\.0 mi, NY\)/);
});
