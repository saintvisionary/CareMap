// Small, honest keyword -> DRG map covering what's actually in
// public/data/states/*.json today. Extend as more procedures get real
// coverage; never invent a DRG code that isn't in the dataset. Each code
// below was picked from the actual nationwide build (538 unique Medicare
// Severity-DRG codes across every state file) by taking whichever severity
// variant (with/without CC or MCC) has the most facility coverage for that
// condition -- that's the variant a nearby hospital is most likely to have
// real billed-charge data for.
export const NEED_TO_DRG: Record<string, { code: string; label: string }> = {
  // The one exception to the most-coverage rule: 418 ("with CC") has ~3.7x the
  // coverage, but a planned gallbladder surgery is usually uncomplicated, and
  // 418 would show everyone the higher with-complications price.
  "gallbladder surgery": { code: "419", label: "Laparoscopic cholecystectomy" },
  pneumonia: { code: "193", label: "Simple pneumonia and pleurisy (with MCC)" },
  "heart failure": { code: "291", label: "Heart failure and shock (with MCC)" },
  "kidney/urinary infection": { code: "689", label: "Kidney and urinary tract infection (with MCC)" },
  COPD: { code: "190", label: "Chronic obstructive pulmonary disease (with MCC)" },

  // Heart & circulation
  "heart attack": { code: "280", label: "Acute myocardial infarction (with MCC)" },
  "irregular heartbeat": { code: "309", label: "Cardiac arrhythmia and conduction disorders (with CC)" },
  "chest pain": { code: "313", label: "Chest pain" },
  "stent or angioplasty": { code: "322", label: "Percutaneous cardiovascular procedure with intraluminal device" },
  "heart bypass surgery": { code: "236", label: "Coronary bypass without cardiac catheterization" },
  "pacemaker implant": { code: "243", label: "Permanent cardiac pacemaker implant (with CC)" },
  "high blood pressure crisis": { code: "305", label: "Hypertension" },
  fainting: { code: "312", label: "Syncope and collapse" },
  "heart valve replacement (TAVR)": { code: "267", label: "Endovascular cardiac valve replacement (without MCC)" },
  "poor circulation in the legs": { code: "300", label: "Peripheral vascular disorders (with CC)" },

  // Lungs & breathing
  "asthma or bronchitis flare": { code: "202", label: "Bronchitis and asthma (with CC/MCC)" },
  "blood clot in the lung": { code: "175", label: "Pulmonary embolism (with MCC)" },
  "collapsed lung": { code: "200", label: "Pneumothorax (with CC)" },
  "serious respiratory infection": { code: "177", label: "Respiratory infections and inflammations (with MCC)" },
  "respiratory failure": { code: "189", label: "Pulmonary edema and respiratory failure" },

  // Stomach & digestion
  "stomach bleeding": { code: "378", label: "Gastrointestinal hemorrhage (with CC)" },
  "bowel surgery": { code: "330", label: "Major small and large bowel procedures (with CC)" },
  "stomach or bowel blockage": { code: "389", label: "Gastrointestinal obstruction (with CC)" },
  "acid reflux or gastritis": { code: "392", label: "Esophagitis, gastroenteritis and digestive disorders" },
  pancreatitis: { code: "439", label: "Disorders of the pancreas (with CC)" },
  "liver disease": { code: "432", label: "Cirrhosis and alcoholic hepatitis (with MCC)" },
  "hernia repair": { code: "354", label: "Hernia procedure (with CC)" },
  "appendix removal": { code: "398", label: "Appendix procedure (with CC)" },

  // Kidney & bladder
  "kidney failure": { code: "683", label: "Renal failure (with CC)" },
  "kidney stones": { code: "694", label: "Urinary stones" },
  "kidney transplant": { code: "652", label: "Kidney transplant" },
  "bladder problems": { code: "654", label: "Major bladder procedure (with CC)" },

  // Bones, joints & muscles
  "hip or femur fracture": { code: "481", label: "Hip and femur procedure (with CC)" },
  "hip or knee replacement": { code: "470", label: "Major hip or knee joint replacement" },
  "back or spine problems": { code: "552", label: "Medical back problems" },
  "spinal fusion surgery": { code: "460", label: "Spinal fusion, except cervical" },
  "broken bone, sprain or dislocation": { code: "563", label: "Fracture, sprain, strain or dislocation" },
  "bone or joint disease": { code: "554", label: "Bone diseases and arthropathies" },
  "arm or leg procedure": { code: "493", label: "Lower extremity or humerus procedure (with CC)" },

  // Brain & nervous system
  stroke: { code: "065", label: "Intracranial hemorrhage or cerebral infarction (with CC)" },
  "mini-stroke (TIA)": { code: "069", label: "Transient ischemia" },
  seizures: { code: "101", label: "Seizures" },
  "head injury": { code: "083", label: "Traumatic stupor and coma, over 1 hour (with CC)" },
  "dizziness or balance problems": { code: "149", label: "Dysequilibrium" },
  "migraine or severe headaches": { code: "103", label: "Headaches" },
  "nerve disorder": { code: "092", label: "Other disorders of the nervous system (with CC)" },

  // Mental health & substance use
  "severe depression": { code: "881", label: "Depressive neuroses" },
  "psychosis or severe mental health crisis": { code: "885", label: "Psychoses" },
  "alcohol or drug withdrawal": { code: "897", label: "Alcohol or drug abuse / dependence" },
  "acute stress or crisis": { code: "880", label: "Acute adjustment reaction and psychosocial dysfunction" },

  // Ear, nose, mouth & throat
  "ear or throat infection": { code: "153", label: "Otitis media and upper respiratory infection" },
  "severe dental or oral infection": { code: "158", label: "Dental and oral diseases (with CC)" },
  "other ear, nose or throat procedure": { code: "144", label: "Other ear, nose, mouth and throat procedure (with CC)" },

  // Eyes
  "eye disorder or infection": { code: "125", label: "Other disorders of the eye" },

  // Skin
  "skin infection (cellulitis)": { code: "603", label: "Cellulitis" },
  "burn injury": { code: "935", label: "Non-extensive burns" },

  // Blood, immune system & cancer care
  "anemia or blood disorder": { code: "812", label: "Red blood cell disorders" },
  "blood clotting disorder": { code: "813", label: "Coagulation disorders" },
  chemotherapy: { code: "847", label: "Chemotherapy (with CC)" },
  "leukemia or lymphoma": { code: "840", label: "Lymphoma and non-acute leukemia (with MCC)" },

  // Diabetes & hormones
  "diabetes complications": { code: "638", label: "Diabetes (with CC)" },
  "thyroid or hormone disorder": { code: "644", label: "Endocrine disorders (with CC)" },
  "dehydration or electrolyte imbalance": { code: "641", label: "Nutrition, metabolism, fluid and electrolyte disorders (without MCC)" },

  // Women's reproductive health
  "uterine or ovarian condition": { code: "742", label: "Uterine and adnexa procedure, non-malignant" },
  "gynecologic cancer care": { code: "737", label: "Uterine and adnexa procedure for ovarian or adnexal malignancy" },

  // Men's reproductive health
  "enlarged prostate": { code: "713", label: "Transurethral prostatectomy" },

  // Serious infection
  "sepsis or bloodstream infection": { code: "871", label: "Septicemia or severe sepsis (with MCC)" },
  "infection after surgery or injury": { code: "862", label: "Postoperative and post-traumatic infections (with MCC)" },

  // Weight-loss surgery
  "weight-loss (bariatric) surgery": { code: "621", label: "Procedure for obesity" },
};

