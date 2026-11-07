import { AnimatePresence, motion } from "framer-motion";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatMessage } from "../hooks/useCareMap";
import type { QuickQuestion } from "../lib/quickAnswers";
import { ArrowUpIcon, ChevronLeftIcon, SparkleIcon } from "./icons";
import { chip, chipOff, iconButton } from "./ui";

// Lightweight markdown: **bold** inline, "- " lines as bullet lists, blank
// lines as paragraph breaks -- the subset ORCHESTRATOR_PROMPT asks for.
function renderInline(text: string, keyPrefix: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p.length > 0);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${keyPrefix}-${i}`} className="font-semibold text-white">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>
    ),
  );
}

export function renderMessageText(text: string): ReactNode {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, bi) => {
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    const isList = lines.length > 0 && lines.every((l) => /^[-*]\s/.test(l.trim()));
    if (isList) {
      return (
        <ul key={bi} className={`list-disc space-y-1 pl-4 marker:text-white/30 ${bi > 0 ? "mt-2" : ""}`}>
          {lines.map((l, li) => (
            <li key={li}>{renderInline(l.trim().replace(/^[-*]\s/, ""), `${bi}-${li}`)}</li>
          ))}
        </ul>
      );
    }
    const heading = lines.length === 1 && /^#{1,4}\s/.test(lines[0]);
    return (
      <p key={bi} className={`${bi > 0 ? "mt-2" : ""} ${heading ? "font-semibold text-white" : ""}`}>
        {lines.map((l, li) => (
          <Fragment key={li}>
            {renderInline(l.replace(/^#{1,4}\s/, ""), `${bi}-${li}`)}
            {li < lines.length - 1 && <br />}
          </Fragment>
        ))}
      </p>
    );
  });
}

interface AskBarProps {
  onSend: (text: string) => void;
  onQuick: (q: QuickQuestion) => void;
  onFocus?: () => void;
  suggestions: QuickQuestion[];
  /** Phones keep the results view short: suggestions show in the chat view. */
  hideSuggestionsOnPhone?: boolean;
  loading: boolean;
}

/** The always-visible question box, with a few questions worth asking for
 * what's on screen right now. */
export function AskBar({ onSend, onQuick, onFocus, suggestions, hideSuggestionsOnPhone }: AskBarProps) {
  const [draft, setDraft] = useState("");
  const submit = (text = draft) => {
    if (!text.trim()) return;
    onSend(text.trim());
    setDraft("");
  };

  return (
    <div className="space-y-2">
      {suggestions.length > 0 && (
        <div className={`-mx-4 gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] ${hideSuggestionsOnPhone ? "hidden sm:flex" : "flex"}`}>
          {suggestions.map((q) => (
            <button key={q.label} type="button" onClick={() => onQuick(q)} className={`${chip} ${chipOff}`}>
              {q.label}
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <SparkleIcon size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/50" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={onFocus}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Ask CareMap anything"
          aria-label="Ask CareMap"
          className="h-11 w-full rounded-full bg-white/[0.08] pl-10 pr-12 text-[15px] text-white placeholder:text-white/50 outline-none transition-[background-color,box-shadow] duration-150 focus:bg-white/[0.12] focus:ring-1 focus:ring-white/20"
        />
        <button
          type="button"
          onClick={() => submit()}
          disabled={!draft.trim()}
          aria-label="Send"
          className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black transition-[opacity,transform] duration-150 active:scale-[0.92] disabled:opacity-25"
        >
          <ArrowUpIcon size={16} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

interface ConversationProps {
  messages: ChatMessage[];
  loading: boolean;
  onBack: () => void;
}

export function Conversation({ messages, loading, onBack }: ConversationProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, loading]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 pb-2">
        <button type="button" onClick={onBack} className={`${iconButton} -ml-2 w-auto gap-0.5 px-2 text-[15px] text-white/80`}>
          <ChevronLeftIcon size={18} />
          Results
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pb-2 pr-1">
        {messages.length === 0 && (
          <p className="px-1 pt-2 text-[14px] leading-relaxed text-white/50">
            Ask about costs, a hospital, or how to apply for financial help. CareMap already knows what you entered, so there's no need to repeat it.
          </p>
        )}
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
              className={`max-w-[88%] rounded-[18px] px-3.5 py-2.5 text-[14px] leading-relaxed ${
                m.role === "user" ? "ml-auto bg-white text-black" : "bg-white/[0.07] text-white/85"
              }`}
            >
              {m.role === "user" ? m.text : renderMessageText(m.text)}
            </motion.div>
          ))}
        </AnimatePresence>
        {loading && (
          <div className="flex items-center gap-2 px-1 py-1 text-[13px] text-white/45" role="status">
            <span className="flex items-center gap-1">
              <span className="caremap-typing-dot" />
              <span className="caremap-typing-dot" />
              <span className="caremap-typing-dot" />
            </span>
            Checking hospital data, usually 10 to 20 seconds
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
