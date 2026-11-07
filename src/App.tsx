import { MotionConfig } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { AskBar, renderMessageText } from "./components/Conversation";
import { Greeting, Thread } from "./components/Thread";
import { Guide } from "./components/Guide";
import { CostDetails } from "./components/CostDetails";
import { fplAmount } from "./lib/policy";
import { ChevronDownIcon, ChevronLeftIcon, GlobeIcon, InfoIcon, LocationIcon, PersonIcon, RestartIcon } from "./components/icons";
import { InfoPanel } from "./components/InfoPanel";
import { LocationSearch } from "./components/LocationSearch";
import { MapView } from "./components/MapView";
import { Menu } from "./components/Menu";
import { NeedPicker } from "./components/NeedPicker";
import { ResultCard } from "./components/ResultCard";
import { card, iconButton } from "./components/ui";
import { useCareMap, type Profile } from "./hooks/useCareMap";
import { useCareMapData } from "./hooks/useCareMapData";
import { warmAgent } from "./lib/agentClient";
import { defaultLang, LANGS, peopleText, setLang, t, type Lang } from "./i18n";
import { loadSaved, saveSome } from "./lib/storage";
import { needKind, needLabel } from "./lib/drg";
import { sortByCost } from "./lib/sortByCost";
import { INSURANCE_LABELS } from "./lib/insurance";
import { quickAnswer, quickQuestions, type QuickContext, type QuickQuestion } from "./lib/quickAnswers";
import type { FacilityWithDistance } from "./lib/geo";
import type { Facility } from "./lib/types";

type View = "results" | "conversation";
// Phone sheet heights, like Apple Maps: half shows the map above the list.
type Sheet = "half" | "full";
type Editor = "need" | "costs" | null;
type Kind = "all" | "hospital" | "clinic" | "urgent";
const KIND_OF = (type: string): Kind => (type === "fqhc" ? "clinic" : type === "urgent_care" ? "urgent" : "hospital");
const KIND_TABS: { kind: Kind; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "hospital", label: "Hospitals" },
  { kind: "clinic", label: "Clinics" },
  { kind: "urgent", label: "Urgent care" },
];

// Long lists render in pages: most people look at the first few, and a
// marker click past the first page opens the rest.
const PAGE = 15;
// Tap-to-ask questions in everyday words, shown full width in the chat.
const STARTERS = [
  "I got a hospital bill I can't afford. Can it be lowered?",
  "Where can I see a doctor cheap without insurance?",
  "How much would surgery cost me at a nearby hospital?",
  "How does hospital charity care work?",
];


const INLINE = 4;

