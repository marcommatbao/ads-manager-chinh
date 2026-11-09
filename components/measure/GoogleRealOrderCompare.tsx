// ============================================================
// Đợt 19b — "Google học theo đơn thật": Sẵn sàng + so sánh 30 ngày theo chiến dịch
// ------------------------------------------------------------
// Chỉ đọc. Tool KHÔNG tự đưa hành động lên mục tiêu chính — chỉ kết luận từng chiến dịch.
// Client component: chỉ `import type` từ lib/*.
// ============================================================
"use client";

import useSWR from "swr";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { num, vnd } from "@/components/case/format";
import { getJson, ApiError } from "@/components/case/api";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { Company } from "@/lib/case/types";
import type { CampaignCompare, Readiness } from "@/lib/conversions/google-compare";

const bold = (s: string) => s.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));

interface Resp { range: { from: string; to: string }; daysOn: number | null; readiness: Readiness; campaigns: CampaignCompare[] }

const VERDICT: Record<CampaignCompare["verdict"], { label: MessageKey; cls: string }> = {
  gathering: { label: "meta.measure.gc.v.gathering", cls: "bg-slate-100 text-slate-600" },
  few: { label: "meta.measure.gc.v.few", cls: "bg-amber-50 text-amber-700" },
  no_match: { label: "meta.measure.gc.v.no_match", cls: "bg-red-50 text-red-700" },
  ready: { label: "meta.measure.gc.v.ready", cls: "bg-emerald-50 text-emerald-700" },
};

export function GoogleRealOrderCompare({ company }: { company: Company }) {
  const intl = useIntlLocale();
  const t = useT();
  const { data, error, isLoading } = useSWR<Resp>(`/api/conversions/real-orders?company=${company}&view=google`, getJson);
  if (isLoading) return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> {t("meta.measure.gc.loading")}</div>;
  if (error || !data) return <p className="text-xs text-red-600">{t("meta.measure.gc.err", { error: error instanceof ApiError ? error.message : t("meta.measure.tryLater") })}</p>;
  const { readiness: r } = data;
  const totals = data.campaigns.reduce((s, c) => ({ cost: s.cost + c.cost, g: s.g + c.googleConv, real: s.real + c.realOrders, v: s.v + c.realValue }), { cost: 0, g: 0, real: 0, v: 0 });

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <h2 className="font-semibold text-slate-900">{t("meta.measure.gc.title")}</h2>
        <p className="text-sm text-slate-500">
          {t("meta.measure.gc.intro")}
          {data.daysOn != null && <> · {bold(t("meta.measure.gc.daysOn", { n: data.daysOn }))}</>}
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 p-3 text-xs">
        <p className="mb-1.5 font-semibold text-slate-700">{t("meta.measure.ready")}</p>
        <ul className="space-y-1">
          <Check ok={r.action.exists === null ? null : r.action.exists && !r.action.primary} label={t("meta.measure.gc.action", { state: r.action.exists === null ? "" : r.action.exists ? (r.action.primary ? t("meta.measure.gc.actionPrimary") : t("meta.measure.gc.actionSecondary")) : t("meta.measure.gc.actionNone") })} />
          <Check ok={r.customerDataTerms} label={t("meta.measure.gc.terms")} />
          <Check ok={r.ecForLeads} label={t("meta.measure.gc.ec")} />
        </ul>
        {r.errors?.map((e, i) => <p key={i} className="mt-1 text-red-600">{t("meta.measure.gc.readErr", { error: e })}</p>)}
        {r.todo.length > 0 && (
          <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-amber-800">{r.todo.map((todo, i) => <li key={i}>{todo}</li>)}</ol>
        )}
      </div>

      {data.campaigns.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">{t("meta.measure.gc.noData", { why: r.action.exists ? t("meta.measure.gc.noCampaigns") : t("meta.measure.gc.createAction") })}</p>
      ) : (
        <div className="overflow-x-auto">
          <p className="mb-1 text-xs text-slate-500">
            {bold(t("meta.measure.gc.summary", { from: data.range.from, to: data.range.to, g: num(Math.round(totals.g), undefined, intl), real: num(Math.round(totals.real), undefined, intl), value: vnd(totals.v, intl) }))}{" "}{t("meta.measure.gc.summaryNote")}
          </p>
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-slate-400">
              <tr><th className="py-1">{t("meta.measure.gc.th.campaign")}</th><th className="text-right">{t("meta.measure.gc.th.spend")}</th><th className="text-right">{t("meta.measure.gc.th.googleOrders")}</th><th className="text-right">{t("meta.measure.gc.th.cpaGoogle")}</th><th className="text-right">{t("meta.measure.gc.th.real")}</th><th className="text-right">{t("meta.measure.gc.th.cpaReal")}</th><th className="pl-3">{t("meta.measure.gc.th.verdict")}</th></tr>
            </thead>
            <tbody>
              {data.campaigns.slice(0, 40).map((c) => (
                <tr key={c.id} className="border-t border-slate-100 align-top">
                  <td className="max-w-[260px] py-1.5 pr-2 text-slate-700">{c.name}</td>
                  <td className="text-right tabular-nums">{vnd(c.cost, intl)}</td>
                  <td className="text-right tabular-nums">{num(Math.round(c.googleConv * 10) / 10, undefined, intl)}</td>
                  <td className="text-right tabular-nums">{c.cpaGoogle != null ? vnd(c.cpaGoogle, intl) : "—"}</td>
                  <td className="text-right font-semibold tabular-nums">{num(Math.round(c.realOrders * 10) / 10, undefined, intl)}</td>
                  <td className="text-right font-semibold tabular-nums">{c.cpaReal != null ? vnd(c.cpaReal, intl) : "—"}</td>
                  <td className="pl-3"><span className={`rounded-full px-2 py-0.5 font-semibold ${VERDICT[c.verdict].cls}`} title={c.note}>{t(VERDICT[c.verdict].label)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.campaigns.some((c) => c.verdict === "ready" || c.verdict === "no_match") && (
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {data.campaigns.filter((c) => c.verdict === "ready" || c.verdict === "no_match").slice(0, 8).map((c) => <li key={c.id}><b>{c.name}:</b> {c.note}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Check({ ok, label }: { ok: boolean | null; label: string }) {
  const t = useT();
  return (
    <li className="flex items-start gap-1.5">
      {ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" /> : <CircleAlert className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${ok === null ? "text-slate-400" : "text-amber-600"}`} aria-hidden="true" />}
      <span className={ok === null ? "text-slate-400" : "text-slate-700"}>{label}{ok === null ? ` — ${t("meta.measure.unreadable")}` : ""}</span>
    </li>
  );
}
