import { describe, expect, it } from "vitest";
import descriptions from "../../public/data/drg_descriptions.json";
import { NEED_CATEGORIES, NEED_TO_DRG } from "./drg";

describe("need map", () => {
  it("every DRG code exists in CMS's own description list", () => {
    for (const { code } of Object.values(NEED_TO_DRG)) expect((descriptions as Record<string, string>)[code]).toBeDefined();
  });

  it("every need appears in exactly one guided-form category, and every category item is a need", () => {
    const listed = NEED_CATEGORIES.flatMap((c) => c.items);
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(listed)).toEqual(new Set(Object.keys(NEED_TO_DRG)));
  });
});
