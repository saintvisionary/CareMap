import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { CLINIC_COLOR, facilityTier, TIER_COLORS, URGENT_CARE_COLOR, type FacilityWithDistance } from "../lib/geo";
import type { InsuranceType } from "../lib/intake";
import type { InternationalFacility } from "../lib/international";
import type { Facility } from "../lib/types";
import type { MapFlyTo } from "../hooks/useCareMap";

// OpenFreeMap's "fiord" layout, repainted in neutral graphite: its own
// slate-blue palette competed with the data. Land, water and roads are
// separated by lightness alone, so tier colors are the only color on the map.
const STYLE_URL = "https://tiles.openfreemap.org/styles/fiord";
const LABEL_HALO = "rgba(0,0,0,0.65)";
const GRAPHITE: Record<string, Record<string, string>> = {
  background: { "background-color": "#1c1c1e" },
  water: { "fill-color": "#0f1011" },
  landcover_ice_shelf: { "fill-color": "#26262a" },
  landuse_residential: { "fill-color": "#222225" },
  landcover_wood: { "fill-color": "rgba(52,64,52,0.35)" },
  park: { "fill-color": "#1f2520" },
  park_outline: { "line-color": "#262c27" },
  waterway: { "line-color": "#131416" },
  building: { "fill-color": "rgba(44,44,48,0.8)" },
  tunnel_motorway_casing: { "line-color": "#2e2e32" },
  tunnel_motorway_inner: { "line-color": "#242427" },
  "aeroway-taxiway": { "line-color": "#2c2c30" },
  "aeroway-runway-casing": { "line-color": "#2c2c30" },
  "aeroway-area": { "fill-color": "#242427" },
  "aeroway-runway": { "line-color": "#242427" },
  road_area_pier: { "fill-color": "#1c1c1e" },
  road_pier: { "line-color": "#1c1c1e" },
  highway_path: { "line-color": "#2a2a2e" },
  highway_minor: { "line-color": "#2c2c30" },
  highway_major_casing: { "line-color": "#36363b" },
  highway_major_inner: { "line-color": "#2c2c30" },
  highway_major_subtle: { "line-color": "#2a2a2e" },
  highway_motorway_casing: { "line-color": "#3d3d42" },
  highway_motorway_inner: { "line-color": "#333337" },
  highway_motorway_subtle: { "line-color": "rgba(255,255,255,0.08)" },
  railway_transit: { "line-color": "#262629" },
  railway_transit_dashline: { "line-color": "#303034" },
  railway_service: { "line-color": "#262629" },
  railway_service_dashline: { "line-color": "#303034" },
  railway: { "line-color": "#262629" },
  railway_dashline: { "line-color": "#303034" },
  water_name: { "text-color": "#5d5f64", "text-halo-color": "#0f1011" },
  highway_name_other: { "text-color": "#8e8e93", "text-halo-color": "#1c1c1e" },
  highway_ref: { "text-color": "#a1a1a6", "text-halo-color": "#1c1c1e" },
  boundary_state: { "line-color": "rgba(255,255,255,0.14)" },
  "boundary_country_z0-4": { "line-color": "rgba(255,255,255,0.3)" },
  "boundary_country_z5-": { "line-color": "rgba(255,255,255,0.3)" },
  place_other: { "text-color": "#8e8e93", "text-halo-color": LABEL_HALO },
  place_suburb: { "text-color": "#8e8e93", "text-halo-color": LABEL_HALO },
  place_village: { "text-color": "#8e8e93", "text-halo-color": LABEL_HALO },
  place_town: { "text-color": "#aeaeb2", "text-halo-color": LABEL_HALO },
  place_city: { "text-color": "#d1d1d6", "text-halo-color": LABEL_HALO },
  place_city_large: { "text-color": "#e5e5ea", "text-halo-color": LABEL_HALO },
  place_state: { "text-color": "#6e6e73", "text-halo-color": LABEL_HALO },
  place_country_other: { "text-color": "#8e8e93", "text-halo-color": LABEL_HALO },
  place_country_minor: { "text-color": "#8e8e93", "text-halo-color": LABEL_HALO },
  place_country_major: { "text-color": "#aeaeb2", "text-halo-color": LABEL_HALO },
  place_continent: { "text-color": "#aeaeb2", "text-halo-color": LABEL_HALO },
};

function applyGraphite(map: maplibregl.Map) {
  for (const [id, paint] of Object.entries(GRAPHITE)) {
    if (!map.getLayer(id)) continue;
    for (const [prop, value] of Object.entries(paint)) map.setPaintProperty(id, prop as Parameters<typeof map.setPaintProperty>[1], value);
  }
}

// Neutral -- deliberately not one of TIER_COLORS, since international
// facilities never have a cost tier (see src/lib/international.ts).
const INTERNATIONAL_MARKER_COLOR = "#aeaeb2";

interface MapViewProps {
  facilities: FacilityWithDistance[];
  internationalFacilities: InternationalFacility[];
  previewFacilities: Facility[];
  fplPct: number | null;
  insuranceType: InsuranceType | null;
  flyTo: MapFlyTo | null;
  activeCcn: string | null;
  onSelectFacility: (ccn: string) => void;
  onSelectPreviewFacility: (facility: Facility) => void;
}

