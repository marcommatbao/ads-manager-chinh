"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import {
  Building2, TrendingUp, TrendingDown, Minus,
  Sparkles, BarChart2, Loader2, AlertTriangle,
  Zap, Target, Palette,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAdsStore, detectCompany } from "@/store/useAdsStore";
import { formatCurrency } from "@/lib/utils";
import type { Campaign } from "@/types/ads.types";
import { useSession } from "@/components/SessionProvider";
import { isHiddenPage } from "@/lib/hidden-pages";
import { useIntlLocale, useT } from "@/lib/i18n/client";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface CompanyMetrics {
  totalSpend: number;
  cpl: number;
  roas: number;
  activeCampaigns: number;
  needAttention: number;
  totalConversions: number;
  avgCTR: number;
  avgFrequency: number;
}

interface ComparisonRow {
  label: string;
  icon: string;
  mbcValue: string;
  mbiValue: string;
  mbcStatus?: "good" | "warn" | "bad" | "neutral";
  mbiStatus?: "good" | "warn" | "bad" | "neutral";
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function fmtVNDWith(n: number, loc: string): string {
  if (n >= 1_000_000_000) return `₫${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `₫${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₫${(n / 1_000).toFixed(0)}K`;
  return `₫${n.toLocaleString(loc)}`;
}

const STATUS_BADGES: Record<string, { bg: string; text: string; emoji: string }> = {
  good:    { bg: "bg-emerald-100", text: "text-emerald-700", emoji: "🟢" },
  warn:    { bg: "bg-amber-100",   text: "text-amber-700",   emoji: "🟡" },
  bad:     { bg: "bg-red-100",     text: "text-red-700",     emoji: "🔴" },
  neutral: { bg: "bg-slate-100",   text: "text-slate-600",   emoji: "" },
};

// ─────────────────────────────────────────────
// Compute MBC vs MBI metrics from campaigns
// ─────────────────────────────────────────────

function computeCompanyMetrics(allCampaigns: Campaign[]): { mbc: CompanyMetrics; mbi: CompanyMetrics } {
  const groups: Record<string, Campaign[]> = { MBC: [], MBI: [] };
  for (const c of allCampaigns) {
    const co = c.company ?? detectCompany(c.name, c.accountName);
    if (co && groups[co]) groups[co].push(c);
  }

  function calc(camps: Campaign[]): CompanyMetrics {
    const active = camps.filter(c => c.status === "ACTIVE");
    const totalSpend = camps.reduce((s, c) => s + (c.metrics?.spend ?? 0), 0);
    const totalConversions = camps.reduce((s, c) => s + (c.metrics?.conversions ?? 0), 0);
    const totalImps = camps.reduce((s, c) => s + (c.metrics?.impressions ?? 0), 0);
    const totalClicks = camps.reduce((s, c) => s + (c.metrics?.clicks ?? 0), 0);
    const cpl = totalConversions > 0 ? totalSpend / totalConversions : 0;
    const avgCTR = totalImps > 0 ? (totalClicks / totalImps) * 100 : 0;

    // ROAS: weighted average
    const roas = totalSpend > 0
      ? camps.reduce((s, c) => s + (c.metrics?.roas ?? 0) * (c.metrics?.spend ?? 0), 0) / totalSpend
      : 0;

    // Frequency: weighted average by impressions
    const avgFrequency = totalImps > 0
      ? camps.reduce((s, c) => s + (c.metrics?.frequency ?? 0) * (c.metrics?.impressions ?? 0), 0) / totalImps
      : 0;

    // Need attention: campaigns with high CPL or low CTR
    const needAttention = active.filter(c => {
      const m = c.metrics;
      if (!m) return false;
      const freq = m.frequency ?? 0;
      const ctr = totalImps > 0 ? (m.clicks / Math.max(1, m.impressions)) * 100 : 0;
      return freq > 3.5 || ctr < 0.5 || (m.spend > 200000 && m.conversions === 0);
    }).length;

    return {
      totalSpend,
      cpl,
      roas,
      activeCampaigns: active.length,
      needAttention,
      totalConversions,
      avgCTR,
      avgFrequency,
    };
  }

  return {
    mbc: calc(groups.MBC || []),
    mbi: calc(groups.MBI || []),
  };
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function CompanyComparison() {
  const { user } = useSession();
  const { campaigns, isLoading } = useAdsStore();
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const t = useT();
  const loc = useIntlLocale();

  // Only super_admin can see this widget
  if (!user || user.role !== "super_admin") return null;

  const fmtVND = (n: number) => fmtVNDWith(n, loc);
  const { mbc, mbi } = computeCompanyMetrics(campaigns);

  const rows: ComparisonRow[] = [
    {
      label: t("overview.compare.row.totalSpend"),
      icon: "💰",
      mbcValue: fmtVND(mbc.totalSpend),
      mbiValue: fmtVND(mbi.totalSpend),
      mbcStatus: "neutral",
      mbiStatus: "neutral",
    },
    {
      label: t("overview.compare.row.avgCpl"),
      icon: "🎯",
      mbcValue: mbc.cpl > 0 ? fmtVND(mbc.cpl) : "—",
      mbiValue: mbi.cpl > 0 ? fmtVND(mbi.cpl) : "—",
      mbcStatus: mbc.cpl > 0 ? (mbc.cpl <= 99000 ? "good" : mbc.cpl <= 130000 ? "warn" : "bad") : "neutral",
      mbiStatus: mbi.cpl > 0 ? (mbi.cpl <= 250000 ? "good" : mbi.cpl <= 320000 ? "warn" : "bad") : "neutral",
    },
    {
      label: t("overview.compare.row.roas"),
      icon: "📈",
      mbcValue: `${mbc.roas.toFixed(1)}x`,
      mbiValue: `${mbi.roas.toFixed(1)}x`,
      mbcStatus: mbc.roas >= 3 ? "good" : mbc.roas >= 2 ? "warn" : "bad",
      mbiStatus: mbi.roas >= 3 ? "good" : mbi.roas >= 2 ? "warn" : "bad",
    },
    {
      label: t("overview.compare.row.activeCampaigns"),
      icon: "📊",
      mbcValue: String(mbc.activeCampaigns),
      mbiValue: String(mbi.activeCampaigns),
      mbcStatus: "neutral",
      mbiStatus: "neutral",
    },
    {
      label: t("overview.compare.row.needAttention"),
      icon: "⚠️",
      mbcValue: String(mbc.needAttention),
      mbiValue: String(mbi.needAttention),
      mbcStatus: mbc.needAttention > 3 ? "bad" : mbc.needAttention > 0 ? "warn" : "good",
      mbiStatus: mbi.needAttention > 3 ? "bad" : mbi.needAttention > 0 ? "warn" : "good",
    },
    {
      label: t("overview.compare.row.avgCtr"),
      icon: "👆",
      mbcValue: `${mbc.avgCTR.toFixed(2)}%`,
      mbiValue: `${mbi.avgCTR.toFixed(2)}%`,
      mbcStatus: mbc.avgCTR >= 2 ? "good" : mbc.avgCTR >= 1 ? "warn" : "bad",
      mbiStatus: mbi.avgCTR >= 2 ? "good" : mbi.avgCTR >= 1 ? "warn" : "bad",
    },
    {
      label: t("overview.compare.row.conversions"),
      icon: "🏆",
      mbcValue: mbc.totalConversions.toLocaleString(loc),
      mbiValue: mbi.totalConversions.toLocaleString(loc),
      mbcStatus: "neutral",
      mbiStatus: "neutral",
    },
  ];

  const generateInsight = async () => {
    setLoadingAI(true);
    setAiError(null);
    try {
      // Lời nhắc gửi AI cũng theo ngôn ngữ đang chọn để câu trả lời cùng ngôn ngữ với giao diện.
      const line = (co: string, m: CompanyMetrics) => t("overview.compare.ai.line", {
        co, spend: fmtVND(m.totalSpend), cpl: fmtVND(m.cpl), roas: m.roas.toFixed(1), active: m.activeCampaigns,
        ctr: m.avgCTR.toFixed(2), conv: m.totalConversions,
      });
      const prompt = t("overview.compare.ai.prompt", { mbc: line("MBC", mbc), mbi: line("MBI", mbi) });

      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, type: "company_comparison" }),
      });
      const json = await res.json();
      if (json.success && json.data?.text) {
        setAiInsight(json.data.text);
      } else {
        setAiInsight(null);
        setAiError(t("overview.compare.ai.error"));
      }
    } catch {
      setAiInsight(null);
      setAiError(t("overview.compare.ai.error"));
    } finally {
      setLoadingAI(false);
    }
  };

  // No data yet
  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
        <div className="h-48 animate-pulse bg-slate-50 rounded-lg" />
      </div>
    );
  }

  if (campaigns.length === 0) return null;

  return (
    <div className="rounded-xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50/40 via-white to-violet-50/40 shadow-sm overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 p-2 shadow-md shadow-indigo-200">
            <Building2 className="h-4 w-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">{t("overview.compare.title")}</h3>
            <p className="text-[10px] text-slate-400">{t("overview.compare.subtitle")}</p>
          </div>
        </div>
        <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[9px] font-bold text-indigo-600">
          {t("overview.compare.superAdmin")}
        </span>
      </div>

      {/* ── Comparison Table ── */}
      <div className="px-5 pb-4">
        <div className="overflow-hidden rounded-xl border border-slate-200">
          {/* Table header */}
          <div className="grid grid-cols-[1fr,140px,140px] bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <div className="px-4 py-2.5">{t("overview.compare.colMetric")}</div>
            <div className="px-4 py-2.5 text-center border-l border-slate-200">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-blue-500" /> MBC
              </span>
            </div>
            <div className="px-4 py-2.5 text-center border-l border-slate-200">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-violet-500" /> MBI
              </span>
            </div>
          </div>

          {/* Table rows */}
          {rows.map((row, i) => (
            <div
              key={row.label}
              className={cn(
                "grid grid-cols-[1fr,140px,140px] text-xs border-t border-slate-100",
                i % 2 === 0 ? "bg-white" : "bg-slate-50/50"
              )}
            >
              <div className="px-4 py-2.5 text-slate-600 flex items-center gap-1.5">
                <span>{row.icon}</span>
                <span className="font-medium">{row.label}</span>
              </div>
              <div className="px-4 py-2.5 text-center border-l border-slate-100">
                <span className="font-semibold text-slate-800">{row.mbcValue}</span>
                {row.mbcStatus && row.mbcStatus !== "neutral" && (
                  <span className="ml-1">{STATUS_BADGES[row.mbcStatus].emoji}</span>
                )}
              </div>
              <div className="px-4 py-2.5 text-center border-l border-slate-100">
                <span className="font-semibold text-slate-800">{row.mbiValue}</span>
                {row.mbiStatus && row.mbiStatus !== "neutral" && (
                  <span className="ml-1">{STATUS_BADGES[row.mbiStatus].emoji}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ── AI Insight ── */}
        <div className="mt-4">
          {aiInsight ? (
            <div className="rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 p-4">
              <div className="flex items-start gap-2">
                <Sparkles className="h-4 w-4 text-violet-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wider mb-1">AI Insight (Gemini)</p>
                  <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">{aiInsight}</p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={generateInsight}
                disabled={loadingAI}
                className="w-full rounded-xl border-2 border-dashed border-violet-200 py-3 text-xs font-semibold text-violet-500 hover:border-violet-400 hover:bg-violet-50 transition-all flex items-center justify-center gap-1.5"
              >
                {loadingAI ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("overview.compare.ai.analyzing")}</>
                ) : (
                  <><Sparkles className="h-3.5 w-3.5" /> {t("overview.compare.ai.generate")}</>
                )}
              </button>
              {aiError && (
                <p className="mt-1.5 flex items-center gap-1 text-[10px] text-red-500">
                  <AlertTriangle className="h-3 w-3" /> {aiError}
                </p>
              )}
            </>
          )}
        </div>

        {/* ── Action buttons ── */}
        <div className="mt-3 flex items-center gap-2">
          {/* Ẩn /reports thì ẩn luôn hai nút này — xem lib/hidden-pages.ts */}
          {!isHiddenPage("/reports") && (
            <>
              <Link href="/reports?company=MBC">
                <Button variant="outline" size="sm" className="gap-1 text-[10px] h-7 border-blue-200 text-blue-600 hover:bg-blue-50">
                  <BarChart2 className="h-3 w-3" /> {t("overview.compare.report", { co: "MBC" })}
                </Button>
              </Link>
              <Link href="/reports?company=MBI">
                <Button variant="outline" size="sm" className="gap-1 text-[10px] h-7 border-violet-200 text-violet-600 hover:bg-violet-50">
                  <BarChart2 className="h-3 w-3" /> {t("overview.compare.report", { co: "MBI" })}
                </Button>
              </Link>
            </>
          )}
          {aiInsight && (
            <button
              onClick={generateInsight}
              className="ml-auto text-[10px] text-violet-400 hover:text-violet-600 flex items-center gap-1"
            >
              <Sparkles className="h-3 w-3" /> {t("overview.compare.ai.regenerate")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
