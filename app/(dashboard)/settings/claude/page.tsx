"use client"
// Cài đặt → Kết nối Claude (MCP) — task #7142. Tạo / thu hồi khoá MCP, hướng dẫn nối Claude Code / Desktop,
// Super Admin chỉnh công tắc ghi + hạn mức. Khoá thô chỉ hiện một lần sau khi tạo.
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useIntlLocale, useT } from "@/lib/i18n/client"

interface KeyRow { id: string; name: string; mode: "read" | "write"; createdAt: string; lastUsedAt?: string; revokedAt?: string; userEmail: string; mine: boolean; writesToday: number }
interface Settings { writesEnabled: boolean; maxWritesPerDay: number; newCampaignMaxDailyBudget: number }
interface Data { keys: KeyRow[]; settings: Settings; isSuperAdmin: boolean; canWrite: boolean; endpoint: string }

export default function ClaudeSettingsPage() {
  const t = useT()
  const loc = useIntlLocale()
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [mode, setMode] = useState<"read" | "write">("read")
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch("/api/mcp-keys", { cache: "no-store" })
    const d = await r.json().catch(() => null)
    if (!r.ok || !d?.success) { setErr(d?.error ?? t("settings.claude.loadFail")); return }
    setData(d); setSettings(d.settings)
  }, [t])
  useEffect(() => { void load() }, [load])

  const endpoint = data?.endpoint || (typeof window !== "undefined" ? `${location.origin}/api/mcp` : "/api/mcp")
  const codeCmd = secret ? `claude mcp add --transport http adscommand ${endpoint} --header "Authorization: Bearer ${secret}"` : ""
  const desktopCfg = secret ? JSON.stringify({ mcpServers: { adscommand: { command: "npx", args: ["-y", "mcp-remote", endpoint, "--header", `Authorization: Bearer ${secret}`] } } }, null, 2) : ""
  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString(loc) : t("settings.claude.never"))

  async function create() {
    setBusy(true); setErr(null); setSecret(null)
    try {
      const r = await fetch("/api/mcp-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mode }) })
      const d = await r.json()
      if (!r.ok || !d.success) throw new Error(d.error ?? `HTTP ${r.status}`)
      setSecret(d.secret); setName(""); await load()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function revoke(k: KeyRow) {
    if (!confirm(t("settings.claude.revokeConfirm", { name: k.name }))) return
    const r = await fetch(`/api/mcp-keys?id=${encodeURIComponent(k.id)}`, { method: "DELETE" })
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
    await load()
  }

  async function saveSettings() {
    if (!settings) return
    setMsg(null)
    const r = await fetch("/api/mcp-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || !d.success) { setErr(d.error ?? `HTTP ${r.status}`); return }
    setSettings(d.settings); setMsg(t("settings.claude.saved"))
  }

  const copy = async (text: string, id: string) => { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 1500) }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">{t("settings.claude.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("settings.claude.intro")}</p>
      </div>

      {err && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}

      <section className="space-y-3 rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium text-slate-800">{t("settings.claude.create")}</h3>
        <div className="flex flex-wrap items-end gap-3">
          <Input className="max-w-xs" placeholder={t("settings.claude.name")} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <label className="text-sm text-slate-600">
            <span className="mr-2">{t("settings.claude.mode")}</span>
            <select className="rounded-md border border-slate-200 px-2 py-1.5" value={mode} onChange={(e) => setMode(e.target.value as "read" | "write")}>
              <option value="read">{t("settings.claude.modeRead")}</option>
              <option value="write" disabled={!data?.canWrite}>{t("settings.claude.modeWrite")}</option>
            </select>
          </label>
          <Button disabled={busy || !data} onClick={create}>{busy ? t("settings.claude.creating") : t("settings.claude.create")}</Button>
        </div>
        {data && !data.canWrite && <p className="text-xs text-slate-500">{t("settings.claude.writeNotAllowed")}</p>}

        {secret && (
          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="font-semibold text-amber-800">{t("settings.claude.secretTitle")}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto whitespace-nowrap rounded bg-white px-2 py-1 text-xs">{secret}</code>
              <Button variant="outline" onClick={() => copy(secret, "secret")}>{copied === "secret" ? t("settings.claude.copied") : t("settings.claude.copy")}</Button>
            </div>
            <p className="text-slate-700">{t("settings.claude.howCode")}</p>
            <div className="flex items-start gap-2">
              <pre className="flex-1 overflow-x-auto rounded bg-slate-900 p-2 text-xs text-slate-100">{codeCmd}</pre>
              <Button variant="outline" onClick={() => copy(codeCmd, "code")}>{copied === "code" ? t("settings.claude.copied") : t("settings.claude.copy")}</Button>
            </div>
            <p className="text-slate-700">{t("settings.claude.howDesktop")}</p>
            <div className="flex items-start gap-2">
              <pre className="flex-1 overflow-x-auto rounded bg-slate-900 p-2 text-xs text-slate-100">{desktopCfg}</pre>
              <Button variant="outline" onClick={() => copy(desktopCfg, "desktop")}>{copied === "desktop" ? t("settings.claude.copied") : t("settings.claude.copy")}</Button>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium text-slate-800">{t("settings.claude.keys")}</h3>
        {!data ? null : data.keys.length === 0 ? (
          <p className="text-sm text-slate-500">{t("settings.claude.none")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1 pr-3">{t("settings.claude.colName")}</th>
                  <th className="py-1 pr-3">{t("settings.claude.colMode")}</th>
                  {data.isSuperAdmin && <th className="py-1 pr-3">{t("settings.claude.colUser")}</th>}
                  <th className="py-1 pr-3">{t("settings.claude.colCreated")}</th>
                  <th className="py-1 pr-3">{t("settings.claude.colLastUsed")}</th>
                  <th className="py-1 pr-3">{t("settings.claude.colWrites")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.keys.map((k) => (
                  <tr key={k.id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3 font-medium text-slate-800">{k.name}</td>
                    <td className="py-1.5 pr-3"><Badge variant="outline">{k.mode === "write" ? t("settings.claude.modeWrite") : t("settings.claude.modeRead")}</Badge></td>
                    {data.isSuperAdmin && <td className="py-1.5 pr-3 text-slate-600">{k.userEmail}</td>}
                    <td className="py-1.5 pr-3 text-slate-600">{fmt(k.createdAt)}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{fmt(k.lastUsedAt)}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{k.writesToday}</td>
                    <td className="py-1.5 text-right">
                      {k.revokedAt ? <span className="text-xs text-slate-400">{t("settings.claude.revoked")}</span>
                        : <Button variant="outline" className="text-red-600" onClick={() => revoke(k)}>{t("settings.claude.revoke")}</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data?.isSuperAdmin && settings && (
        <section className="space-y-3 rounded-xl border border-slate-200 p-4 text-sm">
          <h3 className="font-medium text-slate-800">{t("settings.claude.adminTitle")}</h3>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.writesEnabled} onChange={(e) => setSettings({ ...settings, writesEnabled: e.target.checked })} />
            {t("settings.claude.writesEnabled")}
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <span className="w-80">{t("settings.claude.maxWrites")}</span>
            <Input type="number" className="w-28" min={0} max={200} value={settings.maxWritesPerDay} onChange={(e) => setSettings({ ...settings, maxWritesPerDay: Number(e.target.value) })} />
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <span className="w-80">{t("settings.claude.maxNewBudget")}</span>
            <Input type="number" className="w-40" min={1} value={settings.newCampaignMaxDailyBudget} onChange={(e) => setSettings({ ...settings, newCampaignMaxDailyBudget: Number(e.target.value) })} />
          </label>
          <p className="text-xs text-slate-500">{t("settings.claude.limitsNote")}</p>
          <div className="flex items-center gap-3">
            <Button onClick={saveSettings}>{t("common.save")}</Button>
            {msg && <span className="text-xs text-green-700">{msg}</span>}
          </div>
        </section>
      )}
    </div>
  )
}
