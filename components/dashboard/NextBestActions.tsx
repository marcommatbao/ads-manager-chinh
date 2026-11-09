"use client";

// ============================================================
// NextBestActions — Dashboard widget (Prompt D)
// Concise, action-oriented: top recommendations theo priority,
// executionMode badge, blockedBy, expected outcome, est. savings.
// Read-only controls cho viewer (dựa canExecute từ API).
// ============================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Sparkles, RefreshCw, ArrowRight, X, AlertTriangle, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { isHiddenPage } from "@/lib/hidden-pages";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { TFunction } from "@/lib/i18n/translate";

type ExecMode = "advisory_only" | "manual_action" | "auto_apply_candidate";

interface Recommendation {
  id: string;
  company: string;
  platform: "facebook" | "google";
  title: string;
  summary: string;
  expectedOutcome: string;
  executionMode: ExecMode;
  blockedBy: string[];
  internalLink?: string;
  estimatedMonthlySavings?: number;
  impactEstimate?: { estMonthlySavingsVnd?: number };
  band: "HIGH" | "MEDIUM" | "LOW";
}

interface ApiResponse {
  success: boolean;
  count: number;
  totalMonthlySavingsVnd: number;
  canExecute: boolean;
  items: Recommendation[];
  error?: string;
}

const BAND_STYLE: Record<Recommendation["band"], string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-slate-100 text-slate-600",
};
const BAND_RANK: Record<Recommendation["band"], number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const BAND_STRIPE: Record<Recommendation["band"], string> = {
  HIGH: "border-l-4 border-l-red-500",
  MEDIUM: "border-l-4 border-l-amber-400",
  LOW: "border-l-4 border-l-slate-300",
};

const MODE: Record<ExecMode, { label: MessageKey; cls: string }> = {
  advisory_only:       { label: "overview.nba.modeAdvisory", cls: "bg-slate-100 text-slate-600" },
  manual_action:       { label: "overview.nba.modeManual",   cls: "bg-amber-100 text-amber-700" },
  auto_apply_candidate:{ label: "overview.nba.modeAuto",     cls: "bg-emerald-100 text-emerald-700" },
};

const BLOCK_LABEL: Record<string, MessageKey> = {
  LEARNING_PHASE: "overview.nba.blockLearning",
  LOW_DATA: "overview.nba.blockLowData",
  RECENT_CHANGE: "overview.nba.blockRecentChange",
  COOLDOWN_LIKELY: "overview.nba.blockCooldown",
  LOW_CONFIDENCE: "overview.nba.blockLowConfidence",
  NOT_REVERSIBLE: "overview.nba.blockNotReversible",
};

function fmtVND(v: number, t: TFunction, loc: string): string {
  if (v >= 1_000_000_000) return `₫${(v / 1_000_000_000).toFixed(2)} ${t("overview.nba.unitB")}`;
  if (v >= 1_000_000)     return `₫${(v / 1_000_000).toFixed(1)}${t("overview.nba.unitM")}`;
  if (v >= 1_000)         return `₫${Math.round(v / 1_000)}k`;
  return `₫${Math.round(v).toLocaleString(loc)}`;
}

