"use client";

// ============================================================
// OdooRevenueTab — Odoo ERP Revenue & Analytics
// Displays sales order revenue, product breakdown, and order
// status from the Odoo v17 ERP integration.
// ============================================================

import { useState, useEffect, useCallback } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  TrendingUp,
  ShoppingCart,
  BarChart3,
  Zap,
  RefreshCw,
  Building2,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface DayRevenue {
  date: string;
  revenue: number;
  orders: number;
}

interface ProductRevenue {
  name: string;
  revenue: number;
  orders: number;
}

interface RevenueData {
  totalRevenue: number;
  totalOrders: number;
  byDay: DayRevenue[];
  byProduct: ProductRevenue[];
  byStatus: {
    confirmed: number; done: number; cancelled: number;
    /** Đơn nháp + báo giá đã gửi: có thật trong Odoo, trước đây bị giấu khỏi cả
     *  bảng lẫn mẫu số nên "100% tổng đơn" là con số tự bịa. */
    draft: number; sent: number; total: number;
  };
  period: string;
}

type PeriodPreset = "this_month" | "last_month" | "last_7" | "last_30" | "custom";
type CompanyFilter = string /* mã công ty hoặc "ALL" */;

// ─────────────────────────────────────────────
// VND formatter
// ─────────────────────────────────────────────

function fmtVND(v: number, loc: string, t: TFunction): string {
  if (v >= 1_000_000_000) return `₫${(v / 1_000_000_000).toFixed(1)}${t("overview.odoo.unitBillion")}`;
  if (v >= 1_000_000)     return `₫${(v / 1_000_000).toFixed(1)}${t("overview.odoo.unitMillion")}`;
  if (v >= 1_000)         return `₫${(v / 1_000).toFixed(0)}K`;
  return `₫${Math.round(v).toLocaleString(loc)}`;
}

function fmtShortDate(dateStr: string): string {
  const [, month, day] = (dateStr ?? "").split("-");
  if (!month || !day) return dateStr;
  return `${day}/${month}`;
}

// ─────────────────────────────────────────────
// Date range helpers
// ─────────────────────────────────────────────

// `toISOString()` đổi sang UTC rồi mới cắt lấy ngày — ở VN (UTC+7) thì 00:00
// ngày 01/08 giờ địa phương thành "2026-07-31". Đó là lý do tab này hiện
// "Kỳ: 2026-07-31 → 2026-08-30" cho "Tháng này": kỳ bị đẩy lùi ĐÚNG MỘT NGÀY,
// kéo theo cả ngày 31/07 vào doanh thu tháng 8 và bỏ mất ngày 31/08. Đo trên
// Odoo thật ngày 2026-08-24: một ngày bị kéo lệch như vậy mang theo gần một tỉ
// đồng doanh thu, tức lỗi này KHÔNG phải sai số làm tròn. (Số tuyệt đối đã bỏ
// khỏi chú thích vì repo ở trạng thái công khai.)
// Ngày ở đây là ngày theo lịch địa phương, nên phải format theo giờ địa phương.
function ymdLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoDate(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return ymdLocal(d);
}

