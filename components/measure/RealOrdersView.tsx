// ============================================================
// Đợt 16 — tab "Đơn thật" của trang Đo lường
// ------------------------------------------------------------
// Xem trước (chỉ đọc Odoo) → bật Google / Meta (gõ XAC NHAN) → job 3 giờ một lần gửi.
// Client component: CHỈ `import type` từ lib/conversions/* (các module đó kéo fs / odoo-client).
// confirmText lấy từ payload API, không import hằng số.
// ============================================================
"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { AlertTriangle, Eye, Loader2, Play, Power, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Pill } from "@/components/measure/Pill";
import { OrderSourcePanel } from "@/components/measure/OrderSourcePanel";
import { GoogleRealOrderCompare } from "@/components/measure/GoogleRealOrderCompare";
import { MetaRealOrderCompare } from "@/components/measure/MetaRealOrderCompare";
import { datetimeVN, num, vnd } from "@/components/case/format";
import { getJson, postJson, ApiError } from "@/components/case/api";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { Company } from "@/lib/case/types";
import type { RealOrderSettings, SyncResult } from "@/lib/conversions/sync";
import type { Coverage } from "@/lib/conversions/real-orders";

interface StatusResponse {
  settings: RealOrderSettings
  unsupported: string | null
  source: "odoo" | "webhook" | "csv" | null
  confirmText: string
  metaEventName: string
  meta: { total: number; byStatus: Record<"pending" | "sent" | "test_sent" | "failed" | "expired", number>; lastSentAt: string | null; lastErrors: string[] }
  google: {
    actions: { stage: string; name: string; resourceName: string | null; status: string | null; primary: boolean | null }[]
    stats: { total: number; byStatus: Record<"pending" | "uploaded" | "failed" | "skipped", number> }
  }
  canEdit: boolean
}

const rich = (s: string) => s.split(/<(b|code)>(.*?)<\/\1>/).map((part, i, a) => (i % 3 === 2 ? (a[i - 1] === "b" ? <b key={i}>{part}</b> : <code key={i} className="rounded bg-slate-100 px-1">{part}</code>) : i % 3 === 1 ? null : part));
const pctOf = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—")

function CoverageBox({ title, c }: { title: string; c: Coverage | null }) {
  const intl = useIntlLocale();
  const t = useT()
  if (!c) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-medium text-slate-500">{title}</div>
      <div className="mt-1 text-lg font-bold text-slate-900">{t("meta.measure.ro.cov.head", { n: num(c.orders, undefined, intl), value: vnd(c.value, intl) })}</div>
      <div className="mt-1 text-xs text-slate-600">
        {rich(t("meta.measure.ro.cov.line", { email: pctOf(c.withEmail, c.orders), phone: pctOf(c.withPhone, c.orders), gclid: c.withClickId ? ` · gclid ${pctOf(c.withClickId, c.orders)}` : "", fbc: c.withFbc ? ` · fbc ${pctOf(c.withFbc, c.orders)}` : "", matchable: pctOf(c.matchable, c.orders), n: num(c.matchable, undefined, intl) }))}
      </div>
    </div>
  )
}

