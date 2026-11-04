import { NEED_TO_DRG } from "./drg";
import { applyTier } from "./policy";
import type { FacilityWithDistance } from "./geo";

export interface QueryResult {
  zipCode: string | null;
  tierPct: number | null;
  insured: boolean | null;
  need: string | null;
  facilities: FacilityWithDistance[];
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Deterministic, no-AI summary of a query result. Same labeling rules as the
 * backend grounding guard: "typical billed charge", never "your price",
 * always "estimate, confirm with billing office" -- kept here too so the
 * instant local path and the AI-enhanced path never contradict each other. */
export function summarize(result: QueryResult): string {
  const { zipCode, tierPct, insured, need, facilities } = result;

  if (!zipCode) {
    return "Tell me your zip code and I can find hospitals near you.";
  }
  if (facilities.length === 0) {
    return `I don't have facility data for ${zipCode} yet. CareMap currently covers New Jersey.`;
  }

  const nearest = facilities[0];
  const lines: string[] = [];
  lines.push(
    `Found ${facilities.length} hospital${facilities.length === 1 ? "" : "s"} near ${zipCode}. ` +
      `Nearest: ${nearest.name}, ${nearest.distanceMiles.toFixed(1)} mi away.`,
  );

  if (insured === true) {
    lines.push(
      "Since you're insured, NJ Charity Care doesn't apply to you -- contact your insurer for your specific copay/deductible.",
    );
  } else if (tierPct == null) {
    lines.push("Tell me your household income and size for a personal NJ Charity Care estimate.");
  } else if (nearest.state === "NJ" && nearest.charity_care_participant) {
    lines.push(
      tierPct <= 0
        ? "At your income, NJ Charity Care covers hospital care in full at participating hospitals: you'd pay an estimated $0."
        : `At your income, NJ Charity Care sets your share at ${tierPct}% of the typical billed charge at participating hospitals.`,
    );
  }

  const drg = need ? NEED_TO_DRG[need] : null;
  if (drg) {
    const withCharge = facilities.find((f) => drg.code in f.drg_charges);
    if (withCharge) {
      const charge = withCharge.drg_charges[drg.code].avg_charge;
      lines.push(
        `${drg.label} at ${withCharge.name}: typical billed charge is ${money(charge)}.` +
          (tierPct != null
            ? ` At your tier, estimated amount owed is ${money(applyTier(charge, tierPct))}.`
            : ""),
      );
      lines.push("This is an estimate, confirm with billing office.");
    } else {
      lines.push(`No billed-charge data yet for ${drg.label.toLowerCase()} at a nearby hospital.`);
    }
  }

  if (insured !== true) {
    lines.push("Always ask for a Good Faith Estimate if you're uninsured and scheduling ahead.");
  }
  return lines.join(" ");
}
