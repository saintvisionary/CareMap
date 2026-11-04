import type { InsuranceType } from "./intake";

export const INSURANCE_LABELS: Record<InsuranceType, string> = {
  uninsured: "Uninsured",
  medicaid: "Medicaid",
  medicare: "Medicare",
  private: "Private insurance",
  va_tricare: "VA / Tricare",
  unsure: "Not sure",
};

/** Every modeled state's charity-care formula (currently NJ, WA -- see
 * src/lib/policy.ts) applies only when insuranceType is "uninsured" -- every
 * other category needs its own guidance instead of a false "$0", since each
 * program's own rule is uninsured/underinsured (NJ's explicitly says "and
 * not Medicaid-eligible"; WA's is applied the same conservative way). Kept
 * state-agnostic ("charity care", not "NJ Charity Care") since this fires
 * for any modeled state's facility, not just NJ's. */
export function insuranceGuidance(insuranceType: InsuranceType): string {
  switch (insuranceType) {
    case "medicaid":
      return "Medicaid generally covers hospital care at little to no direct cost to you. Charity care doesn't apply since you're not uninsured -- contact your Medicaid plan with billing questions.";
    case "medicare":
      return "Charity care doesn't apply since you're not uninsured -- contact Medicare or your Medicare Advantage plan for your specific costs.";
    case "private":
      return "Since you have private insurance, charity care doesn't apply to you -- contact your insurer for your specific copay/deductible.";
    case "va_tricare":
      return "Charity care doesn't apply to VA/Tricare coverage -- consider care through the VA system, and contact Tricare for costs outside it.";
    case "unsure":
      return "Charity care applies only if you're uninsured or underinsured -- confirm your coverage status for a personal estimate.";
    case "uninsured":
      return "";
  }
}
