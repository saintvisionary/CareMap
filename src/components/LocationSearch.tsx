import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";
import { AutocompleteInput } from "./AutocompleteInput";
import { CloseIcon, LocationIcon, SearchIcon } from "./icons";
import { iconButton } from "./ui";
import { suggestPlaces } from "../lib/international";
import type { Facility, ZipCentroid } from "../lib/types";
import { suggestZips } from "../lib/zipSuggest";

interface LocationSearchProps {
  zip: string;
  onZip: (zip: string) => void;
  zipCentroids: Record<string, ZipCentroid>;
  facilities: Facility[];
  onLocate: () => void;
  locating: boolean;
  /** No longer shown: a blocked location just moves the cursor to the ZIP box. */
  locationError?: string | null;
  usingLocation: boolean;
  abroad: boolean;
  onDestination: (place: string) => void;
}

const fieldClass =
  "h-11 w-full rounded-xl bg-white/[0.08] pl-10 pr-20 text-[15px] text-white placeholder:text-white/50 outline-none transition-[background-color,box-shadow] duration-150 focus:bg-white/[0.12] focus:ring-1 focus:ring-white/20";

export function LocationSearch({
  zip,
  onZip,
  zipCentroids,
  facilities,
  onLocate,
  locating,
  usingLocation,
  abroad,
  onDestination,
}: LocationSearchProps) {
  // What's in the box: the ZIP, or a city name being typed. Only a real
  // ZIP is passed up, so results never flash for half-typed text.
  const [text, setText] = useState(zip);
  const [place, setPlace] = useState("");
  useEffect(() => {
    setText(zip === "US" ? "United States" : zip);
  }, [zip]);

  // "United States" (or USA, America) offers the whole-country list first.
  const fetchZips = useCallback(
    async (q: string) => {
      const t = q.trim().toLowerCase();
      const whole =
        t.length >= 2 && ["united states", "usa", "u.s.", "america", "united states of america"].some((n) => n.startsWith(t) || t === n)
          ? [{ value: "US", label: "United States", detail: "Every hospital in the country" }]
          : [];
      return [...whole, ...(await suggestZips(q, zipCentroids, facilities))];
    },
    [zipCentroids, facilities],
  );
  const fetchPlaces = useCallback((q: string) => suggestPlaces(q), []);

  const changeText = (v: string) => {
    const next = /[a-zA-Z]/.test(v) ? v : v.replace(/\D/g, "").slice(0, 5);
    setText(next);
    if (/^\d{5}$/.test(next)) onZip(next);
  };

  return (
    <div>
      <div className="caremap-search">
        <span className="caremap-beam" aria-hidden="true" />
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-white/45" />
        {abroad ? (
          <AutocompleteInput
            value={place}
            onChange={setPlace}
            onPick={(s) => onDestination(s.value)}
            fetchSuggestions={fetchPlaces}
            placeholder={t("City and country")}
            ariaLabel={t("City and country")}
            className={fieldClass}
            debounceMs={300}
          />
        ) : (
          <AutocompleteInput
            value={text}
            onChange={changeText}
            onPick={(s) => onZip(s.value)}
            fetchSuggestions={fetchZips}
            placeholder={t("ZIP code or city")}
            ariaLabel="ZIP code or city"
            className={fieldClass}
          />
        )}
        <div className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center">
          {(abroad ? place : text) && (
            <button
              type="button"
              aria-label={t("Clear")}
              onClick={() => (abroad ? setPlace("") : (setText(""), onZip("")))}
              className={`${iconButton} h-8 w-8`}
            >
              <CloseIcon size={15} />
            </button>
          )}
          {!abroad && (
            <button
              type="button"
              onClick={onLocate}
              disabled={locating}
              aria-label={t("Use my location")}
              title={t("Use my location")}
              className={`${iconButton} h-8 w-8 ${usingLocation ? "text-[#30d158]" : ""}`}
            >
              <LocationIcon size={15} className={locating ? "animate-pulse" : ""} fill={usingLocation ? "currentColor" : "none"} />
            </button>
          )}
        </div>
      </div>
      {(abroad || usingLocation) && (
        <p className={`mt-1.5 flex items-center gap-1 px-1 text-[12px] ${usingLocation && !abroad ? "text-[#30d158]" : "text-white/45"}`}>
          {usingLocation && !abroad && <LocationIcon size={11} fill="currentColor" />}
          {abroad ? t("Locations only, no prices outside the US") : t("Using your location")}
        </p>
      )}
    </div>
  );
}
