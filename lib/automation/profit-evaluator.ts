import type { AutomationPolicy } from "@/lib/automation/policy";

export type DecisionAction = "increase_budget" | "decrease_budget" | "hold" | "blocked";
export type DecisionConfidence = "high" | "medium" | "insufficient";

export interface DecisionSource {
  value: number | null;
  source: string;
  from: string;
  to: string;
  readAt: string;
  status: "complete" | "partial" | "stale" | "unavailable";
}

export interface BudgetDecisionInput {
  company: string;
  campaignId: string;
  campaignName: string;
  currentBudget: number;
  dailySpend: DecisionSource;
  roas: DecisionSource;
  breakEvenRoas: DecisionSource;
  attributionCoverage: DecisionSource;
  learningPhase: boolean;
  lastChangedAt?: string;
  now?: Date;
  minBudget: number;
  maxBudget: number;
  maxIncreasePct: number;
  maxDecreasePct: number;
  minAttributionCoverage: number;
  cooldownHours: number;
  policy?: AutomationPolicy;
}

export interface BudgetDecision {
  idempotencyKey: string;
  action: DecisionAction;
  confidence: DecisionConfidence;
  reasonCode: string;
  reason: string;
  company: string;
  campaignId: string;
  campaignName: string;
  currentBudget: number;
  proposedBudget: number | null;
  delta: number | null;
  sourceRefs: string[];
  requiresApproval: boolean;
}

const usable = (s: DecisionSource): s is DecisionSource & { value: number } =>
  s.status === "complete" && s.value !== null && Number.isFinite(s.value);

function cooldownActive(lastChangedAt: string | undefined, now: Date, hours: number): boolean {
  return Boolean(lastChangedAt && now.getTime() - Date.parse(lastChangedAt) < hours * 3_600_000);
}

export function evaluateBudgetDecision(input: BudgetDecisionInput): BudgetDecision {
  const now = input.now ?? new Date();
  const sourceRefs = [input.dailySpend, input.roas, input.breakEvenRoas, input.attributionCoverage].map((s) => `${s.source}:${s.from}/${s.to}/${s.readAt}`);
  const idempotencyKey = `budget:${input.company}:${input.campaignId}:${now.toISOString().slice(0, 10)}`;
  const base = { idempotencyKey, company: input.company, campaignId: input.campaignId, campaignName: input.campaignName, currentBudget: input.currentBudget, sourceRefs, requiresApproval: true };

  if (input.policy && !input.policy.globalEnabled) return { ...base, action: "blocked", confidence: "insufficient", reasonCode: "automation_disabled", reason: "Automation policy đang tắt hoặc chưa được duyệt.", proposedBudget: null, delta: null };
  if (input.policy?.protectedCampaignIds.includes(input.campaignId)) return { ...base, action: "blocked", confidence: "insufficient", reasonCode: "protected_campaign", reason: "Campaign được bảo vệ bởi policy.", proposedBudget: null, delta: null };
  if (input.learningPhase) return { ...base, action: "blocked", confidence: "insufficient", reasonCode: "learning_phase", reason: "Campaign đang learning; chưa được tự động điều chỉnh.", proposedBudget: null, delta: null };
  if ([input.dailySpend, input.roas, input.breakEvenRoas, input.attributionCoverage].some((s) => !usable(s))) {
    return { ...base, action: "blocked", confidence: "insufficient", reasonCode: "source_unavailable", reason: "Thiếu hoặc stale nguồn dữ liệu quyết định.", proposedBudget: null, delta: null };
  }
  if (input.attributionCoverage.value === null || input.roas.value === null || input.breakEvenRoas.value === null) {
    return { ...base, action: "blocked", confidence: "insufficient", reasonCode: "source_unavailable", reason: "Thiếu giá trị nguồn sau kiểm tra chất lượng.", proposedBudget: null, delta: null };
  }
  const attributionCoverage = input.attributionCoverage.value;
  const roas = input.roas.value;
  const breakEvenRoas = input.breakEvenRoas.value;
  if (attributionCoverage < input.minAttributionCoverage) {
    return { ...base, action: "blocked", confidence: "insufficient", reasonCode: "attribution_coverage_low", reason: "Độ phủ attribution dưới ngưỡng an toàn.", proposedBudget: null, delta: null };
  }
  if (cooldownActive(input.lastChangedAt, now, input.cooldownHours)) {
    return { ...base, action: "blocked", confidence: "medium", reasonCode: "cooldown", reason: "Campaign đang trong thời gian cooldown.", proposedBudget: null, delta: null };
  }

  const increase = roas > breakEvenRoas * 1.2;
  const decrease = roas < breakEvenRoas * 0.9;
  if (!increase && !decrease) return { ...base, action: "hold", confidence: "high", reasonCode: "within_guardrail", reason: "ROAS nằm trong vùng an toàn.", proposedBudget: input.currentBudget, delta: 0 };

  const pct = increase ? input.maxIncreasePct : input.maxDecreasePct;
  const raw = input.currentBudget * (1 + (increase ? pct : -pct) / 100);
  const proposedBudget = Math.round(Math.min(input.maxBudget, Math.max(input.minBudget, raw)));
  if (proposedBudget === input.currentBudget) return { ...base, action: "hold", confidence: "high", reasonCode: "budget_boundary", reason: "Thay đổi bị chặn bởi floor/ceiling ngân sách.", proposedBudget, delta: 0 };
  return { ...base, action: increase ? "increase_budget" : "decrease_budget", confidence: "high", reasonCode: increase ? "roas_above_break_even" : "roas_below_break_even", reason: increase ? "ROAS vượt break-even với biên an toàn." : "ROAS thấp hơn break-even.", proposedBudget, delta: proposedBudget - input.currentBudget };
}
