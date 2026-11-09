// ============================================================
// Đợt 19c — "Facebook học theo đơn thật": Sẵn sàng + tạo chuyển đổi tuỳ chỉnh + so sánh 30 ngày theo chiến dịch
// ------------------------------------------------------------
// Tạo chuyển đổi tuỳ chỉnh: Kiểm trước (Meta chỉ kiểm dữ liệu, không kiểm quyền) → gõ XAC NHAN → tạo.
// Client component: chỉ `import type` từ lib/*.
// ============================================================
"use client";

import { useState } from "react";
import useSWR from "swr";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { num, vnd } from "@/components/case/format";
import { getJson, postJson, ApiError } from "@/components/case/api";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { Company } from "@/lib/case/types";
import type { MetaCampaignCompare, MetaReadiness } from "@/lib/conversions/meta-compare";

const bold = (s: string) => s.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));

interface Resp { range: { from: string; to: string }; readiness: MetaReadiness & { error?: string }; campaigns: MetaCampaignCompare[]; compareError: string | null }

const VERDICT: Record<MetaCampaignCompare["verdict"], { label: MessageKey; cls: string }> = {
  no_conversion: { label: "meta.measure.mc.v.no_conversion", cls: "bg-slate-100 text-slate-600" },
  few: { label: "meta.measure.mc.v.few", cls: "bg-amber-50 text-amber-700" },
  view_heavy: { label: "meta.measure.mc.v.view_heavy", cls: "bg-red-50 text-red-700" },
  ready: { label: "meta.measure.mc.v.ready", cls: "bg-emerald-50 text-emerald-700" },
};

