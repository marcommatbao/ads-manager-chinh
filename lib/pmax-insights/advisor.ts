// ─────────────────────────────────────────────
// PMax Insights 2.0 — AI PMax Advisor (Stage 2)
// Recommendation TYPE and PRIORITY are chosen deterministically from the
// same real scores/coverage scoring.ts already computes — same principle
// as the rest of this module: an admin can always trace why a campaign
// got a given recommendation. Gemini drafts only the title/reason/
// evidence/expectedImpact/guardrail TEXT, grounded in those same numbers,
// and is never allowed to invent a numeric lift estimate (safety rule —
// "Do not claim incremental lift if it is not supported").
// ─────────────────────────────────────────────

import { callGemini, callWithTimeout, extractJSON } from "@/lib/gemini";
import { computeBudgetProposal } from "./budget-rule";
import type {
  CampaignOverview, RecommendationType, RecommendationPriority, PMaxRecommendation,
} from "./types";

interface TypeDecision {
  type: RecommendationType;
  priority: RecommendationPriority;
}

function decideType(campaign: CampaignOverview): TypeDecision {
  const { scores, recommendationStatus, metrics, assetCoverage } = campaign;

  if (scores.confidence < 30) {
    return { type: "hold_monitor", priority: "watch" };
  }
  if (recommendationStatus === "expand") {
    return { type: "scale_carefully", priority: scores.confidence >= 70 ? "now" : "test" };
  }
  if (recommendationStatus === "protect") {
    return { type: "protect_efficiency", priority: "watch" };
  }
  if (recommendationStatus === "review") {
    return { type: "hold_monitor", priority: !metrics.trendLowBaseline && metrics.trendPct < -20 ? "now" : "watch" };
  }
  // "test"
  if (assetCoverage.gaps.length > 0) {
    return { type: "refresh_creative", priority: "test" };
  }
  return { type: "refine_search_themes", priority: "test" };
}

interface DraftedText {
  title: string;
  reason: string;
  evidence: string[];
  expectedImpact: string;
  guardrail: string;
}

function fallbackText(
  campaign: CampaignOverview,
  decision: TypeDecision,
  budgetProposal?: { currentVnd: number; proposedVnd: number; deltaPct: number; basis: string[] } | null,
): DraftedText {
  const { metrics, scores, assetCoverage } = campaign;
  const trendEvidence = metrics.trendLowBaseline
    ? "Giai đoạn trước gần như chưa có doanh thu — chưa đủ cơ sở so trend"
    : `xu hướng doanh thu/ngày ${metrics.trendPct > 0 ? "+" : ""}${metrics.trendPct}%`;
  const evidence = [
    `Performance Score ${scores.performance}/100, Expansion Readiness ${scores.expansionReadiness}/100, Confidence ${scores.confidence}/100`,
    `ROAS ${metrics.totalDays} ngày ${metrics.roasTotal}x, ${trendEvidence}`,
  ];
  if (budgetProposal) {
    evidence.push(
      `Đề xuất ngân sách: ₫${budgetProposal.currentVnd.toLocaleString("vi-VN")}/ngày → ₫${budgetProposal.proposedVnd.toLocaleString("vi-VN")}/ngày (+${budgetProposal.deltaPct}%)`,
      ...budgetProposal.basis,
    );
  }
  if (assetCoverage.gaps.length > 0) evidence.push(...assetCoverage.gaps);

  const TITLE_BY_TYPE: Record<RecommendationType, string> = {
    scale_carefully: `Cân nhắc mở rộng ngân sách cho "${campaign.campaignName}"`,
    refine_search_themes: `Tinh chỉnh search theme cho "${campaign.campaignName}"`,
    refresh_creative: `Làm mới creative cho "${campaign.campaignName}"`,
    protect_efficiency: `Giữ hiệu quả trước khi mở rộng "${campaign.campaignName}"`,
    hold_monitor: `Theo dõi thêm "${campaign.campaignName}"`,
  };
  const IMPACT_BY_TYPE: Record<RecommendationType, string> = {
    scale_carefully: "Có thể tăng doanh thu nếu hiệu quả được duy trì khi mở rộng ngân sách",
    refine_search_themes: "Có thể giảm chi phí lãng phí vào search category kém hiệu quả",
    refresh_creative: "Có thể cải thiện độ phủ và khả năng hiển thị của campaign",
    protect_efficiency: "Giữ nguyên hiệu quả hiện tại, tránh rủi ro giảm ROAS khi mở rộng sớm",
    hold_monitor: "Chưa đủ cơ sở để ước tính tác động — cần thêm dữ liệu",
  };
  const GUARDRAIL_BY_TYPE: Record<RecommendationType, string> = {
    scale_carefully: "Dừng tăng ngân sách nếu ROAS giảm rõ rệt trong 7 ngày sau khi mở rộng",
    refine_search_themes: "Theo dõi conversion 7-14 ngày sau khi điều chỉnh trước khi thay đổi tiếp",
    refresh_creative: "So sánh hiệu quả creative mới với creative cũ trước khi thay hoàn toàn",
    protect_efficiency: "Chỉ mở rộng khi Expansion Readiness Score vượt 65/100",
    hold_monitor: "Xem lại khi có thêm dữ liệu conversion",
  };

  return {
    title: TITLE_BY_TYPE[decision.type],
    reason: `Điểm số hệ thống + dữ liệu ${campaign.metrics.totalDays} ngày cho thấy trạng thái "${decision.type}" — xem bằng chứng chi tiết bên dưới.`,
    evidence,
    expectedImpact: IMPACT_BY_TYPE[decision.type],
    guardrail: GUARDRAIL_BY_TYPE[decision.type],
  };
}

