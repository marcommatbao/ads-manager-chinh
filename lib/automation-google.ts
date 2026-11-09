// ============================================================
// AdsCommand — Automation Engine, Google Ads support
// Parallel to the Meta path in lib/automation-engine.ts (kept separate so
// the existing, working Meta path is untouched). Reuses the exact safety
// clamps (min/max vs original launch budget, mutation-guard) already
// proven in app/api/automation/google/budget-optimizer/route.ts.
//
// Cập nhật 2026-08-21 (AUTOMATION-META-GUARDS-1): chú thích cũ ghi "Meta
// executeAction() has none of these" — đúng vào lúc đó, và chỗ chênh lệch ấy
// nằm im gần một năm. Nay nhánh Meta đã có đủ cả 5 chốt (chặn xung đột, bỏ qua
// ngân sách cấp adset, kẹp 50%–300% mốc gốc, ngưỡng tối thiểu, lưu vết). Sửa
// một nhánh thì sửa nốt nhánh kia — đừng để lệch lần nữa.
// ============================================================

import { enums } from "google-ads-api";
import fs from "fs";
import path from "path";
import { getGoogleAdsCustomer } from "./google-ads-client";
import { googleAdsClient, convertMicros } from "./google-client";
import { checkRecentCampaignMutation, recordCampaignMutation } from "./mutation-guard";
import { writeFileAtomic } from "@/lib/fs-atomic";
import type { CampaignMetrics, Action } from "./automation-shared";
import { companyIds } from "@/lib/companies"

export interface GoogleEngineCampaign {
  id: string;
  resourceName: string;
  budgetResourceName: string;
  name: string;
  company: string;
  status: string;
  startDate: string | null;
  dailyBudget: number; // VND
  sharedBudget: boolean;
  /** SEARCH | PERFORMANCE_MAX | DISPLAY | VIDEO | DEMAND_GEN … (Đợt 10b — lọc luật theo loại chiến dịch). */
  channelType: string;
}

const ALERTS_FILE = path.join(process.cwd(), "data", "alerts.json");
const LAUNCHES_FILE = path.join(process.cwd(), "data", "google-launches.json");
const ABS_MIN_BUDGET = 100_000;

function loadLaunches(): Record<string, unknown>[] {
  if (!fs.existsSync(LAUNCHES_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(LAUNCHES_FILE, "utf-8")); } catch { return []; }
}

// ─────────────────────────────────────────────
// Campaign + metrics fetch
// ─────────────────────────────────────────────

