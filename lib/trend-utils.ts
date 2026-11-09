import { makeT, type TFunction } from "@/lib/i18n/translate"
// ============================================================
// lib/trend-utils.ts
// Period-over-period comparison utilities for Reports
// ============================================================

// Metrics where higher = better
const GOOD_WHEN_UP   = new Set(["ctr", "roas", "clicks", "impressions", "reach", "revenue"]);
// Metrics where lower = better
const GOOD_WHEN_DOWN = new Set(["cpc", "cpm", "frequency", "spend"]);
// Neutral: "spend" depends on context so we make it neutral below

export interface TrendChange {
  pct: number;               // rounded to 1 dp
  direction: "up" | "down";
  isGood: boolean | null;    // true=good, false=bad, null=neutral
  prevValue: number;
  currValue: number;
}

/** Calculate % change from `prev` to `curr` for a given metric key */
export function calcChange(
  curr: number,
  prev: number,
  metric: string
): TrendChange | null {
  if (!prev || prev === 0) return null;
  const raw = ((curr - prev) / prev) * 100;
  const pct = Math.round(raw * 10) / 10;
  const direction: "up" | "down" = pct >= 0 ? "up" : "down";

  let isGood: boolean | null = null;
  if (GOOD_WHEN_UP.has(metric))   isGood = pct > 0;
  if (GOOD_WHEN_DOWN.has(metric)) isGood = pct < 0;

  return { pct, direction, isGood, prevValue: prev, currValue: curr };
}

/** Shift date range back by the same number of days */
export function getPreviousPeriod(from: string, to: string): { from: string; to: string } {
  const fromMs = new Date(from).getTime();
  const toMs   = new Date(to).getTime();
  const days   = Math.round((toMs - fromMs) / 86400000) + 1;
  const prevTo   = new Date(fromMs - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
  return {
    from: prevFrom.toISOString().split("T")[0],
    to:   prevTo.toISOString().split("T")[0],
  };
}

/** Human-readable label for the comparison period */
export function getPeriodLabel(from: string, to: string, t: TFunction = makeT("vi")): string {
  const days = Math.round(
    (new Date(to).getTime() - new Date(from).getTime()) / 86400000
  ) + 1;
  if (days === 7) return t("libcase.trend.vs7");
  if (days === 30) return t("libcase.trend.vs30");
  return t("libcase.trend.vsEq");
}

/** Format a date string "YYYY-MM-DD" → "DD/MM" */
export function fmtPeriod(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}
