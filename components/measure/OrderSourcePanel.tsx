// ============================================================
// Đợt 19-0 — "Nguồn đơn": chọn Odoo / Webhook / CSV cho tính năng đơn thật
// ------------------------------------------------------------
// Chưa chọn nguồn = việc cần làm (không phải sự cố). Đổi nguồn gõ XAC NHAN. Khoá webhook hiện ĐÚNG MỘT LẦN.
// 10 đơn gần nhất chỉ có mã / giờ / giá trị + cờ "có email/SĐT/gclid/fbc/utm" — không bao giờ hiện thông tin khách.
// Client component: chỉ `import type` từ lib/*.
// ============================================================
"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { Check, Copy, Database, KeyRound, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { datetimeVN, num, vnd } from "@/components/case/format";
import { getJson, postJson, ApiError } from "@/components/case/api";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { Company } from "@/lib/case/types";
import type { Coverage, OrderSourceId } from "@/lib/conversions/real-orders";

interface SourceResponse {
  sources: { id: OrderSourceId; label: string; hint: string }[]
  reason: string | null
  current: { source: OrderSourceId; by: string | null; at: string | null; hasSecret: boolean; secretCreatedAt: string | null; lastPushAt: string | null } | null
  webhookPath: string
  coverage30: Coverage | null
  recent: { key: string; name: string; time: string; value: number; currency: string; has: Record<"email" | "phone" | "gclid" | "fbc" | "utm", boolean> }[]
  canEdit: boolean
}

const rich = (s: string) => s.split(/<(b|code)>(.*?)<\/\1>/).map((part, i, a) => (i % 3 === 2 ? (a[i - 1] === "b" ? <b key={i}>{part}</b> : <code key={i}>{part}</code>) : i % 3 === 1 ? null : part));
const CONFIRM = "XAC NHAN"
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—")
const sampleOf = (gclid: string) => `{"orders":[{"orderId":"WEB-1001","time":"2026-10-02T10:00:00+07:00","value":1250000,
  "email":"khach@example.com","phone":"0912345678",
  "gclid":"${gclid}","fbc":"<cookie _fbc>","fbp":"<cookie _fbp>",
  "utm_source":"google","utm_campaign":"ten-chien-dich"}]}`
const CSV_HEAD = "order_id,paid_at,value,email,phone,gclid,fbc,utm_source,utm_campaign,status"