function getMonthRange(offset: number): { from: string; to: string } {
  const now = new Date();
  const d   = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return {
    from: ymdLocal(d),
    to:   ymdLocal(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  };
}

function getPeriodDates(
  preset: PeriodPreset,
  customFrom: string,
  customTo: string
): { from: string; to: string } {
  switch (preset) {
    case "this_month": return getMonthRange(0);
    case "last_month": return getMonthRange(-1);
    case "last_7":     return { from: isoDate(6),  to: isoDate(0) };
    case "last_30":    return { from: isoDate(29), to: isoDate(0) };
    case "custom":     return { from: customFrom, to: customTo };
  }
}

// ─────────────────────────────────────────────
// Recharts custom tooltip
// ─────────────────────────────────────────────

function RevenueTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: string;
}) {
  const t = useT();
  const loc = useIntlLocale();
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 shadow-xl rounded-xl p-3 text-xs min-w-[140px]">
      <p className="text-slate-500 font-medium mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: p.color }}
            />
            <span className="text-slate-600 capitalize">
              {p.dataKey === "revenue" ? t("overview.odoo.tipRevenue") : t("overview.odoo.tipOrders")}
            </span>
          </span>
          <span className="font-bold text-slate-800">
            {p.dataKey === "revenue" ? fmtVND(p.value, loc, t) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function ProductTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
}) {
  const t = useT();
  const loc = useIntlLocale();
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 shadow-xl rounded-xl p-3 text-xs">
      <p className="font-bold text-slate-700">{fmtVND(payload[0].value, loc, t)}</p>
    </div>
  );
}

// ─────────────────────────────────────────────
// Loading skeletons
// ─────────────────────────────────────────────

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-[110px] rounded-2xl bg-slate-100 animate-pulse"
        />
      ))}
    </div>
  );
}

