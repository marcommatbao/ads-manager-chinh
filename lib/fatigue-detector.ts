// ============================================================
// Creative Fatigue Detection Engine — AdsCommand
// Objective-based benchmarks calibrated from real Facebook Ads data
// Returns a 0-100 fatigue score with actionable signals
// ============================================================

import type { Campaign } from "@/types/ads.types";
import { getCompany } from "@/lib/campaign-utils";
import { makeT, type TFunction } from "@/lib/i18n/translate";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface FatigueSignal {
  type:
    | "cpc_critical"
    | "cpc_warning"
    | "freq_ctr_critical"
    | "freq_ctr_warning"
    | "ctr_low"
    | "ctr_declining"
    | "cpm_rising"
    | "shrinking_reach";
  value: number;
  threshold: number;
  weight: number; // 0-1
  severity: "critical" | "warning" | "info";
  description: string;
  action?: string;
}

export type FatigueLevel = "healthy" | "warning" | "fatigued" | "critical";
export type FatigueUrgency = "none" | "this_week" | "today" | "immediate";

export interface FatigueAnalysis {
  fatigueScore: number; // 0-100
  fatigueLevel: FatigueLevel;
  signals: FatigueSignal[];
  estimatedDaysLeft: number;
  recommendedAction: string;
  urgency: FatigueUrgency;
  objective?: string;
  benchmarkUsed?: string;
}

export interface DailyInsight {
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
  cpc: number;
  cpm: number;
  frequency: number;
  reach: number;
  conversions: number;
}

// ─────────────────────────────────────────────
// Objective-Based Benchmark Config
// Calibrated from real Facebook Ads Manager data
// (1 Tháng 3 – 24 Tháng 3, 2026)
// ─────────────────────────────────────────────

interface ObjectiveBenchmark {
  cpc: { warning: number; critical: number };
  ctr: { warning: number; critical: number };
  frequency: { warning: number; critical: number };
  ctr_drop_pct: { warning: number; critical: number };
  cpm_increase_pct: { warning: number; critical: number };
  primary_metric: string;
}

export const FATIGUE_BENCHMARKS: Record<string, ObjectiveBenchmark> = {
  // ── PURCHASE + COMPLETE_REGISTRATION ──
  // Objective: OUTCOME_SALES
  // Kill rule: CPC > ₫35K sau 3 ngày
  // Real data: CPC per lead ~33K, Frequency 2.0, CTR(all) 5.52%
  OUTCOME_SALES: {
    cpc: {
      warning: 35000 * 0.6, // ₫21,000 — 60% of kill threshold
      critical: 35000, //       ₫35,000 — kill threshold
    },
    ctr: {
      warning: 0.4, //  % — dưới mức bình thường Sales
      critical: 0.2,
    },
    frequency: {
      warning: 2.5,
      critical: 3.0, // ngưỡng thực tế
    },
    ctr_drop_pct: {
      warning: 10,
      critical: 20,
    },
    cpm_increase_pct: {
      warning: 20,
      critical: 40,
    },
    primary_metric: "CPC",
  },

  // ── LINK CLICKS / TRAFFIC ──
  // Real data: CPC link 762đ-2.7Kđ (content), 17K-39K (domain sales)
  // CTR link: 0.14%-1.82%
  // Average CPC across all: 5,108đ, CTR: 0.57%
  OUTCOME_TRAFFIC: {
    cpc: {
      warning: 15000, //  ₫15,000 — content campaigns normal at 1-3K, domain at 17-25K
      critical: 30000, // ₫30,000 — approaching domain kill zone
    },
    ctr: {
      warning: 0.3, //  % — real data median around 0.58%
      critical: 0.15,
    },
    frequency: {
      warning: 3.0,
      critical: 4.0,
    },
    ctr_drop_pct: {
      warning: 15,
      critical: 30,
    },
    cpm_increase_pct: {
      warning: 25,
      critical: 50,
    },
    primary_metric: "CTR",
  },

  // Alias for LINK_CLICK campaigns
  LINK_CLICKS: {
    cpc: {
      warning: 15000,
      critical: 30000,
    },
    ctr: {
      warning: 0.3,
      critical: 0.15,
    },
    frequency: {
      warning: 3.0,
      critical: 4.0,
    },
    ctr_drop_pct: {
      warning: 15,
      critical: 30,
    },
    cpm_increase_pct: {
      warning: 25,
      critical: 50,
    },
    primary_metric: "CTR",
  },

  // ── ENGAGEMENT / TƯƠNG TÁC ──
  // Real data: Video Coffee House CTR 12.28%, CPC 465đ, CPM 57K
  OUTCOME_ENGAGEMENT: {
    cpc: {
      warning: 5000,
      critical: 10000,
    },
    ctr: {
      warning: 1.0,
      critical: 0.5,
    },
    frequency: {
      warning: 3.0,
      critical: 4.5,
    },
    ctr_drop_pct: {
      warning: 15,
      critical: 30,
    },
    cpm_increase_pct: {
      warning: 25,
      critical: 50,
    },
    primary_metric: "CTR",
  },

  // ── VIDEO VIEWS ──
  VIDEO_VIEWS: {
    cpc: { warning: 99999, critical: 99999 }, // không đo CPC
    ctr: { warning: 99999, critical: 99999 }, // không đo CTR
    frequency: {
      warning: 4.0,
      critical: 6.0,
    },
    ctr_drop_pct: {
      warning: 20,
      critical: 40,
    },
    cpm_increase_pct: {
      warning: 30,
      critical: 50,
    },
    primary_metric: "THRUPLAY",
  },

  // ── REACH ──
  REACH: {
    cpc: { warning: 99999, critical: 99999 },
    ctr: { warning: 99999, critical: 99999 },
    frequency: {
      warning: 4.0,
      critical: 6.0,
    },
    ctr_drop_pct: {
      warning: 20,
      critical: 40,
    },
    cpm_increase_pct: {
      warning: 30,
      critical: 60,
    },
    primary_metric: "FREQUENCY",
  },
};

