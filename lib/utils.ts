// ============================================================
// AdsCommand — Shared Utility Functions
// ============================================================

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Campaign, ReportData } from "@/types/ads.types";
import { detectCompany } from "@/store/useAdsStore";
import type {
  MetaCampaignRaw,
  MetaInsightRaw,
  MetaAccountInsightRaw,
} from "@/lib/meta-client";

// ─────────────────────────────────────────────
// Tailwind class merge (shadcn/ui standard)
// ─────────────────────────────────────────────
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─────────────────────────────────────────────
// Currency Configuration
// ─────────────────────────────────────────────

export const CURRENCY_CONFIG: Record<string, {
  symbol: string;
  decimals: number;      // 0 for VND, 2 for USD
  divideBy: number;      // 1 for VND, 100 for USD (cents conversion)
  locale: string;
}> = {
  'VND': { symbol: '₫', decimals: 0, divideBy: 1, locale: 'vi-VN' },
  'USD': { symbol: '$', decimals: 2, divideBy: 100, locale: 'en-US' },
  'SGD': { symbol: 'S$', decimals: 2, divideBy: 100, locale: 'en-SG' },
  'THB': { symbol: '฿', decimals: 2, divideBy: 100, locale: 'th-TH' },
};

// ─────────────────────────────────────────────
// Number Formatters
// ─────────────────────────────────────────────

/**
 * Format a number as currency.
 * Handles the cents/minor-unit division automatically via CURRENCY_CONFIG.
 *
 * Usage:
 *   formatCurrency(150000, 'VND')  → "₫150,000"
 *   formatCurrency(1234,   'USD')  → "$12.34"  (divides by 100)
 *   formatCurrency(12.34,  'USD', false) → "$12.34" (already converted)
 *
 * @param value       - Raw value (cents for USD, full amount for VND)
 * @param currency    - ISO currency code
 * @param rawMinorUnit - If true (default), divide by config.divideBy.
 *                       Pass false if value is already in major units.
 */
