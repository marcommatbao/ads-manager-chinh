"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, formatCurrency } from "@/lib/utils";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { KeywordInsight, IntentMatch, BudgetImpact } from "@/types/keyword-insight";

// ─────────────────────────────────────────────
// Badge styling — semantic colors, separate from the accent hue
// ─────────────────────────────────────────────

const INTENT_STYLE: Record<IntentMatch, string> = {
  relevant: "bg-emerald-100 text-emerald-700",
  borderline: "bg-amber-100 text-amber-700",
  off_intent: "bg-red-100 text-red-700",
  unknown: "bg-slate-100 text-slate-500",
};

const INTENT_LABEL: Record<IntentMatch, MessageKey> = {
  relevant: "panels.keywords.intent.relevant",
  borderline: "panels.keywords.intent.borderline",
  off_intent: "panels.keywords.intent.off_intent",
  unknown: "panels.keywords.intent.unknown",
};

const BUDGET_STYLE: Record<BudgetImpact, string> = {
  over_budget: "bg-red-100 text-red-700",
  under_budget: "bg-blue-100 text-blue-700",
  on_track: "bg-emerald-100 text-emerald-700",
  unknown: "bg-slate-100 text-slate-500",
};

const BUDGET_LABEL: Record<BudgetImpact, MessageKey | "—"> = {
  over_budget: "panels.keywords.budget.over_budget",
  under_budget: "panels.keywords.budget.under_budget",
  on_track: "panels.keywords.budget.on_track",
  unknown: "—",
};

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

interface KeywordTableProps {
  keywords: KeywordInsight[];
  loading?: boolean;
  applyingId?: string | null;
  onAddNegative: (kw: KeywordInsight, terms: string[]) => void;
  onAdjustCpc: (kw: KeywordInsight, newCpcMicros: number) => void;
}

