import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import type { Facility } from "./lib/types";
import { ChatPanel } from "./components/ChatPanel";
import { GlassPanel } from "./components/GlassPanel";
import { GuidedForm } from "./components/GuidedForm";
import { InfoPanel } from "./components/InfoPanel";
import { MapView } from "./components/MapView";
import { ResultCard } from "./components/ResultCard";
import { useCareMap } from "./hooks/useCareMap";
import { useCareMapData } from "./hooks/useCareMapData";
import { parseNeed } from "./lib/intake";

type Mode = "guided" | "chat";

export default function App() {
  const { facilities: allFacilities, zipCentroids, loading: dataLoading, error } = useCareMapData();
  const {
    messages,
    facilities,
    internationalFacilities,
    previewFacilities,
    tierPct,
    insuranceType,
    flyTo,
    loading,
    sendMessage,
    selectPreviewFacility,
  } = useCareMap(allFacilities, zipCentroids);
  const [activeCcn, setActiveCcn] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("guided");
  // Mobile only -- the panel is full-width there and can cover most of the
  // map on a result-heavy search. Desktop's narrow sidebar never needs this.
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const handleGuidedSubmit = (message: string) => {
    sendMessage(message);
    setMode("chat");
  };

  // Selecting a facility is supposed to show what's known about it -- but
  // the result-card list (the only place that detail renders) only shows
  // up in Chat mode. Clicking a marker while still in "Fill in details"
  // set the active id and rang the map's highlight, then visibly did
  // nothing else. Always surface the pick, regardless of which mode or
  // collapsed state the panel was already in.
  //
  // useCallback matters here, not just as tidiness: this function is a prop
  // MapView's marker-rebuild effect depends on. Without a stable reference,
  // every App re-render (a mode switch, the collapse toggle, anything)
  // handed MapView a "new" onSelectFacility, which tore down and recreated
  // every marker's DOM node -- and a click landing in that gap hit an
  // already-removed element with its listener gone, silently doing
  // nothing. Reproduced directly: a marker click right after switching to
  // "Fill in details" never fired its listener at all.
  const handleSelectFacility = useCallback((ccn: string) => {
    setActiveCcn(ccn);
    setMode("chat");
    setPanelCollapsed(false);
  }, []);

  // A preview marker (the national-sample fallback shown before any real
  // search -- see useCareMap) has no result card of its own; clicking one
  // runs a real search centered on it instead, so give that the same
  // "always surface something" treatment as a real marker click.
  const handleSelectPreviewFacility = useCallback(
    (facility: Facility) => {
      selectPreviewFacility(facility);
      setMode("chat");
      setPanelCollapsed(false);
    },
    [selectPreviewFacility],
  );

  const lastUserMessage =
    messages
      .slice()
      .reverse()
      .find((m) => m.role === "user")?.text ?? null;
  const need = lastUserMessage ? parseNeed(lastUserMessage) : null;

  // The map renders every facility it's given as a marker, with no cap --
  // clicking any of them (not just the closest few) must be able to show
  // that facility's card, or the click just silently highlights a marker
  // with nothing to show for it. Scroll the list to reveal it instead of
  // requiring the user to find it by hand.
  useEffect(() => {
    if (!activeCcn) return;
    document.getElementById(`result-card-${activeCcn}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeCcn]);

  return (
    <MotionConfig reducedMotion="user">
    <div className="h-screen w-screen bg-ink-950 text-white font-sans overflow-hidden relative">
      <MapView
        facilities={facilities}
        internationalFacilities={internationalFacilities}
        previewFacilities={previewFacilities}
        tierPct={tierPct}
        insuranceType={insuranceType}
        flyTo={flyTo}
        activeCcn={activeCcn}
        onSelectFacility={handleSelectFacility}
        onSelectPreviewFacility={handleSelectPreviewFacility}
      />

      <header className="absolute top-0 left-0 right-0 p-4 sm:p-6 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          <span className="text-lg font-semibold tracking-tight">CareMap</span>
          <span className="text-xs text-white/40 hidden sm:inline">find affordable care near you</span>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          {error && <span className="text-xs text-red-400">{error}</span>}
          <button
            onClick={() => setInfoOpen(true)}
            aria-label="How to read CareMap"
            className="flex items-center gap-1.5 rounded-full bg-white/15 border border-white/25 pl-2 pr-3 py-1.5 text-xs font-medium text-white shadow-lg shadow-black/30 transition-[background-color,transform] duration-150 active:scale-95 hover:bg-white/25"
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-bold text-ink-950">i</span>
            Info
          </button>
        </div>
      </header>

      <InfoPanel open={infoOpen} onClose={() => setInfoOpen(false)} />

      <div className="absolute inset-x-0 bottom-0 sm:bottom-6 sm:left-6 sm:right-auto sm:w-[380px] p-4 sm:p-0 flex flex-col gap-3 max-h-[70vh] sm:max-h-[80vh] z-10">
        {/* Mobile only -- the panel is full-width there and a result-heavy
            search can cover most of the map. Desktop's narrow 380px sidebar
            never needs this, so the handle itself is hidden there and
            panelCollapsed has no other way to become true. */}
        <button
          onClick={() => setPanelCollapsed((c) => !c)}
          className="sm:hidden mx-auto flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-1.5 text-[11px] font-medium text-white/60 transition-transform active:scale-[0.96]"
        >
          <span className={`inline-block transition-transform duration-200 ${panelCollapsed ? "rotate-180" : ""}`}>▾</span>
          {panelCollapsed ? "Show details" : "Show map"}
        </button>

        <AnimatePresence initial={false}>
          {!panelCollapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="min-h-0 flex flex-col gap-3 overflow-hidden"
            >
              {/* Only shown in Chat view -- with the guided form's own fields
                  also competing for space in this same column, showing both
                  at once left old results clipped to a sliver while editing
                  a new query. The form resets to Chat on submit, so results
                  still appear right where you'd expect them. */}
              {mode === "chat" && facilities.length > 0 && (
                <div className="min-h-0 overflow-y-auto space-y-3 pr-1">
                  {facilities.map((f, i) => (
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
                <GlassPanel className="min-h-0 p-4 overflow-y-auto">
                  <GuidedForm onSubmit={handleGuidedSubmit} zipCentroids={zipCentroids} facilities={allFacilities} />
                </GlassPanel>
              ) : (
                <div className="h-64 sm:h-80">
                  <ChatPanel messages={messages} loading={loading || dataLoading} onSend={sendMessage} />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
    </MotionConfig>
  );
}
