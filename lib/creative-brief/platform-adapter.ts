// ============================================================
// Creative Brief — Platform Adapter
// Derives Meta-specific and Google-specific creative guidance.
// ============================================================

import type {
  AudienceSummary, BriefFunnelStage, BriefObjective,
  GoogleConfig, MetaConfig, ToneStrategy,
} from "./types";
import type { ResolvedProduct } from "./product-resolver";

// ── Meta (Facebook) ──────────────────────────────────────────

type MetaObjectiveAnchor = {
  awareness: string; consideration: string; conversion: string; retention: string;
};

const EMOTIONAL_ANCHORS: MetaObjectiveAnchor = {
  awareness:     "tò mò và nhận ra vấn đề",
  consideration: "kỳ vọng và so sánh",
  conversion:    "quyết tâm và sợ bỏ lỡ",
  retention:     "tự hào và loyalty",
};

const AD_FORMATS: Record<BriefFunnelStage, string[]> = {
  top:    ["video_short", "single_image"],
  mid:    ["carousel", "single_image"],
  bottom: ["single_image", "collection"],
};

function buildHookFrame(
  audience: AudienceSummary,
  tone: ToneStrategy,
  funnelStage: BriefFunnelStage,
): string {
  const topPain = audience.topPainPoints[0] ?? "vấn đề kinh doanh";
  if (funnelStage === "top") {
    return `Mở bằng câu hỏi gợi tự nhận ra vấn đề: "${topPain}?". Không bán trong 3 giây đầu — chỉ gương mặt của vấn đề.`;
  }
  if (funnelStage === "mid") {
    return `Dẫn bằng trạng thái sau khi giải quyết "${topPain}". Tone ${tone.primaryTone} — show contrast trước/sau.`;
  }
  return `Bắt đầu bằng bằng chứng ngay: số liệu hoặc tên khách hàng. Sau đó CTA trực tiếp. Không warm-up cho BOFU.`;
}

function buildVisualDirection(
  audience: AudienceSummary,
  funnelStage: BriefFunnelStage,
): string {
  const dirs: Record<BriefFunnelStage, string> = {
    top: `Hình ảnh thực tế người dùng trong ngữ cảnh ${audience.primaryPersona}. Tránh stock photo quá hoàn hảo — cần relatable.`,
    mid: `Dashboard/sản phẩm thực tế + overlay chỉ số. Hoặc testimonial visual (quote card, before/after). Clean design.`,
    bottom: `Offer visual rõ ràng: giá, thời hạn, logo trust. Màu contrast cao. CTA nổi bật. Tối giản — không distract.`,
  };
  return dirs[funnelStage];
}

export function adaptForMeta(
  product: ResolvedProduct,
  audience: AudienceSummary,
  tone: ToneStrategy,
  funnelStage: BriefFunnelStage,
  objective: BriefObjective,
): MetaConfig {
  return {
    adFormats:       AD_FORMATS[funnelStage],
    hookFrame:       buildHookFrame(audience, tone, funnelStage),
    emotionalAnchor: EMOTIONAL_ANCHORS[objective],
    textLengthGuidance: {
      headline:    "≤40 ký tự — 1 benefit hoặc 1 câu hỏi",
      primary:     funnelStage === "top" ? "125–250 ký tự — storytelling, không list" : "≤125 ký tự — ngắn gọn, benefit-first",
      description: "≤30 ký tự — reinforce CTA hoặc proof",
    },
    visualDirection: buildVisualDirection(audience, funnelStage),
  };
}

// ── Google ───────────────────────────────────────────────────

function buildHeadlineAngles(
  product: ResolvedProduct,
  funnelStage: BriefFunnelStage,
): string[] {
  const topUsp   = product.usps[0] ?? product.displayName;
  const topPain  = product.painPoints[0]?.text ?? "vấn đề kinh doanh";
  const topOffer = product.proofPoints.find(p => p.type === "stat")?.text ?? "Dùng thử miễn phí";

  const angles: Record<BriefFunnelStage, string[]> = {
    top:    [`Bạn đã có ${product.displayName}?`, `${product.displayName} — Tìm hiểu ngay`, topUsp],
    mid:    [topUsp, `Giải quyết ${topPain.slice(0, 30)}`, `So sánh gói ${product.displayName}`],
    bottom: [topOffer, `${product.displayName} — Đăng ký ngay`, `${topUsp} — Ưu đãi hôm nay`],
  };
  return angles[funnelStage];
}

function buildDescriptionFocus(
  product: ResolvedProduct,
  audience: AudienceSummary,
  funnelStage: BriefFunnelStage,
): string {
  if (funnelStage === "top") {
    return `Giải thích ngắn gọn ${product.displayName} giải quyết gì cho ${audience.primaryPersona}. Không gọi mua — gọi tìm hiểu.`;
  }
  if (funnelStage === "mid") {
    return `Nêu 2 lợi ích cụ thể (${product.usps.slice(0, 2).join(", ")}). Kết bằng so sánh hoặc câu hỏi dẫn vào trang.`;
  }
  return `${product.usps[0] ?? "Giải pháp tốt nhất"}. ${product.proofPoints[0]?.text ?? "Hỗ trợ 24/7"}. CTA rõ ràng cuối mô tả.`;
}

export function adaptForGoogle(
  product: ResolvedProduct,
  audience: AudienceSummary,
  tone: ToneStrategy,
  funnelStage: BriefFunnelStage,
  objective: BriefObjective,
): GoogleConfig {
  // Base search intents from product catalog
  const baseIntents = product.searchIntents.slice(0, 4);

  // Add funnel-stage qualified intents
  const stageIntents: Record<BriefFunnelStage, string[]> = {
    top:    [`${product.displayName} là gì`, `tại sao cần ${product.displayName}`],
    mid:    [`so sánh ${product.displayName}`, `${product.displayName} giá bao nhiêu`],
    bottom: [`mua ${product.displayName}`, `đăng ký ${product.displayName} ngay`],
  };

  const searchIntents = [...new Set([...baseIntents, ...stageIntents[funnelStage]])].slice(0, 6);

  const extensionSuggestions = [
    {
      type: "Sitelink",
      examples: product.usps.slice(0, 3).map(u => u.slice(0, 25)),
    },
    {
      type: "Callout",
      examples: ["Hỗ trợ 24/7", "Không phí ẩn", "Hoàn tiền 30 ngày"],
    },
    {
      type: "Structured Snippet",
      examples: [`Dịch vụ: ${product.displayName}`, `Thương hiệu: Mat Bao`],
    },
  ];

  return {
    searchIntents,
    headlineAngles:   buildHeadlineAngles(product, funnelStage),
    descriptionFocus: buildDescriptionFocus(product, audience, funnelStage),
    extensionSuggestions,
    keywordDensityNote: `Xuất hiện "${product.displayName.toLowerCase()}" trong Headline 1 và mô tả đầu tiên. Tránh keyword stuffing — 1–2 lần là đủ.`,
  };
}
