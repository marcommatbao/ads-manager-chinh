"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Zap, Plus, Trash2, Play, ChevronDown, ChevronUp,
  Clock, Activity, RefreshCw, Check, Settings, X,
  ArrowRight, Bell, AlertTriangle, ShieldCheck, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAdsStore } from "@/store/useAdsStore";
import GoogleAutomationTab from "@/components/GoogleAutomationTab";
import {
  METRIC_LABELS, OPERATOR_LABELS, ACTION_LABELS,
  INTERVAL_LABELS, TIME_WINDOW_LABELS,
  PREBUILT_RULES, GOOGLE_CHANNEL_TYPE_OPTIONS, GOOGLE_CHANNEL_TYPE_LABEL,
  type AutomationRule, type Condition, type Action,
  type MetricKey, type ConditionOperator, type TimeWindow,
  type CheckInterval, type ActionType, type RuleExecutionResult,
} from "@/lib/automation-shared";
import type { SimulationResult, SimulationItem, SimulationStatus } from "@/lib/automation-sim/types";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/messages";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function fmtTime(iso: string, loc: string): string {
  return new Date(iso).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
}

function fmtRelative(iso: string, t: TFunction): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("creative.automation.rel.now");
  if (mins < 60) return t("creative.automation.rel.minutes", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("creative.automation.rel.hours", { n: hours });
  const days = Math.floor(hours / 24);
  if (days === 1) return t("creative.automation.rel.yesterday");
  return t("creative.automation.rel.days", { n: days });
}

function fmtDate(iso: string, loc: string): string {
  return new Date(iso).toLocaleDateString(loc, { day: "2-digit", month: "2-digit", year: "numeric" });
}

const RULE_ICONS: Record<string, string> = {
  "Tắt campaign lỗ": "🛑",
  "Scale campaign tốt": "📈",
  "Cảnh báo bão hoà audience": "😴",
  "CPC tăng đột biến": "📊",
  "Dừng campaign sắp hết ngân sách tháng": "⚡",
  "Kích hoạt lại campaign tốt buổi sáng": "🌅",
  "Phát hiện Creative Mệt": "😓",
  "🔄 Test & Kill — Auto-kill campaign kém sau 3 ngày": "🔄",
  "🔥 Auto Kill — CPC Kill Threshold": "🔥",
  "😓 Frequency Kill — Audience Bão Hoà": "😓",
};

const TEMPLATE_ICONS = ["🛑", "📈", "😴", "📊", "⚡", "🌅", "😓", "🔄", "🔥", "😓"];

// Labels for condition operators
function fmtOperator(op: ConditionOperator, t: TFunction): string {
  if (op === "increased_by_pct") return t("creative.automation.op.increasedBy");
  if (op === "decreased_by_pct") return t("creative.automation.op.decreasedBy");
  return ({ ">": ">", "<": "<", ">=": "≥", "<=": "≤", "==": "=" } as Record<string, string>)[op];
}

// Đơn vị hiển thị phải theo TOÁN TỬ trước, rồi mới tới chỉ số. Với
// increased_by_pct/decreased_by_pct thì `value` là PHẦN TRĂM, không phải giá trị
// của chỉ số — bản cũ chỉ nhìn chỉ số nên rule mẫu "cpc increased_by_pct 40"
// (CPC tăng hơn 40%) hiện ra là "CPC tăng > ₫40", trông như ngưỡng 40 đồng.
// Nguy ở chỗ: người đọc thấy ₫40 vô lý sẽ sửa thành ₫40.000, thành ra đặt ngưỡng
// "tăng 40.000%" — một rule không bao giờ chạy mà nhìn vẫn như đang canh.
function fmtMetricValue(metric: MetricKey, value: number, operator: ConditionOperator | undefined, loc: string): string {
  if (operator === "increased_by_pct" || operator === "decreased_by_pct") {
    return `${value}%`;
  }
  switch (metric) {
    case "roas": return `${value}x`;
    case "ctr":
    case "budget_used_pct": return `${value}%`;
    case "spend": return `₫${value.toLocaleString(loc)}`;
    case "cpc":
    case "cpm": return `₫${value.toLocaleString(loc)}`;
    case "frequency": return `${value}x`;
    default: return value.toLocaleString(loc);
  }
}

// ─────────────────────────────────────────────
// Onboarding Banner
// ─────────────────────────────────────────────

