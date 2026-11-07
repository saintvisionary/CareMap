import { CARE_NEEDS, NEED_TO_DRG, needKind } from "./drg";
import type { FacilityWithDistance } from "./geo";
import { insuranceGuidance } from "./insurance";
import type { InsuranceType } from "./intake";
import type { InternationalResult } from "./international";
import {
  applyTier,
  charityTier,
  CHARITY_PROGRAM_NAMES,
  FREE_TIER_STATES,
  isFederalCapHospital,
  MEDICARE_CAP_STATES,
  UPPER_BOUND_STATES,
  fqhcSlidingFee,
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
  emergency?: boolean;
  facilities: FacilityWithDistance[];
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Deterministic, no-AI summary of a query result. Same labeling rules as the
 * backend grounding guard: "typical billed charge", never "your price",
 * always "estimate, confirm with billing office" -- kept here too so the
 * instant local path and the AI-enhanced path never contradict each other. */
/** CA/CO only: CMS's Medicare average as a reference for a Medicare/Medicaid-rate cap. */
function medicareCapLine(f: FacilityWithDistance, drgCode: string, fplPct: number | null, insuranceType: InsuranceType | null): string {
  const cap = MEDICARE_CAP_STATES[f.state];
  const payment = f.drg_charges[drgCode]?.avg_total_payment;
  if (!cap || payment == null || !f.charity_care_participant || insuranceType !== "uninsured" || fplPct == null || fplPct > cap.maxFplPct) {
    return "";
  }
  return ` Medicare's average total payment for it there is ${money(payment)} (CMS, 2024); under ${cap.programName}, what you can be charged is capped at the greater of that or ${cap.medicaidName}'s rate, which CareMap doesn't have, so it could be higher.`;
}

/** Any state: a nonprofit hospital's federal 501(r) cap, when no state rule gave a figure. */
function federalCapLine(f: FacilityWithDistance, drgCode: string, hasStateFigure: boolean, insuranceType: InsuranceType | null): string {
  const payment = f.drg_charges[drgCode]?.avg_total_payment;
  if (hasStateFigure || payment == null || !isFederalCapHospital(f) || (insuranceType != null && insuranceType !== "uninsured")) return "";
  return ` It's a nonprofit hospital, so if you qualify for its financial assistance, federal law caps your bill at its "amount generally billed," which is often set from Medicare's rates: Medicare's average total payment for it there is ${money(payment)} (CMS, 2024), and yours could be higher or lower.`;
}

export function summarize(result: QueryResult): string {
  const { zipCode, fplPct, insuranceType, veteran, need } = result;
  // Hospitals drive the main answer; nearby sliding-fee clinics get their
  // own line (see clinicLine below).
  const facilities = result.facilities.filter((f) => f.type !== "fqhc" && f.type !== "urgent_care");
  const clinic = result.facilities.find((f) => f.type === "fqhc");
  const insured = insuranceType != null && insuranceType !== "uninsured";
  const clinicLine = clinic
    ? `Nearest sliding-fee health center: ${clinic.name}, ${clinic.distanceMiles.toFixed(1)} mi away. ${fqhcSlidingFee(fplPct, insured).label}`
    : null;

  const emergencyLead = result.emergency ? "If this is an emergency, call 911 or go to the nearest ER now. Don't wait on cost. " : "";
  if (!zipCode) {
    return `${emergencyLead}Enter a ZIP code or city and I'll show what's nearby.`;
  }
  if (facilities.length === 0) {
    return `${emergencyLead}I couldn't find a hospital within 25 miles of ${zipCode}.` + (clinicLine ? ` ${clinicLine}` : " Try a nearby ZIP code.");
  }

  const kind = needKind(need);
  const care = CARE_NEEDS.find((n) => n.need === need);
  const urgent = result.facilities.find((f) => f.type === "urgent_care");
  const urgentLine = urgent
    ? `For minor, non-emergency care, the nearest listed urgent care center is ${urgent.name}, ${urgent.distanceMiles.toFixed(1)} mi away. CareMap has no urgent care prices, so ask about self-pay rates. For an emergency, call 911 or go to the nearest ER.`
    : null;
  // Everyday care leads with the places built for it; the hospital detail
  // still follows for anyone comparing.
  const lead: string[] = [];
  if (care && !result.emergency) {
    if (kind === "urgent" && urgentLine) lead.push(urgentLine);
    if (clinicLine) lead.push(`For ${care.phrase}, a sliding-fee health center is often the most affordable place to start. ${clinicLine}`);
    if (care.note) lead.push(care.note);
  }

  const nearest = facilities[0];
  const nearestTier = fplPct != null ? charityTier(nearest.state, fplPct, nearest.type, nearest.ownership, nearest.cost_cap_pct) : null;
  const programName = CHARITY_PROGRAM_NAMES[nearest.state] ?? "charity care";
  const lines: string[] = [];
  if (emergencyLead) lines.push(emergencyLead.trim());
  lines.push(...lead);
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
      nearest.type === "va_hospital"
        ? "VA hospital: the VA's own eligibility rules apply here, not state charity care."
        : CHARITY_PROGRAM_NAMES[nearest.state]
          ? `Not confirmed as a participant in ${programName}. Ask this hospital's billing office about financial assistance.`
          : `${nearest.state} financial assistance rules aren't in CareMap yet. Ask this hospital's billing office about charity care.`,
    );
  } else if (fplPct == null) {
    lines.push(`Add your household income under Your costs to see what you'd owe under ${programName}.`);
  } else if (nearestTier == null) {
    // fplPct is known but the facility's own formula still returned no
    // percentage -- currently IL and NY above their free-care lines, where
    // the real discount needs data this app doesn't have. Must not be
    // confused with "we don't know your income yet".
    const cap = MEDICARE_CAP_STATES[nearest.state];
    lines.push(
      cap
        ? fplPct <= cap.maxFplPct
          ? `At your income, ${cap.programName} ${cap.capLine}.${cap.extra ? ` ${cap.extra}` : ""}`
          : `Your income is above the ${cap.maxFplPct}% line for ${cap.programName}, so its cap doesn't apply. Ask this hospital's billing office about its own financial assistance.`
        : nearest.state === "CT"
        ? "Your income is above the 250% line for Connecticut's uninsured cost-of-care limit, so it doesn't apply. Ask this hospital's billing office about its own financial assistance."
        : nearest.state === "IL"
        ? `Your income is above ${programName}'s free-care line, so there's no exact percentage to show (Illinois law bases it on each hospital's own cost-to-charge ratio, which CareMap doesn't have). ${fplPct <= (nearest.type === "critical_access_hospital" ? 300 : 600) ? "State law still caps total collection at 20% of your family income in any 12-month period, " : ""}ask this hospital's billing office for your exact discount.`
        : nearest.state === "NY"
          ? `Your income is above ${programName}'s free-care line, so there's no exact percentage to show (New York's cap there is based on the Medicaid rate for the service, not billed charges, and CareMap doesn't have Medicaid-rate data). Ask this hospital's billing office for your exact discount.`
          : nearest.state === "RI"
            ? `Your income is above ${programName}'s free-care line. Rhode Island's own regulation leaves the discount at your income level to each hospital to set, so there's no statewide number to show. Ask this hospital's billing office for its own sliding scale.`
            : nearest.state === "MA"
              ? `Your income is above ${programName}'s free-care line (150% of the poverty line, lower than most other modeled states). Above that, the real deductible is a flat dollar amount tied to a Health Connector insurance premium, not a percentage of billed charges. Ask this hospital's billing office for your exact amount.`
              : nearest.state === "ME"
                ? `Your income is above Maine's free-care line (200% of the poverty line), and Maine law sets no discount percentage above it.` +
                  (fplPct <= ME_PAYMENT_PLAN_MAX_FPL
                    ? ` It does require this hospital to offer you a payment plan capped at ${ME_PAYMENT_PLAN_MAX_PCT_OF_MONTHLY_INCOME}% of your monthly family income (Maine residents only). Ask the billing office.`
                    : " Ask this hospital's billing office about its own financial assistance.")
                : nearest.state === "VT"
                  ? `Your income is above Vermont's free-care line (250% of the poverty line).` +
                    (fplPct <= VT_AGB_DISCOUNT_MAX_FPL
                      ? " State law still requires at least 40% off what this hospital generally bills, which is the hospital's own rate, so CareMap can't show a dollar figure."
                      : "") +
                    (fplPct <= VT_CATASTROPHIC_CAP_MAX_FPL
                      ? " If its bills come to more than 20% of your household income, it must cut what you owe to 20% of your household income."
                      : "") +
                    " Vermont residents only. Ask the billing office."
                  : FREE_TIER_STATES[nearest.state]
                    ? `Your income is above the ${FREE_TIER_STATES[nearest.state].heading}'s free-care line (${FREE_TIER_STATES[nearest.state].maxFplPct}% of the poverty line). ${FREE_TIER_STATES[nearest.state].aboveLine}`
                    : `${programName} doesn't have a modeled percentage at your income. Ask this hospital's billing office directly.`,
    );
  } else {
    lines.push(
      nearestTier.patientPaysPct <= 0
        ? `At your income, ${programName} covers hospital care in full at participating hospitals: you'd pay an estimated $0.` +
          (FREE_TIER_STATES[nearest.state]?.freeNote ? ` ${FREE_TIER_STATES[nearest.state].freeNote}` : "")
        : nearest.state === "CT"
          ? `At your income, if you're uninsured and have been denied Medicaid, Connecticut law caps what this hospital can collect at its cost of care: at most ${nearestTier.patientPaysPct}% of the typical billed charge here.`
        : nearest.state === "NV"
          ? `${programName} caps what you'd pay at ${nearestTier.patientPaysPct}% of the total billed charge at this hospital, at any income. It covers inpatient care only, if you aren't eligible for Medicaid or other public coverage (apply for that first if you might be) and you arrange payment within 30 days of the hospital's notice. It's a minimum discount, so you may owe less.`
        : nearest.state === "OR"
          ? `At your income, ${programName} caps your share at ${nearestTier.patientPaysPct}% at participating hospitals. That's applied after federal limits on what nonprofit hospitals can charge, so dollar amounts below are upper bounds, you may owe less.`
          : `At your income, ${programName} sets your share at ${nearestTier.patientPaysPct}% of the typical billed charge at participating hospitals.`,
    );
  }

  if (veteran) {
    const nearestVa = facilities.find((f) => f.type === "va_hospital");
    lines.push(
      nearestVa
        ? `As a veteran, you may also be eligible for care at ${nearestVa.name} (VA), ${nearestVa.distanceMiles.toFixed(1)} mi away.`
        : "As a veteran, you may be eligible for care through the VA, though there's no VA facility within 25 miles of here.",
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
      const chargeTier =
        fplPct != null && withCharge.charity_care_participant
          ? charityTier(withCharge.state, fplPct, withCharge.type, withCharge.ownership, withCharge.cost_cap_pct)
          : null;
      lines.push(
        `${drg.label} at ${withCharge.name}: typical billed charge is ${money(charge)}.` +
          medicareCapLine(withCharge, drg.code, fplPct, insuranceType) +
          federalCapLine(withCharge, drg.code, chargeTier != null || medicareCapLine(withCharge, drg.code, fplPct, insuranceType) !== "", insuranceType) +
          (chargeTier != null && insuranceType === "uninsured"
            ? ` At your tier, estimated amount owed is ${UPPER_BOUND_STATES.has(withCharge.state) && chargeTier.patientPaysPct > 0 ? "at most " : ""}${money(applyTier(charge, chargeTier.patientPaysPct))}.`
            : ""),
      );
      lines.push("This is an estimate, confirm with billing office.");
    } else {
      lines.push(`No nearby hospital has billed-charge data for ${drg.label.charAt(0).toLowerCase()}${drg.label.slice(1)} yet.`);
    }
  }

  if (clinicLine && !(care && !result.emergency)) lines.push(clinicLine);
  // Never for a hospital procedure or an emergency: urgent care isn't for those.
  if (urgentLine && !need && !result.emergency) lines.push(urgentLine);
  if (insuranceType === "uninsured" || insuranceType == null) {
    lines.push("Always ask for a Good Faith Estimate if you're uninsured and scheduling ahead.");
  }
  return lines.join(" ");
}

