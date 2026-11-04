export interface DrgCharge {
  description: string;
  avg_charge: number;
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
}

export interface ZipCentroid {
  lat: number;
  lon: number;
}

// "insured" is distinct from "unknown": it means NJ Charity Care doesn't
// apply at all (program is uninsured/underinsured only), not that we
// haven't been told the person's income yet.
export type Tier = "free" | "reduced" | "full" | "unknown" | "insured";
