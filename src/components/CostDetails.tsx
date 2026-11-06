import { AnimatePresence, motion } from "framer-motion";
import { INSURANCE_LABELS } from "../lib/insurance";
import type { InsuranceType } from "../lib/intake";
import type { Profile } from "../hooks/useCareMap";
import { ChevronDownIcon, LockIcon, MinusIcon, PlusIcon } from "./icons";
import { card, iconButton, label } from "./ui";

interface CostDetailsProps {
  profile: Profile;
  onChange: (patch: Partial<Profile>) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
  fplPct: number | null;
}

const INSURANCE_TYPES = Object.keys(INSURANCE_LABELS) as InsuranceType[];

/** Household, income and insurance. Every change re-prices the map and the
 * cards on the spot; nothing here leaves the browser. */
export function CostDetails({ profile, onChange, open, onOpen, fplPct }: CostDetailsProps) {
  const income = profile.income === "" ? "" : Number(profile.income).toLocaleString("en-US");
  const people = `${profile.household} ${profile.household === 1 ? "person" : "people"}`;
  const summary = [people, income ? `$${income}` : null, INSURANCE_LABELS[profile.insuranceType]].filter(Boolean).join(" · ");

  return (
    <div className={card}>
      <button type="button" onClick={() => onOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div className="min-w-0">
          <div className="text-[15px] font-medium text-white">Your costs</div>
          <div className="truncate text-[13px] text-white/50">
            {profile.income === "" && profile.insuranceType === "uninsured" ? "Add your income for a personal estimate" : summary}
          </div>
        </div>
        <ChevronDownIcon size={18} className={`shrink-0 text-white/45 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-3.5 px-4 pb-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] text-white/85">Household</span>
                <div className="flex items-center gap-1 rounded-full bg-white/[0.08] p-0.5">
                  <button
                    type="button"
                    aria-label="Fewer people"
                    disabled={profile.household <= 1}
                    onClick={() => onChange({ household: Math.max(1, profile.household - 1) })}
                    className={`${iconButton} h-8 w-8`}
                  >
                    <MinusIcon size={15} />
                  </button>
                  <span className="min-w-[4.5rem] text-center text-[14px] tabular-nums text-white">{people}</span>
                  <button
                    type="button"
                    aria-label="More people"
                    disabled={profile.household >= 15}
                    onClick={() => onChange({ household: Math.min(15, profile.household + 1) })}
                    className={`${iconButton} h-8 w-8`}
                  >
                    <PlusIcon size={15} />
                  </button>
                </div>
              </div>

              <div>
                <label className={label} htmlFor="caremap-income">
                  Household income per year, before taxes
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-white/45">$</span>
                  <input
                    id="caremap-income"
                    value={income}
                    onChange={(e) => onChange({ income: e.target.value.replace(/\D/g, "").slice(0, 8) })}
                    inputMode="numeric"
                    placeholder="0"
                    className="h-11 w-full rounded-xl bg-white/[0.08] pl-7 pr-3.5 text-[15px] tabular-nums text-white placeholder:text-white/30 outline-none focus:bg-white/[0.12] focus:ring-1 focus:ring-white/20"
                  />
                </div>
                {fplPct != null && (
                  <p className="mt-1.5 px-0.5 text-[12px] text-white/45">
                    That's {fplPct}% of the federal poverty line for {people}, which is what charity-care rules are based on.
                  </p>
                )}
              </div>

              <div>
                <label className={label} htmlFor="caremap-insurance">
                  Insurance
                </label>
                <div className="relative">
                  <select
                    id="caremap-insurance"
                    value={profile.insuranceType}
                    onChange={(e) => onChange({ insuranceType: e.target.value as InsuranceType })}
                    className="h-11 w-full appearance-none rounded-xl bg-white/[0.08] pl-3.5 pr-9 text-[15px] text-white outline-none focus:bg-white/[0.12] focus:ring-1 focus:ring-white/20"
                  >
                    {INSURANCE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {INSURANCE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  <ChevronDownIcon size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/45" />
                </div>
              </div>

              <label className="flex cursor-pointer select-none items-center justify-between gap-3">
                <span className="text-[15px] text-white/85">I'm a veteran</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={profile.veteran}
                  onChange={(e) => onChange({ veteran: e.target.checked })}
                  className="caremap-switch"
                />
              </label>

              <p className="flex items-start gap-1.5 text-[12px] leading-snug text-white/40">
                <LockIcon size={13} className="mt-px shrink-0" />
                Your income and household size stay on this device. CareMap's AI only ever sees a percentage.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
