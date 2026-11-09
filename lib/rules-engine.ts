// ============================================================
// Rules Engine — Core evaluation logic for automation rules
// Evaluates campaign metrics against rule conditions
// Supports CPL, CTR drop, frequency, spend, and company filters
// ============================================================

import type {
  AutomationRule,
  Condition,
  CampaignMetrics,
  RuleExecutionResult,
  ActionType,
} from "@/lib/automation-shared";

// Extended metrics — adds daily_budget to CampaignMetrics
// (other fields like cpl, ctr_drop_pct, days_running, etc. are in CampaignMetrics)
export interface ExtendedMetrics extends CampaignMetrics {
  daily_budget: number; // Daily budget in VND (not in base CampaignMetrics)
}

// Rule with company filter (extends AutomationRule)
export interface EnhancedRule extends AutomationRule {
  company?: string | "all";       // Company filter
  cooldownDays?: number;                   // Cooldown in days (alternative to hours)
  targetCampaignIds?: string[];            // Specific campaign IDs (empty = all)
  tags?: string[];                         // For grouping/filtering
}

// Evaluation result for a single campaign against a single rule
export interface EvaluationResult {
  ruleId: string;
  ruleName: string;
  campaignId: string;
  campaignName: string;
  conditionsMet: boolean;
  conditionResults: Array<{
    metric: string;
    operator: string;
    threshold: number;
    actual: number;
    passed: boolean;
  }>;
  actionsToTake: ActionType[];
  skipped: boolean;
  skipReason?: string;
}

// ─────────────────────────────────────────────
// Core Condition Evaluator
// ─────────────────────────────────────────────

export function evaluateCondition(
  metrics: ExtendedMetrics,
  condition: Condition
): { passed: boolean; actual: number } {
  const metricMap: Record<string, number | null> = {
    ctr: metrics.ctr,
    cpc: metrics.cpc,
    cpm: metrics.cpm,
    roas: metrics.roas,
    spend: metrics.spend,
    impressions: metrics.impressions,
    frequency: metrics.frequency,
    budget_used_pct: metrics.budget_used_pct,
    conversions: metrics.conversions,
    cpl: metrics.cpl,
    ctr_drop_pct: metrics.ctr_drop_pct,
    days_running: metrics.days_running,
    remaining_budget: metrics.remaining_budget,
    daily_budget: metrics.daily_budget,
    days_until_end: metrics.days_until_end ?? 0, // Handled below specifically
    end_date_is_set: metrics.end_date_is_set,
  };

  // Special case: if we are testing 'days_until_end' but the campaign has NO end date, we should fail it immediately unless checking for NULL
  if (condition.metric === "days_until_end" && metrics.days_until_end === null) {
    return { passed: false, actual: 0 };
  }

  // Chỉ số CHƯA ĐO ĐƯỢC (null) thì điều kiện KHÔNG khớp — không được rơi về 0.
  // Với `roas`, rơi về 0 nghĩa là mọi chiến dịch lead-gen (không có giá trị
  // `purchase` nên chưa bao giờ đo được doanh thu) đều thoả `roas < 0.8` và bị
  // luật "Tắt campaign lỗ" tắt thật. Xem chú thích ở CampaignMetrics.roas.
  const raw = metricMap[condition.metric];
  if (raw === null || raw === undefined) {
    return { passed: false, actual: 0 };
  }
  const actual = raw;

  let passed = false;
  switch (condition.operator) {
    case ">":  passed = actual > condition.value; break;
    case "<":  passed = actual < condition.value; break;
    case ">=": passed = actual >= condition.value; break;
    case "<=": passed = actual <= condition.value; break;
    case "==": passed = actual === condition.value; break;
    case "increased_by_pct": passed = actual > condition.value; break;
    case "decreased_by_pct": passed = actual > condition.value; break;
  }

  return { passed, actual };
}

// ─────────────────────────────────────────────
// Evaluate all conditions for a rule
// ─────────────────────────────────────────────

export function evaluateRuleConditions(
  rule: AutomationRule | EnhancedRule,
  metrics: ExtendedMetrics
): { allMet: boolean; results: EvaluationResult["conditionResults"] } {
  const results = rule.conditions.map(c => {
    const { passed, actual } = evaluateCondition(metrics, c);
    return {
      metric: c.metric,
      operator: c.operator,
      threshold: c.value,
      actual,
      passed,
    };
  });

  const allMet = rule.conditionLogic === "AND"
    ? results.every(r => r.passed)
    : results.some(r => r.passed);

  return { allMet, results };
}

// ─────────────────────────────────────────────
// Check cooldown
// ─────────────────────────────────────────────

