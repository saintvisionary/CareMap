import { describe, expect, it } from "vitest";
import { redact } from "../lib/intake";
import { EMPTY_PROFILE, mergeProfile, nearbyCare, profileFocus, profileFplPct } from "./useCareMap";
import type { Facility } from "../lib/types";

describe("follow-up messages keep the previous search's details", () => {
  const first = mergeProfile(EMPTY_PROFILE, redact("21201, family of 4, $50,000, uninsured, need heart attack"));

  it("parses the first message into the profile", () => {
    expect(first).toMatchObject({ zip: "21201", household: 4, income: "50000", insuranceType: "uninsured", need: "heart attack" });
    expect(profileFplPct(first)).toBe(fplOf(50000, 4));
  });

  it("a follow-up with no zip keeps zip, income, insurance and need", () => {
    expect(mergeProfile(first, redact("what hospital in this area is the best?"))).toEqual(first);
  });

  it("anything restated wins", () => {
    expect(mergeProfile(first, redact("what about 21230, need gallbladder surgery"))).toMatchObject({ zip: "21230", income: "50000", need: "gallbladder surgery" });
  });

  it("an emergency carries over until a different need is named", () => {
    const e = mergeProfile(first, redact("now trouble breathing"));
    expect(mergeProfile(e, redact("which one is closest?")).emergency).toBe(true);
    expect(mergeProfile(e, redact("need gallbladder surgery")).emergency).toBe(false);
  });

  it("no estimate for anyone but the uninsured", () => {
    expect(profileFplPct({ ...first, insuranceType: "private" })).toBeNull();
    expect(profileFplPct({ ...first, income: "" })).toBeNull();
  });
});

function fplOf(income: number, size: number) {
  return Math.round((income / (15_960 + 5_680 * (size - 1))) * 100);
}

describe("result order follows the need", () => {
  const at = (ccn: string, type: string, lat: number) => ({ ccn, type, lat, lon: -74.2, name: ccn }) as Facility;
  const zips = { "07018": { lat: 40.76, lon: -74.2 } };
  const hospitals = [at("H", "acute_care_hospital", 40.77)];
  const clinics = [at("C", "fqhc", 40.79)];
  const urgent = [at("U", "urgent_care", 40.765)];
  const order = (need: string | null, emergency = false) =>
    nearbyCare(hospitals, clinics, urgent, zips, "07018", profileFocus({ ...EMPTY_PROFILE, need, emergency })).map((f) => f.ccn);

  it("checkup: clinics first", () => expect(order("checkup")).toEqual(["C", "H"]));
  it("sick visit: urgent care and clinics first", () => expect(order("sick visit")).toEqual(["U", "C", "H"]));
  it("hospital procedure and emergency: hospitals first, no urgent care", () => {
    expect(order("heart attack")).toEqual(["H", "C"]);
    expect(order(null, true)).toEqual(["H", "C"]);
  });
  it("just looking: nearest first", () => expect(order(null)).toEqual(["U", "H", "C"]));
});
