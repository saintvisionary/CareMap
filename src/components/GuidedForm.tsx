import { useState } from "react";
import { NEED_TO_DRG } from "../lib/drg";

interface GuidedFormProps {
  onSubmit: (message: string) => void;
}

const NEEDS = Object.keys(NEED_TO_DRG);
const OTHER = "other";

const fieldClass =
  "w-full rounded-xl bg-white/10 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/30";
const labelClass = "text-[11px] uppercase tracking-wide text-white/40 mb-1 block";

export function GuidedForm({ onSubmit }: GuidedFormProps) {
  const [zip, setZip] = useState("");
  const [household, setHousehold] = useState("4");
  const [income, setIncome] = useState("");
  const [insured, setInsured] = useState<"insured" | "uninsured">("uninsured");
  const [need, setNeed] = useState(NEEDS[0]);
  const [otherNeed, setOtherNeed] = useState("");

  const valid = /^\d{5}$/.test(zip) && Number(household) > 0 && Number(income) >= 0;

  const submit = () => {
    if (!valid) return;
    const needText = need === OTHER ? otherNeed || "a procedure" : need;
    const formattedIncome = Number(income).toLocaleString("en-US");
    const message = `${zip}, family of ${household}, $${formattedIncome}, ${insured}, need ${needText}`;
    onSubmit(message);
  };

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className={labelClass}>Zip code</label>
          <input
            value={zip}
            onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
            placeholder="07018"
            inputMode="numeric"
            className={fieldClass}
          />
        </div>
        <div>
          <label className={labelClass}>Household size</label>
          <input
            value={household}
            onChange={(e) => setHousehold(e.target.value.replace(/\D/g, ""))}
            placeholder="4"
            inputMode="numeric"
            className={fieldClass}
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Annual household income</label>
        <input
          value={income}
          onChange={(e) => setIncome(e.target.value.replace(/\D/g, ""))}
          placeholder="52000"
          inputMode="numeric"
          className={fieldClass}
        />
      </div>

      <div>
        <label className={labelClass}>Insurance</label>
        <div className="flex gap-2">
          {(["uninsured", "insured"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setInsured(v)}
              className={`flex-1 rounded-xl px-3 py-2 text-sm capitalize border transition-colors ${
                insured === v
                  ? "bg-white/90 text-ink-950 border-white/90"
                  : "bg-white/5 text-white/70 border-white/10"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={labelClass}>What do you need?</label>
        <select value={need} onChange={(e) => setNeed(e.target.value)} className={fieldClass}>
          {NEEDS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value={OTHER}>Something else...</option>
        </select>
        {need === OTHER && (
          <input
            value={otherNeed}
            onChange={(e) => setOtherNeed(e.target.value)}
            placeholder="Describe what you need"
            className={`${fieldClass} mt-2`}
          />
        )}
      </div>

      <button
        onClick={submit}
        disabled={!valid}
        className="w-full rounded-xl bg-white/90 text-ink-950 text-sm font-medium px-4 py-2.5 hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Find my options
      </button>
    </div>
  );
}
