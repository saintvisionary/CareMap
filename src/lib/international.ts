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
  /** The name in its original script, when English differs from it (e.g.
   * OSM's name:en vs name tag) -- kept rather than dropped, since a
   * traveler may need to show/say the local name locally. */
  localName: string | null;
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
  /** True when the matched place is too large an area (a whole country,
   * a big region) for a fixed-radius search from one point to mean
   * anything -- see geocodePlace. facilities is always empty in this case;
   * the search was skipped rather than run against an arbitrary point. */
  tooBroad: boolean;
  /** A whole country was asked for: facilities are spread across it, not
   * near one point, so distances aren't meaningful. */
  country?: boolean;
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
// Photon (komoot's OSM-based geocoder, built for as-you-type search) only
// for the suggestion dropdown: real-world testing found Nominatim's search
// has no fuzzy/typo tolerance at all -- a single missing letter ("Cancn,
// Mexico") returns zero results -- while Photon correctly surfaces "Cancún"
// for the same typo. The final submit still geocodes through Nominatim
// (geocodePlace below, unchanged): once a suggestion is picked it's
// correctly spelled, which Nominatim resolves fine -- Nominatim's weakness
// is specifically fuzzy matching, not exact/near-exact lookups.
const PHOTON_URL = "https://photon.komoot.io/api/";
// The public Overpass instance is free but frequently overloaded (502s
// under load); those are usually momentary, so retry a couple of times
// with a short per-attempt timeout rather than hang indefinitely.
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
// One quick try: when it's overloaded (often), Nominatim answers instead.
const OVERPASS_ATTEMPTS = 1;
const OVERPASS_TIMEOUT_MS = 8000;

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
  addresstype?: string;
  place_rank?: number;
  /** [south, north, west, east] */
  boundingbox?: string[];
  address?: { country_code?: string };
}

// Bounding-box size looked like the obvious signal for "this match is too
// broad to search a fixed 25km radius from" but it's unreliable: Tokyo's
// administrative boundary includes remote outlying islands, so its bbox
// spans a huge area even though its actual centroid point is correctly
// right in central Tokyo -- a bbox check flagged "Tokyo, Japan" as too
// broad right alongside "Japan" itself, which is wrong. Nominatim's own
// addresstype is a cleaner, semantic signal: "country" genuinely has no
// single meaningful point for a 25km search (that's the real bug this
// guards against -- "Japan" landed in rural Gunma, ~170km from Tokyo),
// while "province"/"state"/"city" etc. all come with a representative
// point Nominatim itself considers the right center for that name.
async function geocodePlace(
  place: string,
): Promise<{ lat: number; lon: number; displayName: string; tooBroad: boolean; bbox: number[] | null; countryCode: string | null } | null> {
  const qs = new URLSearchParams({ q: place, format: "json", limit: "1", addressdetails: "1", "accept-language": "en" });
  const res = await fetch(`${NOMINATIM_URL}?${qs}`, { headers: { Accept: "application/json" } });
  // Distinct from "zero results" (a real, legitimate answer meaning the
  // place name didn't match anything) -- a failed request shouldn't look
  // the same as a place that genuinely doesn't exist.
  if (!res.ok) throw new Error(`Nominatim request failed: ${res.status}`);
  const results = (await res.json()) as NominatimResult[];
  if (!results.length) return null;
  const r = results[0];
  // place_rank 4 is Nominatim's own rank for "country" -- kept as a
  // fallback for the rare response missing addresstype.
  const tooBroad = r.addresstype ? r.addresstype === "country" || r.addresstype === "continent" : r.place_rank === 4;
  return { lat: parseFloat(r.lat), lon: parseFloat(r.lon), displayName: r.display_name, tooBroad, bbox: r.boundingbox ? r.boundingbox.map(Number) : null, countryCode: r.address?.country_code ?? null };
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
    // Prefer OSM's own English name tag when present, rather than showing
    // an English-speaking traveler a name in a script they can't read back
    // to a taxi driver or search for -- never machine-translate it
    // ourselves, that's a real source of medical-context errors.
    const localName = tags.name;
    const name = tags["name:en"] || localName;
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
      localName: localName && localName !== name ? localName : null,
      type,
      lat: flat,
      lon: flon,
      address: addressParts.length ? addressParts.join(" ") : null,
      distanceKm: Math.round(haversineKm(originLat, originLon, flat, flon) * 10) / 10,
    });
  }
  return facilities.sort((a, b) => a.distanceKm - b.distanceKm);
}

interface PhotonFeature {
  properties: {
    name?: string;
    city?: string;
    state?: string;
    country?: string;
  };
}

