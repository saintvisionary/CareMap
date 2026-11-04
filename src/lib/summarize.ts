import { NEED_TO_DRG } from "./drg";
import type { FacilityWithDistance } from "./geo";
import { insuranceGuidance } from "./insurance";
import type { InsuranceType } from "./intake";
import { applyTier } from "./policy";

export interface QueryResult {
  zipCode: string | null;
  tierPct: number | null;
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
  const { zipCode, tierPct, insuranceType, veteran, need, facilities } = result;

  if (!zipCode) {
    return "Tell me your zip code and I can find hospitals near you.";
  }
  if (facilities.length === 0) {
    return `I couldn't find a hospital within 25 miles of ${zipCode}. Try a nearby zip code.`;
  }

  const nearest = facilities[0];
  const lines: string[] = [];
  lines.push(
    `Found ${facilities.length} hospital${facilities.length === 1 ? "" : "s"} near ${zipCode}. ` +
      `Nearest: ${nearest.name}, ${nearest.distanceMiles.toFixed(1)} mi away.`,
  );

  if (insuranceType != null && insuranceType !== "uninsured") {
    lines.push(insuranceGuidance(insuranceType));
  } else if (!nearest.charity_care_participant) {
    lines.push(`${nearest.state} financial assistance rules aren't in CareMap yet -- ask this hospital's billing office about charity care.`);
  } else if (tierPct == null) {
    lines.push("Tell me your household income and size for a personal NJ Charity Care estimate.");
  } else {
    lines.push(
      tierPct <= 0
        ? "At your income, NJ Charity Care covers hospital care in full at participating hospitals: you'd pay an estimated $0."
        : `At your income, NJ Charity Care sets your share at ${tierPct}% of the typical billed charge at participating hospitals.`,
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
      lines.push(
        `${drg.label} at ${withCharge.name}: typical billed charge is ${money(charge)}.` +
          (tierPct != null && insuranceType === "uninsured"
            ? ` At your tier, estimated amount owed is ${money(applyTier(charge, tierPct))}.`
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
