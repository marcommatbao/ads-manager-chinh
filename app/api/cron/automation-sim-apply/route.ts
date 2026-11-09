// ============================================================
// POST /api/cron/automation-sim-apply
//
// Cron-triggered (or manual) safe auto-apply runner.
// For each active automation rule:
//   1. Gather live campaigns (7-day window)
//   2. Simulate rule → classification
//   3. Apply safe_for_auto_apply items (gated by NBA_AUTO_APPLY)
//
// Auth: CRON_SECRET — Authorization: Bearer <secret> header required.
//       Query-string auth rejected in production (appears in logs).
//
// NBA_AUTO_APPLY gate (from .env):
//   off      → classify only, nothing executed
//   dry_run  → classify + log, nothing executed (DEFAULT)
//   on       → classify + execute real Meta API mutations
//
// Designed to be called:
//   - By Vercel/Coolify cron scheduler
//   - Manually: POST /api/cron/automation-sim-apply  (Authorization: Bearer <CRON_SECRET>)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { startJobRun } from "@/lib/jobs/cron-guard";
import { getActiveRules } from "@/lib/automation-engine";
import { gatherCampaigns } from "@/lib/nba/gather";
import { readHistory } from "@/lib/change-tracker";
import { getCompaniesForRole, isAdmin } from "@/lib/permissions";
import { simulateRule } from "@/lib/automation-sim/simulate";
import { applySimulationResult, getApplyMode } from "@/lib/automation-sim/apply";
import { saveRun } from "@/lib/automation-sim/store";
import type { SimContext, SimCompany, RecentRelatedChange, SimulationItem } from "@/lib/automation-sim/types";
import { companyIds } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Allow longer runtime for multi-rule simulation + Meta API calls
export const maxDuration = 60;


// ── Shared context helpers ────────────────────────────────────

function applyPolicy(): "off" | "dry_run" | "on" {
  const v = (process.env.NBA_AUTO_APPLY ?? "dry_run").toLowerCase();
  return v === "on" ? "on" : v === "off" ? "off" : "dry_run";
}

// Cron runs with admin-level context for all companies
// Đợt 21 A6: đọc danh sách công ty LÚC CHẠY (trình thiết lập đổi data/companies.json không cần khởi động lại).

async function buildRecentChanges(): Promise<Record<string, RecentRelatedChange[]>> {
  const cutoff = Date.now() - 3 * 86_400_000;
  const out: Record<string, RecentRelatedChange[]> = {};
  try {
    for (const r of await readHistory()) {
      if (Date.parse(r.appliedAt) < cutoff) continue;
      (out[r.campaignId] ??= []).push({
        id: r.id, actionLabel: r.actionLabel, appliedAt: r.appliedAt, status: r.status, verdict: r.verdict,
      });
    }
  } catch { /* non-blocking */ }
  return out;
}