// Feeds the guided form's destination autocomplete (AutocompleteInput) --
// addresses the "user may misspell the city/country" concern directly:
// picking a suggestion guarantees a correctly-spelled name that will
// actually geocode, instead of hoping free-typed text does. Best-effort: a
// network failure here just means no dropdown shows up, not an error --
// free text still works exactly as it did before this existed.
export async function suggestPlaces(query: string, limit = 5): Promise<{ value: string; label: string }[]> {
  if (query.trim().length < 2) return [];
  const qs = new URLSearchParams({ q: query, limit: String(limit), lang: "en" });
  try {
    const res = await fetch(`${PHOTON_URL}?${qs}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const data = (await res.json()) as { features: PhotonFeature[] };
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const f of data.features ?? []) {
      const p = f.properties;
      if (!p.name) continue;
      // A country is just its name ("Japan", not "Japan, Japan", which
      // geocodes to some building in Tokyo).
      const label = [p.name, p.state && p.state !== p.name ? p.state : null, p.country && p.country !== p.name ? p.country : null]
        .filter(Boolean)
        .join(", ");
      if (seen.has(label)) continue;
      seen.add(label);
      out.push({ value: label, label });
    }
    return out;
  } catch {
    return [];
  }
}

interface NominatimPlace {
  lat: string;
  lon: string;
  name?: string;
  type?: string;
  display_name: string;
  namedetails?: Record<string, string>;
}

/** Hospitals and clinics inside a box, from Nominatim. The backup for an
 * overloaded Overpass, and the way to list a whole country's hospitals.
 * box is [west, north, east, south]. */
async function nominatimFacilities(box: number[], originLat: number, originLon: number, limit: number, countryCode?: string | null): Promise<InternationalFacility[]> {
  const out: InternationalFacility[] = [];
  const seen = new Set<string>();
  for (const q of ["hospital", "clinic"]) {
    const qs = new URLSearchParams({
      q,
      format: "jsonv2",
      bounded: "1",
      viewbox: box.join(","),
      limit: String(limit),
      namedetails: "1",
      "accept-language": "en",
    });
    // A country's box overlaps its neighbors; keep to the country itself.
    if (countryCode) qs.set("countrycodes", countryCode);
    const res = await fetch(`${NOMINATIM_URL}?${qs}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Nominatim request failed: ${res.status}`);
    for (const r of (await res.json()) as NominatimPlace[]) {
      const local = r.namedetails?.name ?? r.name;
      const name = r.namedetails?.["name:en"] || local;
      if (!name) continue;
      const lat = parseFloat(r.lat);
      const lon = parseFloat(r.lon);
      const key = `${name}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // display_name starts with the place's own name; the next parts are
      // its street and area.
      const addr = r.display_name.split(",").slice(1, 4).map((x) => x.trim()).filter(Boolean).join(", ");
      out.push({
        name,
        localName: local && local !== name ? local : null,
        type: r.type === "hospital" ? "hospital" : "clinic",
        lat,
        lon,
        address: addr || null,
        distanceKm: Math.round(haversineKm(originLat, originLon, lat, lon) * 10) / 10,
      });
    }
  }
  return out;
}

export async function findInternationalFacilities(place: string, radiusKm = 25): Promise<InternationalResult | null> {
  const geo = await geocodePlace(place);
  if (!geo) return null;
  if (geo.tooBroad) {
    // A whole country: list hospitals across it rather than near one
    // arbitrary point inside it.
    if (!geo.bbox) return { place: geo.displayName, lat: geo.lat, lon: geo.lon, facilities: [], tooBroad: true };
    const [south, north, west, east] = geo.bbox;
    const facilities = await nominatimFacilities([west, north, east, south], geo.lat, geo.lon, 40, geo.countryCode);
    return { place: geo.displayName, lat: geo.lat, lon: geo.lon, facilities, tooBroad: false, country: true };
  }
  let facilities: InternationalFacility[];
  try {
    facilities = parseOverpassElements(await overpassFacilities(geo.lat, geo.lon, radiusKm), geo.lat, geo.lon);
  } catch {
    // Overpass is a shared free service and often overloaded.
    const d = radiusKm / 111;
    const dLon = d / Math.max(0.2, Math.cos((geo.lat * Math.PI) / 180));
    facilities = (await nominatimFacilities([geo.lon - dLon, geo.lat + d, geo.lon + dLon, geo.lat - d], geo.lat, geo.lon, 30)).sort(
      (a, b) => a.distanceKm - b.distanceKm,
    );
  }
  return { place: geo.displayName, lat: geo.lat, lon: geo.lon, facilities: facilities.slice(0, 30), tooBroad: false };
}