/** Traveler path: location only. There's no free, structured dataset of
 * actual billed charges outside the US the way CMS provides domestically,
 * so this never shows a dollar figure -- that's the whole point of keeping
 * it a separate function from summarize() above rather than a branch of it. */
export function summarizeInternational(result: InternationalResult | null, place: string, need?: string | null): string {
  const what = need === "dental care" ? "Dentists" : "Hospitals & clinics";
  if (!result) {
    return `I couldn't find "${place}" or reach the international facility directory just now. Try a more specific city and country (e.g. "Cancun, Mexico"), or try again shortly.`;
  }
  const disclaimer =
    "Locations only. No billed-charge data exists for facilities outside the US. Confirm pricing directly with the facility, a travel insurer, or your embassy before scheduling care.";
  if (result.tooBroad) {
    return `"${result.place}" is a whole country/region, so a 25 km search from one point in it wouldn't mean much. Try a specific city instead, e.g. "Tokyo, Japan" or "Osaka, Japan".`;
  }
  if (result.facilities.length === 0) {
    return (
      `No hospitals or clinics listed within 25 km of ${result.place} in OpenStreetMap's data. ` +
      `It's a community-maintained map, so smaller clinics may be missing. Ask locally or check your travel insurer's provider network.\n\n${disclaimer}`
    );
  }
  const lines = result.facilities.slice(0, result.country ? 12 : 8).map((f) => {
    const addr = f.address ? `, ${f.address}` : "";
    const local = f.localName ? ` (${f.localName})` : "";
    return `- ${f.name}${local} (${f.type})${result.country ? "" : `, ${f.distanceKm} km away`}${addr}`;
  });
  if (result.country) {
    return `${result.facilities.length} ${what.toLowerCase()} across ${result.place} (source: OpenStreetMap). Every one is on the map; zoom in to explore, or search a city for the closest ones.\n${lines.join("\n")}\n\n${disclaimer}`;
  }
  return `${what} near ${result.place} (source: OpenStreetMap):\n${lines.join("\n")}\n\n${disclaimer}`;
}
