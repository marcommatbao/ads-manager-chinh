"use client";

// ============================================================
// Doanh thu thật — đối chiếu tiền quảng cáo với đơn hàng trong Odoo
// ------------------------------------------------------------
// Vì sao là một TRANG RIÊNG, không nhét vào /reports:
//
// /reports hiển thị ROAS lấy từ `conversions_value` / `action_values` do CHÍNH
// NỀN TẢNG QUẢNG CÁO tự khai. Trang này lấy từ ĐƠN HÀNG THẬT trong Odoo. Hai con
// số đo hai thứ khác nhau và lệch rất xa — đo ngày 25/08 (MBC, 01→25/08): nền
// tảng khai ~5,4x, đơn hàng thật cho ~1,09x; riêng nhãn brand thì Google khai
// 630,9tr trong khi Odoo ghi 281,1tr, lệch 2,24 lần.
//
// Để chung một trang thì hai con số sẽ bị đọc như hai cách tính của cùng một
// thứ, và người đọc sẽ tin con số đẹp hơn. Tách ra để mỗi trang nói rõ nó đo cái
// gì, và để trang này gánh được phần giải thích giới hạn mà nó bắt buộc phải có.
//
// Chi phí + doanh thu nền tảng tự khai: /api/dashboard/unified (cùng from/to).
// Doanh thu thật: /api/audience/campaign-revenue (chỉ đọc Odoo).
// ============================================================

