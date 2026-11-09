// ============================================================
// AdsCommand — Spend Forecaster
// Monthly spend projection & budget recommendations
// ============================================================

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

import { makeT, type TFunction } from "@/lib/i18n/translate";
import { fmtVND } from "@/lib/budget-redistributor.shared";

export type SpendTrend = "over" | "under" | "on_track";

export interface SpendForecast {
  spentSoFar: number;
  dailyAverage: number;
  daysElapsed: number;
  daysLeft: number;
  totalDaysInMonth: number;
  forecastTotal: number;
  forecastFormatted: string;
  progressPct: number;           // 0-100 — how much of month elapsed
  spendProgressPct: number;      // 0-100 — spend vs budget
  trend: SpendTrend;
  overUnderAmount: number;
  recommendation: string;
  monthLabel: string;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function formatCurrencyVN(val: number, t: TFunction = makeT("vi")): string {
  return fmtVND(val, t);
}


// ─────────────────────────────────────────────
// Main forecaster
// ─────────────────────────────────────────────

export function forecastMonthlySpend(
  monthSoFar: number,
  monthlyBudget: number,
  now?: Date,
  t: TFunction = makeT("vi")
): SpendForecast {
  const d = now ?? new Date();
  const year = d.getFullYear();
  const month = d.getMonth();
  const totalDays = getDaysInMonth(year, month);
  const daysElapsed = d.getDate();
  const daysLeft = totalDays - daysElapsed;

  // Daily average (avoid div by zero)
  const dailyAvg = daysElapsed > 0 ? monthSoFar / daysElapsed : 0;

  // Forecast
  const forecastTotal = monthSoFar + (dailyAvg * daysLeft);

  // Progress
  const progressPct = Math.round((daysElapsed / totalDays) * 100);
  const spendProgressPct = monthlyBudget > 0
    ? Math.min(Math.round((monthSoFar / monthlyBudget) * 100), 100)
    : 0;

  // Trend — allow 5% tolerance for "on_track"
  const tolerance = monthlyBudget * 0.05;
  let trend: SpendTrend;
  if (forecastTotal > monthlyBudget + tolerance) {
    trend = "over";
  } else if (forecastTotal < monthlyBudget - tolerance) {
    trend = "under";
  } else {
    trend = "on_track";
  }

  const overUnderAmount = Math.abs(forecastTotal - monthlyBudget);

  // Recommendation
  let recommendation: string;
  if (trend === "over") {
    const dailyCut = daysLeft > 0 ? overUnderAmount / daysLeft : overUnderAmount;
    recommendation = t("libcase.r.fc.cut", { amt: formatCurrencyVN(dailyCut, t) });
  } else if (trend === "under") {
    recommendation = t("libcase.r.fc.left", { amt: formatCurrencyVN(overUnderAmount, t) });
  } else {
    recommendation = t("libcase.r.fc.ok");
  }

  return {
    spentSoFar: monthSoFar,
    dailyAverage: dailyAvg,
    daysElapsed,
    daysLeft,
    totalDaysInMonth: totalDays,
    forecastTotal,
    forecastFormatted: formatCurrencyVN(forecastTotal, t),
    progressPct,
    spendProgressPct,
    trend,
    overUnderAmount,
    recommendation,
    monthLabel: `${t(`libcase.r.month.${month + 1}` as never)} ${year}`,
  };
}

// ─────────────────────────────────────────────
// Weight-adjusted forecast (recent days matter more)
// ─────────────────────────────────────────────

export function forecastWeighted(
  dailySpends: number[],   // array of daily spends, most recent last
  monthlyBudget: number,
  now?: Date,
  t: TFunction = makeT("vi")
): SpendForecast {
  const d = now ?? new Date();
  const totalDays = getDaysInMonth(d.getFullYear(), d.getMonth());
  const daysElapsed = d.getDate();
  const daysLeft = totalDays - daysElapsed;

  const monthSoFar = dailySpends.reduce((s, v) => s + v, 0);

  // Weighted average: last 3 days get 2x weight
  if (dailySpends.length >= 4) {
    const recent3 = dailySpends.slice(-3);
    const older = dailySpends.slice(0, -3);

    const recentAvg = recent3.reduce((s, v) => s + v, 0) / recent3.length;
    const olderAvg = older.length > 0 ? older.reduce((s, v) => s + v, 0) / older.length : recentAvg;

    const weightedDailyAvg = (recentAvg * 0.6) + (olderAvg * 0.4);
    const forecastTotal = monthSoFar + (weightedDailyAvg * daysLeft);

    const base = forecastMonthlySpend(monthSoFar, monthlyBudget, d, t);
    return {
      ...base,
      dailyAverage: weightedDailyAvg,
      forecastTotal,
      forecastFormatted: formatCurrencyVN(forecastTotal, t),
      overUnderAmount: Math.abs(forecastTotal - monthlyBudget),
    };
  }

  // Fallback to simple forecast
  return forecastMonthlySpend(monthSoFar, monthlyBudget, d, t);
}

// ─────────────────────────────────────────────
// Trend config (for UI)
// ─────────────────────────────────────────────

export const TREND_CONFIG: Record<SpendTrend, { icon: string; color: string; bg: string; border: string; label: string }> = {
  over:     { icon: "📈", color: "text-red-700", bg: "bg-red-50", border: "border-red-200", label: "Vượt budget" },
  under:    { icon: "📉", color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", label: "Dưới budget" },
  on_track: { icon: "✅", color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200", label: "Đúng kế hoạch" },
};

/** Nhãn xu hướng theo ngôn ngữ (TREND_CONFIG giữ tiếng Việt). */
export const trendLabel = (k: SpendTrend, t: TFunction = makeT("vi")): string => t(`libcase.r.fc.${k}` as never);
