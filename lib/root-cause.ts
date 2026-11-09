// ============================================================
// CPL Root-Cause Diagnosis
// "Vì sao CPL spike?" — so sánh campaign hôm nay vs baseline 7 ngày
// (lib/anomaly-detector.ts), phân loại CPL theo ngưỡng chuẩn
// (lib/cpl-calculator.ts — nguồn duy nhất, theo quyết định 2026-07-27:
// KHÔNG đồng bộ với alert-rules.ts/budget-optimizer/ad-fatigue-engine,
// các nơi đó giữ nguyên ngưỡng hardcode riêng của chúng), rồi nhờ Gemini
// tổng hợp nguyên nhân khả dĩ + đề xuất fix. Nếu Gemini không khả dụng,
// fallback về danh sách possibleCauses tĩnh của anomaly-detector (thật,
// không phải data giả — chỉ là kém cụ thể hơn AI).
// ============================================================

import { metaClient } from "./meta-client";
import { googleAdsErrorMessage } from "@/lib/google-ads-error";
import { dateClauseForDays } from "@/lib/google-date-range";
import { googleAdsClient, convertMicros } from "./google-client";
import { getGoogleAdsCustomer } from "./google-ads-client";
import { gatherCampaigns } from "./nba/gather";
import { classifyCPL, getCplThresholds } from "./cpl-calculator";
import { callGemini, callWithTimeout, extractJSON } from "./gemini";
import { detectAnomalies, calculateBaseline, type DailyMetrics, type Anomaly } from "./anomaly-detector";
import type { RootCauseAnalysis } from "./alert-rules";
import type { Campaign } from "@/types/ads.types";

const BASELINE_DAYS = 7;
const CPL_CONV_ACTIONS = ["omni_purchase", "complete_registration"];

export interface RootCauseResult extends RootCauseAnalysis {
  campaign_id: string;
  campaign_name: string;
  company: string;
}

function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** [oldest, ..., today] — BASELINE_DAYS+1 mốc ngày. */
function lastDays(count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(dateStr(new Date(Date.now() - i * 86400000)));
  }
  return out;
}

function emptyDaily(): DailyMetrics {
  return { spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, cpm: 0, roas: 0, conversions: 0, frequency: 0, cpl: 0 };
}

async function metaDailyMetrics(campaignId: string, days: string[]): Promise<DailyMetrics[]> {
  // MỘT lượt gọi cho cả kỳ, chia theo ngày bằng time_increment=1.
  // Bản cũ gọi mỗi ngày một lượt (8 ngày = 8 lượt Meta cho MỘT cảnh báo), lại
  // bắn song song — trong khi nhánh Google ngay bên dưới cùng file đã lấy cả kỳ
  // trong một lượt rồi mới tách theo ngày. Cảnh báo CPL sinh ra theo cụm nên
  // kiểu gọi cũ là một trong những nguồn đốt hạn mức API to nhất.
  const rows = await metaClient.getCampaignInsights(
    [campaignId],
    { from: days[0], to: days[days.length - 1] },
    { timeIncrement: 1 },
  );

  const byDate = new Map<string, DailyMetrics>();
  for (const r of rows) {
    const spend = parseFloat(r.spend || "0");
    const conversions = (r.actions ?? [])
      .filter(a => CPL_CONV_ACTIONS.includes(a.action_type))
      .reduce((s, a) => s + parseFloat(a.value || "0"), 0);
    byDate.set(r.date_start, {
      spend,
      impressions: parseInt(r.impressions || "0", 10),
      clicks: parseInt(r.clicks || "0", 10),
      ctr: parseFloat(r.ctr || "0"),
      cpc: parseFloat(r.cpc || "0"),
      cpm: parseFloat(r.cpm || "0"),
      roas: 0, // không cần cho root-cause CPL, tránh gọi thêm action_values
      conversions,
      frequency: parseFloat(r.frequency || "0"),
      cpl: conversions > 0 ? spend / conversions : 0,
    });
  }

  // Ngày không có row = ngày không phân phối → 0 thật, không phải lỗi.
  return days.map(d => byDate.get(d) ?? emptyDaily());
}