export default function NextBestActions() {
  const t = useT();
  const loc = useIntlLocale();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/next-best-action?minPriority=45${refresh ? "&refresh=1" : ""}`);
      const text = await res.text();
      const json = (text ? JSON.parse(text) : {}) as ApiResponse;
      if (!res.ok || !json.success) throw new Error(json.error ?? t("overview.nba.loadError", { status: res.status }));
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("overview.nba.connError"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => { load(false); }, [load]);

  const act = useCallback(async (id: string, action: "dismiss" | "acknowledge") => {
    setData(prev => prev ? { ...prev, items: prev.items.filter(r => r.id !== id), count: prev.count - 1 } : prev);
    try {
      await fetch("/api/next-best-action", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
    } catch { /* optimistic */ }
  }, []);

  const items = useMemo(
    () => [...(data?.items ?? [])].sort((a, b) => (BAND_RANK[a.band] ?? 2) - (BAND_RANK[b.band] ?? 2)),
    [data]
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="rounded-full bg-violet-50 p-2"><Sparkles className="h-4 w-4 text-violet-600" /></div>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-slate-800">{t("overview.nba.title")}</h2>
          <p className="text-[11px] text-slate-400">
            {data ? t("overview.nba.subtitleData", { count: data.count, amount: fmtVND(data.totalMonthlySavingsVnd, t, loc) }) : t("overview.nba.subtitleEmpty")}
          </p>
        </div>
        <Link href="/improvements" className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 hidden sm:block">{t("overview.nba.viewAll")}</Link>
        <button
          onClick={() => load(true)} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-600 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          {refreshing ? t("overview.nba.calculating") : t("overview.nba.refresh")}
        </button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      ) : loading ? (
        <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-slate-400 text-center py-8">{t("overview.nba.emptyPre")}<span className="font-semibold text-slate-500">{t("overview.nba.refresh")}</span>{t("overview.nba.emptyPost")}</div>
      ) : (
        <div className="space-y-2.5">
          {items.slice(0, 6).map(r => {
            const save = r.estimatedMonthlySavings ?? r.impactEstimate?.estMonthlySavingsVnd;
            return (
              <div key={r.id} className={cn("group rounded-xl border border-slate-100 hover:border-slate-200 bg-slate-50/50 p-3.5 transition-colors", BAND_STRIPE[r.band] ?? BAND_STRIPE.LOW)}>
                <div className="flex items-start gap-2">
                  <span className={cn("shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md", BAND_STYLE[r.band] ?? BAND_STYLE.LOW)}>{r.band ?? "LOW"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-semibold text-slate-800">{r.title}</p>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200/70 text-slate-500">{r.company}</span>
                      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", (MODE[r.executionMode] ?? MODE.advisory_only).cls)}>{t((MODE[r.executionMode] ?? MODE.advisory_only).label)}</span>
                      {(r.blockedBy ?? []).slice(0, 2).map(b => (
                        <span key={b} className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-50 text-orange-600">
                          <Lock className="h-2.5 w-2.5" />{BLOCK_LABEL[b] ? t(BLOCK_LABEL[b]) : b}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 leading-snug">{r.summary}</p>
                    <div className="flex items-center gap-3 mt-1.5">
                      {save ? <span className="text-[11px] font-semibold text-emerald-600">{t("overview.nba.perMonth", { amount: fmtVND(save, t, loc) })}</span> : null}
                      {/* Chốt trang đã ẩn — đây là nơi DUY NHẤT còn sót sau đợt gộp cơ
                          chế ẩn ngày 22/09. Ba nơi tiêu thụ `internalLink` khác
                          (NbaTriage, ActionPlanPanel, trang Improvements) đều đã có
                          `!isHiddenPage(...)`, riêng widget Dashboard thì không — nên nó
                          vẫn dựng link bấm được tới /toolkit/ngram và
                          /toolkit/budget-pacing, hai trang đang nằm trong HIDDEN_PAGES.
                          Chặn ở ĐÂY thay vì xoá ba dòng `internalLink` bên
                          reason-codes/improvement-manual-guide: xoá dữ liệu thì sau này
                          bỏ ẩn trang link không tự về, và lần tới ai thêm một reason-code
                          trỏ vào trang ẩn là lỗi tái diễn. */}
                      {r.internalLink && !isHiddenPage(r.internalLink) && (
                        <Link href={r.internalLink} className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-0.5">{t("overview.nba.open")} <ArrowRight className="h-3 w-3" /></Link>
                      )}
                    </div>
                  </div>
                  <button onClick={() => act(r.id, "dismiss")} className="shrink-0 text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" aria-label={t("overview.nba.dismiss")} title={t("overview.nba.dismiss")}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