function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div
      className="w-full rounded-2xl bg-slate-50 border border-slate-100 flex items-end gap-2 px-6 pb-6 pt-4 animate-pulse overflow-hidden"
      style={{ height }}
    >
      {Array.from({ length: 14 }).map((_, i) => (
        <div
          key={i}
          className="flex-1 bg-slate-200 rounded-t-md"
          style={{ height: `${30 + ((i * 17) % 55)}%` }}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// KPI Card
// ─────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent: string;   // Tailwind bg color class for icon bg
  textAccent: string; // Tailwind text color class for icon
}

function KpiCard({ label, value, sub, icon, accent, textAccent }: KpiCardProps) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4 flex flex-col justify-between min-h-[110px] hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <span className="text-xs font-semibold text-slate-500 leading-tight">{label}</span>
        <div className={cn("rounded-full p-2", accent)}>
          <div className={cn("w-4 h-4", textAccent)}>{icon}</div>
        </div>
      </div>
      <div>
        <p className="text-xl font-black text-slate-800 leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-slate-400 mt-0.5 font-medium">{sub}</p>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

interface OdooRevenueTabProps {
  /** Optional: ads spend total for ROAS calculation */
  adsSpend?: number;
}

export default function OdooRevenueTab({ adsSpend = 0 }: OdooRevenueTabProps) {
  const t = useT();
  const loc = useIntlLocale();
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("this_month");
  const [customFrom,   setCustomFrom]   = useState(isoDate(29));
  const [customTo,     setCustomTo]     = useState(isoDate(0));
  const [company,      setCompany]      = useState<CompanyFilter>("ALL");

  const [data,    setData]    = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const currentMonthLabel = new Date().toLocaleDateString(loc, {
    month: "long",
    year:  "numeric",
  });

  // ── Fetch data ─────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    const { from, to } = getPeriodDates(periodPreset, customFrom, customTo);
    if (!from || !to) return;

    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(
        `/api/odoo/revenue?from=${from}&to=${to}&company=${company}`
      );
      const json = await res.json() as { success: boolean; data?: RevenueData; error?: string };

      if (!json.success || !json.data) {
        throw new Error(json.error ?? t("overview.odoo.errUnknown"));
      }
      setData(json.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("overview.odoo.errConnect");
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [periodPreset, customFrom, customTo, company, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Computed KPIs ───────────────────────────────────────────

  const totalRevenue  = data?.totalRevenue  ?? 0;
  const totalOrders   = data?.totalOrders   ?? 0;
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const roas          = adsSpend > 0 ? totalRevenue / adsSpend : 0;

  const { from: periodFrom, to: periodTo } = getPeriodDates(
    periodPreset,
    customFrom,
    customTo
  );

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Header row: period + company controls ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Period selector */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl flex-wrap">
          <Calendar className="h-3.5 w-3.5 text-slate-400 ml-1.5 shrink-0" />
          {(
            [
              { key: "this_month", label: t("overview.odoo.presetThisMonth") },
              { key: "last_month", label: t("overview.odoo.presetLastMonth") },
              { key: "last_7",     label: t("overview.odoo.preset7") },
              { key: "last_30",    label: t("overview.odoo.preset30") },
              { key: "custom",     label: t("overview.odoo.presetCustom") },
            ] as const
          ).map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriodPreset(p.key)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                periodPreset === p.key
                  ? "bg-white text-amber-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Company selector */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl sm:ml-auto">
          <Building2 className="h-3.5 w-3.5 text-slate-400 ml-1.5 shrink-0" />
          {(["ALL", "MBC", "MBI"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCompany(c)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                company === c
                  ? "bg-white shadow-sm text-violet-700"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              {c === "ALL" ? t("overview.odoo.all") : c}
            </button>
          ))}
        </div>

        {/* Refresh */}
        <button
          onClick={fetchData}
          disabled={loading}
          className="self-start sm:self-center p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 transition-colors disabled:opacity-50"
          aria-label={t("overview.odoo.refresh")}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {/* Custom date inputs */}
      {periodPreset === "custom" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">
              {t("overview.odoo.dateFrom")}
            </label>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-white"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">
              {t("overview.odoo.dateTo")}
            </label>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-white"
            />
          </div>
        </div>
      )}

      {/* ── Error state ── */}
      {error && !loading && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-700">{t("overview.odoo.errTitle")}</p>
            <p className="text-xs text-red-600 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* ── KPI Cards ── */}
      {loading ? (
        <KpiSkeleton />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label={t("overview.odoo.kpiRevenue")}
            value={fmtVND(totalRevenue, loc, t)}
            sub={t("overview.odoo.period", { period: data?.period ?? `${periodFrom} → ${periodTo}` })}
            icon={<TrendingUp className="w-4 h-4" />}
            accent="bg-emerald-50"
            textAccent="text-emerald-600"
          />
          <KpiCard
            label={t("overview.odoo.kpiOrders")}
            value={totalOrders.toLocaleString(loc)}
            sub={
              data
                ? t("overview.odoo.ordersSub", {
                    confirmed: data.byStatus.confirmed.toLocaleString(loc),
                    open: (data.byStatus.total - data.byStatus.confirmed - data.byStatus.done).toLocaleString(loc),
                    total: data.byStatus.total.toLocaleString(loc),
                  })
                : "—"
            }
            icon={<ShoppingCart className="w-4 h-4" />}
            accent="bg-blue-50"
            textAccent="text-blue-600"
          />
          <KpiCard
            label={t("overview.odoo.kpiAov")}
            value={fmtVND(avgOrderValue, loc, t)}
            sub={totalOrders > 0 ? t("overview.odoo.aovSub", { n: totalOrders }) : t("overview.odoo.noData")}
            icon={<BarChart3 className="w-4 h-4" />}
            accent="bg-violet-50"
            textAccent="text-violet-600"
          />
          {/* KHÔNG phải ROAS của quảng cáo. Tử số là TOÀN BỘ doanh thu Odoo —
              gồm cả gia hạn tên miền, hosting, đơn do sale gọi… phần lớn không
              sinh ra từ quảng cáo. Gọi nó là "ROAS Thực" khiến người đọc tưởng
              382,7Tr tiền ads đẻ ra 22 tỷ. Đổi nhãn cho đúng việc nó làm: đây
              là tỉ lệ doanh thu công ty trên chi phí quảng cáo, một chỉ số
              tham chiếu, không phải hiệu quả quảng cáo. */}
          <KpiCard
            label={t("overview.odoo.kpiRatio")}
            value={adsSpend > 0 ? `${roas.toFixed(1)}x` : "—"}
            sub={
              adsSpend > 0
                ? t("overview.odoo.ratioSub", { spend: fmtVND(adsSpend, loc, t) })
                : t("overview.odoo.ratioNeed")
            }
            icon={<Zap className="w-4 h-4" />}
            accent="bg-amber-50"
            textAccent="text-amber-600"
          />
        </div>
      )}

      {/* ── Revenue Line Chart ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-1.5 mb-4">
          <TrendingUp className="h-4 w-4 text-blue-500" />
          {t("overview.odoo.chartDaily")}
        </h3>

        {loading ? (
          <ChartSkeleton height={280} />
        ) : (data?.byDay?.length ?? 0) === 0 ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-slate-400">
            {t("overview.odoo.emptyPeriod")}
          </div>
        ) : (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data!.byDay.map((d) => ({
                  ...d,
                  label: fmtShortDate(d.date),
                }))}
                margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#f1f5f9"
                />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  dy={8}
                  interval="preserveStartEnd"
                />
                <YAxis
                  hide
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  content={(props) => (
                    <RevenueTooltip
                      active={props.active}
                      payload={
                        (props.payload as unknown) as Array<{
                          value: number;
                          dataKey: string;
                          color: string;
                        }>
                      }
                      label={props.label as string}
                    />
                  )}
                  cursor={{ stroke: "#e2e8f0", strokeWidth: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: "#2563eb" }}
                  animationDuration={600}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── Bottom grid: Products + Status ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Top Products Bar Chart — spans 3/5 */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h3 className="text-sm font-bold text-slate-700 flex items-center gap-1.5 mb-4">
            <BarChart3 className="h-4 w-4 text-violet-500" />
            {t("overview.odoo.chartProducts")}
          </h3>

          {loading ? (
            <ChartSkeleton height={240} />
          ) : (data?.byProduct?.length ?? 0) === 0 ? (
            <div className="h-[240px] flex items-center justify-center text-sm text-slate-400">
              {t("overview.odoo.emptyProducts")}
            </div>
          ) : (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={data!.byProduct.slice(0, 8).map((p) => ({
                    ...p,
                    shortName:
                      p.name.length > 20 ? `${p.name.slice(0, 20)}…` : p.name,
                  }))}
                  margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                    stroke="#f1f5f9"
                  />
                  <XAxis
                    type="number"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickFormatter={(v: number) => fmtVND(v, loc, t)}
                  />
                  <YAxis
                    type="category"
                    dataKey="shortName"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    width={110}
                  />
                  <Tooltip
                    content={(props) => (
                      <ProductTooltip
                        active={props.active}
                        payload={
                          (props.payload as unknown) as Array<{
                            value: number;
                            dataKey: string;
                          }>
                        }
                      />
                    )}
                    cursor={{ fill: "#f8fafc" }}
                  />
                  <Bar
                    dataKey="revenue"
                    fill="#7c3aed"
                    radius={[0, 4, 4, 0]}
                    animationDuration={600}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Order Status — spans 2/5 */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col">
          <h3 className="text-sm font-bold text-slate-700 flex items-center gap-1.5 mb-4">
            <ShoppingCart className="h-4 w-4 text-emerald-500" />
            {t("overview.odoo.statusTitle")}
          </h3>

          {loading ? (
            <div className="flex-1 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : !data ? null : (
            <div className="flex flex-col gap-3 flex-1">
              {/* Mẫu số là TỔNG MỌI TRẠNG THÁI, không phải tổng của mấy dòng
                  được chọn để hiện. Bản cũ lấy `totalOrders` (chỉ đơn đã chốt)
                  làm mẫu số nên dòng "Đã xác nhận" luôn ra đúng 100,0% — một
                  con số không nói lên điều gì, lại che mất việc phần lớn đơn
                  trong kỳ đang ở trạng thái nháp. */}
              <StatusRow
                icon={<Clock3 className="h-4 w-4" />}
                label={t("overview.odoo.stConfirmed")}
                count={data.byStatus.confirmed}
                total={data.byStatus.total}
                accent="blue"
              />
              <StatusRow
                icon={<Clock3 className="h-4 w-4" />}
                label={t("overview.odoo.stDraft")}
                count={data.byStatus.draft}
                total={data.byStatus.total}
                accent="amber"
              />
              <StatusRow
                icon={<Clock3 className="h-4 w-4" />}
                label={t("overview.odoo.stSent")}
                count={data.byStatus.sent}
                total={data.byStatus.total}
                accent="violet"
              />
              {/* Odoo này không dùng trạng thái `done` (đo thật 2026-08-24: 0
                  đơn trên toàn kỳ). Hiện một dòng "Hoàn thành 0 — 0,0%" chỉ làm
                  người đọc tưởng có gì đó đang hỏng, nên chỉ hiện khi có số. */}
              {data.byStatus.done > 0 && (
                <StatusRow
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  label={t("overview.odoo.stDone")}
                  count={data.byStatus.done}
                  total={data.byStatus.total}
                  accent="emerald"
                />
              )}
              <StatusRow
                icon={<XCircle className="h-4 w-4" />}
                label={t("overview.odoo.stCancelled")}
                count={data.byStatus.cancelled}
                total={data.byStatus.total}
                accent="red"
              />

              {/* Summary note */}
              <div className="mt-auto pt-3 border-t border-slate-100">
                <p className="text-[11px] text-slate-400">
                  {t("overview.odoo.source")}{" "}
                  <span className="font-semibold text-slate-500">
                    Odoo ERP — sale.order
                  </span>
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {t("overview.odoo.period", { period: data.period })}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// StatusRow sub-component
// ─────────────────────────────────────────────

interface StatusRowProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  total: number;
  accent: "blue" | "emerald" | "red" | "amber" | "violet";
}

const ACCENT_MAP: Record<
  StatusRowProps["accent"],
  { bg: string; text: string; bar: string; iconBg: string }
> = {
  blue: {
    bg:     "bg-blue-50",
    text:   "text-blue-700",
    bar:    "bg-blue-500",
    iconBg: "bg-blue-100 text-blue-600",
  },
  emerald: {
    bg:     "bg-emerald-50",
    text:   "text-emerald-700",
    bar:    "bg-emerald-500",
    iconBg: "bg-emerald-100 text-emerald-600",
  },
  red: {
    bg:     "bg-red-50",
    text:   "text-red-700",
    bar:    "bg-red-400",
    iconBg: "bg-red-100 text-red-500",
  },
  amber: {
    bg:     "bg-amber-50",
    text:   "text-amber-700",
    bar:    "bg-amber-400",
    iconBg: "bg-amber-100 text-amber-600",
  },
  violet: {
    bg:     "bg-violet-50",
    text:   "text-violet-700",
    bar:    "bg-violet-400",
    iconBg: "bg-violet-100 text-violet-600",
  },
};

function StatusRow({ icon, label, count, total, accent }: StatusRowProps) {
  const t = useT();
  const loc = useIntlLocale();
  const colors = ACCENT_MAP[accent];
  const pct    = total > 0 ? (count / total) * 100 : 0;

  return (
    <div className={cn("rounded-xl p-3.5 border border-transparent", colors.bg)}>
      <div className="flex items-center gap-2.5 mb-2">
        <div className={cn("rounded-full p-1.5", colors.iconBg)}>{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-baseline">
            <span className={cn("text-xs font-semibold", colors.text)}>{label}</span>
            <span className={cn("text-sm font-black", colors.text)}>
              {count.toLocaleString(loc)}
            </span>
          </div>
        </div>
      </div>
      {/* Progress bar */}
      <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", colors.bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10px] text-slate-400 mt-1 font-medium">
        {t("overview.odoo.pctOfOrders", { pct: pct.toFixed(1) })}
      </p>
    </div>
  );
}
