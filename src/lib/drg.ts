// Small, honest keyword -> DRG map covering what's actually in
// public/data/states/*.json today. Extend as more procedures get real
// coverage; never invent a DRG code that isn't in the dataset.
export const NEED_TO_DRG: Record<string, { code: string; label: string }> = {
  "gallbladder surgery": { code: "419", label: "Laparoscopic cholecystectomy" },
  pneumonia: { code: "193", label: "Simple pneumonia and pleurisy (with MCC)" },
  "heart failure": { code: "291", label: "Heart failure and shock (with MCC)" },
  "kidney/urinary infection": { code: "689", label: "Kidney and urinary tract infection (with MCC)" },
  COPD: { code: "190", label: "Chronic obstructive pulmonary disease (with MCC)" },
};
