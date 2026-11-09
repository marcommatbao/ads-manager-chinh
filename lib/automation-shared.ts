import { makeT, type TFunction } from "@/lib/i18n/translate"
// ============================================================
// AdsCommand — Automation Engine Shared Types & Constants
// ============================================================

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type MetricKey =
  | "ctr" | "cpc" | "roas" | "spend"
  | "impressions" | "frequency" | "cpm"
  | "budget_used_pct" | "conversions"
  | "cpl" | "ctr_drop_pct" | "days_running" | "remaining_budget"
  | "days_until_end" | "end_date_is_set";

export type ConditionOperator =
  | ">" | "<" | ">=" | "<=" | "=="
  | "increased_by_pct" | "decreased_by_pct";

export type TimeWindow = "today" | "last_3d" | "last_7d" | "this_month";

export type ActionType =
  | "pause_campaign" | "activate_campaign"
  | "pause_adset" | "pause_ad"
  | "increase_budget" | "decrease_budget"
  | "send_notification" | "send_email"
  | "send_webhook" | "add_to_report"
  | "request_ai_evaluation" | "create_alert"
  | "suggest_new_creative";

export type CheckInterval = "15min" | "1hour" | "6hour" | "daily";

export interface Condition {
  metric: MetricKey;
  operator: ConditionOperator;
  value: number;
  timeWindow: TimeWindow;
}

export interface Action {
  type: ActionType;
  value?: number;    // for budget changes: percentage
  message?: string;  // for notifications
}

export interface AutomationRule {
  id: string;
  name: string;
  isActive: boolean;
  platform: "facebook" | "google" | "all";
  checkInterval: CheckInterval;

  conditions: Condition[];
  conditionLogic: "AND" | "OR";

  actions: Action[];

  cooldown: number;         // hours before same rule fires again
  cooldownDays?: number;    // cooldown in days (alternative)
  lastTriggered?: string;   // ISO timestamp — set only when the rule actually fires
  lastCheckedAt?: string;   // ISO timestamp — set every time conditions are evaluated, fired or not; gates checkInterval
  triggerCount: number;
  createdAt: string;
  respectLearningPhase?: boolean; // Guard: skip destructive actions during learning
  company?: string | "all"; // Company filter
  targetCampaignIds?: string[];    // Specific campaigns (empty = all)
  /** Đợt 10b — chỉ áp cho loại chiến dịch Google này (vd ["SEARCH"] để luật viết cho Search không đụng PMax). Rỗng/không có = mọi loại. */
  googleChannelTypes?: string[];
  tags?: string[];                 // For grouping/filtering
}

export interface CampaignMetrics {
  ctr: number;
  cpc: number;
  cpm: number;
  /** `null` = CHƯA ĐO ĐƯỢC doanh thu, khác hẳn `0` = đo được và bằng không.
   *
   *  Chiến dịch lead-gen (hoá đơn điện tử, chữ ký số, hợp đồng điện tử) không
   *  hề phát sinh giá trị `purchase`, nên trước đây ROAS của chúng luôn ra 0 →
   *  luật "Tắt campaign lỗ" (`roas < 0.8` → `pause_campaign`) sẽ tắt sạch chúng
   *  vì một con số chưa từng được đo. Luật gặp `null` phải BỎ QUA, không được
   *  coi như lỗ. */
  roas: number | null;
  spend: number;
  impressions: number;
  frequency: number;
  budget_used_pct: number;
  conversions: number;
  // Extended metrics used by conditions
  cpl: number;
  ctr_drop_pct: number;
  days_running: number;
  remaining_budget: number;
  days_until_end: number;
  end_date_is_set: number; // 0 = no end date, 1 = end date is set
}

export interface RuleExecutionResult {
  ruleId: string;
  ruleName: string;
  campaignId: string;
  campaignName: string;
  action: ActionType;
  triggeredAt: string;
  metricsSnapshot: CampaignMetrics;
  skipped?: boolean;
  skipReason?: string;
}

