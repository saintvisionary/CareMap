import { MotionConfig } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { AskBar, Conversation, renderMessageText } from "./components/Conversation";
import { CostDetails } from "./components/CostDetails";
import { InfoIcon } from "./components/icons";
import { InfoPanel } from "./components/InfoPanel";
import { LocationSearch } from "./components/LocationSearch";
import { MapView } from "./components/MapView";
import { NeedPicker } from "./components/NeedPicker";
import { ResultCard } from "./components/ResultCard";
import { card, iconButton } from "./components/ui";
import { useCareMap } from "./hooks/useCareMap";
import { useCareMapData } from "./hooks/useCareMapData";
import { warmAgent } from "./lib/agentClient";
import { quickAnswer, quickQuestions, type QuickContext, type QuickQuestion } from "./lib/quickAnswers";
import type { Facility } from "./lib/types";

type View = "results" | "conversation";
// Phone sheet heights, like Apple Maps: half shows the map above the list.
type Sheet = "half" | "full";
const isPhone = () => typeof window !== "undefined" && window.innerWidth < 640;

// Long lists render in pages: most people look at the first few, and a
// marker click past the first page opens the rest.
const PAGE = 15;

export default function App() {
  const { facilities: allFacilities, clinics, urgentCare, zipCentroids, loading: dataLoading, error } = useCareMapData();
  const cm = useCareMap(allFacilities, zipCentroids, clinics, urgentCare);
  const { profile, facilities } = cm;

  const [activeCcn, setActiveCcn] = useState<string | null>(null);
  const [view, setView] = useState<View>("results");
  const [costsOpen, setCostsOpen] = useState(() => !isPhone());
  const [hospitalOpen, setHospitalOpen] = useState(false);
  const [abroad, setAbroad] = useState(false);
  const [sheet, setSheet] = useState<Sheet>("half");
  const [infoOpen, setInfoOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [overviewOpen, setOverviewOpen] = useState(false);

  // Wake the AI backend while the person is still reading the page.
  useEffect(() => warmAgent(), []);
  useEffect(() => setShown(PAGE), [facilities]);

  // A marker click shows that place's card wherever the panel was.
  const handleSelectFacility = useCallback(
    (ccn: string) => {
      setActiveCcn(ccn);
      setView("results");
      const i = facilities.findIndex((f) => f.ccn === ccn);
      if (i >= PAGE) setShown(i + 1);
    },
    [facilities],
  );
  const handleSelectPreviewFacility = useCallback(
    (facility: Facility) => {
      cm.selectPreviewFacility(facility);
      setView("results");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cm.selectPreviewFacility],
  );

  useEffect(() => {
    if (!activeCcn) return;
    const t = setTimeout(() => document.getElementById(`result-card-${activeCcn}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
    return () => clearTimeout(t);
  }, [activeCcn, shown]);

  const ask = (text: string) => {
    cm.sendMessage(text);
    setView("conversation");
  };

  const active = facilities.find((f) => f.ccn === activeCcn) ?? null;
  const quickCtx: QuickContext = {
    facilities,
    fplPct: cm.fplPct,
    insuranceType: profile.insuranceType,
    need: profile.need,
    veteran: profile.veteran,
    active,
  };
  const suggestions = abroad ? [] : quickQuestions(quickCtx, facilities.length > 0);
  const onQuick = (q: QuickQuestion) => {
    // Answered on the spot from what's on screen; applying also asks the AI
    // to draft a letter for that hospital (its ID only, nothing personal).
    const target = active && active.type !== "fqhc" && active.type !== "urgent_care" ? active : facilities.find((f) => f.type === "acute_care_hospital" || f.type === "critical_access_hospital");
    const agentMessage = q.intent === "apply" && target ? `Draft my financial assistance application for ${target.name} (ccn ${target.ccn}).` : undefined;
    cm.answerLocally(q.label, quickAnswer(q.intent, quickCtx), agentMessage);
    setView("conversation");
  };

  const hospitals = facilities.filter((f) => f.type !== "fqhc" && f.type !== "urgent_care").length;
  const clinicCount = facilities.filter((f) => f.type === "fqhc").length;
  const urgentCount = facilities.filter((f) => f.type === "urgent_care").length;
  const counts = [
    hospitals ? `${hospitals} hospital${hospitals === 1 ? "" : "s"}` : null,
    clinicCount ? `${clinicCount} health center${clinicCount === 1 ? "" : "s"}` : null,
    urgentCount ? `${urgentCount} urgent care` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const overview = abroad ? cm.internationalSummary : cm.summary;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative h-[100dvh] w-screen overflow-hidden bg-[#172033] font-sans text-white antialiased">
        <MapView
          facilities={facilities}
          internationalFacilities={abroad ? cm.internationalFacilities : []}
          previewFacilities={abroad ? [] : cm.previewFacilities}
          fplPct={cm.fplPct}
          insuranceType={profile.insuranceType}
          flyTo={cm.flyTo}
          activeCcn={activeCcn}
          onSelectFacility={handleSelectFacility}
          onSelectPreviewFacility={handleSelectPreviewFacility}
        />

        <InfoPanel open={infoOpen} onClose={() => setInfoOpen(false)} />

        <aside
          className={`absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-[26px] border border-white/[0.08] bg-[#1b2336]/[0.86] shadow-2xl shadow-black/60 backdrop-blur-2xl backdrop-saturate-150 transition-[height] duration-300 sm:inset-y-4 sm:left-4 sm:right-auto sm:h-auto sm:w-[404px] sm:rounded-[24px] ${
            sheet === "full" ? "h-[88dvh]" : "h-[52dvh]"
          }`}
        >
          {/* Phone only: the sheet's grab handle, between half and full height. */}
          <button
            type="button"
            onClick={() => setSheet((v) => (v === "full" ? "half" : "full"))}
            aria-label={sheet === "full" ? "Show more map" : "Show more results"}
            className="mx-auto mt-2 flex h-5 w-16 shrink-0 items-center justify-center sm:hidden"
          >
            <span className="h-1.5 w-10 rounded-full bg-white/25" />
          </button>

          <header className="flex items-start justify-between gap-3 px-4 pt-1 sm:pt-4">
            <div>
              <h1 className="text-[22px] font-semibold leading-tight tracking-tight">CareMap</h1>
              <p className="hidden text-[13px] text-white/50 sm:block">What care would cost you, before the bill</p>
            </div>
            <button type="button" onClick={() => setInfoOpen(true)} aria-label="How CareMap works" title="How CareMap works" className={`${iconButton} -mr-1.5`}>
              <InfoIcon size={20} />
            </button>
          </header>

          <div className="px-4 pt-3">
            <LocationSearch
              zip={profile.zip}
              onZip={(zip) => {
                cm.updateProfile({ zip });
                setView("results");
              }}
              zipCentroids={zipCentroids}
              facilities={allFacilities}
              onLocate={() => cm.locate()}
              locating={cm.locating}
              locationError={cm.locationError ?? error}
              usingLocation={!!cm.locatedZip && cm.locatedZip === profile.zip}
              abroad={abroad}
              onAbroad={(a) => {
                setAbroad(a);
                if (!a) cm.searchAbroad("");
                setView("results");
              }}
              onDestination={(place) => {
                cm.searchAbroad(place);
                setView("results");
              }}
            />
          </div>

          {view === "conversation" ? (
              <div className="flex min-h-0 flex-1 flex-col px-4 pt-3">
                <Conversation messages={cm.messages} loading={cm.loading} onBack={() => setView("results")} />
              </div>
            ) : (
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-3 pt-4">
                {!abroad && (
                  <>
                    <NeedPicker
                      need={profile.need}
                      onNeed={(need) => cm.updateProfile({ need, emergency: false })}
                      hospitalOpen={hospitalOpen}
                      onHospitalOpen={setHospitalOpen}
                    />
                    <CostDetails profile={profile} onChange={cm.updateProfile} open={costsOpen} onOpen={setCostsOpen} fplPct={cm.fplPct} />
                  </>
                )}

                {profile.emergency && !abroad && (
                  <div className="rounded-2xl bg-[#ff453a]/15 px-4 py-3 text-[14px] font-medium leading-snug text-[#ff6961]" role="alert">
                    If this is an emergency, call 911 or go to the nearest ER now. Don't wait on cost.
                  </div>
                )}

                {overview ? (
                  <section className={`${card} px-4 py-3.5`}>
                    <h2 className="mb-1 text-[13px] font-medium text-white/55">
                      {abroad ? "Near your destination" : cm.placeName ? `Near ${cm.placeName} ${profile.zip}` : `Near ${profile.zip}`}
                    </h2>
                    <div className={`text-[14px] leading-relaxed text-white/85 ${overviewOpen ? "" : "line-clamp-4"}`}>{renderMessageText(overview)}</div>
                    <button type="button" onClick={() => setOverviewOpen((o) => !o)} className="mt-1 text-[13px] font-medium text-white/60 hover:text-white">
                      {overviewOpen ? "Less" : "More"}
                    </button>
                  </section>
                ) : (
                  !abroad && (
                    <section className={`${card} px-4 py-4`}>
                      <p className="text-[15px] font-medium text-white">{dataLoading ? "Loading hospitals…" : "Start with where you are"}</p>
                      <p className="mt-1 text-[13px] leading-relaxed text-white/55">
                        Enter a ZIP code or city to see nearby hospitals, sliding-fee clinics and urgent care, with what you'd likely pay under your state's
                        charity-care rules.
                      </p>
                    </section>
                  )
                )}

                {facilities.length > 0 && (
                  <section>
                    <div className="mb-2 flex items-baseline justify-between gap-3 px-0.5">
                      <h2 className="text-[17px] font-semibold tracking-tight">Nearby</h2>
                      <span className="truncate text-[13px] text-white/45">{counts}</span>
                    </div>
                    <div className="space-y-2">
                      {facilities.slice(0, shown).map((f, i) => (
                        <ResultCard
                          key={f.ccn}
                          facility={f}
                          fplPct={cm.fplPct}
                          insuranceType={profile.insuranceType}
                          need={profile.need}
                          index={i}
                          active={f.ccn === activeCcn}
                          onSelect={() => setActiveCcn((c) => (c === f.ccn ? null : f.ccn))}
                        />
                      ))}
                    </div>
                    {facilities.length > shown && (
                      <button
                        type="button"
                        onClick={() => setShown((n) => n + PAGE * 2)}
                        className="mt-2 h-10 w-full rounded-2xl bg-white/[0.06] text-[14px] font-medium text-white/80 transition-colors hover:bg-white/[0.1]"
                      >
                        Show more ({facilities.length - shown} left)
                      </button>
                    )}
                  </section>
                )}
              </div>
            )}

          <div className="shrink-0 border-t border-white/[0.06] px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
            <AskBar onSend={ask} onQuick={onQuick} onFocus={() => setView("conversation")} suggestions={suggestions} loading={cm.loading} />
          </div>
        </aside>
      </div>
    </MotionConfig>
  );
}
