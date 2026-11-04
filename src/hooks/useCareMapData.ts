import { useEffect, useState } from "react";
import type { Facility, ZipCentroid } from "../lib/types";

interface CareMapData {
  facilities: Facility[];
  zipCentroids: Record<string, ZipCentroid>;
  loading: boolean;
  error: string | null;
}

const STATES = ["NJ"];

export function useCareMapData(): CareMapData {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [zipCentroids, setZipCentroids] = useState<Record<string, ZipCentroid>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [zipRes, ...stateRes] = await Promise.all([
          fetch("./data/zip_centroids.json"),
          ...STATES.map((st) => fetch(`./data/states/${st}.json`)),
        ]);
        if (!zipRes.ok) throw new Error(`zip_centroids.json: ${zipRes.status}`);
        const zips = (await zipRes.json()) as Record<string, ZipCentroid>;

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

  return { facilities, zipCentroids, loading, error };
}
