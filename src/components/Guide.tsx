import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { Profile } from "../hooks/useCareMap";
import { NEED_CATEGORIES, needLabel } from "../lib/drg";
import { INSURANCE_LABELS } from "../lib/insurance";
import type { InsuranceType } from "../lib/intake";
import { fplAmount } from "../lib/policy";
import type { Facility, ZipCentroid } from "../lib/types";
import { ChevronDownIcon, ChevronLeftIcon, GlobeIcon, LocationIcon, MinusIcon, PlusIcon } from "./icons";
import { LocationSearch } from "./LocationSearch";
import { iconButton } from "./ui";
import { peopleText, t } from "../i18n";

// One question per screen, in plain words, so nobody has to know where to
// tap next. Each answer moves on by itself; Back and Skip are always there.
type Step = "need" | "procedure" | "place" | "household" | "income" | "insurance";

interface Choice {
  label: string;
  detail: string;
  need: string | null;
  procedure?: boolean;
  featured?: boolean;
}
const CHOICES: Choice[] = [
  { label: "Lower or erase a hospital bill", detail: "See if you qualify for free or cheaper care", need: null, featured: true },
  { label: "See a doctor", detail: "Checkups and physicals", need: "checkup" },
  { label: "Sick or hurt today", detail: "Urgent care and clinics", need: "sick visit" },
  { label: "Dental", detail: "Cleanings and tooth pain", need: "dental care" },
  { label: "Mental health", detail: "Counseling and therapy", need: "counseling" },
  { label: "Pregnancy", detail: "Prenatal care", need: "pregnancy care" },
  { label: "Surgery or hospital stay", detail: "Compare prices by hospital", need: null, procedure: true },
  { label: "Not sure. Show me what's near me", detail: "Hospitals, clinics and urgent care", need: null },
];

const INSURANCE_ORDER: InsuranceType[] = ["uninsured", "medicaid", "medicare", "private", "va_tricare", "unsure"];
const INSURANCE_PLAIN: Record<InsuranceType, string> = {
  uninsured: "No, I don't have insurance",
  medicaid: "Medicaid",
  medicare: "Medicare",
  private: "Yes, through work or a plan I bought",
  va_tricare: "VA or Tricare",
  unsure: "I'm not sure",
};

interface GuideProps {
  /** Switch to searching outside the US (no prices, so no income steps). */
  onAbroad: () => void;
  profile: Profile;
  onChange: (patch: Partial<Profile>) => void;
  onDone: () => void;
  zipCentroids: Record<string, ZipCentroid>;
  facilities: Facility[];
  onLocate: () => void;
  locating: boolean;
  locationError: string | null;
}

