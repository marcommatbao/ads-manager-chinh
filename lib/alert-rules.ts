// ============================================================
// AdsCommand — Alert Rules
// Defines all alert types, severities, and condition logic
// ============================================================

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

import { MIN_CONV_FOR_CPL, ZERO_CONV_MIN_SPEND_24H } from "@/lib/data-sufficiency";
import { resolveTarget } from "@/lib/targets/resolve";

export type AlertType =
  | "cpl_critical"
  | "cpl_warning"
  | "cpl_recovered"
  | "budget_low"
  | "budget_depleted"
  | "campaign_rejected"
  | "zero_conversions"
  | "spend_spike"
  | "high_cpc"
  | "fatigue_critical"
  | "fatigue_warning"
  | "automation_rule";

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertMetrics {
  campaign_id: string;
  campaign_name: string;
  company: string;
  spend: number;
  conversions: number;
  cpl: number;
  cpc: number;
  budget_total: number;
  budget_remaining_pct: number;
  spend_24h: number;
  conversions_24h: number;
  spend_change_pct: number;
  status: string;
  fatigue_level?: "healthy" | "warning" | "fatigued" | "critical";
  fatigue_message?: string;
  /** Đợt 23: đang trong giai đoạn học → không chấm đỏ CPL / 0 chuyển đổi (lib/data-sufficiency.ts). */
  learning?: boolean;
}

// Root-cause diagnosis attached after the alert fires (lib/root-cause.ts) —
// "vì sao CPL spike + đề xuất fix". Absent until generated (auto on new
// cpl_critical/cpl_warning alerts, or on-demand via /api/cpl/root-cause).
export interface RootCauseAnomaly {
  metric: string;
  label: string;
  changePct: number;
  direction: "increase" | "decrease";
  severity: "critical" | "warning" | "info";
  description: string;
}

export interface RootCauseAnalysis {
  generated_at: string;
  cpl: number | null;
  cpl_level: "good" | "warning" | "critical" | "no_data";
  anomalies: RootCauseAnomaly[];
  budget_constrained: boolean; // Google only — search_budget_lost_impression_share cao
  likely_causes: string[];
  suggested_actions: string[];
  ai_generated: boolean; // false = fallback rời rạc từ anomaly, Gemini không khả dụng
}

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  campaign_id: string;
  campaign_name: string;
  company: string;
  message: string;
  metadata: Partial<AlertMetrics>;
  root_cause?: RootCauseAnalysis;
  is_read: boolean;
  is_resolved: boolean;
  resolved_note?: string;
  resolved_at?: string;
  created_at: string;
}

// ─────────────────────────────────────────────
// Alert Rule Definition
// ─────────────────────────────────────────────

interface AlertRule {
  type: AlertType;
  severity: AlertSeverity;
  company: string /* mã công ty hoặc "ALL" */;
  condition: (d: AlertMetrics) => boolean;
  message: (d: AlertMetrics) => string;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("vi-VN").format(Math.round(n));
}

// ─────────────────────────────────────────────
// Rules
// ─────────────────────────────────────────────

/** Đợt 23: CPL chỉ chấm khi đủ chuyển đổi và không đang học (trước đây 1 chuyển đổi đã đủ để báo đỏ). */
const enoughForCpl = (d: AlertMetrics) => d.cpl > 0 && d.conversions >= MIN_CONV_FOR_CPL && !d.learning;

/** Mốc cũ của luật cảnh báo (trước Đợt 23) — dùng khi chưa nhập CPL ở Mục tiêu, để bản Mắt Bão giữ nguyên. */
const LEGACY_ALERT_CPL: Record<string, { target: number; ceiling: number }> = { MBC: { target: 60_000, ceiling: 100_000 }, MBI: { target: 150_000, ceiling: 251_000 } };
function cplTargetOf(d: AlertMetrics): { target: number; ceiling: number } | null {
  const old = LEGACY_ALERT_CPL[d.company];
  return resolveTarget({ company: d.company, campaignName: d.campaign_name, goalKind: "leads", fallback: old ? { ...old, source: "alert_rules" } : null });
}
const k = (n: number) => `${Math.round(n / 1000)}K`;

