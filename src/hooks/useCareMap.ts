import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { askAgent } from "../lib/agentClient";
import { needKind, type NeedKind } from "../lib/drg";
import { facilitiesNear, nearestZip, type FacilityWithDistance } from "../lib/geo";
import { redact, type InsuranceType, type IntakeHint } from "../lib/intake";
import { findInternationalFacilities, type InternationalFacility, type InternationalResult } from "../lib/international";
import { buildCityIndex, findPlace, zipPlaceName } from "../lib/places";
import { fplPercent, njCharityTier } from "../lib/policy";
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

/** Everything the person has told CareMap, from the form or the chat.
 * Lives only in this tab: income and household size are never sent
 * anywhere (the agent gets fplPct and tierPct, computed here). */
export interface Profile {
  zip: string;
  household: number;
  /** Digits only, "" when not given. */
  income: string;
  insuranceType: InsuranceType;
  veteran: boolean;
  need: string | null;
  emergency: boolean;
}

export const EMPTY_PROFILE: Profile = {
  zip: "",
  household: 1,
  income: "",
  insuranceType: "uninsured",
  veteran: false,
  need: null,
  emergency: false,
};

let nextId = 0;
const id = () => String(nextId++);

// Evenly spread across the whole national list (not just the first N, which
// would cluster wherever the data happens to start) rather than truly
// random, so re-renders are stable and the spread is reproducible.
function sampleFacilities(all: Facility[], limit: number): Facility[] {
  if (all.length <= limit) return all;
  const stride = all.length / limit;
  const out: Facility[] = [];
  for (let i = 0; i < limit; i++) out.push(all[Math.floor(i * stride)]);
  return out;
}

export type SearchFocus = NeedKind | "emergency" | null;

/** Income as a percent of the poverty line, only for the uninsured: every
 * charity-care formula CareMap models applies to them alone. */
export function profileFplPct(p: Profile): number | null {
  if (p.insuranceType !== "uninsured" || p.income === "" || !(p.household > 0)) return null;
  return fplPercent(Number(p.income), p.household);
}

export function profileFocus(p: Profile): SearchFocus {
  return p.emergency ? "emergency" : needKind(p.need);
}

const NEARBY_CLINIC_LIMIT = 5;
const NEARBY_URGENT_CARE_LIMIT = 3;

/** Hospitals within 25 miles plus the nearest clinics and urgent care,
 * ordered for what the person needs: a hospital procedure or emergency
 * leads with hospitals and never lists urgent care; a checkup leads with
 * sliding-fee clinics; a sick visit or minor injury with urgent care and
 * clinics; "just looking" is nearest-first. */
export function nearbyCare(
  hospitals: Facility[],
  clinics: Facility[],
  urgentCare: Facility[],
  zipCentroids: Record<string, ZipCentroid>,
  zip: string,
  focus: SearchFocus,
): FacilityWithDistance[] {
  const nearHospitals = facilitiesNear(hospitals, zipCentroids, zip, 25);
  const nearClinics = facilitiesNear(clinics, zipCentroids, zip, 25);
  const nearUrgent = () => facilitiesNear(urgentCare, zipCentroids, zip, 25);
  switch (focus) {
    case "hospital":
    case "emergency":
      return [...nearHospitals, ...nearClinics.slice(0, NEARBY_CLINIC_LIMIT)];
    case "clinic":
      return [...nearClinics.slice(0, 8), ...nearHospitals];
    case "urgent": {
      const first = [...nearUrgent().slice(0, 5), ...nearClinics.slice(0, NEARBY_CLINIC_LIMIT)].sort((a, b) => a.distanceMiles - b.distanceMiles);
      return [...first, ...nearHospitals];
    }
    default:
      return [...nearHospitals, ...nearClinics.slice(0, NEARBY_CLINIC_LIMIT), ...nearUrgent().slice(0, NEARBY_URGENT_CARE_LIMIT)].sort(
        (a, b) => a.distanceMiles - b.distanceMiles,
      );
  }
}

/** A chat message's details folded into the profile: anything it states
 * wins, anything it leaves out is kept, so a follow-up ("which of these is
 * best?") never starts over. An emergency carries over until a different
 * need is named. */
export function mergeProfile(prev: Profile, hint: IntakeHint): Profile {
  return {
    zip: hint.zipCode ?? prev.zip,
    household: hint.household ?? prev.household,
    income: hint.income != null ? String(Math.round(hint.income)) : prev.income,
    insuranceType: hint.insuranceType ?? prev.insuranceType,
    veteran: hint.veteran || prev.veteran,
    need: hint.need ?? prev.need,
    emergency: hint.emergency || (!hint.need && prev.emergency),
  };
}

