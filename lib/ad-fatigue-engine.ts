// ============================================================
// Ad Fatigue Engine — CPL + Creative Fatigue Detection
// Company-specific CPL thresholds + combined fatigue rules
// Works alongside lib/fatigue-detector.ts for enhanced detection
// ============================================================

import { getCompany } from "@/lib/campaign-utils";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface FatigueIssue {
  type:
    | "HIGH_FREQUENCY"
    | "CTR_DROPPING"
    | "CPL_CRITICAL"
    | "CPL_WARNING"
    | "FREQ_CTR_COMBO";
  message: string;
  suggestion: string;
}

export type FatigueSeverity = "ok" | "warning" | "critical";

export interface FatigueResult {
  severity: FatigueSeverity;
  issues: FatigueIssue[];
  needsRefresh: boolean;
  cplStatus?: "ok" | "warning" | "critical";
}

export interface FatigueMetrics {
  frequency: number;       // avg views per user
  ctrCurrent: number;      // CTR last 7 days (%)
  ctrPrevious: number;     // CTR previous 7 days (%)
  cplCurrent: number;      // CPL last 7 days (VND)
  cplPrevious: number;     // CPL previous 7 days (VND)
  spend: number;           // total spend (VND)
  company: string;
}

// ─────────────────────────────────────────────
// Company-Specific CPL Thresholds (VND)
// ─────────────────────────────────────────────

export const CPL_THRESHOLD: Record<string, { warning: number; critical: number }> = {
  MBC: { warning: 99000,  critical: 130000 },
  MBI: { warning: 250000, critical: 320000 },
};

// ─────────────────────────────────────────────
// Core Fatigue Check Function
// ─────────────────────────────────────────────

export function checkAdFatigue(metrics: FatigueMetrics): FatigueResult {
  const issues: FatigueIssue[] = [];
  let severity: FatigueSeverity = "ok";

  // ── Rule 1: Frequency quá cao ──
  if (metrics.frequency > 3.5) {
    issues.push({
      type: "HIGH_FREQUENCY",
      message: `Mỗi user đã xem TB ${metrics.frequency.toFixed(1)} lần — quảng cáo đang bị nhàm`,
      suggestion: "Thay creative mới hoặc mở rộng audience",
    });
    severity = "warning";
  }

  // ── Rule 2: CTR giảm mạnh ──
  const ctrDrop = metrics.ctrPrevious > 0
    ? ((metrics.ctrPrevious - metrics.ctrCurrent) / metrics.ctrPrevious) * 100
    : 0;

  if (ctrDrop > 25) {
    issues.push({
      type: "CTR_DROPPING",
      message: `CTR giảm ${ctrDrop.toFixed(0)}% so với tuần trước`,
      suggestion: "Đổi ảnh hoặc thay headline",
    });
    severity = "warning";
  }

  // ── Rule 3: CPL tăng vượt ngưỡng (company-specific) ──
  const threshold = CPL_THRESHOLD[metrics.company];
  let cplStatus: "ok" | "warning" | "critical" = "ok";

  if (metrics.cplCurrent > threshold.critical) {
    issues.push({
      type: "CPL_CRITICAL",
      message: `CPL ₫${metrics.cplCurrent.toLocaleString("vi-VN")} vượt ngưỡng critical ₫${threshold.critical.toLocaleString("vi-VN")}`,
      suggestion: "Pause ngay, tạo creative mới",
    });
    severity = "critical";
    cplStatus = "critical";
  } else if (metrics.cplCurrent > threshold.warning) {
    issues.push({
      type: "CPL_WARNING",
      message: `CPL ₫${metrics.cplCurrent.toLocaleString("vi-VN")} đang tiệm cận ngưỡng warning ₫${threshold.warning.toLocaleString("vi-VN")}`,
      suggestion: "Cần theo dõi sát, chuẩn bị creative dự phòng",
    });
    if (severity === "ok") severity = "warning";
    cplStatus = "warning";
  }

  // ── Rule 4: Frequency cao + CTR giảm = fatigue chắc chắn ──
  if (metrics.frequency > 3 && ctrDrop > 20) {
    if (!issues.some(i => i.type === "FREQ_CTR_COMBO")) {
      issues.push({
        type: "FREQ_CTR_COMBO",
        message: `Frequency ${metrics.frequency.toFixed(1)}x kết hợp CTR giảm ${ctrDrop.toFixed(0)}% — creative chắc chắn đã mệt`,
        suggestion: "Tắt campaign, clone với creative mới",
      });
    }
    severity = "critical";
  }

  return {
    severity,
    issues,
    needsRefresh: severity !== "ok",
    cplStatus,
  };
}

// ─────────────────────────────────────────────
// Quick CPL Check (from campaign metrics)
// Used by CampaignTable for inline CPL fatigue badge
// ─────────────────────────────────────────────

export function quickCPLCheck(
  spend: number,
  conversions: number,
  campaignName: string
): { severity: FatigueSeverity; cpl: number | null; label: string } {
  if (conversions <= 0) return { severity: "ok", cpl: null, label: "—" };

  const cpl = spend / conversions;
  const company = getCompany(campaignName);
  if (!company) return { severity: "ok", cpl, label: `₫${Math.round(cpl).toLocaleString("vi-VN")}` };

  const th = CPL_THRESHOLD[company];

  if (cpl > th.critical) {
    return { severity: "critical", cpl, label: `🔴 ₫${Math.round(cpl).toLocaleString("vi-VN")}` };
  }
  if (cpl > th.warning) {
    return { severity: "warning", cpl, label: `🟡 ₫${Math.round(cpl).toLocaleString("vi-VN")}` };
  }
  return { severity: "ok", cpl, label: `🟢 ₫${Math.round(cpl).toLocaleString("vi-VN")}` };
}
