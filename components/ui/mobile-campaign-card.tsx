"use client";

import { useMemo } from "react";
import type { Campaign } from "@/types/ads.types";
import { detectCompany } from "@/store/useAdsStore";
import { 
  fmtCurrency, 
  fmtSpend, 
  fmtNumber, 
  getCampaignHealthBadge, 
  StatusBadge 
} from "@/components/CampaignTable";
import PlatformBadge from "@/components/PlatformBadge";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { BarChart2, Edit2, MoreHorizontal } from "lucide-react";

interface MobileCampaignCardProps {
  campaign: Campaign;
  currency: string;
  onViewDetails: (id: string, platform: string) => void;
  onEditBudget: (campaign: Campaign) => void;
}

export function MobileCampaignCard({ campaign, currency, onViewDetails, onEditBudget }: MobileCampaignCardProps) {
  const t = useT();
  const c = campaign;
  const m = c.metrics;
  const company = c.company ?? detectCompany(c.name, c.accountName);

  const spend = m?.spend ?? 0;
  const leads = m?.conversions ?? 0;
  const ctr = m?.ctr ?? 0;
  const cpc = m?.cpc ?? 0;
  const cpl = leads > 0 ? spend / leads : 0;

  const health = useMemo(() => getCampaignHealthBadge(c), [c]);

  // Health indicator emoji
  const healthEmoji = health.level === "good" ? "🟢" : 
                      health.level === "warning" ? "🟡" : 
                      health.level === "critical" ? "🔴" : 
                      health.level === "learning" ? "🎓" : "🔵";

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden mb-3">
      {/* Header section */}
      <div className="p-4 pb-3 border-b border-slate-100">
        <div className="flex items-center justify-between mb-2">
          {/* Top row: Company | Status | Health Label */}
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-bold tracking-wide",
                company === "MBC"
                  ? "bg-blue-100 text-blue-700"
                  : company === "MBI"
                  ? "bg-violet-100 text-violet-700"
                  : "bg-slate-100 text-slate-700"
              )}
            >
              {company === "MBC" ? "🔵 " : company === "MBI" ? "🟣 " : ""}
              {company}
            </span>
            <StatusBadge status={c.status} />
          </div>
          <span className="text-xs font-medium text-slate-500 bg-slate-50 px-2 py-0.5 rounded">
            {health.label}
          </span>
        </div>
        
        {/* Campaign Name & Platform */}
        <h3 className="text-[15px] font-semibold text-slate-800 line-clamp-2 leading-tight mb-2">
          {c.name}
        </h3>
        <PlatformBadge platform={c.platform} />
      </div>

      {/* Metrics section */}
      <div className="p-4 py-3 bg-slate-50/50">
        <div className="grid grid-cols-3 gap-y-3 gap-x-2 text-sm">
          {/* Row 1 */}
          <div>
            <p className="text-[11px] font-medium text-slate-400 mb-0.5">{t("creative.ui.spend")}</p>
            <p className="font-semibold text-slate-700">{fmtSpend(spend, currency)}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-400 mb-0.5">{t("creative.ui.ctr")}</p>
            <p className="font-semibold text-slate-700">{ctr.toFixed(2)}%</p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-400 mb-0.5">{t("creative.ui.cpc")}</p>
            <p className="font-semibold text-slate-700">{fmtCurrency(cpc, currency)}</p>
          </div>

          {/* Row 2 */}
          <div>
            <p className="text-[11px] font-medium text-slate-400 mb-0.5">{t("creative.ui.leads")}</p>
            <p className="font-semibold text-slate-700">{fmtNumber(leads)}</p>
          </div>
          <div className="col-span-2">
            <p className="text-[11px] font-medium text-slate-400 mb-0.5">{t("creative.ui.cpl")}</p>
            <p className="font-semibold text-slate-700">
              {healthEmoji} {fmtCurrency(cpl, currency)}
            </p>
          </div>
        </div>
      </div>

      {/* Actions footer */}
      <div className="flex items-center p-2 border-t border-slate-100 gap-2">
        <button
          onClick={() => onViewDetails(c.id, c.platform)}
          className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg bg-amber-50 text-amber-700 text-[13px] font-medium hover:bg-amber-100 transition-colors"
        >
          <BarChart2 className="w-4 h-4" /> {t("creative.ui.details")}
        </button>
        <button
          onClick={() => onEditBudget(c)}
          className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg border border-slate-200 text-slate-600 text-[13px] font-medium hover:bg-slate-50 transition-colors"
        >
          <Edit2 className="w-4 h-4" /> {t("creative.ui.budget")}
        </button>
        <button
          className="flex items-center justify-center w-9 h-9 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors ml-auto shrink-0"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
