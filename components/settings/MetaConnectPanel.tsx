"use client"
// ============================================================
// Chế độ cổng — Facebook: kết nối qua Cổng kết nối Mắt Bão → chọn tài khoản quảng cáo + Pixel / Trang cho từng công ty
// trong danh sách khách đã chia sẻ trên hộp thoại Facebook → xem chi tiêu 7 ngày thật.
// Câu chữ cần BA rà (luật handoff: wording thuộc BA).
// ============================================================
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { companyDef, companyIds } from "@/lib/companies/registry"
import { useIntlLocale, useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"

interface AdAccount { id: string; name: string; currency: string; status?: number; business?: string }
interface Named { id: string; name: string }
interface CompanyPick { pixelId?: string; pixelName?: string; pageId?: string; pageName?: string }
export interface MetaStatus { connected: boolean; createdAt?: string; createdBy?: string; adAccount?: AdAccount | null; companies?: Record<string, CompanyPick> }
interface Preview { spend?: number; clicks?: number; impressions?: number; currency?: string; error?: string }

const STATUS_CODES = new Set([2, 3, 7, 9, 100, 101])
const fmtMoney = (n: number, cur: string, loc: string) => `${n.toLocaleString(loc)} ${cur === "VND" ? "₫" : cur}`
const fmtTime = (iso: string | undefined, loc: string) => (iso ? new Date(iso).toLocaleString(loc) : "")

// Chuỗi từ điển có <b>…</b> → in đậm (chỉ chuỗi tĩnh do mình viết trong lib/i18n/messages).
function rich(s: string): React.ReactNode[] {
  return s.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))
}
const label = (co: string) => companyDef(co)?.label ?? co

