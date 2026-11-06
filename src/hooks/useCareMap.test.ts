import { describe, expect, it } from "vitest";
import { redact } from "../lib/intake";
import { mergeContext } from "./useCareMap";

describe("follow-up messages keep the previous search's details", () => {
  const first = mergeContext(null, redact("21201, family of 4, $50,000, uninsured, need heart attack"));

  it("a follow-up with no zip keeps zip, income, insurance and need", () => {
    const next = mergeContext(first, redact("what hospital in this area is the best?"));
    expect(next).toMatchObject({ zipCode: "21201", fplPct: first.fplPct, insuranceType: "uninsured", need: "heart attack" });
  });

  it("anything restated wins", () => {
    const next = mergeContext(first, redact("what about 21230, need gallbladder surgery"));
    expect(next).toMatchObject({ zipCode: "21230", fplPct: first.fplPct, need: "gallbladder surgery" });
  });

  it("an emergency carries over until a different need is named", () => {
    const e = mergeContext(first, redact("now trouble breathing"));
    expect(mergeContext(e, redact("which one is closest?")).emergency).toBe(true);
    expect(mergeContext(e, redact("need gallbladder surgery")).emergency).toBe(false);
  });

  it("with no earlier search, nothing is invented", () => {
    expect(mergeContext(null, redact("what hospital is best?"))).toMatchObject({ zipCode: null, fplPct: null, need: null });
  });
});