import { useState } from "react";
import useSWR from "swr";
import { Wallet, TrendingUp, Receipt, AlertTriangle, RefreshCw, Info, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { orderedCompanyIds } from "@/lib/companies/registry";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";

interface Row { campaign: string; orders: number; revenue: number; aov: number }
interface Report {
  from: string; to: string; company: string;
  rows: Row[];
  totalOrders: number; totalRevenue: number;
  ordersWithoutCampaign: number; revenueWithoutCampaign: number;
  error: string | null;
}
interface Channel { spend: number; declaredValue: number; error: string | null }
interface Unified {
  summary: {
    total: { spend: number; declaredValue: number };
    facebook: Channel;
    google: Channel;
  };
}

type Company = string /* mã công ty hoặc "ALL" */;

const rich = (s: string) => s.split(/<(b|code)>(.*?)<\/\1>/).map((part, i, a) => (i % 3 === 2 ? (a[i - 1] === "b" ? <b key={i}>{part}</b> : <code key={i}>{part}</code>) : i % 3 === 1 ? null : part));
const vndL = (n: number, intl: string) => `₫${Math.round(n).toLocaleString(intl)}`;
const shortL = (n: number, intl: string, t: TFunction) =>
  n >= 1_000_000_000 ? t("meta.revenue.short.bn", { v: (n / 1e9).toFixed(2) })
  : n >= 1_000_000 ? t("meta.revenue.short.mn", { v: (n / 1e6).toFixed(1) })
  : vndL(n, intl);

function ymd(d: Date) {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface Loaded {
  report: Report | null;
  reportError: string | null;
  summary: Unified["summary"] | null;
  spendError: string | null;
}

/** Hai đường độc lập: Odoo hỏng thì vẫn thấy chi phí, và ngược lại. Mất một nửa
 *  số liệu vẫn hơn mất sạch, nên không dùng Promise.all-rồi-throw. */
async function loadBoth(qs: string, t: TFunction): Promise<Loaded> {
  const [rev, spend] = await Promise.allSettled([
    fetch(`/api/audience/campaign-revenue?${qs}`).then(r => r.json() as Promise<{ report?: Report; error?: string }>),
    fetch(`/api/dashboard/unified?${qs}`).then(r => r.json() as Promise<Partial<Unified>>),
  ]);

  const out: Loaded = { report: null, reportError: null, summary: null, spendError: null };

  if (rev.status === "fulfilled") {
    out.report = rev.value.report ?? null;
    out.reportError = rev.value.report?.error ?? (rev.value.report ? null : rev.value.error ?? t("meta.revenue.err.odoo"));
  } else {
    out.reportError = t("meta.revenue.err.api");
  }

  if (spend.status === "fulfilled" && spend.value.summary) {
    const s = spend.value.summary;
    out.summary = s;
    const errs = [
      s.facebook.error && `Facebook: ${s.facebook.error}`,
      s.google.error && `Google: ${s.google.error}`,
    ].filter(Boolean);
    out.spendError = errs.length ? errs.join(" · ") : null;
  } else {
    out.spendError = t("meta.revenue.err.spend");
  }

  return out;
}

export default function RevenueAttributionPage() {
  const t = useT();
  const intl = useIntlLocale();
  const vnd = (n: number) => vndL(n, intl);
  const short = (n: number) => shortL(n, intl, t);
  const now = new Date();
  const [from, setFrom] = useState(ymd(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(ymd(now));
  const [company, setCompany] = useState<Company>(() => orderedCompanyIds(["MBC"])[0] ?? "MBC") // Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ);

  const { data, isLoading, isValidating, mutate } = useSWR(
    `from=${from}&to=${to}&company=${company}`,
    (qs: string) => loadBoth(qs, t),
    // Kỳ đã chốt thì số không đổi; đây lại là trang gọi thẳng Meta/Google nên
    // mỗi lần focus lại tab mà tự gọi là đốt quota vô ích.
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const loading = isLoading || isValidating;
  const report = data?.report ?? null;
  const spendData = data?.summary ?? null;
  const spendError = data?.spendError ?? null;
  const error = data?.reportError ?? null;

  const spend = spendData?.total.spend ?? 0;
  const declared = spendData?.total.declaredValue ?? 0;
  const tagged = report ? report.rows.reduce((n, r) => n + r.revenue, 0) : 0;
  const taggedOrders = report ? report.rows.reduce((n, r) => n + r.orders, 0) : 0;
  // Chỉ tính ROAS khi CẢ HAI vế đo được. Thiếu một vế mà vẫn chia thì ra một con
  // số trông như kết luận.
  const canRoas = spend > 0 && !spendError && report !== null && report.error === null;
  const roasReal = canRoas ? tagged / spend : null;
  const roasDeclared = spend > 0 && !spendError && declared > 0 ? declared / spend : null;
  const gap = roasReal !== null && roasDeclared !== null && roasReal > 0 ? roasDeclared / roasReal : null;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Receipt className="h-5 w-5 text-emerald-600" /> {t("meta.revenue.title")}
          </h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            {rich(t("meta.revenue.sub"))}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {([["MBC", "MBC"], ["ALL", t("meta.revenue.all")]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setCompany(v)}
                className={cn("px-3 py-1.5 text-xs font-semibold transition-colors",
                  company === v ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>
                {label}
              </button>
            ))}
          </div>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
          <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
          <button onClick={() => void mutate()} disabled={loading}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> {t("meta.revenue.reload")}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-slate-500">{t("meta.revenue.kpi.spend")}</span>
            <Wallet className="h-4 w-4 text-slate-400" />
          </div>
          <p className="text-xl font-black text-slate-800 mt-2">{spendError ? "—" : short(spend)}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {spendData
              ? t("meta.revenue.kpi.spendSub", { google: short(spendData.google.spend), facebook: short(spendData.facebook.spend) })
              : t("meta.revenue.kpi.fetching")}
          </p>
          {spendError && <p className="text-[11px] text-amber-600 mt-1">⚠️ {spendError}</p>}
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-slate-500">{t("meta.revenue.kpi.rev")}</span>
            <Receipt className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="text-xl font-black text-emerald-700 mt-2">{report ? short(tagged) : "—"}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {t("meta.revenue.kpi.revSub", { n: taggedOrders.toLocaleString(intl) })}
          </p>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold text-slate-500">{t("meta.revenue.kpi.roas")}</span>
            <TrendingUp className="h-4 w-4 text-indigo-500" />
          </div>
          <p className={cn("text-xl font-black mt-2",
            roasReal === null ? "text-slate-400"
            : roasReal >= 2 ? "text-emerald-700" : roasReal >= 1 ? "text-amber-600" : "text-red-600")}>
            {roasReal === null ? "—" : `${roasReal.toFixed(2)}x`}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {roasReal === null ? t("meta.revenue.kpi.roasMissing") : t("meta.revenue.kpi.roasHint")}
          </p>
        </div>
      </div>

      {/* Đối chiếu hai cách đo — lý do trang này tồn tại */}
      {roasDeclared !== null && roasReal !== null && (
        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
          <h2 className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
            <Scale className="h-4 w-4 text-slate-400" /> {t("meta.revenue.cmp.title")}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
            <div>
              <p className="text-[11px] font-semibold text-slate-500">{t("meta.revenue.cmp.declared")}</p>
              <p className="text-lg font-bold text-slate-700 mt-1">{roasDeclared.toFixed(2)}x</p>
              <p className="text-[11px] text-slate-400">{t("meta.revenue.cmp.declaredSub", { value: short(declared) })}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500">{t("meta.revenue.cmp.real")}</p>
              <p className="text-lg font-bold text-emerald-700 mt-1">{roasReal.toFixed(2)}x</p>
              <p className="text-[11px] text-slate-400">{t("meta.revenue.cmp.realSub", { value: short(tagged) })}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500">{t("meta.revenue.cmp.gap")}</p>
              <p className={cn("text-lg font-bold mt-1", (gap ?? 1) >= 1.5 ? "text-red-600" : "text-slate-700")}>
                {gap === null ? "—" : `${gap.toFixed(2)}×`}
              </p>
              <p className="text-[11px] text-slate-400">{t("meta.revenue.cmp.gapSub")}</p>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-3 leading-relaxed">
            {rich(t("meta.revenue.cmp.note"))}
          </p>
        </div>
      )}

      {/* Bảng theo nhãn campaign */}
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-700">{t("meta.revenue.tbl.title")}</h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {rich(t("meta.revenue.tbl.note"))}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-5 py-2 font-semibold">{t("meta.revenue.tbl.label")}</th>
                <th className="text-right px-5 py-2 font-semibold">{t("meta.revenue.tbl.orders")}</th>
                <th className="text-right px-5 py-2 font-semibold">{t("meta.revenue.tbl.revenue")}</th>
                <th className="text-right px-5 py-2 font-semibold">{t("meta.revenue.tbl.aov")}</th>
                <th className="text-right px-5 py-2 font-semibold">{t("meta.revenue.tbl.share")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {!report && (
                <tr><td colSpan={5} className="px-5 py-6 text-center text-slate-400 text-xs">
                  {loading ? t("meta.revenue.tbl.reading") : t("meta.revenue.tbl.noData")}
                </td></tr>
              )}
              {report && report.rows.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-6 text-center text-slate-400 text-xs">
                  {t("meta.revenue.tbl.empty")}
                </td></tr>
              )}
              {report?.rows.map(r => (
                <tr key={r.campaign} className="hover:bg-slate-50">
                  <td className="px-5 py-2.5 font-medium text-slate-800">
                    {r.campaign}
                    {r.revenue === 0 && (
                      <span className="ml-2 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                        {t("meta.revenue.tbl.zero")}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right text-slate-600 tabular-nums">{r.orders.toLocaleString(intl)}</td>
                  <td className="px-5 py-2.5 text-right font-semibold text-slate-800 tabular-nums">{vnd(r.revenue)}</td>
                  <td className="px-5 py-2.5 text-right text-slate-600 tabular-nums">{vnd(r.aov)}</td>
                  <td className="px-5 py-2.5 text-right text-slate-500 tabular-nums">
                    {tagged > 0 ? `${(r.revenue / tagged * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Phần KHÔNG gắn nhãn */}
      {report && report.ordersWithoutCampaign > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
          <h3 className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
            <Info className="h-4 w-4 text-slate-400" /> {t("meta.revenue.un.title")}
          </h3>
          <p className="text-sm text-slate-700 mt-1">
            {rich(t("meta.revenue.un.count", { n: report.ordersWithoutCampaign.toLocaleString(intl), value: short(report.revenueWithoutCampaign) }))}
          </p>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            {rich(t("meta.revenue.un.note"))}
          </p>
        </div>
      )}

      {/* Giới hạn — đặt cạnh số, không giấu trong tài liệu */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
        <h3 className="text-sm font-bold text-amber-900 flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4" /> {t("meta.revenue.lim.title")}
        </h3>
        <ul className="mt-2 space-y-1.5 text-xs text-amber-900 leading-relaxed">
          <li>{rich(t("meta.revenue.lim.1"))}</li>
          <li>{rich(t("meta.revenue.lim.2"))}</li>
          <li>{rich(t("meta.revenue.lim.3"))}</li>
          <li>{rich(t("meta.revenue.lim.4"))}</li>
          <li>{rich(t("meta.revenue.lim.5"))}</li>
        </ul>
      </div>
    </div>
  );
}
