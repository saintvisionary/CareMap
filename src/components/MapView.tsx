import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { facilityTier, TIER_COLORS, type FacilityWithDistance } from "../lib/geo";
import type { InsuranceType } from "../lib/intake";
import type { InternationalFacility } from "../lib/international";
import type { MapFlyTo } from "../hooks/useCareMap";

// "dark" is nearly monochrome -- water, parks and residential land are all
// barely-distinguishable near-black grays. "fiord" keeps the same dark,
// Apple-Maps-night-mode feel but with real color separation (slate-blue
// water, blue-green parks, warm-light residential areas), so the basemap
// itself has visual interest even with zero facility markers on screen.
const STYLE_URL = "https://tiles.openfreemap.org/styles/fiord";
// Neutral/slate -- deliberately not one of TIER_COLORS, since international
// facilities never have a cost tier (see src/lib/international.ts).
const INTERNATIONAL_MARKER_COLOR = "#94a3b8";

interface MapViewProps {
  facilities: FacilityWithDistance[];
  internationalFacilities: InternationalFacility[];
  tierPct: number | null;
  insuranceType: InsuranceType | null;
  flyTo: MapFlyTo | null;
  activeCcn: string | null;
  onSelectFacility: (ccn: string) => void;
}

export function MapView({ facilities, internationalFacilities, tierPct, insuranceType, flyTo, activeCcn, onSelectFacility }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  // Tracks whether ambient idle rotation should still be running -- checked
  // before queuing each next step, so it stops cleanly without needing to
  // cancel anything mid-flight (see below for why a raw rAF/setBearing loop
  // couldn't do this safely).
  const idleActiveRef = useRef(true);

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
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__caremap_debug_map = map;

    // Ambient idle drift: the map has nothing to look at before a first
    // search (no markers yet), so a static frame reads as broken rather
    // than calm. A slow bearing creep gives it life without drawing
    // attention to itself -- stops permanently the moment the user does
    // anything, so it never fights real navigation. Respects reduced
    // motion by not starting at all.
    //
    // Built with map.rotateTo() chained on 'moveend', not a raw per-frame
    // setBearing() in a rAF loop -- that was the first attempt, and it
    // silently broke flyTo(): setBearing() mutates the camera directly
    // outside MapLibre's own animation/easing system, so a flyTo() call
    // arriving while that loop was still mid-flight didn't cleanly
    // interrupt it the way two of MapLibre's own animations interrupt each
    // other -- it just got dropped. rotateTo() runs through that same
    // internal animation system flyTo() does, so flyTo() now correctly
    // cancels and replaces it like any other in-progress camera animation.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion) {
      const stopIdle = () => {
        idleActiveRef.current = false;
      };
      const step = () => {
        if (!idleActiveRef.current) return;
        map.rotateTo((map.getBearing() + 12) % 360, { duration: 13000, easing: (t) => t });
      };
      map.on("moveend", () => {
        if (idleActiveRef.current) step();
      });
      const container = containerRef.current;
      container.addEventListener("pointerdown", stopIdle, { once: true });
      container.addEventListener("wheel", stopIdle, { once: true });
      map.once("load", step);
    }

    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    idleActiveRef.current = false; // a real destination beats ambient drift, permanently
    const run = () => map.flyTo({ center: flyTo.center, zoom: flyTo.zoom, pitch: flyTo.pitch, bearing: 0, duration: 1400 });
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
      const tier = facilityTier(f, tierPct, insuranceType);
      // MapLibre sets a positioning `transform` directly on this outer element;
      // the pop-in animation must live on a child instead, or it clobbers that
      // transform and every marker collapses to (0,0).
      const el = document.createElement("div");
      el.className = "caremap-marker-wrap";
      const dot = document.createElement("div");
      dot.className = "caremap-marker";
      dot.style.backgroundColor = TIER_COLORS[tier];
      dot.style.animationDelay = `${i * 70}ms`;
      // VA hospitals get a visually distinct ring regardless of cost tier --
      // facility category and cost tier are separate pieces of information.
      if (f.type === "va_hospital") dot.style.boxShadow = "0 0 0 4px rgba(56, 189, 248, 0.6)";
      el.appendChild(dot);
      el.addEventListener("click", () => onSelectFacility(f.ccn));

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([f.lon, f.lat])
        .addTo(map);
      markersRef.current.set(f.ccn, marker);
    });

    internationalFacilities.forEach((f, i) => {
      const el = document.createElement("div");
      el.className = "caremap-marker-wrap";
      const label = f.localName ? `${f.name} (${f.localName})` : f.name;
      el.title = f.address ? `${label} -- ${f.address}` : label;
      const dot = document.createElement("div");
      dot.className = "caremap-marker";
      dot.style.backgroundColor = INTERNATIONAL_MARKER_COLOR;
      dot.style.animationDelay = `${i * 70}ms`;
      el.appendChild(dot);

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([f.lon, f.lat])
        .addTo(map);
      markersRef.current.set(`intl-${i}`, marker);
    });
  }, [facilities, internationalFacilities, tierPct, insuranceType, onSelectFacility]);

  useEffect(() => {
    for (const [ccn, marker] of markersRef.current.entries()) {
      marker.getElement().classList.toggle("caremap-marker-active", ccn === activeCcn);
    }
  }, [activeCcn]);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0" />
      {/* Vignette: draws the eye inward and adds depth without touching the
          map itself -- a plain overlay, so it never interferes with tile
          loading, markers or interaction. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: "inset 0 0 180px 40px rgba(0,0,0,0.45)" }}
      />
    </>
  );
}
