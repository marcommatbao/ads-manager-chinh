import type { BudgetDecisionInput, DecisionSource } from "./profit-evaluator";

const sourceKeys = ["dailySpend", "roas", "breakEvenRoas", "attributionCoverage"] as const;
const isDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** Client metrics are simulation inputs, never authoritative provider snapshots. */
export function validateSimulationInput(value: unknown): Pick<BudgetDecisionInput, "company" | "campaignId" | "campaignName" | "currentBudget" | "dailySpend" | "roas" | "breakEvenRoas" | "attributionCoverage" | "learningPhase" | "lastChangedAt"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_SIMULATION");
  const raw = value as Record<string, unknown>;
  for (const key of ["company", "campaignId", "campaignName"]) {
    if (typeof raw[key] !== "string" || !raw[key].trim() || raw[key].length > 200) throw new Error("INVALID_SIMULATION");
  }
  if (typeof raw.currentBudget !== "number" || !Number.isFinite(raw.currentBudget) || raw.currentBudget <= 0 || typeof raw.learningPhase !== "boolean") throw new Error("INVALID_SIMULATION");
  for (const key of sourceKeys) {
    const s = raw[key] as Partial<DecisionSource> | null;
    if (!s || typeof s !== "object" || Array.isArray(s) || typeof s.source !== "string" || !s.source.trim() || s.source.length > 200) throw new Error("INVALID_SIMULATION");
    if (!["complete", "partial", "stale", "unavailable"].includes(s.status ?? "") || !isDate(s.from) || !isDate(s.to) || s.from > s.to) throw new Error("INVALID_SIMULATION");
    if (typeof s.readAt !== "string" || !Number.isFinite(Date.parse(s.readAt))) throw new Error("INVALID_SIMULATION");
    if (s.value !== null && (typeof s.value !== "number" || !Number.isFinite(s.value) || s.value < 0)) throw new Error("INVALID_SIMULATION");
    if (s.status === "complete" && s.value === null) throw new Error("INVALID_SIMULATION");
    if (key === "attributionCoverage" && s.value !== null && s.value! > 1) throw new Error("INVALID_SIMULATION");
  }
  if (raw.lastChangedAt !== undefined && (typeof raw.lastChangedAt !== "string" || !Number.isFinite(Date.parse(raw.lastChangedAt)))) throw new Error("INVALID_SIMULATION");
  return {
    company: raw.company as string, campaignId: raw.campaignId as string, campaignName: raw.campaignName as string,
    currentBudget: raw.currentBudget, learningPhase: raw.learningPhase,
    dailySpend: raw.dailySpend as DecisionSource, roas: raw.roas as DecisionSource,
    breakEvenRoas: raw.breakEvenRoas as DecisionSource, attributionCoverage: raw.attributionCoverage as DecisionSource,
    ...(raw.lastChangedAt ? { lastChangedAt: raw.lastChangedAt as string } : {}),
  };
}
