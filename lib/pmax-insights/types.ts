// ─────────────────────────────────────────────
// PMax Insights 2.0 — shared types
// Scope note: "revenue" throughout this module is Google Ads' own tracked
// conversion value (real advertiser-side tracking), NOT reconciled Odoo
// revenue — PMax has no per-campaign Odoo attribution today (see
// lib/finance/company-pnl.ts, company-level only). Every UI surface that
// shows it must label it as tracking-based, not ERP-reconciled.
// ─────────────────────────────────────────────

export type RecommendationStatus = "expand" | "test" | "protect" | "review";

export const RECOMMENDATION_STATUS_LABEL: Record<RecommendationStatus, string> = {
  expand: "Có thể mở rộng",
  test: "Nên test",
  protect: "Giữ hiệu quả",
  review: "Cần xem lại",
};

export type PMaxRootCause = "search_intent" | "asset_coverage" | "creative_quality" | "structure" | "insufficient_data";

export const ROOT_CAUSE_LABEL: Record<PMaxRootCause, string> = {
  search_intent: "Search intent",
  asset_coverage: "Độ phủ Asset",
  creative_quality: "Chất lượng creative",
  structure: "Cấu trúc campaign/asset group",
  insufficient_data: "Chưa đủ dữ liệu",
};

// ── Asset coverage (from real primaryStatus + fieldType — no fake performanceLabel) ──

export interface AssetCoverage {
  /** true = KHÔNG đọc được dữ liệu asset. Khi đó `gaps` phải rỗng: không có
   *  dữ liệu thì không được kết luận "thiếu video/thiếu ảnh". */
  dataUnavailable?: boolean;
  headlineCount: number;
  descriptionCount: number;
  imageCount: number;
  videoCount: number;
  logoCount: number;
  notEligibleCount: number; // primaryStatus === NOT_ELIGIBLE | LIMITED
  gaps: string[]; // e.g. ["Thiếu video", "Chỉ có 2 headline (khuyến nghị ≥5)"]
}

// ── Campaign-level overview (Tổng quan tab) ──

export interface CampaignOverviewMetrics {
  totalDays: number; recentDays: number; // days in the selected range, and in its more-recent half
  spendRecent: number; spendTotal: number;
  conversionsRecent: number; conversionsTotal: number;
  revenueRecent: number; revenueTotal: number;
  clicksRecent: number; clicksTotal: number;
  impressionsRecent: number; impressionsTotal: number;
  ctrRecent: number; ctrTotal: number; // % — used to tell "fewer people seeing the ad" (search_intent) apart from "same reach, fewer clicks" (creative_quality)
  roasRecent: number; roasTotal: number;
  trendPct: number; // % change in revenue/day-rate — recent half's run-rate vs the prior (non-overlapping) half's run-rate, clamped to ±300
  trendLowBaseline: boolean; // true when the prior period's run-rate is too small (<5% of recent) for trendPct to mean much — show as "mới có dữ liệu", not a precise percentage
  /** Ngân sách ngày hiện tại (VND). null = không đọc được, KHÔNG phải 0đ. */
  dailyBudgetVnd: number | null;
}

export interface CampaignScores {
  performance: number; // 0-100
  expansionReadiness: number; // 0-100
  confidence: number; // 0-100
}

export interface CampaignOverview {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  metrics: CampaignOverviewMetrics;
  channelMix: { channel: string; costMicros: number; impressions: number; pct: number }[];
  assetCoverage: AssetCoverage;
  scores: CampaignScores;
  /** ROAS trung bình toàn tài khoản cùng kỳ — mốc mà điểm hiệu quả được chấm
   *  dựa vào, và cũng là mốc luật ngân sách dùng. Đưa ra ngoài để tra ngược
   *  được vì sao ra bậc tăng đó. */
  accountAvgRoas: number;
  recommendationStatus: RecommendationStatus;
  aiSummaryLine: string | null; // short one-liner, populated on demand (Gemini)
}

// ── Drill-down: Asset Group ──

export interface AssetGroupOverview {
  assetGroupId: string;
  assetGroupName: string;
  campaignId: string;
  campaignName: string;
  assetCoverage: AssetCoverage;
  searchCategories: import("@/lib/google-pmax-client").PMaxSearchCategory[];
}

// ── AI Diagnosis (campaign or asset group level) ──

