// ============================================================
// Creative Brief — CTA Engine
// Grid: funnelStage × objective × platform → CtaStrategy
// ============================================================

import type { BriefFunnelStage, BriefObjective, BriefPlatform, CtaStrategy } from "./types";

interface CtaEntry {
  primaryCta: string;
  softCta?:   string;
  intent:     string;
}

// Main CTA grid
const CTA_GRID: Record<BriefFunnelStage, Record<BriefObjective, Record<BriefPlatform, CtaEntry>>> = {
  top: {
    awareness: {
      facebook: { primaryCta: "Tìm hiểu thêm",    softCta: "Xem ngay",        intent: "Gợi tò mò, không tạo áp lực — khách mới chưa sẵn sàng mua" },
      google:   { primaryCta: "Khám phá ngay",     softCta: "Tìm hiểu thêm",  intent: "Search intent thấp — dẫn về blog/landing giáo dục" },
      both:     { primaryCta: "Tìm hiểu thêm",     softCta: "Xem ngay",        intent: "Awareness stage — TOFU content, không conversion CTA" },
    },
    consideration: {
      facebook: { primaryCta: "Xem chi tiết",      softCta: "Tìm hiểu thêm",  intent: "Khách biết vấn đề, đang so sánh giải pháp" },
      google:   { primaryCta: "So sánh gói",        softCta: "Xem giá",         intent: "Search intent trung bình — dẫn về pricing/comparison page" },
      both:     { primaryCta: "Xem chi tiết",       softCta: "So sánh gói",     intent: "Mid-funnel — giáo dục + differentiator" },
    },
    conversion: {
      facebook: { primaryCta: "Tìm hiểu thêm",     intent: "Retarget TOFU với conversion offer — nhưng TOFU audience chưa warm, soft CTA" },
      google:   { primaryCta: "Xem ngay",           intent: "TOFU + conversion intent mâu thuẫn — dẫn về landing page thay vì form" },
      both:     { primaryCta: "Xem ngay",           intent: "Giảm ma sát cho TOFU với conversion objective — dẫn về landing" },
    },
    retention: {
      facebook: { primaryCta: "Khám phá thêm",      intent: "Retention trên TOFU vô lý — cần move sang mid/bottom" },
      google:   { primaryCta: "Xem ưu đãi",         intent: "Retention search intent = branded query" },
      both:     { primaryCta: "Xem ưu đãi",         intent: "Retention TOFU không phổ biến — broad awareness về upgrade" },
    },
  },
  mid: {
    awareness: {
      facebook: { primaryCta: "Tìm hiểu thêm",     softCta: "Xem ngay",        intent: "Warm audience gặp brand lần 2-3 — bắt đầu build preference" },
      google:   { primaryCta: "Tìm hiểu thêm",     intent: "MOFU + awareness = remarketing search" },
      both:     { primaryCta: "Tìm hiểu thêm",     intent: "Warm audience — build consideration" },
    },
    consideration: {
      facebook: { primaryCta: "Xem gói phù hợp",   softCta: "Nhận tư vấn",     intent: "Khách đang so sánh — giúp họ tự chọn đúng gói" },
      google:   { primaryCta: "So sánh chi tiết",   softCta: "Xem giá",         intent: "Intent trung bình — comparison search terms" },
      both:     { primaryCta: "Xem gói phù hợp",   softCta: "So sánh chi tiết", intent: "MOFU consideration — so sánh và chọn" },
    },
    conversion: {
      facebook: { primaryCta: "Đăng ký dùng thử",  softCta: "Xem ưu đãi",      intent: "Warm audience đã biết brand — soft conversion với trial/demo" },
      google:   { primaryCta: "Dùng thử miễn phí", softCta: "Xem giá",          intent: "Search intent cao — trial/free tier giảm rào cản" },
      both:     { primaryCta: "Dùng thử miễn phí", softCta: "Xem ưu đãi",       intent: "MOFU conversion = trial, không phải mua ngay" },
    },
    retention: {
      facebook: { primaryCta: "Nâng cấp ngay",      softCta: "Xem quyền lợi",   intent: "Khách cũ biết brand — upgrade journey, tôn trọng loyalty" },
      google:   { primaryCta: "Xem ưu đãi thành viên", intent: "Branded query từ khách cũ — specific upgrade page" },
      both:     { primaryCta: "Nâng cấp ngay",      softCta: "Xem quyền lợi",   intent: "Retention MOFU — upgrade path rõ ràng" },
    },
  },
  bottom: {
    awareness: {
      facebook: { primaryCta: "Đăng ký ngay",       intent: "BOFU audience với awareness objective không hiệu quả — thực ra là conversion" },
      google:   { primaryCta: "Đăng ký ngay",       intent: "Bottom funnel search — direct conversion intent" },
      both:     { primaryCta: "Đăng ký ngay",       intent: "BOFU = conversion CTA bất kể objective label" },
    },
    consideration: {
      facebook: { primaryCta: "Nhận ưu đãi hôm nay", softCta: "Tư vấn miễn phí", intent: "Khách đang cân nhắc cuối cùng — push nhẹ với offer" },
      google:   { primaryCta: "Xem giá ngay",         softCta: "Liên hệ ngay",     intent: "High intent search — pricing page + contact" },
      both:     { primaryCta: "Nhận ưu đãi hôm nay",  softCta: "Tư vấn miễn phí", intent: "BOFU consideration = last-mile nudge" },
    },
    conversion: {
      facebook: { primaryCta: "Đăng ký ngay",        softCta: "Mua ngay",         intent: "Hot lead — friction thấp nhất, CTA trực tiếp" },
      google:   { primaryCta: "Mua ngay",             softCta: "Đăng ký ngay",     intent: "Purchase intent search — transaction page" },
      both:     { primaryCta: "Đăng ký ngay",         softCta: "Mua ngay",         intent: "BOFU conversion — direct action, no soft-sell" },
    },
    retention: {
      facebook: { primaryCta: "Gia hạn ngay",         softCta: "Xem ưu đãi gia hạn", intent: "Sắp hết hạn — urgency thật, không ảo" },
      google:   { primaryCta: "Gia hạn tài khoản",    softCta: "Xem ưu đãi",          intent: "Branded renewal search — account page" },
      both:     { primaryCta: "Gia hạn ngay",          softCta: "Xem ưu đãi gia hạn", intent: "Retention BOFU = renewal urgency" },
    },
  },
};