async function draftRecommendationText(
  campaign: CampaignOverview,
  decision: TypeDecision,
  budgetProposal?: { currentVnd: number; proposedVnd: number; deltaPct: number; basis: string[] } | null,
): Promise<{ text: DraftedText; aiGenerated: boolean }> {
  const fallback = fallbackText(campaign, decision, budgetProposal);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { text: fallback, aiGenerated: false };

  const { metrics, scores, assetCoverage, channelMix } = campaign;
  const prompt = `Bạn là chuyên gia Performance Max. Viết nội dung 1 recommendation card cho campaign "${campaign.campaignName}", loại hành động đã xác định trước: "${decision.type}".

Số liệu thật (KHÔNG được bịa thêm số khác):
- Performance Score ${scores.performance}/100, Expansion Readiness ${scores.expansionReadiness}/100, Confidence ${scores.confidence}/100
- ROAS ${metrics.totalDays} ngày ${metrics.roasTotal}x, doanh thu tracking ${metrics.totalDays} ngày ${metrics.revenueTotal.toLocaleString("vi-VN")}đ${metrics.trendLowBaseline ? ", xu hướng: giai đoạn trước gần như chưa có doanh thu nên CHƯA đủ cơ sở kết luận tăng/giảm" : `, xu hướng ${metrics.trendPct > 0 ? "+" : ""}${metrics.trendPct}%`}
- Channel chính: ${channelMix[0]?.channel ?? "chưa rõ"} (${channelMix[0]?.pct.toFixed(0) ?? 0}%)
- Vấn đề asset: ${assetCoverage.gaps.join("; ") || "không có"}${budgetProposal ? `
- Mức ngân sách hệ thống đã tính sẵn: ₫${budgetProposal.currentVnd.toLocaleString("vi-VN")}/ngày → ₫${budgetProposal.proposedVnd.toLocaleString("vi-VN")}/ngày (+${budgetProposal.deltaPct}%). Căn cứ: ${budgetProposal.basis.join("; ")}` : ""}

QUAN TRỌNG: KHÔNG được ước tính % tăng trưởng cụ thể (vd "+15% doanh thu") — chỉ mô tả định tính vì không có cơ sở dự đoán chính xác.${budgetProposal ? `
Được phép NHẮC LẠI nguyên văn mức ngân sách đã tính ở trên, nhưng TUYỆT ĐỐI không tự đưa ra một con số ngân sách khác.` : ""}

Trả lời JSON đúng schema, tiếng Việt, không thêm text ngoài JSON:
{
  "title": string (ngắn gọn, hành động cụ thể),
  "reason": string (1-2 câu, vì sao hệ thống gợi ý điều này),
  "evidence": string[] (2-3 bằng chứng cụ thể từ số liệu trên),
  "expectedImpact": string (định tính, KHÔNG số liệu cụ thể),
  "guardrail": string (điều kiện cần theo dõi/dừng lại)
}`;

  // thinkingBudget: 0 — see the matching comment in diagnosis.ts's
  // draftDiagnosis; same class of bug, same fix, confirmed live 2026-07-31.
  const { result, timedOut } = await callWithTimeout(
    () => callGemini(prompt, { temperature: 0.4, maxOutputTokens: 500, responseMimeType: "application/json", thinkingBudget: 0 }, apiKey),
    20_000
  );

  const parsed = !timedOut && result ? (extractJSON(result.text) as Partial<DraftedText> | null) : null;
  if (parsed?.title && parsed.reason && parsed.evidence?.length && parsed.expectedImpact && parsed.guardrail) {
    return {
      text: {
        title: parsed.title, reason: parsed.reason, evidence: parsed.evidence,
        expectedImpact: parsed.expectedImpact, guardrail: parsed.guardrail,
      },
      aiGenerated: true,
    };
  }
  console.warn("[pmax/advisor] Gemini call fell back to template recommendation —", timedOut ? "timed out" : !result ? "no result" : "response failed schema validation");
  return { text: fallback, aiGenerated: false };
}