// ─────────────────────────────────────────────
// Objective Resolver
// Maps Facebook objective strings to our benchmark keys
// ─────────────────────────────────────────────

function resolveObjective(objective: string): string {
  const obj = (objective || "").toUpperCase().replace(/\s+/g, "_");
  // Direct match
  if (FATIGUE_BENCHMARKS[obj]) return obj;

  // Facebook API objective mapping
  if (obj.includes("SALES") || obj.includes("CONVERSION") || obj.includes("PURCHASE") || obj.includes("REGISTRATION"))
    return "OUTCOME_SALES";
  if (obj.includes("TRAFFIC") || obj.includes("LINK_CLICK") || obj.includes("CLICK"))
    return "OUTCOME_TRAFFIC";
  if (obj.includes("ENGAGEMENT") || obj.includes("POST_ENGAGEMENT") || obj.includes("TƯƠNG_TÁC"))
    return "OUTCOME_ENGAGEMENT";
  if (obj.includes("VIDEO") || obj.includes("THRUPLAY"))
    return "VIDEO_VIEWS";
  if (obj.includes("REACH") || obj.includes("AWARENESS"))
    return "REACH";

  // Default fallback
  return "OUTCOME_SALES";
}

// ─────────────────────────────────────────────
// Math Helpers
// ─────────────────────────────────────────────

function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

/** Calculate % CTR drop over last N consecutive days */
function calcCTRDropConsecutive(days: DailyInsight[], consecutiveDays: number): number {
  if (days.length < consecutiveDays + 1) return 0;
  const recent = days.slice(-consecutiveDays - 1);
  let maxDrop = 0;

  for (let i = 1; i < recent.length; i++) {
    const prevCtr = recent[i - 1].ctr;
    const currCtr = recent[i].ctr;
    if (prevCtr > 0) {
      const drop = ((prevCtr - currCtr) / prevCtr) * 100;
      maxDrop = Math.max(maxDrop, drop);
    }
  }

  // Also check overall half-to-half drop
  const firstHalf = average(recent.slice(0, Math.ceil(recent.length / 2)).map((d) => d.ctr));
  const secondHalf = average(recent.slice(Math.ceil(recent.length / 2)).map((d) => d.ctr));
  if (firstHalf > 0) {
    const overallDrop = ((firstHalf - secondHalf) / firstHalf) * 100;
    maxDrop = Math.max(maxDrop, overallDrop);
  }

  return Math.max(0, maxDrop);
}