export function KeywordTable({ keywords, loading, applyingId, onAddNegative, onAdjustCpc }: KeywordTableProps) {
  const t = useT();
  const loc = useIntlLocale();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cpcDraft, setCpcDraft] = useState<Record<string, string>>({});
  const [negativeOpenId, setNegativeOpenId] = useState<string | null>(null);
  const [cpcOpenId, setCpcOpenId] = useState<string | null>(null);
  const [selectedTerms, setSelectedTerms] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openNegativePopover = (kw: KeywordInsight) => {
    setNegativeOpenId(kw.id);
    setSelectedTerms(new Set(kw.searchTermSamples.filter(s => s.classification === "off_intent").map(s => s.searchTerm)));
  };

  if (!loading && keywords.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium text-foreground">{t("panels.keywords.emptyTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("panels.keywords.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-6" />
            <TableHead>{t("panels.keywords.h.keyword")}</TableHead>
            <TableHead>{t("panels.keywords.h.match")}</TableHead>
            <TableHead>{t("panels.keywords.h.campaign")}</TableHead>
            <TableHead>{t("panels.keywords.h.channel")}</TableHead>
            <TableHead>{t("panels.keywords.h.intent")}</TableHead>
            <TableHead className="text-right">{t("panels.keywords.h.impr")}</TableHead>
            <TableHead className="text-right">{t("panels.keywords.h.clicks")}</TableHead>
            <TableHead className="text-right">CTR</TableHead>
            <TableHead className="text-right">{t("panels.keywords.h.cpc")}</TableHead>
            <TableHead className="text-right">QS</TableHead>
            <TableHead className="text-right">{t("panels.keywords.h.cpl")}</TableHead>
            <TableHead className="text-right">{t("panels.keywords.h.sugCpc")}</TableHead>
            <TableHead>{t("panels.keywords.h.budget")}</TableHead>
            <TableHead>{t("panels.keywords.h.hint")}</TableHead>
            <TableHead className="text-right">{t("panels.keywords.h.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={16} className="py-10 text-center text-sm text-muted-foreground">
                <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                {t("panels.keywords.loading")}
              </TableCell>
            </TableRow>
          )}
          {keywords.map(kw => {
            const isExpanded = expanded.has(kw.id);
            const hasOffIntent = kw.searchTermSamples.some(s => s.classification === "off_intent");
            const isApplying = applyingId === kw.id;
            return (
              <>
                <TableRow key={kw.id} className={cn(isExpanded && "border-b-0")}>
                  <TableCell>
                    {kw.searchTermSamples.length > 0 && (
                      <button
                        onClick={() => toggleExpand(kw.id)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={t("panels.keywords.viewSamples")}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate font-medium">{kw.keyword}</TableCell>
                  <TableCell><Badge variant="outline">{kw.matchType}</Badge></TableCell>
                  <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground">{kw.campaignName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {kw.channelType}
                    <div className="text-xs">{kw.biddingStrategyType}</div>
                  </TableCell>
                  <TableCell>
                    <Badge className={INTENT_STYLE[kw.intentMatch]}>{t(INTENT_LABEL[kw.intentMatch])}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{kw.impressions.toLocaleString(loc)}</TableCell>
                  <TableCell className="text-right tabular-nums">{kw.clicks.toLocaleString(loc)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPct(kw.ctr)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(kw.currentCpc, "VND", true, loc)}</TableCell>
                  <TableCell className="text-right tabular-nums">{kw.qualityScore ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{kw.cplEstimate !== null ? formatCurrency(kw.cplEstimate, "VND", true, loc) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums" title={kw.suggestedMaxCpc > 0 ? undefined : t("panels.keywords.noCpcTitle")}>{kw.suggestedMaxCpc > 0 ? formatCurrency(kw.suggestedMaxCpc, "VND", true, loc) : "—"}</TableCell>
                  <TableCell><Badge className={BUDGET_STYLE[kw.budgetImpact]}>{BUDGET_LABEL[kw.budgetImpact] === "—" ? "—" : t(BUDGET_LABEL[kw.budgetImpact] as MessageKey)}</Badge></TableCell>
                  <TableCell className="max-w-[180px] text-xs text-muted-foreground">{kw.suggestedAction}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Popover open={negativeOpenId === kw.id} onOpenChange={o => setNegativeOpenId(o ? kw.id : null)}>
                        <PopoverTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!hasOffIntent || isApplying}
                            onClick={() => openNegativePopover(kw)}
                            title={hasOffIntent ? t("panels.keywords.negTitleOn") : t("panels.keywords.negTitleOff")}
                          >
                            Negative
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72" align="end">
                          <p className="mb-2 text-xs font-medium text-foreground">{t("panels.keywords.negPick")}</p>
                          <div className="max-h-48 space-y-1 overflow-y-auto">
                            {kw.searchTermSamples.filter(s => s.classification !== "relevant").map(s => (
                              <label key={s.searchTerm} className="flex items-center gap-2 text-xs">
                                <input
                                  type="checkbox"
                                  checked={selectedTerms.has(s.searchTerm)}
                                  onChange={e => {
                                    setSelectedTerms(prev => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(s.searchTerm);
                                      else next.delete(s.searchTerm);
                                      return next;
                                    });
                                  }}
                                />
                                <span className="truncate">{s.searchTerm}</span>
                                <Badge className={cn("ml-auto", INTENT_STYLE[s.classification])}>{s.clicks}c</Badge>
                              </label>
                            ))}
                          </div>
                          <Button
                            size="sm"
                            className="mt-3 w-full"
                            disabled={selectedTerms.size === 0 || isApplying}
                            onClick={() => {
                              onAddNegative(kw, Array.from(selectedTerms));
                              setNegativeOpenId(null);
                            }}
                          >
                            {isApplying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("panels.keywords.negAdd", { n: selectedTerms.size })}
                          </Button>
                        </PopoverContent>
                      </Popover>

                      <Popover open={cpcOpenId === kw.id} onOpenChange={o => setCpcOpenId(o ? kw.id : null)}>
                        <PopoverTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isApplying}
                            onClick={() => setCpcDraft(prev => ({ ...prev, [kw.id]: String(Math.round(kw.suggestedMaxCpc > 0 ? kw.suggestedMaxCpc : kw.currentCpc)) }))}
                          >
                            CPC
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56" align="end">
                          <p className="mb-2 text-xs font-medium text-foreground">{t("panels.keywords.cpcNew")}</p>
                          <Input
                            type="number"
                            value={cpcDraft[kw.id] ?? String(Math.round(kw.suggestedMaxCpc > 0 ? kw.suggestedMaxCpc : kw.currentCpc))}
                            onChange={e => setCpcDraft(prev => ({ ...prev, [kw.id]: e.target.value }))}
                          />
                          <p className="mt-1 text-xs text-muted-foreground">{kw.suggestedMaxCpc > 0 ? <>{t("panels.keywords.cpcSuggest", { amount: formatCurrency(kw.suggestedMaxCpc, "VND", true, loc) })}</> : t("panels.keywords.cpcNoSuggest")}</p>
                          <Button
                            size="sm"
                            className="mt-3 w-full"
                            disabled={isApplying}
                            onClick={() => {
                              const vnd = parseInt(cpcDraft[kw.id] ?? "0", 10);
                              if (vnd > 0) {
                                onAdjustCpc(kw, vnd * 1_000_000);
                                setCpcOpenId(null);
                              }
                            }}
                          >
                            {isApplying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("panels.keywords.apply")}
                          </Button>
                        </PopoverContent>
                      </Popover>

                      <Button size="sm" variant="outline" disabled title={t("panels.keywords.adGroupTitle")}>
                        {t("panels.keywords.adGroup")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {isExpanded && kw.searchTermSamples.length > 0 && (
                  <TableRow key={`${kw.id}-samples`}>
                    <TableCell />
                    <TableCell colSpan={15} className="bg-muted/30 py-3">
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("panels.keywords.samples")}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {kw.searchTermSamples.map(s => (
                          <Badge key={s.searchTerm} className={cn("gap-1.5", INTENT_STYLE[s.classification])}>
                            {s.searchTerm}
                            <span className="opacity-70">· {s.clicks}c</span>
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