export async function generateRecommendation(
  campaign: CampaignOverview,
  company: string
): Promise<Omit<PMaxRecommendation, "id" | "reviewState" | "createdAt" | "reviewedAt" | "reviewedBy">> {
  const decision = decideType(campaign);

  // Con số ngân sách do LUẬT tính, TRƯỚC khi gọi AI — để prompt được nhắc lại
  // đúng con số đó thay vì tự nghĩ ra một số khác. Chỉ tính cho loại đề xuất
  // tăng ngân sách; các loại khác không có gì để áp dụng ở mini-spec này.
  const budget = decision.type === "scale_carefully"
    ? computeBudgetProposal({
        recommendationStatus: campaign.recommendationStatus,
        confidence: campaign.scores.confidence,
        roasTotal: campaign.metrics.roasTotal,
        avgRoasTotal: campaign.accountAvgRoas,
        trendPct: campaign.metrics.trendPct,
        trendLowBaseline: campaign.metrics.trendLowBaseline,
        dailyBudgetVnd: campaign.metrics.dailyBudgetVnd,
        totalDays: campaign.metrics.totalDays,
      })
    : { eligible: false, proposal: null, reason: null };

  const { text } = await draftRecommendationText(campaign, decision, budget.proposal);

  return {
    dataFingerprint: fingerprintCampaign(campaign),
    draftedAt: new Date().toISOString(),
    budgetProposal: budget.proposal,
    budgetBlockedReason: budget.eligible ? null : budget.reason,
    company,
    campaignId: campaign.campaignId,
    campaignName: campaign.campaignName,
    assetGroupId: null,
    searchCategoryLabel: null,
    type: decision.type,
    priority: decision.priority,
    title: text.title,
    reason: text.reason,
    evidence: text.evidence,
    confidencePct: campaign.scores.confidence,
    expectedImpact: text.expectedImpact,
    guardrail: text.guardrail,
  };
}

/** Vân tay của những con số thực sự quyết định nội dung thẻ. Làm tròn để một
 *  thay đổi li ti (ROAS 5.521 → 5.523) không kích hoạt soạn lại. */
export function fingerprintCampaign(c: CampaignOverview): string {
  return [
    c.campaignId,
    c.recommendationStatus,
    c.scores.performance, c.scores.expansionReadiness, c.scores.confidence,
    Math.round(c.metrics.roasTotal * 10),
    Math.round(c.metrics.trendPct),
    c.metrics.dailyBudgetVnd ?? "null",
    c.metrics.totalDays,
    c.assetCoverage.dataUnavailable ? "assetNA" : c.assetCoverage.gaps.length,
  ].join("|");
}

/** Quá hạn này thì soạn lại dù số liệu chưa đổi — để câu chữ không cũ mãi. */
const DRAFT_TTL_HOURS = 24;

export function needsRedraft(
  existing: { dataFingerprint?: string; draftedAt?: string } | undefined,
  fingerprint: string,
): boolean {
  if (!existing?.dataFingerprint || !existing.draftedAt) return true;
  if (existing.dataFingerprint !== fingerprint) return true;
  const age = (Date.now() - Date.parse(existing.draftedAt)) / 3_600_000;
  return !Number.isFinite(age) || age >= DRAFT_TTL_HOURS;
}

export async function generateRecommendationsForCampaigns(
  campaigns: CampaignOverview[],
  company: string
): Promise<Omit<PMaxRecommendation, "id" | "reviewState" | "createdAt" | "reviewedAt" | "reviewedBy">[]> {
  return Promise.all(campaigns.map((c) => generateRecommendation(c, company)));
}
