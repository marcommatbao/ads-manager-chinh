// ============================================================
// AdsCommand — Morning Briefing Engine
// Auto-generated daily report at 8:00 AM
// ============================================================

import { metaClient, initMetaClient, accountCurrency } from "@/lib/meta-client";
import { callGemini, callWithTimeout } from "@/lib/gemini";

// ─────────────────────────────────────────────
// Cờ bật/tắt — MẶC ĐỊNH TẮT (26/08/2026)
// ─────────────────────────────────────────────
//
// Tắt 26/08/2026 vì bản tin dài 30+ dòng mà gần như toàn báo động giả; BẬT LẠI
// cùng ngày sau khi sửa xong cả bốn nguyên nhân (xem chú thích đánh dấu
// "LỖI 1..4 (đã sửa)" trong chính file này).
//
// Mặc định BẬT. Muốn tắt lại mà không phải sửa mã: đặt `ENABLE_MORNING_BRIEFING=0`
// trong env. Khi tắt, route trả về ngay: KHÔNG gọi Meta, KHÔNG gọi Gemini — tức
// tắt là tiết kiệm cả hạn mức Meta lẫn tiền Gemini, không chỉ giấu cái thẻ đi.
export const MORNING_BRIEFING_ENABLED = process.env.ENABLE_MORNING_BRIEFING !== "0";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface PeriodInsights {
  totalSpend: number;
  impressions: number;
  clicks: number;
  avgCTR: number;
  avgCPC: number;
  avgCPM: number;
  roas: number;
  conversions: number;
  frequency: number;
}

export interface CampaignAlert {
  campaignId: string;
  campaignName: string;
  severity: "critical" | "warning" | "info";
  type: string;
  description: string;
  metric?: string;
  value?: number;
}

export interface Anomaly {
  metric: string;
  direction: "up" | "down";
  percentChange: number;
  description: string;
}

export interface CampaignHighlight {
  id: string;
  name: string;
  /** `null` = chưa đo được doanh thu. Xem chú thích ở runAlertRules. */
  roas: number | null;
  ctr: number;
  spend: number;
  reason: string;
}

export interface MorningBriefing {
  date: string;
  generatedAt: string;
  currency: string;

  yesterday: PeriodInsights;
  last7dAvg: PeriodInsights;
  monthSoFar: PeriodInsights;

  alerts: CampaignAlert[];
  anomalies: Anomaly[];

  topCampaigns: CampaignHighlight[];
  needAttention: CampaignHighlight[];

  aiSummary: string;

  forecast: {
    estimatedMonthSpend: number;
    daysLeft: number;
    dailyAvg: number;
  };

  /** Nguồn dữ liệu lấy hụt. Rỗng = số trong bản tin đầy đủ; có phần tử = các
   *  con số bên trên ĐANG THIẾU, không phải "hôm qua không chạy gì". */
  dataGaps: string[];
}

// ─────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────

function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function getDaysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// ─────────────────────────────────────────────
// Insights extraction
// ─────────────────────────────────────────────

interface RawInsightRow {
  impressions?: string;
  clicks?: string;
  spend?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  frequency?: string;
  reach?: string;
  actions?: Array<{ action_type: string; value: string }> | null;
  action_values?: Array<{ action_type: string; value: string }> | null;
}