export function RealOrdersView({ company }: { company: Company }) {
  const intl = useIntlLocale();
  const t = useT()
  const url = `/api/conversions/real-orders?company=${company}`
  const { data, error, isLoading, mutate } = useSWR<StatusResponse>(url, getJson)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null)
  const [preview, setPreview] = useState<SyncResult | null>(null)
  const [confirmFor, setConfirmFor] = useState<"google" | "meta" | null>(null)
  const [typed, setTyped] = useState("")
  const [testCode, setTestCode] = useState("")

  async function call(key: string, body: Record<string, unknown>, ok?: (r: { result?: SyncResult }) => string | void) {
    setBusy(key); setMsg(null)
    try {
      const r = await postJson("/api/conversions/real-orders", { company, ...body })
      const okText = ok?.(r)
      if (okText) setMsg({ tone: "green", text: okText })
      await mutate()
      return true
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof ApiError ? e.message : t("meta.measure.ro.error") })
      return false
    } finally { setBusy(null) }
  }

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> {t("meta.measure.ro.loading")}</div>
  if (error || !data) return <EmptyState icon={AlertTriangle} title={t("meta.measure.ro.loadFail")} description={error instanceof ApiError ? error.message : t("meta.measure.ro.loadFailDesc")} />
  // Đợt 19-0: chưa có nguồn đơn vẫn hiện bảng chọn nguồn (trước đây chỉ có dòng "chưa gửi được" — MBC không có lối nào).
  if (data.unsupported) return <div className="space-y-4"><OrderSourcePanel company={company} onChanged={() => void mutate()} /></div>

  const g = data.settings.google, m = data.settings.meta
  const wonAction = data.google.actions.find((a) => a.stage === "won" && a.resourceName)

  return (
    <div className="space-y-4">
      <OrderSourcePanel company={company} onChanged={() => void mutate()} />
      {msg && <div className={msg.tone === "green" ? "rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800" : "rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"}>{msg.text}</div>}

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-900">{t("meta.measure.ro.p1.title")}</h2>
            <p className="text-sm text-slate-500">{t("meta.measure.ro.p1.desc", { company, how: data.source === "odoo" ? t("meta.measure.ro.p1.howOdoo") : t("meta.measure.ro.p1.howOther") })}</p>
          </div>
          <Button variant="outline" size="sm" disabled={!!busy || !data.canEdit} onClick={() => call("preview", { op: "preview" }, (r) => { setPreview(r.result ?? null) })}>
            {busy === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} {t("meta.measure.ro.p1.btn")}
          </Button>
        </div>
        {preview && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <CoverageBox title={t("meta.measure.ro.p1.cov30")} c={preview.coverage30} />
            <CoverageBox title={t("meta.measure.ro.p1.cov7")} c={preview.coverage7} />
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-900">2. Google Ads</h2>
            <Pill tone={g?.enabled ? "green" : "grey"}>{g?.enabled ? t("meta.measure.ro.g.on") : t("meta.measure.ro.g.off")}</Pill>
          </div>
          <p className="mt-1 text-sm text-slate-600">{rich(t("meta.measure.ro.g.desc"))}</p>
          {!wonAction && (
            <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              {t("meta.measure.ro.g.noAction")}<Link className="underline" href="/google-pmax">{t("meta.measure.ro.g.noActionLink")}</Link>.
            </p>
          )}
          <div className="mt-2 text-xs text-slate-500">
            {t("meta.measure.ro.g.queue", { pending: num(data.google.stats.byStatus.pending, undefined, intl), uploaded: num(data.google.stats.byStatus.uploaded, undefined, intl), failed: num(data.google.stats.byStatus.failed, undefined, intl) })}
            {g?.at && <>{t("meta.measure.ro.g.changed", { time: datetimeVN(g.at, intl), by: g.by ?? "" })}</>}
          </div>
          {data.canEdit && (
            <Button className="mt-3" size="sm" variant={g?.enabled ? "outline" : "default"} disabled={!!busy}
              onClick={() => (g?.enabled ? call("g-off", { op: "toggle", platform: "google", enabled: false }, () => t("meta.measure.ro.g.turnedOff")) : (setTyped(""), setConfirmFor("google")))}>
              <Power className="h-3.5 w-3.5" /> {g?.enabled ? t("meta.measure.ro.g.off") : t("meta.measure.ro.g.enableBtn")}
            </Button>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-900">{t("meta.measure.ro.m.title")}</h2>
            <Pill tone={m?.enabled ? (m.testEventCode ? "amber" : "green") : "grey"}>{m?.enabled ? (m.testEventCode ? t("meta.measure.ro.m.onTest") : t("meta.measure.ro.g.on")) : t("meta.measure.ro.g.off")}</Pill>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {rich(t("meta.measure.ro.m.desc", { event: data.metaEventName }))}
          </p>
          <div className="mt-2 text-xs text-slate-500">
            {t("meta.measure.ro.m.queue", { pending: num(data.meta.byStatus.pending, undefined, intl), sent: num(data.meta.byStatus.sent, undefined, intl), testSent: num(data.meta.byStatus.test_sent, undefined, intl), failed: num(data.meta.byStatus.failed, undefined, intl), expired: num(data.meta.byStatus.expired, undefined, intl) })}
            {data.meta.lastSentAt && <>{t("meta.measure.ro.m.lastSent", { time: datetimeVN(data.meta.lastSentAt, intl) })}</>}
          </div>
          {data.meta.lastErrors.length > 0 && <p className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-800">{t("meta.measure.ro.m.lastErrors", { errors: data.meta.lastErrors.join(" · ") })}</p>}
          {data.canEdit && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              {!m?.enabled && (
                <label className="text-xs text-slate-600">
                  {t("meta.measure.ro.m.testCode")}
                  <input value={testCode} onChange={(e) => setTestCode(e.target.value.trim())} placeholder="TEST12345" className="mt-1 block h-9 w-44 rounded-md border border-slate-300 px-2 text-sm" />
                </label>
              )}
              <Button size="sm" variant={m?.enabled ? "outline" : "default"} disabled={!!busy}
                onClick={() => (m?.enabled ? call("m-off", { op: "toggle", platform: "meta", enabled: false }, () => t("meta.measure.ro.m.turnedOff")) : (setTyped(""), setConfirmFor("meta")))}>
                <Power className="h-3.5 w-3.5" /> {m?.enabled ? t("meta.measure.ro.g.off") : testCode ? t("meta.measure.ro.m.enableTest") : t("meta.measure.ro.m.enable")}
              </Button>
            </div>
          )}
        </section>
      </div>

      <GoogleRealOrderCompare company={company} />
      <MetaRealOrderCompare company={company} canEdit={data.canEdit} confirmText={data.confirmText} />

      {data.canEdit && (g?.enabled || m?.enabled) && (
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => call("run", { op: "run" }, (r) => {
          const x = r.result
          if (!x) return t("meta.measure.ro.run.done")
          const parts = [t("meta.measure.ro.run.orders", { n: num(x.coverage30?.orders ?? 0, undefined, intl) })]
          if (x.google.enabled) parts.push(t("meta.measure.ro.run.google", { n: num(x.google.accepted ?? 0, undefined, intl) }))
          if (x.meta.enabled) parts.push(x.meta.error ? t("meta.measure.ro.run.metaErr", { error: x.meta.error }) : t("meta.measure.ro.run.meta", { test: x.meta.test ? t("meta.measure.ro.run.test") : "", sent: num(x.meta.send?.sent ?? 0, undefined, intl), received: num(x.meta.send?.received ?? 0, undefined, intl), failed: num(x.meta.send?.failed ?? 0, undefined, intl) }))
          return parts.join(" · ")
        })}>
          {busy === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {t("meta.measure.ro.run.btn")}
        </Button>
      )}

      <Dialog open={!!confirmFor} onOpenChange={(o) => !o && setConfirmFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmFor === "google" ? t("meta.measure.ro.dlg.google") : testCode ? t("meta.measure.ro.dlg.metaTest") : t("meta.measure.ro.dlg.meta")}</DialogTitle>
            <DialogDescription>
              {confirmFor === "google"
                ? t("meta.measure.ro.dlg.googleDesc")
                : testCode
                  ? t("meta.measure.ro.dlg.metaTestDesc", { code: testCode })
                  : t("meta.measure.ro.dlg.metaDesc", { event: data.metaEventName, company })}
              {" "}{t("meta.measure.ro.dlg.offAnytime")}
            </DialogDescription>
          </DialogHeader>
          <label className="text-sm text-slate-700">
            {rich(t("meta.measure.ro.dlg.type", { text: data.confirmText }))}
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1 block h-10 w-full rounded-md border border-slate-300 px-2" />
          </label>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{t("meta.measure.cancel")}</DialogClose>
            <Button disabled={typed !== data.confirmText || !!busy} onClick={async () => {
              const p = confirmFor!
              const ok = await call(`${p}-on`, { op: "toggle", platform: p, enabled: true, confirmText: typed, ...(p === "meta" ? { testEventCode: testCode || null } : {}) }, () => (p === "google" ? t("meta.measure.ro.dlg.enableDone") : testCode ? t("meta.measure.ro.dlg.enableTestDone") : t("meta.measure.ro.dlg.enableMetaDone")))
              if (ok) setConfirmFor(null)
            }}>
              {busy?.endsWith("-on") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {t("meta.measure.ro.dlg.enable")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
