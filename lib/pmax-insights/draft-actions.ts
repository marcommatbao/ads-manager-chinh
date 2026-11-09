// ─────────────────────────────────────────────
// PMax Insights 2.0 — Draft Actions (Stage 2)
// Suggestion-only, per product requirement E: never auto-create assets,
// never auto-push themes to Google Ads, never modify live campaign
// settings. Output is a draft record a marketer/designer reads and acts
// on manually.
// ─────────────────────────────────────────────

import { callGemini, callWithTimeout, extractJSON } from "@/lib/gemini";
import type { PMaxSearchCategory } from "@/lib/google-pmax-client";
import type {
  CampaignOverview, AssetGroupOverview,
  DraftSearchThemesContent, DraftSearchThemeItem,
  DraftCreativeBriefContent, CreativeAssetNeed,
} from "./types";

const VALID_INTENTS = ["commercial", "informational", "brand", "unclear"] as const;
const VALID_ACTIONS = ["add", "remove_redundant", "narrow_too_broad"] as const;
const VALID_ASSET_NEEDS: CreativeAssetNeed[] = ["image_heavy", "video_heavy", "text_heavy", "balanced"];

// ── Draft Search Themes ──

function fallbackSearchThemes(categories: PMaxSearchCategory[]): DraftSearchThemeItem[] {
  const items: DraftSearchThemeItem[] = [];
  // Xếp theo impressions và lọc theo CLICK, không theo chi phí: Google không
  // lộ chi phí ở mức search-category, nên điều kiện cũ (costMicros > 100.000)
  // đọc trên một số 0 giả và KHÔNG BAO GIỜ đúng — cả nhánh này chưa từng chạy.
  const sorted = [...categories].sort((a, b) => b.impressions - a.impressions).slice(0, 8);

  for (const c of sorted) {
    if (c.conversions === 0 && c.clicks >= 10) {
      items.push({
        theme: c.categoryLabel,
        intent: "unclear",
        action: "narrow_too_broad",
        // Google không cho chi phí ở mức category nên không nói được "tốn bao
        // nhiêu tiền" — nói đúng thứ đo được: có click mà không ra chuyển đổi.
        reason: `${c.clicks} click, 0 conversion — nên thu hẹp hoặc loại khỏi target`,
      });
    } else if (c.conversions > 0) {
      items.push({
        theme: c.categoryLabel,
        intent: "commercial",
        action: "add",
        reason: `${c.conversions} conversion từ ${c.clicks} click — nên bổ sung theme liên quan để mở rộng`,
      });
    }
  }
  if (items.length === 0) {
    items.push({ theme: "(chưa đủ dữ liệu)", intent: "unclear", action: "add", reason: "Chưa có search category đủ dữ liệu để đề xuất cụ thể" });
  }
  return items;
}

export async function generateDraftSearchThemes(
  campaign: CampaignOverview,
  categories: PMaxSearchCategory[]
): Promise<DraftSearchThemesContent> {
  const fallback = fallbackSearchThemes(categories);
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey && categories.length > 0) {
    const prompt = `Bạn là chuyên gia Performance Max. Dựa trên hiệu quả search category thật của campaign "${campaign.campaignName}" dưới đây, đề xuất search theme nên thêm, nên loại (dư thừa), hoặc nên thu hẹp (quá rộng).

${categories.slice(0, 15).map(c => `- "${c.categoryLabel}": ${c.impressions} hiển thị, ${c.clicks} click, ${c.conversions} conv`).join("\n")}

LƯU Ý: Google KHÔNG cung cấp chi phí hay ROAS ở mức search category. Đừng suy ra, đừng nhắc tới hai con số đó.

Chỉ đề xuất dựa trên dữ liệu trên — không bịa category không có trong danh sách khi đề xuất loại/thu hẹp. Khi đề xuất "add", có thể gợi ý theme liên quan hợp lý theo ngành thương mại điện tử.

Trả lời JSON, tiếng Việt, không thêm text ngoài JSON:
{
  "items": [{ "theme": string, "intent": một trong ${JSON.stringify(VALID_INTENTS)}, "action": một trong ${JSON.stringify(VALID_ACTIONS)}, "reason": string }] (tối đa 8 items)
}`;

    // thinkingBudget: 0 — see lib/pmax-insights/diagnosis.ts's draftDiagnosis
    // comment; same fix, same reason.
    const { result, timedOut } = await callWithTimeout(
      () => callGemini(prompt, { temperature: 0.5, maxOutputTokens: 700, responseMimeType: "application/json", thinkingBudget: 0 }, apiKey),
      20_000
    );
    const parsed = !timedOut && result ? (extractJSON(result.text) as { items?: DraftSearchThemeItem[] } | null) : null;
    const valid = parsed?.items?.filter(
      (i) => i.theme && VALID_INTENTS.includes(i.intent) && VALID_ACTIONS.includes(i.action) && i.reason
    );
    if (valid?.length) {
      return { campaignId: campaign.campaignId, campaignName: campaign.campaignName, assetGroupId: null, items: valid };
    }
  }

  return { campaignId: campaign.campaignId, campaignName: campaign.campaignName, assetGroupId: null, items: fallback };
}