export function isInCooldown(
  rule: AutomationRule | EnhancedRule,
  lastTriggeredAt?: string
): { inCooldown: boolean; hoursRemaining: number } {
  if (!lastTriggeredAt) return { inCooldown: false, hoursRemaining: 0 };

  const lastTriggered = new Date(lastTriggeredAt).getTime();
  const now = Date.now();
  const hoursSince = (now - lastTriggered) / (1000 * 60 * 60);

  // Use cooldownDays if available, otherwise cooldown (hours)
  const enhanced = rule as EnhancedRule;
  const cooldownHours = enhanced.cooldownDays
    ? enhanced.cooldownDays * 24
    : rule.cooldown;

  const inCooldown = hoursSince < cooldownHours;
  const hoursRemaining = Math.max(0, cooldownHours - hoursSince);

  return { inCooldown, hoursRemaining };
}

// ─────────────────────────────────────────────
// Check company match
// ─────────────────────────────────────────────

export function matchesCompany(
  rule: EnhancedRule,
  campaignName: string
): boolean {
  if (!rule.company || rule.company === "all") return true;

  const name = campaignName.toUpperCase();
  if (rule.company === "MBC") return name.startsWith("MBC");
  if (rule.company === "MBI") return name.startsWith("MBI");
  return true;
}

// ─────────────────────────────────────────────
// Full Evaluation: Rule × Campaign
// ─────────────────────────────────────────────

export function evaluateRule(
  rule: AutomationRule | EnhancedRule,
  campaignId: string,
  campaignName: string,
  metrics: ExtendedMetrics,
  lastTriggeredAt?: string
): EvaluationResult {
  // Check company filter
  const enhanced = rule as EnhancedRule;
  if (!matchesCompany(enhanced, campaignName)) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      campaignId,
      campaignName,
      conditionsMet: false,
      conditionResults: [],
      actionsToTake: [],
      skipped: true,
      skipReason: `Company filter: rule is for ${enhanced.company}, campaign is ${campaignName.slice(0, 3)}`,
    };
  }

  // Check specific campaign targeting
  if (enhanced.targetCampaignIds && enhanced.targetCampaignIds.length > 0) {
    if (!enhanced.targetCampaignIds.includes(campaignId)) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        campaignId,
        campaignName,
        conditionsMet: false,
        conditionResults: [],
        actionsToTake: [],
        skipped: true,
        skipReason: "Campaign not in target list",
      };
    }
  }

  // Check cooldown
  const { inCooldown, hoursRemaining } = isInCooldown(rule, lastTriggeredAt);
  if (inCooldown) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      campaignId,
      campaignName,
      conditionsMet: false,
      conditionResults: [],
      actionsToTake: [],
      skipped: true,
      skipReason: `Cooldown: ${Math.ceil(hoursRemaining)}h remaining`,
    };
  }

  // Check learning phase guard
  if (rule.respectLearningPhase && metrics.days_running < 3) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      campaignId,
      campaignName,
      conditionsMet: false,
      conditionResults: [],
      actionsToTake: [],
      skipped: true,
      skipReason: `Learning phase: campaign only ${metrics.days_running} days old`,
    };
  }

  // Evaluate conditions
  const { allMet, results } = evaluateRuleConditions(rule, metrics);

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    campaignId,
    campaignName,
    conditionsMet: allMet,
    conditionResults: results,
    actionsToTake: allMet ? rule.actions.map(a => a.type) : [],
    skipped: false,
  };
}

// ─────────────────────────────────────────────
// Build ExtendedMetrics from campaign data
// ─────────────────────────────────────────────

