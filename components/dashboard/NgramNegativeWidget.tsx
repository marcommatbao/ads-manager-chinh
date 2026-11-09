"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2, ShieldOff, ArrowRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { companyIds } from "@/lib/companies/registry";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";

interface NgramItem {
  ngram: string;
  cost: number;
  clicks: number;
  conversions: number;
  /** null = chưa có chuyển đổi nào (khác hẳn với CPA = 0). */
  cpa: number | null;
  vsAvgPct: number | null;
  potentialSavings: number;
  recommendation: "NEGATIVE" | "MONITOR" | "KEEP";
}

interface NegativeSuggestion extends NgramItem {
  company: string;
}

function fmtMoney(val: number, t: TFunction, loc: string): string {
  if (val >= 1_000_000) return `₫${(val / 1_000_000).toFixed(1)}${t("overview.ngram.unitM")}`;
  if (val >= 1_000) return `₫${Math.round(val / 1000)}K`;
  return `₫${val.toLocaleString(loc)}`;
}

export function NgramNegativeWidget() {
  const t = useT();
  const loc = useIntlLocale();
  const [suggestions, setSuggestions] = useState<NegativeSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled(
      companyIds().map(async (company) => {
        const res = await fetch(`/api/google/toolkit/ngram?company=${company}&campaignId=ALL&n=1`);
        if (!res.ok) return { company, ngrams: [] as NgramItem[] };
        const json = await res.json();
        return { company, ngrams: (json.ngrams ?? []) as NgramItem[] };
      })
    ).then((results) => {
      if (cancelled) return;
      const merged: NegativeSuggestion[] = [];
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        for (const ng of r.value.ngrams) {
          if (ng.recommendation === "NEGATIVE") {
            merged.push({ ...ng, company: r.value.company });
          }
        }
      }
      merged.sort((a, b) => b.potentialSavings - a.potentialSavings);
      setSuggestions(merged.slice(0, 5));
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm h-32 animate-pulse flex items-center justify-center">
        <Loader2 className="h-6 w-6 text-slate-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col h-full">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          {t("overview.ngram.title")}
        </h3>
        <Link
          href="/toolkit/ngram"
          className="text-[11px] font-semibold text-amber-700 hover:text-amber-800 flex items-center gap-0.5"
        >
          {t("overview.ngram.viewAndHandle")} <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="px-5 pb-5 space-y-2 flex-1">
        {suggestions.length === 0 ? (
          <p className="text-[10px] text-emerald-600 flex items-center gap-1 py-2">
            <CheckCircle2 className="h-3 w-3" /> {t("overview.ngram.none")}
          </p>
        ) : (
          suggestions.map((s, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50/50 px-3 py-2">
              <ShieldOff className="h-3.5 w-3.5 text-red-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-700 truncate">"{s.ngram}"</p>
                <p className="text-[10px] text-slate-400">
                  <span className={cn("font-bold px-1 rounded", s.company === "MBC" ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700")}>
                    {s.company}
                  </span>{" "}
                  {s.cpa === null
                    ? <>{t("overview.ngram.zeroConv", { clicks: s.clicks, cost: fmtMoney(s.cost, t, loc) })}</>
                    : <>{t("overview.ngram.cpa", { cpa: fmtMoney(s.cpa, t, loc), delta: `${s.vsAvgPct !== null && s.vsAvgPct > 0 ? "+" : ""}${s.vsAvgPct ?? 0}` })}</>}
                </p>
              </div>
              <p className="text-xs font-bold text-red-600 shrink-0">{t("overview.ngram.savings", { amount: fmtMoney(s.potentialSavings, t, loc) })}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