// ── Route handler ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const cronAuth = checkCronAuth(request, "cron/automation_sim_apply");
  if (!cronAuth.ok) return cronAuth.response;

  // ── Job observability guard ─────────────────────────────
  const triggeredBy = request.headers.get("x-manual-trigger")
    ? `manual:${request.headers.get("x-manual-trigger")}`
    : "cron";
  const jobGuard = await startJobRun("automation_sim_apply", triggeredBy);
  if (jobGuard.blocked) return jobGuard.response;

  const startedAt = new Date().toISOString();
  const mode      = getApplyMode();
  const policy    = applyPolicy();

  const ctx: SimContext = {
    companies: companyIds() as SimCompany[],
    canApply:  true,          // cron has admin-level apply rights
    policy,
    recentChanges: await buildRecentChanges(),
  };

  const activeRules = getActiveRules();
  if (activeRules.length === 0) {
    return NextResponse.json({
      success: true,
      data: { startedAt, mode, policy, rulesEvaluated: 0, ruleResults: [], summary: { totalSafe: 0, totalExecuted: 0, totalDryRun: 0, totalFailed: 0, totalBlocked: 0 } },
    });
  }

  // Gather campaigns once, reuse across all rules
  const from = new Date(Date.now() - 7 * 86_400_000).toISOString().split("T")[0];
  const to   = new Date().toISOString().split("T")[0];
  let allCampaigns = await gatherCampaigns({ from, to });

  interface RuleResult {
    ruleId: string;
    ruleName: string;
    evaluated: number;
    matched: number;
    safeCount: number;
    blockedCount: number;
    manualReviewCount: number;
    applyMode: string;
    executed: number;
    dryRun: number;
    failed: number;
    candidates: Pick<SimulationItem, "entityId" | "entityName" | "company" | "proposedAction" | "impactSummary" | "riskScore" | "safetyScore">[];
    blockedItems: Pick<SimulationItem, "entityId" | "entityName" | "company" | "blockedBy" | "explanation">[];
    error?: string;
  }

  const ruleResults: RuleResult[] = [];

  for (const rule of activeRules) {
    try {
      // Filter campaigns for this rule's platform
      const campaigns = rule.platform !== "all"
        ? allCampaigns.filter(c => c.platform === rule.platform)
        : allCampaigns;

      const simResult = simulateRule(rule, campaigns, ctx, { from, to });
      await saveRun(simResult);

      const safe    = simResult.items.filter(i => i.simulationStatus === "safe_for_auto_apply");
      const blocked = simResult.items.filter(i => i.simulationStatus === "blocked");
      const manual  = simResult.items.filter(i => i.simulationStatus === "manual_review_required");

      let executed = 0, dryRun = 0, failed = 0;

      if (safe.length > 0) {
        const applyResult = await applySimulationResult(simResult);
        executed = applyResult.records.filter(r => r.executed).length;
        dryRun   = applyResult.records.filter(r => r.dryRun).length;
        failed   = applyResult.records.filter(r => !r.executed && !r.dryRun).length;
      }

      ruleResults.push({
        ruleId: rule.id,
        ruleName: rule.name,
        evaluated: simResult.counts.evaluated,
        matched:   simResult.counts.matched,
        safeCount: safe.length,
        blockedCount: blocked.length,
        manualReviewCount: manual.length,
        applyMode: mode,
        executed,
        dryRun,
        failed,
        candidates: safe.map(i => ({
          entityId: i.entityId, entityName: i.entityName, company: i.company,
          proposedAction: i.proposedAction, impactSummary: i.impactSummary,
          riskScore: i.riskScore, safetyScore: i.safetyScore,
        })),
        blockedItems: blocked.map(i => ({
          entityId: i.entityId, entityName: i.entityName, company: i.company,
          blockedBy: i.blockedBy, explanation: i.explanation,
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[cron/automation-sim-apply] Rule "${rule.name}" error:`, message);
      ruleResults.push({
        ruleId: rule.id, ruleName: rule.name,
        evaluated: 0, matched: 0, safeCount: 0, blockedCount: 0, manualReviewCount: 0,
        applyMode: mode, executed: 0, dryRun: 0, failed: 0,
        candidates: [], blockedItems: [], error: friendlyError(message),
      });
    }
  }

  const summary = {
    totalSafe:     ruleResults.reduce((s, r) => s + r.safeCount, 0),
    totalExecuted: ruleResults.reduce((s, r) => s + r.executed, 0),
    totalDryRun:   ruleResults.reduce((s, r) => s + r.dryRun, 0),
    totalFailed:   ruleResults.reduce((s, r) => s + r.failed, 0),
    totalBlocked:  ruleResults.reduce((s, r) => s + r.blockedCount, 0),
  };

  console.log(`[cron/automation-sim-apply] Done — ${activeRules.length} rules, mode=${mode}, executed=${summary.totalExecuted}, dryRun=${summary.totalDryRun}`);

  await jobGuard.finish(
    summary.totalFailed > 0 ? "failure" : "success",
    `${activeRules.length} rules, executed=${summary.totalExecuted}, dryRun=${summary.totalDryRun}, failed=${summary.totalFailed}, policy=${policy}`,
    summary.totalFailed > 0 ? new Error(`${summary.totalFailed} rule mutation(s) failed`) : undefined,
  );

  return NextResponse.json({
    success: true,
    data: {
      startedAt,
      finishedAt:     new Date().toISOString(),
      mode,
      policy,
      rulesEvaluated: activeRules.length,
      ruleResults,
      summary,
    },
  });
}
