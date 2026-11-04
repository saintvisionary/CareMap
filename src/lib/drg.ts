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

// Two-tier grouping for the guided form, so it can show "what kind of
// surgery?" only after "surgery" is picked, instead of one long flat list.
// Our DRG coverage is hospital-inpatient only (CMS doesn't publish DRGs for
// outpatient visits), so categories without inpatient data (dental, a
// routine checkup) get a free-text item instead of a fake dropdown of
// procedures we have no cost data for.
export const OTHER_NEED = "other";
export const NEED_CATEGORIES: { category: string; items: string[] }[] = [
  { category: "Surgery or procedure", items: ["gallbladder surgery"] },
  { category: "Ongoing condition", items: ["pneumonia", "heart failure", "kidney/urinary infection", "COPD"] },
  { category: "Checkup or something else", items: [] },
];
