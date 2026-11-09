"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { TrendingUp, TrendingDown, Minus, ChevronLeft, ChevronRight, ChevronDown, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RevenueByProductResponse, ProductCategoryRevenue } from "@/app/api/odoo/revenue-by-product/route";
import type { AttributionResponse, ProductAttribution, AdProductSpend } from "@/app/api/attribution/by-product/route";
import { companyIds, orderedCompanyIds } from "@/lib/companies/registry";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";

// ── Formatters ────────────────────────────────────────────────

function fmtVNDLoc(v: number, compact: boolean, loc: string): string {
  if (compact) {
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)} Tỷ`;
    if (v >= 1_000_000)     return `${(v / 1_000_000).toFixed(0)} Tr`;
    if (v >= 1_000)         return `${(v / 1_000).toFixed(0)}K`;
  }
  return v.toLocaleString(loc);
}

function fmtNumberLoc(v: number, loc: string): string {
  return v.toLocaleString(loc);
}

function useFmt() {
  const loc = useIntlLocale();
  return {
    fmtVND: (v: number, compact = false) => fmtVNDLoc(v, compact, loc),
    fmtNumber: (v: number) => fmtNumberLoc(v, loc),
  };
}

function fmtRoas(revenue: number, spend: number): string {
  if (!spend) return "—";
  return `${(revenue / spend).toFixed(1)}x`;
}

// Chuỗi từ điển có <b>…</b> → in đậm (chỉ chuỗi tĩnh do mình viết trong lib/i18n/messages).
function rich(s: string): React.ReactNode[] {
  return s.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
}

// ── Month helpers ─────────────────────────────────────────────

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: string, t: TFunction): string {
  const [y, m] = month.split("-").map(Number);
  return t("overview.kpitab.month", { m, y });
}

function last6Months(month: string): string[] {
  const result: string[] = [];
  for (let i = 5; i >= 0; i--) result.push(shiftMonth(month, -i));
  return result;
}

// ── Sub-components ────────────────────────────────────────────

function SummaryCard({
  label, value, sub, trend, loading,
}: {
  label: string; value: string; sub?: string; trend?: number; loading: boolean;
}) {
  const t = useT();
  return (
    <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{label}</p>
      {loading ? (
        <div className="mt-1.5 h-6 w-28 animate-pulse rounded bg-slate-100" />
      ) : (
        <p className="mt-1 text-xl font-bold text-slate-800">{value}</p>
      )}
      {sub && !loading && (
        <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>
      )}
      {trend !== undefined && !loading && (
        <div className={cn(
          "mt-1 flex items-center gap-1 text-[11px] font-semibold",
          trend > 0 ? "text-emerald-600" : trend < 0 ? "text-red-500" : "text-slate-400",
        )}>
          {trend > 0
            ? <TrendingUp className="h-3 w-3" />
            : trend < 0
              ? <TrendingDown className="h-3 w-3" />
              : <Minus className="h-3 w-3" />
          }
          {trend > 0 ? "+" : ""}{trend.toFixed(1)}% {t("overview.kpitab.vsPrev")}
        </div>
      )}
    </div>
  );
}

interface MktRevenueResponse {
  success?: boolean;
  total?: { revenue: number; orders: number };
  bySource?: Array<{ source: string; revenue: number; orders: number }>;
  unclassified?: { revenue: number; lines: number };
  basis?: { sources: string[]; note: string };
  error?: string;
}

interface MergedRow {
  group: ProductCategoryRevenue;
  attr:  ProductAttribution | undefined;
}

// ── Trend chart ───────────────────────────────────────────────

interface TrendPoint { monthLabel: string; revenue: number; spend: number }

function TrendChart({
  company, productKey, productLabel, baseMonth,
}: {
  company: string; productKey: string; productLabel: string; baseMonth: string;
}) {
  const t = useT();
  const { fmtVND } = useFmt();
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const months = last6Months(baseMonth);
    setLoading(true);
    Promise.all(
      months.map(m =>
        Promise.all([
          fetch(`/api/odoo/revenue-by-product?month=${m}&company=${company}`).then(r => r.json() as Promise<RevenueByProductResponse>),
          fetch(`/api/attribution/by-product?month=${m}&company=${company}`).then(r => r.json() as Promise<AttributionResponse>),
        ]).then(([rev, attr]) => {
          const catGroup  = rev.categories?.find(c => c.key === productKey);
          const attrGroup = attr.products?.find(p => p.key === productKey);
          return {
            monthLabel: formatMonthLabel(m, t),
            revenue:    catGroup?.revenue ?? 0,
            spend:      attrGroup?.totalSpend ?? 0,
          };
        })
      )
    ).then(setPoints).finally(() => setLoading(false));
  }, [company, productKey, baseMonth, t]);

  if (loading) {
    return <div className="h-32 animate-pulse rounded-lg bg-slate-50" />;
  }

  return (
    <div>
      <p className="text-xs font-semibold text-slate-600 mb-2">
        {t("overview.kpitab.trend6", { label: productLabel })}
      </p>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={points} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <XAxis dataKey="monthLabel" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
          <YAxis hide />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any) => [fmtVND(Number(v ?? 0)), name === "revenue" ? t("overview.kpitab.revenue") : t("overview.kpitab.adCost")] as any}
            labelStyle={{ fontSize: 10 }}
            contentStyle={{ fontSize: 10, borderRadius: 8 }}
          />
          <Bar dataKey="revenue" fill="#3b82f6" radius={[3, 3, 0, 0]} name="revenue" />
          <Bar dataKey="spend"   fill="#f97316" radius={[3, 3, 0, 0]} name="spend" opacity={0.7} />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-3 mt-1 text-[10px] text-slate-400">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-blue-500" /> {t("overview.kpitab.revenue")}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-orange-400" /> {t("overview.kpitab.adCost")}</span>
      </div>
    </div>
  );
}

// ── Top bar chart ─────────────────────────────────────────────

const CHART_COLORS = ["#3b82f6", "#6366f1", "#10b981", "#f59e0b", "#ef4444"];

function TopRevenueChart({ rows, loading }: { rows: MergedRow[]; loading: boolean }) {
  const t = useT();
  const { fmtVND } = useFmt();
  if (loading) return <div className="h-28 animate-pulse rounded-lg bg-slate-50" />;
  const top5 = [...rows].sort((a, b) => b.group.revenue - a.group.revenue).slice(0, 5);
  const data = top5.map(r => ({ name: r.group.label, revenue: r.group.revenue }));
  return (
    <ResponsiveContainer width="100%" height={100}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={80} tickLine={false} axisLine={false} />
        <Tooltip
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(v: any) => [fmtVND(Number(v ?? 0)), t("overview.kpitab.revenue")] as any}
          contentStyle={{ fontSize: 10, borderRadius: 8 }}
        />
        <Bar dataKey="revenue" radius={[0, 3, 3, 0]}>
          {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Product table row ─────────────────────────────────────────

function ProductRow({ row, isSelected, onClick }: { row: MergedRow; isSelected: boolean; onClick: () => void }) {
  const { fmtVND, fmtNumber } = useFmt();
  const { group, attr } = row;
  const spend = attr?.totalSpend ?? 0;
  const roas  = spend > 0 ? group.revenue / spend : 0;

  return (
    <tr
      onClick={onClick}
      className={cn(
        "border-b border-slate-50 cursor-pointer transition-colors",
        isSelected ? "bg-blue-50" : "hover:bg-slate-50",
      )}
    >
      <td className="py-2.5 px-3 text-sm font-medium text-slate-700 whitespace-nowrap">
        <span className="mr-1.5">{group.icon}</span>
        {group.label}
      </td>
      <td className="py-2.5 px-3 text-sm text-right font-semibold text-slate-800">
        {fmtVND(group.revenue, false)}
      </td>
      <td className="py-2.5 px-3 text-sm text-right text-slate-600">
        {fmtNumber(group.orders)}
      </td>
      <td className="py-2.5 px-3 text-sm text-right text-slate-600">
        {spend > 0 ? fmtVND(spend) : <span className="text-slate-300">—</span>}
      </td>
      <td className={cn(
        "py-2.5 px-3 text-sm text-right font-semibold",
        roas >= 10 ? "text-emerald-600" : roas >= 5 ? "text-blue-600" : roas > 0 ? "text-amber-600" : "text-slate-300",
      )}>
        {roas > 0 ? `${roas.toFixed(1)}x` : "—"}
      </td>
    </tr>
  );
}

// ── Ad cost per product (Chi phí Quảng Cáo Từng Sản Phẩm) ─────

function AdSpendByProduct({
  company, adProducts, loading,
}: {
  company: string;
  adProducts: AdProductSpend[];
  loading: boolean;
}) {
  const t = useT();
  const { fmtVND } = useFmt();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // chỉ hiện dòng có chi phí, sort giảm dần theo tổng
  const rows = [...adProducts]
    .filter(p => p.totalSpend > 0)
    .sort((a, b) => b.totalSpend - a.totalSpend);

  const total = rows.reduce((s, p) => s + p.totalSpend, 0);
  const accent = company === "MBC" ? "bg-blue-500" : "bg-violet-500";
  const max = rows[0]?.totalSpend ?? 0;

  return (
    <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-2 border-b border-slate-50 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600">
          {t("overview.kpitab.adCostByProduct")}
          <span className={cn(
            "ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold text-white",
            company === "MBC" ? "bg-blue-600" : "bg-violet-600",
          )}>{company}</span>
        </p>
        {!loading && total > 0 && (
          <p className="text-[11px] text-slate-500">
            {t("overview.kpitab.total")} <span className="font-semibold text-slate-700">{fmtVND(total)}</span>
          </p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="py-2 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("overview.kpitab.product")}</th>
              <th className="py-2 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">Facebook</th>
              <th className="py-2 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">Google</th>
              <th className="py-2 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">{t("overview.kpitab.totalCost")}</th>
              <th className="py-2 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right w-[22%]">{t("overview.kpitab.pctTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="py-3 px-3"><div className="h-3 rounded animate-pulse bg-slate-100" /></td>
                    ))}
                  </tr>
                ))
              : rows.length === 0
                ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-xs text-slate-400">
                      {t("overview.kpitab.noAdCost")}
                    </td>
                  </tr>
                )
                : rows.map(p => {
                    const pct = total > 0 ? (p.totalSpend / total) * 100 : 0;
                    const barPct = max > 0 ? (p.totalSpend / max) * 100 : 0;
                    const isOther = p.key === "__other__";
                    const hasCampaigns = p.campaigns.length > 0;
                    const isOpen = expanded.has(p.key);
                    return (
                      <Fragment key={p.key}>
                        <tr
                          className={cn(
                            "border-b border-slate-50 transition-colors",
                            hasCampaigns ? "hover:bg-slate-50 cursor-pointer" : "hover:bg-slate-50",
                          )}
                          onClick={hasCampaigns ? () => toggleExpanded(p.key) : undefined}
                        >
                          <td className={cn(
                            "py-2.5 px-3 text-sm font-medium whitespace-nowrap",
                            isOther ? "text-amber-600" : "text-slate-700",
                          )}>
                            <span className="inline-flex items-center gap-1">
                              {hasCampaigns && (
                                <ChevronDown className={cn("h-3 w-3 text-slate-400 transition-transform", !isOpen && "-rotate-90")} />
                              )}
                              <span className="mr-1.5">{p.icon}</span>{p.label}
                              {hasCampaigns && (
                                <span className="ml-1 text-[10px] font-normal text-slate-400">({p.campaigns.length})</span>
                              )}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-sm text-right text-slate-600">
                            {p.metaSpend > 0 ? fmtVND(p.metaSpend) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="py-2.5 px-3 text-sm text-right text-slate-600">
                            {p.googleSpend > 0 ? fmtVND(p.googleSpend) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="py-2.5 px-3 text-sm text-right font-semibold text-slate-800">
                            {fmtVND(p.totalSpend)}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center justify-end gap-2">
                              <div className="h-1.5 flex-1 max-w-[90px] rounded-full bg-slate-100 overflow-hidden">
                                <div className={cn("h-full rounded-full", isOther ? "bg-amber-400" : accent)} style={{ width: `${barPct}%` }} />
                              </div>
                              <span className="text-[11px] text-slate-500 tabular-nums w-9 text-right">{pct.toFixed(0)}%</span>
                            </div>
                          </td>
                        </tr>
                        {hasCampaigns && isOpen && (
                          <tr key={`${p.key}-campaigns`} className="border-b border-slate-50 bg-slate-50/60">
                            <td colSpan={5} className="py-2 px-3 pl-8">
                              <ul className="space-y-1">
                                {p.campaigns.map(c => (
                                  <li key={c.name} className="flex items-center justify-between gap-3 text-xs">
                                    <span className="text-slate-600 truncate">{c.name}</span>
                                    <span className="shrink-0 tabular-nums text-slate-400">{fmtVND(c.spend)}</span>
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main KpiTab ───────────────────────────────────────────────

export function KpiTab() {
  const t = useT();
  const { fmtVND, fmtNumber } = useFmt();
  const [company,          setCompany]          = useState<string>(() => orderedCompanyIds(["MBC"])[0] ?? "MBC") // Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ);
  const [month,            setMonth]            = useState<string>(currentMonth);
  const [revData,          setRevData]          = useState<RevenueByProductResponse | null>(null);
  /** Doanh thu do MARKETING mang về — KHÁC HẲN doanh thu công ty.
   *  `revData.total` chỉ lọc theo ngày hoá đơn nên trả về toàn bộ doanh thu
   *  công ty (13,37 tỷ cho MBI tháng 9), chia cho chi phí QC ra ROAS 267,7x.
   *  Số thật của marketing: 41,3 triệu → ROAS 0,83x. */
  const [mktData,          setMktData]          = useState<MktRevenueResponse | null>(null);
  const [attrData,         setAttrData]         = useState<AttributionResponse | null>(null);
  const [loading,          setLoading]          = useState(true);
  const [selectedKey,      setSelectedKey]      = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const fetches: Promise<unknown>[] = [
      fetch(`/api/odoo/revenue-by-product?month=${month}&company=${company}`).then(r => r.json() as Promise<RevenueByProductResponse>),
      fetch(`/api/attribution/by-product?month=${month}&company=${company}`).then(r => r.json() as Promise<AttributionResponse>),
      // Chỉ MBI. Gọi cho MBC là tốn một lượt Odoo cho con số sẽ không dùng.
      company === "MBI"
        ? fetch(`/api/odoo/mkt-revenue?month=${month}&company=${company}`).then(r => r.json() as Promise<MktRevenueResponse>).catch(() => null)
        : Promise.resolve(null),
    ];
    // Thứ tự phải khớp mảng `fetches` phía trên — mkt là phần tử thứ BA.
    Promise.all(fetches).then(([rev, attr, mkt]) => {
      setRevData(rev as RevenueByProductResponse);
      setAttrData(attr as AttributionResponse);
      setMktData(mkt as MktRevenueResponse | null);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, [month, company]);

  useEffect(() => { void load(); }, [load]);

  // Auto-select first product when new data arrives and nothing is selected
  useEffect(() => {
    if (revData?.categories?.length && !selectedKey) {
      setSelectedKey(revData.categories[0].key);
    }
  }, [revData, selectedKey]);

  // Merge revenue + attribution rows
  const rows: MergedRow[] = (revData?.categories ?? []).map(g => ({
    group: g,
    attr:  attrData?.products?.find(p => p.key === g.key),
  }));

  // Summary totals
  //
  // DÙNG SỐ MKT, KHÔNG dùng `revData.total`. `revData` truy vấn mb.sale.report
  // chỉ lọc theo ngày hoá đơn — không lọc công ty, không lọc nguồn — nên tổng
  // của nó là TOÀN BỘ doanh thu công ty. Với MBI tháng 9/2026: 13.371.866.950đ
  // trong khi cộng các dòng sản phẩm MBI lại chỉ ra 660.768.400đ.
  // Chia cho chi phí QC ra ROAS 267,7x — con số không có thật, và nguy hiểm
  // chính vì quá đẹp để bị nghi ngờ. Số MKT thật: 41.268.450đ → ROAS 0,83x.
  // CHỈ ÁP CHO MBI. Bốn điều kiện + sáu nguồn là cách ghi nhận của phòng MKT
  // cho MBI, không phải luật chung — đội "M-*" và các nguồn như "Đơn hàng MBI
  // online" là của MBI. Áp nhầm sang MBC thì lọc ra 43.064.450đ mà KHÔNG đồng
  // nào khớp được nhóm sản phẩm MBC, tức lọc ra nhầm tập đơn.
  //
  // Bản trước tôi áp cho cả hai công ty — sai, người dùng chỉ yêu cầu MBI.
  // MBC giữ nguyên cách cũ cho tới khi có cách ghi nhận riêng của MBC.
  const useMkt       = company === "MBI";
  const mktOk        = useMkt && Boolean(mktData?.success && mktData?.total);
  const totalRevenue = useMkt ? (mktData?.total?.revenue ?? 0) : (revData?.total.revenue ?? 0);
  const totalOrders  = useMkt ? (mktData?.total?.orders  ?? 0) : (revData?.total.orders  ?? 0);
  const totalSpend   = attrData?.totalSpend ?? 0;
  const totalRoas    = totalSpend > 0 && (useMkt ? mktOk : totalRevenue > 0)
    ? totalRevenue / totalSpend : 0;

  const unattributed  = attrData?.unattributed;
  const brandAwareness = attrData?.brandAwareness;
  const selectedRow   = rows.find(r => r.group.key === selectedKey);

  return (
    <div className="space-y-4">
      {/* ── Header controls ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">

        {/* Company toggle */}
        <div className="flex items-center gap-0.5 rounded-full border border-slate-200 bg-white p-0.5 shadow-sm">
          {companyIds().map(c => (
            <button
              key={c}
              onClick={() => { setCompany(c); setSelectedKey(null); }}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
                company === c
                  ? c === "MBC" ? "bg-blue-600 text-white shadow-sm" : "bg-violet-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-600",
              )}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Month picker */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMonth(m => shiftMonth(m, -1))}
            className="p-1 rounded-full hover:bg-slate-100 transition-colors"
          >
            <ChevronLeft className="h-4 w-4 text-slate-500" />
          </button>
          <span className="text-sm font-semibold text-slate-700 min-w-[100px] text-center">
            {formatMonthLabel(month, t)}
          </span>
          <button
            onClick={() => setMonth(m => shiftMonth(m, 1))}
            disabled={month >= currentMonth()}
            className="p-1 rounded-full hover:bg-slate-100 transition-colors disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4 text-slate-500" />
          </button>
          <button
            onClick={load}
            className="p-1 rounded-full hover:bg-slate-100 transition-colors ml-1"
            title={t("overview.kpitab.refresh")}
          >
            <RefreshCw className={cn("h-3.5 w-3.5 text-slate-400", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* ── Summary cards ── */}
      <div className="grid gap-3 grid-cols-3">
        {/* Nhãn nói RÕ đây là doanh thu của marketing, không phải của công ty.
            Gọi "Tổng doanh thu" trên một con số chỉ tính 6 nguồn MKT là mời
            người đọc hiểu nhầm đúng cái vừa sửa. */}
        <SummaryCard
          label={useMkt ? t("overview.kpitab.mktRevenue") : t("overview.kpitab.totalRevenue")}
          value={loading ? "…" : (useMkt && !mktOk) ? "—" : fmtVND(totalRevenue, false)}
          sub={useMkt ? (mktOk ? t("overview.kpitab.mktSources") : t("overview.kpitab.unreadable")) : undefined}
          loading={loading}
        />
        <SummaryCard
          label={useMkt ? t("overview.kpitab.mktOrders") : t("overview.kpitab.totalOrders")}
          value={loading ? "…" : (useMkt && !mktOk) ? "—" : fmtNumber(totalOrders)}
          sub={useMkt ? (mktOk ? t("overview.kpitab.mktTeam") : undefined) : t("overview.kpitab.distinctOrders")}
          loading={loading}
        />
        <SummaryCard
          label={t("overview.kpitab.adCost")}
          value={loading ? "…" : fmtVND(totalSpend, false)}
          // ROAS chỉ hiện khi đọc được doanh thu MKT. Không đọc được mà vẫn
          // chia bừa cho một con số khác là cách cũ đã tạo ra "267.7x".
          sub={totalRoas > 0
            ? `${t("overview.kpitab.roas", { v: totalRoas.toFixed(2) })}${totalRoas < 1 ? t("overview.kpitab.losing") : ""}`
            : mktOk ? undefined : t("overview.kpitab.noRoas")}
          loading={loading}
        />
      </div>
      {/* Nói rõ con số ở trên là gì. Trước bản này hai ô đó gọi là "Tổng doanh
          thu" / "Tổng đơn hàng" nhưng lấy TOÀN BỘ doanh thu công ty — người
          đọc không có cách nào biết. */}
      {useMkt && mktOk && (
        <p className="mt-2 text-[10px] text-slate-400 leading-snug">
          {rich(t("overview.kpitab.mktNote"))}
          {typeof mktData?.unclassified?.revenue === "number" && mktData.unclassified.revenue > 0 && (
            <>{" "}{rich(t("overview.kpitab.mktUnmatched", { amount: fmtVND(mktData.unclassified.revenue, false) }))}</>
          )}
        </p>
      )}


      {/* ── Bar chart + table ── */}
      <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
        <div className="px-4 pt-4 pb-2 border-b border-slate-50">
          <p className="text-xs font-semibold text-slate-600">
            {t("overview.kpitab.perfByProduct")}
          </p>
          {revData?.error && (
            <p className="text-[10px] text-red-600 mt-0.5">
              ⚠ {revData.error}
            </p>
          )}
          {attrData?.error && (
            <p className="text-[10px] text-red-600 mt-0.5">
              {t("overview.kpitab.adCostErr", { error: attrData.error })}
            </p>
          )}
        </div>

        {/* Top 5 mini chart */}
        <div className="px-4 py-3">
          <TopRevenueChart rows={rows} loading={loading} />
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="py-2 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("overview.kpitab.product")}</th>
                <th className="py-2 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">{t("overview.kpitab.revenue")}</th>
                <th className="py-2 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">{t("overview.kpitab.orders")}</th>
                <th className="py-2 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">{t("overview.kpitab.adCost")}</th>
                <th className="py-2 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      {Array.from({ length: 5 }).map((__, j) => (
                        <td key={j} className="py-3 px-3">
                          <div className="h-3 rounded animate-pulse bg-slate-100" />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map(row => (
                    <ProductRow
                      key={row.group.key}
                      row={row}
                      isSelected={selectedKey === row.group.key}
                      onClick={() => setSelectedKey(k => k === row.group.key ? null : row.group.key)}
                    />
                  ))
              }
            </tbody>
          </table>
        </div>

        {/* Cảnh báo VÀNG: chỉ khi có campaign THẬT SỰ chưa phân loại (tên chưa theo convention) */}
        {!loading && unattributed && unattributed.totalSpend > 0 && (
          <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-100 text-[11px] text-amber-700">
            {t("overview.kpitab.unattributed", { amount: fmtVND(unattributed.totalSpend) })}
          </div>
        )}

        {/* Dòng THÔNG TIN trung tính: chi phí thương hiệu/sự kiện (không gắn doanh thu trực tiếp) */}
        {!loading && brandAwareness && brandAwareness.totalSpend > 0 && (
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 text-[11px] text-slate-500">
            {t("overview.kpitab.brand", { amount: fmtVND(brandAwareness.totalSpend) })}
          </div>
        )}
      </div>

      {/* ── Chi phí Quảng Cáo Từng Sản Phẩm ── */}
      <AdSpendByProduct
        company={company}
        adProducts={attrData?.adProducts ?? []}
        loading={loading}
      />

      {/* ── Trend chart ── */}
      {selectedRow && !loading && (
        <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
          <TrendChart
            company={company}
            productKey={selectedRow.group.key}
            productLabel={selectedRow.group.label}
            baseMonth={month}
          />
        </div>
      )}

      {!selectedRow && !loading && rows.length > 0 && (
        <p className="text-center text-xs text-slate-400 py-2">
          {t("overview.kpitab.clickHint")}
        </p>
      )}
    </div>
  );
}
