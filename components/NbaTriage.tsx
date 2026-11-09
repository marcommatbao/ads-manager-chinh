"use client";

// ============================================================
// NbaTriage — Next Best Action triage queue (Prompt D)
// Hàng đợi xử lý cho marketing ops: lọc theo company/platform/type/
// executionMode/priority/status + lifecycle actions (acknowledge,
// snooze, resolve, dismiss, feedback). Desktop + mobile + states.
// ============================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import { isHiddenPage } from "@/lib/hidden-pages";
import Link from "next/link";
import {
  Sparkles, RefreshCw, ArrowRight, AlertTriangle, Lock,
  Check, Clock, X, ThumbsUp, ThumbsDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { TFunction } from "@/lib/i18n/translate";
import { orderedCompanyIds, companyLabel } from "@/lib/companies/registry";

// Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ)
const coText = (id: string) => (id === "MBC" || id === "MBI" ? id : companyLabel(id));

type ExecMode = "advisory_only" | "manual_action" | "auto_apply_candidate";

interface Rec {
  id: string;
  company: string;
  platform: "facebook" | "google";
  recommendationType: string;
  reasonCodes: string[];
  title: string;
  summary: string;
  recommendedAction: string;
  expectedOutcome: string;
  executionMode: ExecMode;
  blockedBy: string[];
  internalLink?: string;
  estimatedMonthlySavings?: number;
  feedback?: "helped" | "not_helpful" | "ignored";
  band: "HIGH" | "MEDIUM" | "LOW";
}

interface ApiResponse {
  success: boolean;
  count: number;
  totalMonthlySavingsVnd: number;
  savingsBasis?: { countedItems: number; blockedExcluded: number; distinctEntities: number; method: string };
  /** Ngưỡng CPL đang chạy trên số dự phòng vì KPI tháng chưa nhập. */
  thresholdWarnings?: string[];
  totalsByPriorityBucket: Record<string, number>;
  totalsByPlatform: Record<string, number>;
  items: Rec[];
  error?: string;
}

const BAND: Record<Rec["band"], string> = {
  HIGH: "bg-red-100 text-red-700", MEDIUM: "bg-amber-100 text-amber-700", LOW: "bg-slate-100 text-slate-600",
};
const BAND_RANK: Record<Rec["band"], number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const BAND_STRIPE: Record<Rec["band"], string> = {
  HIGH: "border-l-4 border-l-red-500", MEDIUM: "border-l-4 border-l-amber-400", LOW: "border-l-4 border-l-slate-300",
};
const MODE: Record<ExecMode, { label: MessageKey; cls: string }> = {
  advisory_only: { label: "panels.nba.mode.advisory", cls: "bg-slate-100 text-slate-600" },
  manual_action: { label: "panels.nba.mode.manual", cls: "bg-amber-100 text-amber-700" },
  auto_apply_candidate: { label: "panels.nba.mode.auto", cls: "bg-emerald-100 text-emerald-700" },
};
const BLOCK: Record<string, MessageKey> = {
  LEARNING_PHASE: "panels.nba.block.LEARNING_PHASE",
  LOW_DATA: "panels.nba.block.LOW_DATA",
  RECENT_CHANGE: "panels.nba.block.RECENT_CHANGE",
  COOLDOWN_LIKELY: "panels.nba.block.COOLDOWN_LIKELY",
  LOW_CONFIDENCE: "panels.nba.block.LOW_CONFIDENCE",
  NOT_REVERSIBLE: "panels.nba.block.NOT_REVERSIBLE",
};
const TYPE_LABEL: Record<string, MessageKey> = {
  REDUCE_CPL: "panels.nba.type.REDUCE_CPL",
  PAUSE_WASTE: "panels.nba.type.PAUSE_WASTE",
  REFRESH_CREATIVE: "panels.nba.type.REFRESH_CREATIVE",
  SCALE_BUDGET: "panels.nba.type.SCALE_BUDGET",
  REVIEW_BUDGET: "panels.nba.type.REVIEW_BUDGET",
  FIX_KEYWORD: "panels.nba.type.FIX_KEYWORD",
  ADJUST_SCHEDULE: "panels.nba.type.ADJUST_SCHEDULE",
  ACCOUNT_FIX: "panels.nba.type.ACCOUNT_FIX",
  IMPORTED_IMPROVEMENT: "panels.nba.type.IMPORTED_IMPROVEMENT",
};

function fmtVND(v: number, t: TFunction, loc: string): string {
  if (v >= 1_000_000_000) return t("panels.nba.fmt.b", { n: (v / 1_000_000_000).toFixed(2) });
  if (v >= 1_000_000) return t("panels.nba.fmt.m", { n: (v / 1_000_000).toFixed(1) });
  if (v >= 1_000) return `₫${Math.round(v / 1_000)}k`;
  return `₫${Math.round(v).toLocaleString(loc)}`;
}

const PRIORITY_FILTERS = [
  { key: "0", label: "" }, { key: "70", label: "HIGH" },
  { key: "45", label: "MEDIUM+" },
] as const;

export default function NbaTriage() {
  const t = useT();
  const loc = useIntlLocale();
  const [items, setItems] = useState<Rec[]>([]);
  const [meta, setMeta] = useState<{ savings: number; basis?: ApiResponse["savingsBasis"] } | null>(null);
  const [thresholdWarnings, setThresholdWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // filters
  const [company, setCompany] = useState("");
  const [platform, setPlatform] = useState("");
  const [mode, setMode] = useState("");
  const [type, setType] = useState("");
  const [minPriority, setMinPriority] = useState("0");
  const [status, setStatus] = useState("active"); // active | blocked | acknowledged | resolved

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (company) p.set("company", company);
    if (platform) p.set("platform", platform);
    if (mode) p.set("executionMode", mode);
    if (type) p.set("recommendationType", type);
    if (minPriority !== "0") p.set("minPriority", minPriority);
    if (status === "acknowledged") p.set("status", "acknowledged");
    else if (status === "resolved") p.set("status", "resolved");
    return p.toString();
  }, [company, platform, mode, type, minPriority, status]);

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/next-best-action?${query}${refresh ? "&refresh=1" : ""}`);
      const text = await res.text();
      const json = (text ? JSON.parse(text) : {}) as ApiResponse;
      if (!res.ok || !json.success) throw new Error(json.error ?? t("panels.nba.loadError", { status: res.status }));
      let list = json.items;
      if (status === "blocked") list = list.filter(r => (r.blockedBy ?? []).length > 0);
      if (status === "active") list = list.filter(r => (r.blockedBy ?? []).length === 0);
      list = [...list].sort((a, b) => (BAND_RANK[a.band] ?? 2) - (BAND_RANK[b.band] ?? 2));
      setItems(list);
      setMeta({ savings: json.totalMonthlySavingsVnd, basis: json.savingsBasis });
      setThresholdWarnings(json.thresholdWarnings ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("panels.nba.connError"));
    } finally {
      setLoading(false);
    }
  }, [query, status, t]);

  useEffect(() => { load(false); }, [load]);

  const triage = useCallback(async (id: string, action: string, extra?: Record<string, unknown>) => {
    setItems(prev => prev.filter(r => r.id !== id)); // optimistic
    try {
      await fetch("/api/next-best-action", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, ...extra }),
      });
    } catch { /* optimistic */ }
  }, []);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="rounded-full bg-violet-50 p-2"><Sparkles className="h-4 w-4 text-violet-600" /></div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-slate-800">{t("panels.nba.title")}</h2>
          <p className="text-[11px] text-slate-400">
            {t("panels.nba.count", { n: items.length })}{meta ? t("panels.nba.savings", { amount: fmtVND(meta.savings, t, loc) }) : ""}
            {meta?.basis && (
              // Con số này là ƯỚC TÍNH từ một tỉ lệ phần trăm cố định của chi
              // tiêu, không phải số đo được. Hiện trần trụi như số chắc chắn
              // là để người đọc mang đi báo cáo một thứ không có thật.
              <span
                title={`${t("panels.nba.basisTitle", { method: meta.basis.method, entities: meta.basis.distinctEntities, items: meta.basis.countedItems })}${meta.basis.blockedExcluded > 0 ? t("panels.nba.basisBlocked", { n: meta.basis.blockedExcluded }) : ""}.`}
                className="ml-1 cursor-help text-slate-400 underline decoration-dotted">
                {t("panels.nba.basisHow")}
              </span>
            )}
          </p>
        </div>
        <button onClick={() => load(true)} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-600 disabled:opacity-50">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> {t("panels.nba.refresh")}
        </button>
      </div>

      {/* Ngưỡng CPL đang chạy trên số đóng băng từ 7/2026 vì KPI tháng chưa
          nhập. Không báo thì mọi gợi ý "CPL vượt ngưỡng" bên dưới đang so với
          mục tiêu của một tháng đã qua, mà nhìn vào không thể biết. */}
      {thresholdWarnings.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-[11px] font-bold text-amber-900">
            {t("panels.nba.warnTitle")}
          </p>
          {thresholdWarnings.map((w, i) => (
            <p key={i} className="mt-0.5 text-[11px] text-amber-800">{w}</p>
          ))}
        </div>
      )}

      

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 text-xs">
        <Select value={company} onChange={setCompany} options={[["", t("panels.nba.f.allCompany")], ...orderedCompanyIds(["MBC", "MBI"]).map((c) => [c, coText(c)] as [string, string])]} />
        <Select value={platform} onChange={setPlatform} options={[["", t("panels.nba.f.allPlatform")], ["facebook", "Facebook"], ["google", "Google"]]} />
        <Select value={mode} onChange={setMode} options={[["", t("panels.nba.f.allMode")], ["advisory_only", t("panels.nba.mode.advisory")], ["manual_action", t("panels.nba.mode.manual")], ["auto_apply_candidate", t("panels.nba.f.modeAuto")]]} />
        <Select value={type} onChange={setType} options={[["", t("panels.nba.f.allType")], ...Object.entries(TYPE_LABEL).map(([k, v]) => [k, t(v)] as [string, string])]} />
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {PRIORITY_FILTERS.map(p => (
            <button key={p.key} onClick={() => setMinPriority(p.key)}
              className={cn("px-2.5 py-1 rounded-md font-semibold transition", minPriority === p.key ? "bg-white text-blue-700 shadow-sm" : "text-slate-500")}>{p.key === "0" ? t("panels.nba.pri.all") : p.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {([["active", t("panels.nba.s.active")], ["blocked", t("panels.nba.s.blocked")], ["acknowledged", t("panels.nba.s.ack")], ["resolved", t("panels.nba.s.resolved")]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setStatus(k)}
              className={cn("px-2.5 py-1 rounded-md font-semibold transition", status === k ? "bg-white text-blue-700 shadow-sm" : "text-slate-500")}>{l}</button>
          ))}
        </div>
      </div>

      {/* Body */}
      {error ? (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      ) : loading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl bg-slate-100 animate-pulse" />)}</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-slate-400 text-center py-10">{t("panels.nba.empty")}</div>
      ) : (
        <div className="space-y-3">
          {items.map(r => (
            <div key={r.id} className={cn("rounded-xl border border-slate-100 bg-slate-50/40 p-4", BAND_STRIPE[r.band] ?? BAND_STRIPE.LOW)}>
              <div className="flex items-start gap-2 flex-wrap">
                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-md", BAND[r.band] ?? BAND.LOW)}>{r.band ?? "LOW"}</span>
                <p className="text-sm font-semibold text-slate-800 flex-1 min-w-[200px]">{r.title}</p>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200/70 text-slate-500">{r.company}</span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{TYPE_LABEL[r.recommendationType] ? t(TYPE_LABEL[r.recommendationType]) : r.recommendationType}</span>
                <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", (MODE[r.executionMode] ?? MODE.advisory_only).cls)}>{t((MODE[r.executionMode] ?? MODE.advisory_only).label)}</span>
                {(r.blockedBy ?? []).map(b => (
                  <span key={b} className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-50 text-orange-600"><Lock className="h-2.5 w-2.5" />{BLOCK[b] ? t(BLOCK[b]) : b}</span>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-1.5">{r.summary}</p>
              <div className="grid sm:grid-cols-2 gap-2 mt-2 text-[11px]">
                <p className="text-slate-600"><span className="font-semibold text-slate-700">{t("panels.nba.todo")}</span> {r.recommendedAction}</p>
                <p className="text-slate-600"><span className="font-semibold text-slate-700">{t("panels.nba.expect")}</span> {r.expectedOutcome}</p>
              </div>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {r.estimatedMonthlySavings ? <span className="text-[11px] font-semibold text-emerald-600 mr-1">{t("panels.nba.perMonth", { amount: fmtVND(r.estimatedMonthlySavings, t, loc) })}</span> : null}
                {r.internalLink && !isHiddenPage(r.internalLink) && <Link href={r.internalLink} className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-0.5 mr-auto">{t("panels.nba.openTool")} <ArrowRight className="h-3 w-3" /></Link>}
                <TriageBtn icon={<Check className="h-3 w-3" />} label={t("panels.nba.a.ack")} onClick={() => triage(r.id, "acknowledge")} />
                <TriageBtn icon={<Clock className="h-3 w-3" />} label={t("panels.nba.a.snooze")} onClick={() => triage(r.id, "snooze", { hours: 24 })} />
                <TriageBtn icon={<Check className="h-3 w-3" />} label={t("panels.nba.a.done")} onClick={() => triage(r.id, "resolve")} accent="emerald" />
                <TriageBtn icon={<X className="h-3 w-3" />} label={t("panels.nba.a.dismiss")} onClick={() => triage(r.id, "dismiss")} />
                <TriageBtn icon={<ThumbsUp className="h-3 w-3" />} label="" onClick={() => triage(r.id, "feedback", { feedback: "helped" })} accent="emerald" title={t("panels.nba.a.helpful")} />
                <TriageBtn icon={<ThumbsDown className="h-3 w-3" />} label="" onClick={() => triage(r.id, "feedback", { feedback: "not_helpful" })} title={t("panels.nba.a.notHelpful")} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-600 focus:outline-none focus:border-blue-400">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function TriageBtn({ icon, label, onClick, accent, title }: { icon: React.ReactNode; label: string; onClick: () => void; accent?: "emerald"; title?: string }) {
  return (
    <button onClick={onClick} title={title ?? label}
      className={cn("inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-semibold transition",
        accent === "emerald" ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50" : "border-slate-200 text-slate-500 hover:bg-slate-100")}>
      {icon}{label && <span>{label}</span>}
    </button>
  );
}
