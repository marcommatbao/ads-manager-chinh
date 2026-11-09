"use client";

// ============================================================
// Bảng "Creative theo đơn thật" (Đợt 17). CHỈ import type từ lib/meta/creative-truth (module đó kéo meta-graph / GA4).
// Số nào cũng ghi NGUỒN; nguồn chấm là MỘT cho cả tài khoản (không trộn nguồn giữa các dòng).
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { AlertTriangle, Info, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill, type PillTone } from "@/components/measure/Pill";
import { datetimeVN, num, vnd } from "@/components/case/format";
import { getJson, ApiError } from "@/components/case/api";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { DateRangeValue } from "@/components/DateRangeControl";
import type { CreativeTruth, Verdict } from "@/lib/meta/creative-truth";

type Resp = CreativeTruth & { verdictLabels: Record<Verdict, string> };
const TONE: Record<Verdict, PillTone> = { nhan_ban: "green", nen_tat: "red", bi_nham: "amber", meta_bao_ho: "amber", on: "blue", chua_du_so: "grey" };
const FILTERS: (Verdict | "all")[] = ["all", "nhan_ban", "nen_tat", "bi_nham", "meta_bao_ho", "on", "chua_du_so"];
const n1 = (x: number | null | undefined, loc?: string) => (x == null ? "—" : num(Math.round(x * 10) / 10, undefined, loc));

