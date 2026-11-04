import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { TIER_COLORS } from "../lib/geo";
import { INSURANCE_LABELS, insuranceGuidance } from "../lib/insurance";
import type { InsuranceType } from "../lib/intake";

interface InfoPanelProps {
  open: boolean;
  onClose: () => void;
}

const h2 = "text-sm font-semibold text-white tracking-tight";
const p = "text-xs leading-relaxed text-white/70";
const section = "space-y-2";

function Swatch({ color, ring, label, desc }: { color?: string; ring?: string; label: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="mt-0.5 h-3 w-3 shrink-0 rounded-full"
        style={color ? { backgroundColor: color } : { background: "transparent", border: `2px solid ${ring}` }}
      />
      <div>
        <div className="text-xs font-medium text-white/90">{label}</div>
        <div className={p}>{desc}</div>
      </div>
    </div>
  );
}

const OTHER_INSURANCE: InsuranceType[] = ["medicaid", "medicare", "private", "va_tricare", "unsure"];

export function InfoPanel({ open, onClose }: InfoPanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-6"
          onClick={onClose}
        >
          <motion.div
            // Modals are exempt from the trigger-anchored transform-origin
            // rule (they're not anchored to a trigger element) -- stay
            // centered, scale from near-full rather than 0.
            initial={{ opacity: 0, scale: 0.97, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 16 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-lg max-h-[85vh] sm:max-h-[80vh] overflow-y-auto rounded-t-glass sm:rounded-glass border border-white/10 bg-ink-900/95 backdrop-blur-glass shadow-xl shadow-black/50 p-5 sm:p-6 space-y-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-base font-semibold tracking-tight text-white">How to read CareMap</h1>
                <p className="mt-1 text-xs text-white/50">What the colors, numbers and programs on this map actually mean.</p>
              </div>
              <button
                onClick={onClose}
                className="shrink-0 rounded-full bg-white/10 h-7 w-7 flex items-center justify-center text-white/70 transition-[background-color,transform] duration-150 active:scale-90 hover:bg-white/20"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className={section}>
              <h2 className={h2}>Map colors</h2>
              <div className="space-y-2.5 rounded-xl bg-white/5 p-3">
                <Swatch color={TIER_COLORS.free} label="Free" desc="This hospital's charity-care program covers the full typical billed charge -- estimated $0 owed." />
                <Swatch color={TIER_COLORS.reduced} label="Reduced" desc="Charity care covers part of the bill; you'd pay a set percentage of the typical billed charge." />
                <Swatch color={TIER_COLORS.full} label="Full price" desc="Income is above that state's charity-care eligibility range at this hospital." />
                <Swatch color={TIER_COLORS.unknown} label="Unknown" desc="Either this hospital isn't a confirmed charity-care participant, the state's rules aren't modeled in CareMap yet, or we don't have your income yet." />
                <Swatch color={TIER_COLORS.insured} label="Insured" desc="Charity care only applies to the uninsured/underinsured -- shows a typical billed charge instead, as a reference point for your insurer." />
                <Swatch ring="rgba(56, 189, 248, 0.9)" label="Blue ring" desc="A VA hospital, regardless of its cost-tier color -- facility type and cost tier are separate pieces of information." />
                <Swatch ring="rgba(255, 255, 255, 0.4)" label="Small hollow dot" desc="A preview marker, shown before you've searched -- not a personalized result. Click it to run a real search centered there." />
              </div>
            </div>

            <div className={section}>
              <h2 className={h2}>NJ Documented Charity Care</h2>
              <p className={p}>
                New Jersey's hospital financial-assistance program. Applies to <strong className="text-white/90">hospital care only</strong> (not the
                physician, anesthesia, radiology reading, or outpatient prescriptions billed separately) at NJ acute care hospitals, for patients who are{" "}
                <strong className="text-white/90">uninsured or underinsured and not eligible for Medicaid</strong>. Asset limits: $7,500 for an individual,
                $15,000 for a family (you can spend down to qualify).
              </p>
              <div className="rounded-xl bg-white/5 p-3 text-xs">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-white/70">
                  <span className="text-white/40">Income, % of poverty line</span>
                  <span className="text-white/40">You pay</span>
                  <span>Up to 200%</span>
                  <span className="text-white/90">$0 -- fully covered</span>
                  <span>200% to 225%</span>
                  <span className="text-white/90">20% of the bill</span>
                  <span>225% to 250%</span>
                  <span className="text-white/90">40%</span>
                  <span>250% to 275%</span>
                  <span className="text-white/90">60%</span>
                  <span>275% to 300%</span>
                  <span className="text-white/90">80%</span>
                  <span>Over 300%</span>
                  <span className="text-white/90">Full price</span>
                </div>
              </div>
              <p className={p}>
                Apply at the hospital's business office within 365 days of the date of service; they must decide within 10 business days. Help line:{" "}
                <strong className="text-white/90">1-866-588-5696</strong>.
              </p>
            </div>

            <div className={section}>
              <h2 className={h2}>Washington hospital charity care</h2>
              <p className={p}>
                WA's hospital charity-care law (RCW 70.170.060). Applies to WA acute care hospitals, for patients who are{" "}
                <strong className="text-white/90">uninsured</strong> (applied conservatively here -- the statute's income-based eligibility doesn't
                spell this out as explicitly as NJ's does).
              </p>
              <div className="rounded-xl bg-white/5 p-3 text-xs">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-white/70">
                  <span className="text-white/40">Income, % of poverty line</span>
                  <span className="text-white/40">You pay</span>
                  <span>Up to 200%</span>
                  <span className="text-white/90">$0 -- fully covered</span>
                  <span>200% to 250%</span>
                  <span className="text-white/90">25% of the bill</span>
                  <span>250% to 300%</span>
                  <span className="text-white/90">50%</span>
                  <span>Over 300%</span>
                  <span className="text-white/90">Full price (at this schedule)</span>
                </div>
              </div>
              <p className={p}>
                <strong className="text-white/90">This is the legal minimum every WA hospital must offer.</strong> Larger hospital systems (chains of 3+
                acute hospitals, or specific large hospitals in King County or a southern-border county) are legally required to offer a better schedule
                -- up to 400% FPL -- that CareMap can't apply per-hospital without bed-count and ownership data it doesn't have loaded. If you're at a
                large hospital system, ask whether the better schedule applies to you.
              </p>
            </div>

            <p className={p}>
              <strong className="text-white/90">Right now, NJ and WA are the only states with a modeled tier.</strong> Every other state still shows
              real hospital locations and typical billed charges, but says "[state] rules coming soon" instead of a personal estimate.
            </p>

            <div className={section}>
              <h2 className={h2}>If you have other coverage</h2>
              <div className="space-y-2">
                {OTHER_INSURANCE.map((t) => (
                  <p key={t} className={p}>
                    <strong className="text-white/90">{INSURANCE_LABELS[t]}: </strong>
                    {insuranceGuidance(t)}
                  </p>
                ))}
              </div>
            </div>

            <div className={section}>
              <h2 className={h2}>What the dollar figures mean</h2>
              <p className={p}>
                <strong className="text-white/90">"Typical billed charge"</strong> is the average amount that hospital billed Medicare for that exact
                procedure, from CMS's own public data -- not what any one patient paid, and not pulled from your insurance. Every number CareMap shows
                comes directly from that data; nothing is estimated or guessed by the AI.
              </p>
              <p className={p}>
                It's a starting point for comparison, always an estimate -- confirm the real number with the hospital's billing office before you owe
                anything. If you're uninsured and scheduling ahead, you're entitled to a free{" "}
                <strong className="text-white/90">Good Faith Estimate</strong> at least 3 business days before a scheduled service (federal No Surprises
                Act) -- ask for one, and use it to dispute a bill that comes in far higher.
              </p>
            </div>

            <div className={section}>
              <h2 className={h2}>Star rating</h2>
              <p className={p}>CMS's own overall hospital quality rating, 1 to 5 stars, for hospitals that report enough data to be rated.</p>
            </div>

            <div className={section}>
              <h2 className={h2}>Traveling abroad</h2>
              <p className={p}>
                There's no free, public, structured dataset of actual billed charges outside the US the way CMS provides domestically -- so international
                results are <strong className="text-white/90">locations only</strong>, sourced from OpenStreetMap, with no cost shown. Confirm pricing
                directly with the facility, a travel insurer, or your embassy.
              </p>
            </div>

            <div className={section}>
              <h2 className={h2}>Where the data comes from</h2>
              <ul className="space-y-1 text-xs text-white/50 list-disc pl-4">
                <li>Hospital names, locations, star ratings -- CMS Hospital General Information</li>
                <li>Typical billed charges -- CMS Medicare Inpatient by Provider and Service</li>
                <li>NJ Charity Care rules -- New Jersey Department of Health</li>
                <li>WA charity care rules -- RCW 70.170.060, Washington State Legislature</li>
                <li>International locations -- OpenStreetMap (Nominatim, Overpass, Photon)</li>
              </ul>
              <p className={p}>All public, official sources -- CareMap never adds or guesses a number that isn't already in that data.</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