function determineUrgencyFrame(
  funnelStage: BriefFunnelStage,
  hasPromo: boolean,
  promoEndsAt?: string,
  overrideCta?: string,
): "none" | "soft" | "hard" {
  if (overrideCta) {
    // If operator pre-set CTA, infer urgency from language
    if (/ngay|hôm nay|cuối|còn lại/i.test(overrideCta)) return "soft";
    return "none";
  }
  if (!hasPromo) {
    return funnelStage === "bottom" ? "soft" : "none";
  }
  if (promoEndsAt) {
    const hoursLeft = (new Date(promoEndsAt).getTime() - Date.now()) / 3_600_000;
    if (hoursLeft <= 48) return "hard";
  }
  return "soft";
}

export function deriveCta(
  funnelStage: BriefFunnelStage,
  objective: BriefObjective,
  platform: BriefPlatform,
  promoContext?: { endsAt?: string },
  overrideCta?: string,
): CtaStrategy {
  const entry = CTA_GRID[funnelStage][objective][platform];
  const hasPromo = !!promoContext;
  const urgencyFrame = determineUrgencyFrame(funnelStage, hasPromo, promoContext?.endsAt, overrideCta);

  return {
    primaryCta:   overrideCta ?? entry.primaryCta,
    softCta:      entry.softCta,
    urgencyFrame,
    intent:       entry.intent,
  };
}