export function CreativeTruthView({ company, range }: { company: string; range: DateRangeValue }) {
  const intl = useIntlLocale();
  const tr = useT();
  const url = `/api/meta/creative-truth?company=${company}&from=${range.from}&to=${range.to}`;
  const { data, error, isLoading, mutate } = useSWR<Resp>(url, getJson, { revalidateOnFocus: false });
  const [filter, setFilter] = useState<Verdict | "all">("all");
  const [pulling, setPulling] = useState(false);
  const rows = useMemo(() => (data ? data.ads.filter((a) => filter === "all" || a.verdict === filter) : []), [data, filter]);

  async function pull() {
    setPulling(true);
    try { await mutate(await getJson(`${url}&force=1`), { revalidate: false }); } catch { /* lỗi hiện qua SWR lần sau */ } finally { setPulling(false); }
  }

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> {tr("meta.truth.loading")}</div>;
  if (error || !data) {
    const msg = error instanceof ApiError ? error.message : tr("meta.truth.err.generic");
    return <EmptyState icon={AlertTriangle} title={tr("meta.truth.err.title")} description={/hạn mức|#613|rate/i.test(msg) ? tr("meta.truth.err.rate", { msg }) : msg} />;
  }
  if (!data.ads.length) return <EmptyState icon={Info} title={tr("meta.truth.empty.title", { company })} description={tr("meta.truth.empty.desc")} />;

  const t = data.totals;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">{tr("meta.truth.sum.spend", { n: num(t.ads, undefined, intl) })}</div><div className="text-lg font-bold">{vnd(t.spend, intl)}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">{tr("meta.truth.sum.metaClaims")}</div><div className="text-lg font-bold text-slate-400 line-through decoration-1">{n1(t.meta, intl)}</div></div>
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3"><div className="text-xs text-blue-700">{tr("meta.truth.sum.scored")}</div><div className="text-lg font-bold text-blue-900">{n1(t.truth, intl)}</div><div className="text-[11px] text-blue-700">{data.sourceLabel}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">{tr("meta.truth.sum.cpa")}</div><div className="text-lg font-bold">{data.accountCpa ? vnd(data.accountCpa, intl) : "—"}</div>{t.value != null && t.spend > 0 && <div className="text-[11px] text-slate-500">{tr("meta.truth.sum.roas", { value: (t.value / t.spend).toFixed(2) })}</div>}</div>
      </div>

      {data.notes.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 space-y-1">
          {data.notes.map((n) => <p key={n} className="flex gap-2"><Info className="h-4 w-4 shrink-0 text-slate-400 mt-0.5" />{n}</p>)}
          {!data.setup.odooConversion && company === "MBI" && <p className="pl-6"><Link className="text-blue-700 underline" href="/do-luong?tab=orders&company=MBI">{tr("meta.truth.openMeasure")}</Link></p>}
        </div>
      )}
      {data.errors.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{tr("meta.truth.partial", { errors: data.errors.join(" · ") })}</div>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
              className={cn("rounded-full border px-3 py-1 text-xs font-semibold", filter === f ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>
              {f === "all" ? tr("meta.truth.filter.all", { n: data.ads.length }) : `${data.verdictLabels[f]} ${data.counts[f]}`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>{tr("meta.truth.read", { time: datetimeVN(data.collectedAt, intl), n: data.calls })}</span>
          <Button variant="outline" size="sm" onClick={pull} disabled={pulling}>{pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {tr("meta.truth.refetch")}</Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">{tr("meta.truth.th.ad")}</th>
              <th className="px-3 py-2 text-right">{tr("meta.truth.th.spend")}</th>
              <th className="px-3 py-2 text-right" title={tr("meta.truth.th.metaTitle")}>{tr("meta.truth.th.meta")}</th>
              <th className="px-3 py-2 text-right">{tr("meta.truth.th.click")}</th>
              {data.setup.odooConversion && <th className="px-3 py-2 text-right">{tr("meta.truth.th.odoo")}</th>}
              {data.setup.ga4AdsTagged > 0 && <th className="px-3 py-2 text-right">GA4</th>}
              <th className="px-3 py-2 text-right">{tr("meta.truth.th.cpa")}</th>
              {data.source === "odoo" && <th className="px-3 py-2 text-right">{tr("meta.truth.th.roas")}</th>}
              <th className="px-3 py-2 text-right">{tr("meta.truth.th.freq")}</th>
              <th className="px-3 py-2 text-left">{tr("meta.truth.th.verdict")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    {a.thumb ? <img src={a.thumb} alt="" className="h-10 w-10 shrink-0 rounded object-cover" /> : <div className="h-10 w-10 shrink-0 rounded bg-slate-100" />}
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 line-clamp-2">{a.name}</div>
                      <div className="text-[11px] text-slate-500 line-clamp-1">{a.campaignName} · {a.adsetName}{a.status && a.status !== "ACTIVE" ? ` · ${a.status}` : ""}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{vnd(a.spend, intl)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-400">{n1(a.metaPurchases, intl)}{a.viewShare != null && a.metaPurchases > 0 && <div className="text-[10px]">{tr("meta.truth.viewOnlyPct", { pct: Math.round(a.viewShare * 100) })}</div>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{n1(a.click, intl)}</td>
                {data.setup.odooConversion && <td className="px-3 py-2 text-right tabular-nums font-semibold">{n1(a.odoo, intl)}</td>}
                {data.setup.ga4AdsTagged > 0 && <td className="px-3 py-2 text-right tabular-nums">{n1(a.ga4, intl)}</td>}
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{a.cpa ? vnd(a.cpa, intl) : "—"}</td>
                {data.source === "odoo" && <td className="px-3 py-2 text-right tabular-nums">{a.roas != null ? `${a.roas.toFixed(2)}x` : "—"}</td>}
                <td className={cn("px-3 py-2 text-right tabular-nums", (a.frequency ?? 0) >= 3.5 && "text-amber-700 font-semibold")}>{a.frequency != null ? a.frequency.toFixed(1) : "—"}</td>
                <td className="px-3 py-2">
                  <Pill tone={TONE[a.verdict]}>{data.verdictLabels[a.verdict]}</Pill>
                  {a.reasons.map((r) => <div key={r} className="mt-1 text-[11px] text-slate-500">{r}</div>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">{tr("meta.truth.footer")}</p>
    </div>
  );
}
