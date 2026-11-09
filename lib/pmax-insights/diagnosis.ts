// ─────────────────────────────────────────────
// PMax Insights 2.0 — AI Diagnosis (Stage 1)
// Grounded in real computed scores/coverage/channel data — the prompt
// only ever gives Gemini numbers already computed deterministically in
// scoring.ts, never asks it to invent metrics. On failure/no API key,
// falls back to a template diagnosis built from the same real numbers
// (degraded wording, not degraded truthfulness — every fallback field is
// still grounded, just less naturally phrased).
// ─────────────────────────────────────────────

import { callGemini, callWithTimeout, extractJSON } from "@/lib/gemini";
import type { CampaignOverview, AssetGroupOverview, PMaxDiagnosis, PMaxRootCause } from "./types";
import { ROOT_CAUSE_LABEL } from "./types";
import type { PMaxSearchCategory } from "@/lib/google-pmax-client";

const VALID_ROOT_CAUSES: PMaxRootCause[] = ["search_intent", "asset_coverage", "creative_quality", "structure", "insufficient_data"];

interface DiagnosisDraft {
  whatsWorking: string[];
  whatsLimiting: string[];
  mainContributor: string;
  safeToScale: boolean | null;
  needsProtection: boolean;
  rootCause: PMaxRootCause;
  confidenceNote: string;
}

function fallbackCampaignDiagnosis(overview: CampaignOverview, topCategories: PMaxSearchCategory[]): DiagnosisDraft {
  const { scores, metrics, assetCoverage, channelMix } = overview;
  const topChannel = [...channelMix].sort((a, b) => b.pct - a.pct)[0];
  const topCategory = topCategories[0];

  const whatsWorking: string[] = [];
  const whatsLimiting: string[] = [];

  const priorDays = Math.max(1, metrics.totalDays - metrics.recentDays);
  const trendBasis = `${metrics.recentDays} ngày gần nhất so với ${priorDays} ngày trước đó`;

  // Recent-vs-prior impressions/CTR — same non-overlapping split as
  // trendPct — lets the fallback (no-Gemini) path tell apart "ít người
  // thấy quảng cáo hơn" (search_intent: fewer impressions) from "vẫn
  // hiển thị đều nhưng ít người bấm hơn" (creative_quality: CTR down),
  // instead of only ever landing on "structure" as a default guess.
  const priorImpressions = Math.max(0, metrics.impressionsTotal - metrics.impressionsRecent);
  const priorClicks = Math.max(0, metrics.clicksTotal - metrics.clicksRecent);
  const impressionsPerDayRecent = metrics.impressionsRecent / metrics.recentDays;
  const impressionsPerDayPrior = priorImpressions / priorDays;
  const impressionsTrendPct = impressionsPerDayPrior > 0
    ? ((impressionsPerDayRecent - impressionsPerDayPrior) / impressionsPerDayPrior) * 100
    : 0;
  const ctrPrior = priorImpressions > 0 ? (priorClicks / priorImpressions) * 100 : 0;
  const ctrTrendPct = ctrPrior > 0 ? ((metrics.ctrRecent - ctrPrior) / ctrPrior) * 100 : 0;

  if (scores.performance >= 65) whatsWorking.push(`ROAS ${metrics.totalDays} ngày ${metrics.roasTotal.toFixed(1)}x, hiệu quả tốt so với trung bình tài khoản`);
  if (metrics.trendLowBaseline) {
    whatsWorking.push(`Giai đoạn ${priorDays} ngày trước gần như chưa có doanh thu — chưa đủ cơ sở để tính % xu hướng, cần thêm dữ liệu`);
  } else if (metrics.trendPct > 10) {
    whatsWorking.push(`Xu hướng doanh thu/ngày tăng ${metrics.trendPct.toFixed(0)}% (${trendBasis})`);
  }
  if (topChannel) whatsWorking.push(`Kênh đóng góp chính: ${topChannel.channel} (${topChannel.pct.toFixed(0)}% chi phí)`);
  // Google không lộ chi phí ở mức search-category nên không có ROAS thật để so.
  // Bản cũ so với một ROAS dựng từ chi phí = 0 — tức luôn ra "hiệu quả tốt".
  // Nay chỉ nói điều đo được: có bao nhiêu chuyển đổi.
  if (topCategory && topCategory.conversions > 0) {
    whatsWorking.push(`Search category "${topCategory.categoryLabel}" đang ra ${topCategory.conversions} chuyển đổi`);
  }

  if (assetCoverage.gaps.length > 0) whatsLimiting.push(...assetCoverage.gaps);
  if (!metrics.trendLowBaseline && metrics.trendPct < -10) {
    whatsLimiting.push(`Xu hướng doanh thu/ngày giảm ${Math.abs(metrics.trendPct).toFixed(0)}% (${trendBasis})`);
    if (impressionsPerDayPrior > 0 && impressionsTrendPct < -20) {
      whatsLimiting.push(`Lượt hiển thị/ngày giảm ${Math.abs(Math.round(impressionsTrendPct))}% (${trendBasis}) — ít người thấy quảng cáo hơn, có thể do nhu cầu tìm kiếm giảm hoặc bị giới hạn ngân sách/bid`);
    } else if (ctrPrior > 0 && ctrTrendPct < -20) {
      whatsLimiting.push(`CTR giảm từ ${ctrPrior.toFixed(2)}% xuống ${metrics.ctrRecent.toFixed(2)}% (${trendBasis}) dù lượt hiển thị không giảm nhiều — quảng cáo/creative có thể đang kém hấp dẫn hơn`);
    }
  }
  if (scores.confidence < 40) whatsLimiting.push("Khối lượng conversion còn thấp, số liệu chưa đủ ổn định để kết luận chắc chắn");
  if (whatsWorking.length === 0) whatsWorking.push("Chưa có tín hiệu nổi bật — cần thêm dữ liệu");
  if (whatsLimiting.length === 0) whatsLimiting.push("Không có điểm hạn chế rõ ràng trong dữ liệu hiện có");

  // Same signals drive rootCause: only actually blame search_intent/
  // creative_quality when the trend is genuinely declining AND the
  // impressions/CTR pattern points that way — otherwise keep the old,
  // more conservative asset/structure/insufficient_data buckets.
  const isDeclining = !metrics.trendLowBaseline && metrics.trendPct < -10;
  const rootCause: PMaxRootCause = scores.confidence < 30
    ? "insufficient_data"
    : isDeclining && impressionsPerDayPrior > 0 && impressionsTrendPct < -20
    ? "search_intent"
    : isDeclining && ctrPrior > 0 && ctrTrendPct < -20
    ? "creative_quality"
    : assetCoverage.gaps.length >= 2
    ? "asset_coverage"
    : "structure";

  return {
    whatsWorking,
    whatsLimiting,
    mainContributor: topChannel ? topChannel.channel : "Chưa xác định",
    safeToScale: scores.confidence < 30 ? null : scores.performance >= 65 && scores.expansionReadiness >= 65,
    needsProtection: scores.performance >= 65 && scores.expansionReadiness < 65,
    rootCause,
    confidenceNote: `Độ tin cậy ${scores.confidence}/100 — dựa trên ${metrics.conversionsTotal} conversion và ${metrics.clicksTotal} click trong ${metrics.totalDays} ngày. Doanh thu tính theo tracking quảng cáo, chưa đối soát Odoo.`,
  };
}

