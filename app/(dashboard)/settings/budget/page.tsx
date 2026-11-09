"use client";

import { useState, useEffect, useCallback } from "react";
import { useSettingsPermission } from "@/hooks/useSettingsPermission";
import { ReadOnlyBanner } from "@/components/settings/PermissionGate";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Save, CheckCircle2, AlertCircle, Info, History, RotateCcw, Link2 } from "lucide-react";
import NextLink from "next/link";
import { cn } from "@/lib/utils";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface CompanyBudget {
  daily_budget: number;
  monthly_cap: number;
  auto_redistribute: boolean;
  redistribution_threshold: number;
}

type BudgetConfig = Record<string, CompanyBudget>;

// ─────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────

const DEFAULT_CONFIG: BudgetConfig = {
  MBC: {
    daily_budget: 5000000,
    monthly_cap: 100000000,
    auto_redistribute: true,
    redistribution_threshold: 80,
  },
  MBI: {
    daily_budget: 3000000,
    monthly_cap: 60000000,
    auto_redistribute: true,
    redistribution_threshold: 75,
  },
};

// ─────────────────────────────────────────────
// Toggle Switch
// ─────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-3">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="relative h-6 w-11 rounded-full bg-slate-200 transition-colors duration-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:duration-200 peer-checked:bg-amber-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:ring-2 peer-focus:ring-amber-300" />
      <span className="text-sm font-medium text-slate-700">{label}</span>
    </label>
  );
}

// ─────────────────────────────────────────────
// Derived (read-only) currency field — value comes from KPI settings or a
// computation, not typed in here directly.
// ─────────────────────────────────────────────

function fmtVndFull(v: number, loc: string): string {
  return new Intl.NumberFormat(loc, { style: "currency", currency: "VND" }).format(v);
}

function DerivedCurrencyField({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note: React.ReactNode;
}) {
  const loc = useIntlLocale();
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
        {fmtVndFull(value, loc)}
      </div>
      <p className="text-xs text-slate-400">{note}</p>
    </div>
  );
}

// ─────────────────────────────────────────────
// Company Budget Section
// ─────────────────────────────────────────────

// Google/Facebook split — fixed ratio per request, not user-configurable.
const GOOGLE_SHARE = 0.82;
const FACEBOOK_SHARE = 0.18;

