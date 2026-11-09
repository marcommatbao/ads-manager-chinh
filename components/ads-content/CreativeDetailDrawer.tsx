"use client";

import Link from "next/link";
import { ExternalLink, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import FBAdPreview from "@/components/FBAdPreview";
import { CreativeTypeBadge } from "./CreativeTypeBadge";
import { CreativeStatusBadge } from "./CreativeStatusBadge";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { CreativeItem } from "@/types/creative-content.types";

function formatFullDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-bold tabular-nums text-slate-800">{value}</p>
    </div>
  );
}

interface CreativeDetailDrawerProps {
  item: CreativeItem | null;
  currency: string;
  onOpenChange: (open: boolean) => void;
}

export function CreativeDetailDrawer({ item, currency, onOpenChange }: CreativeDetailDrawerProps) {
  const intl = useIntlLocale();
  const t = useT();
  return (
    <Sheet open={Boolean(item)} onOpenChange={onOpenChange}>
      <SheetContent>
        {item && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2 pr-8">
                <CreativeTypeBadge platform={item.platform} />
                <CreativeStatusBadge status={item.status} />
                {item.badges.map((b) => (
                  <span
                    key={b}
                    className={
                      "rounded px-1.5 py-0.5 text-[10px] font-medium " +
                      (b.startsWith("🔴 Mệt") ? "bg-red-50 text-red-600" :
                       b.startsWith("😴") ? "bg-amber-50 text-amber-600" :
                       "bg-slate-100 text-slate-600")
                    }
                  >
                    {b}
                  </span>
                ))}
              </div>
              <SheetTitle>{item.name}</SheetTitle>
              <SheetDescription>{item.campaignName} · {item.company}</SheetDescription>
            </SheetHeader>

            <SheetBody className="flex flex-col gap-5">
              {item.platform === "facebook" ? (
                <FBAdPreview
                  primaryText={item.primaryText}
                  imageUrl={item.imageUrl ?? undefined}
                  headline={item.headline}
                  description={item.descriptions?.[0]}
                  cta={item.cta}
                  destinationUrl={item.finalUrl}
                />
              ) : (
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                  {item.headline && <p className="text-base font-semibold text-slate-800">{item.headline}</p>}
                  {item.primaryText && <p className="mt-1 text-sm text-slate-600">{item.primaryText}</p>}
                  {(item.descriptions ?? []).length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {item.descriptions!.map((d, i) => (
                        <li key={i} className="text-xs text-slate-500">• {d}</li>
                      ))}
                    </ul>
                  )}
                  {item.finalUrl && (
                    <p className="mt-3 truncate text-xs text-blue-600">{item.finalUrl}</p>
                  )}
                  {!item.assetAvailable && (
                    <p className="mt-3 text-xs italic text-amber-600">
                      {item.platform === "google_search"
                        ? t("creative.adsContent.drawer.searchNoImage")
                        : t("creative.adsContent.drawer.noImageAsset")}
                    </p>
                  )}
                </div>
              )}

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("creative.adsContent.drawer.metrics")}</p>
                {item.metrics.metricsAvailable ? (
                  <div className="grid grid-cols-2 gap-2">
                    <MetricTile label={t("creative.adsContent.drawer.spend")} value={formatCurrency(item.metrics.spend, currency, false, intl)} />
                    <MetricTile label={t("creative.adsContent.drawer.clicks")} value={formatNumber(item.metrics.clicks, intl)} />
                    {item.metrics.impressions !== undefined && (
                      <MetricTile label={t("creative.adsContent.drawer.impressions")} value={formatNumber(item.metrics.impressions, intl)} />
                    )}
                    {item.metrics.ctr !== undefined && (
                      <MetricTile label={t("creative.adsContent.drawer.ctr")} value={formatPercent(item.metrics.ctr)} />
                    )}
                    {item.isVideo && item.video?.hookRate !== undefined && (
                      <MetricTile label={t("creative.adsContent.drawer.hookRate")} value={formatPercent(item.video.hookRate)} />
                    )}
                    {item.isVideo && item.video?.holdRate !== undefined && (
                      <MetricTile label={t("creative.adsContent.drawer.holdRate")} value={formatPercent(item.video.holdRate)} />
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-700">
                    {t("creative.adsContent.drawer.pmaxNote")}
                    {" "}{t("creative.adsContent.drawer.pmaxNote2")}
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <MetricTile label={t("creative.adsContent.drawer.campaignSpend")} value={formatCurrency(item.metrics.spend, currency, false, intl)} />
                      <MetricTile label={t("creative.adsContent.drawer.campaignClicks")} value={formatNumber(item.metrics.clicks, intl)} />
                    </div>
                  </div>
                )}
                <p className="mt-2 text-xs text-slate-400">{t("creative.adsContent.drawer.lastActive", { date: formatFullDate(item.lastActiveDate) })}</p>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("creative.adsContent.drawer.campaign")}</p>
                <div className="rounded-lg border border-slate-100 px-3 py-2 text-xs text-slate-600">
                  <p><span className="text-slate-400">{t("creative.adsContent.drawer.name")}</span> {item.campaignName}</p>
                  {item.campaignObjective && <p><span className="text-slate-400">{t("creative.adsContent.drawer.objective")}</span> {item.campaignObjective}</p>}
                  {item.adGroupName && <p><span className="text-slate-400">{t("creative.adsContent.drawer.adGroup")}</span> {item.adGroupName}</p>}
                  <p><span className="text-slate-400">{t("creative.adsContent.drawer.campaignStatus")}</span> <CreativeStatusBadge status={item.campaignStatus} /></p>
                </div>
              </div>

              {item.fatigueDetail && (
                <div className={
                  item.fatigueDetail.severity === "critical"
                    ? "rounded-lg border border-red-200 bg-red-50 px-3 py-3"
                    : "rounded-lg border border-amber-200 bg-amber-50 px-3 py-3"
                }>
                  <p className={
                    "mb-1.5 text-xs font-semibold " +
                    (item.fatigueDetail.severity === "critical" ? "text-red-700" : "text-amber-700")
                  }>
                    {item.fatigueDetail.severity === "critical" ? t("creative.adsContent.drawer.fatigueCritical") : t("creative.adsContent.drawer.fatigueWarning")}
                  </p>
                  <ul className="space-y-1.5">
                    {item.fatigueDetail.issues.map((issue, i) => (
                      <li key={i} className="text-xs text-slate-600">
                        <span className="font-medium text-slate-700">{issue.message}</span>
                        <br />→ {issue.suggestion}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" render={<Link href={`/campaigns/${item.campaignId}`} />}>
                  <ExternalLink className="h-3.5 w-3.5" /> {t("creative.adsContent.drawer.openCampaign")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <Link
                      href={`/creative?ref=ads-content&company=${item.company}&objective=${encodeURIComponent(item.campaignObjective ?? "")}&product=${encodeURIComponent(item.campaignName)}`}
                    />
                  }
                >
                  <Sparkles className="h-3.5 w-3.5" /> {t("creative.adsContent.drawer.improve")}
                </Button>
              </div>
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