function aggregateInsights(rows: RawInsightRow[]): PeriodInsights {
  let totalSpend = 0, totalImpressions = 0, totalClicks = 0;
  let totalConversions = 0, totalConversionValue = 0;
  let freqSum = 0, freqCount = 0;

  for (const r of rows) {
    const spend = parseFloat(r.spend ?? "0");
    const imps = parseInt(r.impressions ?? "0", 10);
    const clicks = parseInt(r.clicks ?? "0", 10);
    const freq = parseFloat(r.frequency ?? "0");

    totalSpend += spend;
    totalImpressions += imps;
    totalClicks += clicks;

    if (freq > 0) { freqSum += freq; freqCount++; }

    const conversions = r.actions
      ?.filter(a => ["purchase", "lead", "complete_registration", "offsite_conversion"].includes(a.action_type))
      .reduce((sum, a) => sum + parseFloat(a.value), 0) ?? 0;
    totalConversions += conversions;

    const convValue = r.action_values
      ?.filter(a => ["purchase", "offsite_conversion"].includes(a.action_type))
      .reduce((sum, a) => sum + parseFloat(a.value), 0) ?? 0;
    totalConversionValue += convValue;
  }

  return {
    totalSpend,
    impressions: totalImpressions,
    clicks: totalClicks,
    avgCTR: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
    avgCPC: totalClicks > 0 ? totalSpend / totalClicks : 0,
    avgCPM: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
    roas: totalSpend > 0 ? totalConversionValue / totalSpend : 0,
    conversions: totalConversions,
    frequency: freqCount > 0 ? freqSum / freqCount : 0,
  };
}

// ─────────────────────────────────────────────
// Alert detection
// ─────────────────────────────────────────────

interface CampaignWithMetrics {
  id: string;
  name: string;
  spend: number;
  ctr: number;
  cpc: number;
  /** `null` = chưa đo được doanh thu (không có tín hiệu purchase), KHÁC `0`. */
  roas: number | null;
  frequency: number;
  impressions: number;
  /** Trạng thái Meta thật sự — nguồn DUY NHẤT để biết bị từ chối hay không. */
  effectiveStatus: string;
  /** Số ngày chiến dịch đã chạy tính tới hôm nay. Chiến dịch vừa tạo mà chưa có
   *  impression thì không có gì bất thường để báo. */
  daysRunning: number;
}

/** Meta đang nói thẳng là chiến dịch có vấn đề — không phải suy đoán. */
const BLOCKED_STATUSES = new Set(["DISAPPROVED", "WITH_ISSUES", "PENDING_REVIEW"]);

/** Chiến dịch phải chạy đủ số ngày này rồi mới đáng nghi khi 0 impression. */
const MIN_DAYS_BEFORE_ZERO_IMPRESSION_ALERT = 2;

