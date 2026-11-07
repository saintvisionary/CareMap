import { cardHero } from "./cardHero";
import type { FacilityWithDistance } from "./geo";
import type { InsuranceType } from "./intake";

/** The dollar amount the place's card shows as this person's likely cost
 * (src/lib/cardHero.ts), so the list order always matches what people
 * read. null when the card shows no dollar amount. */
export function costToYou(f: FacilityWithDistance, need: string | null, fplPct: number | null, insuranceType: InsuranceType | null): number | null {
  if (!need) return null;
  const { hero } = cardHero(f, fplPct, insuranceType, need);
  const m = /^\$([\d,]+)$/.exec(hero);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** Priced places from lowest cost to you (closest first on ties), then
 * everything without a price in its original nearest-first order. */
export function sortByCost(list: FacilityWithDistance[], need: string | null, fplPct: number | null, insuranceType: InsuranceType | null): FacilityWithDistance[] {
  const priced: [FacilityWithDistance, number][] = [];
  const rest: FacilityWithDistance[] = [];
  for (const f of list) {
    const c = costToYou(f, need, fplPct, insuranceType);
    if (c == null) rest.push(f);
    else priced.push([f, c]);
  }
  priced.sort((a, b) => a[1] - b[1] || a[0].distanceMiles - b[0].distanceMiles);
  return [...priced.map(([f]) => f), ...rest];
}
