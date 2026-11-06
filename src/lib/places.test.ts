import { describe, expect, it } from "vitest";
import { buildCityIndex, findPlace } from "./places";
import type { Facility } from "./types";

const site = (city: string, state: string, zip: string) => ({ city, state, zip }) as Facility;
const index = buildCityIndex([
  site("East Orange", "NJ", "07018"),
  site("East Orange", "NJ", "07018"),
  site("Orange", "NJ", "07050"),
  site("Springfield", "IL", "62701"),
  site("Springfield", "MA", "01103"),
  site("Springfield", "MA", "01104"),
  site("Newark", "NJ", "07102"),
]);

describe("findPlace", () => {
  it.each([
    ["what's the nearest hospital in East Orange", "07018"],
    ["nearest hospital in east orange?", "07018"],
    ["East Orange, family of 4, $52k, uninsured", "07018"],
    ["clinics near Springfield, IL", "62701"],
    ["clinics near Springfield Illinois", "62701"],
    ["clinics near Springfield", "01103"],
    ["Newark, uninsured", "07102"],
  ])("%s -> %s", (text, zip) => expect(findPlace(text, index)?.zip).toBe(zip));

  it("leaves messages without a known place alone", () => {
    expect(findPlace("I have a cold", index)).toBeNull();
    expect(findPlace("which hospital is cheapest for me?", index)).toBeNull();
    expect(findPlace("orange juice", index)).toBeNull();
  });
});