async function googleDailyMetrics(campaignId: string, days: string[]): Promise<DailyMetrics[]> {
  const from = days[0];
  const to = days[days.length - 1];
  const all = await googleAdsClient.getCampaignInsights({ from, to }, true);
  const byDate = new Map<string, DailyMetrics>();
  for (const r of all) {
    if (r.campaignId !== campaignId) continue;
    const spend = convertMicros(r.costMicros);
    byDate.set(r.date, {
      spend,
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: r.ctr,
      cpc: r.clicks > 0 ? spend / r.clicks : 0,
      cpm: r.impressions > 0 ? (spend / r.impressions) * 1000 : 0,
      roas: 0,
      conversions: r.conversions,
      frequency: 0, // Google không expose frequency ở campaign level trong pipeline này
      cpl: r.conversions > 0 ? spend / r.conversions : 0,
    });
  }
  return days.map(d => byDate.get(d) ?? emptyDaily());
}

/** Google-only: search_budget_lost_impression_share 3 ngày gần nhất — tín hiệu "thiếu ngân sách" vs "demand-side". */
async function googleBudgetConstrained(campaignId: string, company: string): Promise<boolean> {
  try {
    const customer = getGoogleAdsCustomer(company);
    const query = `
      SELECT metrics.search_budget_lost_impression_share
      FROM campaign
      WHERE campaign.id = ${campaignId}
        AND ${dateClauseForDays(3)}
    `;
    const rows = await customer.query(query);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const avg = (rows as any[]).reduce((s, r) => s + (r.metrics?.search_budget_lost_impression_share || 0), 0) / Math.max(1, rows.length);
    return avg > 0.1; // >10% impression share mất vì budget — ngưỡng dùng chung với budget-optimizer
  } catch (err) {
    console.warn("[root-cause] search_budget_lost_impression_share fetch failed:", googleAdsErrorMessage(err));
    return false;
  }
}