export interface PMaxDiagnosis {
  entityType: "campaign" | "asset_group";
  entityId: string;
  whatsWorking: string[];
  whatsLimiting: string[];
  mainContributor: string;
  safeToScale: boolean | null; // null = not enough signal to say
  needsProtection: boolean;
  rootCause: PMaxRootCause;
  confidenceNote: string; // explicit statement of data limitations
  aiGenerated: boolean; // false = deterministic fallback (Gemini unavailable)
  generatedAt: string;
}

// ── Stage 2: AI Advisor recommendations ──

export type RecommendationType =
  | "scale_carefully"
  | "refine_search_themes"
  | "refresh_creative"
  | "protect_efficiency"
  | "hold_monitor";

export const RECOMMENDATION_TYPE_LABEL: Record<RecommendationType, string> = {
  scale_carefully: "Mở rộng thận trọng",
  refine_search_themes: "Tinh chỉnh Search Theme",
  refresh_creative: "Làm mới Creative",
  protect_efficiency: "Bảo toàn hiệu quả",
  hold_monitor: "Theo dõi thêm",
};

export type RecommendationPriority = "now" | "test" | "watch";

export const RECOMMENDATION_PRIORITY_LABEL: Record<RecommendationPriority, string> = {
  now: "Làm ngay",
  test: "Nên test",
  watch: "Theo dõi thêm",
};

export type RecommendationReviewState = "unread" | "reviewed" | "drafted" | "dismissed" | "watching" | "applied";

export const REVIEW_STATE_LABEL: Record<RecommendationReviewState, string> = {
  unread: "Chưa xem",
  reviewed: "Đã xem",
  drafted: "Đã tạo nháp",
  dismissed: "Bỏ qua",
  watching: "Theo dõi thêm",
  applied: "Đã áp dụng",
};

export interface PMaxRecommendation {
  id: string;
  company: string;
  campaignId: string;
  campaignName: string;
  assetGroupId: string | null;
  searchCategoryLabel: string | null;
  type: RecommendationType;
  priority: RecommendationPriority;
  title: string;
  reason: string;
  evidence: string[];
  confidencePct: number; // 0-100
  expectedImpact: string;
  guardrail: string;
  reviewState: RecommendationReviewState;
  /** Mức ngân sách do LUẬT tính (lib/pmax-insights/budget-rule.ts), không phải
   *  AI sinh. Chỉ có ở đề xuất loại tăng ngân sách và khi đủ điều kiện. */
  budgetProposal?: {
    currentVnd: number;
    proposedVnd: number;
    deltaPct: number;
    basis: string[];
  } | null;
  /** Vì sao KHÔNG đề xuất được con số — để UI nói lý do thay vì nút bấm không được. */
  budgetBlockedReason?: string | null;
  /** Vân tay của số liệu đã sinh ra thẻ này. Số liệu không đổi thì không cần
   *  hỏi lại Gemini — mở tab 10 lần không được tốn 10 lượt gọi. */
  dataFingerprint?: string;
  /** Lúc phần chữ được AI soạn (khác createdAt: thẻ giữ nguyên id qua nhiều
   *  lượt cập nhật). Dùng cho TTL làm mới. */
  draftedAt?: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

// ── Stage 2: Draft actions ──

export type DraftActionType = "search_themes" | "creative_brief";

export interface DraftSearchThemeItem {
  theme: string;
  intent: "commercial" | "informational" | "brand" | "unclear";
  action: "add" | "remove_redundant" | "narrow_too_broad";
  reason: string;
}

export interface DraftSearchThemesContent {
  campaignId: string;
  campaignName: string;
  assetGroupId: string | null;
  items: DraftSearchThemeItem[];
}

export type CreativeAssetNeed = "image_heavy" | "video_heavy" | "text_heavy" | "balanced";

export interface DraftCreativeBriefContent {
  campaignId: string;
  campaignName: string;
  assetGroupId: string | null;
  productAngle: string;
  uspDirection: string;
  messageDirection: string;
  refreshReason: string;
  assetNeed: CreativeAssetNeed;
}

export interface PMaxDraftAction {
  id: string;
  company: string;
  recommendationId: string | null; // originating recommendation, if any
  type: DraftActionType;
  content: DraftSearchThemesContent | DraftCreativeBriefContent;
  createdAt: string;
  createdBy: string; // "system:ai-advisor" or admin email
}
