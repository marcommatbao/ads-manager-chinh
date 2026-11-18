import type { TFunction } from "@/lib/i18n/translate";
import { forecastMonthlySpend, type SpendForecast } from "@/lib/spend-forecaster";

export type ForecastConfidence = "high" | "medium" | "low" | "insufficient";
export type ForecastBudgetKind = "account_balance" | "campaign_budget" | "internal_kpi";

export interface ForecastQuality {
  confidence: ForecastConfidence;
  minDaysRequired: number;
  observedDays: number;
  source: string;
  from: string;
  to: string;
  readAt: string;
  reason: string;
}

export interface ReliableSpendForecast extends SpendForecast {
  quality: ForecastQuality;
  budgetKind: ForecastBudgetKind;
  forecastAllowed: boolean;
}

export interface ForecastInput {
  dailySpends: number[];
  monthlyBudget: number | null;
  budgetKind: ForecastBudgetKind;
  source: string;
  from: string;
  to: string;
  readAt?: string;
  now?: Date;
  t?: TFunction;
}

const MIN_DAYS_FOR_FORECAST = 3;

export function forecastWithQuality(input: ForecastInput): ReliableSpendForecast {
  const observedDays = input.dailySpends.filter(Number.isFinite).length;
  const readAt = input.readAt ?? new Date().toISOString();
  const now = input.now ?? new Date();
  const base = forecastMonthlySpend(
    input.dailySpends.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0),
    input.monthlyBudget ?? 0,
    now,
    input.t,
  );

  const usableBudget = input.monthlyBudget !== null && Number.isFinite(input.monthlyBudget) && input.monthlyBudget > 0;
  const forecastAllowed = observedDays >= MIN_DAYS_FOR_FORECAST && usableBudget;
  const confidence: ForecastConfidence = !forecastAllowed
    ? "insufficient"
    : observedDays >= 14 ? "high" : observedDays >= 7 ? "medium" : "low";

  return {
    ...base,
    quality: {
      confidence,
      minDaysRequired: MIN_DAYS_FOR_FORECAST,
      observedDays,
      source: input.source,
      from: input.from,
      to: input.to,
      readAt,
      reason: !usableBudget
        ? "Thiếu ngân sách tháng hợp lệ; không thể so với trần ngân sách."
        : observedDays < MIN_DAYS_FOR_FORECAST
          ? `Chỉ có ${observedDays}/${MIN_DAYS_FOR_FORECAST} ngày dữ liệu tối thiểu.`
          : "Đủ dữ liệu tối thiểu để dự báo.",
    },
    budgetKind: input.budgetKind,
    forecastAllowed,
  };
}
