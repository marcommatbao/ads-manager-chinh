"use client";

// Auto-Apply settings.
//
// Replaces the previous orphan page at app/settings/automation, which sat
// outside the (dashboard) route group (so it rendered with no sidebar), was
// linked from no navigation, and toggled three rule ids that existed nowhere
// in the backend against two endpoints that were never implemented.
//
// The rules below are the real action names the Improvements engine emits
// and applyOne() executes, and every number shown comes from
// /api/automation/auto-apply — no placeholder values.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, Eye, ShieldCheck, AlertTriangle } from "lucide-react";
import { useAdsStore } from "@/store/useAdsStore";
import { cn } from "@/lib/utils";
import { companyIds } from "@/lib/companies/registry";
import { isCompany } from "@/lib/companies/registry";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

type Company = string;
type Mode = "dry_run" | "auto_apply";

interface SettingsResponse {
  enabledRules?: string[];
  mode?: Mode | null;
  effectiveMode?: Mode;
  envMode?: Mode;
  updatedAt?: string | null;
  updatedBy?: string | null;
  error?: string;
}

interface PreviewCandidate {
  id: string;
  type: string;
  title: string;
  action?: string;
  impactValue: number;
  ruleEnabled: boolean;
}

interface PreviewResponse {
  success?: boolean;
  pendingCount?: number;
  eligibleCount?: number;
  blockedCount?: number;
  totalSavings?: number;
  potentialSavings?: number;
  candidates?: PreviewCandidate[];
  error?: string;
}

// Descriptions state what the action does to the account — deliberately not
// a "safety score", which would be an opinion the backend does not compute.
const RULES: { id: string; label: MessageKey; desc: MessageKey; reversible: MessageKey }[] = [
  {
    id: "PAUSE_KEYWORD",
    label: "creative.settingsAutomation.rule.PAUSE_KEYWORD.label",
    desc: "creative.settingsAutomation.rule.PAUSE_KEYWORD.desc",
    reversible: "creative.settingsAutomation.rule.PAUSE_KEYWORD.rev",
  },
  {
    id: "ADD_NEGATIVE",
    label: "creative.settingsAutomation.rule.ADD_NEGATIVE.label",
    desc: "creative.settingsAutomation.rule.ADD_NEGATIVE.desc",
    reversible: "creative.settingsAutomation.rule.ADD_NEGATIVE.rev",
  },
  {
    id: "UPDATE_BUDGET",
    label: "creative.settingsAutomation.rule.UPDATE_BUDGET.label",
    desc: "creative.settingsAutomation.rule.UPDATE_BUDGET.desc",
    reversible: "creative.settingsAutomation.rule.UPDATE_BUDGET.rev",
  },
  {
    id: "UPDATE_TARGET_CPA",
    label: "creative.settingsAutomation.rule.UPDATE_TARGET_CPA.label",
    desc: "creative.settingsAutomation.rule.UPDATE_TARGET_CPA.desc",
    reversible: "creative.settingsAutomation.rule.UPDATE_TARGET_CPA.rev",
  },
  {
    id: "UPDATE_DEVICE_BID",
    label: "creative.settingsAutomation.rule.UPDATE_DEVICE_BID.label",
    desc: "creative.settingsAutomation.rule.UPDATE_DEVICE_BID.desc",
    reversible: "creative.settingsAutomation.rule.UPDATE_DEVICE_BID.rev",
  },
];

const vnd = (n: number, loc: string) => new Intl.NumberFormat(loc).format(Math.round(n));

