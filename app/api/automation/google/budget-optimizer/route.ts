// ============================================================
// Google Ads — Budget Optimizer (Cron)
// GET /api/automation/google/budget-optimizer
// Schedule: daily at 06:00 (0 6 * * *)
// ============================================================
// Auto-adjusts daily budgets for active Google campaigns
// Rules: Scale up good CPL, scale down bad CPL, aggressive scale for winners
// Safety: min 50%, max 300% of original budget
// ============================================================

import { ruleInputs } from "@/lib/pmax/budget-inputs";
import { enums } from "google-ads-api";
import { NextRequest, NextResponse } from "next/server";
import { dateClauseForDays } from "@/lib/google-date-range";
import { checkCronAuth } from "@/lib/cron-auth";
import { getGoogleAdsCustomer, GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client";
import { sendTelegram } from "@/lib/telegram";
import { formatVND } from "@/lib/budget-monitor";
import { startJobRun } from "@/lib/jobs/cron-guard";
import { checkRecentCampaignMutation, recordCampaignMutation } from "@/lib/mutation-guard";
import fs from "fs";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import path from "path";
import { companyIds } from "@/lib/companies"

// ── CPL Thresholds (same as monitor) ──

const GOOGLE_CPL_THRESHOLDS: Record<string, { good: number; warning: number; danger: number }> = {
  MBC: { good: 130_000, warning: 180_000, danger: 190_000 },
  MBI: { good: 180_000, warning: 190_000, danger: 230_000 },
};

// ── Types ──

interface BudgetAction {
  company: string;
  campaignName: string;
  campaignResourceName: string;
  budgetResourceName: string;
  action: string;
  oldBudget: number;
  newBudget: number;
  cpl: number;
  conversions: number;
  budgetLost: number;
  reason: string;
  appliedAt: string;
}

// ── Helpers ──

function formatMoney(val: number): string {
  return new Intl.NumberFormat("vi-VN").format(val);
}

function loadLaunches(): Record<string, unknown>[] {
  const filePath = path.join(process.cwd(), "data", "google-launches.json");
  if (!fs.existsSync(filePath)) return [];
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { return []; }
}

function saveBudgetHistory(actions: BudgetAction[]) {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const filePath = path.join(dataDir, "google-budget-history.json");
  let existing: BudgetAction[] = [];
  if (fs.existsSync(filePath)) {
    try { existing = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { existing = []; }
  }

  existing.push(...actions);
  // Keep last 500 entries
  if (existing.length > 500) existing.splice(0, existing.length - 500);
  writeFileAtomicSync(filePath, JSON.stringify(existing, null, 2));
}

function getTelegramChatId(): string {
  return process.env.TELEGRAM_CHAT_ID ?? process.env.TELEGRAM_ADMIN_CHAT_ID ?? "";
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET Handler (Cron)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "automation/google_budget_optimizer");
  if (!auth.ok) return auth.response;

  // Job-level overlap/pause guard — this cron previously had none (unlike
  // the NBA cron path), so an overlapping run or a paused-but-still-firing
  // schedule had no safety net.
  const jobGuard = await startJobRun("google_budget_optimizer", "cron");
  if (jobGuard.blocked) return jobGuard.response;

  const companies = companyIds();
  const allActions: BudgetAction[] = [];
  const launches = loadLaunches();

  for (const company of companies) {
    try {
      const customer = getGoogleAdsCustomer(company);
      const threshold = GOOGLE_CPL_THRESHOLDS[company];

      const query = `
        SELECT
          campaign.id,
          campaign.resource_name,
          campaign.name,
          campaign.status,
          campaign_budget.resource_name,
          campaign_budget.amount_micros,
          campaign_budget.explicitly_shared,
          metrics.cost_micros,
          metrics.conversions,
          metrics.cost_per_conversion,
          metrics.search_budget_lost_impression_share,
          campaign.advertising_channel_type,
          campaign.primary_status_reasons
        FROM campaign
        WHERE campaign.status = 'ENABLED'
          AND ${dateClauseForDays(3)}
      `;

      const rows = await customer.query(query);
      // Đợt 10a · D1: đơn TỪ LƯỢT BẤM của PMax (bỏ engaged-view) — xem lib/pmax/budget-inputs.ts.
      let pmaxClick: Map<string, number> | null = new Map();
      try {
        const conv = await customer.query(`SELECT campaign.id, segments.conversion_attribution_event_type, metrics.conversions FROM campaign WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX' AND campaign.status = 'ENABLED' AND ${dateClauseForDays(3)}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const r of conv as any[]) {
          if (r.segments?.conversion_attribution_event_type === enums.ConversionAttributionEventType.ENGAGED_VIEW) continue;
          const id = String(r.campaign?.id ?? "");
          pmaxClick.set(id, (pmaxClick.get(id) ?? 0) + (Number(r.metrics?.conversions) || 0));
        }
      } catch (e) {
        console.warn(`[budget-optimizer] ${company}: không đọc được đơn từ lượt bấm của PMax — bỏ qua PMax lượt này:`, e instanceof Error ? e.message : e);
        pmaxClick = null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of rows as any[]) {
        const spend = (row.metrics?.cost_micros || 0) / 1_000_000;
        const isPmax = row.campaign?.advertising_channel_type === enums.AdvertisingChannelType.PERFORMANCE_MAX;
        const reasons = ((row.campaign?.primary_status_reasons ?? []) as number[]).map((r) => String(enums.CampaignPrimaryStatusReason[r] ?? r));
        const inputs = ruleInputs({
          isPmax, conversionsAll: row.metrics?.conversions || 0, statusReasons: reasons,
          clickConversions: isPmax ? (pmaxClick ? pmaxClick.get(String(row.campaign?.id ?? "")) ?? 0 : null) : null,
          searchBudgetLost: row.metrics?.search_budget_lost_impression_share || 0,
        });
        if (inputs.skip) continue;
        const conversions = inputs.conversions;
        const cpl = conversions > 0 ? Math.round(spend / conversions) : 0;
        const currentBudgetMicros = row.campaign_budget?.amount_micros || 0;
        const currentBudget = currentBudgetMicros / 1_000_000;
        const budgetLost = inputs.budgetLost;
        const campaignResourceName = row.campaign?.resource_name ?? "";
        const budgetResourceName = row.campaign_budget?.resource_name ?? "";
        const campaignName = row.campaign?.name ?? "Unknown";
        const isSharedBudget = row.campaign_budget?.explicitly_shared === true;

        // Skip shared budgets (dangerous to auto-adjust)
        if (isSharedBudget) continue;
        // Skip if no spend data
        if (spend === 0 && conversions === 0) continue;

        let newBudget = currentBudget;
        let actionTaken: string | null = null;
        let reason = "";

        // THỨ TỰ QUAN TRỌNG — luật CHẶT NHẤT phải đứng TRƯỚC.
        //
        // Bản cũ xếp "tăng 20%" trước "scale mạnh 30%", mà điều kiện của luật
        // 30% chặt hơn hẳn về CPL và số chuyển đổi, chỉ lỏng hơn ở budgetLost
        // (>0.1 thay vì >0.2). Trong chuỗi else-if, chiến dịch thoả CẢ HAI —
        // tức chiến dịch xuất sắc VÀ đang bị giới hạn ngân sách mạnh, trường
        // hợp phổ biến nhất — luôn rơi vào luật 20% trước. Luật 30% chỉ chạy
        // được trong dải hẹp 0.1 < budgetLost ≤ 0.2, nên đúng những chiến dịch
        // đáng scale nhất lại bị tăng ít nhất. Không log, không lỗi.

        // ── Luật A: CPL cực tốt + đang bị giới hạn ngân sách → Tăng mạnh 30% ──
        if (cpl > 0 && cpl < threshold.good * 0.7 && conversions >= 5 && budgetLost > 0.1) {
          newBudget = Math.round(currentBudget * 1.3);
          actionTaken = "INCREASE_30";
          reason = `CPL xuất sắc (${formatVND(cpl)}), đang thắng lớn → scale mạnh`;
        }

        // ── Luật B: CPL tốt + đang bị giới hạn ngân sách → Tăng 20% ──
        else if (cpl > 0 && cpl < threshold.good && budgetLost > 0.2 && conversions >= 3) {
          newBudget = Math.round(currentBudget * 1.2);
          actionTaken = "INCREASE_20";
          reason = `CPL tốt (${formatVND(cpl)}), mất ${Math.round(budgetLost * 100)}% impression vì budget`;
        }

        // ── Luật C: CPL cao → Giảm 20% ──
        else if (cpl > threshold.warning && conversions >= 2) {
          newBudget = Math.round(currentBudget * 0.8);
          actionTaken = "DECREASE_20";
          reason = `CPL cao (${formatVND(cpl)}), cần giảm chi tiêu`;
        }

        if (!actionTaken) continue;
        reason += inputs.note;

        // ── Safety limits ──
        // Find original budget from launch record
        const launch = launches.find(
          (l) => (l as Record<string, unknown>).campaignResourceName === campaignResourceName
        ) as Record<string, unknown> | undefined;
        const originalBudget = (launch?.dailyBudget as number) ?? currentBudget;

        const MIN_BUDGET = originalBudget * 0.5;   // Never below 50% of original
        const MAX_BUDGET = originalBudget * 3.0;    // Never above 300% of original
        const ABS_MIN = 100_000;                     // Absolute minimum 100K VND
        newBudget = Math.max(ABS_MIN, Math.max(MIN_BUDGET, Math.min(MAX_BUDGET, newBudget)));

        // Skip if no meaningful change
        if (Math.abs(newBudget - currentBudget) < 50_000) continue;

        // Mutation-safety: this cron runs fully autonomously (no human in
        // the loop), so unlike the manual paths (Audit Auto-Fix,
        // Improvements), a recent decision from a different source is a
        // hard skip here, not just a warning.
        const campaignId = String(row.campaign?.id ?? "");
        if (campaignId) {
          const recent = checkRecentCampaignMutation(campaignId, company, "cron_auto_apply");
          if (recent.hasConflict) {
            console.log(`[google-budget] Skipping ${campaignName} — ${recent.note}`);
            continue;
          }
        }

        // ── Apply budget change via Google Ads API ──
        try {
          await customer.mutateResources([
            {
              entity: "campaign_budget",
              operation: "update",
              resource: {
                resource_name: budgetResourceName,
                amount_micros: newBudget * 1_000_000,
              },
            },
          ]);

          allActions.push({
            company,
            campaignName,
            campaignResourceName,
            budgetResourceName,
            action: actionTaken,
            oldBudget: currentBudget,
            newBudget,
            cpl,
            conversions,
            budgetLost,
            reason,
            appliedAt: new Date().toISOString(),
          });

          if (campaignId) {
            recordCampaignMutation({
              source: { type: "cron_auto_apply", jobId: "google_budget_optimizer" },
              event: newBudget > currentBudget ? "budget.increase" : "budget.decrease",
              company,
              campaignId,
              campaignName,
              rationale: reason,
            });
          }

          console.log(
            `[google-budget] ${company} | ${campaignName}: ${actionTaken} ` +
            `${formatMoney(currentBudget)} → ${formatMoney(newBudget)} (CPL: ${formatMoney(cpl)})`
          );
        } catch (err) {
          console.error(`[google-budget] Failed to update ${campaignName}:`, err);
        }
      }
    } catch (err) {
      console.error(`[google-budget] Error processing ${company}:`, err);
    }
  }

  // ── Save history ──
  if (allActions.length > 0) {
    saveBudgetHistory(allActions);
  }

  // ── Send Telegram summary ──
  if (allActions.length > 0) {
    const chatId = getTelegramChatId();
    if (chatId) {
      const now = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
      const lines = [
        "💰 *Google Budget Optimizer*",
        `_${now}_`,
        "",
      ];

      for (const a of allActions) {
        const emoji = a.action.startsWith("INCREASE") ? "📈" : "📉";
        lines.push(
          `${emoji} *${a.company}* | ${a.campaignName}`,
          `   ${formatVND(a.oldBudget)} → ${formatVND(a.newBudget)} | CPL: ${formatVND(a.cpl)}`,
          `   ${a.reason}`,
          ""
        );
      }

      lines.push(`Tổng: ${allActions.length} campaigns điều chỉnh`);
      await sendTelegram(chatId, lines.join("\n"), "Markdown");
    }
  }

  console.log(`[google-budget] Optimized ${allActions.length} campaigns`);

  await jobGuard.finish("success", `Optimized ${allActions.length} campaigns`);

  return NextResponse.json({
    success: true,
    optimized: allActions.length,
    actions: allActions,
    timestamp: new Date().toISOString(),
  });
}
