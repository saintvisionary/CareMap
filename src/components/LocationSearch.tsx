import { useCallback, useEffect, useState } from "react";
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
  locationError: string | null;
  usingLocation: boolean;
  abroad: boolean;
  onDestination: (place: string) => void;
}

const fieldClass =
  "h-11 w-full rounded-xl bg-white/[0.08] pl-10 pr-20 text-[15px] text-white placeholder:text-white/40 outline-none transition-[background-color,box-shadow] duration-150 focus:bg-white/[0.12] focus:ring-1 focus:ring-white/20";

export function LocationSearch({
  zip,
  onZip,
  zipCentroids,
  facilities,
  onLocate,
  locating,
  locationError,
  usingLocation,
  abroad,
  onDestination,
}: LocationSearchProps) {
  // What's in the box: the ZIP, or a city name being typed. Only a real
  // ZIP is passed up, so results never flash for half-typed text.
  const [text, setText] = useState(zip);
  const [place, setPlace] = useState("");
  useEffect(() => {
    setText(zip);
  }, [zip]);

  const fetchZips = useCallback((q: string) => suggestZips(q, zipCentroids, facilities), [zipCentroids, facilities]);
  const fetchPlaces = useCallback((q: string) => suggestPlaces(q), []);

  const changeText = (v: string) => {
    const next = /[a-zA-Z]/.test(v) ? v : v.replace(/\D/g, "").slice(0, 5);
    setText(next);
    if (/^\d{5}$/.test(next)) onZip(next);
  };

  return (
    <div>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-white/45" />
        {abroad ? (
          <AutocompleteInput
            value={place}
            onChange={setPlace}
            onPick={(s) => onDestination(s.value)}
            fetchSuggestions={fetchPlaces}
            placeholder="City and country"
            ariaLabel="City and country"
            className={fieldClass}
            debounceMs={300}
          />
        ) : (
          <AutocompleteInput
            value={text}
            onChange={changeText}
            onPick={(s) => onZip(s.value)}
            fetchSuggestions={fetchZips}
            placeholder="ZIP code or city"
            ariaLabel="ZIP code or city"
            className={fieldClass}
          />
        )}
        <div className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center">
          {(abroad ? place : text) && (
            <button
              type="button"
              aria-label="Clear"
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
              aria-label="Use my location"
              title="Use my location"
              className={`${iconButton} h-8 w-8 ${usingLocation ? "text-white" : ""}`}
            >
              <LocationIcon size={15} className={locating ? "animate-pulse" : ""} fill={usingLocation ? "currentColor" : "none"} />
            </button>
          )}
        </div>
      </div>
      {(locationError || abroad || usingLocation) && (
        <p className={`mt-1.5 px-1 text-[12px] ${locationError ? "text-[#ff6961]" : "text-white/45"}`}>
          {locationError ?? (abroad ? "Locations only, no prices outside the US" : "Using your location")}
        </p>
      )}
    </div>
  );
}
