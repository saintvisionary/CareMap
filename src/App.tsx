import { MotionConfig } from "framer-motion";
import { useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { GlassPanel } from "./components/GlassPanel";
import { GuidedForm } from "./components/GuidedForm";
import { MapView } from "./components/MapView";
import { ResultCard } from "./components/ResultCard";
import { useCareMap } from "./hooks/useCareMap";
import { useCareMapData } from "./hooks/useCareMapData";
import { parseNeed } from "./lib/intake";

type Mode = "guided" | "chat";

export default function App() {
  const { facilities: allFacilities, zipCentroids, loading: dataLoading, error } = useCareMapData();
  const { messages, facilities, internationalFacilities, tierPct, insuranceType, flyTo, loading, sendMessage } = useCareMap(allFacilities, zipCentroids);
  const [activeCcn, setActiveCcn] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("guided");

  const handleGuidedSubmit = (message: string) => {
    sendMessage(message);
    setMode("chat");
  };

  const lastUserMessage =
    messages
      .slice()
      .reverse()
      .find((m) => m.role === "user")?.text ?? null;
  const need = lastUserMessage ? parseNeed(lastUserMessage) : null;

  return (
    <MotionConfig reducedMotion="user">
    <div className="h-screen w-screen bg-ink-950 text-white font-sans overflow-hidden relative">
      <MapView
        facilities={facilities}
        internationalFacilities={internationalFacilities}
        tierPct={tierPct}
        insuranceType={insuranceType}
        flyTo={flyTo}
        activeCcn={activeCcn}
        onSelectFacility={setActiveCcn}
      />

      <header className="absolute top-0 left-0 right-0 p-4 sm:p-6 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          <span className="text-lg font-semibold tracking-tight">CareMap</span>
          <span className="text-xs text-white/40">find affordable care near you</span>
        </div>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </header>

      <div className="absolute inset-x-0 bottom-0 sm:bottom-6 sm:left-6 sm:right-auto sm:w-[380px] p-4 sm:p-0 flex flex-col gap-3 max-h-[70vh] sm:max-h-[80vh]">
        {/* Only shown in Chat view -- with the guided form's own fields also
            competing for space in this same bottom-anchored column, showing
            both at once left old results clipped to a sliver while editing
            a new query. The form resets to Chat on submit, so results still
            appear right where you'd expect them. */}
        {mode === "chat" && facilities.length > 0 && (
          <div className="overflow-y-auto space-y-3 pr-1">
            {facilities.slice(0, 5).map((f, i) => (
              <ResultCard
                key={f.ccn}
                facility={f}
                tierPct={tierPct}
                insuranceType={insuranceType}
                need={need}
                index={i}
                active={f.ccn === activeCcn}
                onSelect={() => setActiveCcn(f.ccn)}
              />
            ))}
          </div>
        )}
        <div className="flex gap-1.5">
          {(["guided", "chat"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
                mode === m ? "bg-white/90 text-ink-950" : "bg-white/10 text-white/50"
              }`}
            >
              {m === "guided" ? "Fill in details" : "Chat"}
            </button>
          ))}
        </div>

        {mode === "guided" ? (
          <GlassPanel className="p-4 overflow-y-auto">
            <GuidedForm onSubmit={handleGuidedSubmit} zipCentroids={zipCentroids} facilities={allFacilities} />
          </GlassPanel>
        ) : (
          <div className="h-64 sm:h-80">
            <ChatPanel messages={messages} loading={loading || dataLoading} onSend={sendMessage} />
          </div>
        )}
      </div>
    </div>
    </MotionConfig>
  );
}
