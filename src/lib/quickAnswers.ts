// Instant, in-browser answers for the suggested questions above the chat.
// Each one is built from the same data and rules as the result cards, using
// what the person already entered, so it never waits on the AI and never
// asks them to repeat themselves. Every dollar figure is a CMS typical billed
// charge or a modeled tier applied to one, labeled as an estimate.
import { CARE_NEEDS, NEED_TO_DRG, needKind } from "./drg";
import type { FacilityWithDistance } from "./geo";
import { INSURANCE_LABELS } from "./insurance";
import type { InsuranceType } from "./intake";
import { STATE_FULL_NAMES } from "./places";
import { applyTier, charityTier, CHARITY_PROGRAM_NAMES, fqhcSlidingFee, isFederalCapHospital, MODELED_CHARITY_STATES, UPPER_BOUND_STATES } from "./policy";

export type Intent = "affordable" | "qualify" | "billing" | "apply" | "visitCost" | "bring" | "charityCare" | "slidingFee";

export interface QuickQuestion {
  label: string;
  intent: Intent;
}

export interface QuickContext {
  facilities: FacilityWithDistance[];
  fplPct: number | null;
  insuranceType: InsuranceType;
  need: string | null;
  veteran: boolean;
  /** The card the person has open, if any. */
  active: FacilityWithDistance | null;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const mi = (f: FacilityWithDistance) => `${f.distanceMiles.toFixed(1)} mi`;
const isHospital = (f: FacilityWithDistance) => f.type === "acute_care_hospital" || f.type === "critical_access_hospital";
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const CONFIRM = "These are estimates, confirm with billing office.";

function programFor(f: FacilityWithDistance): string | null {
  return f.charity_care_participant ? (CHARITY_PROGRAM_NAMES[f.state] ?? null) : null;
}

/** One program's name, or "each state's charity-care rules" when a
 * metro area spans states (East Orange, NJ is near New York hospitals). */
function programsOf(list: FacilityWithDistance[]): string {
  const names = new Set(list.map(programFor).filter(Boolean));
  return names.size === 1 ? [...names][0]! : "each state's charity-care rules";
}

function shareAt(f: FacilityWithDistance, fplPct: number | null): number | null {
  if (fplPct == null || !f.charity_care_participant) return null;
  return charityTier(f.state, fplPct, f.type, f.ownership, f.cost_cap_pct)?.patientPaysPct ?? null;
}

/** The questions worth asking for what's on screen right now. */
export function quickQuestions(ctx: QuickContext, hasPlace: boolean): QuickQuestion[] {
  if (!hasPlace) {
    return [
      { label: "How does hospital charity care work?", intent: "charityCare" },
      { label: "What's a sliding-fee clinic?", intent: "slidingFee" },
    ];
  }
  const kind = needKind(ctx.need);
  const uninsured = ctx.insuranceType === "uninsured";
  const active = ctx.active && isHospital(ctx.active) ? ctx.active : null;
  const out: QuickQuestion[] = [];
  if (kind === "clinic" || kind === "urgent") {
    out.push({ label: "What would a visit cost me?", intent: "visitCost" });
    out.push({ label: "What should I bring?", intent: "bring" });
  } else {
    out.push({
      label: kind === "hospital" ? (uninsured && ctx.fplPct != null ? "Which hospital costs me the least?" : "Which hospital charges the least?") : "Which of these is most affordable?",
      intent: "affordable",
    });
    if (uninsured && ctx.fplPct == null) out.push({ label: "Do I qualify for free care?", intent: "qualify" });
    if (uninsured) out.push({ label: active ? `Help me apply at ${active.name}` : "Help me apply for financial assistance", intent: "apply" });
  }
  out.push({ label: "What should I ask the billing office?", intent: "billing" });
  return out;
}

export function quickAnswer(intent: Intent, ctx: QuickContext): string {
  switch (intent) {
    case "affordable":
      return affordable(ctx);
    case "qualify":
      return qualify(ctx);
    case "billing":
      return billing(ctx);
    case "apply":
      return apply(ctx);
    case "visitCost":
      return visitCost(ctx);
    case "bring":
      return "For a sliding-fee discount, bring:\n- Proof of household income (pay stubs, a tax return or a benefits letter)\n- The number of people in your household\n- A photo ID\n- Your insurance card, if you have one\n\nCall ahead to ask what the clinic needs and whether you need an appointment.";
    case "charityCare":
      return `Many states require hospitals to give free or discounted care to lower-income patients, usually based on income as a percent of the federal poverty line. CareMap has the rules for ${MODELED_CHARITY_STATES.length} states. In every state, nonprofit hospitals must also have a financial assistance policy under federal law.\n\nEnter a ZIP code or city above and add your income under Your costs to see what applies near you.`;
    case "slidingFee":
      return "A federally funded health center (FQHC) charges by income. At or below the federal poverty line you get a full discount (a small flat fee may apply), up to twice the poverty line you pay on the clinic's own sliding scale, and no one is turned away for inability to pay. They offer checkups, sick visits and often dental and mental health care.";
  }
}

function affordable(ctx: QuickContext): string {
  const hospitals = ctx.facilities.filter(isHospital);
  const clinic = ctx.facilities.find((f) => f.type === "fqhc");
  const insured = ctx.insuranceType !== "uninsured";
  const kind = needKind(ctx.need);
  const drg = ctx.need ? NEED_TO_DRG[ctx.need] : null;
  const clinicLine = clinic ? `For everyday care, the nearest sliding-fee health center is ${clinic.name} (${mi(clinic)}).` : "";

  if (hospitals.length === 0) return clinicLine || "There's no hospital within 25 miles of here in CareMap's data.";

  if (insured) {
    const lines = [`With ${INSURANCE_LABELS[ctx.insuranceType].toLowerCase()} coverage, what you pay depends on your plan, not charity care. Ask your plan which nearby hospitals are in network.`];
    if (drg) {
      const priced = hospitals.filter((f) => drg.code in f.drg_charges).sort((a, b) => a.drg_charges[drg.code].avg_charge - b.drg_charges[drg.code].avg_charge);
      if (priced.length) {
        lines.push(`Lowest typical billed charges nearby for ${lower(drg.label)}, as a reference:`);
        lines.push(priced.slice(0, 3).map((f) => `- **${f.name}** (${mi(f)}): ${money(f.drg_charges[drg.code].avg_charge)}`).join("\n"));
        lines.push(CONFIRM);
      }
    }
    return lines.join("\n\n");
  }

  if (drg && kind === "hospital") {
    const priced = hospitals.filter((f) => drg.code in f.drg_charges);
    if (priced.length === 0) return `No hospital within 25 miles has billed-charge data for ${lower(drg.label)} yet. Ask each hospital's billing office for a self-pay estimate.${clinicLine ? `\n\n${clinicLine}` : ""}`;
    const ranked = priced
      .map((f) => {
        const charge = f.drg_charges[drg.code].avg_charge;
        const share = shareAt(f, ctx.fplPct);
        return { f, charge, owed: share != null ? applyTier(charge, share) : null, share };
      })
      .sort((a, b) => (a.owed ?? a.charge) - (b.owed ?? b.charge) || a.f.distanceMiles - b.f.distanceMiles);
    const withOwed = ranked.filter((r) => r.owed != null);
    const lines: string[] = [];
    if (withOwed.length) {
      const free = withOwed.filter((r) => r.owed === 0);
      if (free.length) {
        const closest = [...free].sort((a, b) => a.f.distanceMiles - b.f.distanceMiles).slice(0, 3);
        lines.push(
          `At your income, ${free.length} nearby hospital${free.length === 1 ? "" : "s"} with price data for ${lower(drg.label)} would cost you an estimated $0 under ${programsOf(free.map((r) => r.f))}. Closest:`,
        );
        lines.push(closest.map((r) => `- **${r.f.name}** (${mi(r.f)}, ${r.f.state}): $0 on a ${money(r.charge)} typical billed charge`).join("\n"));
      } else {
        lines.push(`Lowest estimated cost to you for ${lower(drg.label)}:`);
        lines.push(
          withOwed
            .slice(0, 3)
            .map((r) => `- **${r.f.name}** (${mi(r.f)}): ${UPPER_BOUND_STATES.has(r.f.state) ? "at most " : ""}${money(r.owed!)} (${r.share}% of a ${money(r.charge)} typical billed charge)`)
            .join("\n"),
        );
      }
    } else {
      lines.push(`Lowest typical billed charges nearby for ${lower(drg.label)}:`);
      lines.push(ranked.slice(0, 3).map((r) => `- **${r.f.name}** (${mi(r.f)}): ${money(r.charge)}`).join("\n"));
      if (ctx.fplPct == null) lines.push("Add your income under Your costs and I'll rank these by what you'd owe.");
      else if (ranked.some((r) => isFederalCapHospital(r.f))) lines.push("Nonprofit hospitals must offer financial assistance under federal law, and can't charge people who qualify more than what they generally bill insured patients. Ask each one's billing office.");
    }
    lines.push(CONFIRM);
    return lines.join("\n\n");
  }

  if (kind === "clinic" || kind === "urgent") return visitCost(ctx);

  // No specific need: which nearby hospitals' programs cover you at all.
  if (ctx.fplPct == null) {
    return [
      "It depends on what you need and your income. Pick what you need above and add your income under Your costs, and I'll rank these by what you'd likely owe.",
      clinicLine,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  const covered = hospitals
    .map((f) => ({ f, share: shareAt(f, ctx.fplPct) }))
    .filter((r) => r.share != null && r.share < 100)
    .sort((a, b) => a.share! - b.share! || a.f.distanceMiles - b.f.distanceMiles);
  const lines: string[] = [];
  if (covered.length) {
    const best = covered[0].share!;
    const top = covered.filter((r) => r.share === best).slice(0, 3);
    lines.push(
      best === 0
        ? `At your income, ${covered.filter((r) => r.share === 0).length} nearby hospitals would cover hospital care in full under ${programsOf(covered.filter((r) => r.share === 0).map((r) => r.f))}. Closest:`
        : `At your income, the lowest share nearby is ${UPPER_BOUND_STATES.has(top[0].f.state) ? "at most " : ""}${best}% of the typical billed charge under ${programsOf(top.map((r) => r.f))}:`,
    );
    lines.push(top.map((r) => `- **${r.f.name}** (${mi(r.f)})`).join("\n"));
    lines.push("Pick a procedure under Hospital care to see dollar amounts.");
  } else {
    const nonprofit = hospitals.filter(isFederalCapHospital).slice(0, 3);
    const state = STATE_FULL_NAMES[hospitals[0].state] ?? hospitals[0].state;
    lines.push(
      CHARITY_PROGRAM_NAMES[hospitals[0].state]
        ? `At your income, none of the nearby hospitals has a share CareMap can compute. Ask each billing office about financial assistance.`
        : `${state}'s charity-care rules aren't in CareMap yet.`,
    );
    if (nonprofit.length) {
      lines.push("These nearby nonprofit hospitals must offer financial assistance under federal law:");
      lines.push(nonprofit.map((f) => `- **${f.name}** (${mi(f)})`).join("\n"));
    }
  }
  if (clinicLine) lines.push(clinicLine);
  return lines.join("\n\n");
}

function qualify(ctx: QuickContext): string {
  if (ctx.insuranceType !== "uninsured") {
    return "Charity care is for people who are uninsured (in some states, underinsured too). With coverage, ask your plan about costs, and ask the hospital whether its financial assistance covers what your plan doesn't.";
  }
  const nearest = ctx.facilities.find(isHospital);
  const program = nearest ? programFor(nearest) : null;
  if (ctx.fplPct == null) {
    return `Add your household size and income under Your costs. ${program ? `${sentence(program)} is` : "Charity care is usually"} based on income as a percent of the federal poverty line, and CareMap works that out on this device.`;
  }
  if (!nearest) return "There's no hospital within 25 miles of here in CareMap's data.";
  const share = shareAt(nearest, ctx.fplPct);
  if (share === 0) return `Likely yes. At ${ctx.fplPct}% of the poverty line, ${program} covers hospital care in full at participating hospitals, including ${nearest.name}. ${CONFIRM}`;
  if (share != null && share < 100) return `Partly. At ${ctx.fplPct}% of the poverty line, ${program} sets your share at ${UPPER_BOUND_STATES.has(nearest.state) ? "at most " : ""}${share}% of the typical billed charge at ${nearest.name}. ${CONFIRM}`;
  if (share === 100) return `Not under ${program} at ${ctx.fplPct}% of the poverty line. Ask the billing office about the hospital's own financial assistance policy.`;
  return `CareMap can't compute a share for ${nearest.name} at your income. ${isFederalCapHospital(nearest) ? "As a nonprofit hospital it must have a financial assistance policy under federal law. " : ""}Ask the billing office for its application.`;
}

function billing(ctx: QuickContext): string {
  const target = ctx.active && isHospital(ctx.active) ? ctx.active : ctx.facilities.find(isHospital) ?? null;
  const program = target ? programFor(target) : null;
  const uninsured = ctx.insuranceType === "uninsured";
  const qs = [
    uninsured
      ? `"Do I qualify for ${program ?? "your financial assistance policy"}? Can you send me the application?"`
      : `"Is this hospital in network for my plan, and what will I owe after insurance?"`,
    uninsured ? `"Can I get a Good Faith Estimate?" (Uninsured and self-pay patients scheduling at least 3 business days ahead are entitled to one under federal law.)` : null,
    `"What's the self-pay price, and is there a discount for paying promptly?"`,
    `"Will doctors, anesthesia or labs bill me separately?"`,
    `"Can I get an itemized bill?"`,
    `"Can I set up a payment plan?"`,
  ].filter(Boolean);
  return `${target ? `Questions for ${target.name}'s billing office` : "Questions for the billing office"}:\n${qs.map((q) => `- ${q}`).join("\n")}`;
}

function apply(ctx: QuickContext): string {
  const target = ctx.active && isHospital(ctx.active) ? ctx.active : ctx.facilities.find(isHospital) ?? null;
  if (!target) return "Enter a ZIP code or city first, then pick a hospital.";
  const program = programFor(target);
  return [
    `To apply at **${target.name}**, ask its billing or financial assistance office for the ${program ?? "financial assistance"} application. Usually you'll need:`,
    "- Proof of income (pay stubs, a tax return or a benefits letter)\n- A photo ID and proof of address\n- Proof of your insurance status\n- The bill or account number, if you already have one",
    "I'm also drafting a letter you can send with it.",
  ].join("\n\n");
}

function visitCost(ctx: QuickContext): string {
  const clinic = ctx.facilities.find((f) => f.type === "fqhc");
  const urgent = ctx.facilities.find((f) => f.type === "urgent_care");
  const insured = ctx.insuranceType !== "uninsured";
  const care = CARE_NEEDS.find((n) => n.need === ctx.need);
  const lines: string[] = [];
  if (clinic) {
    lines.push(
      `For ${care?.phrase ?? "a visit"}, the nearest sliding-fee health center is **${clinic.name}** (${mi(clinic)}). ${fqhcSlidingFee(ctx.fplPct, insured).label}`,
    );
    lines.push("CareMap doesn't have clinic prices. Call and ask for their sliding fee schedule.");
  }
  if (urgent && needKind(ctx.need) === "urgent") {
    lines.push(`Nearest urgent care: **${urgent.name}** (${mi(urgent)}). CareMap has no urgent care prices, so ask about self-pay rates. For anything life-threatening, call 911.`);
  }
  if (!clinic && !urgent) lines.push("There's no clinic or urgent care within 25 miles of here in CareMap's data.");
  if (care?.note) lines.push(care.note);
  return lines.join("\n\n");
}

function lower(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}