async function draftDiagnosis(prompt: string, fallback: DiagnosisDraft): Promise<{ draft: DiagnosisDraft; aiGenerated: boolean }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { draft: fallback, aiGenerated: false };

  // thinkingBudget MUST be 0 here — Gemini's default thinking mode eats
  // into maxOutputTokens before producing any answer text, and 700 tokens
  // is nowhere near enough headroom for both thinking + a full JSON
  // diagnosis. Without this, calls were silently timing out/truncating
  // and EVERY diagnosis fell back to the deterministic template (which can
  // only ever report 1 of 3 generic root causes) — confirmed live
  // 2026-07-31, user reported every campaign diagnosis showing "(phân
  // tích cơ bản — AI không khả dụng)". Same class of bug already fixed
  // once for /api/creative/generate-text — see lib/gemini.ts's
  // thinkingBudget doc comment.
  const { result, timedOut } = await callWithTimeout(
    () => callGemini(prompt, { temperature: 0.4, maxOutputTokens: 700, responseMimeType: "application/json", thinkingBudget: 0 }, apiKey),
    20_000
  );

  const parsed = !timedOut && result ? (extractJSON(result.text) as Partial<DiagnosisDraft> | null) : null;
  if (
    parsed?.whatsWorking?.length && parsed.whatsLimiting?.length && parsed.mainContributor &&
    parsed.rootCause && VALID_ROOT_CAUSES.includes(parsed.rootCause) && parsed.confidenceNote
  ) {
    return {
      draft: {
        whatsWorking: parsed.whatsWorking,
        whatsLimiting: parsed.whatsLimiting,
        mainContributor: parsed.mainContributor,
        safeToScale: parsed.safeToScale ?? fallback.safeToScale,
        needsProtection: parsed.needsProtection ?? fallback.needsProtection,
        rootCause: parsed.rootCause,
        confidenceNote: parsed.confidenceNote,
      },
      aiGenerated: true,
    };
  }
  console.warn("[pmax/diagnosis] Gemini call fell back to template diagnosis —", timedOut ? "timed out" : !result ? "no result" : "response failed schema validation, raw text:", !timedOut && result ? result.text?.slice(0, 300) : "");
  return { draft: fallback, aiGenerated: false };
}

