export interface DrgCharge {
  // Descriptions live in public/data/drg_descriptions.json, not per facility.
  avg_charge: number;
  // CMS's average Medicare payments for the same procedure at this hospital
  // (present after a rebuild with build_data.py's v2 cache).
  avg_total_payment?: number;
  avg_medicare_payment?: number;
}

export interface Facility {
  ccn: string;
  name: string;
  type: string;
  ownership: string;
  has_er: boolean;
  star_rating: number | null;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  lat: number | null;
  lon: number | null;
  lat_lon_approximate?: boolean;
  drg_charges: Record<string, DrgCharge>;
  charity_care_participant: boolean;
  // HRSA health center sites only.
  operator?: string;
  phone?: string;
  website?: string;
  // CT only: upper-bound percent of charges under Conn. Gen. Stat. 19a-673.
  cost_cap_pct?: number;
}

export interface ZipCentroid {
  lat: number;
  lon: number;
}

// "insured" is distinct from "unknown": it means NJ Charity Care doesn't
// apply at all (program is uninsured/underinsured only), not that we
// haven't been told the person's income yet.
export type Tier = "free" | "reduced" | "full" | "unknown" | "insured";