export function buildExtendedMetrics(campaign: {
  metrics: CampaignMetrics;
  startDate?: string;
  endDate?: string;
  dailyBudget?: number;
  lifetimeBudget?: number;
}): ExtendedMetrics {
  const m = campaign.metrics;
  const daysRunning = campaign.startDate
    ? Math.max(1, Math.floor((Date.now() - new Date(campaign.startDate).getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  let daysUntilEnd: number | null = null;
  if (campaign.endDate) {
    // Avoid precision issues by getting start of day
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const end = new Date(campaign.endDate);
    end.setHours(0, 0, 0, 0);
    daysUntilEnd = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }

  const cpl = m.conversions > 0 ? m.spend / m.conversions : 0;
  const dailyBudget = campaign.dailyBudget || 0;
  const lifetimeBudget = campaign.lifetimeBudget || 0;
  const remainingBudget = lifetimeBudget > 0
    ? Math.max(0, lifetimeBudget - m.spend)
    : dailyBudget > 0
      ? dailyBudget * 2  // Estimate 2 days remaining if no lifetime budget
      : 0;

  return {
    ...m,
    cpl,
    ctr_drop_pct: 0,         // Needs time-series data to calculate
    days_running: daysRunning,
    remaining_budget: remainingBudget,
    daily_budget: dailyBudget,
    days_until_end: daysUntilEnd ?? 0,
    end_date_is_set: campaign.endDate ? 1 : 0,
  };
}

// ─────────────────────────────────────────────
// 5 Default Rules per user spec
// ─────────────────────────────────────────────

export const DEFAULT_ENHANCED_RULES: Omit<EnhancedRule, "id" | "createdAt">[] = [
  // Rule 1 — MBC: CPL critical tự pause
  {
    name: "MBC: CPL critical tự pause",
    isActive: false,
    platform: "facebook",
    checkInterval: "6hour",
    conditionLogic: "AND",
    company: "MBC",
    conditions: [
      { metric: "cpl" as never, operator: ">", value: 130000, timeWindow: "last_3d" },
      { metric: "spend", operator: ">", value: 300000, timeWindow: "last_3d" },
    ],
    actions: [
      { type: "pause_campaign" },
      { type: "send_notification", message: "🛑 MBC: CPL > ₫130K + Spend > ₫300K — Đã tự pause Ad Set" },
    ],
    cooldown: 24,
    cooldownDays: 7,
    triggerCount: 0,
    respectLearningPhase: true,
    tags: ["cpl", "mbc"],
  },
  // Rule 2 — MBI: CPL critical tự pause
  {
    name: "MBI: CPL critical tự pause",
    isActive: false,
    platform: "facebook",
    checkInterval: "6hour",
    conditionLogic: "AND",
    company: "MBI",
    conditions: [
      { metric: "cpl" as never, operator: ">", value: 320000, timeWindow: "last_3d" },
      { metric: "spend", operator: ">", value: 500000, timeWindow: "last_3d" },
    ],
    actions: [
      { type: "pause_campaign" },
      { type: "send_notification", message: "🛑 MBI: CPL > ₫320K + Spend > ₫500K — Đã tự pause Ad Set" },
    ],
    cooldown: 24,
    cooldownDays: 7,
    triggerCount: 0,
    respectLearningPhase: true,
    tags: ["cpl", "mbi"],
  },
  // Rule 3 — Scale winner
  {
    name: "📈 Scale winner — Auto tăng budget",
    isActive: false,
    platform: "facebook",
    checkInterval: "6hour",
    conditionLogic: "AND",
    company: "all",
    conditions: [
      { metric: "cpl" as never, operator: "<", value: 50000, timeWindow: "last_7d" },
      { metric: "ctr", operator: ">", value: 2.5, timeWindow: "last_7d" },
      { metric: "frequency", operator: "<", value: 2.5, timeWindow: "last_7d" },
    ],
    actions: [
      { type: "increase_budget", value: 20 },
      { type: "send_notification", message: "📈 Auto scale: Campaign tốt — CPL < ₫50K, CTR > 2.5%, Freq < 2.5 → tăng budget 20%" },
    ],
    cooldown: 24,
    cooldownDays: 5,
    triggerCount: 0,
    respectLearningPhase: true,
    tags: ["scale", "winner"],
  },
  // Rule 4 — Ad Fatigue tự động
  {
    name: "😓 Ad Fatigue tự động — Pause + Alert",
    isActive: false,
    platform: "facebook",
    checkInterval: "6hour",
    conditionLogic: "AND",
    company: "all",
    conditions: [
      { metric: "frequency", operator: ">", value: 4.0, timeWindow: "last_7d" },
      { metric: "ctr", operator: "decreased_by_pct", value: 30, timeWindow: "last_7d" },
    ],
    actions: [
      { type: "pause_campaign" },
      { type: "send_notification", message: "😓 Ad Fatigue: Frequency > 4.0 + CTR giảm > 30% — Đã pause. Nên tạo creative mới!" },
      { type: "request_ai_evaluation" },
    ],
    cooldown: 24,
    cooldownDays: 7,
    triggerCount: 0,
    respectLearningPhase: true,
    tags: ["fatigue", "creative"],
  },
  // Rule 5 — Budget cạn sắp hết
  {
    name: "⚠️ Budget còn 2 ngày — Cảnh báo",
    isActive: false,
    platform: "facebook",
    checkInterval: "daily",
    conditionLogic: "AND",
    company: "all",
    conditions: [
      { metric: "budget_used_pct", operator: ">", value: 80, timeWindow: "this_month" },
    ],
    actions: [
      { type: "send_notification", message: "⚠️ Campaign còn budget chạy khoảng 2 ngày — cần nạp thêm hoặc điều chỉnh" },
    ],
    cooldown: 48,
    cooldownDays: 3,
    triggerCount: 0,
    tags: ["budget", "warning"],
  },
];