// ─────────────────────────────────────────────
// Label helpers (for UI)
// ─────────────────────────────────────────────

export const METRIC_LABELS: Record<MetricKey, string> = {
  ctr: "CTR (%)",
  cpc: "CPC (₫)",
  roas: "ROAS",
  spend: "Chi tiêu (₫)",
  impressions: "Impressions",
  frequency: "Frequency",
  cpm: "CPM (₫)",
  budget_used_pct: "% Ngân sách đã dùng",
  conversions: "Conversions",
  cpl: "CPL (₫)",
  ctr_drop_pct: "CTR giảm (%)",
  days_running: "Số ngày chạy",
  remaining_budget: "Ngân sách còn lại (₫)",
  days_until_end: "Ngày còn lại",
  end_date_is_set: "Có set ngày kết thúc",
};

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  ">": "lớn hơn",
  "<": "nhỏ hơn",
  ">=": "≥",
  "<=": "≤",
  "==": "bằng",
  "increased_by_pct": "tăng hơn %",
  "decreased_by_pct": "giảm hơn %",
};

export const ACTION_LABELS: Record<ActionType, { label: string; icon: string }> = {
  pause_campaign:       { label: "Tạm dừng campaign",       icon: "⏸️" },
  activate_campaign:    { label: "Kích hoạt campaign",       icon: "▶️" },
  pause_adset:          { label: "Tạm dừng Ad Set",         icon: "⏸️" },
  pause_ad:             { label: "Tạm dừng Ad",             icon: "⏸️" },
  increase_budget:      { label: "Tăng ngân sách",           icon: "📈" },
  decrease_budget:      { label: "Giảm ngân sách",           icon: "📉" },
  send_notification:    { label: "Gửi thông báo",            icon: "🔔" },
  send_email:           { label: "Gửi email",                icon: "📧" },
  send_webhook:         { label: "Gửi webhook",              icon: "🌐" },
  // Không có báo cáo nào được đụng tới: hành động này chỉ đẩy thông báo trong app,
  // grep toàn repo không có nơi nào tiêu thụ. Rule "CPC tăng đột biến" đã chạy nó
  // 926 lần trên prod, mỗi lần báo "Đã thêm ... vào báo cáo" — không lần nào có thật.
  add_to_report:        { label: "Ghi nhận vào thông báo",  icon: "📊" },
  // Không có AI nào chạy ở hành động này: nó chỉ đẩy một thông báo trong app, và
  // không nơi nào trong repo tiêu thụ "yêu cầu" đó. Nhãn cũ ("Yêu cầu AI đánh giá")
  // hứa một việc không xảy ra — và nó đang chạy thật trên prod mỗi 6 giờ. Đặt tên
  // đúng việc nó làm; muốn có AI đánh giá thật thì phải nối, không phải đổi chữ.
  request_ai_evaluation:{ label: "Đánh dấu để xem lại",      icon: "🔎" },
  create_alert:         { label: "Tạo alert",                icon: "🚨" },
  suggest_new_creative: { label: "Gợi ý tạo creative mới",  icon: "🎨" },
};

export const INTERVAL_LABELS: Record<CheckInterval, string> = {
  "15min": "Mỗi 15 phút",
  "1hour": "Mỗi giờ",
  "6hour": "Mỗi 6 giờ",
  "daily": "Hàng ngày",
};

export const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  today: "Hôm nay",
  last_3d: "3 ngày gần nhất",
  last_7d: "7 ngày gần nhất",
  this_month: "Tháng này",
};

