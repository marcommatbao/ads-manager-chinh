"use client";

import { useState, useEffect } from "react";
import { formatCurrency } from "@/lib/utils";
import { Loader2, Target, ArrowRight, CheckCircle2, AlertTriangle, Sparkles } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";

interface RootCauseAnalysis {
  likely_causes: string[];
  suggested_actions: string[];
  budget_constrained: boolean;
  ai_generated: boolean;
}

export function CplDashboardWidget() {
  const intl = useIntlLocale();
  const t = useT();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [rootCause, setRootCause] = useState<Record<string, RootCauseAnalysis>>({});
  const [rootCauseLoading, setRootCauseLoading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggleRootCause = async (campaignId: string) => {
    if (expanded === campaignId) { setExpanded(null); return; }
    setExpanded(campaignId);
    if (rootCause[campaignId]) return;
    setRootCauseLoading(campaignId);
    try {
      const res = await fetch(`/api/cpl/root-cause?campaign_id=${encodeURIComponent(campaignId)}`);
      const json = await res.json();
      if (json.success) setRootCause((prev) => ({ ...prev, [campaignId]: json.data }));
    } catch {
      /* ignore — inline "Vì sao?" is a convenience, not critical path */
    } finally {
      setRootCauseLoading(null);
    }
  };

  useEffect(() => {
    const d = new Date();
    const currentMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    
    fetch(`/api/cpl?month=${currentMonth}`)
      .then(r => r.json())
      .then(json => {
        if (json.success) setData(json.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm h-32 animate-pulse flex items-center justify-center">
        <Loader2 className="h-6 w-6 text-slate-300 animate-spin" />
      </div>
    );
  }

  if (data.length === 0) return null;

  const valid = data.filter(d => d.cpl_data.cpl !== null && d.cpl_data.cpl > 0);
  const good = valid.filter(d => d.badge.level === "good").sort((a,b) => a.cpl_data.cpl - b.cpl_data.cpl).slice(0, 2);
  const critical = valid.filter(d => d.badge.level === "critical").sort((a,b) => b.cpl_data.cpl - a.cpl_data.cpl).slice(0, 2);

  const missingMbiOffline = valid.some(d => d.company === "MBI" && d.cpl_data.offlineOrders === 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col h-full">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          {t("panels.cpl.title")}
        </h3>
        <Link
          href="/cpl"
          className="text-[11px] font-semibold text-amber-700 hover:text-amber-800 flex items-center gap-0.5"
        >
          {t("panels.cpl.detail")} <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="px-5 pb-5 space-y-3 flex-1">
        {missingMbiOffline && (
          <div className="bg-violet-50 border border-violet-200 p-2.5 rounded-lg flex items-start gap-2 text-xs">
            <Target className="h-4 w-4 text-violet-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold text-violet-800">{t("panels.cpl.offlineTitle")}</span>
              <p className="text-violet-600 mt-0.5 leading-tight">{t("panels.cpl.offlineDesc")}</p>
            </div>
            <Link href="/cpl"><span className="text-violet-700 bg-violet-100 font-bold px-2 py-1 rounded text-[10px] whitespace-nowrap">{t("panels.cpl.enterNow")}</span></Link>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 h-full">
          {/* Top 2 Good */}
          <div className="space-y-2">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t("panels.cpl.best")}</h4>
            {good.length > 0 ? good.map(c => (
              <div key={c.campaign_id} className="bg-emerald-50/50 border border-emerald-100 rounded p-2">
                <p className="text-[10px] font-semibold text-slate-700 truncate" title={c.campaign_name}>{c.campaign_name}</p>
                <p className="text-lg font-bold text-emerald-700 leading-tight">{formatCurrency(c.cpl_data.cpl, "VND", false, intl)}</p>
              </div>
            )) : <p className="text-xs text-slate-400">{t("panels.cpl.none")}</p>}
          </div>

          {/* Top 2 Critical */}
          <div className="space-y-2">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t("panels.cpl.worst")}</h4>
            {critical.length > 0 ? critical.map(c => (
              <div key={c.campaign_id} className="bg-red-50/50 border border-red-100 rounded p-2">
                 <p className="text-[10px] font-semibold text-slate-700 truncate" title={c.campaign_name}>{c.campaign_name}</p>
                 <p className="text-lg font-bold text-red-700 leading-tight">{formatCurrency(c.cpl_data.cpl, "VND", false, intl)}</p>
                 <button
                   onClick={() => toggleRootCause(c.campaign_id)}
                   className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-0.5 mt-1"
                 >
                   {rootCauseLoading === c.campaign_id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
                   {expanded === c.campaign_id ? t("panels.cpl.hide") : t("panels.cpl.why")}
                 </button>
                 {expanded === c.campaign_id && rootCause[c.campaign_id] && (
                   <div className="mt-1.5 text-[10px] text-indigo-800 bg-indigo-50 border border-indigo-100 rounded p-1.5 space-y-1">
                     <ul className="list-disc list-inside space-y-0.5">
                       {rootCause[c.campaign_id].likely_causes.slice(0, 2).map((cause, i) => <li key={i}>{cause}</li>)}
                     </ul>
                   </div>
                 )}
              </div>
            )) : <p className="text-[10px] text-emerald-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> {t("panels.cpl.allSafe")}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
