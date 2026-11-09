"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import PlatformBadge from "@/components/PlatformBadge";
import { cn, formatCurrency, CURRENCY_CONFIG } from "@/lib/utils";
import { useAdsStore } from "@/store/useAdsStore";
import { useToast } from "@/components/Toast";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import { makeT, type TFunction } from "@/lib/i18n/translate";
// Ngưỡng sức khoẻ chiến dịch — NGUỒN DUY NHẤT.
// Trước 23/09/2026 các con số dưới đây được gõ thẳng vào hàm
// getCampaignHealthBadge, và lib/campaign-health.ts giữ một bản KHÁC, lệch
// nhau (CPC 20.000 ↔ 35.000, CTR cần >5.000 ↔ >1.000 hiển thị). Nay tấm
// "Phân tích hiệu quả" ở trang chi tiết cũng chấm theo cùng bộ ngưỡng này,
// nên hai màn hình không thể nói ngược nhau về cùng một chiến dịch nữa.
// Giá trị giữ NGUYÊN như cũ — đây chỉ là đổi chỗ đặt số, không đổi hành vi.
import {
  ROAS_LOSING, ROAS_MIN_SPEND_VND, NO_DELIVERY_MIN_AGE_DAYS,
  FREQUENCY_WARN, FREQUENCY_CRITICAL,
  CTR_LOW_PCT, CTR_GOOD_PCT, CTR_EXCELLENT_PCT, CTR_MIN_IMPRESSIONS, CTR_BENCHMARK_PCT,
  CPC_HIGH_VND,
} from "@/lib/campaign-benchmarks";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { EditBudgetModal } from "@/components/EditBudgetModal";
import type { Campaign, CampaignStatus, Platform } from "@/types/ads.types";
import { COMPANY_CONFIG } from "@/lib/company-config";
import {
  Search,
  Pencil,
  Pause,
  Play,
  MoreHorizontal,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Inbox,
  PauseCircle,
  PlayCircle,
  Loader2,
  AlertTriangle,
  Info,
  CheckSquare,
  Square,
  X,
  Copy,
} from "lucide-react";
import { getCompany, getFrequencyStatus, getLearningPhaseStatus, getCampaignDuration } from "@/lib/campaign-utils";
import { companyIds, companyLabel } from "@/lib/companies/registry";

/** Đợt 21: công ty của chiến dịch — theo tiền tố tên như cũ; bản cài CHỈ MỘT công ty (khách) thì mọi chiến dịch thuộc công ty đó.
 *  Bản Mắt Bão (2 công ty): y như getCompany(). */
function companyOfCampaign(name: string): string | null {
  const byName = getCompany(name);
  if (byName) return byName;
  const ids = companyIds();
  return ids.length === 1 ? ids[0] : null;
}
import { quickFatigueCheck, FATIGUE_BADGES, OBJECTIVE_LABELS } from "@/lib/fatigue-detector";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type SortKey = "name" | "spend" | "cpl" | "results" | "resultRoas" | "resultValue";
type SortDir = "asc" | "desc" | null;
type CompanyFilter = "all" | string;

interface CampaignTableProps {
  campaigns: Campaign[];
  isLoading?: boolean;
  currency?: string;
  showGA4?: boolean;
  /**
   * Bộ lọc nền tảng của TRANG (pill All/Facebook/Google trên đầu trang).
   * Bảng có pill riêng của nó; pill nào đang chọn cụ thể thì cái đó thắng.
   * Dùng để biết khi nào hiện bộ cột riêng cho Google.
   */
  platformFilter?: Platform | "all";
  /** Lý do cột "Người dùng duy nhất" trống, lấy từ /api/google/campaigns. */
  uniqueUsersError?: string | null;
}

// ─────────────────────────────────────────────
// Currency-aware helpers
// ─────────────────────────────────────────────

/** Hậu tố nghìn tỷ/triệu theo ngôn ngữ: vi "T"/"Tr" (mặc định, như cũ), en "B"/"M". */
function magSuffix(intlLocale: string) {
  return intlLocale === "vi-VN" ? { b: "T", m: "Tr" } : { b: "B", m: "M" };
}

/**
 * Format a currency value for table cells.
 * For VND: ₫23,523,000 or ₫23.5Tr for large amounts
 * For USD: $1,234.56 or $1.5K for large amounts
 */
export function fmtCurrency(v: number, currency = "USD", intlLocale = "vi-VN") {
  const sfx = magSuffix(intlLocale);
  const config = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG["USD"];
  const actualValue = v / config.divideBy;

  if (currency === "VND") {
    // VND: use Vietnamese-style abbreviations for large numbers
    if (actualValue >= 1_000_000_000) return `₫${(actualValue / 1_000_000_000).toFixed(1)}${sfx.b}`;
    if (actualValue >= 1_000_000) return `₫${(actualValue / 1_000_000).toFixed(1)}${sfx.m}`;
    if (actualValue >= 1_000) return `₫${actualValue.toLocaleString(intlLocale, { maximumFractionDigits: 0 })}`;
    return `₫${Math.round(actualValue).toLocaleString(intlLocale)}`;
  }

  // USD and other currencies
  if (actualValue >= 1_000_000) return `${config.symbol}${(actualValue / 1_000_000).toFixed(1)}M`;
  if (actualValue >= 1_000) return `${config.symbol}${(actualValue / 1_000).toFixed(1)}K`;
  return `${config.symbol}${actualValue.toFixed(config.decimals)}`;
}

/**
 * Format a value that is already in major currency units (e.g. spend from Meta API).
 * Use this for metrics.spend, metrics.cpc, etc. that are NOT in minor units.
 */
export function fmtSpend(v: number, currency = "USD", intlLocale = "vi-VN") {
  const sfx = magSuffix(intlLocale);
  const config = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG["USD"];

  if (currency === "VND") {
    if (v >= 1_000_000_000) return `₫${(v / 1_000_000_000).toFixed(1)}${sfx.b}`;
    if (v >= 1_000_000) return `₫${(v / 1_000_000).toFixed(1)}${sfx.m}`;
    if (v >= 1_000) return `₫${v.toLocaleString(intlLocale, { maximumFractionDigits: 0 })}`;
    return `₫${Math.round(v).toLocaleString(intlLocale)}`;
  }

  if (v >= 1_000_000) return `${config.symbol}${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${config.symbol}${(v / 1_000).toFixed(1)}K`;
  return `${config.symbol}${v.toFixed(config.decimals)}`;
}

/** Số tiền ĐẦY ĐỦ (không rút gọn "Tr"/"K") — để đối chiếu từng đồng với cột cùng tên trong Ads Manager. */
export function fmtMoneyFull(v: number, currency = "USD", intlLocale = "vi-VN") {
  if (currency === "VND") return `${Math.round(v).toLocaleString(intlLocale)} ₫`
  const config = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG["USD"]
  return `${config.symbol}${v.toLocaleString("en-US", { minimumFractionDigits: config.decimals, maximumFractionDigits: config.decimals })}`
}

export function fmtNumber(v: number, intlLocale = "vi-VN") {
  const sfx = magSuffix(intlLocale);
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}${sfx.b}`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}${sfx.m}`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return `${v}`;
}

