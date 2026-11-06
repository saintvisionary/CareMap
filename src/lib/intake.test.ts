import { describe, expect, it } from "vitest";
import { redact } from "./intake";

describe("redact keeps income and household size in the browser", () => {
  it.each([
    "07018, family of 4, $52,000, uninsured, need gallbladder surgery",
    "07018, family of 4, $52000, uninsured",
    "07018, family of 4, $52k, uninsured",
  ])("%s", (msg) => {
    const h = redact(msg);
    expect(h.fplPct).toBe(158);
    expect(h.redactedMessage).not.toMatch(/52/);
    expect(h.redactedMessage).not.toMatch(/family of 4/);
  });
});

describe("parses the rest of the hint", () => {
  it("zip, insurance and need", () => {
    const h = redact("07018, family of 4, $52k, uninsured, need gallbladder surgery");
    expect(h.zipCode).toBe("07018");
    expect(h.insuranceType).toBe("uninsured");
    expect(h.need).toBe("gallbladder surgery");
    expect(h.emergency).toBe(false);
  });

  it.each(["trouble breathing", "I can't breathe", "possible overdose", "I think it's a stroke", "having a seizure", "chest pain"])(
    "flags an emergency: %s",
    (msg) => expect(redact(`07018, ${msg}`).emergency).toBe(true),
  );

  it("doesn't flag ordinary needs", () => {
    expect(redact("07018, twisted ankle").emergency).toBe(false);
  });
});

describe("newer needs", () => {
  it.each([
    ["I fainted at work", "fainting"],
    ["need a TAVR", "heart valve replacement (TAVR)"],
    ["poor circulation in my legs", "poor circulation in the legs"],
    ["respiratory failure", "respiratory failure"],
    ["need bowel surgery", "bowel surgery"],
    ["had a mini-stroke", "mini-stroke (TIA)"],
    ["a stroke", "stroke"],
    ["severe dehydration", "dehydration or electrolyte imbalance"],
  ])("%s -> %s", (msg, need) => expect(redact(`07018, ${msg}`).need).toBe(need));
});

describe("everyday care", () => {
  it.each([
    ["I need a checkup", "checkup"],
    ["annual physical", "checkup"],
    ["a checkup for my diabetes", "checkup"],
    ["I have the flu", "sick visit"],
    ["sore throat and fever", "sick visit"],
    ["flu shot", "vaccines"],
    ["need a dentist", "dental care"],
    ["I'm pregnant", "pregnancy care"],
    ["looking for a therapist", "counseling"],
    ["dealing with anxiety", "counseling"],
    ["sprained my ankle", "minor injury"],
    ["severe depression", "severe depression"],
    ["need chemotherapy", "chemotherapy"],
    ["physical therapy", null],
    ["broken arm", "broken bone, sprain or dislocation"],
  ])("%s -> %s", (msg, need) => expect(redact(`07018, ${msg}`).need).toBe(need));

  it("keeps parsed income and household on the hint for the on-screen form", () => {
    const h = redact("07018, family of 4, $52k, uninsured");
    expect([h.income, h.household]).toEqual([52_000, 4]);
    expect(redact("07018, uninsured")).toMatchObject({ income: null, household: null });
  });
});