// ⚠️ BỐN LỖI KHIẾN BẢN TIN DÀI VÔ TẬN (chẩn đoán 26/08/2026, đọc từ chính mã).
// Ghi ở đây để ai bật `ENABLE_MORNING_BRIEFING` lại thì sửa trước, đừng bật rồi
// mới phát hiện.
//
//  1. `generateMorningBriefing` lấy campaign với status ["ACTIVE","PAUSED"] —
//     tức gồm cả chiến dịch đã tắt từ tháng 7. Chiến dịch đã tắt thì đương nhiên
//     0 impression trong cửa sổ 7 ngày.
//  2. Luật `impressions === 0` bên dưới KHÔNG có chốt nào về trạng thái hay chi
//     tiêu → mọi chiến dịch đã tắt đều bị dán "0 impression — có thể bị lỗi hoặc
//     bị từ chối". Đây là toàn bộ nguồn gốc của danh sách dài.
//  3. `frequency` được gán bằng CPM (xem chú thích "approximate" ở
//     `generateMorningBriefing`). CPM tính bằng đồng nên luôn > 3.5 → luật
//     "audience bão hoà" bắn cho gần như mọi chiến dịch.
//  4. `roas` chỉ tính từ `action_values` loại purchase. Chiến dịch lead-gen
//     (hoá đơn điện tử, chữ ký số, hợp đồng điện tử) không hề có giá trị
//     purchase → ROAS luôn 0.0x → bị tuyên "đang lỗ" dù chưa bao giờ được đo
//     doanh thu. Đây là khẳng định SAI về tiền, không chỉ là ồn ào.
//
// Ngoài ra `spend` ở đây là của CỬA SỔ 7 NGÀY nhưng câu mô tả không nói kỳ nào,
// nên "đang lỗ với chi tiêu ₫154.839" bị đọc thành số của hôm qua.
function runAlertRules(campaigns: CampaignWithMetrics[]): CampaignAlert[] {
  const alerts: CampaignAlert[] = [];

  for (const c of campaigns) {
    // ── LỖI 4 (đã sửa) — ROAS
    // Chỉ kết luận "đang lỗ" khi doanh thu THẬT SỰ đo được. `roas === null`
    // nghĩa là chiến dịch không hề phát sinh giá trị purchase (mọi chiến dịch
    // lead-gen đều vậy) — im lặng còn hơn tuyên một câu sai về tiền.
    if (c.roas !== null && c.roas < 0.8 && c.spend > 100000) {
      alerts.push({
        campaignId: c.id, campaignName: c.name,
        severity: "critical", type: "low_roas",
        // Nói rõ kỳ đo: `spend` là của cửa sổ 7 ngày, không phải hôm qua.
        description: `ROAS ${c.roas.toFixed(1)}x — đang lỗ với chi tiêu ₫${Math.round(c.spend).toLocaleString("vi-VN")} trong 7 ngày`,
        metric: "roas", value: c.roas,
      });
    }

    // ── LỖI 2 (đã sửa) — bị từ chối thì ĐỌC trạng thái, đừng suy từ impression
    if (BLOCKED_STATUSES.has(c.effectiveStatus)) {
      alerts.push({
        campaignId: c.id, campaignName: c.name,
        severity: "critical", type: "blocked_status",
        description: c.effectiveStatus === "PENDING_REVIEW"
          ? "Meta đang duyệt — chưa phân phối"
          : `Meta báo trạng thái ${c.effectiveStatus} — cần vào Ads Manager xử lý`,
      });
    }

    // ── LỖI 1 + 2 (đã sửa) — 0 impression chỉ đáng báo khi chiến dịch ĐANG BẬT
    // và đã chạy đủ lâu. Chiến dịch đã tắt thì 0 impression là chuyện đương
    // nhiên, không phải sự cố; đó là toàn bộ nguồn gốc của bản tin 30+ dòng.
    if (
      c.impressions === 0 &&
      c.effectiveStatus === "ACTIVE" &&
      c.daysRunning >= MIN_DAYS_BEFORE_ZERO_IMPRESSION_ALERT
    ) {
      alerts.push({
        campaignId: c.id, campaignName: c.name,
        severity: "critical", type: "zero_impressions",
        description: `Đang bật nhưng 0 impression suốt ${c.daysRunning} ngày — kiểm tra ad set, ngân sách hoặc đối tượng`,
      });
    }

    // ── LỖI 3 (đã sửa) — `frequency` nay là frequency thật, không còn là CPM
    // Warning: High frequency
    if (c.frequency > 3.5 && c.effectiveStatus === "ACTIVE") {
      alerts.push({
        campaignId: c.id, campaignName: c.name,
        severity: "warning", type: "high_frequency",
        description: `Frequency ${c.frequency.toFixed(1)}x — audience bão hoà, cần refresh creative`,
        metric: "frequency", value: c.frequency,
      });
    }

    // Warning: CPC too high — chỉ với chiến dịch đang bật; chiến dịch đã tắt thì
    // không có việc gì để làm hôm nay.
    if (c.cpc > 50000 && c.effectiveStatus === "ACTIVE") {
      alerts.push({
        campaignId: c.id, campaignName: c.name,
        severity: "warning", type: "high_cpc",
        description: `CPC ₫${Math.round(c.cpc).toLocaleString("vi-VN")} — quá cao, cần tối ưu targeting/creative`,
        metric: "cpc", value: c.cpc,
      });
    }

    // Warning: Low CTR
    if (c.ctr < 0.5 && c.impressions > 1000 && c.effectiveStatus === "ACTIVE") {
      alerts.push({
        campaignId: c.id, campaignName: c.name,
        severity: "warning", type: "low_ctr",
        description: `CTR ${c.ctr.toFixed(2)}% — quá thấp, creative không thu hút`,
        metric: "ctr", value: c.ctr,
      });
    }
  }

  return alerts;
}