function CompanyBudgetCard({
  company,
  color,
  data,
  monthLabel,
  daysInMonth,
  kpiMonthlyBudget,
  kpiLoading,
  onChange,
}: {
  company: string;
  color: string;
  data: CompanyBudget;
  monthLabel: string;
  daysInMonth: number;
  kpiMonthlyBudget: number | null;
  kpiLoading: boolean;
  onChange: (patch: Partial<CompanyBudget>) => void;
}) {
  const t = useT();
  const loc = useIntlLocale();
  return (
    <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <span className={`flex h-3 w-3 rounded-full ${color}`} />
          <CardTitle className="text-lg font-semibold text-slate-800">
            {t("creative.settingsBudget.card.title", { company })}
          </CardTitle>
        </div>
        <CardDescription className="text-sm text-slate-500 mt-1">
          {t("creative.settingsBudget.card.desc", { company })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {kpiLoading ? (
          <div className="h-16 rounded-lg bg-slate-100 animate-pulse" />
        ) : kpiMonthlyBudget === null || kpiMonthlyBudget <= 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            {t("creative.settingsBudget.notSet", { company, month: monthLabel })}{" "}
            <NextLink href="/settings/kpi" className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
              {t("creative.settingsBudget.goSet")} <Link2 className="h-3 w-3" />
            </NextLink>
          </div>
        ) : (
          <>
            <DerivedCurrencyField
              label={t("creative.settingsBudget.cap.label")}
              value={data.monthly_cap}
              note={
                <>
                  {t("creative.settingsBudget.cap.note", { company, month: monthLabel })}{" "}
                  <NextLink href="/settings/kpi" className="underline underline-offset-2">{t("creative.settingsBudget.cap.edit")}</NextLink>
                </>
              }
            />
            <DerivedCurrencyField
              label={t("creative.settingsBudget.daily.label")}
              value={data.daily_budget}
              note={t("creative.settingsBudget.daily.note", { cap: fmtVndFull(data.monthly_cap, loc), days: daysInMonth, month: monthLabel })}
            />
            <div className="grid grid-cols-2 gap-3">
              <DerivedCurrencyField
                label={t("creative.settingsBudget.google")}
                value={data.daily_budget * GOOGLE_SHARE}
                note={t("creative.settingsBudget.share", { pct: Math.round(GOOGLE_SHARE * 100) })}
              />
              <DerivedCurrencyField
                label={t("creative.settingsBudget.facebook")}
                value={data.daily_budget * FACEBOOK_SHARE}
                note={t("creative.settingsBudget.share", { pct: Math.round(FACEBOOK_SHARE * 100) })}
              />
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">
            {t("creative.settingsBudget.thr.label")}
          </label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={100}
              value={data.redistribution_threshold}
              onChange={(e) =>
                onChange({ redistribution_threshold: Number(e.target.value) })
              }
              className="rounded-lg border-slate-200 w-32"
            />
            <span className="text-sm font-semibold text-slate-500">%</span>
          </div>
          <p className="text-xs text-slate-400">
            {t("creative.settingsBudget.thr.note", { pct: data.redistribution_threshold })}
          </p>
        </div>

        <Toggle
          checked={data.auto_redistribute}
          onChange={(v) => onChange({ auto_redistribute: v })}
          label={t("creative.settingsBudget.auto")}
        />
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────
// Audit types (minimal, matches server shape)
// ─────────────────────────────────────────────

interface AuditEntry {
  id: string;
  timestamp: string;
  actor_email: string;
  actor_role: string;
  company: string;
  field: string;
  old_value: unknown;
  new_value: unknown;
}

interface AuditSnapshot {
  id: string;
  timestamp: string;
  actor_email: string;
}

// ─────────────────────────────────────────────
// Audit changelog + rollback panel
// ─────────────────────────────────────────────

function fmtVal(v: unknown, loc: string, t: TFunction): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number")
    return new Intl.NumberFormat(loc).format(v);
  if (typeof v === "boolean") return v ? t("creative.settingsBudget.on") : t("creative.settingsBudget.off");
  return String(v);
}

function fmtTs(ts: string, loc: string): string {
  try {
    return new Intl.DateTimeFormat(loc, {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(ts));
  } catch { return ts; }
}

function AuditPanel({
  onRollback,
}: {
  onRollback: () => void;
}) {
  const t = useT();
  const loc = useIntlLocale();
  const [entries,   setEntries]   = useState<AuditEntry[]>([]);
  const [snapshots, setSnapshots] = useState<AuditSnapshot[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [open,      setOpen]      = useState(false);
  const [rolling,   setRolling]   = useState<string | null>(null);
  const [msg,       setMsg]       = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/audit?domain=budget&limit=30");
      if (!res.ok) return;
      const data = await res.json() as { entries: AuditEntry[]; snapshots: AuditSnapshot[] };
      setEntries(data.entries ?? []);
      setSnapshots(data.snapshots ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const handleOpen = () => {
    if (!open) load();
    setOpen(v => !v);
  };

  const handleRollback = async (snapshotId: string) => {
    if (!confirm(t("creative.settingsBudget.rb.confirm"))) return;
    setRolling(snapshotId);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: "budget", snapshot_id: snapshotId }),
      });
      const data = await res.json() as { success?: boolean; error?: string; restored_from?: string };
      if (data.success) {
        setMsg({ ok: true, text: t("creative.settingsBudget.rb.done", { ts: fmtTs(data.restored_from ?? "", loc) }) });
        onRollback();
        await load();
      } else {
        setMsg({ ok: false, text: data.error ?? t("creative.settingsBudget.rb.fail") });
      }
    } catch {
      setMsg({ ok: false, text: t("creative.settingsBudget.rb.net") });
    } finally {
      setRolling(null);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={handleOpen}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <History className="h-4 w-4 text-slate-400" />
          {t("creative.settingsBudget.hist.title")}
          {entries.length > 0 && (
            <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
              {entries.length}
            </span>
          )}
        </div>
        <span className="text-xs text-slate-400">{open ? t("creative.settingsBudget.hist.collapse") : t("creative.settingsBudget.hist.view")}</span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-5 pb-5 pt-3 space-y-4">
          {loading && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          )}

          {msg && (
            <div className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
              msg.ok
                ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                : "bg-red-50 border border-red-200 text-red-700",
            )}>
              {msg.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
              {msg.text}
            </div>
          )}

          {/* Rollback snapshots */}
          {snapshots.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {t("creative.settingsBudget.snap.title")}
              </p>
              <div className="space-y-1.5">
                {snapshots.slice(0, 5).map(snap => (
                  <div key={snap.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
                    <div>
                      <p className="text-xs font-medium text-slate-700">{fmtTs(snap.timestamp, loc)}</p>
                      <p className="text-[11px] text-slate-400">{t("creative.settingsBudget.snap.by", { email: snap.actor_email })}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRollback(snap.id)}
                      disabled={rolling === snap.id}
                      className="h-7 gap-1 border-slate-200 text-xs text-slate-600 hover:border-amber-300 hover:text-amber-700"
                    >
                      {rolling === snap.id
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <RotateCcw className="h-3 w-3" />}
                      {t("creative.settingsBudget.snap.restore")}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Audit entries */}
          {entries.length === 0 && !loading && (
            <p className="text-center text-sm text-slate-400 py-4">{t("creative.settingsBudget.hist.empty")}</p>
          )}
          {entries.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {t("creative.settingsBudget.hist.detail")}
              </p>
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                {entries.map(entry => (
                  <div key={entry.id} className="flex items-start gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-medium text-slate-700">{entry.field}</span>
                        <span className="text-xs text-slate-400">
                          {fmtVal(entry.old_value, loc, t)} → {fmtVal(entry.new_value, loc, t)}
                        </span>
                        <span className={cn(
                          "text-[10px] rounded px-1.5 py-0.5 font-semibold",
                          entry.company === "MBC" ? "bg-blue-50 text-blue-600"
                            : entry.company === "MBI" ? "bg-violet-50 text-violet-600"
                            : "bg-slate-100 text-slate-500",
                        )}>
                          {entry.company}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                        <span>{fmtTs(entry.timestamp, loc)}</span>
                        <span>·</span>
                        <span>{entry.actor_email}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

type SaveStatus = "idle" | "saving" | "success" | "error";

const MONTH_NAMES_VN = [
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12",
];

export default function BudgetSettingsPage() {
  const t = useT();
  const perms = useSettingsPermission();
  const [config, setConfig] = useState<BudgetConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [kpiBudget, setKpiBudget] = useState<Record<string, number> | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);

  const now = new Date();
  const monthIndex = now.getMonth(); // 0-11
  const year = now.getFullYear();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const monthLabel = `${MONTH_NAMES_VN[monthIndex]}/${year}`;

  const loadConfig = useCallback(() => {
    fetch("/api/settings/budget")
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then((data: BudgetConfig) => {
        if (data?.MBC && data?.MBI) setConfig(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // Giới hạn ngân sách tháng luôn lấy từ Ngân sách QC (KPI) tháng hiện tại —
  // không cho nhập tay ở đây nữa (1 nguồn sự thật duy nhất là Settings → KPI).
  useEffect(() => {
    setKpiLoading(true);
    fetch(`/api/settings/kpi?year=${year}`)
      .then((r) => r.json())
      .then((data: { success?: boolean; months?: { adSpendMbc?: number; adSpendMbi?: number }[]; effectiveMonths?: { adSpendMbc?: number; adSpendMbi?: number }[] }) => {
        // 12/10: trần tháng = ngân sách cố định + khoản chi bổ sung (đối tác hỗ trợ / sản phẩm mới).
        const src = data.effectiveMonths ?? data.months;
        const m = data.success && Array.isArray(src) ? src[monthIndex] : null;
        setKpiBudget({ MBC: m?.adSpendMbc ?? 0, MBI: m?.adSpendMbi ?? 0 });
      })
      .catch(() => setKpiBudget(null))
      .finally(() => setKpiLoading(false));
  }, [year, monthIndex]);

  // monthly_cap/daily_budget không còn là input tay — luôn tính từ KPI +
  // số ngày trong tháng tại thời điểm hiển thị/lưu, không đồng bộ qua state
  // (tránh vòng lặp effect→setState không cần thiết).
  const deriveCompanyBudget = (company: string): CompanyBudget => {
    const monthlyCap = kpiBudget?.[company] ?? 0;
    return {
      ...config[company],
      monthly_cap: monthlyCap,
      daily_budget: monthlyCap > 0 ? Math.round(monthlyCap / daysInMonth) : 0,
    };
  };

  const patchCompany = (company: string, patch: Partial<CompanyBudget>) => {
    setConfig((prev) => ({
      ...prev,
      [company]: { ...prev[company], ...patch },
    }));
  };

  const handleSave = async () => {
    setSaveStatus("saving");
    try {
      const payload: BudgetConfig = { MBC: deriveCompanyBudget("MBC"), MBI: deriveCompanyBudget("MBI") };
      const res = await fetch("/api/settings/budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { success?: boolean; errors?: { field: string; message: string }[] };
      if (!res.ok || !data.success) {
        const msg = data.errors?.map(e => e.message).join("; ") ?? "Lưu thất bại";
        throw new Error(msg);
      }
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (e) {
      console.error(e);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 4000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Read-only banner for viewers */}
      {!perms.isLoading && !perms.canEditBudget && (
        <ReadOnlyBanner message={t("creative.settingsBudget.ro")} />
      )}

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
        <Info className="mt-0.5 h-5 w-5 text-blue-500 shrink-0" />
        <div>
          <p className="text-sm font-medium text-blue-800">{t("creative.settingsBudget.auto.title")}</p>
          <p className="mt-0.5 text-xs text-blue-600">
            {t("creative.settingsBudget.auto.desc")}
          </p>
        </div>
      </div>

      {/* MBC — only shown to users with MBC access */}
      {(perms.isLoading || perms.canSeeMBC) && (
        <CompanyBudgetCard
          company="MBC"
          color="bg-blue-500"
          data={deriveCompanyBudget("MBC")}
          monthLabel={monthLabel}
          daysInMonth={daysInMonth}
          kpiMonthlyBudget={kpiBudget?.MBC ?? null}
          kpiLoading={kpiLoading}
          onChange={(patch) => patchCompany("MBC", patch)}
        />
      )}

      {/* MBI — only shown to users with MBI access */}
      {(perms.isLoading || perms.canSeeMBI) && (
        <CompanyBudgetCard
          company="MBI"
          color="bg-indigo-500"
          data={deriveCompanyBudget("MBI")}
          monthLabel={monthLabel}
          daysInMonth={daysInMonth}
          kpiMonthlyBudget={kpiBudget?.MBI ?? null}
          kpiLoading={kpiLoading}
          onChange={(patch) => patchCompany("MBI", patch)}
        />
      )}

      {/* Save status feedback */}
      {saveStatus === "success" && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <p className="text-sm text-emerald-700">{t("creative.settingsBudget.saved")}</p>
        </div>
      )}
      {saveStatus === "error" && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
          <p className="text-sm text-red-700">{t("creative.settingsBudget.saveFail")}</p>
        </div>
      )}

      {/* Save button */}
      <div className="flex justify-end pt-2">
        <Button
          onClick={handleSave}
          disabled={saveStatus === "saving" || !perms.canEditBudget}
          title={!perms.canEditBudget ? t("creative.settingsBudget.noPerm") : undefined}
          className="gap-2 rounded-lg bg-amber-500 text-amber-950 hover:bg-amber-600 disabled:opacity-40"
        >
          {saveStatus === "saving" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("creative.settingsBudget.saving")}
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {t("creative.settingsBudget.saveBtn")}
            </>
          )}
        </Button>
      </div>

      {/* Audit + Rollback panel */}
      <AuditPanel onRollback={loadConfig} />
    </div>
  );
}
