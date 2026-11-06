import { haversineMiles } from "./geo";
import type { Facility, ZipCentroid } from "./types";
import type { Suggestion } from "../components/AutocompleteInput";

// Local, zero-network zip suggestions -- every value comes from our own
// 33,791-zip dataset, so picking one guarantees a real, geocodable US zip
// code. Deliberately NOT backed by an external API: the domestic flow is
// supposed to work instantly even with no network/AI available (see
// CLAUDE.md -- "map works if AI quota exhausted"), and this is the one spot
// an external service's uptime could otherwise leak into that guarantee.
//
// Two input shapes: digits -> prefix-match against every known US zip.
// Letters -> the user knows their city, not their zip (a real, common
// case), so search the city/state already on each of our ~3,179 loaded
// facilities and suggest its real zip. That only covers places with a
// hospital in our dataset, not every town in the country -- an honest
// limit, not a fake nationwide city gazetteer we don't actually have.
export function suggestZips(
  query: string,
  zipCentroids: Record<string, ZipCentroid>,
  facilities: Facility[],
  limit = 8,
): Promise<Suggestion[]> {
  const trimmed = query.trim();
  if (/[a-zA-Z]/.test(trimmed)) return Promise.resolve(suggestByCity(trimmed, facilities, limit));
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 2) return Promise.resolve([]);
  const matches = Object.keys(zipCentroids)
    .filter((z) => z.startsWith(digits))
    .slice(0, limit);
  const suggestions = matches.map((zip) => {
    const c = zipCentroids[zip];
    const near = nearestFacilityLabel(c.lat, c.lon, facilities);
    return { value: zip, label: zip, detail: near ? `Near ${near}` : undefined };
  });
  return Promise.resolve(suggestions);
}

function suggestByCity(query: string, facilities: Facility[], limit: number): Suggestion[] {
  const [cityTerm, stateTerm] = query
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (cityTerm.length < 2) return [];
  const startsWith: Facility[] = [];
  const includes: Facility[] = [];
  for (const f of facilities) {
    if (!f.city || !f.zip) continue;
    if (stateTerm && f.state.toLowerCase() !== stateTerm) continue;
    const city = f.city.toLowerCase();
    if (city.startsWith(cityTerm)) startsWith.push(f);
    else if (city.includes(cityTerm)) includes.push(f);
  }
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const f of [...startsWith, ...includes]) {
    if (seen.has(f.zip)) continue;
    seen.add(f.zip);
    out.push({ value: f.zip, label: `${f.city}, ${f.state}`, detail: f.zip });
    if (out.length >= limit) break;
  }
  return out;
}

function nearestFacilityLabel(lat: number, lon: number, facilities: Facility[]): string | null {
  let best: Facility | null = null;
  let bestDist = Infinity;
  for (const f of facilities) {
    if (f.lat == null || f.lon == null) continue;
    const d = haversineMiles(lat, lon, f.lat, f.lon);
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }
  // Past ~40 miles, the "nearest" facility isn't a meaningful city label for
  // this zip (sparse rural coverage) -- better to show the bare zip than an
  // approximate city that could be a whole different metro area.
  return best && bestDist <= 40 ? `${best.city}, ${best.state}` : null;
}
