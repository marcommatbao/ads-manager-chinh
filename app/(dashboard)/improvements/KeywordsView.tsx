"use client";

import { useCallback, useEffect, useState } from "react";
import { KeywordTable } from "@/components/KeywordTable";
import { cn } from "@/lib/utils";
import type { KeywordInsight, KeywordInsightsResponse, IntentMatch, KwMatchType } from "@/types/keyword-insight";
import { orderedCompanyIds } from "@/lib/companies/registry";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

interface KeywordsViewProps {
  company: string | "all";
  showToast: (msg: string, type?: "success" | "error") => void;
}

// Real per-campaign monthly pacing — reuses the already-live
// /api/google/toolkit/budget-pacing endpoint (self-derives "monthly
// budget" from each campaign's real daily_budget × days-in-month, no
// dependency on the separate hand-maintained lib/budget-monitor.ts
// config file, which hasn't been updated since 2026-04 and would show
// nothing for the current month). expectedPct/actualPct come straight
// from that real endpoint; the on/over/under-pace label is derived here
// with a simple ±10 percentage-point band — a fresh, explicit choice
// since the endpoint itself only returns the raw two percentages.
interface CampaignPacing {
  id: string;
  name: string;
  spent: number;
  budget: number;
  expectedPct: number;
  actualPct: number;
  status: "over_pace" | "under_pace" | "on_track";
}

const PACING_STYLE: Record<CampaignPacing["status"], string> = {
  over_pace: "bg-red-100 text-red-700",
  under_pace: "bg-blue-100 text-blue-700",
  on_track: "bg-emerald-100 text-emerald-700",
};

const PACING_LABEL: Record<CampaignPacing["status"], MessageKey> = {
  over_pace: "overview.improvements.kw.pacing.over",
  under_pace: "overview.improvements.kw.pacing.under",
  on_track: "overview.improvements.kw.pacing.on",
};

const INTENT_OPTIONS: Array<{ value: IntentMatch | "ALL"; label: MessageKey }> = [
  { value: "ALL", label: "overview.improvements.kw.intent.all" },
  { value: "relevant", label: "overview.improvements.kw.intent.relevant" },
  { value: "borderline", label: "overview.improvements.kw.intent.borderline" },
  { value: "off_intent", label: "overview.improvements.kw.intent.off" },
  { value: "unknown", label: "overview.improvements.kw.intent.unknown" },
];

