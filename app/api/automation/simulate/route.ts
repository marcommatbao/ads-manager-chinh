// ============================================================
// Automation Simulation API
//
// POST /api/automation/simulate
//   Body: { ruleId: string } | { ruleDraft: AutomationRule }
//   Returns: { success, data: SimEnrichedResult }
//   READ-ONLY: no ad-account mutations. Powers the "Test" button.
//
// GET /api/automation/simulate
//   Query: ?limit=10&ruleId=<id>
//   Returns recent simulation runs from the persistent store.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole, isAdmin, isSuperAdmin } from "@/lib/permissions";
import { getRuleById } from "@/lib/automation-engine";
import { gatherCampaigns } from "@/lib/nba/gather";
import { readHistory } from "@/lib/change-tracker";
import { simulateRule } from "@/lib/automation-sim/simulate";
import { saveRun, getRuns } from "@/lib/automation-sim/store";
import type { AutomationRule } from "@/lib/automation-shared";
import type {
  SimCompany, SimContext, SimulationItem, SimulationResult, RecentRelatedChange,
} from "@/lib/automation-sim/types";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ── Shared helpers ────────────────────────────────────────────

function applyPolicy(): "off" | "dry_run" | "on" {
  const v = (process.env.NBA_AUTO_APPLY ?? "dry_run").toLowerCase();
  return v === "on" ? "on" : v === "off" ? "off" : "dry_run";
}

/** Extend SimulationResult with derived buckets and flat summary counts. */
function enrich(result: SimulationResult) {
  const { items, counts, estTotalImpactVnd } = result;
  const candidates        = items.filter((i: SimulationItem) => i.simulationStatus === "safe_for_auto_apply");
  const manualReviewItems = items.filter((i: SimulationItem) => i.simulationStatus === "manual_review_required");
  const blockedItems      = items.filter((i: SimulationItem) => i.simulationStatus === "blocked");
  const simulateOnlyItems = items.filter((i: SimulationItem) => i.simulationStatus === "simulate_only");

  return {
    ...result,
    summary: {
      evaluated:         counts.evaluated,
      matched:           counts.matched,
      safeCount:         counts.byStatus.safe_for_auto_apply,
      manualReviewCount: counts.byStatus.manual_review_required,
      blockedCount:      counts.byStatus.blocked,
      simulateOnlyCount: counts.byStatus.simulate_only,
      estTotalImpactVnd,
    },
    candidates,
    manualReviewItems,
    blockedItems,
    simulateOnlyItems,
  };
}

async function buildCtx(
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  withRecentChanges = true,
): Promise<SimContext> {
  const ctx: SimContext = {
    companies: getCompaniesForRole(user) as SimCompany[],
    canApply: isAdmin(user.role) || isSuperAdmin(user.role),
    policy: applyPolicy(),
  };

  if (withRecentChanges) {
    const cutoff = Date.now() - 3 * 86_400_000;
    const recentChanges: Record<string, RecentRelatedChange[]> = {};
    for (const r of await readHistory()) {
      if (Date.parse(r.appliedAt) < cutoff) continue;
      (recentChanges[r.campaignId] ??= []).push({
        id: r.id, actionLabel: r.actionLabel, appliedAt: r.appliedAt,
        status: r.status, verdict: r.verdict,
      });
    }
    ctx.recentChanges = recentChanges;
  }

  return ctx;
}

// Mô phỏng là xem trước, không phải quyết định — dữ liệu cũ 60 giây là chấp nhận
// được. Trước đây mỗi lần bấm "Test Rule" là một lượt kéo toàn bộ Meta + Google cho
// cả hai công ty, và nút chỉ khoá đúng rule đang bấm nên bấm sang rule khác là chạy
// chồng. Rà 13 rule một lượt = 13 lần kéo, đủ để Meta trả rate limit và làm hỏng lây
// các tính năng khác. Cache chỉ đặt ở đường mô phỏng; cron và các đường quyết định
// vẫn lấy dữ liệu tươi.
const GATHER_TTL_MS = 60_000;
let gatherCache: { key: string; at: number; data: Awaited<ReturnType<typeof gatherCampaigns>> } | null = null;
let gatherInFlight: { key: string; promise: Promise<Awaited<ReturnType<typeof gatherCampaigns>>> } | null = null;

async function gatherForSim(from: string, to: string) {
  const key = `${from}:${to}`;
  if (gatherCache && gatherCache.key === key && Date.now() - gatherCache.at < GATHER_TTL_MS) {
    return gatherCache.data;
  }
  // Hai lượt bấm gần nhau dùng chung một lượt gọi thay vì gọi hai lần song song.
  if (gatherInFlight && gatherInFlight.key === key) return gatherInFlight.promise;

  const promise = gatherCampaigns({ from, to })
    .then((data) => { gatherCache = { key, at: Date.now(), data }; return data; })
    .finally(() => { if (gatherInFlight?.key === key) gatherInFlight = null; });
  gatherInFlight = { key, promise };
  return promise;
}

async function runSimulation(
  rule: AutomationRule,
  ctx: SimContext,
): Promise<SimulationResult> {
  const from = new Date(Date.now() - 7 * 86_400_000).toISOString().split("T")[0];
  const to   = new Date().toISOString().split("T")[0];

  let campaigns = await gatherForSim(from, to);
  if (rule.platform !== "all") campaigns = campaigns.filter(c => c.platform === rule.platform);

  const result = simulateRule(rule, campaigns, ctx, { from, to });
  await saveRun(result);
  return result;
}

// ── POST /api/automation/simulate ─────────────────────────────

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  let body: { ruleId?: string; ruleDraft?: AutomationRule };
  try { body = await request.json() as typeof body; }
  catch { return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 }); }

  if (!body.ruleId && !body.ruleDraft) {
    return NextResponse.json(
      { success: false, error: "Payload must include ruleId or ruleDraft" },
      { status: 400 },
    );
  }

  const rule: AutomationRule | undefined = body.ruleId
    ? getRuleById(body.ruleId)
    : body.ruleDraft;

  if (!rule) {
    return NextResponse.json(
      { success: false, error: `Rule not found: ${body.ruleId ?? "(draft)"}` },
      { status: 404 },
    );
  }

  try {
    const ctx    = await buildCtx(user);
    const result = await runSimulation(rule, ctx);
    return NextResponse.json({ success: true, data: enrich(result) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /api/automation/simulate]", message);
    return NextResponse.json({ success: false, error: `Simulation error: ${message}` }, { status: 500 });
  }
}

// ── GET /api/automation/simulate ──────────────────────────────
// List recent simulation runs persisted in data/automation-sim-runs.json.
// Useful for audit trail and the "history" panel.

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const url    = new URL(request.url);
  const limit  = Math.min(Math.max(1, Number(url.searchParams.get("limit") ?? "10")), 30);
  const ruleId = url.searchParams.get("ruleId") ?? undefined;

  try {
    let runs = getRuns(30);
    if (ruleId) runs = runs.filter(r => r.ruleId === ruleId);

    return NextResponse.json({
      success: true,
      data: {
        runs: runs.slice(0, limit).map(enrich),
        total: runs.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /api/automation/simulate]", message);
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 500 });
  }
}
