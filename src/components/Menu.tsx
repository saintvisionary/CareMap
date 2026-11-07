import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import { ChevronDownIcon, ChevronLeftIcon, SearchIcon } from "./icons";

export interface MenuOption {
  value: string;
  label: string;
  detail?: string;
}
export interface MenuGroup {
  label: string;
  options: MenuOption[];
}

interface MenuProps {
  /** The chosen value, or "" for none. */
  value: string;
  onChange: (value: string) => void;
  /** A flat list, or groups that open as nested menus. */
  options?: MenuOption[];
  groups?: MenuGroup[];
  placeholder?: string;
  ariaLabel: string;
  /** Show a search box (useful for long nested lists). */
  searchable?: boolean;
  /** "field" is a full-width form control; "pill" is a compact header button. */
  variant?: "field" | "pill";
  className?: string;
}

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5 10 17l9-10" />
  </svg>
);
const ChevronRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

/** CareMap's own dropdown: a glass panel instead of the system menu, with
 * nested groups (tap a group, Back to return), optional search, a check on
 * the current choice, and full keyboard support. */
export function Menu({ value, onChange, options, groups, placeholder, ariaLabel, searchable, variant = "field", className = "" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const all = useMemo(() => options ?? groups?.flatMap((g) => g.options) ?? [], [options, groups]);
  const selected = all.find((o) => o.value === value);

  // What the panel shows now: search matches, a group's items, the group
  // list, or the flat options.
  type Row = { kind: "option"; option: MenuOption } | { kind: "group"; index: number; label: string; count: number };
  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) return all.filter((o) => o.label.toLowerCase().includes(q)).map((option) => ({ kind: "option" as const, option }));
    if (groups && group == null) return groups.map((g, index) => ({ kind: "group" as const, index, label: g.label, count: g.options.length }));
    const list = groups && group != null ? groups[group].options : (options ?? []);
    return list.map((option) => ({ kind: "option" as const, option }));
  }, [query, all, groups, group, options]);

  // Close on a tap outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Opening starts at the chosen item's group, so it's one tap to change.
  const show = () => {
    const g = groups?.findIndex((gr) => gr.options.some((o) => o.value === value)) ?? -1;
    setGroup(groups && g >= 0 ? g : null);
    setQuery("");
    setActive(0);
    setOpen(true);
  };
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  const choose = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === "group") {
      setGroup(row.index);
      setActive(0);
    } else pick(row.option.value);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (group != null && !query) setGroup(null);
      else setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(rows[active]);
    } else if (e.key === "ArrowLeft" && group != null && !query) {
      setGroup(null);
    }
  };

  const button =
    variant === "pill"
      ? "h-9 rounded-full bg-white/[0.08] pl-3 pr-2 text-[13px] font-medium text-white/85 hover:bg-white/[0.14]"
      : "h-11 w-full rounded-xl bg-white/[0.08] pl-3.5 pr-3 text-[15px] text-white hover:bg-white/[0.11]";

  return (
    <div ref={rootRef} className={`relative ${className}`} onKeyDown={onKey}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : show())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        className={`flex items-center justify-between gap-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/40 ${button} ${open ? "bg-white/[0.14]" : ""}`}
      >
        <span className={`truncate ${selected ? "" : "text-white/55"}`}>{selected?.label ?? placeholder ?? ""}</span>
        <ChevronDownIcon size={variant === "pill" ? 14 : 16} className={`shrink-0 text-white/55 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            style={{ transformOrigin: "top" }}
            className={`absolute z-40 mt-1.5 overflow-hidden rounded-2xl border border-white/[0.1] bg-[#222c44]/95 shadow-2xl shadow-black/60 backdrop-blur-2xl ${
              variant === "pill" ? "right-0 min-w-[180px]" : "left-0 right-0"
            }`}
          >
            {searchable && (
              <div className="relative border-b border-white/[0.08] p-2">
                <SearchIcon size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/50" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  placeholder={t("Search")}
                  aria-label={t("Search")}
                  className="h-9 w-full rounded-lg bg-white/[0.08] pl-8 pr-2 text-[14px] text-white placeholder:text-white/50 outline-none"
                />
              </div>
            )}
            {groups && group != null && !query && (
              <button
                type="button"
                onClick={() => setGroup(null)}
                className="flex w-full items-center gap-1 border-b border-white/[0.08] px-3 py-2.5 text-left text-[14px] font-semibold text-white"
              >
                <ChevronLeftIcon size={17} className="text-white/60" />
                {groups[group].label}
              </button>
            )}
            <ul id={listId} role="listbox" aria-label={ariaLabel} className="max-h-72 overflow-y-auto p-1.5">
              <AnimatePresence initial={false} mode="popLayout">
                {rows.map((row, i) => {
                  const on = row.kind === "option" && row.option.value === value;
                  return (
                    <motion.li
                      key={row.kind === "group" ? `g${row.index}` : `${group}-${row.option.value}`}
                      initial={{ opacity: 0, x: group != null ? 12 : -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.14 }}
                      role={row.kind === "option" ? "option" : "presentation"}
                      aria-selected={row.kind === "option" ? on : undefined}
                    >
                      <button
                        type="button"
                        onMouseEnter={() => setActive(i)}
                        onClick={() => choose(row)}
                        className={`flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[15px] transition-colors ${
                          i === active ? "bg-white/[0.1]" : ""
                        } ${on ? "text-white" : "text-white/85"}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate ${on ? "font-semibold" : ""}`}>{row.kind === "group" ? row.label : row.option.label}</span>
                          {row.kind === "option" && row.option.detail && <span className="block truncate text-[12px] text-white/50">{row.option.detail}</span>}
                        </span>
                        {row.kind === "group" ? (
                          <span className="flex shrink-0 items-center gap-1 text-[12px] text-white/50">
                            {row.count}
                            <ChevronRight />
                          </span>
                        ) : (
                          on && (
                            <span className="shrink-0 text-[#30d158]">
                              <CheckIcon />
                            </span>
                          )
                        )}
                      </button>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
              {rows.length === 0 && <li className="px-3 py-3 text-[14px] text-white/55">{t("No matches")}</li>}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