function fmt(v: number): string {
  return Math.round(v).toLocaleString("vi-VN");
}

// ─────────────────────────────────────────────
// Full Fatigue Detection (with daily insights)
// ─────────────────────────────────────────────

export function detectAdFatigue(
  campaign: Campaign,
  last7Days: DailyInsight[],
  last14Days: DailyInsight[],
  t: TFunction = makeT("vi")
): FatigueAnalysis {
  const objectiveKey = resolveObjective(campaign.objective);
  const bm = FATIGUE_BENCHMARKS[objectiveKey];
  const signals: FatigueSignal[] = [];
  let score = 0;

  // ── SIGNAL 1: CPC vượt ngưỡng (weight 35%) ──
  if (bm.cpc.critical < 99999) {
    const avgCPC = last7Days.length > 0
      ? average(last7Days.map((d) => d.cpc))
      : campaign.metrics.cpc;

    if (avgCPC >= bm.cpc.critical) {
      score += 35;
      signals.push({
        type: "cpc_critical",
        value: avgCPC,
        threshold: bm.cpc.critical,
        weight: 0.35,
        severity: "critical",
        description: t("libcase.r.fat.1", { v1: fmt(avgCPC), v2: fmt(bm.cpc.critical) }),
        action: t("libcase.r.fat.2"),
      });
    } else if (avgCPC >= bm.cpc.warning) {
      score += 18;
      signals.push({
        type: "cpc_warning",
        value: avgCPC,
        threshold: bm.cpc.warning,
        weight: 0.18,
        severity: "warning",
        description: t("libcase.r.fat.3", { v1: fmt(avgCPC), v2: fmt(bm.cpc.critical) }),
        action: t("libcase.r.fat.4"),
      });
    }
  }

  // ── SIGNAL 2: Frequency + CTR giảm combo (weight 35%) ──
  const avgFreq = last7Days.length > 0
    ? average(last7Days.map((d) => d.frequency))
    : campaign.metrics.frequency ?? 0;
  const ctrDrop = last7Days.length >= 4
    ? calcCTRDropConsecutive(last7Days, 3)
    : 0;

  if (
    avgFreq >= bm.frequency.critical &&
    ctrDrop >= bm.ctr_drop_pct.critical
  ) {
    score += 35;
    signals.push({
      type: "freq_ctr_critical",
      value: avgFreq,
      threshold: bm.frequency.critical,
      weight: 0.35,
      severity: "critical",
      description: t("libcase.r.fat.5", { v1: avgFreq.toFixed(1), v2: ctrDrop.toFixed(0) }),
      action: t("libcase.r.fat.6"),
    });
  } else if (
    avgFreq >= bm.frequency.warning &&
    ctrDrop >= bm.ctr_drop_pct.warning
  ) {
    score += 20;
    signals.push({
      type: "freq_ctr_warning",
      value: avgFreq,
      threshold: bm.frequency.warning,
      weight: 0.2,
      severity: "warning",
      description: t("libcase.r.fat.7", { v1: avgFreq.toFixed(1), v2: ctrDrop.toFixed(0) }),
      action: t("libcase.r.fat.8"),
    });
  } else if (avgFreq >= bm.frequency.critical) {
    // Only frequency is high (no CTR drop data) — still worth noting
    score += 15;
    signals.push({
      type: "freq_ctr_warning",
      value: avgFreq,
      threshold: bm.frequency.critical,
      weight: 0.15,
      severity: "warning",
      description: t("libcase.r.fat.9", { v1: avgFreq.toFixed(1), v2: bm.frequency.critical }),
      action: t("libcase.r.fat.10"),
    });
  }

  // ── SIGNAL 3: CTR tuyệt đối thấp (weight 20%) ──
  if (bm.ctr.critical < 99999) {
    const avgCTR = last7Days.length > 0
      ? average(last7Days.map((d) => d.ctr))
      : campaign.metrics.ctr;

    if (avgCTR < bm.ctr.critical && campaign.metrics.impressions > 5000) {
      score += 20;
      signals.push({
        type: "ctr_low",
        value: avgCTR,
        threshold: bm.ctr.critical,
        weight: 0.2,
        severity: "critical",
        description: t("libcase.r.fat.11", { v1: avgCTR.toFixed(2), v2: bm.ctr.critical }),
        action: t("libcase.r.fat.12"),
      });
    } else if (avgCTR < bm.ctr.warning && campaign.metrics.impressions > 5000) {
      score += 10;
      signals.push({
        type: "ctr_declining",
        value: avgCTR,
        threshold: bm.ctr.warning,
        weight: 0.1,
        severity: "warning",
        description: t("libcase.r.fat.13", { v1: avgCTR.toFixed(2), v2: bm.ctr.warning }),
      });
    }
  }

  // ── SIGNAL 4: CPM tăng — audience đắt dần (weight 10%) ──
  if (last14Days.length >= 10) {
    const prevWeek = last14Days.slice(0, 7);
    const thisWeek = last14Days.slice(7);
    const cpmThisWeek = average(thisWeek.map((d) => d.cpm));
    const cpmLastWeek = average(prevWeek.map((d) => d.cpm));
    const cpmIncrease = pctChange(cpmThisWeek, cpmLastWeek);

    if (cpmIncrease >= bm.cpm_increase_pct.critical) {
      score += 10;
      signals.push({
        type: "cpm_rising",
        value: cpmIncrease,
        threshold: bm.cpm_increase_pct.critical,
        weight: 0.1,
        severity: "warning",
        description: t("libcase.r.fat.14", { v1: cpmIncrease.toFixed(0) }),
      });
    } else if (cpmIncrease >= bm.cpm_increase_pct.warning) {
      score += 5;
      signals.push({
        type: "cpm_rising",
        value: cpmIncrease,
        threshold: bm.cpm_increase_pct.warning,
        weight: 0.05,
        severity: "info",
        description: t("libcase.r.fat.15", { v1: cpmIncrease.toFixed(0) }),
      });
    }
  }

  // ── CLASSIFY ──
  const fatigueLevel: FatigueLevel =
    score >= 65
      ? "critical"
      : score >= 40
        ? "fatigued"
        : score >= 20
          ? "warning"
          : "healthy";

  // ── DỰ BÁO còn bao nhiêu ngày ──
  const estimatedDaysLeft =
    score < 20
      ? 999
      : score < 40
        ? Math.max(5, Math.floor((100 - score) / 5))
        : score < 65
          ? Math.max(2, Math.floor((100 - score) / 8))
          : Math.max(1, Math.floor((100 - score) / 12));

  const recommendedAction = getRecommendation(fatigueLevel, signals, objectiveKey, bm, t);

  const urgency: FatigueUrgency =
    fatigueLevel === "critical"
      ? "immediate"
      : fatigueLevel === "fatigued"
        ? "today"
        : fatigueLevel === "warning"
          ? "this_week"
          : "none";

  return {
    fatigueScore: Math.round(Math.min(100, score)),
    fatigueLevel,
    signals,
    estimatedDaysLeft,
    recommendedAction,
    urgency,
    objective: objectiveKey,
    benchmarkUsed: bm.primary_metric,
  };
}

