"use client";

import { useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { ReportData } from "@/types/ads.types";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";

// ---- Props ----
interface ChartPanelProps {
  data: ReportData[];
  isLoading?: boolean;
}

type Tab = "spend" | "ctr";

// ---- Helpers ----
function fmtDate(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function fmtMoney(v: number, t: TFunction, intl: string) {
  if (v >= 1_000_000_000) return `₫${(v / 1_000_000_000).toFixed(1)}${t("panels.chart.unitB")}`;
  if (v >= 1_000_000)     return `₫${(v / 1_000_000).toFixed(1)}${t("panels.chart.unitM")}`;
  if (v >= 1_000)         return `₫${(v / 1_000).toFixed(0)}K`;
  return `₫${Math.round(v).toLocaleString(intl)}`;
}

// ---- Custom Tooltip ----
interface TooltipPayloadItem {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  tab: Tab;
}

function CustomTooltip({ active, payload, label, tab }: CustomTooltipProps) {
  const t = useT();
  const intl = useIntlLocale();
  if (!active || !payload?.length) return null;

  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: "#0F172A", color: "#fff", minWidth: 140 }}
    >
      <p className="mb-1.5 font-semibold text-white/60">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center justify-between gap-4">
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span className="font-semibold text-white">
            {tab === "spend"
              ? fmtMoney(entry.value, t, intl)
              : entry.dataKey === "roas"
              ? `${entry.value.toFixed(2)}x`
              : `${entry.value.toFixed(2)}%`}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---- Skeleton ----
function ChartSkeleton() {
  return (
    <div className="h-[200px] md:h-[280px] w-full animate-pulse rounded-lg bg-slate-100 flex items-end gap-2 px-2 md:px-4 pb-4">
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="flex-1 rounded-t bg-slate-200"
          style={{ height: `${30 + ((i * 17) % 60)}%` }}
        />
      ))}
    </div>
  );
}

// ---- Main Component ----
export default function ChartPanel({ data, isLoading = false }: ChartPanelProps) {
  const t = useT();
  const intl = useIntlLocale();
  const [activeTab, setActiveTab] = useState<Tab>("spend");

  // Aggregate by date — track raw values, compute derived fields at end
  const aggregated = Object.values(
    data.reduce<Record<string, {
      date: string;
      fbSpend: number;
      ggSpend: number;
      spend: number;
      clicks: number;
      impressions: number;
    }>>(
      (acc, row) => {
        if (!acc[row.date]) {
          acc[row.date] = { date: row.date, fbSpend: 0, ggSpend: 0, spend: 0, clicks: 0, impressions: 0 };
        }
        acc[row.date].spend       += row.spend;
        acc[row.date].clicks      += row.clicks;
        acc[row.date].impressions += row.impressions ?? 0;
        if (row.platform === "facebook") {
          acc[row.date].fbSpend += row.spend;
        } else {
          acc[row.date].ggSpend += row.spend;
        }
        return acc;
      },
      {}
    )
  )
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({
      ...row,
      date: fmtDate(row.date),
      ctr:  row.impressions > 0 ? Math.round((row.clicks / row.impressions) * 10000) / 100 : 0,
    }));

  const isEmpty = aggregated.length === 0;
  const hasFbData = aggregated.some(r => r.fbSpend > 0);
  const hasGgData = aggregated.some(r => r.ggSpend > 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">
            {activeTab === "spend" ? t("panels.chart.spendTitle") : t("panels.chart.ctrTitle")}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {activeTab === "spend"
              ? t("panels.chart.spendSub")
              : t("panels.chart.ctrSub")}
          </p>
        </div>

        {/* Tab toggle */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {(
            [
              { key: "spend", label: t("panels.chart.spendTitle") },
              { key: "ctr",   label: t("panels.chart.ctrTitle") },
            ] as { key: Tab; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150 whitespace-nowrap",
                activeTab === key
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      {isLoading ? (
        <ChartSkeleton />
      ) : isEmpty ? (
        <div className="flex h-[200px] md:h-[280px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50">
          <p className="text-sm text-slate-400">
            {t("panels.chart.empty")}
          </p>
        </div>
      ) : activeTab === "spend" ? (
        /* ── Area Chart: Facebook vs Google spend ── */
        <div className="h-[220px] md:h-[280px] w-full mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={aggregated} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="fbGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#1877F2" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#1877F2" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ggGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#EA4335" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#EA4335" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#8B5CF6" stopOpacity={0.1} />
                  <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={(v: number) => fmtMoney(v, t, intl)}
                tick={{ fontSize: 11, fill: "#94A3B8" }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip content={<CustomTooltip tab="spend" />} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" iconSize={8} />

              {/* Total spend (purple, background) */}
              <Area
                type="monotone"
                dataKey="spend"
                name={t("panels.chart.total")}
                stroke="#8B5CF6"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                fill="url(#totalGrad)"
                dot={false}
              />

              {/* Facebook (blue) */}
              {hasFbData && (
                <Area
                  type="monotone"
                  dataKey="fbSpend"
                  name="🔵 Facebook"
                  stroke="#1877F2"
                  strokeWidth={2}
                  fill="url(#fbGrad)"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              )}

              {/* Google (red) */}
              {hasGgData && (
                <Area
                  type="monotone"
                  dataKey="ggSpend"
                  name="🔴 Google"
                  stroke="#EA4335"
                  strokeWidth={2}
                  fill="url(#ggGrad)"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        /* ── Line Chart: CTR ── */
        <div className="h-[220px] md:h-[280px] w-full mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={aggregated} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                tick={{ fontSize: 11, fill: "#3B82F6" }}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <Tooltip content={<CustomTooltip tab="ctr" />} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" iconSize={8} />
              <Line type="monotone" dataKey="ctr" name="CTR (%)" stroke="#3B82F6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Note */}
      {activeTab === "spend" && !isEmpty && (
        <p className="mt-2 text-[10px] text-slate-400 text-center">
          {t("panels.chart.note")}
        </p>
      )}
    </div>
  );
}
