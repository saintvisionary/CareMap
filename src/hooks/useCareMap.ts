import { useCallback, useEffect, useRef, useState } from "react";
import { askAgent } from "../lib/agentClient";
import { facilitiesNear, nearestZip, type FacilityWithDistance } from "../lib/geo";
import { redact, type InsuranceType } from "../lib/intake";
import { findInternationalFacilities, type InternationalFacility } from "../lib/international";
import { summarize, summarizeInternational } from "../lib/summarize";
import type { Facility, ZipCentroid } from "../lib/types";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface MapFlyTo {
  center: [number, number];
  zoom: number;
  pitch: number;
}

export interface CareMapState {
  messages: ChatMessage[];
  facilities: FacilityWithDistance[];
  internationalFacilities: InternationalFacility[];
  previewFacilities: Facility[];
  tierPct: number | null;
  fplPct: number | null;
  insuranceType: InsuranceType | null;
  veteran: boolean;
  flyTo: MapFlyTo | null;
  loading: boolean;
  sendMessage: (text: string) => void;
  selectPreviewFacility: (facility: Facility) => void;
}

let nextId = 0;
const id = () => String(nextId++);

// Evenly spread across the whole national list (not just the first N, which
// would cluster wherever the data happens to start) rather than truly
// random, so re-renders are stable and the spread is reproducible. Facility
// data loads one state file at a time in alphabetical order, so a fixed
// stride naturally samples across states instead of bunching in one.
function sampleFacilities(all: Facility[], limit: number): Facility[] {
  if (all.length <= limit) return all;
  const stride = all.length / limit;
  const out: Facility[] = [];
  for (let i = 0; i < limit; i++) {
    out.push(all[Math.floor(i * stride)]);
  }
  return out;
}

// Hospitals within 25 miles plus the few nearest sliding-fee clinics and
// urgent care centers (a city can have dozens of each). With no procedure
// asked about, everything is merged nearest-first so a close clinic isn't
// buried. When a hospital procedure was asked about (every one CareMap
// prices is a hospital condition), urgent care is left out entirely and
// hospitals come first -- a heart-attack search must never lead with urgent
// care. summarize() separates the types itself.
const NEARBY_CLINIC_LIMIT = 5;
const NEARBY_URGENT_CARE_LIMIT = 3;

function nearbyCare(
  hospitals: Facility[],
  clinics: Facility[],
  urgentCare: Facility[],
  zipCentroids: Record<string, ZipCentroid>,
  zip: string,
  hospitalProcedure: boolean,
): FacilityWithDistance[] {
  const nearHospitals = facilitiesNear(hospitals, zipCentroids, zip, 25);
  const nearClinics = facilitiesNear(clinics, zipCentroids, zip, 25).slice(0, NEARBY_CLINIC_LIMIT);
  if (hospitalProcedure) return [...nearHospitals, ...nearClinics];
  return [
    ...nearHospitals,
    ...nearClinics,
    ...facilitiesNear(urgentCare, zipCentroids, zip, 25).slice(0, NEARBY_URGENT_CARE_LIMIT),
  ].sort((a, b) => a.distanceMiles - b.distanceMiles);
}

