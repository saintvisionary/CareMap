import { AnimatePresence, motion } from "framer-motion";
import { Fragment, useState, type ReactNode } from "react";
import type { ChatMessage } from "../hooks/useCareMap";
import { GlassPanel } from "./GlassPanel";

interface ChatPanelProps {
  messages: ChatMessage[];
  loading: boolean;
  onSend: (text: string) => void;
}

// Lightweight markdown: **bold** inline, "- " lines as bullet lists, blank
// lines as paragraph breaks. Agent replies come back as markdown (bold
// labels, bulleted facts -- see ORCHESTRATOR_PROMPT); rendering them as a
// single plain-text blob left literal "**" asterisks and run-on sentences
// on screen. Not a full markdown parser -- just the subset the prompt
// actually asks the model to use.
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

function renderMessageText(text: string): ReactNode {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, bi) => {
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    const isList = lines.length > 0 && lines.every((l) => /^[-*]\s/.test(l.trim()));
    if (isList) {
      return (
        <ul key={bi} className={`list-disc pl-4 space-y-1 ${bi > 0 ? "mt-2" : ""}`}>
          {lines.map((l, li) => (
            <li key={li}>{renderInline(l.trim().replace(/^[-*]\s/, ""), `${bi}-${li}`)}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={bi} className={bi > 0 ? "mt-2" : ""}>
        {lines.map((l, li) => (
          <Fragment key={li}>
            {renderInline(l, `${bi}-${li}`)}
            {li < lines.length - 1 && <br />}
          </Fragment>
        ))}
      </p>
    );
  });
}

export function ChatPanel({ messages, loading, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    if (!draft.trim()) return;
    onSend(draft);
    setDraft("");
  };

  return (
    <GlassPanel className="flex flex-col p-3 h-full">
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 24 }}
              className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-snug ${
                m.role === "user"
                  ? "ml-auto bg-white/15 text-white"
                  : "bg-white/5 text-white/80 border border-white/10"
              }`}
            >
              {renderMessageText(m.text)}
            </motion.div>
          ))}
        </AnimatePresence>
        {loading && <div className="text-xs text-white/40 px-1">thinking...</div>}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder='e.g. "07018, family of 4, $52k, uninsured, need gallbladder surgery"'
          className="flex-1 rounded-full bg-white/10 border border-white/10 px-4 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/30"
        />
        <button
          onClick={submit}
          className="rounded-full bg-white/90 text-ink-950 text-sm font-medium px-4 py-2 hover:bg-white transition-colors"
        >
          Send
        </button>
      </div>
    </GlassPanel>
  );
}
