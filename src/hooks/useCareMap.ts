import { useCallback, useState } from "react";
import { askAgent } from "../lib/agentClient";
import { facilitiesNear, type FacilityWithDistance } from "../lib/geo";
import { redact, type InsuranceType } from "../lib/intake";
import { summarize } from "../lib/summarize";
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
  tierPct: number | null;
  insuranceType: InsuranceType | null;
  veteran: boolean;
  flyTo: MapFlyTo | null;
  loading: boolean;
  sendMessage: (text: string) => void;
}

let nextId = 0;
const id = () => String(nextId++);

export function useCareMap(allFacilities: Facility[], zipCentroids: Record<string, ZipCentroid>): CareMapState {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: id(),
      role: "assistant",
      text: "Tell me where you are and what you need -- e.g. \"07018, family of 4, $52k, uninsured, need gallbladder surgery\".",
    },
  ]);
  const [facilities, setFacilities] = useState<FacilityWithDistance[]>([]);
  const [tierPct, setTierPct] = useState<number | null>(null);
  const [insuranceType, setInsuranceType] = useState<InsuranceType | null>(null);
  const [veteran, setVeteran] = useState(false);
  const [flyTo, setFlyTo] = useState<MapFlyTo | null>(null);
  const [loading, setLoading] = useState(false);

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      setMessages((m) => [...m, { id: id(), role: "user", text }]);

      const hint = redact(text);
      const nearby = hint.zipCode ? facilitiesNear(allFacilities, zipCentroids, hint.zipCode, 25) : [];
      setFacilities(nearby);
      setTierPct(hint.tierPct);
      setInsuranceType(hint.insuranceType);
      setVeteran(hint.veteran);

      if (hint.zipCode && zipCentroids[hint.zipCode]) {
        const c = zipCentroids[hint.zipCode];
        setFlyTo({ center: [c.lon, c.lat], zoom: 10.5, pitch: 55 });
      }

      const instantReply = summarize({
        zipCode: hint.zipCode,
        tierPct: hint.tierPct,
        insuranceType: hint.insuranceType,
        veteran: hint.veteran,
        need: hint.need,
        facilities: nearby,
      });
      setMessages((m) => [...m, { id: id(), role: "assistant", text: instantReply }]);

      setLoading(true);
      askAgent(hint.redactedMessage, {
        zipCode: hint.zipCode,
        insuranceType: hint.insuranceType,
        veteran: hint.veteran,
        tierPct: hint.tierPct,
      })
        .then((agentReply) => {
          if (agentReply?.reply) {
            setMessages((m) => [...m, { id: id(), role: "assistant", text: agentReply.reply }]);
          }
        })
        .finally(() => setLoading(false));
    },
    [allFacilities, zipCentroids],
  );

  return { messages, facilities, tierPct, insuranceType, veteran, flyTo, loading, sendMessage };
}
