"use client";

// ============================================================
// ExtraConnections — "Kết nối bổ sung" (GTM + Trang Facebook)
// ============================================================
// Nhập trực tiếp trong Cài đặt thay vì biến môi trường máy chủ (user chốt
// 28/09) — xem app/api/settings/connections-extra/route.ts. Component tự gọi
// API riêng, không phụ thuộc state của SettingsContent.

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Loader2, CheckCircle2, AlertCircle, RefreshCw, Trash2, Plus,
  ExternalLink, Eye, EyeOff, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

// ── Types (khớp app/api/settings/connections-extra/route.ts) ──

interface GtmContainer { publicId: string; name: string; account: string }
interface GtmTestResult { ok: boolean; email?: string; containers?: GtmContainer[]; error?: string }
interface GtmStatus { connected: boolean; source: "env" | "settings" | "none"; email: string | null; savedAt: string | null; savedBy: string | null }
interface PageRow { pageId: string; name: string | null; source: "env" | "settings" | "system_user"; addedAt: string | null; addedBy: string | null; removable: boolean }
interface StatusResponse { ok: true; gtm: GtmStatus; pages: PageRow[]; guide: { gtm: string; pages: string } }
interface AddedPage { pageId: string; name: string | null; neverExpires: boolean }
interface SkippedPage { pageId: string; name: string | null; reason: string }
interface PagesAddResult { ok: boolean; kind?: "user" | "page"; added?: AddedPage[]; skipped?: SkippedPage[]; warning?: string; error?: string }
interface PagesTestResult { pageId: string; name: string | null; ok: boolean; error?: string }

const SOURCE_LABEL: Record<PageRow["source"], MessageKey> = {
  system_user: "settings.extra.source.system_user",
  settings: "settings.extra.source.settings",
  env: "settings.extra.source.env",
};

function fmtDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

// ── GTM card ─────────────────────────────────────────────

function GtmCard({ status, guideHref, canEdit, onChanged }: {
  status: GtmStatus; guideHref: string; canEdit: boolean; onChanged: (s: StatusResponse) => void;
}) {
  const t = useT();
  const locale = useIntlLocale();
  const [json, setJson] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [result, setResult] = useState<GtmTestResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);

  const test = async () => {
    setTesting(true); setResultError(null); setResult(null);
    try {
      const res = await fetch("/api/settings/connections-extra", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "gtm_test", ...(json.trim() ? { json: json.trim() } : {}) }),
      });
      const data = await res.json() as { ok: boolean; test?: GtmTestResult; error?: string };
      if (data.ok && data.test) setResult(data.test);
      else setResultError(data.error ?? t("settings.extra.gtm.testFailed"));
    } catch { setResultError(t("settings.err.network")); }
    setTesting(false);
  };

  const save = async () => {
    if (!json.trim()) return;
    setSaving(true); setResultError(null); setResult(null);
    try {
      const res = await fetch("/api/settings/connections-extra", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "gtm_save", json: json.trim() }),
      });
      const data = await res.json() as StatusResponse & { ok: boolean; test?: GtmTestResult; message?: string; error?: string };
      if (data.ok) {
        setResult(data.test ?? null);
        setJson(""); // không hiện lại khoá đã lưu
        onChanged(data);
      } else {
        setResultError(data.error ?? t("settings.extra.gtm.saveFailed"));
        if (data.test) setResult(data.test);
      }
    } catch { setResultError(t("settings.err.network")); }
    setSaving(false);
  };

  const remove = async () => {
    if (!window.confirm(t("settings.extra.gtm.removeConfirm"))) return;
    setRemoving(true);
    try {
      const res = await fetch("/api/settings/connections-extra", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "gtm_remove" }),
      });
      const data = await res.json() as StatusResponse;
      if (data.ok) { setResult(null); onChanged(data); }
    } catch { /* ignore */ }
    setRemoving(false);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-3 w-3 rounded-full bg-purple-500" />
        <h3 className="text-base font-semibold text-slate-800">Google Tag Manager</h3>
        <Link href={guideHref} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
          {t("settings.extra.guide")} <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>

      {status.connected ? (
        <div className="text-sm text-emerald-700">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t(status.source === "env" ? "settings.extra.gtm.connectedEnv" : "settings.extra.gtm.connectedSettings", { email: status.email ?? "" })}</span>
          </div>
          {status.source === "settings" && status.savedAt && (
            <p className="text-xs text-slate-400 mt-0.5 ml-6">{status.savedBy ? t("settings.extra.gtm.savedAtBy", { time: fmtDate(status.savedAt, locale), user: status.savedBy }) : t("settings.extra.gtm.savedAt", { time: fmtDate(status.savedAt, locale) })}</p>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t("settings.extra.gtm.notConnected")}</span>
        </div>
      )}

      {status.source === "env" && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          {t("settings.extra.gtm.envNote")}
        </p>
      )}

      {canEdit && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-600">{t("settings.extra.gtm.jsonLabel")}</label>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder='{"type": "service_account", ...}'
            rows={4}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-400 resize-y"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={test} disabled={testing || saving} className="gap-1.5 border-slate-200">
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t("settings.extra.check")}
            </Button>
            <Button size="sm" onClick={save} disabled={saving || testing || !json.trim()} className="gap-1.5 bg-purple-600 text-white hover:bg-purple-700">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t("settings.extra.checkAndSave")}
            </Button>
            {status.source === "settings" && (
              <Button variant="outline" size="sm" onClick={remove} disabled={removing} className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50 ml-auto">
                {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {t("settings.extra.gtm.disconnect")}
              </Button>
            )}
          </div>
        </div>
      )}

      {resultError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          {resultError}
        </div>
      )}
      {result && !resultError && (
        result.ok && result.containers ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 space-y-1">
            <p className="text-xs font-semibold text-emerald-800">{t("settings.extra.gtm.containersFound", { n: result.containers.length })}</p>
            {result.containers.map((c) => (
              <p key={c.publicId} className="text-xs text-emerald-700 font-mono">{c.publicId} — {c.name}</p>
            ))}
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            {result.error ?? t("settings.extra.gtm.keyUnusable")}
          </div>
        )
      )}
    </div>
  );
}