// Đợt 10b — loại chiến dịch Google mà `googleChannelTypes` được phép chứa.
// Khớp đúng chuỗi `campaign.channelType` mà lib/automation-google.ts đọc từ
// enums.AdvertisingChannelType của Google Ads (xem dòng gán channelType ở đó).
export const GOOGLE_CHANNEL_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "SEARCH", label: "Tìm kiếm" },
  { value: "PERFORMANCE_MAX", label: "PMax" },
  { value: "DISPLAY", label: "Hiển thị" },
  { value: "VIDEO", label: "Video" },
  { value: "DEMAND_GEN", label: "Demand Gen" },
];
const GOOGLE_CHANNEL_TYPE_VALUES = new Set(GOOGLE_CHANNEL_TYPE_OPTIONS.map((o) => o.value));
export const GOOGLE_CHANNEL_TYPE_LABEL: Record<string, string> = Object.fromEntries(GOOGLE_CHANNEL_TYPE_OPTIONS.map((o) => [o.value, o.label]));

/** Lọc input về đúng 5 giá trị hợp lệ — dùng cả ở form (không bắt buộc) và ở API trước khi lưu. */
export function sanitizeGoogleChannelTypes(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return [...new Set(x.filter((v): v is string => typeof v === "string" && GOOGLE_CHANNEL_TYPE_VALUES.has(v)))];
}

// Nhãn theo ngôn ngữ — hằng số bên trên giữ nguyên bản tiếng Việt (cron/Teams/MCP dùng); giao diện gọi các hàm dưới đây kèm t.
export const metricLabel = (k: MetricKey, t: TFunction = makeT("vi")): string => t(`libcase.auto.metric.${k}` as never);
export const operatorLabel = (k: ConditionOperator, t: TFunction = makeT("vi")): string => t(`libcase.auto.op.${k}` as never);
export const actionLabel = (k: ActionType, t: TFunction = makeT("vi")): { label: string; icon: string } => ({ label: t(`libcase.auto.act.${k}` as never), icon: ACTION_LABELS[k].icon });
export const intervalLabel = (k: CheckInterval, t: TFunction = makeT("vi")): string => t(`libcase.auto.interval.${k}` as never);
export const timeWindowLabel = (k: TimeWindow, t: TFunction = makeT("vi")): string => t(`libcase.auto.tw.${k}` as never);
export const googleChannelTypeLabel = (v: string, t: TFunction = makeT("vi")): string => (v in GOOGLE_CHANNEL_TYPE_LABEL ? t(`libcase.auto.chtype.${v}` as never) : v);
export const googleChannelTypeOptions = (t: TFunction = makeT("vi")): { value: string; label: string }[] =>
  GOOGLE_CHANNEL_TYPE_OPTIONS.map((o) => ({ value: o.value, label: googleChannelTypeLabel(o.value, t) }));
/** Tên luật mẫu theo chỉ số trong PREBUILT_RULES (chỉ tên; nội dung thông báo của luật vẫn tiếng Việt vì do cron gửi). */
export const prebuiltRuleName = (index: number, t: TFunction = makeT("vi")): string => (index >= 0 && index < PREBUILT_RULES.length ? t(`libcase.auto.rule.${index}` as never) : "");

// ─────────────────────────────────────────────
// Pre-built Rules (6 Templates)
// ─────────────────────────────────────────────

