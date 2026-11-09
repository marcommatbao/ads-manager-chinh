// ============================================================
// Next Best Action Engine — Types (v2)
// Pure type layer. Superset tương thích ngược với slice-1.
// Xem docs/NEXT_BEST_ACTION_DESIGN.md
// ============================================================

import type { Campaign } from "@/types/ads.types";

export type NbaCompany   = string;
export type NbaPlatform  = "facebook" | "google";

export type NbaEntityType =
  | "campaign" | "adset" | "ad" | "creative"
  | "keyword" | "schedule" | "audience" | "budget" | "account";

export type NbaCategory =
  | "campaign" | "creative" | "budget"
  | "keyword" | "schedule" | "audience" | "account";

// Loại hành động ở mức cao (gom nhóm nhiều reasonCode).
export type NbaRecommendationType =
  | "REDUCE_CPL"
  | "PAUSE_WASTE"
  | "REFRESH_CREATIVE"
  | "SCALE_BUDGET"
  | "REVIEW_BUDGET"
  | "FIX_KEYWORD"
  | "ADJUST_SCHEDULE"
  | "ACCOUNT_FIX"
  | "IMPORTED_IMPROVEMENT";

// Chế độ thực thi (spec v2). actionMode (slice-1) vẫn giữ để tương thích.
export type NbaExecutionMode =
  | "advisory_only"
  | "manual_action"
  | "auto_apply_candidate";

export type NbaActionMode =
  | "advisory_only"
  | "manual"
  | "auto_apply_eligible";

export type NbaExecutor = "automation-engine" | "actionExecutor" | "manual-link";

export type NbaStatus =
  | "new"
  | "seen"
  | "acknowledged"
  | "snoozed"
  | "resolved"
  | "applied"
  | "auto_applied"
  | "dismissed"
  | "expired"
  | "superseded";

export type NbaFeedbackValue = "helped" | "not_helpful" | "ignored";

export type NbaSeverity = "critical" | "warning" | "info";

export type NbaBlockReason =
  | "LEARNING_PHASE"
  | "LOW_DATA"
  | "ROLE_RESTRICTION"
  | "COOLDOWN_LIKELY"
  | "RECENT_CHANGE"
  | "LOW_CONFIDENCE"
  | "NOT_REVERSIBLE"
  | "CONFLICT_SUPERSEDED";

// Closed enum reasonCode (collectors native + map từ /improvements).
export type NbaReasonCode =
  // native collectors
  | "CPL_CRITICAL"
  | "CPL_WARNING"
  | "ZERO_CONV_SPEND"
  | "CREATIVE_FATIGUE"
  | "SCALE_WINNER"
  | "LOW_ROAS_REVIEW"
  // mapped từ improvements
  | "FIX_LOW_QS_KEYWORD"
  | "PAUSE_FB_AD_LOW_CTR"
  | "DAYPART_OPPORTUNITY"
  | "NEGATIVE_KEYWORD_WASTE"
  | "IMPROVEMENT_OTHER";

export interface NbaEvidence {
  metric: string;
  current: number;
  baseline?: number;
  threshold?: number;
  unit?: string; // "₫" | "%" | "x" | ""
}

export interface NbaImpactEstimate {
  metric: string;
  direction: "save" | "gain" | "reduce_waste";
  estMonthlySavingsVnd?: number;
  estMonthlyLiftVnd?: number;
  estCplDelta?: number;
}

// 6 chiều chấm điểm (0-100) + priority tổng hợp.
export interface NbaScores {
  impact: number;
  urgency: number;
  confidence: number;
  safety: number;
  dataCompleteness: number;
  persistence: number;
  priority: number;
}

export interface NbaSuggestedAction {
  type: string;
  params?: Record<string, unknown>;
}

// Tín hiệu thô do collector emit.
export interface NbaSignal {
  reasonCode: NbaReasonCode;
  company: NbaCompany;
  platform: NbaPlatform;
  entityType: NbaEntityType;
  entityId: string;
  entityName: string;
  title: string;
  explanation: string;
  evidence: NbaEvidence[];
  severity: NbaSeverity;
  sampleSize?: number;
  impactEstimate?: NbaImpactEstimate;
  suggestedAction?: NbaSuggestedAction;
  sourceEngine: string;
  /** reasonCode gốc (vd từ improvements) để giữ vết trong reasonCodes[]. */
  originReason?: string;
  /** campaign gốc cho learning-phase guard. Không serialize. */
  _guardCampaign?: unknown;
}