// ── Trang Facebook card ──────────────────────────────────

function PagesCard({ pages, guideHref, canEdit, onChanged }: {
  pages: PageRow[]; guideHref: string; canEdit: boolean; onChanged: (s: StatusResponse) => void;
}) {
  const t = useT();
  const locale = useIntlLocale();
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<PagesAddResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<PagesTestResult[] | null>(null);
  const [removing, setRemoving] = useState<Record<string, boolean>>({});

  const add = async () => {
    if (!token.trim()) return;
    setAdding(true); setAddResult(null);
    try {
      const res = await fetch("/api/settings/connections-extra", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pages_add", token: token.trim() }),
      });
      const data = await res.json() as StatusResponse & PagesAddResult;
      setAddResult(data);
      setToken("");
      if (data.pages) onChanged(data);
    } catch { setAddResult({ ok: false, error: t("settings.err.network") }); }
    setAdding(false);
  };

  const removePage = async (pageId: string, name: string | null) => {
    if (!window.confirm(t("settings.extra.pages.removeConfirm", { name: name ?? pageId }))) return;
    setRemoving((r) => ({ ...r, [pageId]: true }));
    try {
      const res = await fetch("/api/settings/connections-extra", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "page_remove", pageId }),
      });
      const data = await res.json() as StatusResponse;
      if (data.ok) onChanged(data);
    } catch { /* ignore */ }
    setRemoving((r) => ({ ...r, [pageId]: false }));
  };

  const testAll = async () => {
    setTesting(true); setTestResults(null);
    try {
      const res = await fetch("/api/settings/connections-extra", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pages_test" }),
      });
      const data = await res.json() as { ok: boolean; results?: PagesTestResult[] };
      if (data.ok && data.results) setTestResults(data.results);
    } catch { /* ignore */ }
    setTesting(false);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-3 w-3 rounded-full bg-blue-500" />
        <h3 className="text-base font-semibold text-slate-800">{t("settings.extra.pages.title")}</h3>
        <Link href={guideHref} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
          {t("settings.extra.guide")} <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>

      <p className="text-xs text-slate-500 leading-relaxed">
        {t("settings.extra.pages.intro")}
      </p>

      {pages.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-100">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-500">
                <th className="px-3 py-2 font-medium">{t("settings.extra.pages.col0")}</th>
                <th className="px-3 py-2 font-medium">{t("settings.extra.pages.col1")}</th>
                <th className="px-3 py-2 font-medium">{t("settings.extra.pages.col2")}</th>
                <th className="px-3 py-2 font-medium">{t("settings.extra.pages.col3")}</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => {
                const tr = testResults?.find((r) => r.pageId === p.pageId);
                return (
                  <tr key={p.pageId} className="border-b border-slate-50 last:border-0" title={p.addedAt ? (p.addedBy ? t("settings.extra.pages.addedAtBy", { time: fmtDate(p.addedAt, locale), user: p.addedBy }) : t("settings.extra.pages.addedAt", { time: fmtDate(p.addedAt, locale) })) : undefined}>
                    <td className="px-3 py-2 font-medium text-slate-800">{p.name ?? t("settings.extra.pages.unnamed")}</td>
                    <td className="px-3 py-2 font-mono text-slate-500">{p.pageId}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        {t(SOURCE_LABEL[p.source])}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {tr ? (
                        tr.ok
                          ? <span className="text-emerald-600 font-medium">✓ {t("settings.extra.pages.readable")}</span>
                          : <span className="text-red-600 font-medium" title={tr.error}>✕ {tr.error ?? t("settings.extra.pages.errorShort")}</span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canEdit && p.removable && (
                        <Button variant="outline" size="sm" onClick={() => removePage(p.pageId, p.name)} disabled={removing[p.pageId]}
                          className="h-6 px-2 text-[11px] border-red-200 text-red-600 hover:bg-red-50">
                          {removing[p.pageId] ? <Loader2 className="h-3 w-3 animate-spin" /> : t("settings.extra.pages.remove")}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-slate-400 italic">{t("settings.extra.pages.empty")}</p>
      )}

      <Button variant="outline" size="sm" onClick={testAll} disabled={testing || pages.length === 0} className="gap-1.5 border-slate-200">
        {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {t("settings.extra.pages.checkAll")}
      </Button>

      {canEdit && (
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <label className="text-xs font-medium text-slate-600">{t("settings.extra.pages.addLabel")}</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                placeholder={t("settings.extra.pages.tokenPlaceholder")}
                className="pr-9"
              />
              <button type="button" onClick={() => setShowToken((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button size="sm" onClick={add} disabled={adding || !token.trim()} className="gap-1.5 bg-blue-600 text-white hover:bg-blue-700 shrink-0">
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {t("settings.extra.pages.add")}
            </Button>
          </div>

          {addResult && (
            <div className="space-y-1.5">
              {addResult.error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                  {addResult.error}
                </div>
              )}
              {addResult.added && addResult.added.length > 0 && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 space-y-1">
                  {addResult.added.map((a) => (
                    <p key={a.pageId} className="text-xs text-emerald-700 flex items-center gap-1.5">
                      <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                      {a.name ?? a.pageId}
                      <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", a.neverExpires ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                        {a.neverExpires ? t("settings.extra.pages.neverExpires") : t("settings.extra.pages.willExpire")}
                      </span>
                    </p>
                  ))}
                </div>
              )}
              {addResult.skipped && addResult.skipped.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-1">
                  {addResult.skipped.map((s) => (
                    <p key={s.pageId} className="text-xs text-slate-500">{s.name ?? s.pageId}: {s.reason}</p>
                  ))}
                </div>
              )}
              {addResult.warning && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                  {addResult.warning}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────

export function ExtraConnections({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/connections-extra");
      if (res.status === 403) { setForbidden(true); return; }
      if (res.ok) setStatus(await res.json() as StatusResponse);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {t("settings.extra.forbidden")}
      </div>
    );
  }

  if (!status) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-800">{t("settings.extra.title")}</h2>
        <p className="text-xs text-slate-500 mt-0.5">{t("settings.extra.description")}</p>
      </div>
      <GtmCard status={status.gtm} guideHref={status.guide.gtm} canEdit={canEdit} onChanged={setStatus} />
      <PagesCard pages={status.pages} guideHref={status.guide.pages} canEdit={canEdit} onChanged={setStatus} />
    </div>
  );
}
