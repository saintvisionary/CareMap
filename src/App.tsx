import { MotionConfig } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { AskBar } from "./components/Conversation";
import { CostDetails } from "./components/CostDetails";
import { ChevronDownIcon, ChevronLeftIcon, GlobeIcon, InfoIcon, LocationIcon } from "./components/icons";
import { InfoPanel } from "./components/InfoPanel";
import { LocationSearch } from "./components/LocationSearch";
import { MapView } from "./components/MapView";
import { NeedPicker } from "./components/NeedPicker";
import { ResultCard } from "./components/ResultCard";
import { Greeting, Thread } from "./components/Thread";
import { card, iconButton } from "./components/ui";
import { useCareMap, type Profile } from "./hooks/useCareMap";
import { useCareMapData } from "./hooks/useCareMapData";
import { warmAgent } from "./lib/agentClient";
import { needLabel } from "./lib/drg";
import type { FacilityWithDistance } from "./lib/geo";
import { INSURANCE_LABELS } from "./lib/insurance";
import { quickAnswer, quickQuestions, type QuickContext, type QuickQuestion } from "./lib/quickAnswers";
import type { Facility } from "./lib/types";

// The conversation is the app; "list" is the full set of places for a search.
type View = "chat" | "list";
// Phone sheet heights, like Apple Maps: half shows the map above.
type Sheet = "half" | "full";
type Editor = "location" | "need" | "costs" | null;
type Kind = "all" | "hospital" | "clinic" | "urgent";
const KIND_OF = (type: string): Kind => (type === "fqhc" ? "clinic" : type === "urgent_care" ? "urgent" : "hospital");
const KIND_TABS: { kind: Kind; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "hospital", label: "Hospitals" },
  { kind: "clinic", label: "Clinics" },
  { kind: "urgent", label: "Urgent care" },
];
const PAGE = 15;
const INLINE = 4;
const CHARITY_STARTER = "How does hospital charity care work?";

