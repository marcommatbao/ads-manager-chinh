"use client";

import { companyIds, companyLabel } from "@/lib/companies/registry";
import { cn, formatNumber } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { CreativeItem } from "@/types/creative-content.types";

interface SummaryTileProps {
  label: string;
  value: string;
  isLoading?: boolean;
}

function SummaryTile({ label, value, isLoading }: SummaryTileProps) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm flex flex-col gap-1 min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 truncate">{label}</p>
      {isLoading ? (
        <div className="h-5 w-16 animate-pulse rounded bg-slate-100" />
      ) : (
        <p className="text-base font-bold leading-tight tabular-nums text-slate-800 truncate">{value}</p>
      )}
    </div>
  );
}

export function SummaryStrip({ items, isLoading }: { items: CreativeItem[]; isLoading?: boolean }) {
  const intl = useIntlLocale();
  const t = useT();
  const activeCampaigns = new Set(items.map((i) => i.campaignId)).size;
  const totalCreatives = items.length;
  const facebookCount = items.filter((i) => i.platform === "facebook").length;
  const googleCount = items.filter((i) => i.platform === "google_search" || i.platform === "google_pmax").length;
  // Đợt 21: một ô / công ty của bản cài (trước đây ghim MBC + MBI → bản khách hiện 0 / 0). Bản Mắt Bão: cùng 2 ô MBC, MBI.
  const perCompany = companyIds().map((co) => ({ co, n: items.filter((i) => i.company === co).length }));

  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6")}>
      <SummaryTile label={t("creative.adsContent.summary.activeCampaigns")} value={formatNumber(activeCampaigns, intl)} isLoading={isLoading} />
      <SummaryTile label={t("creative.adsContent.summary.totalCreatives")} value={formatNumber(totalCreatives, intl)} isLoading={isLoading} />
      <SummaryTile label="Facebook" value={formatNumber(facebookCount, intl)} isLoading={isLoading} />
      <SummaryTile label={t("creative.adsContent.summary.google")} value={formatNumber(googleCount, intl)} isLoading={isLoading} />
      {perCompany.map(({ co, n }) => (
        <SummaryTile key={co} label={co === "MBC" || co === "MBI" ? co : companyLabel(co)} value={formatNumber(n, intl)} isLoading={isLoading} />
      ))}
    </div>
  );
}