export function MapView({
  facilities,
  internationalFacilities,
  previewFacilities,
  fplPct,
  insuranceType,
  flyTo,
  activeCcn,
  onSelectFacility,
  onSelectPreviewFacility,
}: MapViewProps) {
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
    map.on("style.load", () => applyGraphite(map));
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
    // Center the place in the part of the map the panel doesn't cover:
    // right of the sidebar on desktop, above the half-height sheet on phones.
    const phone = window.innerWidth < 640;
    const padding = phone ? { top: 0, left: 0, right: 0, bottom: Math.round(window.innerHeight * 0.5) } : { top: 0, bottom: 0, right: 0, left: 420 };
    const run = () => map.flyTo({ center: flyTo.center, zoom: flyTo.zoom, pitch: flyTo.pitch, bearing: 0, duration: 1400, padding });
    if (map.loaded()) run();
    else map.once("load", run);
  }, [flyTo]);

  // Rebuilt only when the list of places changes. Typing an income or
  // changing insurance recolors the existing dots instead (below), so the
  // map doesn't replay its pop-in animation on every keystroke.
  const dotsRef = useRef<Map<string, { dot: HTMLDivElement; facility: FacilityWithDistance }>>(new Map());
  const tierInputs = useRef({ fplPct, insuranceType });
  tierInputs.current = { fplPct, insuranceType };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const marker of markersRef.current.values()) marker.remove();
    markersRef.current.clear();
    dotsRef.current.clear();

    facilities.forEach((f, i) => {
      if (f.lat == null || f.lon == null) return;
      // MapLibre sets a positioning `transform` directly on this outer element;
      // the pop-in animation must live on a child instead, or it clobbers that
      // transform and every marker collapses to (0,0).
      const el = document.createElement("div");
      el.className = "caremap-marker-wrap";
      el.title = f.name;
      const dot = document.createElement("div");
      dot.className = "caremap-marker";
      dot.style.animationDelay = `${Math.min(i, 30) * 40}ms`;
      // VA hospitals get a distinct double ring regardless of cost tier --
      // facility category and cost tier are separate pieces of information.
      if (f.type === "va_hospital") dot.style.boxShadow = "0 0 0 3px rgba(0,0,0,0.5), 0 0 0 5px rgba(255,255,255,0.7)";
      // Sliding-fee clinics are a rounded square, so they read as a different
      // kind of place by shape, not just color. One fixed color at every
      // income: a clinic sets its own fees, so a tier color (green
      // especially) would imply a price CareMap can't know.
      // Urgent care: a diamond (clip-path, since the dot's pop-in animation
      // owns its transform).
      if (f.type === "urgent_care") {
        dot.style.backgroundColor = URGENT_CARE_COLOR;
        dot.style.clipPath = "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)";
      } else if (f.type === "fqhc") {
        dot.style.backgroundColor = CLINIC_COLOR;
        dot.style.borderRadius = "4px";
      } else {
        dot.style.backgroundColor = TIER_COLORS[facilityTier(f, tierInputs.current.fplPct, tierInputs.current.insuranceType)];
        dotsRef.current.set(f.ccn, { dot, facility: f });
      }
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
      el.title = f.address ? `${label}, ${f.address}` : label;
      const dot = document.createElement("div");
      dot.className = "caremap-marker";
      dot.style.backgroundColor = INTERNATIONAL_MARKER_COLOR;
      dot.style.animationDelay = `${Math.min(i, 30) * 40}ms`;
      el.appendChild(dot);

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([f.lon, f.lat])
        .addTo(map);
      markersRef.current.set(`intl-${i}`, marker);
    });

    previewFacilities.forEach((f, i) => {
      if (f.lat == null || f.lon == null) return;
      const el = document.createElement("div");
      el.className = "caremap-marker-wrap";
      el.title = `${f.name}. Click to see nearby options`;
      const dot = document.createElement("div");
      dot.className = "caremap-marker caremap-marker-preview";
      // Capped, unlike the other two loops -- up to 130 of these at once,
      // and nobody should wait 9 seconds for the last one to stagger in.
      dot.style.animationDelay = `${Math.min(i, 24) * 15}ms`;
      el.appendChild(dot);
      el.addEventListener("click", () => onSelectPreviewFacility(f));

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([f.lon, f.lat])
        .addTo(map);
      markersRef.current.set(`preview-${f.ccn}`, marker);
    });
  }, [facilities, internationalFacilities, previewFacilities, onSelectFacility, onSelectPreviewFacility]);

  useEffect(() => {
    for (const { dot, facility } of dotsRef.current.values()) {
      dot.style.backgroundColor = TIER_COLORS[facilityTier(facility, fplPct, insuranceType)];
    }
  }, [fplPct, insuranceType]);

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
        style={{ boxShadow: "inset 0 0 160px 30px rgba(0,0,0,0.5)" }}
      />
    </>
  );
}