export interface NbaOutcome {
  cplBefore?: number;
  cplAfter?: number;
  verdict?: "better" | "worse" | "neutral" | "pending";
  measuredAt?: string;
}

export interface NbaRecommendation {
  id: string;
  /** Phiên bản CÔNG THỨC tính tác động đã dùng để sinh ra bản ghi này.
   *
   *  Khuyến nghị được LƯU LẠI và chỉ tính lại khi bấm "Làm mới" hoặc kho rỗng;
   *  mục đã "Đã nhận"/"Hoãn" còn bị bỏ qua hẳn khi cập nhật. Nên sau một lần
   *  sửa công thức, màn hình TRỘN LẪN số cũ và số mới mà không ai biết con số
   *  nào theo công thức nào — tệ hơn hẳn việc tất cả cùng cũ.
   *
   *  Có trường này thì hệ thống tự phát hiện bản ghi lỗi thời và tính lại,
   *  không phải trông vào việc người dùng nhớ bấm Làm mới.
   *  Thiếu trường = bản ghi sinh trước khi có cơ chế này (coi như v1). */
  calcVersion?: number;
  dedupeKey: string;
  company: NbaCompany;
  platform: NbaPlatform;
  entityType: NbaEntityType;
  entityId: string;
  entityName: string;

  // phân loại
  category: NbaCategory;
  recommendationType: NbaRecommendationType;
  reasonCode: NbaReasonCode;
  reasonCodes: string[];
  sourceSignals: string[];

  // nội dung
  title: string;
  summary: string;
  explanation: string;
  recommendedAction: string;
  expectedOutcome: string;
  evidence: NbaEvidence[];
  supportingMetrics: Record<string, number | string>;
  impactEstimate?: NbaImpactEstimate;
  estimatedMonthlySavings?: number;
  estimatedMonthlyLift?: number;

  // điểm số (object + flatten theo spec)
  scores: NbaScores;
  priorityScore: number;
  impactScore: number;
  urgencyScore: number;
  confidenceScore: number;
  safetyScore: number;
  dataCompletenessScore: number;
  persistenceScore: number;

  // thực thi & chặn
  executionMode: NbaExecutionMode;
  actionMode: NbaActionMode;          // tương thích slice-1 / auto-apply
  executor: NbaExecutor;
  blockedBy: NbaBlockReason[];
  guardFlags: string[];               // tương thích slice-1
  suggestedAction?: NbaSuggestedAction;
  internalLink?: string;

  // vòng đời
  occurrenceCount: number;
  status: NbaStatus;
  feedback?: NbaFeedbackValue;
  snoozeUntil?: string;
  /** company:entityType:entityId:recommendationType — dedupe chéo nguồn. */
  clusterKey: string;
  outcome?: NbaOutcome;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

// Typed input collections (engine KHÔNG tự gọi API).
export interface NbaInputs {
  campaigns: Campaign[];
  /** Improvement[] từ /improvements để map vào engine. */
  improvements?: ImprovementLike[];
  /** entityId vừa bị đổi (từ change-tracker) → COOLDOWN/RECENT_CHANGE. */
  recentlyChangedEntityIds?: string[];
  /** dedupeKey → số lần đã xuất hiện trước đó (từ store) → persistence. */
  priorOccurrences?: Record<string, number>;
  /** reasonCode → prior ∈ [-1,1] từ feedback loop (ai-memory) → confidence. */
  priors?: Record<string, number>;
}

export interface NbaContext {
  companies: NbaCompany[];
  now?: number;
}

/** Shape tối thiểu của 1 Improvement (từ app/api/improvements). */
export interface ImprovementLike {
  id?: string;
  type: string;
  source?: "GOOGLE" | "FACEBOOK" | "CROSS_CHANNEL";
  priority?: "HIGH" | "MEDIUM" | "LOW";
  company?: string;
  title?: string;
  description?: string;
  impact?: string;
  impactValue?: number;
  impactRough?: boolean;
  confidence?: number;
  campaignName?: string;
  keyword?: string;
  adName?: string;
  canAutoApply?: boolean;
}
