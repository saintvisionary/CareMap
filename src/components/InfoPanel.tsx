import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { TIER_COLORS } from "../lib/geo";
import { FREE_TIER_STATES, MODELED_CHARITY_STATES } from "../lib/policy";
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
                WA's hospital charity-care law (RCW 70.170.060). Applies to every licensed WA hospital, including Critical Access Hospitals, for
                patients who are{" "}
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

            <div className={section}>
              <h2 className={h2}>Illinois hospital charity care</h2>
              <p className={p}>
                Illinois's Hospital Uninsured Patient Discount Act (210 ILCS 89). Applies to all IL hospitals, for patients who are{" "}
                <strong className="text-white/90">uninsured only</strong> -- unlike NJ/WA, the statute doesn't extend to the underinsured. The free-care
                threshold depends on the hospital type:
              </p>
              <div className="rounded-xl bg-white/5 p-3 text-xs">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-white/70">
                  <span className="text-white/40">Hospital type</span>
                  <span className="text-white/40">Free up to</span>
                  <span>Standard hospital</span>
                  <span className="text-white/90">200% of poverty line</span>
                  <span>Critical Access Hospital</span>
                  <span className="text-white/90">125% of poverty line</span>
                </div>
              </div>
              <p className={p}>
                <strong className="text-white/90">Above that line, CareMap shows no percentage.</strong> The real statutory discount is based on each
                hospital's own Medicare cost-to-charge ratio -- a different CMS dataset CareMap doesn't have loaded -- so showing a number there would be
                a guess, not a grounded figure. The law does still guarantee one real protection in that range: a hospital can never collect more than{" "}
                <strong className="text-white/90">20% of your family income in any 12-month period</strong>, regardless of the missing percentage. Ask
                the hospital's billing office for your exact discount.
              </p>
            </div>

            <div className={section}>
              <h2 className={h2}>New York hospital charity care</h2>
              <p className={p}>
                New York's Hospital Financial Assistance Law (NY Public Health Law 2807-k). Applies to every NY general hospital, for patients who are{" "}
                <strong className="text-white/90">uninsured or underinsured</strong>, with no immigration-status requirement.
              </p>
              <div className="rounded-xl bg-white/5 p-3 text-xs">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-white/70">
                  <span className="text-white/40">Income, % of poverty line</span>
                  <span className="text-white/40">You pay</span>
                  <span>Up to 200%</span>
                  <span className="text-white/90">$0 -- fully covered</span>
                  <span>Over 200%</span>
                  <span className="text-white/90">No percentage shown here</span>
                </div>
              </div>
              <p className={p}>
                <strong className="text-white/90">Above 200%, CareMap shows no percentage at all</strong> -- not even a disclosed cap, unlike Illinois.
                New York's real law caps payment at 10-20% of the <strong className="text-white/90">Medicaid-equivalent rate</strong> for the service, not
                a percentage of billed charges or income -- a completely different number CareMap doesn't have loaded. Ask the hospital's billing office
                directly; by law they must decide a completed application within 30 days.
              </p>
            </div>

            <div className={section}>
              <h2 className={h2}>Oregon hospital financial assistance</h2>
              <p className={p}>
                Oregon's hospital financial assistance law (ORS 442.610-442.618). Applies only to{" "}
                <strong className="text-white/90">nonprofit</strong> hospitals -- a for-profit or government-owned Oregon hospital isn't covered, and
                CareMap won't show a tier for one. Unlike every other state here, Oregon's law covers insured, underinsured, and uninsured patients alike.
              </p>
              <div className="rounded-xl bg-white/5 p-3 text-xs">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-white/70">
                  <span className="text-white/40">Income, % of poverty line</span>
                  <span className="text-white/40">You pay at most</span>
                  <span>Up to 200%</span>
                  <span className="text-white/90">$0 -- fully covered</span>
                  <span>200% to 300%</span>
                  <span className="text-white/90">25% of the bill</span>
                  <span>300% to 350%</span>
                  <span className="text-white/90">50%</span>
                  <span>350% to 400%</span>
                  <span className="text-white/90">75%</span>
                  <span>Over 400%</span>
                  <span className="text-white/90">Full price (at this schedule)</span>
                </div>
              </div>
              <p className={p}>
                <strong className="text-white/90">These are legal minimum discounts.</strong> A nonprofit hospital's own policy may be more generous than
                the table above -- confirm with the hospital's billing office for your actual rate.
              </p>
            </div>

            <div className={section}>
              <h2 className={h2}>Maryland hospital financial assistance</h2>
              <p className={p}>
                Maryland's hospital financial assistance law (Health-General 19-214.1). Applies to virtually every MD hospital, regardless of ownership,
                under Maryland's unique all-payer rate-setting system. Covers patients who are <strong className="text-white/90">uninsured or
                underinsured</strong>.
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
                  <span className="text-white/90">40%</span>
                  <span>300% to 350%</span>
                  <span className="text-white/90">50%</span>
                  <span>350% to 400%</span>
                  <span className="text-white/90">55%</span>
                  <span>400% to 450%</span>
                  <span className="text-white/90">60%</span>
                  <span>450% to 500%</span>
                  <span className="text-white/90">65%</span>
                  <span>Over 500%</span>
                  <span className="text-white/90">Full price (at this schedule)</span>
                </div>
              </div>
              <p className={p}>
                Maryland also has a separate hardship path for high medical debt relative to income, up to 500% of the poverty line -- CareMap can't
                verify that without your actual billing history, so ask the hospital's billing office directly if you think it applies to you. Apply
                within 240 days of the bill; the hospital must decide within 14 days.
              </p>
            </div>

            <div className={section}>
              <h2 className={h2}>Rhode Island hospital charity care</h2>
              <p className={p}>
                Rhode Island's hospital licensing regulation (216-RICR-40-10-23.14). Applies to every licensed RI hospital, for patients who are{" "}
                <strong className="text-white/90">uninsured or underinsured</strong>.
              </p>
              <div className="rounded-xl bg-white/5 p-3 text-xs">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-white/70">
                  <span className="text-white/40">Income, % of poverty line</span>
                  <span className="text-white/40">You pay</span>
                  <span>Up to 200%</span>
                  <span className="text-white/90">$0 -- fully covered</span>
                  <span>Over 200%</span>
                  <span className="text-white/90">No statewide percentage</span>
                </div>
              </div>
              <p className={p}>
                <strong className="text-white/90">Above 200%, CareMap shows no percentage.</strong> Rhode Island's regulation itself leaves the
                200-300% FPL discount to each individual hospital to set, and says nothing about pricing above 300% FPL at all -- there's no statewide
                number to show, and unlike Illinois, no other disclosable cap fact either. Ask the hospital's billing office for its own sliding scale.
              </p>
            </div>

            <div className={section}>
              <h2 className={h2}>Massachusetts Health Safety Net</h2>
              <p className={p}>
                Massachusetts's Health Safety Net (101 CMR 613.00), a state fund that reimburses hospitals for care given to eligible patients who are{" "}
                <strong className="text-white/90">uninsured or underinsured</strong>.
              </p>
              <div className="rounded-xl bg-white/5 p-3 text-xs">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-white/70">
                  <span className="text-white/40">Income, % of poverty line</span>
                  <span className="text-white/40">You pay</span>
                  <span>Up to 150%</span>
                  <span className="text-white/90">$0 -- fully covered</span>
                  <span>Over 150%</span>
                  <span className="text-white/90">No modeled amount</span>
                </div>
              </div>
              <p className={p}>
                <strong className="text-white/90">This free-care line is 150% of the poverty line, lower than every other state here.</strong> Above
                it, the real amount you'd owe is a flat annual deductible tied to a Massachusetts Health Connector insurance premium, not a percentage
                of billed charges -- CareMap doesn't have that premium data, so no amount is shown. Ask the hospital's billing office directly.
              </p>
            </div>

            <div className={section}>
              <h2 className={h2}>Maine free hospital care</h2>
              <p className={p}>
                Maine's free care law (22 M.R.S. 1716-A, in effect since July 1, 2026). Applies to Maine hospitals, for{" "}
                <strong className="text-white/90">Maine residents only</strong> -- CareMap can't check residency, so confirm that applies to you.
              </p>
              <div className="rounded-xl bg-white/5 p-3 text-xs">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-white/70">
                  <span className="text-white/40">Income, % of poverty line</span>
                  <span className="text-white/40">You pay</span>
                  <span>Up to 200%</span>
                  <span className="text-white/90">$0 -- fully covered</span>
                  <span>Over 200%</span>
                  <span className="text-white/90">No statewide percentage</span>
                </div>
              </div>
              <p className={p}>
                Above 200%, Maine sets no discount percentage. Up to 400% of the poverty line, though, the hospital must offer a payment plan whose
                monthly payments are no more than <strong className="text-white/90">4% of your monthly family income</strong>.
              </p>
            </div>

            <div className={section}>
              <h2 className={h2}>Vermont hospital financial assistance</h2>
              <p className={p}>
                Vermont's hospital financial assistance law (18 V.S.A. 9482). Applies to every licensed Vermont hospital, for{" "}
                <strong className="text-white/90">Vermont residents</strong> (no minimum time living there).
              </p>
              <div className="rounded-xl bg-white/5 p-3 text-xs">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-white/70">
                  <span className="text-white/40">Income, % of poverty line</span>
                  <span className="text-white/40">You pay</span>
                  <span>Up to 250%</span>
                  <span className="text-white/90">$0 -- fully covered</span>
                  <span>250% to 400%</span>
                  <span className="text-white/90">At least 40% off (no dollar figure)</span>
                  <span>Up to 600%</span>
                  <span className="text-white/90">Capped at 20% of income</span>
                </div>
              </div>
              <p className={p}>
                The 40% discount comes off what the hospital "generally bills" insurers, which is each hospital's own rate and isn't in CMS's
                public data, so CareMap can't turn it into a dollar amount. Up to 600% of the poverty line, if the hospital's bills come to more
                than 20% of your household income, it must reduce what you owe to 20% of your household income.
              </p>
            </div>

            {Object.entries(FREE_TIER_STATES).map(([st, f]) => (
              <div key={st} className={section}>
                <h2 className={h2}>{f.heading}</h2>
                <p className={p}>
                  {f.law}. {f.scope}
                </p>
                <div className="rounded-xl bg-white/5 p-3 text-xs">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-white/70">
                    <span className="text-white/40">Income, % of poverty line</span>
                    <span className="text-white/40">You pay</span>
                    <span>
                      {f.strictlyBelow ? "Below" : "Up to"} {f.maxFplPct}%
                    </span>
                    <span className="text-white/90">$0 -- fully covered</span>
                    <span>
                      {f.strictlyBelow ? "At or over" : "Over"} {f.maxFplPct}%
                    </span>
                    <span className="text-white/90">No statewide percentage</span>
                  </div>
                </div>
                <p className={p}>{f.aboveLine}</p>
              </div>
            ))}

            <p className={p}>
              <strong className="text-white/90">
                Right now, {MODELED_CHARITY_STATES.slice(0, -1).join(", ")}, and {MODELED_CHARITY_STATES[MODELED_CHARITY_STATES.length - 1]} are
                the only states with a modeled tier.
              </strong>{" "}
              Every other state still shows real hospital locations and typical billed charges, but says "[state] rules coming soon" instead of a
              personal estimate.
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
                <li>IL charity care rules -- 210 ILCS 89, Illinois Hospital Uninsured Patient Discount Act</li>
                <li>NY charity care rules -- NY Public Health Law 2807-k, Hospital Financial Assistance Law</li>
                <li>OR charity care rules -- ORS 442.610-442.618, Oregon hospital financial assistance law</li>
                <li>MD charity care rules -- Md. Code, Health-General 19-214.1</li>
                <li>RI charity care rules -- 216-RICR-40-10-23.14, Rhode Island hospital licensing regulation</li>
                <li>MA charity care rules -- 101 CMR 613.00, Massachusetts Health Safety Net</li>
                <li>ME free care rules -- 22 M.R.S. 1716-A, Maine Legislature</li>
                <li>VT financial assistance rules -- 18 V.S.A. 9482, Vermont Legislature</li>
                {Object.entries(FREE_TIER_STATES).map(([st, f]) => (
                  <li key={st}>
                    {st} charity care rules -- {f.law}
                  </li>
                ))}
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
