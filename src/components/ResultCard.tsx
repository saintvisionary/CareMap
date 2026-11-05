import { AnimatePresence, motion } from "framer-motion";
import { NEED_TO_DRG } from "../lib/drg";
import { facilityTier, TIER_COLORS, type FacilityWithDistance } from "../lib/geo";
import { insuranceGuidance } from "../lib/insurance";
import type { InsuranceType } from "../lib/intake";
import { applyTier, charityTier, CHARITY_PROGRAM_NAMES, FREE_TIER_STATES } from "../lib/policy";
import { GlassPanel } from "./GlassPanel";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const FACILITY_TYPE_LABELS: Record<string, string> = {
  acute_care_hospital: "Acute care hospital",
  va_hospital: "VA hospital",
  critical_access_hospital: "Critical Access Hospital",
  fqhc: "Federally Qualified Health Center (sliding-fee clinic)",
};

interface ResultCardProps {
  facility: FacilityWithDistance;
  fplPct: number | null;
  insuranceType: InsuranceType | null;
  need: string | null;
  index: number;
  active: boolean;
  onSelect: () => void;
}

export function ResultCard({ facility, fplPct, insuranceType, need, index, active, onSelect }: ResultCardProps) {
  const tier = facilityTier(facility, fplPct, insuranceType);
  const programName = CHARITY_PROGRAM_NAMES[facility.state] ?? "charity care";
  // Only a participating facility gets a tier -- a state's formula never
  // applies to a hospital its program excludes.
  const patientPaysPct =
    fplPct != null && facility.charity_care_participant
      ? charityTier(facility.state, fplPct, facility.type, facility.ownership)?.patientPaysPct
      : undefined;
  const drg = need ? NEED_TO_DRG[need] : null;
  const charge = drg ? facility.drg_charges[drg.code]?.avg_charge : undefined;

  let hero = "Tier unknown";
  const freeNote = FREE_TIER_STATES[facility.state]?.freeNote;
  let heroLabel = facility.charity_care_participant
    ? fplPct != null
      ? `${programName.charAt(0).toUpperCase()}${programName.slice(1)} sets no share CareMap can compute at this income -- ask the billing office.`
      : "Tell us your income for an estimate."
    : facility.type === "va_hospital"
      ? "VA hospital: the VA's own eligibility rules apply here, not state charity care."
      : CHARITY_PROGRAM_NAMES[facility.state]
        // A modeled state's formula can still exclude a specific facility
        // (e.g. OR's law only covers nonprofit hospitals) -- not the same as
        // the state having no rules in CareMap at all.
        ? `Not confirmed as a participant in ${programName} -- ask this hospital's billing office about financial assistance.`
        : `${facility.state} rules coming soon -- ask this hospital's billing office about financial assistance.`;
  if (tier === "insured") {
    // Charity care only applies to the uninsured -- never claim a
    // charity-care price here, even if we happen to know a typical charge.
    hero = charge != null ? money(charge) : "See coverage";
    heroLabel = `typical billed charge; ${insuranceType ? insuranceGuidance(insuranceType) : "check your plan for your specific costs"}`;
  } else if (charge != null) {
    if (patientPaysPct != null) {
      // The hero is what the patient owes, not the charge -- say so, and
      // show the real typical billed charge it was computed from.
      hero = money(applyTier(charge, patientPaysPct));
      const bound = (facility.state === "OR" || facility.state === "NV") && patientPaysPct > 0 ? "at most, " : "";
      heroLabel = `${bound}est. owed on a ${money(charge)} typical billed charge (estimate, confirm with billing office)${patientPaysPct === 0 && freeNote ? `. ${freeNote}` : ""}`;
    } else {
      hero = money(charge);
      heroLabel = "typical billed charge, estimate, confirm with billing office";
    }
  } else if (tier === "free") {
    hero = "$0";
    heroLabel = `${programName}, estimate, confirm with billing office${freeNote ? `. ${freeNote}` : ""}`;
  } else if (tier === "reduced") {
    hero = `${patientPaysPct}%`;
    heroLabel = "of typical billed charge, estimate, confirm with billing office";
  } else if (tier === "full") {
    hero = "Full price";
    heroLabel = `not eligible for ${programName} at this income`;
  }

  return (
    <motion.button
      id={`result-card-${facility.ccn}`}
      onClick={onSelect}
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileTap={{ scale: 0.98 }}
      // Capped -- a long result list (the map can surface dozens of nearby
      // facilities) would otherwise stagger for seconds; everything past
      // the first handful enters together instead of queuing endlessly.
      transition={{ type: "spring", stiffness: 260, damping: 22, delay: Math.min(index, 8) * 0.06 }}
      className="text-left w-full"
    >
      <GlassPanel className={`p-4 transition-colors ${active ? "border-white/30" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: TIER_COLORS[tier] }}
              />
              <h3 className="text-sm font-medium text-white/90 truncate">{facility.name}</h3>
              {facility.type === "va_hospital" && (
                <span className="shrink-0 rounded-full bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-sky-300">
                  VA
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-white/50">
              {facility.distanceMiles.toFixed(1)} mi &middot; {facility.city}, {facility.state}
              {facility.star_rating != null ? ` · ${facility.star_rating}★` : ""}
            </p>
          </div>
        </div>
        <div className="mt-3">
          <div className="text-2xl font-semibold text-white tabular-nums">{hero}</div>
          <div className="text-[11px] text-white/40">{heroLabel}</div>
        </div>
        <AnimatePresence initial={false}>
          {active && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5 text-xs text-white/60">
                <div>
                  {facility.address}, {facility.city}, {facility.state} {facility.zip}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>{FACILITY_TYPE_LABELS[facility.type] ?? facility.type}</span>
                  <span>Emergency room: {facility.has_er ? "yes" : "no"}</span>
                  {facility.star_rating != null && <span>CMS quality rating: {facility.star_rating}/5</span>}
                </div>
                <div className="text-white/40">Ownership: {facility.ownership}</div>
                {!facility.charity_care_participant && (
                  <div className="text-white/40">
                    {facility.type === "va_hospital"
                      ? "VA hospital: the VA's own eligibility rules apply here, not state charity care."
                      : CHARITY_PROGRAM_NAMES[facility.state]
                        ? `Not confirmed as a participant in ${programName} -- ask this hospital's billing office about financial assistance.`
                        : `${facility.state}'s financial assistance rules aren't modeled in CareMap yet -- ask this hospital's billing office about charity care.`}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassPanel>
    </motion.button>
  );
}