export function Guide({ onAbroad, profile, onChange, onDone, zipCentroids, facilities, onLocate, locating, locationError }: GuideProps) {
  const [step, setStep] = useState<Step>("need");
  const [history, setHistory] = useState<Step[]>([]);
  const [exact, setExact] = useState(false);
  const order: Step[] = ["need", "place", "household", "income", "insurance"];
  const index = order.indexOf(step === "procedure" ? "need" : step);

  const hasPlace = /^\d{5}$/.test(profile.zip) || profile.zip === "US";
  const [needPlace, setNeedPlace] = useState(false);
  const go = (next: Step | "done") => {
    // Never finish without a place: results need one.
    if (next === "done" && !hasPlace) {
      setNeedPlace(true);
      setHistory((h) => [...h, step]);
      setStep("place");
      return;
    }
    if (next === "done") return onDone();
    setHistory((h) => [...h, step]);
    setStep(next);
  };
  const back = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setStep(prev);
  };
  // The place step moves on once a real ZIP is picked or found.
  const afterPlace: Step = "household";
  const [locRequested, setLocRequested] = useState(false);
  useEffect(() => {
    if (step === "place" && locRequested && /^\d{5}$/.test(profile.zip)) {
      setLocRequested(false);
      go(needPlace ? "done" : afterPlace);
    }
    // go is recreated each render; zip and step are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.zip, step, locRequested]);

  const base = fplAmount(profile.household);
  const d = (pct: number) => `$${Math.round((base * pct) / 100).toLocaleString("en-US")}`;
  const ranges = [
    { maxFpl: 100, label: t("Under {a}", { a: d(100) }) },
    { maxFpl: 200, label: t("{a} to {b}", { a: d(100), b: d(200) }) },
    { maxFpl: 300, label: t("{a} to {b}", { a: d(200), b: d(300) }) },
    { maxFpl: 400, label: t("{a} to {b}", { a: d(300), b: d(400) }) },
    { maxFpl: 1000, label: t("Over {a}", { a: d(400) }) },
  ];

  const big = "flex w-full min-h-[52px] flex-col justify-center rounded-2xl px-4 py-3 text-left transition-[background-color,transform] active:scale-[0.98]";
  const off = "bg-white/[0.07] text-white hover:bg-white/[0.11]";
  const on = "bg-white text-black";

  return (
    <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
      <div className="mb-3 flex items-center justify-between">
        {history.length > 0 ? (
          <button type="button" onClick={back} className={`${iconButton} -ml-2 w-auto gap-0.5 px-2 text-[15px] text-white/80`}>
            <ChevronLeftIcon size={18} />
            {t("Back")}
          </button>
        ) : (
          <span />
        )}
        <span className="text-[13px] font-medium text-white/45">
          {t("Step {n} of {total}", { n: index + 1, total: order.length })}
        </span>
      </div>
      <div className="mb-4 flex gap-1" aria-hidden="true">
        {order.map((s, i) => (
          <span key={s} className={`h-1 flex-1 rounded-full ${i <= index ? "bg-white" : "bg-white/15"}`} />
        ))}
      </div>

      {step === "need" && (
        <Question title={t("What do you need help with?")} why={t("Pick one. You can change it later.")}>
          <div className="space-y-2">
            {CHOICES.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => {
                  onChange({ need: c.need, emergency: false });
                  go(c.procedure ? "procedure" : "place");
                }}
                className={`${big} ${c.featured ? on : off}`}
              >
                <span className="text-[16px] font-semibold leading-tight">{t(c.label)}</span>
                <span className={`mt-0.5 text-[13px] ${c.featured ? "text-black/60" : "text-white/50"}`}>{t(c.detail)}</span>
              </button>
            ))}
          </div>
        </Question>
      )}

      {step === "procedure" && (
        <Question title={t("What kind of care?")} why={t("We'll show what each nearby hospital charges for it.")}>
          <div className="relative">
            <select
              value={profile.need ?? ""}
              onChange={(e) => {
                if (!e.target.value) return;
                onChange({ need: e.target.value });
                go("place");
              }}
              aria-label="Condition or procedure"
              className="h-12 w-full appearance-none rounded-2xl bg-white/[0.08] pl-4 pr-10 text-[16px] text-white outline-none focus:ring-1 focus:ring-white/30"
            >
              <option value="">{t("Choose one")}</option>
              {NEED_CATEGORIES.map((c) => (
                <optgroup key={c.category} label={c.category}>
                  {c.items.map((n) => (
                    <option key={n} value={n}>
                      {needLabel(n)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <ChevronDownIcon size={18} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-white/50" />
          </div>
          <SkipButton onClick={() => go("place")}>{t("Not sure. Skip this")}</SkipButton>
        </Question>
      )}

      {step === "place" && (
        <Question title={t("Where are you?")} why={needPlace ? t("One last thing: we need your ZIP code or city to show care near you.") : t("We'll find care close to you.")}>
          <button
            type="button"
            onClick={() => {
              setLocRequested(true);
              onLocate();
            }}
            disabled={locating}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-[16px] font-semibold text-black transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            <LocationIcon size={17} />
            {locating ? t("Finding you…") : t("Use my location")}
          </button>
          <p className="my-3 text-center text-[13px] text-white/45">{t("or type it")}</p>
          <LocationSearch
            zip={profile.zip}
            onZip={(zip) => {
              onChange({ zip });
              if (zip.length === 5 || zip === "US") go(needPlace ? "done" : afterPlace);
            }}
            zipCentroids={zipCentroids}
            facilities={facilities}
            onLocate={onLocate}
            locating={locating}
            locationError={locationError}
            usingLocation={false}
            abroad={false}
            onDestination={() => {}}
          />
          <NextButton onClick={() => go(needPlace ? "done" : afterPlace)} disabled={!hasPlace} />
          <button type="button" onClick={onAbroad} className="mt-3 flex w-full items-center justify-center gap-1.5 py-2 text-[15px] font-medium text-white/70 hover:text-white">
            <GlobeIcon size={16} />
            {t("Traveling outside the US?")}
          </button>
        </Question>
      )}

      {step === "household" && (
        <Question title={t("How many people live in your home?")} why={t("Count you, plus anyone you support. Help with bills is based on family size.")}>
          <div className="flex items-center justify-between rounded-2xl bg-white/[0.07] p-2">
            <button
              type="button"
              aria-label="Fewer people"
              disabled={profile.household <= 1}
              onClick={() => onChange({ household: Math.max(1, profile.household - 1) })}
              className={`${iconButton} h-12 w-12`}
            >
              <MinusIcon size={20} />
            </button>
            <span className="text-[22px] font-semibold tabular-nums">{peopleText(profile.household)}</span>
            <button
              type="button"
              aria-label="More people"
              disabled={profile.household >= 15}
              onClick={() => onChange({ household: Math.min(15, profile.household + 1) })}
              className={`${iconButton} h-12 w-12`}
            >
              <PlusIcon size={20} />
            </button>
          </div>
          <NextButton onClick={() => go("income")} />
        </Question>
      )}

      {step === "income" && (
        <Question
          title={t("About how much does your home make a year?")}
          why={t("Before taxes, all together. Many hospitals must give free or cheaper care below certain incomes. Your answer stays on this phone.")}
        >
          {exact ? (
            <>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[16px] text-white/50">$</span>
                <input
                  autoFocus
                  value={profile.income === "" ? "" : Number(profile.income).toLocaleString("en-US")}
                  onChange={(e) => onChange({ income: e.target.value.replace(/\D/g, "").slice(0, 8), incomeRange: null })}
                  inputMode="numeric"
                  placeholder="0"
                  aria-label="Yearly household income"
                  className="h-12 w-full rounded-2xl bg-white/[0.08] pl-8 pr-4 text-[16px] tabular-nums text-white outline-none focus:ring-1 focus:ring-white/30"
                />
              </div>
              <NextButton onClick={() => go("insurance")} disabled={profile.income === ""} />
            </>
          ) : (
            <div className="space-y-2" role="radiogroup" aria-label="Yearly household income">
              {ranges.map((r) => (
                <button
                  key={r.maxFpl}
                  type="button"
                  role="radio"
                  aria-checked={profile.income === "" && profile.incomeRange === r.maxFpl}
                  onClick={() => {
                    onChange({ income: "", incomeRange: r.maxFpl });
                    go("insurance");
                  }}
                  className={`${big} ${profile.income === "" && profile.incomeRange === r.maxFpl ? on : off} text-[16px] tabular-nums`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between px-1">
            <button type="button" onClick={() => setExact(!exact)} className="text-[14px] font-medium text-white/65 hover:text-white">
              {exact ? t("Pick a range instead") : t("Type the exact amount")}
            </button>
            <button
              type="button"
              onClick={() => {
                onChange({ income: "", incomeRange: null });
                go("insurance");
              }}
              className="text-[14px] font-medium text-white/65 hover:text-white"
            >
              {t("Skip")}
            </button>
          </div>
        </Question>
      )}

      {step === "insurance" && (
        <Question title={t("Do you have health insurance?")} why={t("Help with hospital bills is mostly for people without insurance.")}>
          <div className="space-y-2">
            {INSURANCE_ORDER.map((ins) => (
              <button
                key={ins}
                type="button"
                onClick={() => {
                  onChange({ insuranceType: ins });
                  go("done");
                }}
                className={`${big} ${profile.insuranceType === ins ? on : off} text-[16px]`}
                aria-label={t(INSURANCE_LABELS[ins])}
              >
                {t(INSURANCE_PLAIN[ins])}
              </button>
            ))}
          </div>
        </Question>
      )}
    </motion.div>
  );
}

function Question({ title, why, children }: { title: string; why: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[24px] font-semibold leading-tight tracking-tight">{title}</h2>
      <p className="mb-4 mt-1.5 text-[15px] leading-relaxed text-white/60">{why}</p>
      {children}
    </div>
  );
}

function NextButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-4 h-12 w-full rounded-full bg-white text-[16px] font-semibold text-black transition-transform active:scale-[0.98] disabled:opacity-30"
    >
      {t("Next")}
    </button>
  );
}

function SkipButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="mt-3 w-full text-center text-[14px] font-medium text-white/65 hover:text-white">
      {children}
    </button>
  );
}
