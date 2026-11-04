import type { InsuranceType } from "./intake";

export const INSURANCE_LABELS: Record<InsuranceType, string> = {
  uninsured: "Uninsured",
  medicaid: "Medicaid",
  medicare: "Medicare",
  private: "Private insurance",
  va_tricare: "VA / Tricare",
  unsure: "Not sure",
};

/** NJ Charity Care applies only when insuranceType is "uninsured" -- every
 * other category needs its own guidance instead of a false "$0", since the
 * program's own rule is "uninsured/underinsured and not Medicaid-eligible". */
export function insuranceGuidance(insuranceType: InsuranceType): string {
  switch (insuranceType) {
    case "medicaid":
      return "Medicaid generally covers hospital care at little to no direct cost to you. NJ Charity Care doesn't apply since you're not uninsured -- contact your Medicaid plan with billing questions.";
    case "medicare":
      return "NJ Charity Care doesn't apply since you're not uninsured -- contact Medicare or your Medicare Advantage plan for your specific costs.";
    case "private":
      return "Since you have private insurance, NJ Charity Care doesn't apply to you -- contact your insurer for your specific copay/deductible.";
    case "va_tricare":
      return "NJ Charity Care doesn't apply to VA/Tricare coverage -- consider care through the VA system, and contact Tricare for costs outside it.";
    case "unsure":
      return "NJ Charity Care applies only if you're uninsured or underinsured -- confirm your coverage status for a personal estimate.";
    case "uninsured":
      return "";
  }
}
