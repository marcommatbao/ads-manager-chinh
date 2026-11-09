import { makeT, type TFunction } from "@/lib/i18n/translate"
// ============================================================
// Budget Redistributor — Shared Types & Constants
// Safe to import from both client and server components.
// No Node.js modules (fs, path) used here.
// ============================================================

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type ObjectiveGroup =
  | "DOMAIN_SALES"
  | "CONTENT_TRAFFIC"
  | "COURSE_LEAD"
  | "VIDEO_ENGAGEMENT"
  | "REGISTRATION";

export interface GroupBenchmark {
  cpc_good: number;
  cpc_bad: number;
  ctr_good: number;
  ctr_bad: number;
  freq_cap: number;
}

export interface ScoredCampaign {
  campaign: import("@/types/ads.types").Campaign;
  group: ObjectiveGroup;
  score: number | null;
  currentBudget: number;
  cpcLink: number;
  ctrLink: number;
  frequency: number;
}

export interface BudgetChange {
  campaignId: string;
  campaignName: string;
  group: ObjectiveGroup;
  action: "increase" | "decrease";
  oldBudget: number;
  newBudget: number;
  score: number;
  reason: string;
  status: "pending" | "success" | "failed" | "skipped";
  error?: string;
}

export interface RedistributionLog {
  id: string;
  company: string;
  date: string;
  totalChanges: number;
  successful: number;
  changes: BudgetChange[];
  estimatedSavings: number;
}

export interface RedistributionSettings {
  enabled: boolean;
  runAt: string;
  maxIncreasePct: number;
  maxDecreasePct: number;
  minBudget: number;
  companies: {
    mbc_facebook: boolean;
    mbi_facebook: boolean;
    google: boolean;
  };
  exceptions: string[];
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

export const GROUP_BENCHMARKS: Record<ObjectiveGroup, GroupBenchmark> = {
  DOMAIN_SALES: {
    cpc_good: 17000,
    cpc_bad: 35000,
    ctr_good: 0.21,
    ctr_bad: 0.14,
    freq_cap: 3.0,
  },
  CONTENT_TRAFFIC: {
    cpc_good: 1200,
    cpc_bad: 5000,
    ctr_good: 0.94,
    ctr_bad: 0.42,
    freq_cap: 2.5,
  },
  COURSE_LEAD: {
    cpc_good: 762,
    cpc_bad: 5000,
    ctr_good: 1.82,
    ctr_bad: 0.71,
    freq_cap: 3.0,
  },
  VIDEO_ENGAGEMENT: {
    cpc_good: 465,
    cpc_bad: 2000,
    ctr_good: 10.0,
    ctr_bad: 3.0,
    freq_cap: 3.5,
  },
  REGISTRATION: {
    cpc_good: 2900,
    cpc_bad: 15000,
    ctr_good: 5.52,
    ctr_bad: 1.0,
    freq_cap: 2.5,
  },
};

export const GROUP_LABELS: Record<ObjectiveGroup, string> = {
  DOMAIN_SALES: "Tên miền & Hosting",
  CONTENT_TRAFFIC: "Content & Traffic",
  COURSE_LEAD: "Khoá học & Webinar",
  VIDEO_ENGAGEMENT: "Video Engagement",
  REGISTRATION: "Đăng ký & Lead",
};

export const DEFAULT_SETTINGS: RedistributionSettings = {
  enabled: true,
  runAt: "06:00",
  maxIncreasePct: 25,
  maxDecreasePct: 30,
  minBudget: 100000,
  companies: {
    mbc_facebook: true,
    mbi_facebook: true,
    google: false,
  },
  exceptions: [],
};

// ─────────────────────────────────────────────
// Pure Helpers (no Node.js APIs)
// ─────────────────────────────────────────────

export function fmtVND(val: number, t: TFunction = makeT("vi")): string {
  if (val >= 1_000_000_000) return `₫${(val / 1_000_000_000).toFixed(1)}${t("libcase.r.unit.B")}`;
  if (val >= 1_000_000) return `₫${(val / 1_000_000).toFixed(1)}${t("libcase.r.unit.M")}`;
  if (val >= 1_000) return `₫${(val / 1_000).toFixed(0)}K`;
  return `₫${Math.round(val).toLocaleString(t("libcase.r.numLocale"))}`;
}

/** Nhãn nhóm mục tiêu theo ngôn ngữ (GROUP_LABELS giữ tiếng Việt). */
export const groupLabel = (g: ObjectiveGroup, t: TFunction = makeT("vi")): string => t(`libcase.r.grp.${g}` as never);

export function estimateSavings(changes: BudgetChange[]): number {
  let savings = 0;
  for (const c of changes) {
    if (c.status !== "success") continue;
    if (c.action === "decrease") {
      savings += c.oldBudget - c.newBudget;
    }
  }
  return savings;
}
