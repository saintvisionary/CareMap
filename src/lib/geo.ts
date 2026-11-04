import type { Facility, Tier, ZipCentroid } from "./types";

export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface FacilityWithDistance extends Facility {
  distanceMiles: number;
}

export function facilitiesNear(
  facilities: Facility[],
  zipCentroids: Record<string, ZipCentroid>,
  zipCode: string,
  radiusMiles = 25,
): FacilityWithDistance[] {
  const center = zipCentroids[zipCode];
  if (!center) return [];
  const out: FacilityWithDistance[] = [];
  for (const f of facilities) {
    if (f.lat == null || f.lon == null) continue;
    const distanceMiles = haversineMiles(center.lat, center.lon, f.lat, f.lon);
    if (distanceMiles <= radiusMiles) out.push({ ...f, distanceMiles });
  }
  return out.sort((a, b) => a.distanceMiles - b.distanceMiles);
}

/** Tier color for a facility given the user's own patient_pays_pct (NJ Charity
 * Care is a statewide formula, so it's the same percent at every participating
 * NJ hospital -- color reflects whether the program applies here at all). */
export function facilityTier(facility: Facility, patientPaysPct: number | null): Tier {
  if (facility.state !== "NJ" || !facility.charity_care_participant) return "unknown";
  if (patientPaysPct == null) return "unknown";
  if (patientPaysPct <= 0) return "free";
  if (patientPaysPct >= 100) return "full";
  return "reduced";
}

export const TIER_COLORS: Record<Tier, string> = {
  free: "#34d399",
  reduced: "#f59e0b",
  full: "#9ca3af",
  unknown: "#6b7280",
};