// ─────────────────────────────────────────────
// Quick Fatigue Check (from campaign metrics only)
// Used when daily insights are not available
// ─────────────────────────────────────────────

export function quickFatigueCheck(campaign: Campaign, t: TFunction = makeT("vi")): FatigueAnalysis {
  const m = campaign.metrics;
  const objectiveKey = resolveObjective(campaign.objective);
  const bm = FATIGUE_BENCHMARKS[objectiveKey];

  const signals: FatigueSignal[] = [];
  let totalScore = 0;

  // ── CPC signal (weight: 35%) ──
  if (bm.cpc.critical < 99999) {
    if (m.cpc >= bm.cpc.critical) {
      const score = 35;
      totalScore += score;
      signals.push({
        type: "cpc_critical",
        value: m.cpc,
        threshold: bm.cpc.critical,
        weight: 0.35,
        severity: "critical",
        description: t("libcase.r.fat.16", { v1: fmt(m.cpc), v2: fmt(bm.cpc.critical) }),
        action: t("libcase.r.fat.2"),
      });
    } else if (m.cpc >= bm.cpc.warning) {
      const score = 18;
      totalScore += score;
      signals.push({
        type: "cpc_warning",
        value: m.cpc,
        threshold: bm.cpc.warning,
        weight: 0.18,
        severity: "warning",
        description: t("libcase.r.fat.17", { v1: fmt(m.cpc), v2: fmt(bm.cpc.critical) }),
        action: t("libcase.r.fat.4"),
      });
    }
  }

  // ── Frequency signal (weight: 25% when standalone) ──
  const freq = m.frequency ?? 0;
  if (freq >= bm.frequency.critical) {
    const score = Math.min(25, (freq - bm.frequency.critical) * 10 + 15);
    totalScore += score;
    signals.push({
      type: "freq_ctr_warning",
      value: freq,
      threshold: bm.frequency.critical,
      weight: 0.25,
      severity: freq >= bm.frequency.critical + 1 ? "critical" : "warning",
      description: t("libcase.r.fat.18", { v1: freq.toFixed(1), v2: bm.frequency.critical }),
      action: t("libcase.r.fat.19"),
    });
  } else if (freq >= bm.frequency.warning) {
    const score = Math.min(12, (freq - bm.frequency.warning) * 8 + 5);
    totalScore += score;
    signals.push({
      type: "freq_ctr_warning",
      value: freq,
      threshold: bm.frequency.warning,
      weight: 0.12,
      severity: "warning",
      description: t("libcase.r.fat.20", { v1: freq.toFixed(1) }),
    });
  }

  // ── CTR signal (weight: 20%) ──
  if (bm.ctr.critical < 99999 && m.impressions > 5000) {
    if (m.ctr < bm.ctr.critical) {
      const score = 20;
      totalScore += score;
      signals.push({
        type: "ctr_low",
        value: m.ctr,
        threshold: bm.ctr.critical,
        weight: 0.2,
        severity: "critical",
        description: t("libcase.r.fat.21", { v1: m.ctr.toFixed(2), v2: bm.ctr.critical }),
        action: t("libcase.r.fat.22"),
      });
    } else if (m.ctr < bm.ctr.warning) {
      const score = 10;
      totalScore += score;
      signals.push({
        type: "ctr_declining",
        value: m.ctr,
        threshold: bm.ctr.warning,
        weight: 0.1,
        severity: "warning",
        description: t("libcase.r.fat.23", { v1: m.ctr.toFixed(2), v2: bm.ctr.warning }),
      });
    }
  }

  // ── CPM signal (weight: 10%) ──
  if (m.cpm > 50000) {
    const cpmScore = Math.min(10, ((m.cpm - 50000) / 50000) * 10);
    totalScore += cpmScore;
    signals.push({
      type: "cpm_rising",
      value: m.cpm,
      threshold: 50000,
      weight: 0.1,
      severity: "warning",
      description: t("libcase.r.fat.24", { v1: fmt(m.cpm) }),
    });
  }

  // ── CPL signal (weight: 15%) — company-specific ──
  if (m.conversions > 0) {
    const cpl = m.spend / m.conversions;
    const company = getCompany(campaign.name) || "MBC";
    const cplThresholds = company === "MBI"
      ? { warning: 250000, critical: 320000 }
      : { warning: 99000, critical: 130000 };

    if (cpl > cplThresholds.critical) {
      totalScore += 15;
      signals.push({
        type: "cpc_critical", // reuse type for display
        value: cpl,
        threshold: cplThresholds.critical,
        weight: 0.15,
        severity: "critical",
        description: t("libcase.r.fat.25", { v1: fmt(cpl), v2: fmt(cplThresholds.critical), v3: company }),
        action: t("libcase.r.fat.26"),
      });
    } else if (cpl > cplThresholds.warning) {
      totalScore += 8;
      signals.push({
        type: "cpc_warning",
        value: cpl,
        threshold: cplThresholds.warning,
        weight: 0.08,
        severity: "warning",
        description: t("libcase.r.fat.27", { v1: fmt(cpl), v2: fmt(cplThresholds.warning), v3: company }),
        action: t("libcase.r.fat.28"),
      });
    }
  }

  const fatigueLevel: FatigueLevel =
    totalScore >= 65
      ? "critical"
      : totalScore >= 40
        ? "fatigued"
        : totalScore >= 20
          ? "warning"
          : "healthy";

  const estimatedDaysLeft =
    totalScore < 20 ? 999 : Math.max(1, Math.floor((100 - totalScore) / 7));

  const urgency: FatigueUrgency =
    fatigueLevel === "critical"
      ? "immediate"
      : fatigueLevel === "fatigued"
        ? "today"
        : fatigueLevel === "warning"
          ? "this_week"
          : "none";

  return {
    fatigueScore: Math.round(Math.min(100, totalScore)),
    fatigueLevel,
    signals,
    estimatedDaysLeft,
    recommendedAction: getRecommendation(fatigueLevel, signals, objectiveKey, bm, t),
    urgency,
    objective: objectiveKey,
    benchmarkUsed: bm.primary_metric,
  };
}