export async function generateCampaignDiagnosis(
  overview: CampaignOverview,
  topCategories: PMaxSearchCategory[] = []
): Promise<PMaxDiagnosis> {
  const fallback = fallbackCampaignDiagnosis(overview, topCategories);
  const { scores, metrics, assetCoverage, channelMix } = overview;

  const categoriesBlock = topCategories.length
    ? topCategories.slice(0, 5).map(c => `- "${c.categoryLabel}": ${c.impressions} hiển thị, ${c.clicks} click, ${c.conversions} conversion (Google không cung cấp chi phí ở mức category)`).join("\n")
    : "chưa có dữ liệu search category";

  const prompt = `Bạn là chuyên gia Performance Max. Chẩn đoán campaign "${overview.campaignName}" dựa CHỈ trên số liệu thật dưới đây — không suy đoán ngoài dữ liệu, không bịa nguyên nhân.

Số liệu ${metrics.recentDays} ngày gần nhất vs tổng ${metrics.totalDays} ngày đã chọn:
- Spend: ${metrics.spendRecent.toLocaleString("vi-VN")}đ (${metrics.recentDays}d gần nhất) / ${metrics.spendTotal.toLocaleString("vi-VN")}đ (${metrics.totalDays}d)
- Conversions: ${metrics.conversionsRecent} (${metrics.recentDays}d gần nhất) / ${metrics.conversionsTotal} (${metrics.totalDays}d)
- Doanh thu tracking: ${metrics.revenueRecent.toLocaleString("vi-VN")}đ (${metrics.recentDays}d gần nhất) / ${metrics.revenueTotal.toLocaleString("vi-VN")}đ (${metrics.totalDays}d)
- ROAS: ${metrics.roasRecent}x (${metrics.recentDays}d gần nhất) / ${metrics.roasTotal}x (${metrics.totalDays}d)
- Impressions: ${metrics.impressionsRecent} (${metrics.recentDays}d gần nhất) / ${metrics.impressionsTotal} (${metrics.totalDays}d)
- CTR: ${metrics.ctrRecent}% (${metrics.recentDays}d gần nhất) / ${metrics.ctrTotal}% (${metrics.totalDays}d)
- Xu hướng doanh thu/ngày: ${metrics.trendLowBaseline ? "giai đoạn trước gần như chưa có doanh thu — CHƯA đủ cơ sở kết luận tăng/giảm, đừng trích dẫn % này" : `${metrics.trendPct > 0 ? "+" : ""}${metrics.trendPct}%`}

Gợi ý cách đọc Impressions/CTR để chọn rootCause (chỉ áp dụng khi doanh thu đang giảm thật, không phải trendLowBaseline):
- Impressions/ngày giảm mạnh ở giai đoạn gần đây → khả năng cao là "search_intent" (ít người tìm kiếm hơn, hoặc bị giới hạn ngân sách/bid)
- Impressions ổn định nhưng CTR giảm mạnh → khả năng cao là "creative_quality" (quảng cáo kém hấp dẫn hơn dù vẫn hiển thị đều)

Điểm số hệ thống (đã tính sẵn, không tự đổi):
- Performance Score: ${scores.performance}/100
- Expansion Readiness Score: ${scores.expansionReadiness}/100
- Confidence Score: ${scores.confidence}/100

Channel mix: ${channelMix.map(c => `${c.channel} ${c.pct.toFixed(0)}%`).join(", ") || "chưa có dữ liệu"}
Asset coverage: ${assetCoverage.headlineCount} headline, ${assetCoverage.descriptionCount} description, ${assetCoverage.imageCount} ảnh, ${assetCoverage.videoCount} video.
Vấn đề asset: ${assetCoverage.gaps.join("; ") || "không có"}

Top search category (30 ngày, toàn campaign):
${categoriesBlock}

Trả lời JSON đúng schema, tiếng Việt, không thêm text ngoài JSON:
{
  "whatsWorking": string[] (2-3 điều đang tốt, cụ thể theo số liệu trên),
  "whatsLimiting": string[] (2-3 điều đang hạn chế tăng trưởng),
  "mainContributor": string (nguồn đóng góp chính — kênh nào),
  "safeToScale": boolean | null (null nếu Confidence Score < 30 — chưa đủ dữ liệu để nói),
  "needsProtection": boolean (true nếu performance tốt nhưng chưa sẵn sàng mở rộng),
  "rootCause": một trong ${JSON.stringify(VALID_ROOT_CAUSES)},
  "confidenceNote": string (câu nói rõ mức độ tin cậy + nhắc rằng doanh thu là theo tracking quảng cáo, chưa đối soát Odoo)
}`;

  const { draft, aiGenerated } = await draftDiagnosis(prompt, fallback);

  return {
    entityType: "campaign",
    entityId: overview.campaignId,
    ...draft,
    aiGenerated,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateAssetGroupDiagnosis(
  assetGroup: AssetGroupOverview,
  campaignContext: { campaignName: string; scores: CampaignOverview["scores"] }
): Promise<PMaxDiagnosis> {
  const { assetCoverage, searchCategories } = assetGroup;
  // Xếp theo impressions — Google không lộ chi phí ở mức search-category.
  const topCategories = [...searchCategories].sort((a, b) => b.impressions - a.impressions).slice(0, 5);

  const fallback: DiagnosisDraft = {
    whatsWorking: assetCoverage.gaps.length === 0 ? ["Độ phủ asset đầy đủ theo khuyến nghị"] : ["Chưa có điểm nổi bật rõ ràng ở asset group này"],
    whatsLimiting: assetCoverage.gaps.length > 0 ? assetCoverage.gaps : ["Không có điểm hạn chế rõ ràng trong dữ liệu hiện có"],
    mainContributor: topCategories[0]?.categoryLabel ?? "Chưa xác định",
    safeToScale: null,
    needsProtection: false,
    rootCause: assetCoverage.gaps.length > 0 ? "asset_coverage" : "insufficient_data",
    confidenceNote: `Dựa trên ${searchCategories.length} search category ghi nhận ở campaign "${campaignContext.campaignName}". Chưa đối soát Odoo.`,
  };

  const prompt = `Bạn là chuyên gia Performance Max. Chẩn đoán asset group "${assetGroup.assetGroupName}" thuộc campaign "${campaignContext.campaignName}" — dựa CHỈ trên số liệu thật, không bịa nguyên nhân.

Asset coverage: ${assetCoverage.headlineCount} headline, ${assetCoverage.descriptionCount} description, ${assetCoverage.imageCount} ảnh, ${assetCoverage.videoCount} video, ${assetCoverage.notEligibleCount} asset không đủ điều kiện.
Vấn đề: ${assetCoverage.gaps.join("; ") || "không có"}

Top search category theo lượt hiển thị (Google KHÔNG cung cấp chi phí ở mức này — đừng suy ra chi phí hay ROAS cho từng category):
${topCategories.map(c => `- "${c.categoryLabel}": ${c.impressions} hiển thị, ${c.clicks} clicks, ${c.conversions} conv`).join("\n") || "Chưa có dữ liệu search category"}

Bối cảnh campaign: Performance Score ${campaignContext.scores.performance}/100, Confidence Score ${campaignContext.scores.confidence}/100.

Trả lời JSON đúng schema, tiếng Việt, không thêm text ngoài JSON:
{
  "whatsWorking": string[] (2-3 điều),
  "whatsLimiting": string[] (2-3 điều),
  "mainContributor": string (category/nguồn đóng góp chính),
  "safeToScale": boolean | null,
  "needsProtection": boolean,
  "rootCause": một trong ${JSON.stringify(VALID_ROOT_CAUSES)},
  "confidenceNote": string
}`;

  const { draft, aiGenerated } = await draftDiagnosis(prompt, fallback);

  return {
    entityType: "asset_group",
    entityId: assetGroup.assetGroupId,
    ...draft,
    aiGenerated,
    generatedAt: new Date().toISOString(),
  };
}

export { ROOT_CAUSE_LABEL };