export function formatCurrency(
  value: number,
  currency = "USD",
  rawMinorUnit = true,
  intlLocale = "vi-VN"
): string {
  const config = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG['USD'];
  const actualValue = rawMinorUnit ? value / config.divideBy : value;

  if (currency === 'VND') {
    // VND format: ₫150,000 (no decimals)
    return `₫${actualValue.toLocaleString(intlLocale, { maximumFractionDigits: 0 })}`;
  }

  return `${config.symbol}${actualValue
    .toFixed(config.decimals)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Auto-scale large numbers with VND-friendly suffixes.
 * 1_500_000_000 → "1.5T" (tỷ)
 * 2_300_000     → "2.3Tr" (triệu)
 * 45_300        → "45.3K"
 * 123           → "123"
 */
export function formatNumber(value: number, intlLocale = "vi-VN"): string {
  const en = !intlLocale.startsWith("vi"); // EN: B / M / K
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}${en ? "B" : "T"}`;
  if (value >= 1_000_000)     return `${(value / 1_000_000).toFixed(1)}${en ? "M" : "Tr"}`;
  if (value >= 1_000)         return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

/**
 * Format a ratio as a percentage string.
 * 2.4567 → "2.46%"  (decimals default: 2)
 */
export function formatPercent(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

// Legacy alias used in some components
export const formatPercentage = formatPercent;

/**
 * Format a ROAS value.
 * 3.2 → "3.2x"
 */
export function formatROAS(value: number): string {
  return `${value.toFixed(1)}x`;
}

// ─────────────────────────────────────────────
// Date Helpers
// ─────────────────────────────────────────────

function isoDate(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

/**
 * Convert a named preset to an ISO date range.
 * Supported: 'today' | 'last7' | 'last30' | 'thisMonth'
 */
export function getDateRange(preset: string): { from: string; to: string } {
  const today = isoDate(0);

  switch (preset) {
    case "today":
      return { from: today, to: today };

    case "last7":
      return { from: isoDate(6), to: today };

    case "last30":
      return { from: isoDate(29), to: today };

    case "thisMonth": {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split("T")[0];
      return { from, to: today };
    }

    default:
      return { from: isoDate(6), to: today };
  }
}

/**
 * Format an ISO date string for chart X-axis labels.
 * "2026-03-15" → "15/03"
 */
export function formatDateLabel(dateStr: string): string {
  const [, month, day] = dateStr.split("-");
  return `${day}/${month}`;
}

// Legacy alias
export const formatDate = formatDateLabel;

// ─────────────────────────────────────────────
// Meta Data Transformers
// ─────────────────────────────────────────────

/**
 * Extract total conversion/purchase count from Meta actions array.
 */
export function extractConversions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions: any[] | null | undefined
): number {
  if (!actions?.length) return 0;
  return actions
    .filter((a) =>
      ["purchase", "offsite_conversion.fb_pixel_purchase"].includes(a.action_type)
    )
    .reduce((sum, a) => sum + parseFloat(a.value ?? "0"), 0);
}

/**
 * Extract total purchase revenue from Meta action_values array.
 */
export function extractRevenue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actionValues: any[] | null | undefined
): number {
  if (!actionValues?.length) return 0;
  return actionValues
    .filter((a) =>
      ["purchase", "offsite_conversion.fb_pixel_purchase"].includes(a.action_type)
    )
    .reduce((sum, a) => sum + parseFloat(a.value ?? "0"), 0);
}

/**
 * Map a raw Meta campaign + optional insights → typed Campaign.
 */
export function transformMetaCampaign(
  raw: MetaCampaignRaw,
  insights?: MetaInsightRaw
): Campaign {
  const spend       = parseFloat(insights?.spend ?? "0");
  const clicks      = parseInt(insights?.clicks ?? "0", 10);
  const impressions = parseInt(insights?.impressions ?? "0", 10);
  const revenue     = extractRevenue(insights?.action_values);
  const conversions = extractConversions(insights?.actions);

  return {
    id:          raw.id,
    name:        raw.name,
    platform:    "facebook",
    company:     detectCompany(raw.name, "") as string,
    status:
      raw.status === "ACTIVE"   ? "ACTIVE"   :
      raw.status === "PAUSED"   ? "PAUSED"   : "ARCHIVED",
    objective:   raw.objective ?? "",
    dailyBudget: parseInt(raw.daily_budget   ?? "0", 10),
    totalBudget: parseInt(raw.lifetime_budget ?? "0", 10),
    startDate:   raw.start_time?.split("T")[0] ?? "",
    endDate:     raw.stop_time ? raw.stop_time.split("T")[0] : null,
    metrics: {
      impressions,
      clicks,
      spend,
      ctr:         impressions > 0 ? (clicks / impressions) * 100 : parseFloat(insights?.ctr ?? "0"),
      cpc:         parseFloat(insights?.cpc ?? "0"),
      cpm:         parseFloat(insights?.cpm ?? "0"),
      roas:        calculateROAS(revenue, spend),
      conversions,
      revenue,
      reach:       parseInt((insights as unknown as Record<string, string>)?.reach ?? "0", 10) || undefined,
      frequency:   parseFloat((insights as unknown as Record<string, string>)?.frequency ?? "0") || undefined,
    },
  };
}

/**
 * Map Meta account daily insight rows → ReportData[] for charts.
 */
export function transformMetaInsightsToReport(
  insights: MetaAccountInsightRaw[]
): ReportData[] {
  return insights.map((ins) => {
    const spend   = parseFloat(ins.spend ?? "0");
    const revenue = extractRevenue(ins.action_values);

    return {
      date:        ins.date_start,
      platform:    "facebook",
      spend,
      revenue,
      roas:        calculateROAS(revenue, spend),
      impressions: parseInt(ins.impressions ?? "0", 10),
      clicks:      parseInt(ins.clicks ?? "0", 10),
    };
  });
}

/**
 * Map Google Ads daily insight rows → ReportData[] for charts.
 * Aggregates multiple campaign rows for the same date into one entry.
 * Note: costMicros → spend (÷1,000,000), conversionsValue → revenue,
 * ctr already converted to % in GoogleAdsClient.
 */
export function transformGoogleInsightsToReport(
  insights: import("@/lib/google-client").GoogleInsightRaw[]
): ReportData[] {
  const byDate = new Map<string, ReportData>();

  for (const ins of insights) {
    const spend   = ins.costMicros / 1_000_000;
    const revenue = ins.conversionsValue;
    const existing = byDate.get(ins.date);

    if (existing) {
      existing.spend       += spend;
      existing.revenue     += revenue;
      existing.impressions += ins.impressions;
      existing.clicks      += ins.clicks;
    } else {
      byDate.set(ins.date, {
        date:        ins.date,
        platform:    "google",
        spend,
        revenue,
        roas:        0, // calculated after aggregation
        impressions: ins.impressions,
        clicks:      ins.clicks,
      });
    }
  }

  return Array.from(byDate.values()).map((r) => ({
    ...r,
    roas: calculateROAS(r.revenue, r.spend),
  }));
}

// ─────────────────────────────────────────────
// ROAS Calculator
// ─────────────────────────────────────────────

/**
 * Calculate Return on Ad Spend.
 * Returns 0 if spend is 0 to avoid division by zero.
 */
export function calculateROAS(revenue: number, spend: number): number {
  if (!spend || spend === 0) return 0;
  return Math.round((revenue / spend) * 100) / 100;
}

// ─────────────────────────────────────────────
// Percentage change helper (used in MetricsCard)
// ─────────────────────────────────────────────

/**
 * Calculate the percentage change between two values.
 * percentageChange(110, 100) → 10
 */
export function percentageChange(current: number, previous: number): number {
  if (!previous || previous === 0) return 0;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}