// ─────────────────────────────────────────────
// Status Badge
// ─────────────────────────────────────────────
export const STATUS_CFG: Record<CampaignStatus, { label: string; dot: string; text: string }> = {
  ACTIVE:   { label: "Active",   dot: "bg-green-500",  text: "text-green-700" },
  PAUSED:   { label: "Paused",   dot: "bg-yellow-400", text: "text-yellow-700" },
  ARCHIVED: { label: "Archived", dot: "bg-slate-400",  text: "text-slate-500" },
};

export function StatusBadge({ status }: { status: CampaignStatus }) {
  const t = useT();
  const { label: _label, dot, text } = STATUS_CFG[status];
  const label = t(status === "ACTIVE" ? "campaigns.status.active" : status === "PAUSED" ? "campaigns.status.paused" : "campaigns.status.archived");
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────
// Campaign Health Badge (rule-based AI scoring)
// ─────────────────────────────────────────────

type HealthLevel = "critical" | "warning" | "good" | "info" | "learning" | "active";

export interface HealthBadgeData {
  level: HealthLevel;
  label: string;
  detail: string;
  suggestion: string;
}

export function getCampaignHealthBadge(c: Campaign, t: TFunction = makeT("vi"), intlLocale = "vi-VN"): HealthBadgeData {
  const m = c.metrics;
  const ageMs = c.startDate ? Date.now() - new Date(c.startDate).getTime() : 0;
  const ageDays = ageMs / 86400000;

  // 🎓 LEARNING PHASE — Facebook only (Google has no startDate, skip learning classification)
  const learning = getLearningPhaseStatus(c);
  if (c.platform === "google" && c.status === "ACTIVE") {
    // Google campaigns without metrics data — show neutral active status
    if (m.impressions === 0) {
      return {
        level: "info",
        label: t("campaigns.health.running.label"),
        detail: t("campaigns.health.running.detail"),
        suggestion: t("campaigns.health.running.suggestion"),
      };
    }
  }
  if (learning.phase === "new" && c.status === "ACTIVE" && c.platform !== "google") {
    const exitStr = learning.estimatedExitDate
      ? t("campaigns.health.new.exitDate", { date: learning.estimatedExitDate.toLocaleDateString(intlLocale) })
      : t("campaigns.health.new.exitNoData");
    return {
      level: "learning",
      label: t("campaigns.health.new.label", { days: learning.campaignAgeDays }),
      detail: t("campaigns.health.new.detail", { days: learning.campaignAgeDays }),
      suggestion: t("campaigns.health.new.suggestion", { exit: exitStr }),
    };
  }
  if (learning.phase === "learning" && c.status === "ACTIVE" && c.platform !== "google") {
    const conversionsNeeded = Math.max(0, 50 - learning.conversionsThisWeek);
    const exitStr = learning.estimatedExitDate
      ? t("campaigns.health.learning.exitDate", { date: learning.estimatedExitDate.toLocaleDateString(intlLocale) })
      : t("campaigns.health.learning.exitNoData");
    return {
      level: "learning",
      label: t("campaigns.health.learning.label", { days: learning.campaignAgeDays }),
      detail: t("campaigns.health.learning.detail", { days: learning.campaignAgeDays }),
      suggestion: t("campaigns.health.learning.suggestion", { needed: conversionsNeeded, exit: exitStr }),
    };
  }
  if (learning.phase === "learning_limited" && c.status === "ACTIVE" && c.platform !== "google") {
    return {
      level: "learning",
      label: t("campaigns.health.limited.label"),
      detail: t("campaigns.health.limited.detail", { days: learning.campaignAgeDays, conv: learning.conversionsThisWeek }),
      suggestion: t("campaigns.health.limited.suggestion"),
    };
  }

  // 🔴 CRITICAL
  if (m.roas < ROAS_LOSING && m.spend > ROAS_MIN_SPEND_VND) {
    return {
      level: "critical", label: t("campaigns.health.losing.label"),
      detail: t("campaigns.health.losing.detail", { roas: m.roas.toFixed(2), spend: Math.round(m.spend).toLocaleString(intlLocale) }),
      suggestion: t("campaigns.health.losing.suggestion"),
    };
  }
  if (m.impressions === 0 && c.status === "ACTIVE" && ageDays > NO_DELIVERY_MIN_AGE_DAYS) {
    return {
      level: "critical", label: t("campaigns.health.noDelivery.label"),
      detail: t("campaigns.health.noDelivery.detail", { days: Math.round(ageDays) }),
      suggestion: t("campaigns.health.noDelivery.suggestion"),
    };
  }
  if (((m as unknown as Record<string, number>).frequency ?? 0) > FREQUENCY_CRITICAL) {
    return {
      level: "critical", label: t("campaigns.health.freqCritical.label"),
      detail: t("campaigns.health.freqCritical.detail", { freq: ((m as unknown as Record<string, number>).frequency ?? 0).toFixed(1) }),
      suggestion: t("campaigns.health.freqCritical.suggestion"),
    };
  }

  // 🟡 WARNING
  if (m.ctr < CTR_LOW_PCT && m.impressions > CTR_MIN_IMPRESSIONS) {
    return {
      level: "warning", label: t("campaigns.health.ctrLow.label", { ctr: m.ctr.toFixed(2) }),
      detail: t("campaigns.health.ctrLow.detail", { ctr: m.ctr.toFixed(2), bench: CTR_BENCHMARK_PCT }),
      suggestion: t("campaigns.health.ctrLow.suggestion"),
    };
  }
  if (((m as unknown as Record<string, number>).frequency ?? 0) > FREQUENCY_WARN) {
    return {
      level: "warning", label: t("campaigns.health.freqWarn.label"),
      detail: t("campaigns.health.freqWarn.detail", { freq: ((m as unknown as Record<string, number>).frequency ?? 0).toFixed(1) }),
      suggestion: t("campaigns.health.freqWarn.suggestion"),
    };
  }
  if (m.cpc > CPC_HIGH_VND) {
    return {
      level: "warning", label: t("campaigns.health.cpcHigh.label"),
      detail: t("campaigns.health.cpcHigh.detail", { cpc: Math.round(m.cpc).toLocaleString(intlLocale), target: CPC_HIGH_VND/1000 }),
      suggestion: t("campaigns.health.cpcHigh.suggestion"),
    };
  }

  // ✅ GOOD
  if (m.ctr > CTR_EXCELLENT_PCT) {
    return {
      level: "good", label: t("campaigns.health.ctrGood.label", { ctr: m.ctr.toFixed(1) }),
      detail: t("campaigns.health.ctrExcellent.detail"),
      suggestion: t("campaigns.health.ctrExcellent.suggestion"),
    };
  }
  if (m.ctr > CTR_GOOD_PCT) {
    return {
      level: "good", label: t("campaigns.health.ctrGood.label", { ctr: m.ctr.toFixed(1) }),
      detail: t("campaigns.health.ctrGood.detail"),
      suggestion: t("campaigns.health.ctrGood.suggestion"),
    };
  }

  // 📊 INFO
  if (c.status === "PAUSED" && ageDays > 7) {
    return {
      level: "info", label: t("campaigns.health.pausedLong.label", { days: Math.round(ageDays) }),
      detail: t("campaigns.health.pausedLong.detail", { days: Math.round(ageDays) }),
      suggestion: t("campaigns.health.pausedLong.suggestion"),
    };
  }
  if (ageDays < 3 && ageDays > 0) {
    return {
      level: "info", label: t("campaigns.health.fresh.label"),
      detail: t("campaigns.health.fresh.detail", { hours: Math.round(ageDays * 24) }),
      suggestion: t("campaigns.health.fresh.suggestion"),
    };
  }

  // Default: neutral
  return {
    level: "info", label: t("campaigns.health.normal.label"),
    detail: t("campaigns.health.normal.detail"),
    suggestion: t("campaigns.health.normal.suggestion"),
  };
}

const HEALTH_COLORS: Record<HealthLevel, { bg: string; text: string; border: string }> = {
  critical: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
  warning: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  good: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  info: { bg: "bg-slate-50", text: "text-slate-500", border: "border-slate-200" },
  learning: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  active: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200" },
};

function HealthBadge({ badge }: { badge: HealthBadgeData }) {
  const [showTip, setShowTip] = useState(false);
  const clr = HEALTH_COLORS[badge.level];
  return (
    <div className="relative">
      <span
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border whitespace-nowrap cursor-default",
          clr.bg, clr.text, clr.border
        )}
      >
        {badge.label}
      </span>
      {showTip && (
        <div className="absolute z-50 bottom-full left-0 mb-2 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-left">
          <p className={cn("text-xs font-bold mb-1", clr.text)}>{badge.detail}</p>
          <p className="text-[10px] text-slate-500">💡 {badge.suggestion}</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Fatigue Badge Component
// ─────────────────────────────────────────────

function FatigueBadge({ campaign }: { campaign: Campaign }) {
  const [showTip, setShowTip] = useState(false);
  const router = useRouter();

  // Only show for active campaigns with impressions
  if (campaign.status !== "ACTIVE" || campaign.metrics.impressions < 100) {
    return <span className="text-slate-300 text-[10px]">—</span>;
  }

  const fatigue = quickFatigueCheck(campaign);
  const badge = FATIGUE_BADGES[fatigue.fatigueLevel];
  const isCriticalOrFatigued = fatigue.fatigueLevel === "critical" || fatigue.fatigueLevel === "fatigued";

  return (
    <div className="relative">
      <span
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border whitespace-nowrap cursor-default",
          badge.bg, badge.text, badge.border
        )}
      >
        {badge.emoji} {badge.label} ({fatigue.fatigueScore})
      </span>
      {showTip && (
        <div
          className="absolute z-50 bottom-full left-0 mb-2 w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-left"
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
        >
          <p className={cn("text-xs font-bold mb-0.5", badge.text)}>
            {badge.emoji} Fatigue Score: {fatigue.fatigueScore}/100
          </p>
          <p className="text-[10px] text-slate-400 mb-2">
            [{OBJECTIVE_LABELS[fatigue.objective ?? ""] || campaign.objective} — ngưỡng nội bộ {fatigue.benchmarkUsed}]
          </p>

          {fatigue.signals.length > 0 && (
            <div className="space-y-0.5 mb-2">
              <p className="text-[10px] font-semibold text-slate-500">Signals phát hiện:</p>
              {fatigue.signals.map((s, i) => (
                <p key={i} className={cn("text-[10px]", s.severity === "critical" ? "text-red-600" : s.severity === "warning" ? "text-amber-600" : "text-slate-600")}>
                  {s.severity === "critical" ? "🔴" : s.severity === "warning" ? "🟡" : "📊"} {s.description}
                </p>
              ))}
            </div>
          )}

          {fatigue.estimatedDaysLeft < 999 && (
            <p className="text-[10px] text-slate-500 mb-1.5">
              ⏱ Ước tính còn: ~{fatigue.estimatedDaysLeft} ngày
            </p>
          )}

          <p className="text-[10px] text-slate-500">
            💡 {fatigue.recommendedAction}
          </p>

          {/* "Tạo Creative mới" button — shown for critical/fatigued campaigns */}
          {isCriticalOrFatigued && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const params = new URLSearchParams({
                  company:   campaign.company ?? 'MBC',
                  product:   campaign.name,
                  objective: campaign.objective ?? '',
                  ref:       'fatigue',
                  campaignId: campaign.id,
                });
                router.push(`/creative?${params.toString()}`);
              }}
              className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 px-3 py-1.5 text-[10px] font-bold text-amber-950 hover:from-amber-600 hover:to-amber-700 transition-all"
            >
              🔄 Tạo Creative mới
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Health filter type
type HealthFilter = "all" | "critical" | "good" | "paused" | "learning" | "active";

// ─────────────────────────────────────────────
// Sort Icon
// ─────────────────────────────────────────────
function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="ml-1 h-3 w-3 text-slate-300 inline" />;
  return dir === "asc"
    ? <ChevronUp   className="ml-1 h-3 w-3 text-amber-600 inline" />
    : <ChevronDown className="ml-1 h-3 w-3 text-amber-600 inline" />;
}

// ─────────────────────────────────────────────
// Skeleton row
// ─────────────────────────────────────────────
function SkeletonRow() {
  return (
    <TableRow>
      {Array.from({ length: 17 }).map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 animate-pulse rounded bg-slate-100" style={{ width: i === 1 ? "140px" : "60px" }} />
        </TableCell>
      ))}
    </TableRow>
  );
}

// ─────────────────────────────────────────────
// CPL Helper (Client-side sync fallback)
// ─────────────────────────────────────────────
function getCplBadge(cpl: number | null, company: string | null, cur: string, intlLocale = "vi-VN") {
  if (cpl === null || isNaN(cpl)) return { bg: "bg-slate-100", text: "text-slate-500", label: "⚪ —" };
  // Đợt 21: ngưỡng tĩnh này là của MBC / MBI. Công ty khác chưa có ngưỡng → chỉ hiện số, không tô xanh/đỏ (không đoán).
  if (company !== null && company !== "MBC" && company !== "MBI") return { bg: "bg-slate-100", text: "text-slate-600", label: fmtSpend(cpl, cur, intlLocale) };
  const th = company === "MBI" ? { good: 150000, warning: 250000 } : { good: 60000, warning: 99000 };
  
  if (cpl <= th.good) return { bg: "bg-emerald-100", text: "text-emerald-700", label: `🟢 ${fmtSpend(cpl, cur, intlLocale)}` };
  if (cpl <= th.warning) return { bg: "bg-amber-100", text: "text-amber-700", label: `🟡 ${fmtSpend(cpl, cur, intlLocale)}` };
  return { bg: "bg-red-100", text: "text-red-700", label: `🔴 ${fmtSpend(cpl, cur, intlLocale)}` };
}

// ─────────────────────────────────────────────
// Pagination helper
// ─────────────────────────────────────────────
const PAGE_SIZE = 20;

function getPageNumbers(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "…", total];
  if (current >= total - 3) return [1, "…", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "…", current - 1, current, current + 1, "…", total];
}

