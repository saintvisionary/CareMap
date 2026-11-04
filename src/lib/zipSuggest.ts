import { haversineMiles } from "./geo";
import type { Facility, ZipCentroid } from "./types";
import type { Suggestion } from "../components/AutocompleteInput";

// Local, zero-network zip suggestions -- every value comes from our own
// 33,791-zip dataset, so picking one guarantees a real, geocodable US zip
// code. Deliberately NOT backed by an external API: the domestic flow is
// supposed to work instantly even with no network/AI available (see
// CLAUDE.md -- "map works if AI quota exhausted"), and this is the one spot
// an external service's uptime could otherwise leak into that guarantee.
export function suggestZips(
  query: string,
  zipCentroids: Record<string, ZipCentroid>,
  facilities: Facility[],
  limit = 8,
): Promise<Suggestion[]> {
  const digits = query.replace(/\D/g, "");
  if (digits.length < 2) return Promise.resolve([]);
  const matches = Object.keys(zipCentroids)
    .filter((z) => z.startsWith(digits))
    .slice(0, limit);
  const suggestions = matches.map((zip) => {
    const c = zipCentroids[zip];
    const near = nearestFacilityLabel(c.lat, c.lon, facilities);
    return { value: zip, label: near ? `${zip} -- near ${near}` : zip };
  });
  return Promise.resolve(suggestions);
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
