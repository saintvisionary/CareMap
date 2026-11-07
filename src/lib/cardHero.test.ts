import { describe, expect, it } from "vitest";
import { cardHero } from "./cardHero";
import type { InsuranceType } from "./intake";
import type { Facility } from "./types";

function facility(over: Partial<Facility>): Facility {
  return {
    ccn: "1",
    name: "Test Hospital",
    type: "acute_care_hospital",
    ownership: "Voluntary non-profit - Private",
    has_er: true,
    star_rating: 3,
    address: "1 Main St",
    city: "Town",
    state: "NJ",
    zip: "07018",
    county: "Essex",
    lat: 40.7,
    lon: -74.2,
    drg_charges: { "419": { avg_charge: 70_000, avg_total_payment: 12_000 } },
    charity_care_participant: true,
    ...over,
  };
}

const CASES: [string, Facility, number | null, InsuranceType | null, string | null][] = [
  ["NJ free with a price", facility({}), 158, "uninsured", "gallbladder surgery"],
  ["NJ free, no need", facility({}), 158, "uninsured", null],
  ["NJ reduced", facility({}), 260, "uninsured", null],
  ["NJ full", facility({}), 400, "uninsured", null],
  ["no income yet", facility({}), null, "uninsured", null],
  ["insured", facility({}), 158, "private", "gallbladder surgery"],
  ["FL nonprofit, federal cap", facility({ state: "FL", charity_care_participant: false }), 200, "uninsured", "gallbladder surgery"],
  ["FL nonprofit, no price data", facility({ state: "FL", charity_care_participant: false, drg_charges: {} }), 200, "uninsured", "gallbladder surgery"],
  ["FL for-profit", facility({ state: "FL", ownership: "Proprietary", charity_care_participant: false }), 200, "uninsured", null],
  ["CA cap", facility({ state: "CA" }), 300, "uninsured", "gallbladder surgery"],
  ["IL above free line", facility({ state: "IL" }), 350, "uninsured", null],
  ["VA", facility({ type: "va_hospital", charity_care_participant: false }), 150, "uninsured", null],
  ["clinic", facility({ type: "fqhc", charity_care_participant: false }), 90, "uninsured", null],
  ["urgent care", facility({ type: "urgent_care", charity_care_participant: false }), 90, "uninsured", null],
];

describe("card text", () => {
  it.each(CASES)("%s: sentence case, no double hyphens", (_, f, fpl, ins, need) => {
    const { hero, label } = cardHero(f, fpl, ins, need);
    expect(hero.charAt(0)).toMatch(/[A-Z0-9$]/);
    expect(label.charAt(0)).toMatch(/[A-Z]/);
    expect(`${hero} ${label}`).not.toMatch(/--|—/);
  });

  it("every dollar figure is labeled as an estimate", () => {
    for (const [, f, fpl, ins, need] of CASES) {
      const { hero, label } = cardHero(f, fpl, ins, need);
      if (hero.startsWith("$") && ins === "uninsured") expect(label).toMatch(/Estimate, confirm with billing office/);
    }
  });

  it("prices what it can", () => {
    expect(cardHero(facility({}), 158, "uninsured", "gallbladder surgery").hero).toBe("$0");
    expect(cardHero(facility({ state: "FL", charity_care_participant: false }), 200, "uninsured", "gallbladder surgery").hero).toBe("$12,000");
    expect(cardHero(facility({}), null, "uninsured", null).hero).toBe("Add income");
  });

  it("says when a hospital has no price for the procedure", () => {
    const { label } = cardHero(facility({ state: "FL", charity_care_participant: false, drg_charges: {} }), 200, "uninsured", "gallbladder surgery");
    expect(label).toMatch(/No price data here for laparoscopic cholecystectomy/);
  });
});

import { siteLink } from "../components/ResultCard";
describe("clinic website links", () => {
  it("tags visits as CareMap referrals and nothing else", () => {
    expect(siteLink("www.clinic.org/care")).toBe("https://www.clinic.org/care?utm_source=caremap&utm_medium=referral");
    expect(siteLink("javascript:alert(1)")).toBeNull();
    expect(siteLink(undefined)).toBeNull();
  });
});
