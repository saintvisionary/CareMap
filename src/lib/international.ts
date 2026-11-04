// Global hospital/clinic locator for travelers, backed entirely by free
// OpenStreetMap data -- Nominatim for geocoding a place name, Overpass for
// the facilities themselves -- called directly from the browser, no Lambda
// involved. Deliberately returns NO cost figure: there is no free,
// structured dataset of actual billed charges outside the US the way CMS
// provides domestically (see src/lib/drg.ts), so showing a dollar estimate
// here would mean the AI guessing a number, which this project's grounding
// rule ("every $ figure must come from a real tool result") exists to
// prevent. Location only -- confirm pricing directly with the facility, a
// travel insurer, or an embassy before scheduling care.
export interface InternationalFacility {
  name: string;
  type: "hospital" | "clinic";
  lat: number;
  lon: number;
  address: string | null;
  distanceKm: number;
}

export interface InternationalResult {
  place: string;
  lat: number;
  lon: number;
  facilities: InternationalFacility[];
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
// The public Overpass instance is free but frequently overloaded (502s
// under load); those are usually momentary, so retry a couple of times
// with a short per-attempt timeout rather than hang indefinitely.
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_ATTEMPTS = 3;
const OVERPASS_TIMEOUT_MS = 12000;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

async function geocodePlace(place: string): Promise<{ lat: number; lon: number; displayName: string } | null> {
  const qs = new URLSearchParams({ q: place, format: "json", limit: "1" });
  const res = await fetch(`${NOMINATIM_URL}?${qs}`, { headers: { Accept: "application/json" } });
  // Distinct from "zero results" (a real, legitimate answer meaning the
  // place name didn't match anything) -- a failed request shouldn't look
  // the same as a place that genuinely doesn't exist.
  if (!res.ok) throw new Error(`Nominatim request failed: ${res.status}`);
  const results = (await res.json()) as NominatimResult[];
  if (!results.length) return null;
  const r = results[0];
  return { lat: parseFloat(r.lat), lon: parseFloat(r.lon), displayName: r.display_name };
}

export interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function overpassFacilities(lat: number, lon: number, radiusKm: number): Promise<OverpassElement[]> {
  const radiusM = Math.round(radiusKm * 1000);
  const query =
    `[out:json][timeout:20];(` +
    `node["amenity"~"^(hospital|clinic)$"](around:${radiusM},${lat},${lon});` +
    `way["amenity"~"^(hospital|clinic)$"](around:${radiusM},${lat},${lon});` +
    `node["healthcare"~"^(hospital|clinic)$"](around:${radiusM},${lat},${lon});` +
    `);out center;`;
  let lastError: unknown;
  for (let attempt = 0; attempt < OVERPASS_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const res = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Overpass request failed: ${res.status}`);
      const data = (await res.json()) as { elements: OverpassElement[] };
      return data.elements ?? [];
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timeout);
    }
  }
  // A failed request (rate-limited, down, blocked) is not the same fact as
  // "there are zero hospitals here" -- conflating the two would silently
  // misreport an outage as real-world data. Throw so the caller shows a
  // "couldn't reach the directory" message instead of an empty result list.
  throw lastError instanceof Error ? lastError : new Error("Overpass request failed");
}

// Pure, no network -- kept separate from the fetch calls above so it can be
// unit tested with a canned Overpass response.
export function parseOverpassElements(elements: OverpassElement[], originLat: number, originLon: number): InternationalFacility[] {
  const seen = new Set<string>();
  const facilities: InternationalFacility[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = tags.name;
    const flat = el.lat ?? el.center?.lat;
    const flon = el.lon ?? el.center?.lon;
    if (!name || flat == null || flon == null) continue;
    const key = `${name}|${flat.toFixed(4)}|${flon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const type: "hospital" | "clinic" = tags.amenity === "hospital" || tags.healthcare === "hospital" ? "hospital" : "clinic";
    const addressParts = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"]].filter(Boolean);
    facilities.push({
      name,
      type,
      lat: flat,
      lon: flon,
      address: addressParts.length ? addressParts.join(" ") : null,
      distanceKm: Math.round(haversineKm(originLat, originLon, flat, flon) * 10) / 10,
    });
  }
  return facilities.sort((a, b) => a.distanceKm - b.distanceKm);
}

export async function findInternationalFacilities(place: string, radiusKm = 25): Promise<InternationalResult | null> {
  const geo = await geocodePlace(place);
  if (!geo) return null;
  const elements = await overpassFacilities(geo.lat, geo.lon, radiusKm);
  return {
    place: geo.displayName,
    lat: geo.lat,
    lon: geo.lon,
    facilities: parseOverpassElements(elements, geo.lat, geo.lon).slice(0, 20),
  };
}