export function OrderSourcePanel({ company, onChanged }: { company: Company; onChanged?: () => void }) {
  const intl = useIntlLocale();
  const t = useT()
  const url = `/api/orders/source?company=${company}`
  const { data, mutate } = useSWR<SourceResponse>(url, getJson)
  const [pick, setPick] = useState<OrderSourceId | null>(null)
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [rotateTyped, setRotateTyped] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  async function call(key: string, body: Record<string, unknown>) {
    setBusy(key); setMsg(null)
    try { const r = await postJson(`/api/orders/source`, { company, ...body }); await mutate(); onChanged?.(); return r }
    catch (e) { setMsg({ tone: "red", text: e instanceof ApiError ? e.message : t("meta.measure.os.error") }); return null }
    finally { setBusy(null) }
  }

  if (!data) return null
  const cur = data.current?.source ?? null
  const c = data.coverage30
  const origin = typeof window !== "undefined" ? window.location.origin : ""

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Database className="h-4 w-4 text-slate-500" aria-hidden="true" />
        <h3 className="text-sm font-bold text-slate-800">{t("meta.measure.os.title")}</h3>
        <span className={cur ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700" : "rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"}>
          {cur ? t("meta.measure.os.using", { label: data.sources.find((s) => s.id === cur)?.label ?? "" }) : t("meta.measure.os.none")}
        </span>
        {data.current?.at && <span className="text-xs text-slate-400">{t("meta.measure.os.changedAt", { time: datetimeVN(data.current.at, intl), by: data.current.by ? ` · ${data.current.by}` : "" })}</span>}
      </div>
      <p className="text-xs text-slate-500">{t("meta.measure.os.intro")}</p>
      {data.reason && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{data.reason}</p>}

      <div className="grid gap-2 sm:grid-cols-3">
        {data.sources.map((s) => (
          <button key={s.id} type="button" disabled={!data.canEdit || s.id === cur} onClick={() => { setPick(s.id); setTyped("") }}
            className={`rounded-lg border p-3 text-left text-xs transition ${s.id === cur ? "border-emerald-300 bg-emerald-50/50" : "border-slate-200 hover:border-indigo-300 disabled:opacity-60"}`}>
            <span className="flex items-center gap-1.5 font-semibold text-slate-800">{s.id === cur && <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />}{s.label}</span>
            <span className="mt-1 block text-slate-500">{s.hint}</span>
          </button>
        ))}
      </div>

      {cur === "webhook" && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs">
          <p className="font-semibold text-slate-700">{t("meta.measure.os.wh.sendTo")}</p>
          <code className="block break-all rounded bg-white px-2 py-1.5 text-slate-700">POST {origin}{data.webhookPath}</code>
          <p className="text-slate-500">{rich(t("meta.measure.os.wh.note"))}</p>
          <pre className="overflow-x-auto rounded bg-white p-2 text-[11px] text-slate-600">{sampleOf(t("meta.measure.os.sampleGclid"))}</pre>
          <div className="flex flex-wrap items-center gap-2">
            {data.current?.hasSecret && (
              <Input value={rotateTyped} onChange={(e) => setRotateTyped(e.target.value)} placeholder={t("meta.measure.os.wh.typePh", { confirm: CONFIRM })} autoComplete="off" className="h-8 w-48" />
            )}
            <Button type="button" size="sm" variant="outline" className="h-8" disabled={!data.canEdit || !!busy || (!!data.current?.hasSecret && rotateTyped.trim() !== CONFIRM)}
              onClick={async () => { const r = await call("secret", { op: "secret", confirmText: rotateTyped.trim() }) as { secret?: string } | null; if (r?.secret) { setSecret(r.secret); setCopied(false); setRotateTyped("") } }}>
              {busy === "secret" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />} {data.current?.hasSecret ? t("meta.measure.os.wh.rotate") : t("meta.measure.os.wh.create")}
            </Button>
            {data.current?.secretCreatedAt && <span className="text-slate-400">{t("meta.measure.os.wh.keyCreated", { time: datetimeVN(data.current.secretCreatedAt, intl) })}</span>}
            {data.current?.lastPushAt && <span className="text-slate-400">{t("meta.measure.os.wh.lastPush", { time: datetimeVN(data.current.lastPushAt, intl) })}</span>}
          </div>
          {secret && (
            <div className="space-y-1 rounded border border-amber-200 bg-amber-50 p-2">
              <p className="font-semibold text-amber-800">{t("meta.measure.os.wh.showOnce")}</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all text-amber-900">{secret}</code>
                <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => { void navigator.clipboard?.writeText(secret); setCopied(true) }}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          )}
          <p className="text-slate-500">{rich(t("meta.measure.os.wh.tip"))}</p>
        </div>
      )}

      {cur === "csv" && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs">
          <p className="font-semibold text-slate-700">{t("meta.measure.os.csv.title")}</p>
          <p className="text-slate-500">{rich(t("meta.measure.os.csv.note"))}</p>
          <code className="block break-all rounded bg-white px-2 py-1.5 text-slate-600">{CSV_HEAD}</code>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = ""
            if (!f) return
            if (f.size > 2_000_000) { setMsg({ tone: "red", text: t("meta.measure.os.csv.tooBig") }); return }
            const r = await call("csv", { op: "csv", text: await f.text() }) as { rows?: number; accepted?: number; duplicates?: number; skipped?: number; errors?: string[] } | null
            if (r) setMsg({ tone: r.errors?.length ? "red" : "green", text: t("meta.measure.os.csv.result", { rows: num(r.rows ?? 0, undefined, intl), accepted: num(r.accepted ?? 0, undefined, intl), dup: num(r.duplicates ?? 0, undefined, intl), skipped: num(r.skipped ?? 0, undefined, intl), errs: r.errors?.length ? t("meta.measure.os.csv.errs", { n: r.errors.length, list: r.errors.slice(0, 3).join(" · ") }) : "" }) })
          }} />
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={!data.canEdit || !!busy} onClick={() => fileRef.current?.click()}>
            {busy === "csv" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {t("meta.measure.os.csv.pick")}
          </Button>
        </div>
      )}

      {msg && <p className={msg.tone === "green" ? "text-xs text-emerald-700" : "text-xs text-red-600"}>{msg.text}</p>}

      {c && (
        <div className="rounded-lg border border-slate-200 p-3 text-xs">
          <p className="font-medium text-slate-500">{t("meta.measure.os.cov.title")}</p>
          {c.orders === 0
            ? <p className="mt-1 text-amber-700">{t("meta.measure.os.cov.none", { hint: cur === "webhook" ? t("meta.measure.os.cov.hintWebhook") : t("meta.measure.os.cov.hintCsv") })}</p>
            : <p className="mt-1 text-slate-700">{rich(t("meta.measure.os.cov.line", { orders: num(c.orders, undefined, intl), value: vnd(c.value, intl), email: pct(c.withEmail, c.orders), phone: pct(c.withPhone, c.orders), gclid: pct(c.withClickId, c.orders), fbc: pct(c.withFbc, c.orders), utm: pct(c.withUtm, c.orders), matchable: pct(c.matchable, c.orders) }))}</p>}
        </div>
      )}
      {cur === "odoo" && <p className="text-xs text-slate-400">{t("meta.measure.os.odooNote")}</p>}

      {data.recent.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-indigo-600">{t("meta.measure.os.recent")}</summary>
          <table className="mt-2 w-full text-left">
            <thead className="text-slate-400"><tr><th className="py-1">{t("meta.measure.os.th.id")}</th><th>{t("meta.measure.os.th.time")}</th><th className="text-right">{t("meta.measure.os.th.value")}</th><th className="pl-3">{t("meta.measure.os.th.has")}</th></tr></thead>
            <tbody>
              {data.recent.map((r) => (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="py-1 font-mono">{r.name}</td><td>{datetimeVN(r.time, intl)}</td><td className="text-right tabular-nums">{vnd(r.value, intl)}{r.currency !== "VND" ? ` ${r.currency}` : ""}</td>
                  <td className="pl-3 text-slate-500">{(Object.entries(r.has) as [string, boolean][]).filter(([, v]) => v).map(([k]) => k).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <Dialog open={!!pick} onOpenChange={(o) => { if (!o) setPick(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("meta.measure.os.dlg.title", { company, label: data.sources.find((s) => s.id === pick)?.label ?? "" })}</DialogTitle>
            <DialogDescription>{t("meta.measure.os.dlg.desc")}</DialogDescription>
          </DialogHeader>
          <label className="space-y-1 text-xs">
            <span className="text-slate-500">{t("meta.measure.os.dlg.type", { confirm: CONFIRM }).split(/<code>(.*?)<\/code>/).map((part, i) => (i % 2 ? <code key={i} className="rounded bg-slate-100 px-1">{part}</code> : part))}</span>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={CONFIRM} autoComplete="off" className="h-10" />
          </label>
          {msg?.tone === "red" && <p className="text-xs text-red-600">{msg.text}</p>}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("meta.measure.cancel")}</DialogClose>
            <Button className="h-10" disabled={typed.trim() !== CONFIRM || busy === "set"}
              onClick={async () => { if (await call("set", { op: "set", source: pick, confirmText: typed.trim() })) setPick(null) }}>
              {busy === "set" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t("meta.measure.os.dlg.switch")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
