import { useCallback, useEffect, useRef, useState } from "react";
import type { Facility, ZipCentroid } from "../lib/types";

interface CareMapData {
  facilities: Facility[];
  clinics: Facility[];
  urgentCare: Facility[];
  zipCentroids: Record<string, ZipCentroid>;
  loading: boolean;
  error: string | null;
  ensureStates: (states: string[]) => void;
}

// Clinic and urgent care files store fields every site shares once, under
// "defaults" (see scripts/build_fqhc.py), to keep the download small.
interface SiteFile {
  defaults?: Partial<Facility>;
  sites: Partial<Facility>[];
}

function withDefaults(data: SiteFile): Facility[] {
  return data.sites.map((s) => ({ ...data.defaults, ...s }) as Facility);
}

export function useCareMapData(): CareMapData {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [clinics, setClinics] = useState<Facility[]>([]);
  const [urgentCare, setUrgentCare] = useState<Facility[]>([]);
  const [zipCentroids, setZipCentroids] = useState<Record<string, ZipCentroid>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // States whose prices are loaded or loading, so each is fetched once.
  const requested = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // A light index first (every hospital, no prices): the map and the
        // nearby list can start from it while prices load per state.
        const [zipRes, indexRes] = await Promise.all([fetch("./data/zip_centroids.json"), fetch("./data/hospitals_index.json")]);
        if (!zipRes.ok) throw new Error(`zip_centroids.json: ${zipRes.status}`);
        if (!indexRes.ok) throw new Error(`hospitals_index.json: ${indexRes.status}`);
        const zips = (await zipRes.json()) as Record<string, ZipCentroid>;
        const index = (await indexRes.json()) as { facilities: Facility[] };
        if (!cancelled) {
          setZipCentroids(zips);
          setFacilities(index.facilities.map((f) => ({ ...f, drg_charges: {} })));
          setLoading(false);
        }

        // HRSA health center sites (scripts/build_fqhc.py). Optional: the
        // hospital map works without them, so a failed load is ignored.
        const clinicRes = await fetch("./data/fqhc_sites.json").catch(() => null);
        if (clinicRes?.ok && !cancelled) {
          const data = (await clinicRes.json()) as SiteFile;
          if (!cancelled) setClinics(withDefaults(data));
        }
        // NPI-registry urgent care sites (scripts/build_urgent_care.py), also optional.
        const ucRes = await fetch("./data/urgent_care_sites.json").catch(() => null);
        if (ucRes?.ok && !cancelled) {
          const data = (await ucRes.json()) as SiteFile;
          if (!cancelled) setUrgentCare(withDefaults(data));
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Fetch these states' per-procedure prices (once each) and fold them
   * into the hospital list. */
  const ensureStates = useCallback((states: string[]) => {
    const todo = states.filter((st) => st && !requested.current.has(st));
    if (todo.length === 0) return;
    todo.forEach((st) => requested.current.add(st));
    Promise.all(
      todo.map((st) =>
        fetch(`./data/states/${st}.json`)
          .then((r) => (r.ok ? (r.json() as Promise<{ facilities: Facility[] }>) : null))
          .catch(() => null),
      ),
    ).then((files) => {
      const prices = new Map<string, Facility["drg_charges"]>();
      files.forEach((file, i) => {
        if (!file) requested.current.delete(todo[i]);
        else for (const f of file.facilities) prices.set(f.ccn, f.drg_charges);
      });
      if (prices.size === 0) return;
      setFacilities((all) => all.map((f) => (prices.has(f.ccn) ? { ...f, drg_charges: prices.get(f.ccn)! } : f)));
    });
  }, []);

  return { facilities, clinics, urgentCare, zipCentroids, loading, error, ensureStates };
}
