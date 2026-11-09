// ============================================================
// Cron Job — Runs automation rules evaluation every 6 hours
// GET /api/cron — triggered by Vercel Cron or manual call
// ============================================================

import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { graphFetch, isMetaTransientInsightError, describeMetaError } from "@/lib/meta-client";
import { sumConversionActions } from "@/lib/meta-conversion-goal";
import { withFileLock } from "@/lib/file-lock";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import { startJobRun } from "@/lib/jobs/cron-guard";
import { runAutomationEngine, getExecutionLog } from "@/lib/automation-engine";
import { runLearningCycle } from "@/lib/ai-memory-engine";
import { recalculateAllSegmentStats } from "@/lib/segment-performance";
import { getPendingChecks, updateMetricsAfter, markNotified, computeComparison } from "@/lib/change-tracker";
import type { MetricSnapshot } from "@/lib/change-tracker";
import { gatherCampaigns } from "@/lib/nba/gather";
import { runEngine as runNba } from "@/lib/nba/engine";
import { upsertMany as nbaUpsert, getOccurrenceMap as nbaOccurrences } from "@/lib/nba/store";
import { getPriors as nbaPriors } from "@/lib/nba/feedback";
import { applyEligible } from "@/lib/nba/auto-apply";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";
import { companyIds } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request, "cron/nba_engine");
  if (!cronAuth.ok) return cronAuth.response;

  // ── Job observability guard ────────────────────────────────
  const triggeredBy = request.headers.get("x-manual-trigger")
    ? `manual:${request.headers.get("x-manual-trigger")}`
    : "cron";
  const jobGuard = await startJobRun("nba_engine", triggeredBy);
  if (jobGuard.blocked) return jobGuard.response;

  const startTime = Date.now();

  try {
    // Run all active automation rules against live campaign data
    const results = await runAutomationEngine();

    // Run AI learning cycle (learn from segments with campaign data)
    let aiLearning = { memoriesUpdated: 0, memoriesCreated: 0, totalMemories: 0 };
    try {
      aiLearning = runLearningCycle();
    } catch (aiErr) {
      console.warn("[Cron] AI learning cycle failed (non-blocking):", aiErr);
    }

    // ── NBA: gather → run → persist → auto-apply (mặc định dry-run) ──
    let nba = { generated: 0, mode: "dry_run" as string, eligible: 0, applied: 0 };
    try {
      const nbaCampaigns = await gatherCampaigns();
      if (nbaCampaigns.length > 0) {
        let recentlyChangedEntityIds: string[] = [];
        try { recentlyChangedEntityIds = (await getPendingChecks()).map(p => p.campaignId); } catch { /* non-blocking */ }
        const recs = runNba(
          { campaigns: nbaCampaigns, priorOccurrences: nbaOccurrences(), priors: nbaPriors(), recentlyChangedEntityIds },
          { companies: companyIds() }
        );
        const persisted = await nbaUpsert(recs);
        const fresh = persisted.filter(r => r.status === "new");
        const auto = await applyEligible(fresh, nbaCampaigns, recentlyChangedEntityIds);
        nba = {
          generated: recs.length,
          mode: auto.mode,
          eligible: auto.eligible,
          applied: auto.items.filter(i => i.executed).length,
        };
      }
    } catch (nbaErr) {
      console.warn("[Cron] NBA failed (non-blocking):", nbaErr);
    }

    const duration = Date.now() - startTime;
    const executionLog = getExecutionLog();

    const payload = {
      success: true,
      message: `Cron completed in ${duration}ms`,
      triggeredAt: new Date().toISOString(),
      results: {
        totalRulesEvaluated: results.length,
        actionsTriggered: results.filter(r => !r.skipped).length,
        skipped: results.filter(r => r.skipped).length,
        details: results,
      },
      aiLearning,
      nba,
      segmentStats: (() => {
        try { return recalculateAllSegmentStats(); } catch { return { updated: 0, total: 0 }; }
      })(),
      changeTracker: await (async () => {
        try {
          const token = process.env.META_ACCESS_TOKEN;
          if (!token) return { checked: 0 };

          const pending = await getPendingChecks();
          if (pending.length === 0) return { checked: 0 };

          let checked = 0;
          for (const record of pending) {
            const appliedDate = new Date(record.appliedAt);
            const since = appliedDate.toISOString().split("T")[0];
            const until = new Date(appliedDate.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

            // Fetch metrics after
            let metricsAfter: MetricSnapshot = {
              impressions: 0, clicks: 0, spend: 0,
              ctr: 0, cpc: 0, cpl: 0,
              frequency: 0, results: 0,
              period: "3 ngày sau thay đổi",
            };

            try {
              const fields = "impressions,clicks,spend,ctr,cpc,actions,frequency";
              const url = `${META_GRAPH_BASE}/${record.campaignId}/insights?fields=${fields}&time_range=${JSON.stringify({ since, until })}&access_token=${token}`;
              // graphFetch + thử lại: cùng lý do với các đường insights khác —
              // fetch trần không đọc header hạn mức và ném ngay lỗi đầu tiên.
              type InsightRow = Record<string, string | undefined> & { actions?: Array<{ action_type: string; value: string }> };
              let data: { data?: InsightRow[]; error?: { message?: string; code?: number } } | null = null;
              for (let attempt = 1; attempt <= 3; attempt++) {
                const res = await graphFetch(url);
                data = await res.json();
                if (!data?.error) break;
                if (isMetaTransientInsightError(data.error) && attempt < 3) {
                  await new Promise(r => setTimeout(r, 1500 * attempt));
                  continue;
                }
                break;
              }
              if (data?.error) {
                console.warn(`[cron] insights campaign ${record.campaignId} hỏng: ${describeMetaError(data.error.message ?? "?", data.error.code)}`);
              }

              if (data?.data?.[0]) {
                const row = data.data[0];
                // .find() cũ lấy hành động nào Meta xếp TRƯỚC trong mảng, nên
                // link_click hoàn toàn có thể bị đếm thành "kết quả" thay cho
                // lead. sumConversionActions lấy theo đúng thứ tự ưu tiên dưới
                // đây: mua → khách tiềm năng → chỉ còn lượt bấm.
                const resultVal = sumConversionActions(row.actions, ["offsite_conversion.fb_pixel_purchase", "lead", "link_click"]);
                const spend = parseFloat(row.spend || "0");
                const resultCount = Math.round(resultVal) || 0;

                metricsAfter = {
                  impressions: parseInt(row.impressions || "0", 10),
                  clicks: parseInt(row.clicks || "0", 10),
                  spend,
                  ctr: parseFloat(row.ctr || "0"),
                  cpc: parseFloat(row.cpc || "0"),
                  cpl: resultCount > 0 ? Math.round(spend / resultCount) : 0,
                  frequency: parseFloat(row.frequency || "0"),
                  results: resultCount,
                  period: "3 ngày sau thay đổi",
                };
              }
            } catch { /* ignore */ }

            const updated = await updateMetricsAfter(record.id, metricsAfter);

            // Push bell notification
            const comparison = updated?.comparison;
            if (comparison) {
              try {
                const alertsPath = path.join(process.cwd(), "data", "alerts.json");
                await withFileLock(alertsPath, async () => {
                  let alerts = [];
                  try { alerts = JSON.parse(fs.readFileSync(alertsPath, "utf-8")); } catch { /* empty */ }
                  alerts.unshift({
                    id: `alert_chg_${Date.now()}`,
                    type: "change_impact",
                    severity: comparison.overall === "declined" ? "warning" : "info",
                    campaign_id: record.campaignId,
                    campaign_name: record.campaignName,
                    company: record.company,
                    message: `${record.actionLabel}: ${comparison.summary}`,
                    is_read: false,
                    is_resolved: false,
                    created_at: new Date().toISOString(),
                  });
                  writeFileAtomicSync(alertsPath, JSON.stringify(alerts.slice(0, 500), null, 2));
                });
              } catch { /* non-blocking */ }
              await markNotified(record.id);
            }

            checked++;
            await new Promise(r => setTimeout(r, 1000));
          }

          return { checked };
        } catch (e) {
          console.warn("[Cron] Change tracker check failed:", e);
          return { checked: 0, error: String(e) };
        }
      })(),
      totalLogEntries: executionLog.length,
    };
    await jobGuard.finish("success", `${payload.results.actionsTriggered} actions, NBA: ${payload.nba.applied} applied (${payload.nba.mode})`);
    return NextResponse.json(payload);
  } catch (err: unknown) {
    await jobGuard.finish("failure", null, err);
    return NextResponse.json(
      {
        success: false,
        error: friendlyError(err instanceof Error ? err.message : "Unknown error"),
        triggeredAt: new Date().toISOString(),
        duration: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
