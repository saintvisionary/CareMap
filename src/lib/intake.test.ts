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
