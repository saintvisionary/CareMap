import { AnimatePresence, motion } from "framer-motion";
import { cardHero } from "../lib/cardHero";
import { explain, type Explanation, type MathInputs } from "../lib/explain";
import { CLINIC_COLOR, facilityTier, TIER_COLORS, URGENT_CARE_COLOR, type FacilityWithDistance } from "../lib/geo";
import type { InsuranceType } from "../lib/intake";

const KIND_LABELS: Record<string, string> = {
  acute_care_hospital: "Hospital",
  va_hospital: "VA hospital",
  critical_access_hospital: "Rural hospital",
  urgent_care: "Urgent care",
  fqhc: "Health center",
};
const TYPE_DETAILS: Record<string, string> = {
  acute_care_hospital: "Acute care hospital",
  va_hospital: "Veterans Affairs hospital",
  critical_access_hospital: "Critical Access Hospital (small rural hospital)",
  urgent_care: "Urgent care center",
  fqhc: "Federally Qualified Health Center (sliding-fee clinic)",
};

function ownershipLabel(o: string): string {
  if (o.startsWith("Voluntary non-profit")) return "Nonprofit";
  if (o.startsWith("Government")) return "Government-owned";
  if (o.startsWith("Proprietary")) return "For-profit";
  if (o.startsWith("Physician")) return "Physician-owned";
  if (o.startsWith("Veterans")) return "Veterans Health Administration";
  return o;
}

const action =
  "inline-flex h-9 items-center justify-center rounded-full bg-white/[0.1] px-3.5 text-[13px] font-medium text-white transition-[background-color,transform] duration-150 hover:bg-white/[0.16] active:scale-[0.96]";

interface ResultCardProps {
  facility: FacilityWithDistance;
  fplPct: number | null;
  insuranceType: InsuranceType | null;
  need: string | null;
  household: number;
  /** Income and need, only to show the math on this device. */
  mathInputs?: MathInputs;
  index: number;
  active: boolean;
  onSelect: () => void;
}

export function ResultCard({ facility, fplPct, insuranceType, need, household, mathInputs, index, active, onSelect }: ResultCardProps) {
  const { hero, label } = cardHero(facility, fplPct, insuranceType, need);
  const isPrice = /^(\$|Up to|\d)/.test(hero);
  const color =
    facility.type === "fqhc" ? CLINIC_COLOR : facility.type === "urgent_care" ? URGENT_CARE_COLOR : TIER_COLORS[facilityTier(facility, fplPct, insuranceType)];

  const place = `${facility.address}, ${facility.city}, ${facility.state} ${facility.zip}`;
  // Directions by street address, not lat/lon: some sites are only placed
  // at their ZIP code's center.
  const googleMaps = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${facility.name}, ${place}`)}`;
  const appleMaps = `https://maps.apple.com/?daddr=${encodeURIComponent(place)}&q=${encodeURIComponent(facility.name)}`;
  const phone = facility.phone?.replace(/[^\d+]/g, "");

  return (
    <motion.div
      id={`result-card-${facility.ccn}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      // Capped, so a long list doesn't stagger for seconds.
      transition={{ type: "spring", stiffness: 300, damping: 28, delay: Math.min(index, 6) * 0.04 }}
      className={`rounded-[18px] transition-[background-color,box-shadow] duration-150 ${active ? "bg-white/[0.1] ring-1 ring-white/20" : "bg-white/[0.06] hover:bg-white/[0.08]"}`}
    >
      <button type="button" onClick={onSelect} aria-expanded={active} className="block w-full px-3.5 py-3 text-left">
        <div className="flex items-start gap-2.5">
          <span
            className="mt-[6px] h-2.5 w-2.5 shrink-0"
            style={{
              backgroundColor: color,
              borderRadius: facility.type === "fqhc" ? 3 : 999,
              clipPath: facility.type === "urgent_care" ? "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)" : undefined,
            }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="min-w-0 truncate text-[15px] font-medium text-white">{facility.name}</h3>
              <span
                className={`shrink-0 tabular-nums ${isPrice ? "text-[17px] font-semibold tracking-tight text-white" : "text-[13px] font-medium text-white/70"}`}
              >
                {hero}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[13px] text-white/50">
              {KIND_LABELS[facility.type] ?? "Facility"} · {facility.distanceMiles >= 0 ? `${facility.distanceMiles.toFixed(1)} mi · ${facility.city}` : `${facility.city}, ${facility.state}`}
              {facility.star_rating != null ? ` · ${facility.star_rating}★` : ""}
            </p>
            <p className={`mt-1 text-[12px] leading-snug text-white/45 ${active ? "" : "line-clamp-2"}`}>{label}</p>
            {!active && <p className="mt-1.5 text-[13px] font-medium text-white/75">{facility.type === "urgent_care" || facility.type === "va_hospital" ? "What you should know" : "What the law says"} ›</p>}
          </div>
        </div>
      </button>
      <AnimatePresence initial={false}>
        {active && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className="mx-3.5 border-t border-white/[0.08] pb-3.5 pl-5 pt-3 text-[13px] text-white/60">
              <LawBox explanation={explain(facility, fplPct, insuranceType, household, mathInputs)} />
              <p className="mt-3 text-white/80">{place}</p>
              <p className="mt-1">
                {TYPE_DETAILS[facility.type] ?? facility.type}
                {facility.type !== "fqhc" && facility.type !== "urgent_care" ? ` · ${facility.has_er ? "Has an emergency room" : "No emergency room"}` : ""}
              </p>
              {facility.star_rating != null && <p className="mt-1">CMS quality rating: {facility.star_rating} of 5</p>}
              <p className="mt-1 text-white/45">{facility.operator ? `Run by ${facility.operator}` : ownershipLabel(facility.ownership)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={appleMaps} target="_blank" rel="noopener noreferrer" className={action}>
                  Apple Maps
                </a>
                <a href={googleMaps} target="_blank" rel="noopener noreferrer" className={action}>
                  Google Maps
                </a>
                {phone && (
                  <a href={`tel:${phone}`} className={action}>
                    Call
                  </a>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function LawBox({ explanation: e }: { explanation: Explanation }) {
  return (
    <div className="rounded-xl bg-white/[0.06] p-3 text-[14px] leading-relaxed text-white/85">
      <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-white/50">{e.title}</p>
      <p>{e.rule}</p>
      {e.math && (
        <div className="mt-2.5 rounded-lg bg-black/20 p-2.5">
          <p className="mb-1.5 text-[12px] font-semibold text-white/55">How we worked it out</p>
          <dl className="space-y-1 text-[13px] tabular-nums">
            {e.math.map(([what, value], i) => (
              <div key={i} className={`flex flex-wrap justify-between gap-x-3 ${i === e.math!.length - 1 ? "border-t border-white/10 pt-1 font-semibold text-white" : "text-white/80"}`}>
                <dt>{what}</dt>
                <dd className="text-right">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {e.you && <p className="mt-1.5 font-medium text-white">{e.you}</p>}
      <p className="mt-1.5 text-white/70">
        <span className="font-medium text-white/85">What to do: </span>
        {e.next}
      </p>
    </div>
  );
}
