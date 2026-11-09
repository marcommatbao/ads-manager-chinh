// ─────────────────────────────────────────────
// Policy Radar — Types
// ─────────────────────────────────────────────

export type PolicyPlatform = "google_ads" | "meta";

export type PolicyCategory =
  | "policy"
  | "enforcement"
  | "terms"
  | "product_update"
  | "measurement"
  | "targeting"
  | "creative"
  | "automation"
  | "account_health";

export type PolicyChangeType =
  | "new_policy"
  | "policy_update"
  | "clarification"
  | "announcement"
  | "terms_update"
  | "enforcement_change";

export type PolicySeverity = "low" | "medium" | "high";

export type PolicyAffectedArea =
  | "ad_copy"
  | "landing_page"
  | "tracking_measurement"
  | "creative_ai"
  | "automation_rules"
  | "account_health"
  | "targeting"
  | "reporting"
  | "brand_identity"
  | "legal_review";

export type PolicySourceType =
  | "official_policy"
  | "official_help"
  | "official_announcement"
  | "supplementary_news";

export type PolicyReviewStatus = "unread" | "reviewed" | "archived" | "flagged_for_followup";

export interface PolicyRadarItem {
  id: string;
  platform: PolicyPlatform;
  category: PolicyCategory;
  changeType: PolicyChangeType;
  title: string;
  sourceUrl: string;
  sourceLabel: string;
  sourceType: PolicySourceType;
  /** Source URL is on the platform's own official domain. */
  official: boolean;
  /**
   * false when the specifics below (summary/dates) could not be confirmed by
   * directly reading the official source — e.g. a JS-rendered help page that
   * fetches empty. The item still links the real official URL for manual
   * verification; it is never fabricated to look confirmed.
   */
  verifiedFromSource: boolean;
  /** ISO date the change took/takes effect, if known. Null when unconfirmed. */
  publishedAt: string | null;
  /** ISO datetime this item was added to Policy Radar. */
  discoveredAt: string;
  summaryShort: string;
  whyItMatters: string;
  /** Việc cần làm suy ra từ NHÓM ẢNH HƯỞNG (rule-based, action-mapper.ts) —
   *  luôn đúng nhưng chung chung. */
  recommendedActions: string[];
  /** Việc cần làm rút từ CHÍNH BÀI VIẾT (do AI soạn). Tách riêng khỏi
   *  recommendedActions để người đọc luôn biết câu nào do luật, câu nào do AI
   *  đọc bài mà ra. Rỗng khi không có AI hoặc AI không đưa được gợi ý cụ thể. */
  aiSuggestedActions?: string[];
  affectedAreas: PolicyAffectedArea[];
  /** AdsCommand routes this change is relevant to, e.g. "/creative". */
  affectedModules: string[];
  severity: PolicySeverity;
  tags: string[];
  status: PolicyReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  internalNote: string | null;
  /** "system:curated" for seed data, or the email of the admin who added it. */
  addedBy: string;
}

export interface PolicyRadarSourceHealth {
  id: string;
  platform: PolicyPlatform;
  label: string;
  url: string;
  sourceType: PolicySourceType;
  /** Whether this source's page content is reliably machine-readable (validated by hand). */
  autoFetchable: boolean;
  /** Atom/RSS endpoint. Khi có, scanner đọc từng bài thay vì băm cả trang —
   *  cho ra tiêu đề và ngày đăng thật thay vì "nội dung trang thay đổi". */
  feedUrl?: string;
  note: string;
  lastCuratedAt: string | null;
}

export interface PolicyRadarItemFilters {
  platform?: PolicyPlatform | "all";
  severity?: PolicySeverity;
  category?: PolicyCategory;
  affectedArea?: PolicyAffectedArea;
  officialOnly?: boolean;
  status?: PolicyReviewStatus;
  from?: string;
  to?: string;
}
