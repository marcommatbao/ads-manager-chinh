// ============================================================
// AdsCommand — Anomaly Detector
// Detects outliers by comparing today vs 7-day baseline
// ============================================================

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

import { makeT, type TFunction } from "@/lib/i18n/translate";

export interface DailyMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  roas: number;
  conversions: number;
  frequency: number;
  cpl: number;
}

export type AnomalySeverity = "critical" | "warning" | "info";

export interface Anomaly {
  metric: string;
  label: string;
  todayValue: number;
  baselineValue: number;
  changePct: number;         // e.g. +42 or -35
  severity: AnomalySeverity;
  direction: "increase" | "decrease";
  description: string;
  possibleCauses: string[];
}

// ─────────────────────────────────────────────
// Anomaly check configuration
// ─────────────────────────────────────────────

interface AnomalyCheck {
  metric: keyof DailyMetrics;
  label: string;
  threshold: number;        // fraction — 0.4 = 40%
  direction: "increase" | "decrease";
  severity: AnomalySeverity;
}

const ANOMALY_CHECKS: AnomalyCheck[] = [
  {
    metric: "cpc",
    label: "CPC",
    threshold: 0.4,
    direction: "increase",
    severity: "warning",
  },
  {
    metric: "impressions",
    label: "Lượt hiển thị",
    threshold: 0.5,
    direction: "decrease",
    severity: "critical",
  },
  {
    metric: "ctr",
    label: "CTR",
    threshold: 0.3,
    direction: "decrease",
    severity: "warning",
  },
  {
    metric: "spend",
    label: "Chi tiêu",
    threshold: 0.6,
    direction: "increase",
    severity: "warning",
  },
  {
    metric: "roas",
    label: "ROAS",
    threshold: 0.4,
    direction: "decrease",
    severity: "critical",
  },
  {
    metric: "frequency",
    label: "Frequency",
    threshold: 0.5,
    direction: "increase",
    severity: "warning",
  },
  {
    metric: "cpm",
    label: "CPM",
    threshold: 0.4,
    direction: "increase",
    severity: "info",
  },
  {
    metric: "cpl",
    label: "CPL",
    threshold: 0.3,
    direction: "increase",
    severity: "critical",
  },
];

// ─────────────────────────────────────────────
// Possible causes lookup
// ─────────────────────────────────────────────

function getPossibleCauses(metric: string, direction: string, t: TFunction = makeT("vi")): string[] {
  const causes: Record<string, Record<string, string[]>> = {
    cpc: {
      increase: [
        t("libcase.r.anom.1"),
        t("libcase.r.anom.2"),
        t("libcase.r.anom.3"),
        t("libcase.r.anom.4"),
      ],
      decrease: [
        t("libcase.r.anom.5"),
        t("libcase.r.anom.6"),
      ],
    },
    impressions: {
      decrease: [
        t("libcase.r.anom.7"),
        t("libcase.r.anom.8"),
        t("libcase.r.anom.9"),
        t("libcase.r.anom.10"),
        t("libcase.r.anom.11"),
      ],
      increase: [
        t("libcase.r.anom.12"),
        t("libcase.r.anom.13"),
      ],
    },
    ctr: {
      decrease: [
        t("libcase.r.anom.14"),
        t("libcase.r.anom.15"),
        t("libcase.r.anom.16"),
        t("libcase.r.anom.17"),
      ],
      increase: [
        t("libcase.r.anom.18"),
        t("libcase.r.anom.19"),
      ],
    },
    spend: {
      increase: [
        t("libcase.r.anom.20"),
        t("libcase.r.anom.21"),
        t("libcase.r.anom.22"),
      ],
      decrease: [
        t("libcase.r.anom.23"),
        "Fewer auction wins do to competitor pressure",
      ],
    },
    roas: {
      decrease: [
        t("libcase.r.anom.24"),
        t("libcase.r.anom.25"),
        t("libcase.r.anom.26"),
        t("libcase.r.anom.27"),
      ],
      increase: [
        t("libcase.r.anom.28"),
        t("libcase.r.anom.29"),
      ],
    },
    frequency: {
      increase: [
        t("libcase.r.anom.30"),
        t("libcase.r.anom.31"),
        t("libcase.r.anom.32"),
      ],
      decrease: [
        t("libcase.r.anom.33"),
      ],
    },
    cpm: {
      increase: [
        t("libcase.r.anom.34"),
        t("libcase.r.anom.35"),
        t("libcase.r.anom.36"),
      ],
      decrease: [
        t("libcase.r.anom.37"),
        t("libcase.r.anom.38"),
      ],
    },
    cpl: {
      increase: [
        t("libcase.r.anom.39"),
        t("libcase.r.anom.40"),
        t("libcase.r.anom.41"),
        t("libcase.r.anom.42"),
        t("libcase.r.anom.43"),
      ],
      decrease: [
        t("libcase.r.anom.44"),
        t("libcase.r.anom.45"),
      ],
    },
  };

  return causes[metric]?.[direction] ?? [t("libcase.r.anom.46")];
}