function buildPrompt(
  campaign: Campaign,
  cpl: number | null,
  cplLevel: string,
  anomalies: Anomaly[],
  budgetConstrained: boolean
): string {
  // Đợt 21 B: công ty chưa có ngưỡng CPL (bản cài khách) → nói rõ "chưa đặt" thay vì sập.
  const th = getCplThresholds()[campaign.company ?? "MBC"] as { good: number; warning: number; critical: number } | undefined;
  const fmtK = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`);

  const anomalyLines = anomalies.length
    ? anomalies.map(a => `- ${a.description} (nguyên nhân khả dĩ theo hệ thống: ${a.possibleCauses.join("; ")})`).join("\n")
    : "- Không có chỉ số nào lệch bất thường so với TB 7 ngày (ngoài CPL).";

  return `Bạn là chuyên gia quảng cáo ${campaign.platform === "google" ? "Google Ads" : "Facebook Ads"}. Campaign "${campaign.name}" (${campaign.company}) đang có CPL ở mức "${cplLevel}".
${th ? `Ngưỡng ${campaign.company}: tốt ≤${fmtK(th.good)}, cảnh báo ${fmtK(th.good)}-${fmtK(th.warning)}, nguy hiểm ≥${fmtK(th.critical)}.` : `Ngưỡng ${campaign.company}: chưa đặt.`} CPL hiện tại: ${cpl !== null ? fmtK(Math.round(cpl)) : "chưa có data"}.

Các chỉ số bất thường so với trung bình 7 ngày gần nhất:
${anomalyLines}
${budgetConstrained ? "\n- Google Ads báo mất >10% impression share vì giới hạn ngân sách trong 3 ngày qua (search_budget_lost_impression_share cao)." : ""}

Dựa trên các tín hiệu trên (ưu tiên tín hiệu thật, không suy đoán ngoài dữ liệu), trả lời bằng JSON đúng schema sau, không thêm text ngoài JSON:
{
  "likely_causes": string[] (2-4 nguyên nhân khả dĩ nhất, xếp theo mức độ chắc chắn, tiếng Việt, ngắn gọn),
  "suggested_actions": string[] (2-3 hành động cụ thể nên làm ngay, tiếng Việt)
}`;
}

function fallbackFromAnomalies(anomalies: Anomaly[], budgetConstrained: boolean): { likely_causes: string[]; suggested_actions: string[] } {
  const causes = anomalies.flatMap(a => a.possibleCauses).slice(0, 4);
  if (budgetConstrained) causes.unshift("Ngân sách đang giới hạn — mất impression share cho search");
  if (causes.length === 0) causes.push("Chưa xác định — không có chỉ số nào lệch rõ so với TB 7 ngày, cần kiểm tra thủ công");

  return {
    likely_causes: causes.slice(0, 4),
    suggested_actions: [
      budgetConstrained
        ? "Cân nhắc tăng ngân sách nếu CPL vẫn trong ngưỡng chấp nhận được"
        : "Rà soát targeting/creative của campaign, so sánh với giai đoạn CPL còn tốt",
      "Theo dõi thêm 24-48h trước khi quyết định tạm dừng, tránh phản ứng với biến động ngắn hạn",
    ],
  };
}

/** Sinh phân tích root-cause cho 1 campaign. null nếu không tìm thấy campaign hoặc chưa đủ data. */
export async function generateRootCause(campaignId: string): Promise<RootCauseResult | null> {
  const campaigns = await gatherCampaigns();
  const campaign = campaigns.find(c => c.id === campaignId);
  if (!campaign) return null;

  const company = campaign.company ?? "MBC";
  const days = lastDays(BASELINE_DAYS + 1); // [7 ngày baseline..., hôm nay]

  const [daily, budgetConstrained] = await Promise.all([
    campaign.platform === "google" ? googleDailyMetrics(campaignId, days) : metaDailyMetrics(campaignId, days),
    campaign.platform === "google" ? googleBudgetConstrained(campaignId, company) : Promise.resolve(false),
  ]);

  const today = daily[daily.length - 1];
  const baseline = daily.slice(0, -1).filter(d => d.spend > 0 || d.conversions > 0);
  const anomalies = detectAnomalies(today, baseline);

  const cpl = today.conversions > 0 ? today.spend / today.conversions : null;
  const cplLevel = classifyCPL(cpl, company).level;

  const apiKey = process.env.GEMINI_API_KEY;
  let likely_causes: string[];
  let suggested_actions: string[];
  let ai_generated = false;

  if (apiKey && (anomalies.length > 0 || budgetConstrained)) {
    const prompt = buildPrompt(campaign, cpl, cplLevel, anomalies, budgetConstrained);
    const { result, timedOut } = await callWithTimeout(
      () => callGemini(prompt, { temperature: 0.4, maxOutputTokens: 500, responseMimeType: "application/json", thinkingBudget: 0 }, apiKey),
      20000
    );

    const parsed = !timedOut && result ? (extractJSON(result.text) as { likely_causes?: string[]; suggested_actions?: string[] } | null) : null;
    if (parsed?.likely_causes?.length && parsed?.suggested_actions?.length) {
      likely_causes = parsed.likely_causes;
      suggested_actions = parsed.suggested_actions;
      ai_generated = true;
    } else {
      ({ likely_causes, suggested_actions } = fallbackFromAnomalies(anomalies, budgetConstrained));
    }
  } else {
    ({ likely_causes, suggested_actions } = fallbackFromAnomalies(anomalies, budgetConstrained));
  }

  return {
    campaign_id: campaignId,
    campaign_name: campaign.name,
    company,
    generated_at: new Date().toISOString(),
    cpl,
    cpl_level: cplLevel,
    anomalies: anomalies.map(a => ({
      metric: a.metric,
      label: a.label,
      changePct: a.changePct,
      direction: a.direction,
      severity: a.severity,
      description: a.description,
    })),
    budget_constrained: budgetConstrained,
    likely_causes,
    suggested_actions,
    ai_generated,
  };
}
