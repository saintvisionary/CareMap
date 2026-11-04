import type { InsuranceType } from "./intake";
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

/** Nearest zip code (by centroid) to a raw lat/lon -- used to turn a
 * geolocation result into a zip the rest of the app already knows how to
 * work with, rather than threading a second lat/lon-based search path
 * through every facilities_near/agent call. 33k linear scans is well under
 * a millisecond budget in a browser. */
export function nearestZip(lat: number, lon: number, zipCentroids: Record<string, ZipCentroid>): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [zip, c] of Object.entries(zipCentroids)) {
    const d = haversineMiles(lat, lon, c.lat, c.lon);
    if (d < bestDist) {
      bestDist = d;
      best = zip;
    }
  }
  return best;
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
 * NJ hospital -- color reflects whether the program applies here at all).
 * Any insuranceType other than "uninsured" (or not yet given) always wins:
 * Charity Care applies only to the uninsured/underinsured, so anyone with
 * Medicaid, Medicare, private coverage, VA/Tricare, or "not sure" never gets
 * a charity-care price here, regardless of income -- that's a distinct
 * state from "we don't know your income yet". */
export function facilityTier(
  facility: Facility,
  patientPaysPct: number | null,
  insuranceType: InsuranceType | null,
): Tier {
  if (insuranceType != null && insuranceType !== "uninsured") return "insured";
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
  insured: "#60a5fa",
};
