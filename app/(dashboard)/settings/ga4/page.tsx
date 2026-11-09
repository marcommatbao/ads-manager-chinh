"use client";

// Settings → GA4.
//
// The GA4 API (/api/ga4) and client (lib/ga4-client.ts) shipped long ago,
// but nothing in the app ever called connect_property — confirmed in that
// route's own header comment — so GA4 was permanently unconnected and the
// integration was dead weight. This page is the missing half: it drives a
// real OAuth grant, lists the properties that grant can actually read, and
// maps each to MBC/MBI.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Link2, RefreshCw, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { orderedCompanyIds, companyLabel } from "@/lib/companies/registry";
import { useIntlLocale, useT } from "@/lib/i18n/client";

// Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ)
const coText = (id: string) => (id === "MBC" || id === "MBI" ? id : companyLabel(id));

type Company = string /* mã công ty hoặc "ALL" */;

interface OAuthState {
  connected: boolean;
  connectedAt?: string;
  connectedBy?: string;
}

interface Connection {
  id: string;
  propertyId: string;
  propertyName: string;
  measurementId: string;
  status: string;
  mappedCompany: Company | null;
  hasRefreshToken: boolean;
}

interface PropertyOption {
  propertyId: string;
  displayName: string;
  accountName: string;
}

export default function GA4SettingsPage() {
  const t = useT();
  const loc = useIntlLocale();
  const [oauth, setOauth] = useState<OAuthState>({ connected: false });
  const [connections, setConnections] = useState<Connection[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [selectedCompany, setSelectedCompany] = useState<Company>("ALL");

  const [loading, setLoading] = useState(true);
  const [propsLoading, setPropsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Surface the redirect result from /api/google/callback (state=ga4).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("ga4_connected")) setNotice(t("creative.settingsGa4.notice.connected"));
    const e = q.get("ga4_error");
    if (e) setError(e);
    if (q.get("ga4_connected") || e) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [t]);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ga4");
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setOauth(json.data.oauth ?? { connected: false });
      setConnections(json.data.connections ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("creative.settingsGa4.err.status"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadProperties = useCallback(async () => {
    setPropsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ga4/properties");
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setProperties(json.properties ?? []);
    } catch (err) {
      setProperties([]);
      setError(err instanceof Error ? err.message : t("creative.settingsGa4.err.properties"));
    } finally {
      setPropsLoading(false);
    }
  }, [t]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { if (oauth.connected) void loadProperties(); }, [oauth.connected, loadProperties]);

  async function post(action: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/ga4", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error ?? `HTTP ${res.status}`);
      await loadStatus();
      return json;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("creative.settingsGa4.err.action"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function connectProperty() {
    if (!selectedProperty) return;
    const chosen = properties.find((p) => p.propertyId === selectedProperty);
    const ok = await post("connect_property", {
      propertyId: selectedProperty,
      propertyName: chosen?.displayName ?? selectedProperty,
      mappedCompany: selectedCompany,
    });
    if (ok) {
      setSelectedProperty("");
      setNotice(t("creative.settingsGa4.notice.added"));
    }
  }

  async function fetchData() {
    const json = await post("fetch");
    if (json) setNotice(t("creative.settingsGa4.notice.fetched", { count: json.data?.count ?? 0 }));
  }

  const alreadyConnected = new Set(connections.map((c) => c.propertyId));
  const available = properties.filter((p) => !alreadyConnected.has(p.propertyId));

  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-slate-800">{t("creative.settingsGa4.title")}</h2>
        <p className="text-sm text-slate-500">
          {t("creative.settingsGa4.subtitle")}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* ── OAuth grant ── */}
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              {oauth.connected ? t("creative.settingsGa4.oauth.granted") : t("creative.settingsGa4.oauth.notGranted")}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {oauth.connected ? (
                <>
                  {t("creative.settingsGa4.oauth.by", { user: oauth.connectedBy ?? "" })}
                  {oauth.connectedAt && <> · {new Date(oauth.connectedAt).toLocaleString(loc)}</>}
                </>
              ) : (
                <>{t("creative.settingsGa4.oauth.shared")}</>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href="/api/ga4/auth"
              className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 hover:bg-amber-600"
            >
              <Link2 className="h-4 w-4" />
              {oauth.connected ? t("creative.settingsGa4.oauth.reconnect") : t("creative.settingsGa4.oauth.connect")}
            </a>
            {oauth.connected && (
              <button
                onClick={() => post("disconnect_oauth")}
                disabled={busy}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {t("creative.settingsGa4.oauth.disconnect")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Add a property ── */}
      {oauth.connected && (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">{t("creative.settingsGa4.add.title")}</p>
            <button
              onClick={loadProperties}
              disabled={propsLoading}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", propsLoading && "animate-spin")} />
              {t("creative.settingsGa4.add.reload")}
            </button>
          </div>

          {propsLoading ? (
            <p className="text-sm text-slate-400">{t("creative.settingsGa4.add.loading")}</p>
          ) : available.length === 0 ? (
            <p className="text-sm text-slate-500">
              {properties.length === 0
                ? t("creative.settingsGa4.add.none")
                : t("creative.settingsGa4.add.allConnected")}
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex-1 min-w-[240px] text-xs text-slate-500">
                {t("creative.settingsGa4.add.property")}
                <select
                  value={selectedProperty}
                  onChange={(e) => setSelectedProperty(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
                >
                  <option value="">{t("creative.settingsGa4.add.choose")}</option>
                  {available.map((p) => (
                    <option key={p.propertyId} value={p.propertyId}>
                      {p.displayName}{p.accountName ? ` (${p.accountName})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500">
                {t("creative.settingsGa4.add.assign")}
                <select
                  value={selectedCompany}
                  onChange={(e) => setSelectedCompany(e.target.value as Company)}
                  className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
                >
                  <option value="ALL">{t("creative.settingsGa4.add.both")}</option>
                  {orderedCompanyIds(["MBC", "MBI"]).map((c) => (
                    <option key={c} value={c}>{coText(c)}</option>
                  ))}
                </select>
              </label>
              <button
                onClick={connectProperty}
                disabled={busy || !selectedProperty}
                className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
              >
                {t("creative.settingsGa4.add.btn")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Connected properties ── */}
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800">{t("creative.settingsGa4.conn.title")}</p>
          {connections.length > 0 && (
            <button
              onClick={fetchData}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
              {t("creative.settingsGa4.conn.fetch")}
            </button>
          )}
        </div>

        {connections.length === 0 ? (
          <p className="text-sm text-slate-500">{t("creative.settingsGa4.conn.empty")}</p>
        ) : (
          <div className="space-y-2">
            {connections.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{c.propertyName}</p>
                  <p className="font-mono text-[11px] text-slate-400">{c.propertyId}</p>
                  {!c.hasRefreshToken && (
                    <p className="mt-0.5 text-[11px] text-amber-600">
                      {t("creative.settingsGa4.conn.missingOauth")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={c.mappedCompany ?? "ALL"}
                    onChange={(e) => post("update_mapping", { id: c.id, mappedCompany: e.target.value })}
                    disabled={busy}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700"
                  >
                    <option value="ALL">{t("creative.settingsGa4.add.both")}</option>
                    {orderedCompanyIds(["MBC", "MBI"]).map((c) => (
                      <option key={c} value={c}>{coText(c)}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => post("disconnect_property", { id: c.id })}
                    disabled={busy}
                    aria-label={t("creative.settingsGa4.conn.removeAria", { name: c.propertyName })}
                    className="text-slate-300 transition-colors hover:text-red-500 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