export default function AutomationSettingsPage() {
  const t = useT();
  const loc = useIntlLocale();
  const storeCompany = useAdsStore((s) => s.selectedCompany);
  // The store allows "all"; this page configures one company at a time.
  // Đợt 21: bản cài khách không có MBC/MBI → công ty đang chọn / công ty đầu tiên (trước đây luôn rơi về "MBC" → 403).
  // Bản Mắt Bão: y như cũ (MBI → MBI, còn lại → MBC).
  const [company, setCompany] = useState<Company>(
    storeCompany === "MBI" ? "MBI"
      : companyIds().includes("MBC") ? "MBC"
      : (isCompany(storeCompany) ? storeCompany : companyIds()[0]) as Company,
  );

  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isCompany(storeCompany)) setCompany(storeCompany);
  }, [storeCompany]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [sRes, pRes] = await Promise.all([
        fetch(`/api/automation/settings?company=${company}`),
        fetch(`/api/automation/auto-apply?company=${company}`),
      ]);

      const sJson = (await sRes.json()) as SettingsResponse;
      if (!sRes.ok) throw new Error(sJson.error || t("creative.settingsAutomation.err.loadSettings", { status: sRes.status }));
      setSettings(sJson);

      const pJson = (await pRes.json()) as PreviewResponse;
      if (!pRes.ok) {
        // Show the real reason rather than a silent empty state.
        setPreview(null);
        setLoadError(pJson.error || t("creative.settingsAutomation.err.loadPending", { status: pRes.status }));
      } else {
        setPreview(pJson);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t("creative.settingsAutomation.err.connection"));
    }
  }, [company, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const enabledRules = settings?.enabledRules ?? [];

  async function toggleRule(ruleId: string, enable: boolean) {
    setSaving(true);
    setRunMsg(null);
    try {
      const updated = enable
        ? [...new Set([...enabledRules, ruleId])]
        : enabledRules.filter((r) => r !== ruleId);

      const res = await fetch("/api/automation/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, enabledRules: updated }),
      });
      const json = (await res.json()) as SettingsResponse;
      if (!res.ok) throw new Error(json.error || t("creative.settingsAutomation.err.saveHttp", { status: res.status }));
      await load();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t("creative.settingsAutomation.err.save"));
    } finally {
      setSaving(false);
    }
  }

  async function setMode(mode: Mode) {
    setSaving(true);
    setRunMsg(null);
    try {
      const res = await fetch("/api/automation/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, mode }),
      });
      const json = (await res.json()) as SettingsResponse;
      if (!res.ok) throw new Error(json.error || t("creative.settingsAutomation.err.saveHttp", { status: res.status }));
      await load();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t("creative.settingsAutomation.err.save"));
    } finally {
      setSaving(false);
    }
  }

  async function runNow(dryRun: boolean) {
    setRunning(true);
    setRunMsg(null);
    try {
      const res = await fetch("/api/automation/auto-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, dryRun }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);

      setRunMsg(
        dryRun
          ? t("creative.settingsAutomation.run.dry", { applied: json.applied, savings: vnd(json.savings ?? 0, loc) }) +
              (json.blocked ? t("creative.settingsAutomation.run.dryBlocked", { n: json.blocked }) : "")
          : t("creative.settingsAutomation.run.done", { applied: json.applied, savings: vnd(json.savings ?? 0, loc) }) +
              (json.failed ? t("creative.settingsAutomation.run.failed", { n: json.failed }) : ""),
      );
      await load();
    } catch (err) {
      setRunMsg(t("creative.settingsAutomation.run.error", { msg: err instanceof Error ? err.message : t("creative.settingsAutomation.run.unknown") }));
    } finally {
      setRunning(false);
    }
  }

  const effectiveMode = settings?.effectiveMode ?? "dry_run";
  const isAuto = effectiveMode === "auto_apply";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">{t("creative.settingsAutomation.title")}</h2>
          <p className="text-sm text-slate-500">
            {t("creative.settingsAutomation.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {companyIds().map((c) => (
            <button
              key={c}
              onClick={() => setCompany(c)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                company === c ? "bg-amber-500 text-amber-950" : "text-slate-500 hover:bg-slate-50",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {loadError && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Mode */}
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">{t("creative.settingsAutomation.mode.title", { company })}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {isAuto
                ? t("creative.settingsAutomation.mode.autoDesc")
                : t("creative.settingsAutomation.mode.dryDesc")}
              {settings?.mode == null && (
                <>{t("creative.settingsAutomation.mode.envDefaultPre")}<code>{settings?.envMode ?? "dry_run"}</code>{t("creative.settingsAutomation.mode.envDefaultPost")}</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 p-1">
            {(["dry_run", "auto_apply"] as Mode[]).map((m) => (
              <button
                key={m}
                disabled={saving}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                  effectiveMode === m
                    ? m === "auto_apply"
                      ? "bg-red-500 text-white"
                      : "bg-slate-700 text-white"
                    : "text-slate-500 hover:bg-slate-50",
                )}
              >
                {m === "dry_run" ? t("creative.settingsAutomation.mode.dry") : t("creative.settingsAutomation.mode.auto")}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Pending work — real counts from the same set the cron acts on */}
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        {preview === null ? (
          <p className="text-sm text-slate-400">{t("creative.settingsAutomation.pending.notLoaded")}</p>
        ) : (preview.pendingCount ?? 0) === 0 ? (
          <p className="text-sm text-slate-500">
            {t("creative.settingsAutomation.pending.none", { company })}
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-slate-800">
                {t("creative.settingsAutomation.pending.summary", { eligible: preview.eligibleCount ?? 0, pending: preview.pendingCount ?? 0 })}
              </p>
              <p className="text-xs text-slate-500">
                {t("creative.settingsAutomation.pending.spend", { spend: vnd(preview.totalSavings ?? 0, loc) })}
                {(preview.blockedCount ?? 0) > 0 && (
                  <>{t("creative.settingsAutomation.pending.blocked", { n: preview.blockedCount ?? 0 })}</>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => runNow(true)}
                disabled={running}
                className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Eye className="h-4 w-4" />{t("creative.settingsAutomation.btn.dry")}
              </button>
              <button
                onClick={() => runNow(false)}
                disabled={running || (preview.eligibleCount ?? 0) === 0}
                className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 hover:bg-amber-600 disabled:opacity-50"
              >
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {t("creative.settingsAutomation.btn.run")}
              </button>
            </div>
          </div>
        )}
        {runMsg && <p className="mt-3 text-sm text-slate-600">{runMsg}</p>}
      </div>

      {/* Rules */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">{t("creative.settingsAutomation.rules.title")}</h3>
        {RULES.map((rule) => {
          const on = enabledRules.includes(rule.id);
          const waiting = preview?.candidates?.filter((c) => c.action === rule.id).length ?? 0;
          return (
            <div key={rule.id} className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-medium text-slate-800">{t(rule.label)}</h4>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      <ShieldCheck className="mr-0.5 inline h-3 w-3" />
                      {t(rule.reversible)}
                    </span>
                    {waiting > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        {t("creative.settingsAutomation.rules.waiting", { n: waiting })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">{t(rule.desc)}</p>
                  <p className="mt-1 font-mono text-[10px] text-slate-400">{rule.id}</p>
                </div>
                <button
                  onClick={() => toggleRule(rule.id, !on)}
                  disabled={saving}
                  aria-label={t("creative.settingsAutomation.rules.aria", { state: on ? t("creative.settingsAutomation.rules.off") : t("creative.settingsAutomation.rules.on"), label: t(rule.label) })}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50",
                    on ? "bg-amber-500" : "bg-slate-200",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
                      on ? "translate-x-5" : "translate-x-0",
                    )}
                  />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm">
        <p className="mb-2 font-medium text-slate-700">{t("creative.settingsAutomation.sched.title")}</p>
        <div className="space-y-1 text-xs text-slate-500">
          <p>{t("creative.settingsAutomation.sched.l1")}</p>
          <p>{t("creative.settingsAutomation.sched.l2")}</p>
          <p>{t("creative.settingsAutomation.sched.l3")}</p>
        </div>
        {settings?.updatedAt && (
          <p className="mt-3 text-[11px] text-slate-400">
            {t("creative.settingsAutomation.sched.updated", { time: new Date(settings.updatedAt).toLocaleString(loc) })}
            {settings.updatedBy ? ` · ${settings.updatedBy}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