const LOCATION_QUESTION = /\b(near(est|by)?|closest|around|hospital|clinic|urgent care|doctor|where)\b/i;

export function useCareMap(
  allFacilities: Facility[],
  zipCentroids: Record<string, ZipCentroid>,
  allClinics: Facility[] = [],
  allUrgentCare: Facility[] = [],
) {
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [flyTo, setFlyTo] = useState<MapFlyTo | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locatedZip, setLocatedZip] = useState<string | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const [international, setInternational] = useState<{ place: string; result: InternationalResult | null } | null>(null);
  // Set once the person does anything, so a slow automatic location fix
  // never overwrites what they typed.
  const touchedRef = useRef(false);
  const chatAbroadRef = useRef(false);

  const cityIndex = useMemo(() => buildCityIndex(allFacilities, allClinics, allUrgentCare), [allFacilities, allClinics, allUrgentCare]);

  const push = useCallback((role: ChatMessage["role"], text: string) => setMessages((m) => [...m, { id: id(), role, text }]), []);

  const validZip = (zip: string) => (/^\d{5}$/.test(zip) && zipCentroids[zip] ? zip : null);
  const zip = validZip(profile.zip);
  const fplPct = profileFplPct(profile);
  const tierPct = fplPct != null ? njCharityTier(fplPct).patientPaysPct : null;
  const focus = profileFocus(profile);

  const facilities = useMemo(
    () => (zip && !destination ? nearbyCare(allFacilities, allClinics, allUrgentCare, zipCentroids, zip, focus) : []),
    [zip, focus, destination, allFacilities, allClinics, allUrgentCare, zipCentroids],
  );

  const summary = useMemo(
    () =>
      zip && !destination
        ? summarize({
            zipCode: zip,
            fplPct,
            insuranceType: profile.insuranceType,
            veteran: profile.veteran,
            need: profile.need,
            emergency: profile.emergency,
            facilities,
          })
        : null,
    [zip, destination, fplPct, profile.insuranceType, profile.veteran, profile.need, profile.emergency, facilities],
  );

  const placeName = useMemo(() => (zip ? zipPlaceName(zip, facilities, allFacilities) : null), [zip, facilities, allFacilities]);

  // Before anyone searches, a light national sample so the map isn't empty.
  const previewFacilities = useMemo(
    () => (!zip && !destination && allFacilities.length > 0 ? sampleFacilities(allFacilities, 130) : []),
    [zip, destination, allFacilities],
  );

  // The map moves only when the place changes, never on a follow-up.
  useEffect(() => {
    if (!zip) return;
    const c = zipCentroids[zip];
    setFlyTo({ center: [c.lon, c.lat], zoom: 10.5, pitch: 55 });
  }, [zip, zipCentroids]);

  const updateProfile = useCallback((patch: Partial<Profile>) => {
    touchedRef.current = true;
    setDestination(null);
    setProfile((p) => ({ ...p, ...patch }));
  }, []);

  const locate = useCallback(
    (silent = false) => {
      if (!navigator.geolocation) {
        if (!silent) setLocationError("Location isn't available in this browser.");
        return;
      }
      if (!silent) {
        setLocating(true);
        setLocationError(null);
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocating(false);
          if (silent && touchedRef.current) return;
          const found = nearestZip(pos.coords.latitude, pos.coords.longitude, zipCentroids);
          if (!found) {
            if (!silent) setLocationError("Couldn't match your location to a ZIP code.");
            return;
          }
          setLocatedZip(found);
          setDestination(null);
          setProfile((p) => ({ ...p, zip: found }));
        },
        (err) => {
          setLocating(false);
          if (!silent) setLocationError(err.code === err.PERMISSION_DENIED ? "Location permission is off for this site." : "Couldn't get your location.");
        },
        { timeout: 10000, maximumAge: 300000 },
      );
    },
    [zipCentroids],
  );

  // Try the person's location once the data that can answer it has loaded,
  // so "what's near me" works with zero typing. Silent: no error if denied.
  const triedLocateRef = useRef(false);
  useEffect(() => {
    if (triedLocateRef.current || Object.keys(zipCentroids).length === 0 || allFacilities.length === 0) return;
    triedLocateRef.current = true;
    locate(true);
  }, [zipCentroids, allFacilities.length, locate]);

  // Traveler search: location only, from OpenStreetMap.
  useEffect(() => {
    if (!destination) {
      setInternational(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    findInternationalFacilities(destination)
      .then((result) => {
        if (cancelled) return;
        setInternational({ place: destination, result });
        if (result && !result.tooBroad) setFlyTo({ center: [result.lon, result.lat], zoom: 11, pitch: 40 });
        if (chatAbroadRef.current) push("assistant", summarizeInternational(result, destination));
      })
      .catch(() => {
        if (cancelled) return;
        setInternational({ place: destination, result: null });
        if (chatAbroadRef.current) push("assistant", `Couldn't reach the international facility directory for "${destination}" right now. Try again shortly.`);
      })
      .finally(() => {
        chatAbroadRef.current = false;
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [destination, push]);

  const searchAbroad = useCallback((place: string) => {
    touchedRef.current = true;
    setDestination(place.trim() || null);
  }, []);

  // Sends only the redacted text plus fplPct/tierPct, never income or
  // household size.
  const askWithContext = (message: string, p: Profile, fallback: string | null) => {
    const fpl = profileFplPct(p);
    setLoading(true);
    askAgent(message, {
      zipCode: validZip(p.zip),
      insuranceType: p.insuranceType,
      veteran: p.veteran,
      tierPct: fpl != null ? njCharityTier(fpl).patientPaysPct : null,
      fplPct: fpl,
      need: p.need,
    })
      .then((agentReply) => {
        if (agentReply?.reply) push("assistant", agentReply.reply);
        else if (fallback) push("assistant", fallback);
      })
      .finally(() => setLoading(false));
  };

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      touchedRef.current = true;
      push("user", text);
      const hint = redact(text);

      if (hint.destination) {
        chatAbroadRef.current = true;
        setDestination(hint.destination);
        return;
      }

      let placeNote = "";
      if (!hint.zipCode) {
        const place = findPlace(text, cityIndex);
        if (place && zipCentroids[place.zip]) {
          hint.zipCode = place.zip;
          placeNote = `Showing care near ${place.city}, ${place.state}.`;
        }
      }

      const prev = profileRef.current;
      const next = mergeProfile(prev, hint);
      const changed = (Object.keys(next) as (keyof Profile)[]).some((k) => next[k] !== prev[k]);
      setProfile(next);
      setDestination(null);

      const nextZip = validZip(next.zip);
      const nextFpl = profileFplPct(next);
      let answered = false;
      if (nextZip && changed) {
        const nearby = nearbyCare(allFacilities, allClinics, allUrgentCare, zipCentroids, nextZip, profileFocus(next));
        const reply = summarize({
          zipCode: nextZip,
          fplPct: nextFpl,
          insuranceType: next.insuranceType,
          veteran: next.veteran,
          need: next.need,
          emergency: next.emergency,
          facilities: nearby,
        });
        push("assistant", placeNote ? `${placeNote} ${reply}` : reply);
        answered = true;
      } else if (!nextZip && (LOCATION_QUESTION.test(text) || next.emergency)) {
        push(
          "assistant",
          `${next.emergency ? "If this is an emergency, call 911 or go to the nearest ER now. " : ""}Enter a ZIP code or city in the search bar, or use your location, and I'll show what's nearby.`,
        );
        answered = true;
      }

      askWithContext(
        hint.redactedMessage,
        next,
        answered ? null : "The assistant isn't available right now. The map and cost estimates still work: enter a ZIP code or city in the search bar.",
      );
    },
    // validZip only reads zipCentroids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allFacilities, allClinics, allUrgentCare, zipCentroids, cityIndex, push],
  );

  /** A suggested question answered on the spot from the person's own
   * inputs (src/lib/quickAnswers.ts). agentMessage, when given, also asks
   * the AI for a follow-up, e.g. drafting an application letter. */
  const answerLocally = useCallback(
    (question: string, reply: string, agentMessage?: string) => {
      touchedRef.current = true;
      push("user", question);
      push("assistant", reply);
      if (agentMessage) askWithContext(agentMessage, profileRef.current, "The assistant isn't available right now, so there's no drafted letter, but the steps above still apply.");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [push, zipCentroids],
  );

  // A preview marker opens a real search centered on that facility.
  const selectPreviewFacility = useCallback((facility: Facility) => updateProfile({ zip: facility.zip.slice(0, 5) }), [updateProfile]);

  return {
    profile,
    updateProfile,
    facilities,
    summary,
    placeName,
    locatedZip,
    fplPct,
    tierPct,
    flyTo,
    previewFacilities,
    destination,
    searchAbroad,
    internationalFacilities: (international?.result?.facilities ?? []) as InternationalFacility[],
    internationalSummary: international ? summarizeInternational(international.result, international.place) : null,
    messages,
    sendMessage,
    answerLocally,
    loading,
    locate,
    locating,
    locationError,
    selectPreviewFacility,
  };
}