// ─────────────────────────────────────────────
// Recommendation Engine
// ─────────────────────────────────────────────

function getRecommendation(
  level: FatigueLevel,
  signals: FatigueSignal[],
  objectiveKey: string,
  bm: ObjectiveBenchmark,
  t: TFunction = makeT("vi")
): string {
  const hasCPCKill = signals.some((s) => s.type === "cpc_critical");
  const hasFreqCTR = signals.some(
    (s) => s.type === "freq_ctr_critical" && s.severity === "critical"
  );

  if (level === "critical") {
    if (hasCPCKill) {
      return t("libcase.r.fat.29", { v1: fmt(bm.cpc.critical) });
    }
    if (hasFreqCTR) {
      return t("libcase.r.fat.30");
    }
    return t("libcase.r.fat.31");
  }
  if (level === "fatigued") {
    return t("libcase.r.fat.32");
  }
  if (level === "warning") {
    return t("libcase.r.fat.33");
  }
  return t("libcase.r.fat.34");
}

// ─────────────────────────────────────────────
// Fatigue Badge Config
// ─────────────────────────────────────────────

export const FATIGUE_BADGES: Record<
  FatigueLevel,
  { emoji: string; label: string; bg: string; text: string; border: string }
> = {
  healthy: {
    emoji: "💪",
    label: "Khoẻ",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
  },
  warning: {
    emoji: "👀",
    label: "Theo dõi",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
  },
  fatigued: {
    emoji: "😓",
    label: "Đang mệt",
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-200",
  },
  critical: {
    emoji: "🔥",
    label: "Bão hoà!",
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
  },
};

// ─────────────────────────────────────────────
// Objective Labels (for UI display)
// ─────────────────────────────────────────────

export const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_SALES: "Sales / Registration",
  OUTCOME_TRAFFIC: "Traffic / Link Clicks",
  LINK_CLICKS: "Traffic / Link Clicks",
  OUTCOME_ENGAGEMENT: "Engagement / Tương tác",
  VIDEO_VIEWS: "Video Views",
  REACH: "Reach / Awareness",
};

/** Nhãn huy hiệu theo ngôn ngữ (FATIGUE_BADGES giữ tiếng Việt). */
export const fatigueBadgeLabel = (level: FatigueLevel, t: TFunction = makeT("vi")): string => t(`libcase.r.fatbadge.${level}` as never);
/** Nhãn mục tiêu theo ngôn ngữ — chỉ nhãn "Engagement / Tương tác" cần dịch. */
export const objectiveLabel = (key: string, t: TFunction = makeT("vi")): string =>
  key === "OUTCOME_ENGAGEMENT" ? t("libcase.r.fatobj.engagement") : (OBJECTIVE_LABELS[key] ?? key);
