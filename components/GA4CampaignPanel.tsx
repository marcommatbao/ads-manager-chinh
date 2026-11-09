"use client";

import { useState } from "react";
import { X, BarChart3, TrendingUp, TrendingDown, Clock, Users, MousePointerClick, ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GA4CampaignData } from "@/lib/ga4-client";
import { formatGA4Duration } from "@/lib/ga4-client";

// ─────────────────────────────────────────────
// GA4 KPI Card
// ─────────────────────────────────────────────

function GA4KpiCard({
  label, value, sub, icon, trend,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  trend?: "good" | "bad" | "neutral";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-slate-500 mb-2">
        <span className="text-lg">{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold text-slate-800 tabular-nums">{value}</p>
      {sub && (
        <p className={cn(
          "text-xs mt-1",
          trend === "good" ? "text-emerald-600" :
          trend === "bad" ? "text-red-600" : "text-slate-400"
        )}>
          {sub}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Quality Bar
// ─────────────────────────────────────────────

function QualityBar({
  label, value, format, good, bad,
}: {
  label: string;
  value: number;
  format: "percent" | "number" | "duration";
  good: number;
  bad: number;
}) {
  const pct = Math.min(100, Math.max(0, (value / (good * 1.5)) * 100));
  const isGood = value >= good;
  const isBad = value <= bad;
  const color = isGood ? "bg-emerald-500" : isBad ? "bg-red-500" : "bg-amber-500";

  let formatted = "";
  if (format === "percent") formatted = (value * 100).toFixed(1) + "%";
  else if (format === "duration") formatted = formatGA4Duration(value);
  else formatted = value.toFixed(1);

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 w-32 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn(
        "text-xs font-semibold tabular-nums w-16 text-right",
        isGood ? "text-emerald-600" : isBad ? "text-red-600" : "text-amber-600"
      )}>
        {formatted}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────
// Conversion Discrepancy Badge (inline)
// ─────────────────────────────────────────────

export function ConversionDiscrepancyBadge({
  adPlatformConv, ga4Conv,
}: {
  adPlatformConv: number;
  ga4Conv: number;
}) {
  if (!ga4Conv || !adPlatformConv) return null;
  const discrepancy = ((adPlatformConv - ga4Conv) / adPlatformConv) * 100;
  if (Math.abs(discrepancy) < 20) return null;

  return (
    <span
      title={`Platform: ${adPlatformConv} | GA4: ${ga4Conv} — Chênh ${discrepancy.toFixed(0)}%`}
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded-full font-bold cursor-help inline-block ml-1",
        discrepancy > 30
          ? "bg-red-100 text-red-700"
          : "bg-amber-100 text-amber-700"
      )}
    >
      {discrepancy > 0 ? "▲" : "▼"}{Math.abs(discrepancy).toFixed(0)}%
    </span>
  );
}

// ─────────────────────────────────────────────
// GA4 Inline Columns (for Campaign Table)
// ─────────────────────────────────────────────

export function GA4InlineCells({ ga4 }: { ga4: GA4CampaignData | null }) {
  if (!ga4) {
    return (
      <>
        <td className="px-3 py-2 text-xs text-slate-300 text-center">—</td>
        <td className="px-3 py-2 text-xs text-slate-300 text-center">—</td>
        <td className="px-3 py-2 text-xs text-slate-300 text-center">—</td>
        <td className="px-3 py-2 text-xs text-slate-300 text-center">—</td>
      </>
    );
  }

  const bounceColor = ga4.bounceRate > 0.7 ? "text-red-600" : ga4.bounceRate > 0.5 ? "text-amber-600" : "text-emerald-600";

  return (
    <>
      <td className="px-3 py-2 text-xs font-semibold text-slate-700 text-right tabular-nums">
        {ga4.sessions.toLocaleString()}
      </td>
      <td className={cn("px-3 py-2 text-xs font-semibold text-right tabular-nums", bounceColor)}>
        {(ga4.bounceRate * 100).toFixed(1)}%
      </td>
      <td className="px-3 py-2 text-xs font-semibold text-indigo-600 text-right tabular-nums">
        {(ga4.conversionRate * 100).toFixed(2)}%
      </td>
      <td className="px-3 py-2 text-xs font-semibold text-slate-700 text-right tabular-nums">
        {ga4.conversions.toLocaleString()}
      </td>
    </>
  );
}

// ─────────────────────────────────────────────
// GA4 Campaign Detail Panel (Slide-out)
// ─────────────────────────────────────────────

interface GA4PanelProps {
  ga4: GA4CampaignData;
  campaignName: string;
  platform: string;
  platformConversions?: number;
  onClose: () => void;
}

export function GA4CampaignPanel({ ga4, campaignName, platform, platformConversions, onClose }: GA4PanelProps) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm">
      <div
        className="w-full max-w-xl bg-white shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-indigo-500" />
              GA4 Analytics
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate max-w-sm">{campaignName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* KPI Row */}
          <div className="grid grid-cols-2 gap-3">
            <GA4KpiCard
              label="Sessions"
              value={ga4.sessions.toLocaleString()}
              sub="Phiên truy cập thật"
              icon={<Users className="h-4 w-4" />}
            />
            <GA4KpiCard
              label="Bounce Rate"
              value={(ga4.bounceRate * 100).toFixed(1) + "%"}
              sub={ga4.bounceRate > 0.7 ? "⚠️ Quá cao" : "✓ Ổn"}
              trend={ga4.bounceRate > 0.7 ? "bad" : "good"}
              icon="↩️"
            />
            <GA4KpiCard
              label="CVR Thật"
              value={(ga4.conversionRate * 100).toFixed(2) + "%"}
              sub={`${ga4.conversions} conversions / ${ga4.sessions} sessions`}
              icon={<MousePointerClick className="h-4 w-4" />}
            />
            <GA4KpiCard
              label="Thời gian TB"
              value={formatGA4Duration(ga4.avgSessionDuration)}
              sub="Mỗi phiên truy cập"
              trend={ga4.avgSessionDuration > 120 ? "good" : ga4.avgSessionDuration < 30 ? "bad" : "neutral"}
              icon={<Clock className="h-4 w-4" />}
            />
          </div>

          {/* Comparison Table */}
          {platformConversions !== undefined && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <ArrowLeftRight className="h-3.5 w-3.5 text-indigo-500" />
                  So sánh Platform vs GA4
                </p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="text-left px-4 py-2 text-slate-400 font-medium">Metric</th>
                    <th className="text-right px-4 py-2 text-slate-400 font-medium">
                      {platform === "facebook" ? "🔵 FB báo" : "🔴 GG báo"}
                    </th>
                    <th className="text-right px-4 py-2 text-slate-400 font-medium">📊 GA4 (thật)</th>
                    <th className="text-right px-4 py-2 text-slate-400 font-medium">Chênh lệch</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-100">
                    <td className="px-4 py-2.5 font-medium text-slate-700">Conversions</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{platformConversions.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-indigo-700">{ga4.conversions.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">
                      {platformConversions > 0 && (() => {
                        const diff = ((platformConversions - ga4.conversions) / platformConversions * 100);
                        return (
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-bold",
                            diff > 20 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                          )}>
                            {diff > 0 ? "+" : ""}{diff.toFixed(0)}%
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="px-4 py-2.5 font-medium text-slate-700">Sessions</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">—</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-indigo-700">{ga4.sessions.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-slate-300">—</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-medium text-slate-700">Revenue</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">—</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-indigo-700">
                      {ga4.revenue > 0 ? `₫${ga4.revenue.toLocaleString("vi-VN")}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-300">—</td>
                  </tr>
                </tbody>
              </table>
              <div className="px-4 py-2.5 bg-blue-50/60 border-t border-slate-100">
                <p className="text-[10px] text-blue-600">
                  💡 Chênh lệch lớn thường do FB/GG tính view-through conversion, còn GA4 chỉ tính click-through. Số GA4 gần thật nhất.
                </p>
              </div>
            </div>
          )}

          {/* Engagement Quality */}
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-bold text-slate-700 mb-3">Chất lượng traffic</p>
            <div className="flex flex-col gap-3">
              <QualityBar label="Engagement Rate" value={ga4.engagementRate} format="percent" good={0.5} bad={0.25} />
              <QualityBar label="Pages / Session" value={ga4.pagesPerSession} format="number" good={3} bad={1.5} />
              <QualityBar label="Avg. Duration" value={ga4.avgSessionDuration} format="duration" good={120} bad={30} />
            </div>
          </div>

          {/* New Users */}
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-700">New Users</p>
                <p className="text-2xl font-bold text-slate-800 mt-1">{ga4.newUsers.toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400">% New</p>
                <p className="text-lg font-bold text-indigo-600">
                  {ga4.sessions > 0 ? ((ga4.newUsers / ga4.sessions) * 100).toFixed(1) : 0}%
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