export default function App() {
  const { facilities: allFacilities, clinics, urgentCare, zipCentroids, loading: dataLoading, error, ensureStates } = useCareMapData();
  const cm = useCareMap(allFacilities, zipCentroids, clinics, urgentCare);
  const { profile, facilities } = cm;

  // Prices load per state, only for the states a search shows (all of them
  // for the nationwide list with a procedure picked).
  useEffect(() => {
    if (cm.national) {
      if (profile.need) ensureStates([...new Set(allFacilities.map((f) => f.state))]);
      return;
    }
    ensureStates([...new Set(facilities.filter((f) => f.type !== "fqhc" && f.type !== "urgent_care").map((f) => f.state))]);
  }, [facilities, cm.national, profile.need, allFacilities, ensureStates]);

  // Interface language: saved choice, else the phone's language.
  const [lang, setLangState] = useState<Lang>(() => {
    const l = loadSaved<{ lang: Lang }>().lang ?? defaultLang();
    setLang(l);
    return l;
  });
  const chooseLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
    saveSome({ lang: l });
  };

  const [activeCcn, setActiveCcn] = useState<string | null>(null);
  // The screen and list filter come back after a refresh, too.
  const [ui] = useState(() => loadSaved<{ ui: { view: View; kind: Kind } }>().ui);
  const [view, setView] = useState<View>(ui?.view ?? "results");
  // Which filter's editor is open under the chip row, if any.
  const [editor, setEditor] = useState<Editor>(null);
  const [kind, setKind] = useState<Kind>(ui?.kind ?? "all");
  useEffect(() => {
    saveSome({ ui: { view, kind } });
  }, [view, kind]);
  const [hospitalOpen, setHospitalOpen] = useState(false);
  const [abroad, setAbroad] = useState(false);
  const [sheet, setSheet] = useState<Sheet>("half");
  const [infoOpen, setInfoOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // First visit: a step-by-step guide. Returning visitors go straight to
  // their results; "Change my answers" opens the guide again.
  const [guide, setGuide] = useState(() => !profile.zip);
  // Bumped on every start-over, so the guide always opens at step 1.
  const [guideRun, setGuideRun] = useState(0);
  const startOver = () => {
    cm.startOver();
    setAbroad(false);
    setEditor(null);
    setKind("all");
    setActiveCcn(null);
    setView("results");
    setSheet("half");
    setGuide(true);
    setGuideRun((n) => n + 1);
  };

  // Wake the AI backend while the person is still reading the page.
  useEffect(() => {
    warmAgent();
  }, []);
  useEffect(() => {
    setShown(PAGE);
  }, [facilities, kind]);
  // With a procedure picked, the list leads with what's cheapest for this
  // person (the map keeps every place either way).
  const byCost = needKind(profile.need) === "hospital";
  const filtered = kind === "all" ? facilities : facilities.filter((f) => KIND_OF(f.type) === kind);
  const listed = byCost ? sortByCost(filtered, profile.need, cm.fplPct, profile.insuranceType) : filtered;
  // A filter that no longer has anything in it (a new search) falls back to All.
  useEffect(() => {
    if (kind !== "all" && !facilities.some((f) => KIND_OF(f.type) === kind)) setKind("all");
  }, [facilities, kind]);

  // A marker click shows that place's card wherever the panel was.
  const handleSelectFacility = useCallback(
    (ccn: string) => {
      setActiveCcn(ccn);
      setView("results");
      setEditor(null);
      const i = listed.findIndex((f) => f.ccn === ccn);
      if (i >= PAGE) setShown(i + 1);
    },
    [listed],
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

  const renderResults = (snapshot: FacilityWithDistance[], live: boolean) => {
    const list = live ? (byCost ? sortByCost(facilities, profile.need, cm.fplPct, profile.insuranceType) : facilities) : snapshot;
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
                          household={profile.household}
                          mathInputs={{ income: profile.income, incomeRange: profile.incomeRange, need: profile.need }}
            index={i}
            active={f.ccn === activeCcn}
            onSelect={() => setActiveCcn((c) => (c === f.ccn ? null : f.ccn))}
          />
        ))}
        {live && list.length > INLINE && (
          <button
            type="button"
            onClick={() => setView("results")}
            className="h-10 w-full rounded-2xl bg-white/[0.06] text-[14px] font-medium text-white/85 transition-colors hover:bg-white/[0.1]"
          >
            {t("See all {n} places", { n: list.length })}
          </button>
        )}
      </div>
    );
  };

  const renderAskIncome = (id: string) =>
    dismissed.has(id) ? null : (
      <div>
        <p className="mb-2 text-[14px] text-white/70">{t("Want your own price? Add your household and income. It never leaves this device.")}</p>
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

  const forget = () => {
    cm.forgetMe();
    setEditor(null);
    setView("results");
    setKind("all");
    setDismissed(new Set());
  };
  const hasResults = facilities.length > 0 || abroad;
  const toggleAbroad = (a: boolean) => {
    setAbroad(a);
    if (!a) cm.searchAbroad("");
    setEditor(null);
    setView("results");
  };
  const overview = abroad ? cm.internationalSummary : cm.summary;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative h-[100dvh] w-screen overflow-hidden bg-[#172033] font-sans text-white antialiased">
        <MapView
          facilities={abroad || cm.national ? [] : listed}
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

          <header className={`items-center justify-between gap-3 px-4 pt-1 sm:flex sm:pt-4 ${hasResults && !guide ? "hidden" : "flex"}`}>
            <button
              type="button"
              onClick={startOver}
              aria-label={t("Start over")}
              title={t("Start over")}
              className="-m-1 flex items-center gap-2.5 rounded-2xl p-1 text-left transition-[background-color,transform] hover:bg-white/[0.06] active:scale-[0.97] sm:gap-3"
            >
              <img src="./logo.svg" alt="" width={40} height={40} className="h-8 w-8 shrink-0 rounded-[9px] shadow-lg shadow-black/30 sm:h-10 sm:w-10 sm:rounded-[11px]" />
              <div>
                <h1 className="text-[18px] font-semibold leading-tight tracking-tight sm:text-[22px]">CareMap</h1>
                <p className="hidden text-[13px] text-white/50 sm:block">{t("What care would cost you, before the bill")}</p>
              </div>
            </button>
            <div className="-mr-1.5 flex items-center gap-1">
            <Menu
              variant="pill"
              value={lang}
              onChange={(v) => chooseLang(v as Lang)}
              options={LANGS.map((l) => ({ value: l.lang, label: l.label }))}
              ariaLabel={t("Language")}
            />
            <button type="button" onClick={() => setInfoOpen(true)} aria-label={t("How CareMap works")} title={t("How CareMap works")} className={iconButton}>
              <InfoIcon size={20} />
            </button>
            </div>
          </header>

          {!(guide && view === "results") && (
          <div className={`px-4 ${hasResults ? "pt-1 sm:pt-3" : "pt-3"}`}>
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
              onDestination={(place) => {
                cm.searchAbroad(place);
                setView("results");
              }}
            />
          </div>
          )}

          {view === "results" && !guide && (
            <div className="flex shrink-0 gap-1 px-4 pt-2.5 sm:gap-1.5">
              {!abroad && (
              <>
              <FilterChip open={editor === "need"} set={!!profile.need} onClick={() => setEditor((e) => (e === "need" ? null : "need"))}>
                {profile.need ? t(needLabel(profile.need)) : t("What you need")}
              </FilterChip>
              <FilterChip open={editor === "costs"} set={profile.income !== "" || profile.incomeRange != null || profile.insuranceType !== "uninsured"} onClick={() => setEditor((e) => (e === "costs" ? null : "costs"))}>
                {costChipLabel(profile)}
              </FilterChip>
              </>
              )}
              <button
                type="button"
                onClick={() => toggleAbroad(!abroad)}
                aria-pressed={abroad}
                aria-label={abroad ? t("Back to the US") : t("Search outside the US")}
                title={abroad ? t("Back to the US") : t("Search outside the US")}
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full ${abroad ? "px-3.5" : "w-9 justify-center"} text-[14px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
                  abroad ? "bg-white text-black" : "bg-white/[0.08] text-white/80 hover:bg-white/[0.14]"
                }`}
              >
                <GlobeIcon size={16} />
                {abroad && t("Back to the US")}
              </button>
              {hasResults && (
                <button
                  type="button"
                  onClick={startOver}
                  aria-label={t("Start over")}
                  title={t("Start over")}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-white/[0.08] text-[14px] font-medium text-white/80 transition-[background-color,transform] hover:bg-white/[0.14] active:scale-[0.96] sm:w-auto sm:px-3"
                >
                  <RestartIcon size={16} />
                  <span className="hidden sm:inline">{t("New search")}</span>
                </button>
              )}
              {hasResults && (
                <button type="button" onClick={() => setInfoOpen(true)} aria-label={t("How CareMap works")} className={`${iconButton} -mr-1 w-8 sm:hidden`}>
                  <InfoIcon size={19} />
                </button>
              )}
            </div>
          )}

          {lang !== "en" && !guide && (
            <p className="mx-4 mt-2 rounded-xl bg-white/[0.06] px-3 py-2 text-[12px] leading-snug text-white/70">
              {t("Detailed explanations are in English for now, while translations are reviewed. Ask CareMap to explain in your language.")}
            </p>
          )}
          {guide && view === "results" ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-3">
              <Guide
                key={guideRun}
                onAbroad={() => {
                  setGuide(false);
                  toggleAbroad(true);
                  setTimeout(() => document.querySelector<HTMLInputElement>('input[aria-label="City and country"]')?.focus(), 80);
                }}
                profile={profile}
                onChange={cm.updateProfile}
                onDone={() => {
                  setGuide(false);
                  setEditor(null);
                  setSheet("half");
                }}
                zipCentroids={zipCentroids}
                facilities={allFacilities}
                onLocate={() => cm.locate()}
                locating={cm.locating}
                locationError={cm.locationError}
              />
            </div>
          ) : view === "conversation" ? (
              <div className="flex min-h-0 flex-1 flex-col px-4 pt-3">
                <div className="flex shrink-0 items-center justify-between pb-2">
                  <button type="button" onClick={() => setView("results")} className={`${iconButton} -ml-2 w-auto gap-0.5 px-2 text-[15px] text-white/80`}>
                    <ChevronLeftIcon size={18} />
                    {t("Results")}
                  </button>
                  {cm.messages.length > 0 && (
                    <button type="button" onClick={cm.clearChat} className="text-[13px] font-medium text-white/50 hover:text-white">
                      {t("New chat")}
                    </button>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
                  {cm.messages.length === 0 ? (
                    <Greeting
                      place={dataLoading ? "loading" : profile.zip || null}
                      starters={STARTERS.map((q) => t(q))}
                      onStarter={(q) => (q === t(STARTERS[3]) ? onQuick({ label: q, intent: "charityCare" }) : ask(q))}
                      onLocate={() => cm.locate()}
                      locating={cm.locating}
                    />
                  ) : (
                    <Thread
                      messages={cm.messages}
                      loading={cm.loading}
                      renderResults={renderResults}
                      renderAskIncome={renderAskIncome}
                      renderAskLocation={renderAskLocation}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-3 pt-3">
                {editor === "need" && !abroad && (
                  <div className={`${card} p-4`}>
                    <NeedPicker
                      need={profile.need}
                      onNeed={(need) => {
                        cm.updateProfile({ need, emergency: false });
                        if (need) setEditor(null);
                      }}
                      hospitalOpen={hospitalOpen}
                      onHospitalOpen={setHospitalOpen}
                    />
                  </div>
                )}
                {editor === "costs" && !abroad && (
                  <CostDetails bare onDone={() => setEditor(null)} onForget={forget} profile={profile} onChange={cm.updateProfile} open onOpen={() => {}} fplPct={cm.fplPct} />
                )}

                {profile.emergency && !abroad && (
                  <div className="rounded-2xl bg-[#ff453a]/15 px-4 py-3 text-[14px] font-medium leading-snug text-[#ff6961]" role="alert">
                    {t("If this is an emergency, call 911 or go to the nearest ER now. Don't wait on cost.")}
                  </div>
                )}

                {!abroad && facilities.length === 0 && !editor && (
                  <section className={`${card} space-y-3 px-4 py-4`}>
                    <div>
                      <p className="text-[18px] font-semibold">{dataLoading ? t("Loading hospitals…") : t("Where are you?")}</p>
                      <p className="mt-0.5 text-[14px] text-white/60">{t("Type a ZIP code or city in the search box above, or use your location.")}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => cm.locate()}
                      disabled={cm.locating || dataLoading}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-[16px] font-semibold text-black active:scale-[0.98] disabled:opacity-60"
                    >
                      <LocationIcon size={17} />
                      {cm.locating ? "Finding you…" : "Use my location"}
                    </button>
                  </section>
                )}

                {overview && (abroad || facilities.length > 0) && (
                  <section className={`${card} px-4 py-3`}>
                    <h2 className="mb-0.5 text-[13px] font-medium text-white/55">
                      {abroad
                        ? t("Near your destination")
                        : cm.national
                          ? t("Across the United States")
                          : t("Near {place}", { place: cm.placeName ? `${cm.placeName} ${profile.zip}` : profile.zip })}
                    </h2>
                    <div className={`text-[14px] leading-relaxed text-white/85 ${overviewOpen ? "" : "line-clamp-2"}`}>{renderMessageText(overview)}</div>
                    <button type="button" onClick={() => setOverviewOpen((o) => !o)} className="mt-0.5 text-[13px] font-medium text-white/60 hover:text-white">
                      {overviewOpen ? t("Less") : t("More")}
                    </button>
                  </section>
                )}

                {facilities.length > 0 && !abroad && (
                  <section>
                    {byCost && (
                      <p className="mb-2 px-1 text-[13px] font-medium text-white/70">{t("Sorted by lowest cost to you")}</p>
                    )}
                    <div className="mb-2 flex gap-1 overflow-x-auto rounded-full bg-white/[0.06] p-1 [scrollbar-width:none]" role="tablist">
                      {KIND_TABS.filter((tab) => tab.kind === "all" || facilities.some((f) => KIND_OF(f.type) === tab.kind)).map((tab) => {
                        const n = tab.kind === "all" ? facilities.length : facilities.filter((f) => KIND_OF(f.type) === tab.kind).length;
                        return (
                          <button
                            key={tab.kind}
                            type="button"
                            role="tab"
                            aria-selected={kind === tab.kind}
                            onClick={() => setKind(tab.kind)}
                            className={`h-8 flex-1 shrink-0 whitespace-nowrap rounded-full px-2.5 text-[13px] font-medium transition-colors ${
                              kind === tab.kind ? "bg-white text-black" : "text-white/70 hover:text-white"
                            }`}
                          >
                            {t(tab.label)} <span className={kind === tab.kind ? "text-black/60" : "text-white/50"}>{n}</span>
                          </button>
                        );
                      })}
                    </div>
                    {(kind === "urgent" || (kind === "all" && listed.some((f) => f.type === "urgent_care"))) && (
                      <p className="mb-2 px-1 text-[12px] text-white/45">{t("Urgent care is for minor problems. For anything life-threatening, call 911.")}</p>
                    )}
                    <div className="space-y-1.5">
                      {listed.slice(0, shown).map((f, i) => (
                        <ResultCard
                          key={f.ccn}
                          facility={f}
                          fplPct={cm.fplPct}
                          insuranceType={profile.insuranceType}
                          need={profile.need}
                          household={profile.household}
                          mathInputs={{ income: profile.income, incomeRange: profile.incomeRange, need: profile.need }}
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
                        {t("Show more ({n} left)", { n: listed.length - shown })}
                      </button>
                    )}
                  </section>
                )}
                {facilities.length > 0 && !abroad && (
                  <button type="button" onClick={() => setGuide(true)} className="w-full py-2 text-center text-[14px] font-medium text-white/55 hover:text-white">
                    {t("Change my answers")}
                  </button>
                )}
              </div>
            )}

          <div className="shrink-0 border-t border-white/[0.06] px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
            <AskBar
              onSend={ask}
              onQuick={onQuick}
              onFocus={() => setView("conversation")}
              suggestions={suggestions}
              hideSuggestionsOnPhone={view === "results"}
              loading={cm.loading}
            />
          </div>
        </aside>
      </div>
    </MotionConfig>
  );
}

function costChipLabel(p: Profile): React.ReactNode {
  if (p.insuranceType !== "uninsured") return t(INSURANCE_LABELS[p.insuranceType]);
  if (p.income === "" && p.incomeRange == null) return t("Add income");
  // Compact so it fits a phone: a person icon with the count, then
  // "$16–32k" style money.
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  let amount: string;
  if (p.income !== "") amount = `$${k(Number(p.income))}`;
  else {
    const base = fplAmount(p.household);
    const r = p.incomeRange!;
    amount = r <= 100 ? `<$${k(base)}` : r >= 1000 ? `$${k(base * 4)}+` : `$${Math.round((base * (r - 100)) / 100000)}–${k((base * r) / 100)}`;
  }
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${peopleText(p.household)}, ${amount}`}>
      <PersonIcon size={13} />
      {p.household} · {amount}
    </span>
  );
}

function FilterChip({ open, set, onClick, children }: { open: boolean; set: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={`inline-flex h-9 min-w-0 items-center gap-0.5 rounded-full pl-3 pr-1.5 text-[14px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
        open ? "bg-white text-black" : set ? "bg-white/[0.16] text-white" : "bg-white/[0.08] text-white/80 hover:bg-white/[0.14]"
      }`}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ChevronDownIcon size={14} className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
    </button>
  );
}
