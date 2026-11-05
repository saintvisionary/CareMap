import { useEffect, useState } from "react";
import type { Facility, ZipCentroid } from "../lib/types";

interface CareMapData {
  facilities: Facility[];
  clinics: Facility[];
  urgentCare: Facility[];
  zipCentroids: Record<string, ZipCentroid>;
  loading: boolean;
  error: string | null;
}

export function useCareMapData(): CareMapData {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [clinics, setClinics] = useState<Facility[]>([]);
  const [urgentCare, setUrgentCare] = useState<Facility[]>([]);
  const [zipCentroids, setZipCentroids] = useState<Record<string, ZipCentroid>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [zipRes, indexRes] = await Promise.all([
          fetch("./data/zip_centroids.json"),
          fetch("./data/states/index.json"),
        ]);
        if (!zipRes.ok) throw new Error(`zip_centroids.json: ${zipRes.status}`);
        if (!indexRes.ok) throw new Error(`states/index.json: ${indexRes.status}`);
        const zips = (await zipRes.json()) as Record<string, ZipCentroid>;
        const states = (await indexRes.json()) as string[];

        const stateRes = await Promise.all(states.map((st) => fetch(`./data/states/${st}.json`)));
        const all: Facility[] = [];
        for (const res of stateRes) {
          if (!res.ok) continue;
          const data = (await res.json()) as { facilities: Facility[] };
          all.push(...data.facilities);
        }

        if (!cancelled) {
          setZipCentroids(zips);
          setFacilities(all);
        }

        // HRSA health center sites (scripts/build_fqhc.py). Optional: the
        // hospital map works without them, so a failed load is ignored.
        const clinicRes = await fetch("./data/fqhc_sites.json").catch(() => null);
        if (clinicRes?.ok && !cancelled) {
          const data = (await clinicRes.json()) as { sites: Facility[] };
          if (!cancelled) setClinics(data.sites);
        }
        // NPI-registry urgent care sites (scripts/build_urgent_care.py), also optional.
        const ucRes = await fetch("./data/urgent_care_sites.json").catch(() => null);
        if (ucRes?.ok && !cancelled) {
          const data = (await ucRes.json()) as { sites: Facility[] };
          if (!cancelled) setUrgentCare(data.sites);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { facilities, clinics, urgentCare, zipCentroids, loading, error };
}