/** All ENABLED Google campaigns (both companies) — call once per engine run, only when a rule needs platform google/all. */
export async function fetchGoogleCampaigns(): Promise<GoogleEngineCampaign[]> {
  const out: GoogleEngineCampaign[] = [];
  for (const company of companyIds()) {
    try {
      const customer = getGoogleAdsCustomer(company);

      // `campaign.start_date` KHÔNG phải tên trường hợp lệ — danh mục kiểu của
      // SDK (CampaignField, 225 trường) không có nó. Tên đúng là
      // `campaign.start_date_time`. Dùng sai tên thì GAQL từ chối CẢ câu SELECT,
      // nên hàm này trả về mảng rỗng cho cả MBC lẫn MBI và mọi Automation Rule
      // nhắm Google Ads âm thầm thấy 0 chiến dịch — không lỗi, không cảnh báo.
      // (Ghi chú "DO NOT re-add" ở lib/google-client.ts nói về đúng cặp tên
      //  SAI này; tên có hậu tố _time thì hợp lệ.)
      const FIELDS_WITH_DATE = `campaign.id, campaign.resource_name, campaign.name, campaign.status, campaign.advertising_channel_type,
               campaign.start_date_time,
               campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared`;
      const FIELDS_NO_DATE = `campaign.id, campaign.resource_name, campaign.name, campaign.status, campaign.advertising_channel_type,
               campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared`;

      const runQuery = (fields: string) => customer.query(`
        SELECT ${fields}
        FROM campaign
        WHERE campaign.status = 'ENABLED'
      `);

      // Đường lùi: nếu Google vẫn từ chối trường ngày (đổi phiên bản API…),
      // hỏi lại KHÔNG kèm trường đó để engine ít nhất còn THẤY chiến dịch —
      // thà mất chốt learning phase còn hơn mất sạch, như hiện trạng. Nhưng
      // phải kêu to, vì chốt đó là thứ chặn rule pause/đổi ngân sách một
      // chiến dịch còn đang học.
      let rows: unknown[];
      try {
        rows = await runQuery(FIELDS_WITH_DATE);
      } catch (dateErr) {
        console.warn(
          `[Automation/Google] Google từ chối campaign.start_date_time cho ${company} `
          + `(${dateErr instanceof Error ? dateErr.message : dateErr}). `
          + `Chạy tiếp KHÔNG có ngày bắt đầu — CHỐT LEARNING PHASE BỊ TẮT cho lượt này.`
        );
        rows = await runQuery(FIELDS_NO_DATE);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of rows as any[]) {
        out.push({
          id: String(row.campaign?.id ?? ""),
          resourceName: row.campaign?.resource_name ?? "",
          budgetResourceName: row.campaign_budget?.resource_name ?? "",
          name: row.campaign?.name ?? "",
          company,
          status: row.campaign?.status ?? "",
          startDate: row.campaign?.start_date_time ?? null,
          dailyBudget: convertMicros(row.campaign_budget?.amount_micros ?? 0),
          sharedBudget: row.campaign_budget?.explicitly_shared === true,
          channelType: String(enums.AdvertisingChannelType[row.campaign?.advertising_channel_type] ?? row.campaign?.advertising_channel_type ?? ""),
        });
      }
    } catch (err) {
      // console.error chứ không phải warn: hỏng ở đây nghĩa là MỌI rule tự
      // động của công ty này không chạy lượt nào — im lặng ở mức warn là lý do
      // lỗi tên trường sống được tới tận 16/09/2026.
      console.error(`[Automation/Google] KHÔNG lấy được chiến dịch cho ${company} — mọi rule Google của công ty này sẽ không chạy:`, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

/** Aggregated (summed) metrics per campaign over dateRange — same field mapping as lib/nba/gather.ts's Google path. */
export async function fetchGoogleMetrics(
  campaigns: GoogleEngineCampaign[],
  dateRange: { from: string; to: string }
): Promise<Map<string, CampaignMetrics>> {
  const out = new Map<string, CampaignMetrics>();
  const byId = new Map(campaigns.map(c => [c.id, c]));

  let insights: Awaited<ReturnType<typeof googleAdsClient.getCampaignInsights>>;
  try {
    insights = await googleAdsClient.getCampaignInsights(dateRange, true);
  } catch (err) {
    console.warn("[Automation/Google] fetch insights failed:", err instanceof Error ? err.message : err);
    return out;
  }

  const agg = new Map<string, { impressions: number; clicks: number; costMicros: number; conversions: number; revenue: number }>();
  for (const i of insights) {
    if (!byId.has(i.campaignId)) continue;
    const e = agg.get(i.campaignId) ?? { impressions: 0, clicks: 0, costMicros: 0, conversions: 0, revenue: 0 };
    e.impressions += i.impressions;
    e.clicks += i.clicks;
    e.costMicros += i.costMicros;
    e.conversions += i.conversions;
    e.revenue += i.conversionsValue;
    agg.set(i.campaignId, e);
  }

  for (const [id, a] of agg) {
    const campaign = byId.get(id);
    const spend = convertMicros(a.costMicros);
    const dailyBudget = campaign?.dailyBudget ?? 0;
    out.set(id, {
      ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
      cpc: a.clicks > 0 ? spend / a.clicks : 0,
      cpm: a.impressions > 0 ? (spend / a.impressions) * 1000 : 0,
      // `conversions_value` = 0 trong khi CÓ conversion nghĩa là tài khoản chưa
      // gán giá trị tiền cho conversion action đó (đúng với mọi campaign
      // lead-gen) → doanh thu CHƯA ĐO ĐƯỢC, không phải bằng không. Trả `null`
      // để luật `roas < …` bỏ qua thay vì kết luận là lỗ.
      roas: a.revenue > 0 && spend > 0 ? a.revenue / spend : null,
      spend,
      impressions: a.impressions,
      frequency: 0, // not exposed at campaign level for Google in this pipeline
      budget_used_pct: dailyBudget > 0 ? (spend / dailyBudget) * 100 : 0,
      conversions: a.conversions,
      cpl: a.conversions > 0 ? spend / a.conversions : 0,
      ctr_drop_pct: 0,
      days_running: campaign?.startDate ? Math.floor((Date.now() - new Date(campaign.startDate).getTime()) / 86400000) : 0,
      remaining_budget: dailyBudget > 0 ? dailyBudget - spend : 0,
      days_until_end: 0,   // Google campaigns in this pipeline don't track an end date
      end_date_is_set: 0,
    });
  }
  return out;
}

// ─────────────────────────────────────────────
// Notification writer — same shape as automation-engine.ts's pushNotification
// ─────────────────────────────────────────────

async function pushNotification(campaign: GoogleEngineCampaign, ruleName: string, message: string): Promise<void> {
  try {
    let alerts: unknown[] = [];
    try { alerts = JSON.parse(fs.readFileSync(ALERTS_FILE, "utf-8")); } catch { /* file may not exist yet */ }

    alerts.push({
      id: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: "automation_rule",
      severity: "warning",
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      company: campaign.company,
      message: `[Automation] ${ruleName}: ${message}`,
      metadata: {},
      is_read: false,
      is_resolved: false,
      created_at: new Date().toISOString(),
    });

    if (alerts.length > 500) alerts = alerts.slice(-500);
    await writeFileAtomic(ALERTS_FILE, JSON.stringify(alerts, null, 2));
  } catch (e) {
    console.error("[Automation/Google] Failed to write notification:", e);
  }
}

// ─────────────────────────────────────────────
// Action executor — real Google Ads mutations, guarded
// ─────────────────────────────────────────────

const MUTATION_ACTIONS = new Set(["pause_campaign", "activate_campaign", "increase_budget", "decrease_budget"]);

export async function executeGoogleAction(
  action: Action,
  campaign: GoogleEngineCampaign,
  ruleId: string,
  ruleName: string,
): Promise<void> {
  if (MUTATION_ACTIONS.has(action.type)) {
    const recent = checkRecentCampaignMutation(campaign.id, campaign.company, "automation_rule");
    if (recent.hasConflict) {
      console.log(`[Automation/Google] Skipping ${campaign.name} — ${recent.note}`);
      await pushNotification(campaign, ruleName, `Bỏ qua hành động — ${recent.note}`);
      return;
    }
  }

  switch (action.type) {
    case "pause_campaign":
    case "activate_campaign": {
      const customer = getGoogleAdsCustomer(campaign.company);
      const status = action.type === "pause_campaign" ? "PAUSED" : "ENABLED";
      await customer.mutateResources([
        { entity: "campaign", operation: "update", resource: { resource_name: campaign.resourceName, status } },
      ]);
      const msg = action.type === "pause_campaign"
        ? `Đã PAUSE campaign Google "${campaign.name}" — điều kiện rule đã khớp.`
        : `Đã kích hoạt lại campaign Google "${campaign.name}".`;
      console.log(`[Automation/Google] ${msg}`);
      await pushNotification(campaign, ruleName, msg);
      recordCampaignMutation({
        source: { type: "automation_rule", ruleId, ruleName, platform: "google" },
        event: action.type === "pause_campaign" ? "campaign.pause" : "campaign.resume",
        company: campaign.company, campaignId: campaign.id, campaignName: campaign.name,
        rationale: msg,
      });
      break;
    }
    case "increase_budget":
    case "decrease_budget": {
      if (campaign.sharedBudget) {
        console.log(`[Automation/Google] Skip budget change cho "${campaign.name}" — shared budget (nguy hiểm khi tự đổi).`);
        return;
      }
      if (campaign.dailyBudget <= 0) return;

      const pct = action.value ?? 20;
      const sign = action.type === "increase_budget" ? 1 : -1;
      let newBudget = Math.round(campaign.dailyBudget * (1 + (sign * pct) / 100));

      // Safety clamp — identical to google/budget-optimizer/route.ts: never
      // outside 50%-300% of the campaign's ORIGINAL launch budget, floor ₫100K.
      const launches = loadLaunches();
      const launch = launches.find(
        l => (l as Record<string, unknown>).campaignResourceName === campaign.resourceName
      ) as Record<string, unknown> | undefined;
      const originalBudget = (launch?.dailyBudget as number) ?? campaign.dailyBudget;
      const MIN_BUDGET = originalBudget * 0.5;
      const MAX_BUDGET = originalBudget * 3.0;
      newBudget = Math.max(ABS_MIN_BUDGET, Math.max(MIN_BUDGET, Math.min(MAX_BUDGET, newBudget)));

      if (Math.abs(newBudget - campaign.dailyBudget) < 50_000) return; // no meaningful change after clamping

      const customer = getGoogleAdsCustomer(campaign.company);
      await customer.mutateResources([
        { entity: "campaign_budget", operation: "update", resource: { resource_name: campaign.budgetResourceName, amount_micros: newBudget * 1_000_000 } },
      ]);
      const msg = `Đã ${action.type === "increase_budget" ? "tăng" : "giảm"} daily budget Google của "${campaign.name}" ${pct}% `
        + `(${campaign.dailyBudget.toLocaleString("vi-VN")}₫ → ${newBudget.toLocaleString("vi-VN")}₫).`;
      console.log(`[Automation/Google] ${msg}`);
      await pushNotification(campaign, ruleName, msg);
      recordCampaignMutation({
        source: { type: "automation_rule", ruleId, ruleName, platform: "google" },
        event: newBudget > campaign.dailyBudget ? "budget.increase" : "budget.decrease",
        company: campaign.company, campaignId: campaign.id, campaignName: campaign.name,
        rationale: msg,
      });
      break;
    }
    case "send_notification": {
      const msg = action.message
        ? `${action.message} — Campaign: "${campaign.name}"`
        : `Rule "${ruleName}" đã khớp với campaign "${campaign.name}".`;
      console.log(`[Automation/Google] 🔔 ${msg}`);
      await pushNotification(campaign, ruleName, msg);
      break;
    }
    case "send_email":
      console.log(`[Automation/Google] 📧 EMAIL (chưa cấu hình SMTP): ${action.message} — "${campaign.name}"`);
      await pushNotification(campaign, ruleName, `[Email] ${action.message ?? ""} — Campaign: "${campaign.name}"`);
      break;
    case "send_webhook":
      console.log(`[Automation/Google] 🌐 WEBHOOK (chưa cấu hình endpoint) — "${campaign.name}"`);
      break;
    case "add_to_report":
      console.log(`[Automation/Google] 📊 Added to report: "${campaign.name}"`);
      await pushNotification(campaign, ruleName, `Ghi nhận "${campaign.name}" khớp điều kiện — chưa có báo cáo tự tổng hợp, xem ở Lịch sử thực thi.`);
      break;
    case "request_ai_evaluation":
      console.log(`[Automation/Google] 🤖 AI evaluation requested for "${campaign.name}"`);
      await pushNotification(campaign, ruleName, `Đã đánh dấu campaign "${campaign.name}" để xem lại — chưa có AI tự đánh giá, cần người mở xem.`);
      break;
    case "pause_adset":
    case "pause_ad":
    case "suggest_new_creative":
    case "create_alert":
      // Không có khái niệm tương đương (ad set/ad-level pause) hoặc chưa
      // triển khai cho Google trong pipeline này — bỏ qua thay vì giả vờ chạy.
      console.log(`[Automation/Google] Action "${action.type}" chưa hỗ trợ cho Google — bỏ qua.`);
      break;
  }
}

// ─────────────────────────────────────────────
// Learning-phase guard — same day/conversion thresholds as Meta's version
// in lib/automation-engine.ts, generalized to Google's campaign.start_date.
// ─────────────────────────────────────────────

export interface LearningGuardResult {
  skip: boolean;
  reason?: string;
}

export function checkLearningGuardGoogle(
  respectLearningPhase: boolean | undefined,
  hasGuardedAction: boolean,
  campaign: GoogleEngineCampaign,
  conversionsThisWeek: number,
): LearningGuardResult {
  if (!hasGuardedAction) return { skip: false };
  if (respectLearningPhase === false) return { skip: false };
  if (!campaign.startDate) return { skip: false };

  const ageDays = Math.floor((Date.now() - new Date(campaign.startDate).getTime()) / 86400000);
  const isInLearning = ageDays < 7 || conversionsThisWeek < 50;

  if (isInLearning) {
    const phase = ageDays < 7 ? "learning" : "learning_limited";
    return {
      skip: true,
      reason: `Campaign đang trong ${phase === "learning" ? "learning phase" : "learning limited"} `
        + `(${ageDays} ngày tuổi, ${conversionsThisWeek} conversions/tuần). `
        + `Rule sẽ được áp dụng sau khi campaign thoát learning phase.`,
    };
  }
  return { skip: false };
}
