import type { Facility } from "./types";

// Every city with a hospital, clinic or urgent care site in CareMap's data,
// so a chat message like "nearest hospital in East Orange" resolves in the
// browser instantly instead of waiting on the AI to work out a zip code.
export interface Place {
  city: string;
  state: string;
  zip: string;
  sites: number;
}

export type CityIndex = Map<string, Place[]>;

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE",
  nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const STATE_CODES = new Set(Object.values(STATE_NAMES));

/** "FL" -> "Florida". */
export const STATE_FULL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([name, code]) => [code, name.replace(/\b\w/g, (c) => c.toUpperCase()).replace(" Of ", " of ")]),
);

export function buildCityIndex(...lists: Facility[][]): CityIndex {
  // city|state -> zip counts, to pick each city's most common zip.
  const zips = new Map<string, Map<string, number>>();
  const names = new Map<string, string>();
  for (const list of lists) {
    for (const f of list) {
      if (!f.city || !f.zip || !f.state) continue;
      const key = `${f.city.toLowerCase()}|${f.state}`;
      names.set(key, f.city);
      const counts = zips.get(key) ?? new Map<string, number>();
      const zip = f.zip.slice(0, 5);
      counts.set(zip, (counts.get(zip) ?? 0) + 1);
      zips.set(key, counts);
    }
  }
  const index: CityIndex = new Map();
  for (const [key, counts] of zips) {
    const [city, state] = key.split("|");
    let zip = "";
    let best = 0;
    let sites = 0;
    for (const [z, n] of counts) {
      sites += n;
      if (n > best) [zip, best] = [z, n];
    }
    const list = index.get(city) ?? [];
    list.push({ city: names.get(key)!, state, zip, sites });
    index.set(city, list);
  }
  return index;
}

function mentionedState(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [name, code] of Object.entries(STATE_NAMES)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) return code;
  }
  const code = /(?:,\s*|\s)([A-Z]{2})\b/.exec(text)?.[1];
  return code && STATE_CODES.has(code) ? code : null;
}

const LEAD_IN = /\b(?:in|near|around|by|at|from|close to|outside of|outside)\s+([a-z][a-z.' -]*)/gi;
const WORD = /[a-z.'-]+/gi;

/** The city a message names, if CareMap knows it: "...in East Orange",
 * "East Orange, NJ, family of 4...", "near Springfield, Illinois". With no
 * state given, the city with the most sites wins. */
export function findPlace(text: string, index: CityIndex): Place | null {
  if (index.size === 0) return null;
  // "weak" candidates (the message's opening words) need a capitalized
  // name for a one-word match, so "I have a cold" never becomes a town.
  const candidates: { text: string; weak: boolean }[] = [];
  for (const m of text.matchAll(LEAD_IN)) candidates.push({ text: m[1], weak: false });
  const commaCity = /([a-z][a-z.' -]*),\s*(?:[A-Z]{2}\b|[a-z]+)/gi;
  for (const m of text.matchAll(commaCity)) candidates.push({ text: m[1], weak: true });
  candidates.push({ text: text.split(",")[0], weak: true });

  const state = mentionedState(text);
  for (const cand of candidates) {
    const words = cand.text.match(WORD) ?? [];
    // Longest run first: "east orange" before "orange". From the start for
    // "in X", and from the end for the "X, ST" form.
    for (let n = Math.min(4, words.length); n >= 1; n--) {
      for (const slice of [words.slice(0, n), words.slice(-n)]) {
        if (n === 1 && cand.weak && !state && !/^[A-Z]/.test(slice[0])) continue;
        const places = index.get(slice.join(" ").toLowerCase());
        if (!places) continue;
        const inState = state ? places.filter((p) => p.state === state) : places;
        if (inState.length === 0) continue;
        return inState.reduce((a, b) => (b.sites > a.sites ? b : a));
      }
    }
  }
  return null;
}

/** "East Orange, NJ" for a zip, from the sites listed in it. */
export function zipPlaceName(zip: string, ...lists: Facility[][]): string | null {
  for (const list of lists) {
    const f = list.find((x) => x.zip?.startsWith(zip) && x.city);
    if (f) return `${f.city}, ${f.state}`;
  }
  return null;
}
