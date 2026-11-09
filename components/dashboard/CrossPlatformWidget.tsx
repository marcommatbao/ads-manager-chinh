"use client";

import { useEffect, useState } from "react";
import { ArrowRight, BarChart2, Loader2, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

interface PlatformStats {
  spend: number;
  conversions: number;
  cpl: number;
  /** false = no conversions yet, so `cpl` of 0 is "unknown", not "free". */
  cplKnown: boolean;
}

interface CrossPlatformData {
  facebook: PlatformStats;
  google: PlatformStats;
  recommendation: string;
  partialErrors?: string[];
}

export function CrossPlatformWidget() {
  const t = useT();
  const [data, setData] = useState<CrossPlatformData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Previously had no .catch: a non-JSON response (this route used to 404)
    // rejected here and surfaced as an unhandled rejection on every load.
    fetch("/api/analytics/cross-platform")
      .then(async r => {
        const json = await r.json().catch(() => null);
        if (!r.ok || !json?.success) {
          throw new Error(json?.error ?? `HTTP ${r.status}`);
        }
        setData(json.data as CrossPlatformData);
      })
      .catch(err => setError(err instanceof Error ? err.message : t("overview.crossplatform.loadFail")))
      .finally(() => setLoading(false));
  }, [t]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm flex items-center justify-center animate-pulse min-h-[160px]">
        <Loader2 className="h-6 w-6 text-slate-300 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-2">
          <div className="rounded-md bg-blue-100 p-1.5"><BarChart2 className="h-4 w-4 text-blue-600" /></div>
          {t("overview.crossplatform.title")}
        </h3>
        <p className="text-xs text-slate-500">{t("overview.crossplatform.loadFailDetail", { error })}</p>
      </div>
    );
  }

  if (!data) return null;

  const fbCpl = data.facebook.cpl;
  const ggCpl = data.google.cpl;
  const bothKnown = data.facebook.cplKnown && data.google.cplKnown;
  const isFbCheaper = bothKnown && fbCpl < ggCpl;
  const isGgCheaper = bothKnown && ggCpl < fbCpl;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <div className="rounded-md bg-blue-100 p-1.5"><BarChart2 className="h-4 w-4 text-blue-600" /></div>
          {t("overview.crossplatform.insightsTitle")}
        </h3>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        {/* FB Card */}
        <div className={cn("rounded-lg p-3 border", isFbCheaper ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-100")}>
          <p className="text-xs font-bold text-slate-500 mb-1">Facebook Ads</p>
          <p className={cn("text-lg font-bold", isFbCheaper ? "text-emerald-700" : "text-slate-700")}>
            {data.facebook.cplKnown ? <>₫{Math.round(fbCpl/1000)}K</> : "—"} <span className="text-[10px] font-normal text-slate-500">{t("overview.crossplatform.perLead")}</span>
          </p>
          <div className="mt-2 text-[10px] text-slate-500 flex justify-between">
             <span>{t("overview.crossplatform.spend", { amount: Math.round(data.facebook.spend/1000000) })}</span>
             <span>{t("overview.crossplatform.conv", { n: data.facebook.conversions })}</span>
          </div>
        </div>

        {/* GG Card */}
        <div className={cn("rounded-lg p-3 border", isGgCheaper ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-100")}>
          <p className="text-xs font-bold text-slate-500 mb-1">Google Ads</p>
          <p className={cn("text-lg font-bold", isGgCheaper ? "text-emerald-700" : "text-slate-700")}>
            {data.google.cplKnown ? <>₫{Math.round(ggCpl/1000)}K</> : "—"} <span className="text-[10px] font-normal text-slate-500">{t("overview.crossplatform.perLead")}</span>
          </p>
           <div className="mt-2 text-[10px] text-slate-500 flex justify-between">
             <span>{t("overview.crossplatform.spend", { amount: Math.round(data.google.spend/1000000) })}</span>
             <span>{t("overview.crossplatform.conv", { n: data.google.conversions })}</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-100 p-3 flex gap-3 items-start">
         <Sparkles className="h-5 w-5 text-violet-500 shrink-0 mt-0.5" />
         <div>
            <p className="text-xs font-bold text-violet-900 mb-0.5">{t("overview.crossplatform.suggestion")}</p>
            <p className="text-xs text-violet-700 leading-snug">{data.recommendation}</p>
         </div>
      </div>
    </div>
  );
}
