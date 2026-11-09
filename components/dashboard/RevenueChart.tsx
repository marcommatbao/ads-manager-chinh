"use client";

// ============================================================
// RevenueChart — Doanh thu Odoo theo tháng (Dashboard)
// Nguồn: /api/odoo/revenue-monthly → Mắt Bão Report API (Odoo)
// Cột = doanh thu (VND), đường = số đơn MBI đã thanh toán.
// ============================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
  ReferenceLine,
} from "recharts";
import { TrendingUp, ShoppingCart, RefreshCw, AlertTriangle, BarChart3, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { TFunction } from "@/lib/i18n/translate";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface MonthRevenue {
  month:        string;
  monthLabel:   string;
  orders:       number;
  invoiceCount: number;
  revenue:      number;
}

interface MonthlyReport {
  months:       MonthRevenue[];
  totalRevenue: number;
  totalOrders:  number;
  avgRevenue:   number;
  source:       string;
  generatedAt:  string;
}

const RANGE_OPTIONS = [
  { key: 6,  label: "overview.revchart.range6"  },
  { key: 12, label: "overview.revchart.range12" },
] as const satisfies ReadonlyArray<{ key: number; label: MessageKey }>;

type ViewMode = "preset" | "range";

/** "YYYY-MM" for `offset` months back from current month (0 = this month). */
function monthValue(offset: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────
// VND formatter
// ─────────────────────────────────────────────

/** Full VND with VN thousand separators, e.g. "8.442.011.743 ₫". */
function fmtVNDLoc(v: number, loc: string): string {
  return `${Math.round(v).toLocaleString(loc)} ₫`;
}

function useFmt() {
  const loc = useIntlLocale();
  return { loc, fmtVND: (v: number) => fmtVNDLoc(v, loc) };
}

/** Compact format — only for the Y-axis scale ticks. */
function fmtAxis(v: number, t: TFunction): string {
  if (v >= 1_000_000_000) return t("overview.revchart.axisB", { v: (v / 1_000_000_000).toFixed(1) });
  if (v >= 1_000_000)     return t("overview.revchart.axisM", { v: (v / 1_000_000).toFixed(0) });
  if (v >= 1_000)         return `${(v / 1_000).toFixed(0)}k`;
  return `${v}`;
}

// ─────────────────────────────────────────────
// Tooltip
// ─────────────────────────────────────────────

function pctClass(p: number): string {
  return p >= 100 ? "text-emerald-600" : p >= 80 ? "text-amber-600" : "text-red-500";
}
function KpiNote({ actual, target, isMoney }: { actual: number; target?: number | null; isMoney?: boolean }) {
  const t = useT();
  const { loc, fmtVND } = useFmt();
  if (!target) return null;
  const pct = Math.round((actual / target) * 100);
  const diff = actual - target;
  const diffStr = isMoney ? fmtVND(Math.abs(diff)) : Math.abs(diff).toLocaleString(loc);
  return (
    <p className="text-[10px] mt-0.5 pl-3.5">
      <span className="text-slate-400">KPI {isMoney ? fmtVND(target) : target.toLocaleString(loc)} · </span>
      <span className={cn("font-bold", pctClass(pct))}>{pct}%</span>
      <span className="text-slate-400"> ({diff >= 0 ? t("overview.revchart.over") : t("overview.revchart.under")} {diffStr})</span>
    </p>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; payload: MonthRevenue & { revenueTarget?: number | null; ordersTarget?: number | null } }>;
  label?: string;
}) {
  const t = useT();
  const { loc, fmtVND } = useFmt();
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 shadow-xl rounded-xl p-3 text-xs min-w-[190px]">
      <p className="text-slate-500 font-semibold mb-2">{label}</p>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-slate-600">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-600" /> {t("overview.revchart.ttRevenue")}
        </span>
        <span className="font-bold text-slate-800">{fmtVND(row.revenue)}</span>
      </div>
      <KpiNote actual={row.revenue} target={row.revenueTarget} isMoney />
      <div className="flex items-center justify-between gap-3 mt-1.5">
        <span className="flex items-center gap-1.5 text-slate-600">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" /> {t("overview.revchart.ttOrders")}
        </span>
        <span className="font-bold text-slate-800">{row.orders.toLocaleString(loc)}</span>
      </div>
      <KpiNote actual={row.orders} target={row.ordersTarget} />
      <div className="flex items-center justify-between gap-3 mt-1.5 pt-1 border-t border-slate-100">
        <span className="text-slate-500">{t("overview.revchart.ttInvoices")}</span>
        <span className="font-semibold text-slate-600">{row.invoiceCount.toLocaleString(loc)}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export default function RevenueChart() {
  const t = useT();
  const { loc, fmtVND } = useFmt();
  const [mode,      setMode]      = useState<ViewMode>("preset");
  const [months,    setMonths]    = useState(6);
  const [fromMonth, setFromMonth] = useState(() => monthValue(5)); // 6 tháng gần nhất
  const [toMonth,   setToMonth]   = useState(() => monthValue(0));
  const [chartMode, setChartMode] = useState<"value" | "pct">("value");
  const [data,      setData]      = useState<MonthlyReport | null>(null);
  const [kpiMap,    setKpiMap]    = useState<Record<string, { rev: number; ord: number }>>({});
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  const query =
    mode === "range"
      ? `from=${fromMonth}&to=${toMonth}`
      : `months=${months}`;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/odoo/revenue-monthly?${query}`);
      const json = (await res.json()) as { success: boolean; data?: MonthlyReport; error?: string };
      if (!json.success || !json.data) throw new Error(json.error ?? t("overview.revchart.errUnknown"));
      setData(json.data);

      // KPI targets cho các năm xuất hiện trong dữ liệu
      const years = Array.from(new Set(json.data.months.map(m => m.month.slice(0, 4))));
      const map: Record<string, { rev: number; ord: number }> = {};
      await Promise.all(years.map(async (y) => {
        try {
          const kr = await fetch(`/api/settings/kpi?year=${y}`);
          const kt = await kr.text();
          const kj = kt ? JSON.parse(kt) : {};
          if (kj.success && Array.isArray(kj.months)) {
            kj.months.forEach((mk: { revenueMbc?: number; ordersMbi?: number }, i: number) => {
              map[`${y}-${String(i + 1).padStart(2, "0")}`] = { rev: mk.revenueMbc || 0, ord: mk.ordersMbi || 0 };
            });
          }
        } catch { /* KPI optional */ }
      }));
      setKpiMap(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("overview.revchart.errConn"));
    } finally {
      setLoading(false);
    }
  }, [query, t]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Gộp KPI target vào từng tháng (null nếu chưa nhập → đường target bỏ qua)
  const chartData = useMemo(() =>
    (data?.months ?? []).map(m => {
      const k = kpiMap[m.month];
      return {
        ...m,
        revenueTarget: k?.rev || null,
        ordersTarget: k?.ord || null,
        revenuePct: k?.rev ? Math.round((m.revenue / k.rev) * 100) : null,
        ordersPct: k?.ord ? Math.round((m.orders / k.ord) * 100) : null,
      };
    }), [data, kpiMap]);

  const hasKpi = useMemo(() => Object.keys(kpiMap).length > 0 && chartData.some(d => d.revenuePct !== null || d.ordersPct !== null), [kpiMap, chartData]);

  const trend =
    data && data.months.length >= 2
      ? data.months[data.months.length - 1].revenue - data.months[data.months.length - 2].revenue
      : 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-blue-50 p-2">
            <BarChart3 className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-800">{t("overview.revchart.title")}</h2>
            <p className="text-[11px] text-slate-400">{t("overview.revchart.source")}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
          {hasKpi && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              {([["value", "overview.revchart.modeValue"], ["pct", "overview.revchart.modePct"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setChartMode(k)}
                  className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold transition-all", chartMode === k ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
                  {t(l)}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.key}
                onClick={() => { setMode("preset"); setMonths(r.key); }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  mode === "preset" && months === r.key
                    ? "bg-white text-blue-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                )}
              >
                {t(r.label)}
              </button>
            ))}
            <button
              onClick={() => setMode("range")}
              className={cn(
                "flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                mode === "range" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Calendar className="h-3 w-3" /> {t("overview.revchart.custom")}
            </button>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 transition-colors disabled:opacity-50"
            aria-label={t("overview.revchart.refresh")}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* ── Month range picker (Tùy chọn) ── */}
      {mode === "range" && (
        <div className="flex flex-wrap items-end gap-3 mb-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">{t("overview.revchart.fromMonth")}</label>
            <input
              type="month"
              value={fromMonth}
              max={toMonth}
              onChange={(e) => setFromMonth(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-blue-400"
            />
          </div>
          <span className="pb-2 text-slate-400">→</span>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">{t("overview.revchart.toMonth")}</label>
            <input
              type="month"
              value={toMonth}
              min={fromMonth}
              onChange={(e) => setToMonth(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-blue-400"
            />
          </div>
          <p className="pb-2 text-[11px] text-slate-400">{t("overview.revchart.max24")}</p>
        </div>
      )}

      {/* ── Summary strip ── */}
      {!error && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          <SummaryStat
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            label={t("overview.revchart.sumRevenue")}
            value={loading ? null : fmtVND(data?.totalRevenue ?? 0)}
            accent="text-blue-600 bg-blue-50"
          />
          <SummaryStat
            icon={<BarChart3 className="h-3.5 w-3.5" />}
            label={t("overview.revchart.sumAvg")}
            value={loading ? null : fmtVND(data?.avgRevenue ?? 0)}
            accent="text-violet-600 bg-violet-50"
            trend={!loading && trend !== 0 ? trend : undefined}
          />
          <SummaryStat
            icon={<ShoppingCart className="h-3.5 w-3.5" />}
            label={t("overview.revchart.sumOrders")}
            value={loading ? null : (data?.totalOrders ?? 0).toLocaleString(loc)}
            accent="text-emerald-600 bg-emerald-50"
          />
        </div>
      )}

      {/* ── Chart / states ── */}
      {error ? (
        <div className="h-[300px] flex flex-col items-center justify-center text-center gap-2">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
          <p className="text-sm font-semibold text-slate-600">{t("overview.revchart.loadFail")}</p>
          <p className="text-xs text-slate-400 max-w-sm">{error}</p>
          <button
            onClick={fetchData}
            className="mt-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
          >
            {t("overview.revchart.retry")}
          </button>
        </div>
      ) : loading ? (
        <div className="h-[300px] rounded-2xl bg-slate-50 border border-slate-100 flex items-end gap-3 px-6 pb-6 pt-4 animate-pulse">
          {Array.from({ length: months }).map((_, i) => (
            <div key={i} className="flex-1 bg-slate-200 rounded-t-md" style={{ height: `${30 + ((i * 23) % 55)}%` }} />
          ))}
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-[300px] flex flex-col items-center justify-center text-center gap-2">
          <BarChart3 className="h-6 w-6 text-slate-300" />
          <p className="text-sm font-semibold text-slate-500">{t("overview.revchart.empty")}</p>
          <p className="text-xs text-slate-400 max-w-sm">{t("overview.revchart.emptyHint")}</p>
        </div>
      ) : chartMode === "pct" ? (
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 26, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="monthLabel" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} dy={6} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v: number) => `${v}%`} width={42} domain={[0, (m: number) => Math.max(120, Math.ceil(m / 20) * 20)]} />
              <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="5 4" label={{ value: "KPI 100%", position: "right", fontSize: 10, fill: "#64748b" }} />
              <Tooltip
                formatter={(value) => `${value}%`}
                labelStyle={{ color: "#64748b", fontWeight: 600 }}
                contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
              />
              <Line type="monotone" dataKey="revenuePct" name={t("overview.revchart.pctRevenueName")} stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3, fill: "#2563eb", strokeWidth: 0 }} connectNulls animationDuration={600}>
                <LabelList dataKey="revenuePct" position="top" offset={8} formatter={(v) => v != null ? `${v}%` : ""} style={{ fontSize: 10, fontWeight: 700, fill: "#1e3a8a" }} />
              </Line>
              <Line type="monotone" dataKey="ordersPct" name={t("overview.revchart.pctOrdersName")} stroke="#10b981" strokeWidth={2.5} dot={{ r: 3, fill: "#10b981", strokeWidth: 0 }} connectNulls animationDuration={600}>
                <LabelList dataKey="ordersPct" position="bottom" offset={8} formatter={(v) => v != null ? `${v}%` : ""} style={{ fontSize: 10, fontWeight: 700, fill: "#047857" }} />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 26, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="monthLabel"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                dy={6}
              />
              <YAxis
                yAxisId="left"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickFormatter={(v: number) => fmtAxis(v, t)}
                width={56}
              />
              <YAxis yAxisId="right" orientation="right" hide />
              <Tooltip
                content={(props) => (
                  <ChartTooltip
                    active={props.active}
                    payload={props.payload as never}
                    label={props.label as string}
                  />
                )}
                cursor={{ fill: "#f8fafc" }}
              />
              <Bar
                yAxisId="left"
                dataKey="revenue"
                fill="#2563eb"
                radius={[5, 5, 0, 0]}
                maxBarSize={48}
                animationDuration={600}
              >
                <LabelList
                  dataKey="revenue"
                  position="top"
                  offset={8}
                  formatter={(v) => Number(v).toLocaleString(loc)}
                  style={{ fontSize: 10, fontWeight: 700, fill: "#1e3a8a" }}
                />
              </Bar>
              <Bar
                yAxisId="right"
                dataKey="orders"
                fill="#10b981"
                radius={[5, 5, 0, 0]}
                maxBarSize={48}
                animationDuration={600}
              >
                <LabelList
                  dataKey="orders"
                  position="top"
                  offset={8}
                  formatter={(v) => Number(v).toLocaleString(loc)}
                  style={{ fontSize: 10, fontWeight: 700, fill: "#047857" }}
                />
              </Bar>
              {/* Đường KPI mục tiêu (gạch) */}
              <Line
                yAxisId="left" type="monotone" dataKey="revenueTarget"
                stroke="#2563eb" strokeWidth={1.5} strokeDasharray="5 4"
                dot={false} connectNulls animationDuration={600} legendType="none"
              />
              <Line
                yAxisId="right" type="monotone" dataKey="ordersTarget"
                stroke="#10b981" strokeWidth={1.5} strokeDasharray="5 4"
                dot={false} connectNulls animationDuration={600} legendType="none"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Legend ── */}
      {!error && !loading && chartMode === "pct" ? (
        <div className="flex items-center justify-center gap-5 mt-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-blue-600" /> {t("overview.revchart.legPctRevenue")}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-emerald-500" /> {t("overview.revchart.legPctOrders")}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-dashed border-slate-400" /> {t("overview.revchart.legKpi100")}</span>
        </div>
      ) : !error && !loading && (
        <div className="flex items-center justify-center gap-5 mt-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-2 rounded-sm bg-blue-600" /> {t("overview.revchart.legRevenue")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-2 rounded-sm bg-emerald-500" /> {t("overview.revchart.legOrders")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed border-slate-400" /> {t("overview.revchart.legTarget")}
          </span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// SummaryStat sub-component
// ─────────────────────────────────────────────

function SummaryStat({
  icon,
  label,
  value,
  accent,
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  accent: string;
  trend?: number;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={cn("rounded-md p-1", accent)}>{icon}</span>
        <span className="text-[11px] font-semibold text-slate-500 truncate">{label}</span>
      </div>
      {value === null ? (
        <div className="h-5 w-20 rounded bg-slate-200 animate-pulse" />
      ) : (
        <div className="flex items-baseline gap-1.5">
          <p className="text-base font-black text-slate-800 leading-none">{value}</p>
          {trend !== undefined && (
            <span className={cn("text-[10px] font-bold", trend >= 0 ? "text-emerald-600" : "text-red-500")}>
              {trend >= 0 ? "▲" : "▼"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
