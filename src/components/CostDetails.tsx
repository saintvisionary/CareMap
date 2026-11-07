import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { fplAmount } from "../lib/policy";
import { INSURANCE_LABELS } from "../lib/insurance";
import type { InsuranceType } from "../lib/intake";
import type { Profile } from "../hooks/useCareMap";
import { ChevronDownIcon, LockIcon, MinusIcon, PlusIcon } from "./icons";
import { card, iconButton, label } from "./ui";

interface CostDetailsProps {
  /** Just the fields with a Done button, for the filter row's editor. */
  bare?: boolean;
  onDone?: () => void;
  /** Clears everything CareMap saved on this device. */
  onForget?: () => void;
  profile: Profile;
  onChange: (patch: Partial<Profile>) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
  fplPct: number | null;
}

const INSURANCE_TYPES = Object.keys(INSURANCE_LABELS) as InsuranceType[];

/** Household, income and insurance. Every change re-prices the map and the
 * cards on the spot; nothing here leaves the browser. */
export function CostDetails({ bare, onDone, onForget, profile, onChange, open, onOpen, fplPct }: CostDetailsProps) {
  const [exact, setExact] = useState(profile.income !== "");
  // Tap a range instead of typing a salary. Cut points are the poverty-line
  // multiples most charity-care rules use, in dollars for this household.
  const base = fplAmount(profile.household);
  const dollars = (pct: number) => `$${Math.round((base * pct) / 100).toLocaleString("en-US")}`;
  const ranges = [
    { maxFpl: 100, label: `Under ${dollars(100)}` },
    { maxFpl: 200, label: `${dollars(100)} to ${dollars(200)}` },
    { maxFpl: 300, label: `${dollars(200)} to ${dollars(300)}` },
    { maxFpl: 400, label: `${dollars(300)} to ${dollars(400)}` },
    { maxFpl: 1000, label: `Over ${dollars(400)}` },
  ];
  const income = profile.income === "" ? "" : Number(profile.income).toLocaleString("en-US");
  const people = `${profile.household} ${profile.household === 1 ? "person" : "people"}`;
  const rangeLabel = profile.incomeRange != null ? incomeRangeLabel(profile.household, profile.incomeRange) : null;
  const summary = [people, income ? `$${income}` : rangeLabel, INSURANCE_LABELS[profile.insuranceType]].filter(Boolean).join(" · ");

  const body = (
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
                <p className={label} id="caremap-income-label">
                  Household income per year, before taxes
                </p>
                {exact ? (
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-white/45">$</span>
                    <input
                      id="caremap-income"
                      aria-labelledby="caremap-income-label"
                      value={income}
                      onChange={(e) => onChange({ income: e.target.value.replace(/\D/g, "").slice(0, 8), incomeRange: null })}
                      inputMode="numeric"
                      placeholder="0"
                      autoFocus={profile.income === ""}
                      className="h-11 w-full rounded-xl bg-white/[0.08] pl-7 pr-3.5 text-[15px] tabular-nums text-white placeholder:text-white/30 outline-none focus:bg-white/[0.12] focus:ring-1 focus:ring-white/20"
                    />
                  </div>
                ) : (
                  <div className="grid gap-1.5" role="radiogroup" aria-labelledby="caremap-income-label">
                    {ranges.map((r) => {
                      const on = profile.income === "" && profile.incomeRange === r.maxFpl;
                      return (
                        <button
                          key={r.maxFpl}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => onChange({ income: "", incomeRange: on ? null : r.maxFpl })}
                          className={`flex h-11 items-center rounded-xl px-3.5 text-left text-[15px] tabular-nums transition-colors ${
                            on ? "bg-white font-medium text-black" : "bg-white/[0.08] text-white/90 hover:bg-white/[0.12]"
                          }`}
                        >
                          {r.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (exact) onChange({ income: "" });
                    setExact(!exact);
                  }}
                  className="mt-2 px-0.5 text-[13px] font-medium text-white/60 hover:text-white"
                >
                  {exact ? "Pick a range instead" : "Enter the exact amount"}
                </button>
                {fplPct != null && (
                  <p className="mt-1.5 px-0.5 text-[12px] text-white/45">
                    {profile.income !== ""
                      ? `That's ${fplPct}% of the federal poverty line for ${people}. Charity care is based on this.`
                      : fplPct >= 1000
                        ? "That's over 4 times the federal poverty line. Most charity care stops before this."
                        : `That's up to ${fplPct}% of the federal poverty line for ${people}. Prices use the top of your range, so yours could be lower.`}
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
                <span>
                  Why we ask: many hospitals must give free or cheaper care to families under certain incomes. Your answer stays on this phone and is never
                  shared with hospitals, debt collectors or the government.
                  {onForget && (
                    <>
                      {" "}
                      <button type="button" onClick={onForget} className="font-medium text-white/70 underline underline-offset-2 hover:text-white">
                        Erase my answers
                      </button>
                    </>
                  )}
                </span>
              </p>
            </div>
  );

  if (bare) {
    return (
      <div className={`${card} pt-4`}>
        {body}
        <div className="px-4 pb-4">
          <button type="button" onClick={onDone} className="h-11 w-full rounded-full bg-white text-[15px] font-medium text-black transition-transform active:scale-[0.97]">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={card}>
      <button type="button" onClick={() => onOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div className="min-w-0">
          <div className="text-[15px] font-medium text-white">Your costs</div>
          <div className="truncate text-[13px] text-white/50">
            {profile.income === "" && profile.incomeRange == null && profile.insuranceType === "uninsured" ? "Add your income for a personal estimate" : summary}
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
            {body}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** "$32,000 to $64,000" style label for a saved range. */
export function incomeRangeLabel(household: number, maxFpl: number): string {
  const base = fplAmount(household);
  const d = (pct: number) => `$${Math.round((base * pct) / 100).toLocaleString("en-US")}`;
  if (maxFpl <= 100) return `Under ${d(100)}`;
  if (maxFpl >= 1000) return `Over ${d(400)}`;
  return `${d(maxFpl - 100)} to ${d(maxFpl)}`;
}