export const PREBUILT_RULES: Omit<AutomationRule, "id" | "createdAt">[] = [
  {
    name: "Tắt campaign lỗ",
    isActive: false,
    platform: "facebook",
    checkInterval: "1hour",
    conditionLogic: "AND",
    conditions: [
      { metric: "roas", operator: "<", value: 0.8, timeWindow: "today" },
      { metric: "spend", operator: ">", value: 300000, timeWindow: "today" },
    ],
    actions: [
      { type: "pause_campaign" },
      { type: "send_notification", message: "Campaign lỗ (ROAS < 0.8, chi tiêu > ₫300K) đã được tạm dừng" },
    ],
    cooldown: 24,
    triggerCount: 0,
    respectLearningPhase: true,
  },
  {
    name: "Scale campaign tốt",
    isActive: false,
    platform: "facebook",
    checkInterval: "6hour",
    conditionLogic: "AND",
    conditions: [
      { metric: "roas", operator: ">", value: 3.0, timeWindow: "today" },
      { metric: "ctr", operator: ">", value: 2, timeWindow: "today" },
      { metric: "budget_used_pct", operator: ">", value: 70, timeWindow: "today" },
    ],
    actions: [
      { type: "increase_budget", value: 30 },
      { type: "send_notification", message: "Campaign hiệu quả cao! Đã tăng 30% budget (ROAS > 3.0, CTR > 2%)" },
    ],
    cooldown: 48,
    triggerCount: 0,
  },
  {
    name: "Cảnh báo bão hoà audience",
    isActive: false,
    platform: "facebook",
    checkInterval: "6hour",
    conditionLogic: "AND",
    conditions: [
      { metric: "frequency", operator: ">", value: 3.5, timeWindow: "last_7d" },
    ],
    actions: [
      { type: "send_notification", message: "⚠️ Frequency > 3.5 — Audience đang bão hoà, cần refresh creative hoặc mở rộng targeting" },
      { type: "request_ai_evaluation" },
    ],
    cooldown: 24,
    triggerCount: 0,
  },
  {
    name: "CPC tăng đột biến",
    isActive: false,
    platform: "all",
    checkInterval: "1hour",
    conditionLogic: "AND",
    conditions: [
      { metric: "cpc", operator: "increased_by_pct", value: 40, timeWindow: "last_3d" },
    ],
    actions: [
      { type: "send_notification", message: "🔴 CPC tăng > 40% — Kiểm tra audience saturation hoặc bid strategy" },
      { type: "add_to_report" },
    ],
    cooldown: 12,
    triggerCount: 0,
  },
  {
    name: "Dừng campaign sắp hết ngân sách tháng",
    isActive: false,
    platform: "facebook",
    checkInterval: "daily",
    conditionLogic: "AND",
    conditions: [
      { metric: "budget_used_pct", operator: ">", value: 90, timeWindow: "this_month" },
    ],
    actions: [
      { type: "pause_campaign" },
      { type: "send_notification", message: "⚡ Đã dùng > 90% ngân sách tháng — Campaign tạm dừng để bảo vệ budget" },
    ],
    cooldown: 24,
    triggerCount: 0,
    respectLearningPhase: true,
  },
  {
    name: "Kích hoạt lại campaign tốt buổi sáng",
    isActive: false,
    platform: "facebook",
    checkInterval: "daily",
    conditionLogic: "AND",
    conditions: [
      { metric: "roas", operator: ">", value: 2.0, timeWindow: "last_7d" },
    ],
    actions: [
      { type: "activate_campaign" },
      { type: "send_notification", message: "🌅 Campaign có ROAS > 2.0 (7 ngày) đã được kích hoạt lại" },
    ],
    cooldown: 24,
    triggerCount: 0,
  },
  {
    name: "Phát hiện Creative Mệt",
    isActive: false,
    platform: "facebook",
    checkInterval: "6hour",
    conditionLogic: "AND",
    conditions: [
      { metric: "frequency", operator: ">", value: 3.5, timeWindow: "last_7d" },
      { metric: "ctr", operator: "<", value: 1.0, timeWindow: "last_7d" },
    ],
    actions: [
      { type: "send_notification", message: "😓 Ad Fatigue Alert — Frequency cao + CTR thấp. Creative cần được thay mới!" },
      { type: "request_ai_evaluation" },
    ],
    cooldown: 24,
    triggerCount: 0,
    respectLearningPhase: true,
  },
  {
    name: "🔄 Test & Kill — Auto-kill campaign kém sau 3 ngày",
    isActive: false,
    platform: "facebook",
    checkInterval: "6hour",
    conditionLogic: "AND",
    conditions: [
      { metric: "cpc", operator: ">", value: 35000, timeWindow: "last_3d" },
      { metric: "ctr", operator: "<", value: 0.5, timeWindow: "last_3d" },
      { metric: "spend", operator: ">", value: 500000, timeWindow: "last_3d" },
    ],
    actions: [
      { type: "pause_campaign" },
      { type: "send_notification", message: "🔄 Test & Kill: Campaign bị pause sau 3 ngày test — CPC > ₫35K + CTR < 0.5% + Spend > ₫500K. Nên tạo campaign mới với creative/targeting khác." },
    ],
    cooldown: 24,
    triggerCount: 0,
    respectLearningPhase: true, // Won't fire during < 3 day learning phase
  },
  {
    name: "🔥 Auto Kill — CPC Kill Threshold",
    isActive: false,
    platform: "facebook",
    checkInterval: "6hour",
    conditionLogic: "AND",
    conditions: [
      { metric: "cpc", operator: ">", value: 35000, timeWindow: "last_3d" },
    ],
    actions: [
      { type: "send_notification", message: "🔥 CPC đã vượt ₫35K — đúng kill threshold. Kiểm tra campaign và cân nhắc tắt nếu objective = SALES." },
    ],
    cooldown: 24,
    triggerCount: 0,
    respectLearningPhase: true,
  },
  {
    name: "😓 Frequency Kill — Audience Bão Hoà",
    isActive: false,
    platform: "facebook",
    checkInterval: "6hour",
    conditionLogic: "AND",
    conditions: [
      { metric: "frequency", operator: ">", value: 3.0, timeWindow: "last_7d" },
      { metric: "ctr", operator: "<", value: 0.5, timeWindow: "last_7d" },
    ],
    actions: [
      { type: "send_notification", message: "😓 Frequency > 3.0 + CTR < 0.5% — Audience bão hoà. Cân nhắc tắt campaign và clone với target mới." },
      { type: "request_ai_evaluation" },
    ],
    cooldown: 24,
    triggerCount: 0,
    respectLearningPhase: true,
  },
  {
    name: "Báo Campaign Sắp Kết Thúc (2 ngày)",
    isActive: false,
    platform: "all",
    checkInterval: "daily",
    conditionLogic: "AND",
    conditions: [
      { metric: "days_until_end" as never, operator: "==" as never, value: 2, timeWindow: "today" },
    ],
    actions: [
      { type: "send_notification", message: "⏰ Campaign {name} còn 2 ngày nữa hết hạn (kết thúc {end_date}). Chi tiêu hiện tại: {spend}. Ngân sách còn lại: {remaining_budget}." },
    ],
    cooldown: 24,
    triggerCount: 0,
    tags: ["warning", "end_date"],
  },
  {
    name: "Báo Campaign Kết Thúc Ngày Mai (Khẩn)",
    isActive: false,
    platform: "all",
    checkInterval: "daily",
    conditionLogic: "AND",
    conditions: [
      { metric: "days_until_end" as never, operator: "==" as never, value: 1, timeWindow: "today" },
    ],
    actions: [
      { type: "send_notification", message: "🚨 Campaign {name} sẽ kết thúc vào ngày mai {end_date}. Ngân sách còn lại: {remaining_budget}." },
    ],
    cooldown: 24,
    triggerCount: 0,
    tags: ["warning", "khẩn"],
  },
  {
    name: "Báo Campaign Sắp Kết Thúc (1-2 ngày)",
    isActive: false,
    platform: "all",
    checkInterval: "daily",
    conditionLogic: "AND",
    conditions: [
      { metric: "days_until_end" as never, operator: "<=" as never, value: 2, timeWindow: "today" },
      { metric: "days_until_end" as never, operator: ">=" as never, value: 1, timeWindow: "today" },
    ],
    actions: [
      { type: "send_notification", message: "⏰ Campaign {name} còn {days_until_end} ngày nữa hết hạn ({end_date}). Chi tiêu: {spend} / Ngân sách: {budget}." },
    ],
    cooldown: 24,
    triggerCount: 0,
    tags: ["warning"],
  },
];
