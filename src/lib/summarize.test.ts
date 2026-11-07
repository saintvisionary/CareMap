import { describe, expect, it } from "vitest";
import type { FacilityWithDistance } from "./geo";
import { summarize, type QueryResult } from "./summarize";

function facility(over: Partial<FacilityWithDistance>): FacilityWithDistance {
  return {
    ccn: "000000",
    name: "TEST HOSPITAL",
    type: "acute_care_hospital",
    ownership: "Voluntary non-profit - Private",
    has_er: true,
    star_rating: 3,
    address: "1 Main St",
    city: "Town",
    state: "NJ",
    zip: "07018",
    county: "Essex",
    lat: 40.76,
    lon: -74.21,
    drg_charges: {},
    charity_care_participant: true,
    distanceMiles: 1,
    ...over,
  };
}

const URGENT = facility({ ccn: "NPI-1", name: "QUICK CARE", type: "urgent_care", charity_care_participant: false, distanceMiles: 0.5 });
const CLINIC = facility({ ccn: "BPS-1", name: "COMMUNITY CLINIC", type: "fqhc", charity_care_participant: false, distanceMiles: 0.7 });

function run(over: Partial<QueryResult>): string {
  return summarize({ zipCode: "07018", fplPct: 158, insuranceType: "uninsured", veteran: false, need: null, facilities: [facility({})], ...over });
}

describe("summary safety", () => {
  it("leads with 911 for an emergency and never offers urgent care", () => {
    const s = run({ emergency: true, facilities: [URGENT, facility({})] });
    expect(s.startsWith("If this is an emergency, call 911")).toBe(true);
    expect(s).not.toMatch(/urgent care/i);
  });

  it("still gives the 911 line when no zip is given", () => {
    expect(run({ zipCode: null, emergency: true })).toMatch(/call 911/);
  });

  it("offers urgent care only with no procedure, always with the 911 caveat", () => {
    expect(run({ facilities: [URGENT, facility({})] })).toMatch(/nearest listed urgent care center is QUICK CARE.*call 911/);
    expect(run({ need: "heart attack", facilities: [URGENT, facility({})] })).not.toMatch(/urgent care/i);
  });

  it("names the nearest hospital, not a clinic or urgent care center", () => {
    expect(run({ facilities: [URGENT, CLINIC, facility({})] })).toMatch(/Nearest: TEST HOSPITAL/);
  });
});

describe("summary tiers", () => {
  it("NJ free tier at 158% FPL", () => {
    expect(run({})).toMatch(/NJ Charity Care covers hospital care in full.*\$0/);
  });

  it("no charity-care price for an insured user", () => {
    expect(run({ insuranceType: "private" })).not.toMatch(/\$0/);
  });

  it("VA hospitals get the VA message, not a state program", () => {
    expect(run({ facilities: [facility({ type: "va_hospital", charity_care_participant: false })] })).toMatch(/VA's own eligibility rules/);
  });

  it("Illinois's 20% cap only up to its eligibility ceiling", () => {
    const il = facility({ state: "IL" });
    expect(run({ fplPct: 400, facilities: [il] })).toMatch(/20% of your family income/);
    expect(run({ fplPct: 700, facilities: [il] })).not.toMatch(/20% of your family income/);
  });

  it("California shows Medicare's payment as a reference, never a price", () => {
    const ca = facility({ state: "CA", drg_charges: { "280": { avg_charge: 110_829, avg_total_payment: 16_436 } } });
    const s = run({ fplPct: 300, need: "heart attack", facilities: [ca] });
    expect(s).toMatch(/Medicare's average total payment for it there is \$16,436/);
    expect(s).toMatch(/could be higher/);
  });

  it("names the nearest sliding-fee clinic with the federal rule", () => {
    expect(run({ fplPct: 90, facilities: [CLINIC, facility({})] })).toMatch(/COMMUNITY CLINIC.*should be free/);
  });
});

describe("federal nonprofit-hospital cap (any state)", () => {
  const fl = facility({
    state: "FL",
    ownership: "Voluntary non-profit - Private",
    charity_care_participant: false,
    drg_charges: { "280": { avg_charge: 85_123, avg_total_payment: 14_566 } },
  });

  it("gives Medicare's payment as a reference, framed as 'if you qualify'", () => {
    const s = run({ need: "heart attack", facilities: [fl] });
    expect(s).toMatch(/nonprofit hospital, so if you qualify for its financial assistance.*\$14,566/);
    expect(s).toMatch(/could be higher or lower/);
  });

  it("not for for-profit hospitals, insured users, or where a state tier already applies", () => {
    expect(run({ need: "heart attack", facilities: [{ ...fl, ownership: "Proprietary" }] })).not.toMatch(/amount generally billed/);
    expect(run({ need: "heart attack", insuranceType: "private", facilities: [fl] })).not.toMatch(/amount generally billed/);
    const nj = facility({ drg_charges: { "280": { avg_charge: 100_000, avg_total_payment: 20_000 } } });
    expect(run({ need: "heart attack", facilities: [nj] })).not.toMatch(/amount generally billed/);
  });
});

describe("everyday care leads with the right place", () => {
  it("a checkup leads with the nearest sliding-fee clinic", () => {
    const s = run({ need: "checkup", facilities: [facility({}), CLINIC] });
    expect(s.indexOf("COMMUNITY CLINIC")).toBeLessThan(s.indexOf("Found"));
    expect(s).toMatch(/For a checkup, a sliding-fee health center/);
  });

  it("a sick visit offers urgent care, still with the 911 line", () => {
    expect(run({ need: "sick visit", facilities: [URGENT, facility({})] })).toMatch(/QUICK CARE.*call 911/);
  });

  it("mental health always includes 988", () => {
    expect(run({ need: "counseling", facilities: [CLINIC, facility({})] })).toMatch(/988/);
  });

  it("no double hyphens anywhere in a summary", () => {
    for (const need of [null, "checkup", "heart attack", "sick visit"]) {
      expect(run({ need, facilities: [URGENT, CLINIC, facility({})] })).not.toMatch(/ -- /);
    }
  });
});
