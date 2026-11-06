import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

export interface Suggestion {
  value: string;
  label: string;
  /** Second line, e.g. the ZIP code under a city name. */
  detail?: string;
}

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  /** A suggestion was picked (click, or Enter on the highlighted one). */
  onPick?: (s: Suggestion) => void;
  fetchSuggestions: (query: string) => Promise<Suggestion[]>;
  placeholder?: string;
  className?: string;
  inputMode?: "text" | "numeric";
  ariaLabel?: string;
  debounceMs?: number;
}

/** A controlled text input with a debounced suggestion list. Arrow keys move
 * through suggestions and Enter picks the highlighted one (the first by
 * default), so typing a city and pressing Enter just works. */
export function AutocompleteInput({
  value,
  onChange,
  onPick,
  fetchSuggestions,
  placeholder,
  className,
  inputMode,
  ariaLabel,
  debounceMs = 120,
}: AutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      fetchSuggestions(value).then((results) => {
        // Drop a stale response that resolved after a newer keystroke's.
        if (requestId === requestIdRef.current) {
          setSuggestions(results);
          setHighlight(0);
        }
      });
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // fetchSuggestions is expected to be referentially stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, debounceMs]);

  const select = (s: Suggestion) => {
    onChange(s.value);
    onPick?.(s);
    setSuggestions([]);
    setOpen(false);
  };

  // Nothing to suggest once the box already holds the only match.
  const showing = open && suggestions.length > 0 && !(suggestions.length === 1 && suggestions[0].value === value);

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
        onKeyDown={(e) => {
          if (!showing) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            select(suggestions[highlight]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        inputMode={inputMode}
        aria-label={ariaLabel}
        className={className}
        autoComplete="off"
        spellCheck={false}
      />
      <AnimatePresence>
        {showing && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
            role="listbox"
            className="absolute z-30 mt-1.5 w-full max-h-64 overflow-y-auto rounded-xl border border-white/[0.08] bg-[#263049]/95 p-1 shadow-2xl shadow-black/60 backdrop-blur-2xl"
          >
            {suggestions.map((s, i) => (
              <li key={`${s.value}-${i}`} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => select(s)}
                  className={`flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors ${i === highlight ? "bg-white/[0.12]" : ""}`}
                >
                  <span className="text-[14px] text-white">{s.label}</span>
                  {s.detail && <span className="text-[12px] text-white/45">{s.detail}</span>}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