// ─────────────────────────────────────────────
// Anomaly detection
// ─────────────────────────────────────────────

function detectAnomalies(yesterday: PeriodInsights, last7dAvg: PeriodInsights): Anomaly[] {
  const anomalies: Anomaly[] = [];

  const checks: { metric: string; yVal: number; avgVal: number; label: string; unit: string }[] = [
    { metric: "spend", yVal: yesterday.totalSpend, avgVal: last7dAvg.totalSpend / 7, label: "Chi tiêu", unit: "₫" },
    { metric: "ctr", yVal: yesterday.avgCTR, avgVal: last7dAvg.avgCTR, label: "CTR", unit: "%" },
    { metric: "cpc", yVal: yesterday.avgCPC, avgVal: last7dAvg.avgCPC, label: "CPC", unit: "₫" },
    { metric: "roas", yVal: yesterday.roas, avgVal: last7dAvg.roas, label: "ROAS", unit: "x" },
  ];

  for (const { metric, yVal, avgVal, label, unit } of checks) {
    if (avgVal === 0) continue;
    const pctChange = ((yVal - avgVal) / avgVal) * 100;

    if (Math.abs(pctChange) > 20) {
      const direction = pctChange > 0 ? "up" : "down";
      const arrow = pctChange > 0 ? "↑" : "↓";
      anomalies.push({
        metric, direction, percentChange: Math.abs(pctChange),
        description: `${label} hôm qua ${arrow} ${Math.abs(pctChange).toFixed(0)}% so với TB 7 ngày (${yVal.toFixed(metric === "spend" ? 0 : 1)}${unit} vs ${avgVal.toFixed(metric === "spend" ? 0 : 1)}${unit})`,
      });
    }
  }

  return anomalies;
}

// ─────────────────────────────────────────────
// Format helpers for prompt
// ─────────────────────────────────────────────

function formatCurrencyVN(val: number): string {
  if (val >= 1_000_000) return `₫${(val / 1_000_000).toFixed(1)}Tr`;
  if (val >= 1_000) return `₫${(val / 1_000).toFixed(0)}K`;
  return `₫${Math.round(val).toLocaleString("vi-VN")}`;
}

function trendArrow(current: number, previous: number): string {
  if (previous === 0) return "—";
  const pct = ((current - previous) / previous) * 100;
  return pct > 0 ? `▲ +${pct.toFixed(1)}` : `▼ ${pct.toFixed(1)}`;
}

// ─────────────────────────────────────────────
// Build Gemini prompt
// ─────────────────────────────────────────────

/** Trần số cảnh báo nhét vào prompt. */
const PROMPT_MAX_ALERTS = 8;