// ─────────────────────────────────────────────
// Calculate baseline from historical data
// ─────────────────────────────────────────────

export function calculateBaseline(historicalDays: DailyMetrics[]): DailyMetrics {
  const n = historicalDays.length;
  if (n === 0) {
    return { spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, cpm: 0, roas: 0, conversions: 0, frequency: 0, cpl: 0 };
  }

  const sum = (fn: (d: DailyMetrics) => number) => historicalDays.reduce((s, d) => s + fn(d), 0);

  return {
    spend: sum(d => d.spend) / n,
    impressions: sum(d => d.impressions) / n,
    clicks: sum(d => d.clicks) / n,
    ctr: sum(d => d.ctr) / n,
    cpc: sum(d => d.cpc) / n,
    cpm: sum(d => d.cpm) / n,
    roas: sum(d => d.roas) / n,
    conversions: sum(d => d.conversions) / n,
    frequency: sum(d => d.frequency) / n,
    cpl: sum(d => d.cpl) / n,
  };
}

// ─────────────────────────────────────────────
// Main detector
// ─────────────────────────────────────────────

export function detectAnomalies(
  todayMetrics: DailyMetrics,
  historicalMetrics: DailyMetrics[],
  t: TFunction = makeT("vi")
): Anomaly[] {
  const anomalies: Anomaly[] = [];

  if (historicalMetrics.length === 0) return anomalies;

  const baseline = calculateBaseline(historicalMetrics);

  for (const check of ANOMALY_CHECKS) {
    const todayVal = todayMetrics[check.metric];
    const baselineVal = baseline[check.metric];

    // Skip if baseline is 0 or near-zero (can't compute meaningful change)
    if (baselineVal === 0 || Math.abs(baselineVal) < 0.001) continue;

    const changePct = (todayVal - baselineVal) / baselineVal;

    const isAnomaly =
      check.direction === "increase"
        ? changePct > check.threshold
        : changePct < -check.threshold;

    if (isAnomaly) {
      const label = check.metric === "impressions" ? t("libcase.r.anom.impr") : check.metric === "spend" ? t("libcase.r.anom.spend") : check.label;
      const arrow = check.direction === "increase" ? t("libcase.r.anom.47") : t("libcase.r.anom.48");
      const absPct = Math.abs(Math.round(changePct * 100));

      anomalies.push({
        metric: check.metric,
        label,
        todayValue: todayVal,
        baselineValue: baselineVal,
        changePct: Math.round(changePct * 100),
        severity: check.severity,
        direction: changePct > 0 ? "increase" : "decrease",
        description: t("libcase.r.anom.49", { v1: label, v2: arrow, v3: absPct }),
        possibleCauses: getPossibleCauses(check.metric, check.direction, t),
      });
    }
  }

  // Sort: critical first, then warning, then info
  const severityOrder: Record<AnomalySeverity, number> = { critical: 0, warning: 1, info: 2 };
  anomalies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return anomalies;
}

// ─────────────────────────────────────────────
// Severity helpers (for UI)
// ─────────────────────────────────────────────

export const SEVERITY_CONFIG: Record<AnomalySeverity, { icon: string; color: string; bg: string; border: string; label: string }> = {
  critical: { icon: "🔴", color: "text-red-700", bg: "bg-red-50", border: "border-red-200", label: "Nghiêm trọng" },
  warning:  { icon: "🟡", color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", label: "Cảnh báo" },
  info:     { icon: "🔵", color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200", label: "Thông tin" },
};

/** Nhãn mức độ theo ngôn ngữ (SEVERITY_CONFIG giữ tiếng Việt). */
export const severityLabel = (s: AnomalySeverity, t: TFunction = makeT("vi")): string => t(`libcase.r.sev.${s}` as never);