const MATCH_TYPE_OPTIONS: Array<{ value: KwMatchType | "ALL"; label: string }> = [
  { value: "ALL", label: "" }, // nhãn "Tất cả loại khớp" lấy từ t() lúc render
  { value: "EXACT", label: "Exact" },
  { value: "PHRASE", label: "Phrase" },
  { value: "BROAD", label: "Broad" },
];

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function KeywordsView({ company, showToast }: KeywordsViewProps) {
  const t = useT();
  const loc = useIntlLocale();
  const [data, setData] = useState<KeywordInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [intentFilter, setIntentFilter] = useState<IntentMatch | "ALL">("ALL");
  const [matchTypeFilter, setMatchTypeFilter] = useState<KwMatchType | "ALL">("ALL");
  const [campaignFilter, setCampaignFilter] = useState<string>("ALL");
  const [pacingByCampaign, setPacingByCampaign] = useState<Map<string, CampaignPacing>>(new Map());

  const co = company === "all" ? (orderedCompanyIds(["MBC"])[0] ?? "MBC") : company /* Đợt 25: công ty theo bản cài */;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/google/toolkit/budget-pacing?company=${co}`)
      .then(r => r.json())
      .then((json: { success?: boolean; campaigns?: Array<{ id: string; name: string; spent: number; budget: number; expectedPct: number; actualPct: number }> }) => {
        if (cancelled || !json.success || !json.campaigns) return;
        const map = new Map<string, CampaignPacing>();
        for (const c of json.campaigns) {
          const diff = c.actualPct - c.expectedPct;
          const status: CampaignPacing["status"] = diff > 10 ? "over_pace" : diff < -10 ? "under_pace" : "on_track";
          map.set(c.id, { ...c, status });
        }
        setPacingByCampaign(map);
      })
      .catch(() => { /* pacing context is best-effort — never block the keyword table */ });
    return () => { cancelled = true; };
  }, [co]);

  const fetchKeywords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ company: co });
      if (intentFilter !== "ALL") params.set("intentMatch", intentFilter);
      if (matchTypeFilter !== "ALL") params.set("matchType", matchTypeFilter);
      const res = await fetch(`/api/improvements/keywords?${params.toString()}`);
      const json = await res.json();
      if (res.ok) {
        setData(json);
      } else {
        showToast(json.error || t("overview.improvements.kw.loadError"), "error");
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : t("overview.improvements.kw.connError"), "error");
    } finally {
      setLoading(false);
    }
  }, [co, intentFilter, matchTypeFilter, showToast, t]);

  useEffect(() => {
    fetchKeywords();
  }, [fetchKeywords]);

  const handleAddNegative = async (kw: KeywordInsight, terms: string[]) => {
    setApplyingId(kw.id);
    try {
      const results = await Promise.all(
        terms.map(term =>
          fetch("/api/improvements/apply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              company: co,
              applyPayload: {
                action: "ADD_NEGATIVE",
                campaignResource: kw.campaignResourceName,
                term,
                matchType: "EXACT",
              },
            }),
          }).then(r => r.json())
        )
      );
      const okCount = results.filter(r => r.success).length;
      if (okCount > 0) {
        showToast(t("overview.improvements.kw.negAdded", { ok: okCount, total: terms.length, keyword: kw.keyword }));
        fetchKeywords();
      } else {
        showToast(results[0]?.error || t("overview.improvements.kw.negError"), "error");
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : t("overview.improvements.kw.connError"), "error");
    }
    setApplyingId(null);
  };

  const handleAdjustCpc = async (kw: KeywordInsight, newCpcMicros: number) => {
    setApplyingId(kw.id);
    try {
      const res = await fetch("/api/improvements/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: co,
          applyPayload: {
            action: "UPDATE_KEYWORD_CPC",
            resourceName: kw.criterionResourceName,
            newCpcMicros,
          },
        }),
      });
      const json = await res.json();
      if (json.success) {
        showToast(t("overview.improvements.kw.cpcUpdated", { keyword: kw.keyword }));
        fetchKeywords();
      } else {
        showToast(json.error || t("overview.improvements.kw.cpcError"), "error");
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : t("overview.improvements.kw.connError"), "error");
    }
    setApplyingId(null);
  };

  const keywords = data?.keywords ?? [];
  const campaigns = Array.from(new Map(keywords.map(k => [k.campaignId, k.campaignName])).entries());
  const filteredKeywords = campaignFilter === "ALL" ? keywords : keywords.filter(k => k.campaignId === campaignFilter);
  const visibleCampaignPacing = campaigns
    .map(([id]) => pacingByCampaign.get(id))
    .filter((p): p is CampaignPacing => !!p)
    .sort((a, b) => Math.abs(b.actualPct - b.expectedPct) - Math.abs(a.actualPct - a.expectedPct));

  const total = keywords.length;
  const relevantCount = keywords.filter(k => k.intentMatch === "relevant").length;
  const avgQS = (() => {
    const withQS = keywords.filter(k => k.qualityScore !== null);
    if (withQS.length === 0) return null;
    return withQS.reduce((s, k) => s + (k.qualityScore ?? 0), 0) / withQS.length;
  })();
  const avgCpc = total > 0 ? keywords.reduce((s, k) => s + k.currentCpc, 0) / total : 0;
  const savings = keywords
    .filter(k => k.budgetImpact === "over_budget")
    .reduce((s, k) => s + Math.max(0, (k.currentCpc - k.suggestedMaxCpc) * k.clicks), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard label={t("overview.improvements.kw.total")} value={total.toLocaleString(loc)} />
        <SummaryCard
          label={t("overview.improvements.kw.intentFit")}
          value={total > 0 ? `${Math.round((relevantCount / total) * 100)}%` : "—"}
          sub={t("overview.improvements.kw.keywordsCount", { ok: relevantCount, total })}
        />
        <SummaryCard label={t("overview.improvements.kw.avgQs")} value={avgQS !== null ? avgQS.toFixed(1) : "—"} />
        <SummaryCard label={t("overview.improvements.kw.avgCpc")} value={`₫${Math.round(avgCpc).toLocaleString(loc)}`} />
        <SummaryCard label={t("overview.improvements.kw.savings")} value={`₫${Math.round(savings * 30).toLocaleString(loc)}`} sub={t("overview.improvements.kw.savingsSub")} />
      </div>

      {visibleCampaignPacing.length > 0 && (
        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {t("overview.improvements.kw.pacingTitle")}
          </p>
          <div className="flex flex-wrap gap-2">
            {visibleCampaignPacing.map(p => (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs"
                title={t("overview.improvements.kw.pacingTip", { spent: p.spent.toLocaleString(loc), budget: p.budget.toLocaleString(loc), actual: p.actualPct, expected: p.expectedPct })}
              >
                <span className="max-w-[160px] truncate font-medium text-foreground">{p.name}</span>
                <span className={cn("rounded-full px-2 py-0.5 font-medium", PACING_STYLE[p.status])}>
                  {p.actualPct}%/{p.expectedPct}% — {t(PACING_LABEL[p.status])}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          value={campaignFilter}
          onChange={e => setCampaignFilter(e.target.value)}
        >
          <option value="ALL">{t("overview.improvements.kw.allCampaigns")}</option>
          {campaigns.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          value={intentFilter}
          onChange={e => setIntentFilter(e.target.value as IntentMatch | "ALL")}
        >
          {INTENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
        </select>
        <select
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          value={matchTypeFilter}
          onChange={e => setMatchTypeFilter(e.target.value as KwMatchType | "ALL")}
        >
          {MATCH_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.value === "ALL" ? t("overview.improvements.kw.allMatch") : o.label}</option>)}
        </select>
        <button
          onClick={fetchKeywords}
          className="ml-auto h-9 rounded-md border border-border bg-background px-3 text-sm hover:bg-muted"
        >
          {t("overview.improvements.kw.refresh")}
        </button>
      </div>

      <KeywordTable
        keywords={filteredKeywords}
        loading={loading}
        applyingId={applyingId}
        onAddNegative={handleAddNegative}
        onAdjustCpc={handleAdjustCpc}
      />
    </div>
  );
}
