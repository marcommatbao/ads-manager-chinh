// ============================================================
// Automation Sim — orchestrator
// rule + campaigns + context → SimulationResult. PURE: không gọi API.
// ============================================================

import type { Campaign } from "@/types/ads.types";
import type { AutomationRule } from "@/lib/automation-shared";
import { evaluateRuleAgainst } from "./evaluate";
import { describeAction, scoreRisk, estImpactVnd } from "./risk";
import { runGuards, detectCompany } from "./guards";
import { classify } from "./classify";
import {
  buildSupportingMetrics, buildProposedValueChange, buildImpactSummary, buildWarnings, isLargeMagnitude,
} from "./explain";
import type {
  SimContext, SimulationItem, SimulationResult, SimulationStatus, SimProposedAction,
} from "./types";

const MAX_PER_COMPANY = Math.max(1, Number(process.env.NBA_AUTO_APPLY_MAX ?? "3") || 3);

function primaryAction(rule: AutomationRule): SimProposedAction | null {
  if (!rule.actions?.length) return null;
  const described = rule.actions.map(describeAction);
  return described.find(a => a.mutating) ?? described[0];
}

const EMPTY_COUNTS: Record<SimulationStatus, number> = {
  simulate_only: 0, manual_review_required: 0, safe_for_auto_apply: 0, blocked: 0,
};

export function simulateRule(
  rule: AutomationRule,
  campaigns: Campaign[],
  ctx: SimContext,
  dateWindow: { from: string; to: string },
): SimulationResult {
  const nowIso = new Date(ctx.now ?? Date.now()).toISOString();
  const recentChanges = ctx.recentChanges ?? {};
  const recentlyChanged = new Set(Object.keys(recentChanges));

  const rows = evaluateRuleAgainst(rule, campaigns);
  const action = primaryAction(rule);
  const items: SimulationItem[] = [];
  const safeByCompany = new Map<string, number>();

  for (const { campaign, result } of rows) {
    if (!result.conditionsMet || !action) continue;

    const company = detectCompany(campaign);
    const platform: "facebook" | "google" = campaign.platform === "google" ? "google" : "facebook";
    const valueChange = buildProposedValueChange(campaign, action);
    const largeMag = isLargeMagnitude(valueChange);
    const risk = scoreRisk(campaign, action);
    const guards = runGuards(campaign, rule, action, risk, ctx, recentlyChanged, largeMag);
    const estVnd = estImpactVnd(campaign, action);

    let cls = classify({ action, blockedBy: guards.blockedBy, risk, ctx, capExceeded: false });
    if (cls.simulationStatus === "safe_for_auto_apply") {
      const used = safeByCompany.get(company ?? "?") ?? 0;
      if (used >= MAX_PER_COMPANY) cls = classify({ action, blockedBy: guards.blockedBy, risk, ctx, capExceeded: true });
      else safeByCompany.set(company ?? "?", used + 1);
    }

    items.push({
      ruleId: rule.id,
      ruleName: rule.name,
      company,
      platform,
      entityType: "campaign",
      entityId: campaign.id,
      entityName: campaign.name,

      matchedConditions: result.conditionResults,
      proposedAction: action,
      proposedValueChange: valueChange,

      simulationStatus: cls.simulationStatus,
      riskScore: risk.riskScore,
      confidenceScore: risk.confidence,
      safetyScore: risk.safetyScore,
      risk,

      impactSummary: buildImpactSummary(campaign, action, valueChange, estVnd),
      estMonthlySavingsVnd: estVnd,
      blockedBy: guards.blockedBy,
      warnings: buildWarnings(campaign, action, valueChange),
      reasonCodes: cls.reasonCodes,
      explanation: cls.explanation,
      supportingMetrics: buildSupportingMetrics(campaign),
      recentRelatedChanges: recentChanges[campaign.id] ?? [],

      executor: action.mutating ? "automation-engine" : "manual-link",
      downgraded: guards.downgraded,
      generatedAt: nowIso,
    });
  }

  const order: Record<SimulationStatus, number> = { safe_for_auto_apply: 0, manual_review_required: 1, blocked: 2, simulate_only: 3 };
  items.sort((a, b) => order[a.simulationStatus] - order[b.simulationStatus] || b.estMonthlySavingsVnd - a.estMonthlySavingsVnd);

  const byStatus = { ...EMPTY_COUNTS };
  for (const it of items) byStatus[it.simulationStatus]++;

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    scope: { company: rule.company, platform: rule.platform },
    simulatedAt: nowIso,
    generatedAt: nowIso,
    dateWindow,
    policy: ctx.policy,
    counts: { evaluated: rows.length, matched: items.length, byStatus },
    estTotalImpactVnd: items.reduce((s, i) => s + i.estMonthlySavingsVnd, 0),
    items,
  };
}
