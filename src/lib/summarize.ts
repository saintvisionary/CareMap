import { NEED_TO_DRG } from "./drg";
import type { FacilityWithDistance } from "./geo";
import { insuranceGuidance } from "./insurance";
import type { InsuranceType } from "./intake";
import type { InternationalResult } from "./international";
import { applyTier, charityTier, CHARITY_PROGRAM_NAMES } from "./policy";

export interface QueryResult {
  zipCode: string | null;
  fplPct: number | null;
  insuranceType: InsuranceType | null;
  veteran: boolean;
  need: string | null;
  facilities: FacilityWithDistance[];
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Deterministic, no-AI summary of a query result. Same labeling rules as the
 * backend grounding guard: "typical billed charge", never "your price",
 * always "estimate, confirm with billing office" -- kept here too so the
 * instant local path and the AI-enhanced path never contradict each other. */
export function summarize(result: QueryResult): string {
  const { zipCode, fplPct, insuranceType, veteran, need, facilities } = result;

  if (!zipCode) {
    return "Tell me your zip code and I can find hospitals near you.";
  }
  if (facilities.length === 0) {
    return `I couldn't find a hospital within 25 miles of ${zipCode}. Try a nearby zip code.`;
  }

  const nearest = facilities[0];
  const nearestTier = fplPct != null ? charityTier(nearest.state, fplPct, nearest.type) : null;
  const programName = CHARITY_PROGRAM_NAMES[nearest.state] ?? "charity care";
  const lines: string[] = [];
  lines.push(
    `Found ${facilities.length} hospital${facilities.length === 1 ? "" : "s"} near ${zipCode}. ` +
      `Nearest: ${nearest.name}, ${nearest.distanceMiles.toFixed(1)} mi away.`,
  );

  if (insuranceType != null && insuranceType !== "uninsured") {
    lines.push(insuranceGuidance(insuranceType));
  } else if (!nearest.charity_care_participant) {
    lines.push(`${nearest.state} financial assistance rules aren't in CareMap yet -- ask this hospital's billing office about charity care.`);
  } else if (fplPct == null) {
    lines.push(`Tell me your household income and size for a personal ${programName} estimate.`);
  } else if (nearestTier == null) {
    // fplPct is known but the facility's own formula still returned no
    // percentage -- currently only IL above its free-care line, where the
    // real discount needs a hospital cost-to-charge ratio this app doesn't
    // have. Must not be confused with "we don't know your income yet".
    lines.push(
      nearest.state === "IL"
        ? `Your income is above ${programName}'s free-care line, so there's no exact percentage to show (Illinois law bases it on each hospital's own cost-to-charge ratio, which CareMap doesn't have). State law still caps total collection at 20% of your family income in any 12-month period -- ask this hospital's billing office for your exact discount.`
        : `${programName} doesn't have a modeled percentage at your income -- ask this hospital's billing office directly.`,
    );
  } else {
    lines.push(
      nearestTier.patientPaysPct <= 0
        ? `At your income, ${programName} covers hospital care in full at participating hospitals: you'd pay an estimated $0.`
        : `At your income, ${programName} sets your share at ${nearestTier.patientPaysPct}% of the typical billed charge at participating hospitals.`,
    );
  }

  if (veteran) {
    const nearestVa = facilities.find((f) => f.type === "va_hospital");
    lines.push(
      nearestVa
        ? `As a veteran, you may also be eligible for care at ${nearestVa.name} (VA), ${nearestVa.distanceMiles.toFixed(1)} mi away.`
        : "As a veteran, you may be eligible for care through the VA -- no VA facility found within 25 miles here, though.",
    );
  }

  const drg = need ? NEED_TO_DRG[need] : null;
  if (drg) {
    const withCharge = facilities.find((f) => drg.code in f.drg_charges);
    if (withCharge) {
      const charge = withCharge.drg_charges[drg.code].avg_charge;
      // This facility's own state/tier, not nearest's -- the cheapest DRG
      // match isn't always the closest hospital, so it isn't always in the
      // same (or any modeled) state either.
      const chargeTier = fplPct != null ? charityTier(withCharge.state, fplPct, withCharge.type) : null;
      lines.push(
        `${drg.label} at ${withCharge.name}: typical billed charge is ${money(charge)}.` +
          (chargeTier != null && insuranceType === "uninsured"
            ? ` At your tier, estimated amount owed is ${money(applyTier(charge, chargeTier.patientPaysPct))}.`
            : ""),
      );
      lines.push("This is an estimate, confirm with billing office.");
    } else {
      lines.push(`No billed-charge data yet for ${drg.label.toLowerCase()} at a nearby hospital.`);
    }
  }

  if (insuranceType === "uninsured" || insuranceType == null) {
    lines.push("Always ask for a Good Faith Estimate if you're uninsured and scheduling ahead.");
  }
  return lines.join(" ");
}

/** Traveler path: location only. There's no free, structured dataset of
 * actual billed charges outside the US the way CMS provides domestically,
 * so this never shows a dollar figure -- that's the whole point of keeping
 * it a separate function from summarize() above rather than a branch of it. */
export function summarizeInternational(result: InternationalResult | null, place: string): string {
  if (!result) {
    return `I couldn't find "${place}" or reach the international facility directory just now. Try a more specific city and country (e.g. "Cancun, Mexico"), or try again shortly.`;
  }
  const disclaimer =
    "Location only -- no billed-charge data exists for facilities outside the US. Confirm pricing directly with the facility, a travel insurer, or your embassy before scheduling care.";
  if (result.tooBroad) {
    return `"${result.place}" is a whole country/region, so a 25 km search from one point in it wouldn't mean much -- try a specific city instead, e.g. "Tokyo, Japan" or "Osaka, Japan".`;
  }
  if (result.facilities.length === 0) {
    return (
      `No hospitals or clinics listed within 25 km of ${result.place} in OpenStreetMap's data. ` +
      `It's a community-maintained map, so smaller clinics may be missing -- ask locally or check your travel insurer's provider network.\n\n${disclaimer}`
    );
  }
  const lines = result.facilities.slice(0, 8).map((f) => {
    const addr = f.address ? ` -- ${f.address}` : "";
    const local = f.localName ? ` (${f.localName})` : "";
    return `- ${f.name}${local} (${f.type}), ${f.distanceKm} km away${addr}`;
  });
  return `Hospitals & clinics near ${result.place} (source: OpenStreetMap):\n${lines.join("\n")}\n\n${disclaimer}`;
}