export function MetaConnectPanel({ status, canEdit, next, onChanged }: { status: MetaStatus; canEdit: boolean; next: "settings" | "setup"; onChanged: () => Promise<void> }) {
  const t = useT()
  const loc = useIntlLocale()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [assets, setAssets] = useState<{ adAccounts: AdAccount[]; pages: Named[] } | null>(null)
  const [pixels, setPixels] = useState<Named[]>([])
  const [acct, setAcct] = useState("")
  const [picks, setPicks] = useState<Record<string, CompanyPick>>({})

  const start = () => { window.location.href = `/api/connect/meta/start?next=${next}` }

  useEffect(() => {
    if (!status.connected || !status.adAccount) { setPreview(null); return }
    let alive = true
    fetch("/api/connect/meta/assets?preview=1", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (alive) setPreview(d as Preview) }).catch(() => {})
    return () => { alive = false }
  }, [status.connected, status.adAccount])

  const loadPixels = useCallback(async (id: string) => {
    setPixels([])
    if (!id) return
    const r = await fetch(`/api/connect/meta/assets?adAccountId=${encodeURIComponent(id)}`, { cache: "no-store" })
    const d = await r.json()
    if (!r.ok) { setMessage({ ok: false, text: t("connect.meta.pixelError", { error: d.error ?? r.status }) }); return }
    setPixels(d.pixels as Named[])
  }, [t])

  async function openPicker() {
    setBusy("assets"); setMessage(null)
    try {
      const r = await fetch("/api/connect/meta/assets", { cache: "no-store" })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? t("connect.errorStatus", { status: r.status }))
      setAssets(d)
      const cur = status.adAccount?.id ?? (d.adAccounts.length === 1 ? d.adAccounts[0].id : "")
      setAcct(cur)
      setPicks(status.companies ?? {})
      await loadPixels(cur)
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally { setBusy(null) }
  }

  async function save() {
    setBusy("save"); setMessage(null)
    try {
      const companies = Object.fromEntries(Object.entries(picks).map(([co, p]) => [co, { pixelId: p.pixelId || undefined, pageId: p.pageId || undefined }]))
      const r = await fetch("/api/connect/meta/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adAccountId: acct, companies }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? t("connect.errorStatus", { status: r.status }))
      setAssets(null)
      setMessage({ ok: true, text: t("connect.meta.saved", { name: d.adAccount.name }) })
      await onChanged()
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally { setBusy(null) }
  }

  async function disconnect() {
    if (!confirm(t("connect.meta.confirmDisconnect"))) return
    setBusy("disconnect"); setMessage(null)
    try {
      const r = await fetch("/api/connect/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "meta" }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? t("connect.errorStatus", { status: r.status }))
      setAssets(null); setPreview(null)
      setMessage({ ok: true, text: t("connect.meta.disconnected") })
      await onChanged()
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally { setBusy(null) }
  }

  const setPick = (co: string, k: "pixelId" | "pageId", v: string) => setPicks((s) => ({ ...s, [co]: { ...s[co], [k]: v } }))

  return (
    <div className="space-y-4">
      {message && (
        <div className={`rounded-xl border p-3 text-sm ${message.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"}`}>{message.text}</div>
      )}

      {!status.connected ? (
        <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-sm text-slate-700">{rich(t("connect.meta.intro"))}</p>
          <Button disabled={!canEdit} onClick={start}>{t("connect.meta.button")}</Button>
          {!canEdit && <p className="text-xs text-slate-500">{t("connect.adminOnly")}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">{t("connect.connected")}</Badge>
            <span>{t("connect.connectedBy", { user: status.createdBy ?? "", time: fmtTime(status.createdAt, loc) })}</span>
          </div>

          {status.adAccount ? (
            <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
              <div className="font-medium text-slate-800">{t("connect.meta.adAccountLine", { name: status.adAccount.name })} <span className="text-slate-400">(act_{status.adAccount.id})</span></div>
              <div className="text-xs text-slate-500">
                {!preview ? t("connect.readingStats") : preview.error ? <span className="text-red-600">{t("connect.statsError", { error: preview.error })}</span>
                  : t("connect.stats7d", { spent: fmtMoney(preview.spend ?? 0, status.adAccount.currency, loc), clicks: (preview.clicks ?? 0).toLocaleString(loc), impressions: (preview.impressions ?? 0).toLocaleString(loc) })}
              </div>
              {Object.entries(status.companies ?? {}).map(([co, p]) => (
                <div key={co} className="text-xs text-slate-600">
                  {label(co)}: {t("connect.meta.pixel")} {p.pixelName ?? <span className="text-slate-400">{t("connect.meta.notChosen")}</span>} · {t("connect.meta.page")} {p.pageName ?? <span className="text-slate-400">{t("connect.meta.notChosen")}</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-amber-700">{t("connect.meta.noAccount")}</p>
          )}

          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy !== null} onClick={openPicker}>{busy === "assets" ? t("connect.loadingList") : t("connect.meta.pick")}</Button>
              <Button variant="outline" disabled={busy !== null} onClick={start}>{t("connect.reconnect")}</Button>
              <Button variant="outline" disabled={busy !== null} className="text-red-600" onClick={disconnect}>{t("connect.disconnect")}</Button>
            </div>
          )}

          {assets && (
            <div className="space-y-3 rounded-xl border border-slate-200 p-3 text-sm">
              {assets.adAccounts.length === 0 ? (
                <p className="text-slate-600">{rich(t("connect.meta.noShared"))}</p>
              ) : (
                <>
                  <label className="block space-y-1">
                    <span className="font-medium text-slate-700">{t("connect.meta.adAccount")}</span>
                    <select className="w-full rounded-md border border-slate-200 px-2 py-1" value={acct} onChange={(e) => { setAcct(e.target.value); void loadPixels(e.target.value) }}>
                      <option value="">{t("connect.meta.select")}</option>
                      {assets.adAccounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name} (act_{a.id} · {a.currency}{a.status && STATUS_CODES.has(a.status) ? ` · ${t(`connect.meta.status.${a.status}` as MessageKey)}` : ""}){a.business ? ` — ${a.business}` : ""}</option>
                      ))}
                    </select>
                  </label>
                  {acct && (
                    <div className="space-y-2">
                      <p className="font-medium text-slate-700">{t("connect.meta.perCompany")}</p>
                      {pixels.length === 0 && <p className="text-xs text-amber-700">{t("connect.meta.noPixels")}</p>}
                      {companyIds().map((co) => (
                        <div key={co} className="grid gap-2 border-t border-slate-100 pt-2 sm:grid-cols-[8rem_1fr_1fr] sm:items-center">
                          <span className="font-medium text-slate-800">{label(co)}</span>
                          <select aria-label={t("connect.meta.pixelFor", { company: label(co) })} className="rounded-md border border-slate-200 px-2 py-1" value={picks[co]?.pixelId ?? ""} onChange={(e) => setPick(co, "pixelId", e.target.value)}>
                            <option value="">{t("connect.meta.noPixel")}</option>
                            {pixels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                          <select aria-label={t("connect.meta.pageFor", { company: label(co) })} className="rounded-md border border-slate-200 px-2 py-1" value={picks[co]?.pageId ?? ""} onChange={(e) => setPick(co, "pageId", e.target.value)}>
                            <option value="">{t("connect.meta.noPage")}</option>
                            {assets.pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              <div className="flex gap-2 pt-1">
                <Button disabled={busy !== null || !acct} onClick={save}>{busy === "save" ? t("common.saving") : t("connect.saveChoice")}</Button>
                <Button variant="ghost" onClick={() => setAssets(null)}>{t("common.close")}</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