function OnboardingBanner({ onQuickEnable, onDismiss }: {
  onQuickEnable: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-indigo-800 flex items-center gap-2">
          <Zap className="h-5 w-5 text-indigo-500" />
          {t("creative.automation.onb.title")}
        </h3>
        <button onClick={onDismiss} className="text-xs text-slate-400 hover:text-slate-600 font-medium">
          {t("creative.automation.onb.dismiss")}
        </button>
      </div>

      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-xl border border-indigo-100 bg-white p-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-600 shrink-0">1</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-700">{t("creative.automation.onb.s1Title")}</p>
            <p className="text-xs text-slate-400 mt-0.5">{t("creative.automation.onb.s1Desc")}</p>
          </div>
          <Button size="sm" className="gap-1 text-xs bg-indigo-600 text-white hover:bg-indigo-700 shrink-0" onClick={onQuickEnable}>
            <Play className="h-3 w-3" /> {t("creative.automation.onb.enableNow")}
          </Button>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-slate-100 bg-white/60 p-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-500 shrink-0">2</span>
          <div>
            <p className="text-sm font-semibold text-slate-600">{t("creative.automation.onb.s2Title")}</p>
            <p className="text-xs text-slate-400 mt-0.5">{t("creative.automation.onb.s2Desc")}</p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-slate-100 bg-white/60 p-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-500 shrink-0">3</span>
          <div>
            <p className="text-sm font-semibold text-slate-600">{t("creative.automation.onb.s3Title")}</p>
            <p className="text-xs text-slate-400 mt-0.5">{t("creative.automation.onb.s3Desc")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Test Result Modal
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// Simulation Result Modal (4-bucket outcome)
// ─────────────────────────────────────────────

const STATUS_CFG: Record<SimulationStatus, { labelKey: MessageKey; cls: string; badge: string; icon: React.ReactNode }> = {
  safe_for_auto_apply:    { labelKey: "creative.automation.status.safe",      cls: "border-emerald-200 bg-emerald-50",  badge: "bg-emerald-100 text-emerald-700", icon: <ShieldCheck className="h-3 w-3" /> },
  manual_review_required: { labelKey: "creative.automation.status.review", cls: "border-amber-200 bg-amber-50",     badge: "bg-amber-100 text-amber-700",    icon: <AlertTriangle className="h-3 w-3" /> },
  blocked:                { labelKey: "creative.automation.status.blocked",             cls: "border-red-200 bg-red-50",         badge: "bg-red-100 text-red-700",        icon: <X className="h-3 w-3" /> },
  simulate_only:          { labelKey: "creative.automation.status.viewOnly",             cls: "border-slate-200 bg-slate-50",     badge: "bg-slate-100 text-slate-600",    icon: <Info className="h-3 w-3" /> },
};

const BAND_CLS: Record<string, string> = { high: "text-red-600", medium: "text-amber-600", low: "text-emerald-600" };

function SimItemRow({ item }: { item: SimulationItem }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const cfg = STATUS_CFG[item.simulationStatus];
  return (
    <div className={cn("rounded-xl border p-3 space-y-1.5", cfg.cls)}>
      <div className="flex items-start gap-2 justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-800 truncate">{item.entityName}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{item.impactSummary}</p>
        </div>
        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap flex-shrink-0", cfg.badge)}>
          {cfg.icon} {t(cfg.labelKey)}
        </span>
      </div>

      {/* Risk band + scores */}
      <div className="flex items-center gap-3 text-[10px] text-slate-400">
        <span>{t("creative.automation.sim.risk")} <b className={BAND_CLS[item.risk.band]}>{item.risk.band.toUpperCase()}</b></span>
        <span>{t("creative.automation.sim.score", { v: item.riskScore })}</span>
        <span>{t("creative.automation.sim.safety", { v: item.safetyScore })}</span>
        <span>{t("creative.automation.sim.conf", { v: item.confidenceScore })}</span>
      </div>

      {/* Blockers */}
      {item.blockedBy.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.blockedBy.map(r => (
            <span key={r} className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-red-100 text-red-700">{r}</span>
          ))}
        </div>
      )}

      {/* Warnings */}
      {item.warnings.length > 0 && (
        <div className="space-y-0.5">
          {item.warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-amber-600">⚠️ {w}</p>
          ))}
        </div>
      )}

      {/* Condition trace collapsible */}
      {item.matchedConditions.length > 0 && (
        <button onClick={() => setOpen(p => !p)} className="text-[10px] text-indigo-500 hover:underline flex items-center gap-1">
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {t("creative.automation.sim.conditions", { n: item.matchedConditions.length })}
        </button>
      )}
      {open && (
        <div className="pl-3 space-y-0.5 border-l border-indigo-100">
          {item.matchedConditions.map((c, i) => (
            <p key={i} className={cn("text-[10px]", c.passed ? "text-emerald-600" : "text-slate-400")}>
              {c.passed ? "✓" : "✗"} {c.metric} {c.operator} {c.threshold} {t("creative.automation.sim.actual", { actual: c.actual })}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function SimResultModal({ result, rule, onClose, onEnable }: {
  result: SimulationResult;
  rule: AutomationRule;
  onClose: () => void;
  onEnable: () => void;
}) {
  const t = useT();
  const loc = useIntlLocale();
  const icon = RULE_ICONS[result.ruleName] ?? "⚙️";
  const counts = result.counts.byStatus;

  const BUCKETS: { status: SimulationStatus; label: string }[] = [
    { status: "safe_for_auto_apply",    label: t("creative.automation.bucket.safe") },
    { status: "manual_review_required", label: t("creative.automation.bucket.review") },
    { status: "blocked",                label: t("creative.automation.bucket.blocked") },
    { status: "simulate_only",          label: t("creative.automation.bucket.viewOnly") },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-sm font-bold text-slate-800">{t("creative.automation.sim.title", { icon, name: result.ruleName })}</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {t("creative.automation.sim.policy")} <b>{result.policy}</b> {t("creative.automation.sim.evalSummary", { evaluated: result.counts.evaluated, matched: result.counts.matched })}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 4-bucket summary */}
        <div className="px-5 py-3 grid grid-cols-4 gap-2 border-b border-slate-100 flex-shrink-0">
          {BUCKETS.map(({ status, label }) => {
            const cfg = STATUS_CFG[status];
            const n = counts[status];
            return (
              <div key={status} className={cn("rounded-lg border p-2 text-center", n > 0 ? cfg.cls : "border-slate-100 bg-slate-50/50")}>
                <p className={cn("text-lg font-bold", n > 0 ? "" : "text-slate-300")}>{n}</p>
                <p className="text-[9px] text-slate-500 leading-tight mt-0.5">{label}</p>
              </div>
            );
          })}
        </div>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {result.items.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-slate-400">{t("creative.automation.sim.empty")}</p>
              <p className="text-xs text-slate-300 mt-1">{t("creative.automation.sim.emptyDesc")}</p>
            </div>
          ) : (
            result.items.map(item => <SimItemRow key={item.entityId} item={item} />)
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between flex-shrink-0">
          <p className="text-[10px] text-slate-400">
            {t("creative.automation.sim.estSaving", { amount: Math.round(result.estTotalImpactVnd).toLocaleString(loc) })}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} className="text-xs">{t("creative.automation.close")}</Button>
            {!rule.isActive && counts.safe_for_auto_apply + counts.manual_review_required > 0 && (
              <Button size="sm" className="gap-1 text-xs bg-emerald-600 text-white hover:bg-emerald-700" onClick={onEnable}>
                <Check className="h-3 w-3" /> {t("creative.automation.sim.enableRule")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

export default function AutomationPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [executionLog, setExecutionLog] = useState<RuleExecutionResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [showCreator, setShowCreator] = useState(false);
  const [showFullLog, setShowFullLog] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("automation_onboarded") !== "true";
    return true;
  });
  const [testLoading, setTestLoading] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simRule, setSimRule] = useState<AutomationRule | null>(null);
  const [automationTab, setAutomationTab] = useState<"facebook" | "google">("facebook");
  const { campaigns } = useAdsStore();
  const t = useT();
  const loc = useIntlLocale();

  // ── Fetch ──
  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch("/api/automation/rules");
      const json = await res.json();
      if (json.success) {
        setRules(json.data.rules);
        setExecutionLog(json.data.executionLog);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  // ── Toggle ──
  const handleToggle = async (id: string) => {
    const res = await fetch("/api/automation/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", id }),
    });
    const json = await res.json();
    if (json.success) setRules(prev => prev.map(r => r.id === id ? json.data : r));
  };

  // ── Delete ──
  const handleDelete = async (id: string) => {
    const res = await fetch("/api/automation/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    const json = await res.json();
    if (json.success) setRules(prev => prev.filter(r => r.id !== id));
  };

  // ── Run Engine ──
  const handleRun = async () => {
    setIsRunning(true);
    try {
      const res = await fetch("/api/automation/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      });
      const json = await res.json();
      if (json.success) {
        setExecutionLog(prev => [...prev, ...json.data]);
        await fetchRules();
      }
    } finally {
      setIsRunning(false);
    }
  };

  // ── Quick Enable (onboarding) ──
  const handleQuickEnable = () => {
    // Find the "Cảnh báo bão hoà audience" rule and toggle it on
    const saturationRule = rules.find(r => r.name.includes("bão hoà"));
    if (saturationRule && !saturationRule.isActive) {
      handleToggle(saturationRule.id);
    }
    setShowOnboarding(false);
    localStorage.setItem("automation_onboarded", "true");
  };

  const handleDismissOnboarding = () => {
    setShowOnboarding(false);
    localStorage.setItem("automation_onboarded", "true");
  };

  // ── Test Rule → call /api/automation/simulate ──
  const handleTestRule = useCallback(async (rule: AutomationRule) => {
    setTestLoading(rule.id);
    setSimResult(null);
    setSimRule(rule);
    try {
      const res = await fetch("/api/automation/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId: rule.id }),
      });
      const json = (await res.json()) as { success?: boolean; data?: SimulationResult; error?: string };
      if (json.success && json.data) {
        setSimResult(json.data);
      } else {
        console.error("[AutoTest]", json.error ?? "Unknown error");
      }
    } catch (err) {
      console.error("[AutoTest] fetch error:", err);
    } finally {
      setTestLoading(null);
    }
  }, []);

  // ── Stats ──
  const activeCount = rules.filter(r => r.isActive).length;
  const totalTriggers = rules.reduce((sum, r) => sum + r.triggerCount, 0);
  // Phải so CẢ NĂM. Thiếu getFullYear() thì một bản ghi cùng ngày/tháng của
  // năm trước cũng được đếm là "hôm nay" — số bị thổi phồng âm thầm khi
  // executionLog tích luỹ qua nhiều năm.
  const todayActions = executionLog.filter(l => {
    const d = new Date(l.triggeredAt);
    const now = new Date();
    return d.getDate() === now.getDate()
      && d.getMonth() === now.getMonth()
      && d.getFullYear() === now.getFullYear();
  }).length;
  const lastRun = executionLog.length > 0
    ? fmtTime(executionLog[executionLog.length - 1].triggeredAt, loc)
    : "—";

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <div className="relative mx-auto w-16 h-16">
            <div className="absolute inset-0 rounded-full border-4 border-indigo-100" />
            <div className="absolute inset-0 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin" />
          </div>
          <p className="text-sm text-slate-500">{t("creative.automation.page.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* HEADER                                  */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
            <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 p-2.5 shadow-lg shadow-indigo-200">
              <Zap className="h-5 w-5 text-white" />
            </div>
            {t("creative.automation.page.title")}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {t("creative.automation.page.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs border-indigo-200 text-indigo-600 hover:bg-indigo-50"
            onClick={handleRun}
            disabled={isRunning || activeCount === 0}
          >
            {isRunning ? (
              <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> {t("creative.automation.page.running")}</>
            ) : (
              <><Play className="h-3.5 w-3.5" /> {t("creative.automation.page.runNow")}</>
            )}
          </Button>
          <Button
            size="sm"
            className="gap-1.5 text-xs bg-amber-500 text-amber-950 hover:bg-amber-600 shadow-sm shadow-amber-200"
            onClick={() => setShowCreator(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("creative.automation.createRule")}
          </Button>
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* PLATFORM TAB BAR                         */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
        <button
          onClick={() => setAutomationTab("facebook")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all",
            automationTab === "facebook"
              ? "bg-white text-blue-700 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          )}
        >
          📘 Facebook
        </button>
        <button
          onClick={() => setAutomationTab("google")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all",
            automationTab === "google"
              ? "bg-white text-red-700 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          )}
        >
          🔴 Google
        </button>
      </div>

      {/* ── Google Tab Content ── */}
      {automationTab === "google" && <GoogleAutomationTab />}

      {/* ── Facebook Tab Content ── */}
      {automationTab === "facebook" && (<>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* HEADER STATS BAR                        */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="h-4 w-4 text-indigo-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">{t("creative.automation.stat.activeRules")}</span>
          </div>
          <p className="text-2xl font-bold text-indigo-700">{activeCount}</p>
          <p className="text-[10px] text-indigo-400 mt-0.5">{t("creative.automation.stat.activeOf", { n: rules.length })}</p>
        </div>

        <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <RefreshCw className="h-4 w-4 text-blue-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">{t("creative.automation.stat.lastRun")}</span>
          </div>
          <p className="text-2xl font-bold text-blue-700">{lastRun}</p>
          <p className="text-[10px] text-blue-400 mt-0.5">{t("creative.automation.stat.autoEngine")}</p>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Check className="h-4 w-4 text-emerald-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">{t("creative.automation.stat.actionsToday")}</span>
          </div>
          <p className="text-2xl font-bold text-emerald-700">{todayActions}</p>
          <p className="text-[10px] text-emerald-400 mt-0.5">{t("creative.automation.stat.executed")}</p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="h-4 w-4 text-amber-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">{t("creative.automation.stat.interval")}</span>
          </div>
          <p className="text-2xl font-bold text-amber-700">6</p>
          <p className="text-[10px] text-amber-400 mt-0.5">{t("creative.automation.stat.intervalNote")}</p>
        </div>
      </div>

      {/* ── Onboarding Banner ── */}
      {showOnboarding && activeCount === 0 && (
        <OnboardingBanner
          onQuickEnable={handleQuickEnable}
          onDismiss={handleDismissOnboarding}
        />
      )}

      {/* ── Simulation Result Modal ── */}
      {simResult && simRule && (
        <SimResultModal
          result={simResult}
          rule={simRule}
          onClose={() => { setSimResult(null); setSimRule(null); }}
          onEnable={() => {
            handleToggle(simRule.id);
            setSimResult(null);
            setSimRule(null);
          }}
        />
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* RULE CREATOR MODAL                      */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {showCreator && (
        <RuleCreatorModal
          onClose={() => setShowCreator(false)}
          onCreated={(rule) => {
            setRules(prev => [...prev, rule]);
            setShowCreator(false);
          }}
        />
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* QUY TẮC TỰ ĐỘNG                        */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-800">{t("creative.automation.list.title")}</h2>
          <span className="text-[10px] text-slate-400">{t("creative.automation.list.count", { n: rules.length })}</span>
        </div>

        <div className="space-y-3">
          {rules.map(rule => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onToggle={() => handleToggle(rule.id)}
              onDelete={() => handleDelete(rule.id)}
              onTest={() => { void handleTestRule(rule); }}
              testLoading={testLoading === rule.id}
            />
          ))}
        </div>

        {rules.length === 0 && (
          <div className="text-center py-16 rounded-xl border border-dashed border-slate-200">
            <Zap className="h-10 w-10 text-slate-200 mx-auto mb-3" />
            <p className="text-sm text-slate-400">{t("creative.automation.list.empty")}</p>
            <p className="text-xs text-slate-300 mt-1">{t("creative.automation.list.emptyHint")}</p>
          </div>
        )}
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* LỊCH SỬ THỰC THI                       */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {executionLog.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <Activity className="h-4 w-4 text-slate-400" />
              {t("creative.automation.log.title")}
            </h2>
            {executionLog.length > 5 && (
              <button
                onClick={() => setShowFullLog(!showFullLog)}
                className="text-xs text-indigo-500 hover:text-indigo-700 font-medium flex items-center gap-1"
              >
                {showFullLog ? t("creative.automation.log.collapse") : t("creative.automation.log.expand")} <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="divide-y divide-slate-50">
              {[...executionLog]
                .reverse()
                .slice(0, showFullLog ? 50 : 5)
                .map((log, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/50 transition-colors">
                  {/* Time */}
                  <span className="text-xs font-mono text-slate-400 w-12 shrink-0">
                    {fmtTime(log.triggeredAt, loc)}
                  </span>

                  {/* Action icon */}
                  <span className="text-base shrink-0">
                    {ACTION_LABELS[log.action]?.icon ?? "⚡"}
                  </span>

                  {/* Description */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-700 truncate">
                      <b>{log.ruleName}</b>
                      <span className="text-slate-400"> → </span>
                      <span className="text-slate-500">{log.campaignName}</span>
                    </p>
                  </div>

                  {/* Metrics */}
                  <div className="hidden sm:flex items-center gap-2 text-[10px] text-slate-400">
                    {/* roas === null = chưa đo được doanh thu (campaign lead-gen
                        không có giá trị purchase). Nói thẳng thay vì ẩn đi —
                        ẩn thì người đọc tưởng ROAS bằng 0. */}
                    {log.metricsSnapshot.roas === null ? (
                      <span className="text-slate-400">ROAS: <b>{t("creative.automation.log.notMeasured")}</b></span>
                    ) : log.metricsSnapshot.roas > 0 ? (
                      <span>ROAS: <b className="text-slate-600">{log.metricsSnapshot.roas.toFixed(1)}x</b></span>
                    ) : null}
                    {log.metricsSnapshot.frequency > 0 && (
                      <span>{t("creative.automation.log.freq")} <b className="text-slate-600">{log.metricsSnapshot.frequency.toFixed(1)}x</b></span>
                    )}
                    {log.metricsSnapshot.spend > 0 && (
                      <span>{t("creative.automation.log.spend")} <b className="text-slate-600">₫{Math.round(log.metricsSnapshot.spend).toLocaleString(loc)}</b></span>
                    )}
                  </div>

                  {/* Relative time */}
                  <span className="text-[10px] text-slate-300 shrink-0">
                    {fmtRelative(log.triggeredAt, t)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      </>)}
    </div>
  );
}

// ─────────────────────────────────────────────
// Rule Card
// ─────────────────────────────────────────────

function RuleCard({ rule, onToggle, onDelete, onTest, testLoading }: {
  rule: AutomationRule;
  onToggle: () => void;
  onDelete: () => void;
  onTest: () => void;
  testLoading?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const icon = RULE_ICONS[rule.name] ?? "⚙️";
  const t = useT();
  const loc = useIntlLocale();

  return (
    <div className={cn(
      "rounded-xl border-2 bg-white transition-all shadow-sm",
      rule.isActive
        ? "border-indigo-200 shadow-indigo-50"
        : "border-slate-200 opacity-75"
    )}>
      {/* ── Main row ── */}
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          {/* Left: status + content */}
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {/* Status dot */}
            <button
              onClick={onToggle}
              className="mt-1 shrink-0"
              title={rule.isActive ? t("creative.automation.card.statusOn") : t("creative.automation.card.statusOff")}
            >
              <div className={cn(
                "h-3 w-3 rounded-full border-2 transition-colors",
                rule.isActive
                  ? "bg-emerald-400 border-emerald-500 shadow-sm shadow-emerald-200"
                  : "bg-slate-200 border-slate-300"
              )} />
            </button>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                {icon} {rule.name}
              </h3>

              {/* IF conditions */}
              <div className="mt-2.5 space-y-1">
                {rule.conditions.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs">
                    {i === 0 ? (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-600 w-8 text-center shrink-0">{t("creative.automation.card.if")}</span>
                    ) : (
                      <span className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-bold w-8 text-center shrink-0",
                        rule.conditionLogic === "AND"
                          ? "bg-blue-50 text-blue-500"
                          : "bg-amber-50 text-amber-500"
                      )}>
                        {rule.conditionLogic === "AND" ? t("creative.automation.card.and") : t("creative.automation.card.or")}
                      </span>
                    )}
                    <span className="text-slate-700">
                      <b>{METRIC_LABELS[c.metric]}</b>{" "}
                      {fmtOperator(c.operator, t)}{" "}
                      <b className="text-indigo-600">{fmtMetricValue(c.metric, c.value, c.operator, loc)}</b>
                    </span>
                    <span className="text-slate-300">({TIME_WINDOW_LABELS[c.timeWindow]})</span>
                  </div>
                ))}
              </div>

              {/* THEN actions */}
              <div className="mt-2 space-y-1">
                {rule.actions.map((a, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs">
                    {i === 0 ? (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 w-8 text-center shrink-0">{t("creative.automation.card.then")}</span>
                    ) : (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 w-8 text-center shrink-0">+</span>
                    )}
                    <span className="text-slate-600">
                      {ACTION_LABELS[a.type]?.icon} {ACTION_LABELS[a.type]?.label}
                      {a.value !== undefined && <b className="text-indigo-600 ml-1">{a.value}%</b>}
                    </span>
                  </div>
                ))}
              </div>

              {/* Loại chiến dịch Google — chỉ hiện khi rule có áp Google và đã giới hạn loại (rỗng = mọi loại, không cần nhắc) */}
              {rule.platform !== "facebook" && !!rule.googleChannelTypes?.length && (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <span className="text-[10px] text-slate-400">{t("creative.automation.card.googleTypes")}</span>
                  {rule.googleChannelTypes.map(ct => (
                    <span key={ct} className="rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                      {GOOGLE_CHANNEL_TYPE_LABEL[ct] ?? ct}
                    </span>
                  ))}
                </div>
              )}

              {/* Footer meta */}
              <div className="flex items-center gap-3 mt-3 text-[10px] text-slate-400">
                <span className="flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" /> {t("creative.automation.card.checkEvery", { interval: INTERVAL_LABELS[rule.checkInterval] })}
                </span>
                {rule.triggerCount > 0 && (
                  <span className="text-amber-500 font-semibold">
                    {t("creative.automation.card.triggered", { n: rule.triggerCount })}
                  </span>
                )}
                {rule.lastTriggered && (
                  <span>{t("creative.automation.card.lastRun", { time: fmtRelative(rule.lastTriggered, t) })}</span>
                )}
              </div>
            </div>
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Toggle switch */}
            <button
              onClick={onToggle}
              className={cn(
                "relative w-10 h-[22px] rounded-full transition-colors shrink-0",
                rule.isActive ? "bg-indigo-500" : "bg-slate-300"
              )}
              title={t(rule.isActive ? "creative.automation.card.turnOff" : "creative.automation.card.turnOn")}
            >
              <div className={cn(
                "absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
                rule.isActive ? "left-[22px]" : "left-[3px]"
              )} />
            </button>

            <button
              onClick={onTest}
              disabled={testLoading}
              className={cn(
                "p-1.5 rounded-lg text-slate-400",
                testLoading ? "opacity-50 cursor-wait" : "hover:bg-indigo-50 hover:text-indigo-600"
              )}
              title={t("creative.automation.card.simulate")}
            >
              {testLoading
                ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                : <Play className="h-3.5 w-3.5" />}
            </button>

            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-lg hover:bg-slate-50 text-slate-400"
              title={t("creative.automation.card.details")}
            >
              <Settings className="h-3.5 w-3.5" />
            </button>

            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"
              title={t("creative.automation.card.delete")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Expanded details ── */}
      {expanded && (
        <div className="border-t border-slate-100 px-5 py-3 bg-slate-50/50">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[10px] text-slate-500">
            <div>
              <p className="font-bold text-slate-400 uppercase tracking-wider">{t("creative.automation.card.platform")}</p>
              <p className="text-slate-700 mt-0.5">{rule.platform === "all" ? t("creative.automation.card.platformAll") : rule.platform === "facebook" ? "Facebook" : "Google"}</p>
            </div>
            <div>
              <p className="font-bold text-slate-400 uppercase tracking-wider">{t("creative.automation.card.cooldown")}</p>
              <p className="text-slate-700 mt-0.5">{t("creative.automation.card.hours", { n: rule.cooldown })}</p>
            </div>
            <div>
              <p className="font-bold text-slate-400 uppercase tracking-wider">{t("creative.automation.card.created")}</p>
              <p className="text-slate-700 mt-0.5">{fmtDate(rule.createdAt, loc)}</p>
            </div>
            <div>
              <p className="font-bold text-slate-400 uppercase tracking-wider">{t("creative.automation.card.logic")}</p>
              <p className="text-slate-700 mt-0.5">{rule.conditionLogic === "AND" ? t("creative.automation.card.logicAll") : t("creative.automation.card.logicAny")}</p>
            </div>
          </div>
          {/* Action messages */}
          {rule.actions.some(a => a.message) && (
            <div className="mt-3 space-y-1">
              {rule.actions.filter(a => a.message).map((a, i) => (
                <p key={i} className="text-[10px] text-slate-400 italic">{ACTION_LABELS[a.type]?.icon} &ldquo;{a.message}&rdquo;</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Rule Creator Modal (2-step)
// ─────────────────────────────────────────────

function RuleCreatorModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (rule: AutomationRule) => void;
}) {
  const t = useT();
  const loc = useIntlLocale();
  const [step, setStep] = useState(1);
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);

  // Step 2 state
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<"facebook" | "google" | "all">("facebook");
  // Đợt 10b — rỗng = áp cho mọi loại chiến dịch Google (Search/PMax/Display/Video/Demand Gen).
  const [googleChannelTypes, setGoogleChannelTypes] = useState<string[]>([]);
  const [checkInterval, setCheckInterval] = useState<CheckInterval>("1hour");
  const [conditionLogic, setConditionLogic] = useState<"AND" | "OR">("AND");
  const [conditions, setConditions] = useState<Condition[]>([
    { metric: "roas", operator: "<", value: 0.8, timeWindow: "today" },
  ]);
  const [actions, setActions] = useState<Action[]>([
    { type: "send_notification", message: "" },
  ]);
  const [cooldown, setCooldown] = useState(24);
  const [saving, setSaving] = useState(false);

  // Apply template & go to step 2
  const selectTemplate = (idx: number | null) => {
    setSelectedTemplate(idx);
    if (idx !== null) {
      const tpl = PREBUILT_RULES[idx];
      setName(tpl.name);
      setPlatform(tpl.platform);
      setGoogleChannelTypes(tpl.googleChannelTypes ?? []);
      setCheckInterval(tpl.checkInterval);
      setConditionLogic(tpl.conditionLogic);
      setConditions([...tpl.conditions]);
      setActions([...tpl.actions]);
      setCooldown(tpl.cooldown);
    } else {
      // From scratch
      setName("");
      setPlatform("facebook");
      setGoogleChannelTypes([]);
      setCheckInterval("1hour");
      setConditionLogic("AND");
      setConditions([{ metric: "roas", operator: "<", value: 0.8, timeWindow: "today" }]);
      setActions([{ type: "send_notification", message: "" }]);
      setCooldown(24);
    }
    setStep(2);
  };

  // Condition helpers
  const updateCondition = (i: number, u: Partial<Condition>) => setConditions(p => p.map((c, j) => j === i ? { ...c, ...u } : c));
  const removeCondition = (i: number) => setConditions(p => p.filter((_, j) => j !== i));
  const addCondition = () => setConditions(p => [...p, { metric: "ctr", operator: ">", value: 0, timeWindow: "today" }]);

  // Action helpers
  const updateAction = (i: number, u: Partial<Action>) => setActions(p => p.map((a, j) => j === i ? { ...a, ...u } : a));
  const removeAction = (i: number) => setActions(p => p.filter((_, j) => j !== i));
  const addAction = () => setActions(p => [...p, { type: "send_notification" }]);

  // Google channel type helper — rỗng = mọi loại
  const toggleGoogleChannelType = (v: string) => setGoogleChannelTypes(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  // Save
  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/automation/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          rule: {
            name: name.trim(), isActive: false, platform, checkInterval, conditionLogic, conditions, actions, cooldown,
            ...(platform !== "facebook" ? { googleChannelTypes } : {}),
          },
        }),
      });
      const json = await res.json();
      if (json.success) onCreated(json.data);
    } finally {
      setSaving(false);
    }
  };

  const METRICS = Object.entries(METRIC_LABELS) as [MetricKey, string][];
  const OPERATORS = Object.entries(OPERATOR_LABELS) as [ConditionOperator, string][];
  const WINDOWS = Object.entries(TIME_WINDOW_LABELS) as [TimeWindow, string][];
  const ACTION_TYPES = Object.entries(ACTION_LABELS) as [ActionType, { label: string; icon: string }][];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl z-10">
          <div>
            <h2 className="text-base font-bold text-slate-800">
              {step === 1 ? t("creative.automation.createRule") : t("creative.automation.creator.configure")}
            </h2>
            <p className="text-[10px] text-slate-400">
              {step === 1 ? t("creative.automation.creator.step1") : t("creative.automation.creator.step2")}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6">
          {/* ── Step 1: Template selection ── */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-600 mb-3">{t("creative.automation.creator.pickTemplate")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PREBUILT_RULES.map((tpl, i) => (
                  <button
                    key={i}
                    onClick={() => selectTemplate(i)}
                    className="group flex items-center gap-3 rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-left transition-all hover:border-indigo-300 hover:shadow-sm"
                  >
                    <span className="text-xl">{TEMPLATE_ICONS[i]}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-700 group-hover:text-indigo-700">{tpl.name}</p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {tpl.conditions.map(c => `${METRIC_LABELS[c.metric]} ${fmtOperator(c.operator, t)} ${fmtMetricValue(c.metric, c.value, c.operator, loc)}`).join(" & ")}
                      </p>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-indigo-400" />
                  </button>
                ))}

                {/* From scratch */}
                <button
                  onClick={() => selectTemplate(null)}
                  className="group flex items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 px-4 py-3 text-left transition-all hover:border-indigo-300"
                >
                  <span className="text-xl">⚡</span>
                  <div>
                    <p className="text-sm font-semibold text-slate-500 group-hover:text-indigo-600">{t("creative.automation.creator.fromScratch")}</p>
                    <p className="text-[10px] text-slate-400">{t("creative.automation.creator.customRule")}</p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Configuration ── */}
          {step === 2 && (
            <div className="space-y-5">
              {/* Back button */}
              <button onClick={() => setStep(1)} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium flex items-center gap-1">
                {t("creative.automation.creator.back")}
              </button>

              {/* Rule name */}
              <div>
                <label className="text-xs font-semibold text-slate-700 mb-1.5 block">{t("creative.automation.creator.name")}</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t("creative.automation.creator.namePlaceholder")}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </div>

              {/* Platform selector */}
              <div>
                <label className="text-xs font-semibold text-slate-700 mb-1.5 block">{t("creative.automation.card.platform")}</label>
                <div className="flex gap-2">
                  {(["facebook", "google", "all"] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setPlatform(p)}
                      className={cn(
                        "rounded-lg border-2 px-4 py-2 text-xs font-semibold transition-all",
                        platform === p
                          ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                          : "border-slate-200 text-slate-500 hover:border-slate-300"
                      )}
                    >
                      {p === "facebook" ? "Facebook" : p === "google" ? "Google" : t("creative.automation.creator.both")}
                    </button>
                  ))}
                </div>
              </div>

              {/* Loại chiến dịch Google — chỉ áp dụng khi rule có chạm Google Ads */}
              {platform !== "facebook" && (
                <div>
                  <label className="text-xs font-semibold text-slate-700 mb-1.5 block">{t("creative.automation.creator.googleTypes")}</label>
                  <div className="flex flex-wrap gap-2">
                    {GOOGLE_CHANNEL_TYPE_OPTIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={googleChannelTypes.includes(value)}
                        onClick={() => toggleGoogleChannelType(value)}
                        className={cn(
                          "rounded-lg border-2 px-3 py-1.5 text-xs font-semibold transition-all",
                          googleChannelTypes.includes(value)
                            ? "border-sky-500 bg-sky-50 text-sky-700"
                            : "border-slate-200 text-slate-500 hover:border-slate-300"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {googleChannelTypes.length === 0 ? t("creative.automation.creator.googleNone") : t("creative.automation.creator.googleOnly", { list: googleChannelTypes.map(v => GOOGLE_CHANNEL_TYPE_LABEL[v] ?? v).join(", ") })}
                  </p>
                </div>
              )}

              {/* ── IF: Conditions ── */}
              <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold text-blue-700 flex items-center gap-1.5">
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-600">{t("creative.automation.creator.if")}</span>
                    {t("creative.automation.creator.conditions")}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-blue-400">{t("creative.automation.creator.logicLabel")}</span>
                    <div className="flex rounded-lg border border-blue-200 overflow-hidden">
                      <button
                        onClick={() => setConditionLogic("AND")}
                        className={cn("px-2.5 py-1 text-[10px] font-bold", conditionLogic === "AND" ? "bg-blue-500 text-white" : "bg-white text-blue-400")}
                      >{t("creative.automation.card.and")}</button>
                      <button
                        onClick={() => setConditionLogic("OR")}
                        className={cn("px-2.5 py-1 text-[10px] font-bold", conditionLogic === "OR" ? "bg-amber-500 text-white" : "bg-white text-amber-400")}
                      >{t("creative.automation.card.or")}</button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {conditions.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 bg-white rounded-lg border border-blue-100 px-3 py-2">
                      <select value={c.metric} onChange={e => updateCondition(i, { metric: e.target.value as MetricKey })} className="rounded border border-slate-200 px-2 py-1.5 text-xs flex-1 min-w-0 bg-white">
                        {METRICS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <select value={c.operator} onChange={e => updateCondition(i, { operator: e.target.value as ConditionOperator })} className="rounded border border-slate-200 px-2 py-1.5 text-xs w-24 bg-white">
                        {OPERATORS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <input
                        type="number"
                        value={c.value}
                        onChange={e => updateCondition(i, { value: parseFloat(e.target.value) || 0 })}
                        className="rounded border border-slate-200 px-2 py-1.5 text-xs w-20 bg-white"
                      />
                      <select value={c.timeWindow} onChange={e => updateCondition(i, { timeWindow: e.target.value as TimeWindow })} className="rounded border border-slate-200 px-2 py-1.5 text-xs w-28 bg-white">
                        {WINDOWS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      {conditions.length > 1 && (
                        <button onClick={() => removeCondition(i)} className="text-red-400 hover:text-red-600 shrink-0" title={t("creative.automation.creator.removeCondition")}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <button onClick={addCondition} className="mt-2 text-[10px] text-blue-500 hover:text-blue-700 font-semibold">
                  {t("creative.automation.creator.addCondition")}
                </button>
              </div>

              {/* ── THEN: Actions ── */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600">{t("creative.automation.creator.then")}</span>
                    {t("creative.automation.creator.actions")}
                  </p>
                </div>

                <div className="space-y-2">
                  {actions.map((a, i) => (
                    <div key={i} className="bg-white rounded-lg border border-emerald-100 px-3 py-2 space-y-2">
                      <div className="flex items-center gap-2">
                        <select value={a.type} onChange={e => updateAction(i, { type: e.target.value as ActionType })} className="rounded border border-slate-200 px-2 py-1.5 text-xs flex-1 bg-white">
                          {ACTION_TYPES.map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                        </select>
                        {(a.type === "increase_budget" || a.type === "decrease_budget") && (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={a.value ?? ""}
                              onChange={e => updateAction(i, { value: parseFloat(e.target.value) || 0 })}
                              placeholder="%"
                              className="rounded border border-slate-200 px-2 py-1.5 text-xs w-16 bg-white"
                            />
                            <span className="text-xs text-slate-400">%</span>
                          </div>
                        )}
                        {actions.length > 1 && (
                          <button onClick={() => removeAction(i)} className="text-red-400 hover:text-red-600 shrink-0">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {(a.type === "send_notification" || a.type === "send_email") && (
                        <input
                          type="text"
                          value={a.message ?? ""}
                          onChange={e => updateAction(i, { message: e.target.value })}
                          placeholder={t("creative.automation.creator.messagePlaceholder")}
                          className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs bg-white placeholder:text-slate-300"
                        />
                      )}
                    </div>
                  ))}
                </div>

                <button onClick={addAction} className="mt-2 text-[10px] text-emerald-500 hover:text-emerald-700 font-semibold">
                  {t("creative.automation.creator.addAction")}
                </button>
              </div>

              {/* Cooldown + Interval */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700 mb-1.5 block">{t("creative.automation.card.cooldown")}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={cooldown}
                      onChange={e => setCooldown(parseInt(e.target.value) || 1)}
                      min={1} max={168}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm w-20"
                    />
                    <span className="text-xs text-slate-400">{t("creative.automation.creator.cooldownSuffix")}</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 mb-1.5 block">{t("creative.automation.creator.checkEvery")}</label>
                  <select value={checkInterval} onChange={e => setCheckInterval(e.target.value as CheckInterval)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm w-full">
                    {Object.entries(INTERVAL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1">{t("creative.automation.creator.intervalNote")}</p>
                </div>
              </div>

              {/* Footer buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <Button variant="outline" onClick={onClose} className="text-xs">{t("creative.automation.creator.cancel")}</Button>
                <Button
                  onClick={handleSave}
                  disabled={!name.trim() || conditions.length === 0 || actions.length === 0 || saving}
                  className="gap-1.5 text-xs bg-amber-500 text-amber-950 hover:bg-amber-600 disabled:opacity-50 shadow-sm shadow-amber-200"
                >
                  {saving ? (
                    <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> {t("creative.automation.creator.saving")}</>
                  ) : (
                    <><Check className="h-3.5 w-3.5" /> {t("creative.automation.creator.save")}</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