// ── Draft Creative Brief ──

function fallbackCreativeBrief(campaign: CampaignOverview, assetGroup: AssetGroupOverview | null): DraftCreativeBriefContent {
  const coverage = assetGroup?.assetCoverage ?? campaign.assetCoverage;
  const assetNeed: CreativeAssetNeed =
    coverage.videoCount === 0 ? "video_heavy" :
    coverage.imageCount < 3 ? "image_heavy" :
    coverage.headlineCount < 5 ? "text_heavy" : "balanced";

  return {
    campaignId: campaign.campaignId,
    campaignName: campaign.campaignName,
    assetGroupId: assetGroup?.assetGroupId ?? null,
    productAngle: `Sản phẩm/dịch vụ theo chủ đề campaign "${campaign.campaignName}" — cần marketer bổ sung góc độ cụ thể.`,
    uspDirection: "Chưa xác định — cần input từ đội sản phẩm/marketing.",
    messageDirection: coverage.gaps.length > 0
      ? `Ưu tiên khắc phục: ${coverage.gaps.join("; ")}`
      : "Làm mới thông điệp để tránh creative fatigue.",
    refreshReason: coverage.gaps.length > 0
      ? `Asset group đang thiếu: ${coverage.gaps.join("; ")}`
      : "Chưa có gap rõ ràng — làm mới định kỳ theo khuyến nghị chung.",
    assetNeed,
  };
}

export async function generateDraftCreativeBrief(
  campaign: CampaignOverview,
  assetGroup: AssetGroupOverview | null
): Promise<DraftCreativeBriefContent> {
  const fallback = fallbackCreativeBrief(campaign, assetGroup);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallback;

  const coverage = assetGroup?.assetCoverage ?? campaign.assetCoverage;
  const topCategories = assetGroup?.searchCategories.slice(0, 5) ?? [];

  const prompt = `Bạn là brand/creative strategist cho thương mại điện tử. Viết creative brief tiếng Việt cho campaign "${campaign.campaignName}"${assetGroup ? ` (asset group "${assetGroup.assetGroupName}")` : ""}.

Độ phủ asset hiện tại: ${coverage.headlineCount} headline, ${coverage.descriptionCount} description, ${coverage.imageCount} ảnh, ${coverage.videoCount} video.
Vấn đề: ${coverage.gaps.join("; ") || "không có gap rõ ràng"}
${topCategories.length ? `Search category liên quan: ${topCategories.map(c => c.categoryLabel).join(", ")}` : ""}

Trả lời JSON, tiếng Việt, không thêm text ngoài JSON:
{
  "productAngle": string (góc độ sản phẩm nên khai thác),
  "uspDirection": string (hướng USP),
  "messageDirection": string (hướng thông điệp),
  "refreshReason": string (vì sao cần làm mới creative lúc này),
  "assetNeed": một trong ${JSON.stringify(VALID_ASSET_NEEDS)}
}`;

  // thinkingBudget: 0 — see lib/pmax-insights/diagnosis.ts's draftDiagnosis
  // comment; same fix, same reason.
  const { result, timedOut } = await callWithTimeout(
    () => callGemini(prompt, { temperature: 0.6, maxOutputTokens: 500, responseMimeType: "application/json", thinkingBudget: 0 }, apiKey),
    20_000
  );
  const parsed = !timedOut && result ? (extractJSON(result.text) as Partial<DraftCreativeBriefContent> | null) : null;
  if (
    parsed?.productAngle && parsed.uspDirection && parsed.messageDirection && parsed.refreshReason &&
    parsed.assetNeed && VALID_ASSET_NEEDS.includes(parsed.assetNeed)
  ) {
    return {
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      assetGroupId: assetGroup?.assetGroupId ?? null,
      productAngle: parsed.productAngle,
      uspDirection: parsed.uspDirection,
      messageDirection: parsed.messageDirection,
      refreshReason: parsed.refreshReason,
      assetNeed: parsed.assetNeed,
    };
  }
  return fallback;
}
