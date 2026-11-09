// ============================================================
// Sổ kinh nghiệm — nhãn hiển thị (Đợt 7a)
// ------------------------------------------------------------
// CHỈ `import type` từ lib/playbook/* ở đây — engine.ts/store.ts kéo theo
// fs/meta-client khi import GIÁ TRỊ, sẽ vỡ build client component (xem
// BUILD RULE trong yêu cầu Đợt 7a). Mọi hằng số bên dưới là bản sao hiển thị
// riêng cho UI, KHÔNG phải nguồn sự thật nghiệp vụ (nguồn thật ở engine.ts).
// ============================================================
import type { FeatureKind, Metric, Platform } from "@/lib/playbook/engine";
import type { EntryStatus } from "@/lib/playbook/store";
import type { PillTone } from "@/components/measure/Pill";
import type { TFunction } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/messages";

export const METRIC_LABEL: Record<Metric, string> = {
  purchase: "Mua hàng",
  initiate_checkout: "Bắt đầu thanh toán",
  landing_view: "Xem trang đích",
};

export const PLATFORM_LABEL: Record<Platform, string> = { facebook: "Facebook", google: "Google" };

/** FeatureKind (gốc, kỹ thuật) → nhóm hiển thị tiếng Việt dùng để lọc. */
export const KIND_GROUP: Record<FeatureKind, string> = {
  age: "Đối tượng",
  gender: "Đối tượng",
  interest: "Đối tượng",
  advantage_audience: "Đối tượng",
  custom_audience: "Đối tượng",
  placement: "Vị trí",
  opt_event: "Sự kiện tối ưu",
  budget_tier: "Ngân sách",
  ad_format: "Nội dung",
  hook: "Nội dung",
  headline: "Nội dung",
  cta: "Nội dung",
  landing: "Trang đích",
  search_theme: "Từ khoá / cụm tìm kiếm",
  keyword: "Từ khoá / cụm tìm kiếm",
  rsa_headline: "Từ khoá / cụm tìm kiếm",
  device: "Thiết bị / giờ",
  hour: "Thiết bị / giờ",
  pmax_text: "Nội dung",
  channel: "Vị trí",
};

export const KIND_GROUP_OPTIONS = [
  "Đối tượng",
  "Vị trí",
  "Sự kiện tối ưu",
  "Ngân sách",
  "Nội dung",
  "Từ khoá / cụm tìm kiếm",
  "Trang đích",
  "Thiết bị / giờ",
] as const;

export const STATUS_LABEL: Record<EntryStatus, { text: string; tone: PillTone }> = {
  auto: { text: "✓ Tự dùng", tone: "green" },
  suggested: { text: "○ Gợi ý", tone: "grey" },
  approved: { text: "✓ Đã duyệt", tone: "green" },
  rejected: { text: "✕ Đã bỏ", tone: "red" },
  expired: { text: "↺ Hết hạn", tone: "grey" },
};

export const STATUS_OPTIONS: { value: EntryStatus; label: string }[] = [
  { value: "auto", label: "Tự dùng" },
  { value: "suggested", label: "Gợi ý" },
  { value: "approved", label: "Đã duyệt" },
  { value: "rejected", label: "Đã bỏ" },
  { value: "expired", label: "Hết hạn" },
];

export const CONFIDENCE_LABEL: Record<"high" | "medium", { text: string; tone: PillTone }> = {
  high: { text: "✓ Cao", tone: "green" },
  medium: { text: "◐ Trung bình", tone: "amber" },
};

export const VERDICT_LABEL: Record<"win" | "lose" | "neutral", { text: string; tone: PillTone }> = {
  win: { text: "✓ thắng", tone: "green" },
  lose: { text: "✕ thua", tone: "red" },
  neutral: { text: "– trung tính", tone: "grey" },
};

// ── Bản theo ngôn ngữ: truyền `t` (useT()) → chữ EN/VI theo cookie; không truyền → đúng như các bảng trên (tiếng Việt). ──

export const metricLabel = (m: Metric, t?: TFunction): string =>
  t ? t(`common.playbook.metric.${m}` as MessageKey) : METRIC_LABEL[m];

const GROUP_KEY: Record<string, string> = {
  "Đối tượng": "audience", "Vị trí": "placement", "Sự kiện tối ưu": "optEvent", "Ngân sách": "budget",
  "Nội dung": "content", "Từ khoá / cụm tìm kiếm": "keyword", "Trang đích": "landing", "Thiết bị / giờ": "deviceHour",
};

/** Nhãn của một nhóm (giá trị tiếng Việt trong KIND_GROUP / KIND_GROUP_OPTIONS — vẫn dùng làm khoá lọc). */
export const kindGroupLabel = (group: string, t?: TFunction): string =>
  t && group in GROUP_KEY ? t(`common.playbook.group.${GROUP_KEY[group]}` as MessageKey) : group;

export const kindGroup = (kind: FeatureKind, t?: TFunction): string => kindGroupLabel(KIND_GROUP[kind], t);

export const statusLabel = (s: EntryStatus, t?: TFunction): { text: string; tone: PillTone } =>
  t ? { text: t(`common.playbook.status.${s}` as MessageKey), tone: STATUS_LABEL[s].tone } : STATUS_LABEL[s];

export const statusOptions = (t?: TFunction): { value: EntryStatus; label: string }[] =>
  t ? STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(`common.playbook.statusOpt.${o.value}` as MessageKey) })) : STATUS_OPTIONS;

export const confidenceLabel = (c: "high" | "medium", t?: TFunction): { text: string; tone: PillTone } =>
  t ? { text: t(`common.playbook.confidence.${c}` as MessageKey), tone: CONFIDENCE_LABEL[c].tone } : CONFIDENCE_LABEL[c];

export const verdictLabel = (v: "win" | "lose" | "neutral", t?: TFunction): { text: string; tone: PillTone } =>
  t ? { text: t(`common.playbook.verdict.${v}` as MessageKey), tone: VERDICT_LABEL[v].tone } : VERDICT_LABEL[v];
