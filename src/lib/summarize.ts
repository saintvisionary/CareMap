import { NEED_TO_DRG } from "./drg";
import type { FacilityWithDistance } from "./geo";
import { insuranceGuidance } from "./insurance";
import type { InsuranceType } from "./intake";
import type { InternationalResult } from "./international";
import {
  applyTier,
  charityTier,
  CHARITY_PROGRAM_NAMES,
  FREE_TIER_STATES,
  ME_PAYMENT_PLAN_MAX_FPL,
  ME_PAYMENT_PLAN_MAX_PCT_OF_MONTHLY_INCOME,
  VT_AGB_DISCOUNT_MAX_FPL,
  VT_CATASTROPHIC_CAP_MAX_FPL,
} from "./policy";

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
  const nearestTier = fplPct != null ? charityTier(nearest.state, fplPct, nearest.type, nearest.ownership) : null;
  const programName = CHARITY_PROGRAM_NAMES[nearest.state] ?? "charity care";
  const lines: string[] = [];
  lines.push(
    `Found ${facilities.length} hospital${facilities.length === 1 ? "" : "s"} near ${zipCode}. ` +
      `Nearest: ${nearest.name}, ${nearest.distanceMiles.toFixed(1)} mi away.`,
  );

  if (insuranceType != null && insuranceType !== "uninsured") {
    lines.push(insuranceGuidance(insuranceType));
  } else if (!nearest.charity_care_participant) {
    // A modeled state's formula can still exclude a specific facility (e.g.
    // OR's law only covers nonprofit hospitals) -- distinct from the state
    // having no rules in CareMap at all.
    lines.push(
      CHARITY_PROGRAM_NAMES[nearest.state]
        ? `Not confirmed as a ${programName} participant -- ask this hospital's billing office about financial assistance.`
        : `${nearest.state} financial assistance rules aren't in CareMap yet -- ask this hospital's billing office about charity care.`,
    );
  } else if (fplPct == null) {
    lines.push(`Tell me your household income and size for a personal ${programName} estimate.`);
  } else if (nearestTier == null) {
    // fplPct is known but the facility's own formula still returned no
    // percentage -- currently IL and NY above their free-care lines, where
    // the real discount needs data this app doesn't have. Must not be
    // confused with "we don't know your income yet".
    lines.push(
      nearest.state === "IL"
        ? `Your income is above ${programName}'s free-care line, so there's no exact percentage to show (Illinois law bases it on each hospital's own cost-to-charge ratio, which CareMap doesn't have). State law still caps total collection at 20% of your family income in any 12-month period -- ask this hospital's billing office for your exact discount.`
        : nearest.state === "NY"
          ? `Your income is above ${programName}'s free-care line, so there's no exact percentage to show (New York's cap there is based on the Medicaid rate for the service, not billed charges, and CareMap doesn't have Medicaid-rate data). Ask this hospital's billing office for your exact discount.`
          : nearest.state === "RI"
            ? `Your income is above ${programName}'s free-care line. Rhode Island's own regulation leaves the discount at your income level to each hospital to set, so there's no statewide number to show -- ask this hospital's billing office for its own sliding scale.`
            : nearest.state === "MA"
              ? `Your income is above ${programName}'s free-care line (150% of the poverty line, lower than most other modeled states). Above that, the real deductible is a flat dollar amount tied to a Health Connector insurance premium, not a percentage of billed charges -- ask this hospital's billing office for your exact amount.`
              : nearest.state === "ME"
                ? `Your income is above Maine's free-care line (200% of the poverty line), and Maine law sets no discount percentage above it.` +
                  (fplPct <= ME_PAYMENT_PLAN_MAX_FPL
                    ? ` It does require this hospital to offer you a payment plan capped at ${ME_PAYMENT_PLAN_MAX_PCT_OF_MONTHLY_INCOME}% of your monthly family income (Maine residents only) -- ask the billing office.`
                    : " Ask this hospital's billing office about its own financial assistance.")
                : nearest.state === "VT"
                  ? `Your income is above Vermont's free-care line (250% of the poverty line).` +
                    (fplPct <= VT_AGB_DISCOUNT_MAX_FPL
                      ? " State law still requires at least 40% off what this hospital generally bills, which is the hospital's own rate, so CareMap can't show a dollar figure."
                      : "") +
                    (fplPct <= VT_CATASTROPHIC_CAP_MAX_FPL
                      ? " If its bills come to more than 20% of your household income, it must cut what you owe to 20% of your household income."
                      : "") +
                    " Vermont residents only -- ask the billing office."
                  : FREE_TIER_STATES[nearest.state]
                    ? `Your income is above the ${FREE_TIER_STATES[nearest.state].heading}'s free-care line (${FREE_TIER_STATES[nearest.state].maxFplPct}% of the poverty line). ${FREE_TIER_STATES[nearest.state].aboveLine}`
                    : `${programName} doesn't have a modeled percentage at your income -- ask this hospital's billing office directly.`,
    );
  } else {
    lines.push(
      nearestTier.patientPaysPct <= 0
        ? `At your income, ${programName} covers hospital care in full at participating hospitals: you'd pay an estimated $0.` +
          (FREE_TIER_STATES[nearest.state]?.freeNote ? ` ${FREE_TIER_STATES[nearest.state].freeNote}` : "")
        : nearest.state === "OR"
          ? `At your income, ${programName} caps your share at ${nearestTier.patientPaysPct}% at participating hospitals. That's applied after federal limits on what nonprofit hospitals can charge, so dollar amounts below are upper bounds -- you may owe less.`
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
      const chargeTier = fplPct != null ? charityTier(withCharge.state, fplPct, withCharge.type, withCharge.ownership) : null;
      lines.push(
        `${drg.label} at ${withCharge.name}: typical billed charge is ${money(charge)}.` +
          (chargeTier != null && insuranceType === "uninsured"
            ? ` At your tier, estimated amount owed is ${withCharge.state === "OR" && chargeTier.patientPaysPct > 0 ? "at most " : ""}${money(applyTier(charge, chargeTier.patientPaysPct))}.`
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
