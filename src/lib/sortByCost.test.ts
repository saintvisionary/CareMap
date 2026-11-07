import { describe, expect, it } from "vitest";
import type { FacilityWithDistance } from "./geo";
import { sortByCost } from "./sortByCost";

const h = (ccn: string, miles: number, charge: number | null, state = "NJ") =>
  ({ ccn, type: "acute_care_hospital", ownership: "Voluntary non-profit - Private", state, charity_care_participant: state === "NJ", distanceMiles: miles, drg_charges: charge == null ? {} : { "419": { avg_charge: charge } } }) as unknown as FacilityWithDistance;

describe("sortByCost", () => {
  const list = [h("near-pricey", 1, 90_000), h("no-price", 2, null), h("far-cheap", 9, 60_000)];
  it("cheapest charge first, unpriced last", () => {
    expect(sortByCost(list, "gallbladder surgery", null, "uninsured").map((f) => f.ccn)).toEqual(["far-cheap", "near-pricey", "no-price"]);
  });
  it("uses what the person would owe: all $0 ties go closest first (free care shows $0 even without a price)", () => {
    expect(sortByCost(list, "gallbladder surgery", 158, "uninsured").map((f) => f.ccn)).toEqual(["near-pricey", "no-price", "far-cheap"]);
  });
  it("owed amount beats raw charge across states", () => {
    const mixed = [h("ny-cheap-charge", 1, 50_000, "PA"), h("nj-free", 5, 90_000)];
    expect(sortByCost(mixed, "gallbladder surgery", 158, "uninsured").map((f) => f.ccn)).toEqual(["nj-free", "ny-cheap-charge"]);
  });
});

it("ranks by the number the card shows, e.g. Medicare's amount at a nonprofit", () => {
  const fl = (ccn: string, own: string, charge: number, medicare: number) =>
    ({ ccn, type: "acute_care_hospital", ownership: own, state: "FL", charity_care_participant: false, distanceMiles: 1, drg_charges: { "280": { avg_charge: charge, avg_total_payment: medicare } } }) as unknown as FacilityWithDistance;
  const list = [fl("forprofit", "Proprietary", 32_000, 9_000), fl("nonprofit", "Voluntary non-profit - Private", 85_000, 14_000)];
  expect(sortByCost(list, "heart attack", null, "uninsured").map((f) => f.ccn)).toEqual(["nonprofit", "forprofit"]);
});
