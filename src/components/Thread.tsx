import { motion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatMessage } from "../hooks/useCareMap";
import type { FacilityWithDistance } from "../lib/geo";
import { renderMessageText } from "./Conversation";
import { LocationIcon, SparkleIcon } from "./icons";

interface ThreadProps {
  messages: ChatMessage[];
  loading: boolean;
  /** Renders a turn's places (the newest turn gets the live list). */
  renderResults: (facilities: FacilityWithDistance[], live: boolean) => ReactNode;
  renderAskIncome: (messageId: string) => ReactNode;
  renderAskLocation: () => ReactNode;
}

/** The conversation, like a chat app: each answer can carry the places it
 * found and inline cards asking for anything missing. */
export function Thread({ messages, loading, renderResults, renderAskIncome, renderAskLocation }: ThreadProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, loading]);

  const lastResults = messages.reduce((at, m, i) => (m.attachments?.some((a) => a.kind === "results") ? i : at), -1);

  return (
    <div className="space-y-4 pb-2">
      {messages.map((m, i) => (
        <motion.div
          key={m.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          className={m.role === "user" ? "flex justify-end" : "space-y-2.5"}
        >
          {m.role === "user" ? (
            <div className="max-w-[85%] rounded-[20px] rounded-br-md bg-white px-3.5 py-2 text-[15px] leading-snug text-black">{m.text}</div>
          ) : (
            <>
              {m.text && <AssistantText text={m.text} ai={m.source === "ai"} long={!!m.attachments?.length} />}
              {m.attachments?.map((a, ai) => (
                <div key={ai}>
                  {a.kind === "results" && renderResults(a.facilities, i === lastResults)}
                  {a.kind === "askIncome" && renderAskIncome(m.id)}
                  {a.kind === "askLocation" && renderAskLocation()}
                </div>
              ))}
            </>
          )}
        </motion.div>
      ))}
      {loading && (
        <div className="flex items-center gap-2 text-[13px] text-white/45" role="status">
          <SparkleIcon size={14} className="animate-pulse" />
          Looking into it, usually 10 to 20 seconds
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function AssistantText({ text, ai, long }: { text: string; ai: boolean; long: boolean }) {
  // A results turn's summary can run long; the cards carry the detail.
  const [open, setOpen] = useState(!long);
  return (
    <div className="text-[15px] leading-relaxed text-white/90">
      {ai && (
        <div className="mb-1 flex items-center gap-1 text-[12px] font-medium text-white/45">
          <SparkleIcon size={12} /> CareMap AI
        </div>
      )}
      <div className={open ? "" : "line-clamp-3"}>{renderMessageText(text)}</div>
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-0.5 text-[13px] font-medium text-white/55 hover:text-white">
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

export function Greeting({ place, starters, onStarter, onLocate, locating }: {
  place: string | null;
  starters: string[];
  onStarter: (text: string) => void;
  onLocate: () => void;
  locating: boolean;
}) {
  return (
    <div className="pt-2">
      <h2 className="text-[24px] font-semibold leading-tight tracking-tight">What's going on?</h2>
      <p className="mt-1.5 text-[15px] leading-relaxed text-white/60">
        Tell me what you need and where, like you'd tell a friend. I'll find care nearby and what you'd likely pay. Your income never leaves this device.
      </p>
      <div className="mt-4 space-y-2">
        {!place && (
          <button
            type="button"
            onClick={onLocate}
            disabled={locating}
            className="flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left text-[15px] font-medium text-black transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            <LocationIcon size={17} />
            {locating ? "Finding you…" : "Use my location"}
          </button>
        )}
        {starters.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onStarter(s)}
            className="block w-full rounded-2xl bg-white/[0.07] px-4 py-3 text-left text-[15px] text-white/90 transition-[background-color,transform] hover:bg-white/[0.11] active:scale-[0.98]"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
