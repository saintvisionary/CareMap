import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { facilityTier, TIER_COLORS, type FacilityWithDistance } from "../lib/geo";
import type { MapFlyTo } from "../hooks/useCareMap";

const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

interface MapViewProps {
  facilities: FacilityWithDistance[];
  tierPct: number | null;
  flyTo: MapFlyTo | null;
  activeCcn: string | null;
  onSelectFacility: (ccn: string) => void;
}

export function MapView({ facilities, tierPct, flyTo, activeCcn, onSelectFacility }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [-74.4, 40.1],
      zoom: 6.6,
      pitch: 30,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    const run = () => map.flyTo({ center: flyTo.center, zoom: flyTo.zoom, pitch: flyTo.pitch, duration: 1400 });
    if (map.loaded()) run();
    else map.once("load", run);
  }, [flyTo]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const marker of markersRef.current.values()) marker.remove();
    markersRef.current.clear();

    facilities.forEach((f, i) => {
      if (f.lat == null || f.lon == null) return;
      const tier = facilityTier(f, tierPct);
      const el = document.createElement("div");
      el.className = "caremap-marker";
      el.style.backgroundColor = TIER_COLORS[tier];
      el.style.animationDelay = `${i * 70}ms`;
      el.addEventListener("click", () => onSelectFacility(f.ccn));

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([f.lon, f.lat])
        .addTo(map);
      markersRef.current.set(f.ccn, marker);
    });
  }, [facilities, tierPct, onSelectFacility]);

  useEffect(() => {
    for (const [ccn, marker] of markersRef.current.entries()) {
      marker.getElement().classList.toggle("caremap-marker-active", ccn === activeCcn);
    }
  }, [activeCcn]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