// Everyday needs come first in the form: most people are looking for a
// checkup or a sick visit, not a procedure. None of these has a Medicare
// inpatient price, so they search clinics and urgent care instead of
// claiming a hospital charge. Keys are what intake.ts's parser returns.
export type NeedKind = "clinic" | "urgent" | "hospital";
export const CARE_NEEDS: { need: string; label: string; phrase: string; kind: NeedKind; note?: string }[] = [
  { need: "checkup", label: "Checkup", phrase: "a checkup", kind: "clinic" },
  { need: "sick visit", label: "Sick visit", phrase: "a sick visit", kind: "urgent" },
  { need: "minor injury", label: "Minor injury", phrase: "a minor injury", kind: "urgent" },
  { need: "dental care", label: "Dental", phrase: "dental care", kind: "clinic", note: "Many health centers offer dental care on the same sliding fee. Call to confirm." },
  { need: "pregnancy care", label: "Pregnancy", phrase: "pregnancy care", kind: "clinic" },
  { need: "counseling", label: "Mental health", phrase: "counseling or therapy", kind: "clinic", note: "If you're in crisis or thinking about suicide, call or text 988 any time." },
];

export function needKind(need: string | null): NeedKind | null {
  if (!need) return null;
  if (need in NEED_TO_DRG) return "hospital";
  return CARE_NEEDS.find((n) => n.need === need)?.kind ?? null;
}