// ─────────────────────────────────────────────
// Platform filter pills
// ─────────────────────────────────────────────
const PLATFORM_PILLS: { label: string; value: Platform | "all" }[] = [
  { label: "All",      value: "all" },
  { label: "Facebook", value: "facebook" },
  { label: "Google",   value: "google" },
];

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
export default function CampaignTable({ campaigns, isLoading = false, currency = "USD", showGA4 = false, platformFilter = "all", uniqueUsersError = null }: CampaignTableProps) {
  const router = useRouter();
  const { updateCampaignStatus, updateCampaignBudget } = useAdsStore();
  const { toast } = useToast();
  const t = useT();
  const intl = useIntlLocale();

  const [search,         setSearch]         = useState("");
  const [platform,       setPlatform]       = useState<Platform | "all">("all");

  // Bộ cột riêng cho Google. Pill trong bảng ưu tiên hơn pill của trang: người
  // dùng vừa bấm ngay trên bảng thì đó mới là ý định hiện tại. Cả hai để "all"
  // thì giữ nguyên bộ cột cũ (trang Dashboard dùng bảng này mà không truyền
  // platformFilter, nên mặc định không đổi gì).
  const effectivePlatform = platform !== "all" ? platform : platformFilter;
  const googleView = effectivePlatform === "google";
  const [sortKey,        setSortKey]        = useState<SortKey | null>(null);
  const [sortDir,        setSortDir]        = useState<SortDir>(null);
  const [healthFilter,   setHealthFilter]   = useState<HealthFilter>("all");
  const [companyFilter,  setCompanyFilter]  = useState<CompanyFilter>("all");

  const [page, setPage] = useState(1);

  const [pausingId, setPausingId] = useState<string | null>(null);
  const [confirmToggleData, setConfirmToggleData] = useState<Campaign | null>(null);
  const [editingBudgetCampaign, setEditingBudgetCampaign] = useState<Campaign | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  async function toggleCampaignStatus(campaign: Campaign) {
    setPausingId(campaign.id);
    const action = campaign.status === "ACTIVE" ? "PAUSE" : "ACTIVE";
    // Compute locally — don't rely on API response shape for status
    const expectedStatus: "ACTIVE" | "PAUSED" = action === "PAUSE" ? "PAUSED" : "ACTIVE";

    try {
      // This button previously always hit the Meta endpoint regardless of
      // platform, so toggling a Google campaign silently sent a Google
      // numeric ID to the Meta Graph API and failed. Branch by platform —
      // see app/api/google/campaigns/[id]/status/route.ts for the real
      // Google counterpart.
      const endpoint = campaign.platform === "google"
        ? `/api/google/campaigns/${campaign.id}/status`
        : `/api/meta/campaigns/${campaign.id}/status`;
      const body = campaign.platform === "google"
        ? { action, campaignId: campaign.id, company: campaign.company }
        : { action, campaignId: campaign.id };

      const res = await fetch(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" }
      });
      const data = await res.json();

      if (data.success) {
        updateCampaignStatus(campaign.id, data.newStatus ?? expectedStatus);
        toast({
          title: data.message ?? (action === "PAUSE" ? t("campaigns.toast.paused") : t("campaigns.toast.activated")),
          description: campaign.name
        });
      } else {
        toast({
          title: "❌ " + data.error,
          variant: "error"
        });
      }
    } catch (err: unknown) {
      toast({ title: t("campaigns.toast.fetchError"), variant: "error" });
    } finally {
      setPausingId(null);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === rows.length && rows.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map(c => c.id)));
    }
  }

  async function bulkAction(action: "PAUSE" | "ACTIVE") {
    setBulkLoading(true);
    const ids = Array.from(selectedIds);
    let successCount = 0;
    for (const id of ids) {
      const campaign = rows.find(c => c.id === id);
      const endpoint = campaign?.platform === "google"
        ? `/api/google/campaigns/${id}/status`
        : `/api/meta/campaigns/${id}/status`;
      const body = campaign?.platform === "google"
        ? { action, campaignId: id, company: campaign.company }
        : { action, campaignId: id };
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        });
        const data = await res.json();
        if (data.success) {
          updateCampaignStatus(id, data.newStatus);
          successCount++;
        }
      } catch { /* skip */ }
    }
    setBulkLoading(false);
    setSelectedIds(new Set());
    toast({
      title: t("campaigns.toast.bulkDone", { status: action === "PAUSE" ? t("campaigns.toast.paused") : t("campaigns.toast.activated"), done: successCount, total: ids.length }),
    });
  }

  // ── Sort toggle ──
  function handleSort(key: SortKey) {
    if (sortKey !== key) { setSortKey(key); setSortDir("desc"); }
    else if (sortDir === "desc") setSortDir("asc");
    else { setSortKey(null); setSortDir(null); }
  }

  function ariaSort(key: SortKey): "ascending" | "descending" | "none" {
    if (sortKey !== key || !sortDir) return "none";
    return sortDir === "asc" ? "ascending" : "descending";
  }

  // ── Health counts (for filter pills) ──
  const healthCounts = useMemo(() => {
    let critical = 0, good = 0, paused = 0, learning = 0, active = 0;
    for (const c of campaigns) {
      if (c.status === "PAUSED") { paused++; continue; }
      if (c.status !== "ACTIVE") continue;
      active++;
      const h = getCampaignHealthBadge(c, t, intl);
      if (h.level === "learning") learning++;
      else if (h.level === "critical" || h.level === "warning") critical++;
      else if (h.level === "good") good++;
      // "info" (Google active without metrics) already counted in active
    }
    return { critical, good, paused, learning, active };
  }, [campaigns, t, intl]);

  // ── Company counts (for company filter pills) ──
  const companyCounts = useMemo(() => {
    const counts: Record<string, { count: number; spend: number }> = Object.fromEntries(companyIds().map((co) => [co, { count: 0, spend: 0 }]));
    for (const c of campaigns) {
      const co = companyOfCampaign(c.name);
      if (co && counts[co]) { counts[co].count++; counts[co].spend += c.metrics.spend; }
    }
    return counts;
  }, [campaigns]);

  function fmtSpendShort(v: number) {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}${magSuffix(intl).m}`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return `${Math.round(v)}`;
  }

  // ── Filtered + sorted data ──
  const rows = useMemo(() => {
    let list = campaigns.filter((c) => {
      if (platform !== "all" && c.platform !== platform) return false;
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      // Company filter
      if (companyFilter !== "all" && companyOfCampaign(c.name) !== companyFilter) return false;
      // Health filter
      if (healthFilter !== "all") {
        if (healthFilter === "paused") return c.status === "PAUSED";
        if (healthFilter === "active") return c.status === "ACTIVE";
        const h = getCampaignHealthBadge(c, t, intl);
        if (healthFilter === "learning") return h.level === "learning";
        if (healthFilter === "critical") return h.level === "critical" || h.level === "warning";
        if (healthFilter === "good") return h.level === "good";
      }
      return true;
    });
    if (sortKey && sortDir && (sortKey === "results" || sortKey === "resultRoas" || sortKey === "resultValue")) {
      // Cột Meta có thể "—" (null: Meta không có giá trị cho loại kết quả đó) → luôn xếp cuối, chiều nào cũng vậy.
      const val = (c: Campaign): number | null =>
        sortKey === "results" ? c.metrics.conversions : sortKey === "resultRoas" ? c.metrics.resultRoas ?? null : c.metrics.resultValue ?? null;
      list = [...list].sort((a, b) => {
        const av = val(a), bv = val(b);
        if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
        return sortDir === "asc" ? av - bv : bv - av;
      });
    } else if (sortKey && sortDir) {
      list = [...list].sort((a, b) => {
        const aCpl = a.metrics.conversions ? a.metrics.spend / a.metrics.conversions : Infinity;
        const bCpl = b.metrics.conversions ? b.metrics.spend / b.metrics.conversions : Infinity;
        const av = sortKey === "name" ? a.name : sortKey === "spend" ? a.metrics.spend : aCpl;
        const bv = sortKey === "name" ? b.name : sortKey === "spend" ? b.metrics.spend : bCpl;
        if (typeof av === "string")
          return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
        return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
      });
    }
    return list;
  }, [campaigns, search, platform, sortKey, sortDir, healthFilter, companyFilter, t, intl]);

  // Reset về trang 1 khi filter/sort thay đổi
  useEffect(() => { setPage(1); }, [search, platform, healthFilter, companyFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function ThSort({ col, label }: { col: SortKey; label: string }) {
    return (
      <button
        onClick={() => handleSort(col)}
        className="flex items-center uppercase tracking-wider text-xs font-semibold text-slate-500 hover:text-slate-700"
      >
        {label}
        <SortIcon active={sortKey === col} dir={sortKey === col ? sortDir : null} />
      </button>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Filters bar ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder={t("campaigns.search.placeholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 rounded-lg border-slate-200 text-sm"
          />
        </div>

        {/* Platform pills */}
        <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-0.5">
          {PLATFORM_PILLS.map(({ label: pillLabel, value }) => (
            <button
              key={value}
              onClick={() => setPlatform(value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                platform === value
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              {value === "all" ? t("campaigns.platform.all") : pillLabel}
            </button>
          ))}
        </div>

        <span className="text-xs text-slate-400">
          {t(rows.length !== 1 ? "campaigns.count.many" : "campaigns.count.one", { n: rows.length })}
        </span>
      </div>

      {/* ── Health filter pills ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-0.5 shadow-sm">
          <button
            onClick={() => setHealthFilter("all")}
            className={cn("rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
              healthFilter === "all" ? "bg-slate-700 text-white shadow-sm" : "text-slate-400 hover:text-slate-600")}
          >{t("campaigns.filter.all")}</button>
          <button
            onClick={() => setHealthFilter("active")}
            className={cn("rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
              healthFilter === "active" ? "bg-green-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-600")}
          >{t("campaigns.filter.active", { n: healthCounts.active })}</button>
          <button
            onClick={() => setHealthFilter("critical")}
            className={cn("rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
              healthFilter === "critical" ? "bg-red-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-600")}
          >{t("campaigns.filter.critical", { n: healthCounts.critical })}</button>
          <button
            onClick={() => setHealthFilter("good")}
            className={cn("rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
              healthFilter === "good" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-600")}
          >{t("campaigns.filter.good", { n: healthCounts.good })}</button>
          <button
            onClick={() => setHealthFilter("learning")}
            className={cn("rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
              healthFilter === "learning" ? "bg-blue-500 text-white shadow-sm" : "text-slate-400 hover:text-slate-600")}
          >{t("campaigns.filter.learning", { n: healthCounts.learning })}</button>
          <button
            onClick={() => setHealthFilter("paused")}
            className={cn("rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
              healthFilter === "paused" ? "bg-slate-500 text-white shadow-sm" : "text-slate-400 hover:text-slate-600")}
          >{t("campaigns.filter.paused", { n: healthCounts.paused })}</button>
        </div>

        {/* Company filter pills */}
        <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-0.5 shadow-sm">
          <button
            onClick={() => setCompanyFilter("all")}
            className={cn("rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
              companyFilter === "all" ? "bg-slate-700 text-white shadow-sm" : "text-slate-400 hover:text-slate-600")}
          >{t("campaigns.filter.all")}</button>
          {companyIds().map((co) => (
            <button
              key={co}
              onClick={() => setCompanyFilter(co)}
              className={cn("rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
                companyFilter === co ? `${co === "MBC" ? "bg-blue-600" : co === "MBI" ? "bg-purple-600" : "bg-slate-700"} text-white shadow-sm` : "text-slate-400 hover:text-slate-600")}
            >
              {t("campaigns.filter.company", { name: co === "MBC" || co === "MBI" ? co : companyLabel(co), count: companyCounts[co]?.count ?? 0, spend: fmtSpendShort(companyCounts[co]?.spend ?? 0) })}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                {/* Bulk select checkbox */}
                <TableHead className="w-[40px]">
                  <button
                    onClick={toggleAll}
                    className="flex items-center justify-center text-slate-400 hover:text-slate-600"
                    title={selectedIds.size === rows.length && rows.length > 0 ? t("campaigns.col.deselectAll") : t("campaigns.col.selectAll")}
                  >
                    {selectedIds.size === rows.length && rows.length > 0
                      ? <CheckSquare className="h-4 w-4 text-blue-500" />
                      : <Square className="h-4 w-4" />}
                  </button>
                </TableHead>
                {/* Sortable */}
                <TableHead className="min-w-[180px]" aria-sort={ariaSort("name")}>
                  <ThSort col="name" label={t("campaigns.col.campaign")} />
                </TableHead>
                <TableHead className="w-[50px] text-xs font-semibold uppercase tracking-wider text-slate-500">{t("campaigns.col.co")}</TableHead>
                <TableHead className="w-[110px] text-xs font-semibold uppercase tracking-wider text-slate-500">{t("campaigns.col.platform")}</TableHead>
                <TableHead className="w-[90px] text-xs font-semibold uppercase tracking-wider text-slate-500">{t("campaigns.col.status")}</TableHead>
                <TableHead className="w-[130px] text-xs font-semibold uppercase tracking-wider text-slate-500">{t("campaigns.col.health")}</TableHead>
                <TableHead className="w-[110px] text-xs font-semibold uppercase tracking-wider text-slate-500">{t("campaigns.col.runTime")}</TableHead>
                {/* ── Cột số liệu ──
                    Bộ cột Google xếp theo cách đọc của Google Ads: tiền trước
                    (Cost → Conv. → Cost/conv) rồi mới tới lưu lượng. Bảng
                    Facebook/All giữ nguyên thứ tự cũ để không xáo trộn thói
                    quen người đang dùng. */}
                {googleView ? (
                  <>
                    <TableHead className="w-[110px] text-right" aria-sort={ariaSort("spend")}>
                      <ThSort col="spend" label={t("campaigns.col.cost")} />
                    </TableHead>
                    <TableHead className="w-[90px] text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{t("campaigns.col.conv")}</TableHead>
                    <TableHead className="w-[110px] text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{t("campaigns.col.costPerConv")}</TableHead>
                    <TableHead className="w-[80px] text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{t("campaigns.col.clicks")}</TableHead>
                    <TableHead className="w-[80px] text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{t("campaigns.col.ctr")}</TableHead>
                    <TableHead className="w-[80px] text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{t("campaigns.col.cpc")}</TableHead>
                    <TableHead className="w-[100px] text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{t("campaigns.col.impr")}</TableHead>
                    <TableHead
                      className="w-[110px] text-right text-xs font-semibold uppercase tracking-wider text-slate-500"
                      title={uniqueUsersError
                        ? t("campaigns.col.uniqueUsersFail", { error: uniqueUsersError })
                        : t("campaigns.col.uniqueUsersTip")}
                    >
                      {t("campaigns.col.uniqueUsers")}
                    </TableHead>
                  </>
                ) : (
                  <>
                    <TableHead className="w-[100px] text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{t("campaigns.col.impr")}</TableHead>
                    <TableHead className="w-[80px] text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{t("campaigns.col.ctr")}</TableHead>
                    <TableHead className="w-[80px] text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{t("campaigns.col.clicks")}</TableHead>
                    <TableHead className="w-[80px] text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{t("campaigns.col.cpc")}</TableHead>
                    {/* Như Ads Manager: Kết quả → Chi phí/kết quả (CPL) → ROAS kết quả → Giá trị kết quả.
                        Kết quả / giá trị lấy theo ĐÚNG loại kết quả chiến dịch đang tối ưu (app/api/meta/campaigns). */}
                    <TableHead className="w-[90px] text-right" aria-sort={ariaSort("results")}>
                      <ThSort col="results" label={t("campaigns.col.results")} />
                    </TableHead>
                    <TableHead className="w-[100px] text-right" aria-sort={ariaSort("cpl")}>
                      <ThSort col="cpl" label={t("campaigns.col.cpl")} />
                    </TableHead>
                    <TableHead className="w-[90px] text-right" aria-sort={ariaSort("resultRoas")} title={t("campaigns.col.resultRoasTip")}>
                      <ThSort col="resultRoas" label={t("campaigns.col.resultRoas")} />
                    </TableHead>
                    <TableHead className="w-[120px] text-right" aria-sort={ariaSort("resultValue")} title={t("campaigns.col.resultValueTip")}>
                      <ThSort col="resultValue" label={t("campaigns.col.resultValue")} />
                    </TableHead>
                  </>
                )}

                {/* ── GA4 Extra Columns ── */}
                {showGA4 && (
                  <>
                    <TableHead className="w-[90px] text-right align-bottom border-l-2 border-amber-200">
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-0.5">GA4</span>
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Sessions</span>
                      </div>
                    </TableHead>
                    <TableHead className="w-[80px] text-right align-bottom">
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-0.5">GA4</span>
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Bounce</span>
                      </div>
                    </TableHead>
                    <TableHead className="w-[90px] text-right align-bottom">
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-0.5">{t("campaigns.ga4.actual")}</span>
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">CVR</span>
                      </div>
                    </TableHead>
                    <TableHead className="w-[80px] text-right align-bottom">
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-0.5">GA4</span>
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Conv.</span>
                      </div>
                    </TableHead>
                    <TableHead className="w-[90px] text-center align-bottom border-r-2 border-amber-200">
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-0.5">GA4</span>
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Quality</span>
                      </div>
                    </TableHead>
                  </>
                )}

                {/* Google view đã có cột Cost (cùng số) ở đầu → bỏ cột này đi
                    cho khỏi hai cột trùng nhau. */}
                {!googleView && (
                  <TableHead className="w-[100px] text-right" aria-sort={ariaSort("spend")}>
                    <ThSort col="spend" label={t("campaigns.col.spend")} />
                  </TableHead>
                )}
                <TableHead className="w-[80px] text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{t("campaigns.col.actions")}</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {/* Loading */}
              {isLoading && Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}

              {/* Empty */}
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={14}>
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
                        <Inbox className="h-6 w-6 text-slate-400" />
                      </div>
                      <p className="text-sm font-medium text-slate-600">{t("campaigns.empty.title")}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {search || platform !== "all"
                          ? t("campaigns.empty.adjustFilters")
                          : t("campaigns.empty.connectAccounts")}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {/* Data rows */}
              {!isLoading &&
                pageRows.map((c) => {
                  const m = c.metrics;
                  const ctrColor = m.ctr > 2 ? "text-green-600" : m.ctr < 1 ? "text-red-500" : "text-slate-600";
                  const roasColor = m.roas > 3 ? "text-green-600 font-bold" : m.roas < 1 ? "text-red-500 font-bold" : "text-slate-700 font-semibold";

                  return (
                    <TableRow
                      key={c.id}
                      className={cn(
                        "border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer",
                        selectedIds.has(c.id) && "bg-blue-50 hover:bg-blue-50"
                      )}
                      onClick={(e) => {
                        // Don't navigate when clicking action buttons or checkboxes
                        if ((e.target as HTMLElement).closest("button")) return;
                        const platformParam = c.platform === "google" ? "google" : "facebook";
                        const companyParam = c.company ? `&company=${c.company}` : "";
                        router.push(`/campaigns/${c.id}?platform=${platformParam}${companyParam}`);
                      }}
                    >
                      {/* Bulk select checkbox */}
                      <TableCell onClick={(e) => { e.stopPropagation(); toggleSelect(c.id); }}>
                        <button className="flex items-center justify-center text-slate-400 hover:text-blue-500">
                          {selectedIds.has(c.id)
                            ? <CheckSquare className="h-4 w-4 text-blue-500" />
                            : <Square className="h-4 w-4" />}
                        </button>
                      </TableCell>
                      {/* Name */}
                      <TableCell className="max-w-[200px]">
                        <div className="flex items-center gap-1.5">
                          {platform === "all" && (
                            <span className={cn(
                              "inline-flex items-center rounded px-1 py-0.5 text-[9px] font-bold shrink-0",
                              c.platform === "facebook"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-red-100 text-red-600"
                            )}>
                              {c.platform === "facebook" ? "FB" : "GG"}
                            </span>
                          )}
                          <span
                            className="block truncate font-semibold text-slate-800 text-sm"
                            title={c.name}
                          >
                            {c.name}
                          </span>
                        </div>
                        <span className="text-xs text-slate-400 capitalize">
                          {c.objective}
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          {c.platform === "google" && (c as any).channelType && (
                            <span className="ml-1 text-[10px] text-slate-300">
                              · {(c as any).channelType}
                            </span>
                          )}
                        </span>
                      </TableCell>

                      {/* Company */}
                      <TableCell>
                        {(() => {
                          const co = getCompany(c.name);
                          if (!co) return <span className="text-slate-300 text-xs">—</span>;
                          return (
                            <span className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold",
                              co === "MBC" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                            )}>{co}</span>
                          );
                        })()}
                      </TableCell>

                      {/* Platform */}
                      <TableCell>
                        <PlatformBadge platform={c.platform} />
                      </TableCell>

                      {/* Status */}
                      <TableCell>
                        <StatusBadge status={c.status} />
                      </TableCell>

                      {/* Health */}
                      <TableCell>
                        <HealthBadge badge={getCampaignHealthBadge(c, t, intl)} />
                      </TableCell>

                      {/* Thời gian chạy */}
                      <TableCell>
                        {(() => {
                          const dur = getCampaignDuration(c.startDate, c.endDate);
                          return (
                            <span
                              className={cn("text-xs font-medium", dur.hasEnded ? "text-slate-400" : "text-slate-600")}
                              title={dur.detail}
                            >
                              {dur.label}
                            </span>
                          );
                        })()}
                      </TableCell>

                      {/* ── Ô số liệu, thứ tự khớp tiêu đề cột ở trên ── */}
                      {googleView ? (
                        <>
                          {/* Cost — chính là spend, đã ở đơn vị đồng */}
                          <TableCell className="text-right text-sm font-semibold text-slate-800 tabular-nums">
                            {fmtSpend(m.spend, currency, intl)}
                          </TableCell>

                          {/* Conversions — Google trả số lẻ (0,5 chuyển đổi là
                              chuyện bình thường với mô hình phân bổ), nên chỉ
                              làm tròn khi đúng là số nguyên. */}
                          <TableCell className="text-right text-sm text-slate-700 tabular-nums">
                            {(() => {
                              // Number(... ?? 0): phòng trường hợp một nguồn nào
                              // đó không set conversions — .toFixed trên undefined
                              // là màn hình trắng, không phải một ô trống.
                              const conv = Number(m.conversions ?? 0);
                              return Number.isInteger(conv) ? fmtNumber(conv, intl) : conv.toFixed(2);
                            })()}
                          </TableCell>

                          {/* Cost/conv — chưa có chuyển đổi nào thì KHÔNG có
                              chi phí mỗi chuyển đổi. Hiện gạch ngang chứ không
                              hiện 0đ (0đ đọc như "được chuyển đổi miễn phí"). */}
                          <TableCell className="text-right text-sm text-slate-600 tabular-nums">
                            {Number(m.conversions ?? 0) > 0
                              ? fmtSpend(m.spend / Number(m.conversions), currency, intl)
                              : <span className="text-slate-300">—</span>}
                          </TableCell>

                          {/* Clicks */}
                          <TableCell className="text-right text-sm text-slate-700 tabular-nums">
                            {fmtNumber(m.clicks, intl)}
                          </TableCell>

                          {/* CTR */}
                          <TableCell className={cn("text-right text-sm font-medium tabular-nums", ctrColor)}>
                            {m.ctr.toFixed(2)}%
                          </TableCell>

                          {/* CPC */}
                          <TableCell className="text-right text-sm text-slate-600 tabular-nums">
                            {fmtSpend(m.cpc, currency, intl)}
                          </TableCell>

                          {/* Impressions */}
                          <TableCell className="text-right text-sm text-slate-600 tabular-nums">
                            {fmtNumber(m.impressions, intl)}
                          </TableCell>

                          {/* Người dùng duy nhất — null nghĩa là Google không
                              trả cho loại chiến dịch này, KHÁC hẳn 0 người. */}
                          <TableCell className="text-right text-sm text-slate-600 tabular-nums">
                            {typeof m.uniqueUsers === "number"
                              ? fmtNumber(m.uniqueUsers, intl)
                              : <span className="text-slate-300" title={uniqueUsersError ?? t("campaigns.cell.noUniqueUsers")}>—</span>}
                          </TableCell>
                        </>
                      ) : (
                        <>
                          {/* Impressions */}
                          <TableCell className="text-right text-sm text-slate-600 tabular-nums">
                            {fmtNumber(m.impressions, intl)}
                          </TableCell>

                          {/* CTR */}
                          <TableCell className={cn("text-right text-sm font-medium tabular-nums", ctrColor)}>
                            {m.ctr.toFixed(2)}%
                          </TableCell>

                          {/* Clicks */}
                          <TableCell className="text-right text-sm text-slate-700 tabular-nums">
                            {fmtNumber(m.clicks, intl)}
                          </TableCell>

                          {/* CPC — already in major units from API */}
                          <TableCell className="text-right text-sm text-slate-600 tabular-nums">
                            {fmtSpend(m.cpc, currency, intl)}
                          </TableCell>

                          {/* Kết quả */}
                          <TableCell className="text-right text-sm text-slate-700 tabular-nums">
                            {c.platform === "facebook" ? m.conversions.toLocaleString(intl) : <span className="text-slate-300">—</span>}
                          </TableCell>

                          {/* CPL */}
                          <TableCell className="text-right">
                            {(() => {
                               const cplVal = m.conversions > 0 ? m.spend / m.conversions : null;
                               const b = getCplBadge(cplVal, companyOfCampaign(c.name), currency, intl);
                               return (
                                 <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold", b.bg, b.text)} title={t("campaigns.cell.pixelOnly")}>
                                   {b.label}
                                 </span>
                               );
                            })()}
                          </TableCell>

                          {/* ROAS kết quả — "—" khi Meta không có giá trị cho loại kết quả (như Ads Manager) */}
                          <TableCell className="text-right text-sm text-slate-700 tabular-nums">
                            {m.resultRoas != null
                              ? m.resultRoas.toLocaleString(intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                              : <span className="text-slate-300">—</span>}
                          </TableCell>

                          {/* Giá trị kết quả */}
                          <TableCell className="text-right text-sm text-slate-700 tabular-nums">
                            {m.resultValue != null ? fmtMoneyFull(m.resultValue, currency, intl) : <span className="text-slate-300">—</span>}
                          </TableCell>
                        </>
                      )}

                      {/* ── GA4 Data Cells ── */}
                      {showGA4 && (
                        <>
                          <TableCell className="text-right border-l-2 border-amber-200">
                            {c.ga4 ? (() => {
                              const hasMultipleProps = Object.keys(COMPANY_CONFIG).length > 1;
                              return (
                                <div className="flex flex-col items-end gap-0.5">
                                  <span className="tabular-nums text-sm font-semibold text-slate-700">
                                    {c.ga4.sessions.toLocaleString()}
                                  </span>
                                  {hasMultipleProps && (
                                    <span className={cn(
                                      "text-[10px] px-1.5 py-px rounded font-medium",
                                      c.company === "MBC"
                                        ? "bg-blue-50 text-blue-600"
                                        : "bg-violet-50 text-violet-600"
                                    )}>
                                      {c.ga4Source}
                                    </span>
                                  )}
                                </div>
                              );
                            })() : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </TableCell>
                          
                          <TableCell className="text-right">
                            {c.ga4 ? (() => {
                              const pct = (c.ga4.bounceRate * 100);
                              const isBad = pct > 70;
                              return (
                                <span className={cn("tabular-nums text-sm font-medium", isBad ? "text-red-600" : "text-emerald-600")}>
                                  {pct.toFixed(0)}%
                                </span>
                              );
                            })() : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </TableCell>

                          <TableCell className="text-right">
                            {c.ga4 ? (() => {
                              const cvr = (c.ga4.conversionRate * 100);
                              return (
                                <div className="flex flex-col items-end">
                                  <span className="tabular-nums text-sm font-semibold">{cvr.toFixed(2)}%</span>
                                  {c.metrics.conversions > 0 && c.ga4.sessions > 0 && (() => {
                                    const platformCVR = (c.metrics.conversions / c.ga4.sessions) * 100;
                                    const diff = platformCVR - cvr;
                                    if (Math.abs(diff) < 0.5) return null;
                                    return (
                                      <span className={cn("text-[10px] font-medium leading-none mt-0.5", diff > 0 ? "text-amber-500" : "text-blue-500")}>
                                        {diff > 0 ? "▲" : "▼"}{Math.abs(diff).toFixed(1)}%
                                      </span>
                                    );
                                  })()}
                                </div>
                              );
                            })() : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </TableCell>

                          <TableCell className="text-right">
                            {c.ga4 ? (() => {
                              const pConv = c.metrics.conversions || 0;
                              const disc = pConv > 0 ? ((pConv - c.ga4.conversions) / pConv) * 100 : 0;
                              return (
                                <div className="flex flex-col items-end gap-0.5">
                                  <span className="tabular-nums text-sm font-semibold">{c.ga4.conversions.toLocaleString()}</span>
                                  {Math.abs(disc) >= 20 && (
                                    <span 
                                      className={cn("text-[9px] px-1.5 py-0.5 rounded flex items-center font-bold tracking-tight", disc > 0 ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600")}
                                      title={t("campaigns.ga4.discrepancyTip", { platform: pConv, ga4: c.ga4.conversions, pct: disc.toFixed(0) })}
                                    >
                                      {disc > 0 ? "+" : ""}{disc.toFixed(0)}%
                                    </span>
                                  )}
                                </div>
                              );
                            })() : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </TableCell>

                          <TableCell className="text-center border-r-2 border-amber-200">
                            {c.ga4 ? (() => {
                              const score = Math.round(
                                (1 - c.ga4.bounceRate) * 40 +
                                c.ga4.engagementRate * 30 +
                                Math.min(c.ga4.avgSessionDuration / 180, 1) * 30
                              );
                              const label = score >= 70 ? { text: t("campaigns.ga4.good"), bg: "bg-emerald-500", txt: "text-emerald-700" } :
                                            score >= 40 ? { text: t("campaigns.ga4.average"), bg: "bg-amber-400", txt: "text-amber-700" } :
                                                          { text: t("campaigns.ga4.poor"), bg: "bg-red-500", txt: "text-red-700" };
                              
                              return (
                                <div className="flex flex-col items-center gap-1 w-full px-2">
                                  <span className={cn("text-[10px] font-bold leading-none", label.txt)}>{label.text}</span>
                                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div className={cn("h-full rounded-full transition-all", label.bg)} style={{ width: `${Math.max(10, score)}%` }} />
                                  </div>
                                </div>
                              );
                            })() : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </TableCell>
                        </>
                      )}

                      {/* Spend — ở chế độ Google đã hiện thành cột Cost phía
                          trước, không lặp lại. */}
                      {!googleView && (
                        <TableCell className="text-right text-sm font-semibold text-slate-800 tabular-nums">
                          {fmtSpend(m.spend, currency, intl)}
                        </TableCell>
                      )}

                      {/* Actions */}
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                            title={t("campaigns.action.edit")}
                            onClick={() => setEditingBudgetCampaign(c)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
                            title={c.status === "ACTIVE" ? t("campaigns.action.pause") : t("campaigns.action.reactivate")}
                            onClick={() => setConfirmToggleData(c)}
                            disabled={pausingId === c.id}
                          >
                            {pausingId === c.id ? (
                              <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                            ) : c.status === "ACTIVE" ? (
                              <PauseCircle className="h-4 w-4" />
                            ) : (
                              <PlayCircle className="h-4 w-4 text-green-500" />
                            )}
                          </button>
                          <button
                            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-amber-50 hover:text-amber-700"
                            title={t("campaigns.action.cloneTip")}
                            onClick={() => router.push(
                              `/creative?clone=${encodeURIComponent(c.id)}&cloneName=${encodeURIComponent(c.name)}&cloneObj=${encodeURIComponent(c.objective ?? "")}`
                            )}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-slate-400">
            {t("campaigns.page.page")} <span className="font-semibold text-slate-600">{page}</span>/{totalPages}
            <span className="mx-1.5">·</span>
            {t("campaigns.page.total", { n: rows.length })}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ‹
            </button>
            {getPageNumbers(page, totalPages).map((pg, i) =>
              pg === "…" ? (
                <span key={`ellipsis-${i}`} className="flex h-8 w-8 items-center justify-center text-xs text-slate-300">…</span>
              ) : (
                <button
                  key={pg}
                  onClick={() => setPage(pg as number)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-semibold transition-colors",
                    page === pg
                      ? "border-amber-500 bg-amber-500 text-amber-950 shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {pg}
                </button>
              )
            )}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ›
            </button>
          </div>
        </div>
      )}

      {/* ── Bulk Action Toolbar ── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-2xl">
          <span className="text-sm font-semibold text-slate-700">
            {t("campaigns.bulk.selected", { n: selectedIds.size })}
          </span>
          <div className="h-4 w-px bg-slate-200" />
          <button
            disabled={bulkLoading}
            onClick={() => bulkAction("PAUSE")}
            className="flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-700 hover:bg-amber-200 transition-colors disabled:opacity-50"
          >
            {bulkLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PauseCircle className="h-3.5 w-3.5" />}
            {t("campaigns.action.pause")}
          </button>
          <button
            disabled={bulkLoading}
            onClick={() => bulkAction("ACTIVE")}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-200 transition-colors disabled:opacity-50"
          >
            {bulkLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
            {t("campaigns.action.activate")}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Confirmation Modal ── */}
      {confirmToggleData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-2 text-lg font-bold text-slate-900">{t("campaigns.confirm.title")}</h3>
            <p className="mb-6 text-sm text-slate-600">
              {t("campaigns.confirm.lead", { action: confirmToggleData.status === "ACTIVE" ? t("campaigns.confirm.actionPause") : t("campaigns.confirm.actionActivate") })} <strong>{confirmToggleData.name}</strong>{t("campaigns.confirm.tail")}
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setConfirmToggleData(null)}>
                {t("common.cancel")}
              </Button>
              <Button 
                variant={confirmToggleData.status === "ACTIVE" ? "destructive" : "default"}
                onClick={() => {
                  toggleCampaignStatus(confirmToggleData);
                  setConfirmToggleData(null);
                }}
              >
                {confirmToggleData.status === "ACTIVE" ? t("campaigns.action.pause") : t("campaigns.action.activate")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Budget Modal ── */}
      <EditBudgetModal
        campaign={editingBudgetCampaign}
        currency={currency}
        isOpen={!!editingBudgetCampaign}
        onClose={() => setEditingBudgetCampaign(null)}
        onSuccess={(newBudget: number) => {
          if (editingBudgetCampaign) {
            updateCampaignBudget(editingBudgetCampaign.id, newBudget);
          }
        }}
      />
    </div>
  );
}
