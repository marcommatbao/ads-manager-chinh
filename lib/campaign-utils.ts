// ============================================================
// Campaign Utility Functions — AdsCommand
// ============================================================

import type { Campaign } from "@/types/ads.types";
import { makeT, type TFunction } from "@/lib/i18n/translate";

// ─────────────────────────────────────────────
// Learning Phase Detection
// ─────────────────────────────────────────────

export interface LearningPhaseStatus {
  isInLearning: boolean;
  campaignAgeDays: number;
  conversionsThisWeek: number;
  estimatedExitDate: Date | null;
  phase: "new" | "learning" | "learning_limited" | "active";
}

function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 999; // treat as old campaign if no date
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Detect whether a campaign is in Facebook's learning phase.
 * New: < 3 days old (block all destructive automation)
 * Learning phase: < 7 days old OR < 50 conversions/week.
 * Learning limited: > 7 days old but still < 50 conversions/week.
 */
export function getLearningPhaseStatus(campaign: Campaign): LearningPhaseStatus {
  const ageDays = daysSince(campaign.startDate);
  const conversionsThisWeek = campaign.metrics.conversions ?? 0;

  // New phase: < 3 days
  if (ageDays < 3) {
    const estimatedExitDate = campaign.startDate
      ? addDays(new Date(campaign.startDate), 3)
      : null;
    return {
      isInLearning: true,
      campaignAgeDays: ageDays,
      conversionsThisWeek,
      estimatedExitDate,
      phase: "new",
    };
  }

  // Learning phase: < 7 days OR < 50 conversions/week
  const isInLearning = ageDays < 7 || conversionsThisWeek < 50;

  // Determine specific phase
  const phase: LearningPhaseStatus["phase"] = ageDays < 7
    ? "learning"
    : conversionsThisWeek < 50
      ? "learning_limited"
      : "active";

  // Estimate exit date
  const conversionRate = conversionsThisWeek / Math.max(1, Math.min(ageDays, 7));
  const conversionsNeeded = 50 - conversionsThisWeek;
  const daysToExit = conversionRate > 0 && conversionsNeeded > 0
    ? Math.ceil(conversionsNeeded / conversionRate)
    : null;
  const estimatedExitDate = daysToExit
    ? addDays(new Date(), daysToExit)
    : null;

  return {
    isInLearning,
    campaignAgeDays: ageDays,
    conversionsThisWeek,
    estimatedExitDate,
    phase,
  };
}

// Detect company from campaign name
export function getCompany(campaignName: string): string | null {
  if (campaignName.startsWith('MBC')) return 'MBC'
  if (campaignName.startsWith('MBI')) return 'MBI'
  return null
}

// Frequency color coding and labels
export function getFrequencyStatus(freq: number, t: TFunction = makeT("vi")): {
  color: string
  label: string
  badge: string
  tooltip: string
} {
  if (freq < 2.0) return {
    color: 'text-green-600',
    label: `${freq.toFixed(1)}x`,
    badge: '✅',
    tooltip: t('libcase.freq.good'),
  }
  if (freq < 3.5) return {
    color: 'text-gray-700',
    label: `${freq.toFixed(1)}x`,
    badge: '',
    tooltip: t('libcase.freq.normal'),
  }
  if (freq < 5.0) return {
    color: 'text-orange-500 font-semibold',
    label: `${freq.toFixed(1)}x`,
    badge: '⚠️',
    tooltip: t('libcase.freq.warn'),
  }
  return {
    color: 'text-red-600 font-bold',
    label: `${freq.toFixed(1)}x`,
    badge: '🔴',
    tooltip: t('libcase.freq.sat'),
  }
}

// Format large numbers compactly
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

// ─────────────────────────────────────────────
// Campaign Duration — "chạy bao nhiêu ngày, kết thúc khi nào"
// ─────────────────────────────────────────────
// Google campaigns only got a real startDate/endDate from the API as of
// 2026-07-29 (lib/google-client.ts's getCampaigns() didn't select
// campaign.start_date/end_date before that — every Google campaign here
// showed "" / null). Facebook already had real values via
// app/api/meta/campaigns/route.ts. Both platforms are real now.

export interface CampaignDuration {
  /** Days elapsed so far (or total, if the campaign already ended) — null if startDate is missing/unparseable. */
  daysRun: number | null;
  /** Total planned days if an end date is set, else null (open-ended). */
  totalDays: number | null;
  /** Days remaining until end date — null if no end date or already ended. */
  daysLeft: number | null;
  hasEnded: boolean;
  /** Compact label for a table cell, e.g. "45 ngày", "12/60 ngày", "Không giới hạn". */
  label: string;
  /** Longer detail for a tooltip, e.g. "Bắt đầu 01/06/2026 · Còn 15 ngày (kết thúc 30/07/2026)". */
  detail: string;
}

export function getCampaignDuration(startDate: string | null | undefined, endDate: string | null | undefined, t: TFunction = makeT("vi")): CampaignDuration {
  const start = startDate ? new Date(startDate) : null;
  if (!start || isNaN(start.getTime())) {
    return { daysRun: null, totalDays: null, daysLeft: null, hasEnded: false, label: "—", detail: t("libcase.dur.none") };
  }

  const now = new Date();
  const end = endDate ? new Date(endDate) : null;
  const validEnd = end && !isNaN(end.getTime()) ? end : null;
  const hasEnded = validEnd ? validEnd < now : false;
  const effectiveEnd = hasEnded ? validEnd! : now;

  const daysRun = Math.max(0, Math.floor((effectiveEnd.getTime() - start.getTime()) / 86_400_000)) + 1;
  const fmtDate = (d: Date) => d.toLocaleDateString(t("libcase.dur.dateLocale"));

  if (!validEnd) {
    return {
      daysRun, totalDays: null, daysLeft: null, hasEnded: false,
      label: t("libcase.dur.days", { n: daysRun }),
      detail: t("libcase.dur.open", { start: fmtDate(start) }),
    };
  }

  const totalDays = Math.max(0, Math.floor((validEnd.getTime() - start.getTime()) / 86_400_000)) + 1;

  if (hasEnded) {
    return {
      daysRun: totalDays, totalDays, daysLeft: 0, hasEnded: true,
      label: t("libcase.dur.days", { n: totalDays }),
      detail: t("libcase.dur.ended", { start: fmtDate(start), end: fmtDate(validEnd) }),
    };
  }

  const daysLeft = Math.ceil((validEnd.getTime() - now.getTime()) / 86_400_000);
  return {
    daysRun, totalDays, daysLeft, hasEnded: false,
    label: t("libcase.dur.ofDays", { n: daysRun, total: totalDays }),
    detail: t("libcase.dur.left", { start: fmtDate(start), left: daysLeft, end: fmtDate(validEnd) }),
  };
}