/** Sentence case for display; the lowercase keys stay as the parser's values. */
export function needLabel(need: string): string {
  const care = CARE_NEEDS.find((n) => n.need === need);
  if (care) return care.label;
  return need.charAt(0).toUpperCase() + need.slice(1);
}

// Hospital procedures, grouped for the form's picker. Groups and items run
// from most to least common, so everyday conditions aren't buried under
// cardiac surgery. Coverage is hospital-inpatient only (CMS doesn't publish
// DRGs for outpatient visits).
export const NEED_CATEGORIES: { category: string; items: string[] }[] = [
  {
    category: "Stomach & digestion",
    items: [
      "acid reflux or gastritis",
      "gallbladder surgery",
      "hernia repair",
      "appendix removal",
      "stomach or bowel blockage",
      "stomach bleeding",
      "pancreatitis",
      "liver disease",
      "bowel surgery",
    ],
  },
  {
    category: "Bones, joints & muscles",
    items: [
      "back or spine problems",
      "broken bone, sprain or dislocation",
      "hip or knee replacement",
      "bone or joint disease",
      "hip or femur fracture",
      "arm or leg procedure",
      "spinal fusion surgery",
    ],
  },
  {
    category: "Heart & circulation",
    items: [
      "chest pain",
      "high blood pressure crisis",
      "irregular heartbeat",
      "fainting",
      "heart failure",
      "heart attack",
      "stent or angioplasty",
      "pacemaker implant",
      "poor circulation in the legs",
      "heart valve replacement (TAVR)",
      "heart bypass surgery",
    ],
  },
  {
    category: "Lungs & breathing",
    items: ["asthma or bronchitis flare", "pneumonia", "COPD", "serious respiratory infection", "blood clot in the lung", "collapsed lung", "respiratory failure"],
  },
  {
    category: "Kidney & bladder",
    items: ["kidney/urinary infection", "kidney stones", "bladder problems", "kidney failure", "kidney transplant"],
  },
  {
    category: "Brain & nervous system",
    items: ["migraine or severe headaches", "dizziness or balance problems", "head injury", "seizures", "mini-stroke (TIA)", "stroke", "nerve disorder"],
  },
  { category: "Diabetes & hormones", items: ["diabetes complications", "dehydration or electrolyte imbalance", "thyroid or hormone disorder"] },
  { category: "Skin", items: ["skin infection (cellulitis)", "burn injury"] },
  {
    category: "Ear, nose, mouth & throat",
    items: ["ear or throat infection", "severe dental or oral infection", "other ear, nose or throat procedure"],
  },
  {
    category: "Mental health & substance use",
    items: ["severe depression", "acute stress or crisis", "alcohol or drug withdrawal", "psychosis or severe mental health crisis"],
  },
  { category: "Women's health", items: ["uterine or ovarian condition", "gynecologic cancer care"] },
  { category: "Men's health", items: ["enlarged prostate"] },
  { category: "Eyes", items: ["eye disorder or infection"] },
  { category: "Serious infection", items: ["sepsis or bloodstream infection", "infection after surgery or injury"] },
  {
    category: "Blood & cancer care",
    items: ["anemia or blood disorder", "blood clotting disorder", "chemotherapy", "leukemia or lymphoma"],
  },
  { category: "Weight-loss surgery", items: ["weight-loss (bariatric) surgery"] },
];
