// ============================================================
// Google Ads — Campaign Performance Monitor (Cron)
// GET /api/automation/google/monitor
// Schedule: every 6 hours (0 */6 * * *)
// ============================================================
// Checks all active Google campaigns for MBC + MBI
// Rules: CPL thresholds, CTR, budget limitations, winning campaigns
// Sends Telegram alerts + saves to JSON
// ============================================================

import { NextRequest, NextResponse } from "next/server"
import { googleAdsErrorMessage } from "@/lib/google-ads-error";
import { dateClauseForDays } from "@/lib/google-date-range";
import { checkCronAuth } from "@/lib/cron-auth";
import { getGoogleAdsCustomer, GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client";
import { sendTelegram } from "@/lib/telegram";
import { formatVND } from "@/lib/budget-monitor";
import fs from "fs";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import path from "path";
import { companyIds } from "@/lib/companies"

// ── CPL Thresholds (Google generally lower CPL than FB due to higher intent) ──

const GOOGLE_CPL_THRESHOLDS: Record<string, { good: number; warning: number; danger: number }> = {
  MBC: {
    good:    130_000,   // < 130K = tốt
    warning: 180_000,   // 130-180K = theo dõi
    danger:  190_000,   // > 190K = báo động
  },
  MBI: {
    good:    180_000,
    warning: 190_000,
    danger:  230_000,   // MBI B2B nên CPL cao hơn vẫn acceptable
  },
};

// ── Alert types ──

interface GoogleAlert {
  type: "DANGER" | "WARNING" | "SUCCESS" | "INFO";
  source: "GOOGLE";
  company: string;
  campaignId: string;
  campaignName: string;
  channelType?: string;
  metric: string;
  value: number | string;
  threshold?: number;
  message: string;
  action: string;
  createdAt: string;
}

// ── Helpers ──

function formatMoney(val: number): string {
  return new Intl.NumberFormat("vi-VN").format(val);
}

function saveAlerts(alerts: GoogleAlert[]) {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const filePath = path.join(dataDir, "google-alerts.json");
  let existing: GoogleAlert[] = [];
  if (fs.existsSync(filePath)) {
    try { existing = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { existing = []; }
  }

  existing.push(...alerts);
  // Keep last 500 alerts
  if (existing.length > 500) existing.splice(0, existing.length - 500);
  writeFileAtomicSync(filePath, JSON.stringify(existing, null, 2));
}

function getTelegramChatId(): string {
  return process.env.TELEGRAM_CHAT_ID ?? process.env.TELEGRAM_ADMIN_CHAT_ID ?? "";
}

// ── Build Telegram message from alerts ──

function buildTelegramMessage(alerts: GoogleAlert[]): string {
  const now = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  const lines = [
    "📊 *Google Ads Monitor*",
    `_${now}_`,
    "",
  ];

  const dangerAlerts = alerts.filter(a => a.type === "DANGER");
  const warningAlerts = alerts.filter(a => a.type === "WARNING");
  const successAlerts = alerts.filter(a => a.type === "SUCCESS");

  if (dangerAlerts.length > 0) {
    lines.push("🔴 *DANGER:*");
    dangerAlerts.forEach(a => lines.push(`  ${a.message}`));
    lines.push("");
  }

  if (warningAlerts.length > 0) {
    lines.push("🟡 *WARNING:*");
    warningAlerts.forEach(a => lines.push(`  ${a.message}`));
    lines.push("");
  }

  if (successAlerts.length > 0) {
    lines.push("🟢 *WINNING:*");
    successAlerts.forEach(a => lines.push(`  ${a.message}`));
    lines.push("");
  }

  lines.push(`Tổng: ${alerts.length} alerts (${dangerAlerts.length} 🔴 | ${warningAlerts.length} 🟡 | ${successAlerts.length} 🟢)`);
  return lines.join("\n");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET Handler (Cron)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "automation/google_monitor");
  if (!auth.ok) return auth.response;

  const companies = companyIds();
  const allAlerts: GoogleAlert[] = [];
  let totalChecked = 0;

  for (const company of companies) {
    try {
      const customer = getGoogleAdsCustomer(company);

      // GAQL query — performance last 3 days
      const query = `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          campaign_budget.amount_micros,
          metrics.cost_micros,
          metrics.conversions,
          metrics.cost_per_conversion,
          metrics.clicks,
          metrics.impressions,
          metrics.ctr,
          metrics.search_impression_share,
          metrics.search_budget_lost_impression_share
        FROM campaign
        WHERE campaign.status = 'ENABLED'
          AND ${dateClauseForDays(3)}
      `;

      const rows = await customer.query(query);
      totalChecked += rows.length;
      const threshold = GOOGLE_CPL_THRESHOLDS[company];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of rows as any[]) {
        const spend = (row.campaign?.metrics?.cost_micros || row.metrics?.cost_micros || 0) / 1_000_000;
        const conversions = row.campaign?.metrics?.conversions || row.metrics?.conversions || 0;
        const cpl = conversions > 0 ? Math.round(spend / conversions) : 0;
        const ctr = ((row.campaign?.metrics?.ctr || row.metrics?.ctr || 0) * 100);
        const impressions = row.campaign?.metrics?.impressions || row.metrics?.impressions || 0;
        const budgetLostImprShare = row.campaign?.metrics?.search_budget_lost_impression_share
          || row.metrics?.search_budget_lost_impression_share || 0;
        const campaignId = String(row.campaign?.id ?? "unknown");
        const campaignName = row.campaign?.name ?? "Unknown Campaign";
        const channelType = row.campaign?.advertising_channel_type ?? "";

        // ── Rule 1: CPL nguy hiểm ──
        if (cpl > threshold.danger && conversions >= 3) {
          allAlerts.push({
            type: "DANGER",
            source: "GOOGLE",
            company,
            campaignId,
            campaignName,
            channelType,
            metric: "CPL",
            value: cpl,
            threshold: threshold.danger,
            message: `🔴 [GG] ${campaignName}: CPL ₫${formatMoney(cpl)} vượt ngưỡng nguy hiểm (>${formatMoney(threshold.danger)})`,
            action: "PAUSE_SUGGESTED",
            createdAt: new Date().toISOString(),
          });
        }

        // ── Rule 2: CPL cảnh báo ──
        else if (cpl > threshold.warning && conversions >= 2) {
          allAlerts.push({
            type: "WARNING",
            source: "GOOGLE",
            company,
            campaignId,
            campaignName,
            channelType,
            metric: "CPL",
            value: cpl,
            message: `🟡 [GG] ${campaignName}: CPL ₫${formatMoney(cpl)} cao hơn ngưỡng (>${formatMoney(threshold.warning)})`,
            action: "REVIEW_SUGGESTED",
            createdAt: new Date().toISOString(),
          });
        }

        // ── Rule 3: Budget đang giới hạn impression nhưng CPL tốt → scale ──
        if (budgetLostImprShare > 0.3 && cpl > 0 && cpl < threshold.good) {
          allAlerts.push({
            type: "SUCCESS",
            source: "GOOGLE",
            company,
            campaignId,
            campaignName,
            channelType,
            metric: "BUDGET_LIMITED",
            value: budgetLostImprShare,
            message: `🟢 [GG] ${campaignName}: CPL tốt (${formatVND(cpl)}) nhưng mất ${Math.round(budgetLostImprShare * 100)}% impression vì budget → Nên tăng budget`,
            action: "SCALE_BUDGET_SUGGESTED",
            createdAt: new Date().toISOString(),
          });
        }

        // ── Rule 4: CTR quá thấp (creative kém) ──
        if (ctr < 1.5 && impressions > 500) {
          allAlerts.push({
            type: "WARNING",
            source: "GOOGLE",
            company,
            campaignId,
            campaignName,
            channelType,
            metric: "CTR",
            value: ctr.toFixed(2),
            message: `🟡 [GG] ${campaignName}: CTR ${ctr.toFixed(2)}% quá thấp — Headlines cần cải thiện`,
            action: "REFRESH_CREATIVE_SUGGESTED",
            createdAt: new Date().toISOString(),
          });
        }

        // ── Rule 5: Thắng to → Báo ngay ──
        if (cpl > 0 && cpl < threshold.good * 0.7 && conversions >= 5 && spend > 100_000) {
          allAlerts.push({
            type: "SUCCESS",
            source: "GOOGLE",
            company,
            campaignId,
            campaignName,
            channelType,
            metric: "CPL",
            value: cpl,
            message: `🏆 [GG] ${campaignName} đang thắng lớn! CPL ${formatVND(cpl)} — thấp hơn 30% mục tiêu`,
            action: "SCALE_BUDGET_SUGGESTED",
            createdAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      console.error(`[google-monitor] Error checking ${company}:`, err);
      allAlerts.push({
        type: "WARNING",
        source: "GOOGLE",
        company,
        campaignId: "system",
        campaignName: "System",
        metric: "ERROR",
        value: "API_ERROR",
        // PHẢI dùng googleAdsErrorMessage, KHÔNG dùng `err instanceof Error`.
        //
        // Đo ngày 22/09/2026: lỗi thư viện google-ads-api ném ra KHÔNG phải
        // một Error (constructor `fp`), và KHÔNG có `.message`. Nên nhánh
        // `instanceof Error` luôn trượt và mọi lỗi in ra đúng ba chữ
        // "Unknown error" — trong khi lý do thật vẫn còn nguyên trong object:
        //
        //   in ra : "Unknown error"
        //   thật  : "Unrecognized field in the query: 'campaign.xxx'.
        //            [query_error: 32]"
        //
        // Hệ quả có thật: bảng Alerts của trang Automation đang chứa 8 dòng
        // "Không thể kiểm tra — Unknown error" từ 98–137 ngày trước. Lý do
        // thật đã bị vứt đi ngay lúc ghi, nên không còn cách nào truy lại.
        message: `⚠️ [GG] ${company}: Không thể kiểm tra — ${googleAdsErrorMessage(err)}`,
        action: "CHECK_CREDENTIALS",
        createdAt: new Date().toISOString(),
      });
    }
  }

  // ── Save alerts to JSON ──
  if (allAlerts.length > 0) {
    saveAlerts(allAlerts);
  }

  // ── Send Telegram notification ──
  if (allAlerts.length > 0) {
    const chatId = getTelegramChatId();
    if (chatId) {
      const message = buildTelegramMessage(allAlerts);
      await sendTelegram(chatId, message, "Markdown");
    }
  }

  console.log(`[google-monitor] Checked ${totalChecked} campaigns, ${allAlerts.length} alerts`);

  return NextResponse.json({
    success: true,
    checked: totalChecked,
    alerts: allAlerts.length,
    details: allAlerts,
    timestamp: new Date().toISOString(),
  });
}
