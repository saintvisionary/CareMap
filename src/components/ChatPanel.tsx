import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import type { ChatMessage } from "../hooks/useCareMap";
import { GlassPanel } from "./GlassPanel";

interface ChatPanelProps {
  messages: ChatMessage[];
  loading: boolean;
  onSend: (text: string) => void;
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
              {m.text}
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