export function useCareMap(
  allFacilities: Facility[],
  zipCentroids: Record<string, ZipCentroid>,
  allClinics: Facility[] = [],
  allUrgentCare: Facility[] = [],
): CareMapState {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: id(),
      role: "assistant",
      text: "Tell me where you are and what you need -- e.g. \"07018, family of 4, $52k, uninsured, need gallbladder surgery\".",
    },
  ]);
  const [facilities, setFacilities] = useState<FacilityWithDistance[]>([]);
  const [internationalFacilities, setInternationalFacilities] = useState<InternationalFacility[]>([]);
  const [previewFacilities, setPreviewFacilities] = useState<Facility[]>([]);
  const [tierPct, setTierPct] = useState<number | null>(null);
  const [fplPct, setFplPct] = useState<number | null>(null);
  const [insuranceType, setInsuranceType] = useState<InsuranceType | null>(null);
  const [veteran, setVeteran] = useState(false);
  const [flyTo, setFlyTo] = useState<MapFlyTo | null>(null);
  const [loading, setLoading] = useState(false);
  // Guards the auto-locate effect below from ever overwriting a real
  // search -- set the instant a user-initiated query runs, checked before
  // the (possibly slow) geolocation callback lands.
  const hasSearchedRef = useRef(false);
  // Zip the silent auto-locate landed on, so its results can pick up the
  // clinic and urgent care files, which finish loading after the hospitals.
  const autoZipRef = useRef<string | null>(null);

  // Nothing showed on the map until a search ran -- a first-time visitor
  // saw an empty basemap and had to already know to type something before
  // the app demonstrated any value. Try geolocation automatically (a
  // silent attempt, not gated behind a button) so "hospitals near me"
  // works with zero typing when the browser already has or will grant
  // permission. Income/insurance aren't known yet, so tierPct/insuranceType
  // stay null -- the existing "unknown" (grey) tier already means exactly
  // that, no fake numbers involved. Denied/unsupported/no-fix: falls back
  // to a national sample instead of leaving the map empty -- real
  // facilities, not placeholders, just with no single "near you" center to
  // judge distance from, so they render as small hollow preview markers
  // (see MapView) rather than claiming to be "nearby" anything.
  useEffect(() => {
    if (hasSearchedRef.current) return;
    if (Object.keys(zipCentroids).length === 0 || allFacilities.length === 0) return;
    const showNationalPreview = () => {
      if (hasSearchedRef.current) return;
      setPreviewFacilities(sampleFacilities(allFacilities, 130));
    };
    if (!navigator.geolocation) {
      showNationalPreview();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (hasSearchedRef.current) return;
        const zip = nearestZip(pos.coords.latitude, pos.coords.longitude, zipCentroids);
        if (!zip) {
          showNationalPreview();
          return;
        }
        autoZipRef.current = zip;
        setFacilities(nearbyCare(allFacilities, allClinics, allUrgentCare, zipCentroids, zip, false));
        const c = zipCentroids[zip];
        setFlyTo({ center: [c.lon, c.lat], zoom: 10.5, pitch: 55 });
      },
      showNationalPreview, // denied or unavailable
      { timeout: 8000, maximumAge: 300000 },
    );
    // Only ever worth trying once, right after the facility data needed to
    // answer it finishes loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFacilities.length, zipCentroids]);

  useEffect(() => {
    if (hasSearchedRef.current || !autoZipRef.current) return;
    setFacilities(nearbyCare(allFacilities, allClinics, allUrgentCare, zipCentroids, autoZipRef.current, false));
    // Only re-run when the late-loading clinic layers arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allClinics.length, allUrgentCare.length]);

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      hasSearchedRef.current = true;
      setPreviewFacilities([]); // a real search replaces the ambient preview, never layers with it
      setMessages((m) => [...m, { id: id(), role: "user", text }]);

      const hint = redact(text);

      // Traveler path: no US zip/tier math applies abroad, and there's no
      // real cost data to show -- see src/lib/international.ts. Skip the
      // domestic flow and the Lambda agent entirely rather than let either
      // one apply US-specific policy language to a destination it doesn't
      // understand.
      if (hint.destination) {
        setFacilities([]);
        setInternationalFacilities([]);
        setTierPct(null);
        setFplPct(null);
        setInsuranceType(hint.insuranceType);
        setVeteran(hint.veteran);
        setLoading(true);
        findInternationalFacilities(hint.destination)
          .then((result) => {
            setInternationalFacilities(result?.facilities ?? []);
            // A too-broad match (a whole country) isn't a place worth
            // flying the map to -- it's just wherever Nominatim's centroid
            // happened to land, not anywhere the traveler described.
            if (result && !result.tooBroad) setFlyTo({ center: [result.lon, result.lat], zoom: 11, pitch: 40 });
            setMessages((m) => [...m, { id: id(), role: "assistant", text: summarizeInternational(result, hint.destination!) }]);
          })
          .catch(() => {
            setMessages((m) => [
              ...m,
              { id: id(), role: "assistant", text: `Couldn't reach the international facility directory for "${hint.destination}" right now. Try again shortly.` },
            ]);
          })
          .finally(() => setLoading(false));
        return;
      }

      const nearby = hint.zipCode
        ? nearbyCare(allFacilities, allClinics, allUrgentCare, zipCentroids, hint.zipCode, hint.need != null || hint.emergency)
        : [];
      setFacilities(nearby);
      setInternationalFacilities([]);
      setTierPct(hint.tierPct);
      setFplPct(hint.fplPct);
      setInsuranceType(hint.insuranceType);
      setVeteran(hint.veteran);

      if (hint.zipCode && zipCentroids[hint.zipCode]) {
        const c = zipCentroids[hint.zipCode];
        setFlyTo({ center: [c.lon, c.lat], zoom: 10.5, pitch: 55 });
      }

      const instantReply = summarize({
        zipCode: hint.zipCode,
        fplPct: hint.fplPct,
        insuranceType: hint.insuranceType,
        veteran: hint.veteran,
        need: hint.need,
        emergency: hint.emergency,
        facilities: nearby,
      });
      setMessages((m) => [...m, { id: id(), role: "assistant", text: instantReply }]);

      setLoading(true);
      askAgent(hint.redactedMessage, {
        zipCode: hint.zipCode,
        insuranceType: hint.insuranceType,
        veteran: hint.veteran,
        tierPct: hint.tierPct,
        fplPct: hint.fplPct,
      })
        .then((agentReply) => {
          if (agentReply?.reply) {
            setMessages((m) => [...m, { id: id(), role: "assistant", text: agentReply.reply }]);
          }
        })
        .finally(() => setLoading(false));
    },
    [allFacilities, allClinics, allUrgentCare, zipCentroids],
  );

  // Clicking a preview marker is the one interaction it supports: run a
  // real search centered on that facility's own zip, exactly as if the
  // user had typed it. Turns "browse the ambient map" into a real entry
  // point instead of a dead end -- sendMessage clears previewFacilities,
  // so the search's own tier-colored markers replace the preview ones.
  const selectPreviewFacility = useCallback((facility: Facility) => sendMessage(facility.zip), [sendMessage]);

  return {
    messages,
    facilities,
    internationalFacilities,
    previewFacilities,
    tierPct,
    fplPct,
    insuranceType,
    veteran,
    flyTo,
    loading,
    sendMessage,
    selectPreviewFacility,
  };
}
