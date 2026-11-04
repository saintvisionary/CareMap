import { motion } from "framer-motion";
import { NEED_TO_DRG } from "../lib/drg";
import { facilityTier, TIER_COLORS, type FacilityWithDistance } from "../lib/geo";
import { insuranceGuidance } from "../lib/insurance";
import type { InsuranceType } from "../lib/intake";
import { applyTier } from "../lib/policy";
import { GlassPanel } from "./GlassPanel";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const FACILITY_TYPE_LABELS: Record<string, string> = {
  acute_care_hospital: "Acute care hospital",
  va_hospital: "VA hospital",
  fqhc: "Federally Qualified Health Center (sliding-fee clinic)",
};

interface ResultCardProps {
  facility: FacilityWithDistance;
  tierPct: number | null;
  insuranceType: InsuranceType | null;
  need: string | null;
  index: number;
  active: boolean;
  onSelect: () => void;
}

export function ResultCard({ facility, tierPct, insuranceType, need, index, active, onSelect }: ResultCardProps) {
  const tier = facilityTier(facility, tierPct, insuranceType);
  const drg = need ? NEED_TO_DRG[need] : null;
  const charge = drg ? facility.drg_charges[drg.code]?.avg_charge : undefined;

  let hero = "Tier unknown";
  let heroLabel = facility.charity_care_participant
    ? "Tell us your income for an estimate."
    : `${facility.state} rules coming soon -- ask this hospital's billing office about financial assistance.`;
  if (tier === "insured") {
    // NJ Charity Care only applies to the uninsured -- never claim a
    // charity-care price here, even if we happen to know a typical charge.
    hero = charge != null ? money(charge) : "See coverage";
    heroLabel = `typical billed charge; ${insuranceType ? insuranceGuidance(insuranceType) : "check your plan for your specific costs"}`;
  } else if (charge != null) {
    heroLabel = "typical billed charge, estimate, confirm with billing office";
    hero = tierPct != null ? money(applyTier(charge, tierPct)) : money(charge);
  } else if (tier === "free") {
    hero = "$0";
    heroLabel = "NJ Charity Care, estimate, confirm with billing office";
  } else if (tier === "reduced") {
    hero = `${tierPct}%`;
    heroLabel = "of typical billed charge, estimate, confirm with billing office";
  } else if (tier === "full") {
    hero = "Full price";
    heroLabel = "not eligible for NJ Charity Care at this income";
  }

  return (
    <motion.button
      onClick={onSelect}
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 22, delay: index * 0.06 }}
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
        {active && (
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
                Not confirmed as an NJ Charity Care participant -- ask this hospital's billing office about financial
                assistance.
              </div>
            )}
          </div>
        )}
      </GlassPanel>
    </motion.button>
  );
}