export function buildBriefingPrompt(data: {
  today: string;
  yesterday: PeriodInsights;
  last7dAvg: PeriodInsights;
  alerts: CampaignAlert[];
  anomalies: Anomaly[];
  forecast: { estimatedMonthSpend: number; daysLeft: number };
  /** Chỉ những campaign ĐO ĐƯỢC ROAS. Đưa vào prompt để AI không bịa tên. */
  topCampaigns?: CampaignHighlight[];
}): string {
  const { today, yesterday, last7dAvg, alerts, anomalies, forecast } = data;
  const topNames = (data.topCampaigns ?? []).map(
    c => `${c.name} (ROAS ${(c.roas ?? 0).toFixed(1)}x, CTR ${c.ctr.toFixed(2)}%)`,
  );
  const critical = alerts.filter(a => a.severity === "critical");
  const warnings = alerts.filter(a => a.severity === "warning");
  const avgDailySpend = last7dAvg.totalSpend / 7;

  return `
Bạn là AI Marketing Analyst của AdsCommand.
Hôm nay là ${today}, 8:00 AM.
Tạo báo cáo buổi sáng ngắn gọn, súc tích. Viết bằng tiếng Việt.

HIỆU SUẤT HÔM QUA:
Spend=${formatCurrencyVN(yesterday.totalSpend)} | Imp=${yesterday.impressions.toLocaleString("vi-VN")} | CTR=${yesterday.avgCTR.toFixed(2)}% | CPC=${formatCurrencyVN(yesterday.avgCPC)} | ROAS=${yesterday.roas.toFixed(1)}x | Conv=${yesterday.conversions}

SO SÁNH 7 NGÀY: Spend${trendArrow(yesterday.totalSpend, avgDailySpend)}% | CTR${trendArrow(yesterday.avgCTR, last7dAvg.avgCTR)}% | CPC${trendArrow(yesterday.avgCPC, last7dAvg.avgCPC)}% | ROAS${trendArrow(yesterday.roas, last7dAvg.roas)}%

CAMPAIGNS CẦN CHÚ Ý (đã cắt còn ${PROMPT_MAX_ALERTS} mục mỗi mức — nhồi cả trăm dòng vào đây chỉ tốn token và làm AI viết loãng):
🔴 ${critical.length > 0 ? critical.slice(0, PROMPT_MAX_ALERTS).map(a => `${a.campaignName}(${a.description})`).join(", ") + (critical.length > PROMPT_MAX_ALERTS ? ` …+${critical.length - PROMPT_MAX_ALERTS} mục` : "") : "Không có"}
🟡 ${warnings.length > 0 ? warnings.slice(0, PROMPT_MAX_ALERTS).map(a => `${a.campaignName}(${a.description})`).join(", ") + (warnings.length > PROMPT_MAX_ALERTS ? ` …+${warnings.length - PROMPT_MAX_ALERTS} mục` : "") : "Không có"}

DỊ THƯỜNG: ${anomalies.length > 0 ? anomalies.map(a => a.description).join(" | ") : "Không có"}

KPI: CTR>${yesterday.avgCTR.toFixed(2)}%(target>2%) | CPC=${formatCurrencyVN(yesterday.avgCPC)}(target<₫30k)

YÊU CẦU OUTPUT (ngắn gọn, dùng emoji, viết tiếng Việt):
1. 📊 TỔNG QUAN (2-3 câu nhận xét ngày hôm qua)
2. ✅ TOP 3 CAMPAIGN đang scale tốt nhất — CHỈ lấy từ danh sách dưới đây, KHÔNG được tự nghĩ ra tên campaign nào khác. Danh sách rỗng thì ghi đúng một câu "Chưa có campaign nào đo được doanh thu để xếp hạng".
   Danh sách đo được ROAS: ${topNames.length > 0 ? topNames.join(" | ") : "(rỗng)"}
3. ⚠️ TOP 3 CAMPAIGN cần xử lý NGAY hôm nay — ghi rõ tên và vấn đề cụ thể
4. 🎯 1 VIỆC QUAN TRỌNG NHẤT nên làm trước 10AM hôm nay
5. 💰 Dự báo: tháng này sẽ tiêu khoảng ${formatCurrencyVN(forecast.estimatedMonthSpend)} (còn ${forecast.daysLeft} ngày)

Trả lời TRỰC TIẾP bằng text có emoji, KHÔNG dùng JSON, KHÔNG markdown code blocks.
Mỗi section xuống dòng rõ ràng.
`.trim();
}

// ─────────────────────────────────────────────
// Main generator
// ─────────────────────────────────────────────

