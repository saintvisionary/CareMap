import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

export interface Suggestion {
  value: string;
  label: string;
}

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  fetchSuggestions: (query: string) => Promise<Suggestion[]>;
  placeholder?: string;
  className?: string;
  inputMode?: "text" | "numeric";
  debounceMs?: number;
}

/** A plain controlled text input with a debounced suggestion dropdown.
 * Picking a suggestion is always optional -- typed free text still works
 * exactly as before (onChange fires on every keystroke regardless), this
 * just helps avoid typos/misspellings by offering real, known-good values
 * to pick from instead. fetchSuggestions can be local/sync-wrapped-in-a-
 * promise (zero network, e.g. zip codes) or a real network call (e.g.
 * place names) -- this component doesn't care which. */
export function AutocompleteInput({
  value,
  onChange,
  fetchSuggestions,
  placeholder,
  className,
  inputMode,
  debounceMs = 250,
}: AutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      fetchSuggestions(value).then((results) => {
        // Drop a stale response that resolved after a newer keystroke's
        // request -- otherwise a slow network suggestion call can overwrite
        // a faster one for what's now outdated input. Also guards against a
        // response that's just slow (Photon's free instance can take a few
        // seconds on an unusual query) landing after the user moved on.
        if (requestId === requestIdRef.current) setSuggestions(results);
      });
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // fetchSuggestions is expected to be referentially stable (a module-level
    // function or useCallback'd by the caller); only re-debounce on value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, debounceMs]);

  const select = (s: Suggestion) => {
    onChange(s.value);
    setSuggestions([]);
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        inputMode={inputMode}
        className={className}
        autoComplete="off"
      />
      <AnimatePresence>
        {open && suggestions.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
            style={{ transformOrigin: "top" }}
            className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-ink-950/95 backdrop-blur-xl shadow-lg"
          >
            {suggestions.map((s) => (
              <li key={s.value}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(s)}
                  className="w-full text-left px-3 py-1.5 text-xs text-white/80 transition-colors hover:bg-white/10 active:bg-white/15"
                >
                  {s.label}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