export const ALERT_RULES: AlertRule[] = [
  // ── CPL (Đợt 23 3b) ──
  // Ngưỡng: Xử lý chiến dịch → Mục tiêu (CPL thu lead) nếu đã nhập; chưa → mốc cũ MBC 60K/100K, MBI 150K/251K (câu báo y như cũ).
  // Công ty khác chưa nhập mục tiêu → không có luật CPL (như trước).
  {
    type: "cpl_critical",
    severity: "critical",
    company: "ALL",
    condition: (d) => { const t = cplTargetOf(d); return !!t && enoughForCpl(d) && d.cpl > t.ceiling; },
    message: (d) => { const t = cplTargetOf(d)!; return `🔴 CPL ₫${fmt(d.cpl)} vượt ngưỡng ${d.company} (₫${k(t.ceiling)}) — ${d.campaign_name}`; },
  },
  {
    type: "cpl_warning",
    severity: "warning",
    company: "ALL",
    condition: (d) => { const t = cplTargetOf(d); return !!t && enoughForCpl(d) && d.cpl > t.target && d.cpl <= t.ceiling; },
    message: (d) => { const t = cplTargetOf(d)!; return `🟡 CPL ₫${fmt(d.cpl)} vùng theo dõi ${d.company} (₫${k(t.target + 1000)}–${k(t.ceiling - 1000)}) — ${d.campaign_name}`; },
  },
  {
    type: "cpl_recovered",
    severity: "info",
    company: "ALL",
    condition: (d) => { const t = cplTargetOf(d); return !!t && d.cpl > 0 && d.cpl <= t.target && d.conversions >= 3; },
    message: (d) => `🟢 CPL ₫${fmt(d.cpl)} trở về vùng tốt ${d.company} — ${d.campaign_name}`,
  },

  // ── Budget Low / Budget Depleted ──
  // Deliberately NOT wired here. lib/budget-monitor.ts already owns budget
  // threshold alerting end-to-end (its own 50/80/95% thresholds, its own
  // Telegram channel, its own once-per-month dedup store) at the
  // company/month level. Adding campaign/day-level budget_low/depleted
  // rules to this engine too would double-alert on the same underlying
  // signal. AlertType keeps these two values for backward-compat with any
  // already-stored alerts of this type; nothing produces new ones.

  // ── Zero Conversions ──
  {
    type: "zero_conversions",
    severity: "warning",
    company: "ALL",
    condition: (d) => d.conversions_24h === 0 && d.spend_24h > ZERO_CONV_MIN_SPEND_24H && !d.learning, // Đợt 23: trước đây 50K, cả khi đang học
    message: (d) =>
      `⚠️ 24h không có conversion — đang tiêu ₫${fmt(d.spend_24h)} — ${d.campaign_name}`,
  },

  // ── Spend Spike ──
  {
    type: "spend_spike",
    severity: "warning",
    company: "ALL",
    condition: (d) => d.spend_change_pct > 50,
    message: (d) =>
      `📈 Chi tiêu tăng ${Math.round(d.spend_change_pct)}% so với hôm qua — ${d.campaign_name}`,
  },

  // ── Campaign Rejected ──
  {
    type: "campaign_rejected",
    severity: "critical",
    company: "ALL",
    condition: (d) => d.status === "DISAPPROVED" || d.status === "WITH_ISSUES",
    message: (d) =>
      `🚫 Campaign bị từ chối / có vấn đề — ${d.campaign_name}`,
  },

  // ── Ad Fatigue ──
  {
    type: "fatigue_critical",
    severity: "critical",
    company: "ALL",
    condition: (d) => d.fatigue_level === "critical" || d.fatigue_level === "fatigued",
    message: (d) =>
      `🔥 Exhaustion: ${d.fatigue_message || "Audience đã bão hoà, cần refresh"} — ${d.campaign_name}`,
  },
  {
    type: "fatigue_warning",
    severity: "warning",
    company: "ALL",
    condition: (d) => d.fatigue_level === "warning",
    message: (d) =>
      `👀 Cảnh báo Fatigue: ${d.fatigue_message || "Chỉ số đang suy giảm"} — ${d.campaign_name}`,
  },
];

// ─────────────────────────────────────────────
// UI Helpers
// ─────────────────────────────────────────────

export const SEVERITY_CONFIG: Record<AlertSeverity, {
  label: string;
  emoji: string;
  color: string;
  bg: string;
  border: string;
  dot: string;
}> = {
  critical: {
    label: "Critical",
    emoji: "🔴",
    color: "text-red-700",
    bg: "bg-red-50",
    border: "border-red-200",
    dot: "bg-red-500",
  },
  warning: {
    label: "Warning",
    emoji: "🟡",
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200",
    dot: "bg-amber-500",
  },
  info: {
    label: "Info",
    emoji: "🟢",
    color: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
    dot: "bg-blue-500",
  },
};

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  cpl_critical: "CPL vượt ngưỡng",
  cpl_warning: "CPL cảnh báo",
  cpl_recovered: "CPL phục hồi",
  budget_low: "Budget thấp",
  budget_depleted: "Budget hết",
  campaign_rejected: "Campaign bị từ chối",
  zero_conversions: "Không có conversion",
  spend_spike: "Chi tiêu tăng đột biến",
  high_cpc: "CPC cao bất thường",
  fatigue_critical: "Bão hoà (Nghiêm trọng)",
  fatigue_warning: "Cảnh báo mệt mỏi",
  automation_rule: "Automation Rule",
};