export async function generateMorningBriefing(): Promise<MorningBriefing> {
  // 0. Init meta client for currency
  await initMetaClient();
  const currency = accountCurrency;

  const now = new Date();
  const today = dateStr(now);

  // Date ranges
  const yesterdayDate = new Date(now.getTime() - 86400000);
  const yesterdayStr = dateStr(yesterdayDate);
  const last7dStart = dateStr(new Date(now.getTime() - 7 * 86400000));
  const monthStart = dateStr(new Date(now.getFullYear(), now.getMonth(), 1));

  // Sổ ghi nguồn lấy hụt. Bản tin này gửi cho quản lý mỗi sáng: Meta trục trặc
  // mà nuốt lỗi thì cả bản tin hiện số 0 (chi tiêu, lead, CPL) và người đọc
  // hiểu là "hôm qua không chạy gì", chứ không phải "không lấy được số".
  const dataGaps: string[] = [];
  const noteGap = (label: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MorningBriefing] ${label} lỗi:`, msg);
    dataGaps.push(`${label}: ${msg}`);
  };

  // 1. Fetch insights in parallel
  const [yesterdayInsights, last7dInsights, monthInsights] = await Promise.all([
    metaClient.getAccountInsights({ from: yesterdayStr, to: yesterdayStr }).catch(e => { noteGap("số liệu hôm qua", e); return []; }),
    metaClient.getAccountInsights({ from: last7dStart, to: yesterdayStr }).catch(e => { noteGap("số liệu 7 ngày", e); return []; }),
    metaClient.getAccountInsights({ from: monthStart, to: yesterdayStr }).catch(e => { noteGap("số liệu tháng", e); return []; }),
  ]);

  const yesterday = aggregateInsights(yesterdayInsights);
  const last7d = aggregateInsights(last7dInsights);
  const monthSoFar = aggregateInsights(monthInsights);

  // 2. Fetch campaigns + per-campaign insights
  //
  // ── LỖI 1 (đã sửa) ──
  // Trước đây lấy cả PAUSED, nên chiến dịch tắt từ tháng 7 vẫn vào bản tin và
  // bị dán "0 impression — có thể bị lỗi". Bản tin buổi sáng chỉ nên nói về
  // việc CẦN LÀM HÔM NAY: chiến dịch đang bật, cộng những chiến dịch Meta đang
  // chặn/đang duyệt (đó mới thật sự là việc phải xử lý).
  const campaigns = await metaClient
    .getCampaigns({ status: ["ACTIVE", "WITH_ISSUES", "DISAPPROVED", "PENDING_REVIEW"] })
    .catch(e => { noteGap("danh sách chiến dịch", e); return []; });
  const campaignIds = campaigns.map(c => c.id);

  let campaignMetrics: CampaignWithMetrics[] = [];
  if (campaignIds.length > 0) {
    const insights = await metaClient.getCampaignInsights(campaignIds, { from: last7dStart, to: yesterdayStr }).catch(e => { noteGap("insights theo chiến dịch", e); return []; });

    campaignMetrics = campaigns.map(c => {
      const raw = insights.find(i => i.campaign_id === c.id);
      const spend = parseFloat(raw?.spend ?? "0");
      const clicks = parseInt(raw?.clicks ?? "0", 10);
      const imps = parseInt(raw?.impressions ?? "0", 10);

      // ── LỖI 4 (đã sửa) ──
      // Không có dòng purchase nào trong `action_values` nghĩa là doanh thu
      // CHƯA ĐO ĐƯỢC, không phải bằng 0. Trả null để luật ROAS bỏ qua thay vì
      // tuyên chiến dịch lead-gen "đang lỗ".
      const revenueRows = raw?.action_values
        ?.filter(a => ["purchase", "offsite_conversion"].includes(a.action_type)) ?? [];
      const convValue = revenueRows.reduce((sum, a) => sum + parseFloat(a.value), 0);

      const startedAt = c.start_time ? new Date(c.start_time).getTime() : NaN;
      const daysRunning = Number.isNaN(startedAt)
        ? 0
        : Math.max(0, Math.floor((Date.now() - startedAt) / 86400000));

      return {
        id: c.id,
        name: c.name,
        spend,
        ctr: imps > 0 ? (clicks / imps) * 100 : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        roas: revenueRows.length > 0 && spend > 0 ? convValue / spend : null,
        // ── LỖI 3 (đã sửa) ──
        // Trước đây gán bằng `cpm`. CPM tính bằng đồng (vài chục nghìn) nên luật
        // "frequency > 3.5 = bão hoà" bắn cho gần như mọi chiến dịch. `frequency`
        // vốn ĐÃ nằm sẵn trong INSIGHT_FIELDS — chỉ là chưa ai đọc đúng trường.
        frequency: parseFloat(raw?.frequency ?? "0"),
        impressions: imps,
        effectiveStatus: c.effective_status,
        daysRunning,
      };
    });
  }

  // 3. Run alerts
  const alerts = runAlertRules(campaignMetrics);

  // 4. Detect anomalies
  const anomalies = detectAnomalies(yesterday, last7d);

  // 5. Forecast
  const dayOfMonth = now.getDate();
  const totalDaysInMonth = getDaysInMonth(now);
  const daysLeft = totalDaysInMonth - dayOfMonth;
  const dailyAvg = dayOfMonth > 1 ? monthSoFar.totalSpend / (dayOfMonth - 1) : monthSoFar.totalSpend;
  const estimatedMonthSpend = monthSoFar.totalSpend + (dailyAvg * daysLeft);

  const forecast = { estimatedMonthSpend, daysLeft, dailyAvg };

  // 6. Top/Bottom campaigns
  // Chỉ xếp hạng những chiến dịch ĐO ĐƯỢC doanh thu. Chiến dịch lead-gen có
  // roas = null nếu ép về 0 sẽ luôn nằm đáy bảng "scale tốt nhất" — một thứ tự
  // hoàn toàn vô nghĩa vì chúng chưa từng được đo.
  const sortedByRoas = campaignMetrics
    .filter((c): c is CampaignWithMetrics & { roas: number } => c.spend > 0 && c.roas !== null)
    .sort((a, b) => b.roas - a.roas);
  const topCampaigns: CampaignHighlight[] = sortedByRoas.slice(0, 3).map(c => ({
    id: c.id, name: c.name, roas: c.roas, ctr: c.ctr, spend: c.spend,
    reason: `ROAS ${c.roas.toFixed(1)}x, CTR ${c.ctr.toFixed(2)}%`,
  }));
  const needAttention: CampaignHighlight[] = alerts
    .filter(a => a.severity === "critical" || a.severity === "warning")
    .slice(0, 3)
    .map(a => {
      const c = campaignMetrics.find(cm => cm.id === a.campaignId);
      return {
        id: a.campaignId, name: a.campaignName,
        roas: c?.roas ?? null, ctr: c?.ctr ?? 0, spend: c?.spend ?? 0,
        reason: a.description,
      };
    });

  // 7. AI Summary via Gemini
  let aiSummary = "";
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const prompt = buildBriefingPrompt({ today, yesterday, last7dAvg: last7d, alerts, anomalies, forecast, topCampaigns });
      const { result: geminiRes, timedOut } = await callWithTimeout(
        // thinkingBudget: 0 — đo thật 3 lần mỗi kiểu: để mặc định (thinking bật)
        // bản tin trả về ~142 ký tự, tắt thinking ra ~1790 ký tự. Thinking rút
        // token từ chính hạn mức 1024 nên bản tin bị bóp còn một câu cụt mà
        // không báo lỗi gì — nhìn tưởng AI viết cộc lốc chứ không phải bị cắt.
        () => callGemini(prompt, { temperature: 0.7, maxOutputTokens: 1024, thinkingBudget: 0 }, apiKey),
        25000
      );
      if (!timedOut && geminiRes?.text) {
        aiSummary = geminiRes.text;
      } else {
        console.warn("[MorningBriefing] Gemini timed out — using fallback");
        aiSummary = generateFallbackSummary(yesterday, last7d, alerts, anomalies, forecast);
      }
    } catch (err) {
      console.warn("[MorningBriefing] AI summary failed:", err instanceof Error ? err.message : err);
      aiSummary = generateFallbackSummary(yesterday, last7d, alerts, anomalies, forecast);
    }
  } else {
    aiSummary = generateFallbackSummary(yesterday, last7d, alerts, anomalies, forecast);
  }

  return {
    date: today,
    generatedAt: new Date().toISOString(),
    currency,
    dataGaps,
    yesterday,
    last7dAvg: {
      ...last7d,
      totalSpend: last7d.totalSpend / 7,
      impressions: Math.round(last7d.impressions / 7),
      clicks: Math.round(last7d.clicks / 7),
      conversions: Math.round(last7d.conversions / 7),
    },
    monthSoFar,
    alerts,
    anomalies,
    topCampaigns,
    needAttention,
    aiSummary,
    forecast,
  };
}

// ─────────────────────────────────────────────
// Fallback summary (no Gemini)
// ─────────────────────────────────────────────

// Bản dự phòng khi Gemini hỏng/timeout. LƯU Ý: prompt gửi Gemini yêu cầu "TOP 3
// campaign cần xử lý", còn hàm này in RA HẾT mọi cảnh báo critical, không giới
// hạn. Bản tin người dùng thấy hôm 26/08 (30+ dòng) khớp từng chữ với định dạng
// của hàm này ⇒ hôm đó Gemini đã hỏng và không ai biết: bản dự phòng KHÔNG hề
// tự nói nó là bản dự phòng.
function generateFallbackSummary(
  yesterday: PeriodInsights,
  last7d: PeriodInsights,
  alerts: CampaignAlert[],
  anomalies: Anomaly[],
  forecast: { estimatedMonthSpend: number; daysLeft: number }
): string {
  const critical = alerts.filter(a => a.severity === "critical");
  const warnings = alerts.filter(a => a.severity === "warning");

  // Bản tin là thứ đọc trong 30 giây trước 10 giờ sáng. Liệt kê 30 dòng thì
  // không ai đọc dòng nào — cắt còn số việc thật sự làm được trong buổi sáng,
  // và NÓI RÕ còn bao nhiêu dòng bị cắt thay vì lặng lẽ giấu đi.
  const MAX_LINES = 5;
  const listOf = (items: Array<{ campaignName: string; description: string }>) => {
    const shown = items.slice(0, MAX_LINES)
      .map(a => `• ${a.campaignName}: ${a.description}`).join("\n");
    const hidden = items.length - MAX_LINES;
    return hidden > 0 ? `${shown}\n• …và ${hidden} mục nữa — xem đầy đủ ở trang Thông báo.` : shown;
  };

  // Bản dự phòng PHẢI tự khai nó là bản dự phòng. Sáng 26/08 người dùng đọc
  // đúng bản này mà tưởng là AI viết — Gemini đã hỏng mà không ai biết.
  let text = `📊 TỔNG QUAN\nHôm qua chi tiêu ${formatCurrencyVN(yesterday.totalSpend)}, ROAS ${yesterday.roas.toFixed(1)}x, CTR ${yesterday.avgCTR.toFixed(2)}%.\n(Bản rút gọn — AI tạm thời không phản hồi, đây là số liệu thô chưa qua phân tích.)\n\n`;

  if (critical.length > 0) {
    text += `⚠️ CẦN XỬ LÝ NGAY\n${listOf(critical)}\n\n`;
  }
  if (warnings.length > 0) {
    text += `🟡 CẢNH BÁO\n${listOf(warnings)}\n\n`;
  }
  if (critical.length === 0 && warnings.length === 0) {
    text += `✅ Không có chiến dịch nào cần xử lý sáng nay.\n\n`;
  }
  if (anomalies.length > 0) {
    text += `📈 DỊ THƯỜNG\n${anomalies.map(a => `• ${a.description}`).join("\n")}\n\n`;
  }

  text += `💰 Dự báo tháng: ${formatCurrencyVN(forecast.estimatedMonthSpend)} (còn ${forecast.daysLeft} ngày)`;

  return text;
}

// ─────────────────────────────────────────────
// In-memory cache (1 briefing per day)
// ─────────────────────────────────────────────

let _cachedBriefing: MorningBriefing | null = null;

export function getCachedBriefing(): MorningBriefing | null {
  if (!_cachedBriefing) return null;
  // Only valid for today
  const today = dateStr(new Date());
  if (_cachedBriefing.date !== today) return null;
  return _cachedBriefing;
}

export function setCachedBriefing(b: MorningBriefing): void {
  _cachedBriefing = b;
}