export default function App() {
  const { facilities: allFacilities, clinics, urgentCare, zipCentroids, loading: dataLoading, error } = useCareMapData();
  const cm = useCareMap(allFacilities, zipCentroids, clinics, urgentCare);
  const { profile, facilities } = cm;

  const [activeCcn, setActiveCcn] = useState<string | null>(null);
  const [view, setView] = useState<View>("chat");
  const [editor, setEditor] = useState<Editor>(null);
  const [kind, setKind] = useState<Kind>("all");
  const [hospitalOpen, setHospitalOpen] = useState(false);
  const [abroad, setAbroad] = useState(false);
  const [sheet, setSheet] = useState<Sheet>("half");
  const [infoOpen, setInfoOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    warmAgent();
  }, []);
  useEffect(() => {
    setShown(PAGE);
  }, [facilities, kind]);
  useEffect(() => {
    if (kind !== "all" && !facilities.some((f) => KIND_OF(f.type) === kind)) setKind("all");
  }, [facilities, kind]);
  const listed = kind === "all" ? facilities : facilities.filter((f) => KIND_OF(f.type) === kind);

  // A marker opens that place in the full list.
  const handleSelectFacility = useCallback(
    (ccn: string) => {
      setActiveCcn(ccn);
      setView("list");
      setEditor(null);
      const i = listed.findIndex((f) => f.ccn === ccn);
      if (i >= PAGE) setShown(i + 1);
    },
    [listed],
  );
  const handleSelectPreviewFacility = useCallback(
    (facility: Facility) => {
      cm.selectPreviewFacility(facility);
      setView("chat");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cm.selectPreviewFacility],
  );

  useEffect(() => {
    if (!activeCcn || view !== "list") return;
    const t = setTimeout(() => {
      document.getElementById(`result-card-${activeCcn}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 60);
    return () => clearTimeout(t);
  }, [activeCcn, shown, view]);

  const active = facilities.find((f) => f.ccn === activeCcn) ?? null;
  const quickCtx: QuickContext = {
    facilities,
    fplPct: cm.fplPct,
    insuranceType: profile.insuranceType,
    need: profile.need,
    veteran: profile.veteran,
    active,
  };
  const onQuick = (q: QuickQuestion) => {
    // Answered on the spot from what's on screen; applying also asks the AI
    // to draft a letter for that hospital (its ID only, nothing personal).
    const target =
      active && active.type !== "fqhc" && active.type !== "urgent_care"
        ? active
        : facilities.find((f) => f.type === "acute_care_hospital" || f.type === "critical_access_hospital");
    const agentMessage = q.intent === "apply" && target ? `Draft my financial assistance application for ${target.name} (ccn ${target.ccn}).` : undefined;
    cm.answerLocally(q.label, quickAnswer(q.intent, quickCtx), agentMessage);
    setView("chat");
    setEditor(null);
  };
  const send = (text: string) => {
    if (text === CHARITY_STARTER) {
      onQuick({ label: text, intent: "charityCare" });
      return;
    }
    cm.sendMessage(text);
    setView("chat");
    setEditor(null);
  };
  const toggleAbroad = (a: boolean) => {
    setAbroad(a);
    if (!a) cm.searchAbroad("");
    setEditor(a ? "location" : null);
    setView("chat");
  };

  const followUps = abroad || !cm.messages.some((m) => m.role === "user") ? [] : quickQuestions(quickCtx, facilities.length > 0);
  const starters = [
    "I need a checkup",
    "I'm sick and want to see someone today",
    "What would gallbladder surgery cost me?",
    CHARITY_STARTER,
  ];
  const placeLabel = cm.placeName ?? (profile.zip || null);

  const renderResults = (snapshot: FacilityWithDistance[], live: boolean) => {
    const list = live ? facilities : snapshot;
    if (list.length === 0) return null;
    return (
      <div className="space-y-1.5">
        {list.slice(0, INLINE).map((f, i) => (
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
        {live && list.length > INLINE && (
          <button
            type="button"
            onClick={() => setView("list")}
            className="h-10 w-full rounded-2xl bg-white/[0.06] text-[14px] font-medium text-white/85 transition-colors hover:bg-white/[0.1]"
          >
            See all {list.length} places
          </button>
        )}
      </div>
    );
  };

  const renderAskIncome = (id: string) =>
    dismissed.has(id) ? null : (
      <div>
        <p className="mb-2 text-[14px] text-white/70">Want your own price? Add your household and income. It never leaves this device.</p>
        <CostDetails bare onDone={() => setDismissed((d) => new Set(d).add(id))} profile={profile} onChange={cm.updateProfile} open onOpen={() => {}} fplPct={cm.fplPct} />
      </div>
    );

  const renderAskLocation = () =>
    profile.zip.length === 5 ? null : (
      <div className={`${card} space-y-2.5 p-3`}>
        <button
          type="button"
          onClick={() => cm.locate()}
          disabled={cm.locating}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white text-[15px] font-medium text-black transition-transform active:scale-[0.97] disabled:opacity-60"
        >
          <LocationIcon size={16} />
          {cm.locating ? "Finding you…" : "Use my location"}
        </button>
        <LocationSearch
          zip={profile.zip}
          onZip={(zip) => cm.updateProfile({ zip })}
          zipCentroids={zipCentroids}
          facilities={allFacilities}
          onLocate={() => cm.locate()}
          locating={cm.locating}
          locationError={cm.locationError}
          usingLocation={false}
          abroad={false}
          onDestination={() => {}}
        />
      </div>
    );

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative h-[100dvh] w-screen overflow-hidden bg-[#172033] font-sans text-white antialiased">
        <MapView
          facilities={view === "list" ? listed : facilities}
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
          className={`absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-[26px] border border-white/[0.08] bg-[#1b2336]/[0.9] shadow-2xl shadow-black/60 backdrop-blur-2xl backdrop-saturate-150 transition-[height] duration-300 sm:inset-y-4 sm:left-4 sm:right-auto sm:h-auto sm:w-[420px] sm:rounded-[24px] ${
            sheet === "full" ? "h-[90dvh]" : "h-[56dvh]"
          }`}
        >
          {/* Phone only: the sheet's grab handle, between half and full height. */}
          <button
            type="button"
            onClick={() => setSheet((v) => (v === "full" ? "half" : "full"))}
            aria-label={sheet === "full" ? "Show more map" : "Show more"}
            className="mx-auto mt-2 flex h-5 w-16 shrink-0 items-center justify-center sm:hidden"
          >
            <span className="h-1.5 w-10 rounded-full bg-white/25" />
          </button>

          <header className="flex shrink-0 items-center justify-between gap-3 px-4 pt-1 sm:pt-4">
            {view === "list" ? (
              <button type="button" onClick={() => setView("chat")} className={`${iconButton} -ml-2 w-auto gap-0.5 px-2 text-[15px] text-white/85`}>
                <ChevronLeftIcon size={18} />
                Chat
              </button>
            ) : (
              <div className="flex items-center gap-2.5">
                <img src="./logo.svg" alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-[9px] shadow-lg shadow-black/30" />
                <h1 className="text-[18px] font-semibold tracking-tight">CareMap</h1>
              </div>
            )}
            <button type="button" onClick={() => setInfoOpen(true)} aria-label="How CareMap works" title="How CareMap works" className={`${iconButton} -mr-1.5`}>
              <InfoIcon size={20} />
            </button>
          </header>

          {/* What CareMap understood, always visible and editable. */}
          <div className="flex shrink-0 gap-1.5 overflow-x-auto px-4 pt-2.5 [scrollbar-width:none]">
            <FilterChip open={editor === "location"} set={!!placeLabel || abroad} onClick={() => setEditor((e) => (e === "location" ? null : "location"))}>
              {abroad ? <GlobeIcon size={14} /> : <LocationIcon size={13} />}
              {abroad ? "Abroad" : placeLabel ?? "Location"}
            </FilterChip>
            {!abroad && (
              <>
                <FilterChip open={editor === "need"} set={!!profile.need} onClick={() => setEditor((e) => (e === "need" ? null : "need"))}>
                  {profile.need ? needLabel(profile.need) : "What you need"}
                </FilterChip>
                <FilterChip
                  open={editor === "costs"}
                  set={profile.income !== "" || profile.insuranceType !== "uninsured"}
                  onClick={() => setEditor((e) => (e === "costs" ? null : "costs"))}
                >
                  {costChipLabel(profile)}
                </FilterChip>
              </>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-3 pt-3">
            {editor === "location" && (
              <div className={`${card} space-y-2.5 p-3`}>
                <LocationSearch
                  zip={profile.zip}
                  onZip={(zip) => {
                    cm.updateProfile({ zip });
                    if (zip.length === 5) setEditor(null);
                  }}
                  zipCentroids={zipCentroids}
                  facilities={allFacilities}
                  onLocate={() => {
                    cm.locate();
                    setEditor(null);
                  }}
                  locating={cm.locating}
                  locationError={cm.locationError ?? error}
                  usingLocation={!!cm.locatedZip && cm.locatedZip === profile.zip}
                  abroad={abroad}
                  onDestination={(place) => {
                    cm.searchAbroad(place);
                    setEditor(null);
                    setView("chat");
                  }}
                />
                <button type="button" onClick={() => toggleAbroad(!abroad)} className="flex items-center gap-1.5 px-1 text-[13px] font-medium text-white/65 hover:text-white">
                  <GlobeIcon size={14} />
                  {abroad ? "Search in the US instead" : "Traveling outside the US?"}
                </button>
              </div>
            )}
            {editor === "need" && !abroad && (
              <div className={`${card} p-4`}>
                <NeedPicker
                  need={profile.need}
                  onNeed={(need) => {
                    cm.updateProfile({ need, emergency: false });
                    if (need) {
                      setEditor(null);
                      setView("chat");
                    }
                  }}
                  hospitalOpen={hospitalOpen}
                  onHospitalOpen={setHospitalOpen}
                />
              </div>
            )}
            {editor === "costs" && !abroad && (
              <CostDetails bare onDone={() => setEditor(null)} profile={profile} onChange={cm.updateProfile} open onOpen={() => {}} fplPct={cm.fplPct} />
            )}

            {profile.emergency && !abroad && (
              <div className="rounded-2xl bg-[#ff453a]/15 px-4 py-3 text-[14px] font-medium leading-snug text-[#ff6961]" role="alert">
                If this is an emergency, call 911 or go to the nearest ER now. Don't wait on cost.
              </div>
            )}

            {view === "list" ? (
              <section>
                <h2 className="mb-2 px-0.5 text-[17px] font-semibold tracking-tight">{placeLabel ? `Near ${placeLabel}` : "Nearby"}</h2>
                <div className="mb-2 flex gap-1 overflow-x-auto rounded-full bg-white/[0.06] p-1 [scrollbar-width:none]" role="tablist">
                  {KIND_TABS.filter((t) => t.kind === "all" || facilities.some((f) => KIND_OF(f.type) === t.kind)).map((t) => {
                    const n = t.kind === "all" ? facilities.length : facilities.filter((f) => KIND_OF(f.type) === t.kind).length;
                    return (
                      <button
                        key={t.kind}
                        type="button"
                        role="tab"
                        aria-selected={kind === t.kind}
                        onClick={() => setKind(t.kind)}
                        className={`h-8 flex-1 shrink-0 whitespace-nowrap rounded-full px-2.5 text-[13px] font-medium transition-colors ${
                          kind === t.kind ? "bg-white text-black" : "text-white/70 hover:text-white"
                        }`}
                      >
                        {t.label} <span className={kind === t.kind ? "text-black/45" : "text-white/35"}>{n}</span>
                      </button>
                    );
                  })}
                </div>
                {listed.some((f) => f.type === "urgent_care") && (
                  <p className="mb-2 px-1 text-[12px] text-white/45">Urgent care is for minor problems. For anything life-threatening, call 911.</p>
                )}
                <div className="space-y-1.5">
                  {listed.slice(0, shown).map((f, i) => (
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
                {listed.length > shown && (
                  <button
                    type="button"
                    onClick={() => setShown((n) => n + PAGE * 2)}
                    className="mt-2 h-10 w-full rounded-2xl bg-white/[0.06] text-[14px] font-medium text-white/80 transition-colors hover:bg-white/[0.1]"
                  >
                    Show more ({listed.length - shown} left)
                  </button>
                )}
              </section>
            ) : (
              <>
              {/* Until the person says something, keep the welcome and
                  starters on top, even if their location already brought
                  up nearby places. */}
              {!cm.messages.some((m) => m.role === "user") && (
                <Greeting
                  place={dataLoading ? "loading" : placeLabel}
                  starters={starters}
                  onStarter={send}
                  onLocate={() => cm.locate()}
                  locating={cm.locating}
                />
              )}
              <Thread
                messages={cm.messages}
                loading={cm.loading}
                renderResults={renderResults}
                renderAskIncome={renderAskIncome}
                renderAskLocation={renderAskLocation}
              />
              </>
            )}
          </div>

          <div className="shrink-0 border-t border-white/[0.06] px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
            <AskBar onSend={send} onQuick={onQuick} onFocus={() => setView("chat")} suggestions={followUps} loading={cm.loading} />
          </div>
        </aside>
      </div>
    </MotionConfig>
  );
}

function costChipLabel(p: Profile): string {
  if (p.insuranceType !== "uninsured") return INSURANCE_LABELS[p.insuranceType];
  if (p.income === "") return "Add income";
  return `${p.household} ${p.household === 1 ? "person" : "people"} · $${Number(p.income).toLocaleString("en-US")}`;
}

function FilterChip({ open, set, onClick, children }: { open: boolean; set: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={`inline-flex h-9 shrink-0 items-center gap-1 rounded-full pl-3.5 pr-2.5 text-[14px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
        open ? "bg-white text-black" : set ? "bg-white/[0.16] text-white" : "bg-white/[0.08] text-white/80 hover:bg-white/[0.14]"
      }`}
    >
      {children}
      <ChevronDownIcon size={15} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