export function MetaRealOrderCompare({ company, canEdit, confirmText }: { company: Company; canEdit: boolean; confirmText: string }) {
  const intl = useIntlLocale();
  const t = useT();
  const { data, error, isLoading, mutate } = useSWR<Resp>(`/api/conversions/real-orders?company=${company}&view=meta`, getJson);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  async function cc(validateOnly: boolean) {
    setBusy(validateOnly ? "check" : "create"); setMsg(null);
    try {
      const r = await postJson("/api/conversions/real-orders", { company, op: "meta_cc", validateOnly, confirmText: typed }) as { id?: string };
      if (validateOnly) { setMsg({ tone: "green", text: t("meta.measure.mc.checkOk") }); setOpen(true); setTyped(""); }
      else { setMsg({ tone: "green", text: t("meta.measure.mc.created", { id: r.id ? t("meta.measure.mc.createdId", { id: r.id }) : "" }) }); setOpen(false); await mutate(); }
    } catch (e) { setMsg({ tone: "red", text: e instanceof ApiError ? e.message : t("meta.measure.mc.error") }); }
    finally { setBusy(null); }
  }

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> {t("meta.measure.mc.loading")}</div>;
  if (error || !data) return <p className="text-xs text-red-600">{t("meta.measure.mc.err", { error: error instanceof ApiError ? error.message : t("meta.measure.tryLater") })}</p>;
  const r = data.readiness;
  const tot = data.campaigns.reduce((s, c) => ({ m: s.m + c.metaPurchases, real: s.real + c.realOrders, v: s.v + c.realValue }), { m: 0, real: 0, v: 0 });

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <h2 className="font-semibold text-slate-900">{t("meta.measure.mc.title")}</h2>
        <p className="text-sm text-slate-500">{t("meta.measure.mc.intro")}</p>
      </div>

      <div className="rounded-lg border border-slate-200 p-3 text-xs">
        <p className="mb-1.5 font-semibold text-slate-700">{t("meta.measure.ready")}</p>
        <ul className="space-y-1">
          <Check ok={!!r.pixelId} label={t("meta.measure.mc.pixel", { value: r.pixelId ?? t("meta.measure.mc.none") })} />
          <Check ok={r.sending && !r.test} label={t("meta.measure.mc.capi", { state: r.sending ? (r.test ? t("meta.measure.mc.capiTest") : t("meta.measure.mc.capiOn", { n: num(r.sent, undefined, intl) })) : t("meta.measure.mc.capiOff") })} />
          <Check ok={r.error ? null : !!r.conversion} label={t("meta.measure.mc.cc", { state: r.conversion ? `"${r.conversion.name}"` : t("meta.measure.mc.none"), err: r.error ? t("meta.measure.mc.ccErr", { error: r.error }) : "" })} />
        </ul>
        {r.todo.length > 0 && <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-amber-800">{r.todo.map((todo, i) => <li key={i}>{todo}</li>)}</ol>}
        {canEdit && !r.conversion && !r.error && r.pixelId && (
          <Button type="button" size="sm" variant="outline" className="mt-2 h-8" disabled={!!busy} onClick={() => void cc(true)}>
            {busy === "check" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t("meta.measure.mc.createBtn")}
          </Button>
        )}
        {msg && <p className={`mt-2 ${msg.tone === "green" ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
      </div>

      {data.compareError && <p className="text-xs text-red-600">{t("meta.measure.mc.compareErr", { error: data.compareError })}</p>}
      {data.campaigns.length > 0 && (
        <div className="overflow-x-auto">
          <p className="mb-1 text-xs text-slate-500">{bold(t("meta.measure.mc.summary", { from: data.range.from, to: data.range.to, m: num(Math.round(tot.m), undefined, intl), real: r.conversion ? num(Math.round(tot.real), undefined, intl) : "—", value: r.conversion ? ` (${vnd(tot.v, intl)})` : "" }))}</p>
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="text-slate-400"><tr><th className="py-1">{t("meta.measure.gc.th.campaign")}</th><th className="text-right">{t("meta.measure.gc.th.spend")}</th><th className="text-right">{t("meta.measure.mc.th.meta")}</th><th className="text-right">{t("meta.measure.mc.th.viewShare")}</th><th className="text-right">{t("meta.measure.mc.th.cpaMeta")}</th><th className="text-right">{t("meta.measure.gc.th.real")}</th><th className="text-right">{t("meta.measure.gc.th.cpaReal")}</th><th className="pl-3">{t("meta.measure.gc.th.verdict")}</th></tr></thead>
            <tbody>
              {data.campaigns.slice(0, 40).map((c) => (
                <tr key={c.id} className="border-t border-slate-100 align-top">
                  <td className="max-w-[240px] py-1.5 pr-2 text-slate-700">{c.name}</td>
                  <td className="text-right tabular-nums">{vnd(c.spend, intl)}</td>
                  <td className="text-right tabular-nums">{num(Math.round(c.metaPurchases), undefined, intl)}</td>
                  <td className="text-right tabular-nums">{c.viewShare != null ? `${Math.round(c.viewShare * 100)}%` : "—"}</td>
                  <td className="text-right tabular-nums">{c.cpaMeta != null ? vnd(c.cpaMeta, intl) : "—"}</td>
                  <td className="text-right font-semibold tabular-nums">{r.conversion ? num(Math.round(c.realOrders), undefined, intl) : "—"}</td>
                  <td className="text-right font-semibold tabular-nums">{c.cpaReal != null ? vnd(c.cpaReal, intl) : "—"}</td>
                  <td className="pl-3"><span className={`rounded-full px-2 py-0.5 font-semibold ${VERDICT[c.verdict].cls}`} title={c.note}>{t(VERDICT[c.verdict].label)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.campaigns.some((c) => c.verdict === "ready" || c.verdict === "view_heavy") && (
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {data.campaigns.filter((c) => c.verdict === "ready" || c.verdict === "view_heavy").slice(0, 8).map((c) => <li key={c.id}><b>{c.name}:</b> {c.note}</li>)}
            </ul>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("meta.measure.mc.dlgTitle", { company })}</DialogTitle>
            <DialogDescription>{t("meta.measure.mc.dlgDesc")}</DialogDescription>
          </DialogHeader>
          <label className="text-sm text-slate-700">
            {bold(t("meta.measure.mc.typeConfirm", { text: confirmText }))}
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1 block h-10 w-full rounded-md border border-slate-300 px-2" />
          </label>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{t("meta.measure.cancel")}</DialogClose>
            <Button disabled={typed !== confirmText || !!busy} onClick={() => void cc(false)}>{busy === "create" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t("meta.measure.mc.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Check({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <li className="flex items-start gap-1.5">
      {ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" /> : <CircleAlert className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${ok === null ? "text-slate-400" : "text-amber-600"}`} aria-hidden="true" />}
      <span className="text-slate-700">{label}</span>
    </li>
  );
}
