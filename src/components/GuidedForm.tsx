import { useCallback, useState } from "react";
import { AutocompleteInput } from "./AutocompleteInput";
import { NEED_CATEGORIES } from "../lib/drg";
import { nearestZip } from "../lib/geo";
import { INSURANCE_LABELS } from "../lib/insurance";
import type { InsuranceType } from "../lib/intake";
import { suggestPlaces } from "../lib/international";
import type { Facility, ZipCentroid } from "../lib/types";
import { suggestZips } from "../lib/zipSuggest";

interface GuidedFormProps {
  onSubmit: (message: string) => void;
  zipCentroids: Record<string, ZipCentroid>;
  facilities: Facility[];
}

// Phrases chosen to match src/lib/intake.ts's parser exactly (and its
// Python mirror, caremap/intake.py) -- see INSURANCE_PATTERNS there.
const INSURANCE_PHRASES: Record<InsuranceType, string> = {
  uninsured: "uninsured",
  medicaid: "medicaid",
  medicare: "medicare",
  private: "private insurance",
  va_tricare: "VA insurance",
  unsure: "not sure about insurance",
};
const INSURANCE_TYPES = Object.keys(INSURANCE_LABELS) as InsuranceType[];

const fieldClass =
  "w-full rounded-xl bg-white/10 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/30";
const labelClass = "text-[11px] uppercase tracking-wide text-white/40 mb-1 block";

export function GuidedForm({ onSubmit, zipCentroids, facilities }: GuidedFormProps) {
  const [abroad, setAbroad] = useState(false);
  const [destination, setDestination] = useState("");
  const [zip, setZip] = useState("");
  const [household, setHousehold] = useState("4");
  const [income, setIncome] = useState("");
  const [insuranceType, setInsuranceType] = useState<InsuranceType>("uninsured");
  const [veteran, setVeteran] = useState(false);
  // Nothing is preselected: defaulting to the first category's first item
  // sent every untouched search as "need heart attack".
  const [category, setCategory] = useState("");
  const [item, setItem] = useState("");
  const [otherNeed, setOtherNeed] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const categoryDef = NEED_CATEGORIES.find((c) => c.category === category);
  const valid = abroad ? destination.trim().length > 1 : /^\d{5}$/.test(zip) && Number(household) > 0 && Number(income) >= 0;

  const fetchZipSuggestions = useCallback((q: string) => suggestZips(q, zipCentroids, facilities), [zipCentroids, facilities]);
  const fetchPlaceSuggestions = useCallback((q: string) => suggestPlaces(q), []);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("Location isn't available in this browser.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const found = nearestZip(pos.coords.latitude, pos.coords.longitude, zipCentroids);
        if (found) setZip(found);
        else setLocationError("Couldn't match your location to a zip code.");
        setLocating(false);
      },
      (err) => {
        setLocationError(err.code === err.PERMISSION_DENIED ? "Location permission denied." : "Couldn't get your location.");
        setLocating(false);
      },
      { timeout: 10000, maximumAge: 300000 },
    );
  };

  const submit = () => {
    if (!valid) return;
    if (abroad) {
      onSubmit(`traveling to ${destination.trim()}`);
      return;
    }
    const needText = !categoryDef ? "" : categoryDef.items.length > 0 ? item : otherNeed.trim();
    const formattedIncome = Number(income).toLocaleString("en-US");
    const parts = [
      zip,
      `family of ${household}`,
      `$${formattedIncome}`,
      INSURANCE_PHRASES[insuranceType],
      ...(veteran ? ["veteran"] : []),
      ...(needText ? [`need ${needText}`] : []),
    ];
    onSubmit(parts.join(", "));
  };

  return (
    <div className="space-y-2.5">
      <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={abroad}
          onChange={(e) => setAbroad(e.target.checked)}
          className="h-4 w-4 rounded border-white/20 bg-white/10 accent-sky-400"
        />
        I'm traveling outside the US
      </label>

      {abroad ? (
        <>
          <div>
            <label className={labelClass}>City, country</label>
            <AutocompleteInput
              value={destination}
              onChange={setDestination}
              fetchSuggestions={fetchPlaceSuggestions}
              placeholder="Cancun, Mexico"
              className={fieldClass}
            />
          </div>
          <p className="text-[11px] text-white/40">
            Shows nearby hospital & clinic locations (OpenStreetMap). No cost estimate is available outside the US.
          </p>
        </>
      ) : (
        <>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className={labelClass}>City or zip code</label>
          <div className="flex gap-1.5">
            <div className="flex-1">
              <AutocompleteInput
                value={zip}
                onChange={(v) => setZip(/[a-zA-Z]/.test(v) ? v : v.replace(/\D/g, "").slice(0, 5))}
                fetchSuggestions={fetchZipSuggestions}
                placeholder="07018 or city name"
                className={fieldClass}
              />
            </div>
            <button
              type="button"
              onClick={useMyLocation}
              disabled={locating}
              title="Use my location"
              className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-2.5 text-sm text-white/70 hover:bg-white/10 transition-[background-color,transform] duration-150 active:scale-[0.94] disabled:opacity-40 disabled:active:scale-100"
            >
              {locating ? "..." : "📍"}
            </button>
          </div>
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
      {locationError && <p className="text-[11px] text-red-400">{locationError}</p>}

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
        <select
          value={insuranceType}
          onChange={(e) => setInsuranceType(e.target.value as InsuranceType)}
          className={fieldClass}
        >
          {INSURANCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {INSURANCE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={veteran}
          onChange={(e) => setVeteran(e.target.checked)}
          className="h-4 w-4 rounded border-white/20 bg-white/10 accent-sky-400"
        />
        I'm a veteran (we'll flag nearby VA facilities)
      </label>

      <div>
        <label className={labelClass}>What do you need?</label>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setItem("");
          }}
          className={fieldClass}
        >
          <option value="">Just looking, or not sure yet</option>
          {NEED_CATEGORIES.map((c) => (
            <option key={c.category} value={c.category}>
              {c.category}
            </option>
          ))}
        </select>
        {!categoryDef ? null : categoryDef.items.length > 0 ? (
          <select value={item} onChange={(e) => setItem(e.target.value)} className={`${fieldClass} mt-2`}>
            <option value="">Choose a specific need (optional)</option>
            {categoryDef.items.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={otherNeed}
            onChange={(e) => setOtherNeed(e.target.value)}
            placeholder="Describe what you need (no cost estimate yet, facility search only)"
            className={`${fieldClass} mt-2`}
          />
        )}
      </div>
        </>
      )}

      <button
        onClick={submit}
        disabled={!valid}
        className="w-full rounded-xl bg-white/90 text-ink-950 text-sm font-medium px-4 py-2.5 hover:bg-white transition-[background-color,transform] duration-150 active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100"
      >
        {abroad ? "Find hospitals & clinics" : "Find my options"}
      </button>
    </div>
  );
}
