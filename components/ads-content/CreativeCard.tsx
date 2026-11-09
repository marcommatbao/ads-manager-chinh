"use client";

import Link from "next/link";
import { ImageOff, Eye, ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CreativeTypeBadge } from "./CreativeTypeBadge";
import { CreativeStatusBadge } from "./CreativeStatusBadge";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { CreativeItem } from "@/types/creative-content.types";

function formatShortDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

interface CreativeCardProps {
  item: CreativeItem;
  currency: string;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onViewDetail: (item: CreativeItem) => void;
}

export function CreativeCard({ item, currency, selected, onToggleSelect, onViewDetail }: CreativeCardProps) {
  const intl = useIntlLocale();
  const t = useT();
  const preview = item.primaryText || (item.descriptions ?? []).join(" · ") || t("creative.adsContent.card.noPreview");

  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border bg-white p-3 transition-colors",
        selected ? "border-blue-300 bg-blue-50/40" : "border-slate-100 hover:border-slate-200"
      )}
    >
      <div className="flex shrink-0 items-start pt-1">
        <Checkbox checked={selected} onCheckedChange={() => onToggleSelect(item.id)} />
      </div>

      <button
        type="button"
        onClick={() => onViewDetail(item)}
        className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-100 bg-slate-50"
      >
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt={item.headline || item.name} className="h-full w-full object-cover" />
        ) : item.platform === "google_search" ? (
          <span className="text-[9px] font-semibold text-slate-300">{t("creative.adsContent.card.textBadge")}</span>
        ) : (
          <ImageOff className="h-5 w-5 text-slate-300" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <CreativeTypeBadge platform={item.platform} />
          <CreativeStatusBadge status={item.status} />
          {/* Google Search (RSA) ads are text-only by design — no image
              slot exists at all, so "assetAvailable=false" there isn't a
              missing-asset problem to flag, unlike Facebook/PMax where it
              means a real creative gap. Showing the warning for every
              single Search ad (confirmed live 2026-07-31 — 100% of rows on
              /campaigns/ads-content) was pure noise, not a bug report. */}
          {!item.assetAvailable && item.platform !== "google_search" && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
              {item.metrics.metricsAvailable ? t("creative.adsContent.card.noImage") : t("creative.adsContent.card.campaignLevelMetrics")}
            </span>
          )}
          {item.badges.map((b) => {
            const isFatigueCritical = b.startsWith("🔴 Mệt");
            const isFatigueWarning = b.startsWith("😴");
            return (
              <span
                key={b}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium",
                  isFatigueCritical ? "bg-red-50 text-red-600" :
                  isFatigueWarning ? "bg-amber-50 text-amber-600" :
                  "bg-slate-100 text-slate-600"
                )}
              >
                {b}
              </span>
            );
          })}
        </div>

        <button type="button" onClick={() => onViewDetail(item)} className="mt-1 block text-left">
          <p className="truncate text-sm font-semibold text-slate-800">{item.name}</p>
          {item.headline && <p className="truncate text-xs text-slate-500">{item.headline}</p>}
          <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{preview}</p>
        </button>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          {item.metrics.metricsAvailable ? (
            <>
              <span className="font-medium text-slate-700">{formatCurrency(item.metrics.spend, currency, false, intl)}</span>
              <span>{t("creative.adsContent.card.clicks", { n: formatNumber(item.metrics.clicks, intl) })}</span>
            </>
          ) : (
            <span className="italic text-slate-400">{t("creative.adsContent.card.campaignLevelSpend")}</span>
          )}
          {item.isVideo && item.video && (
            <>
              {item.video.hookRate !== undefined && (
                <span>{t("creative.adsContent.card.hook")} <span className="font-medium text-slate-700">{item.video.hookRate.toFixed(1)}%</span></span>
              )}
              {item.video.holdRate !== undefined && (
                <span>{t("creative.adsContent.card.hold")} <span className="font-medium text-slate-700">{item.video.holdRate.toFixed(1)}%</span></span>
              )}
            </>
          )}
          <span>{t("creative.adsContent.card.lastActive", { date: formatShortDate(item.lastActiveDate) })}</span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="xs" onClick={() => onViewDetail(item)}>
            <Eye className="h-3.5 w-3.5" /> {t("creative.adsContent.card.detail")}
          </Button>
          <Button variant="ghost" size="xs" render={<Link href={`/campaigns/${item.campaignId}`} />}>
            <ExternalLink className="h-3.5 w-3.5" /> {t("creative.adsContent.card.campaign")}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            render={
              <Link
                href={`/creative?ref=ads-content&company=${item.company}&objective=${encodeURIComponent(item.campaignObjective ?? "")}&product=${encodeURIComponent(item.campaignName)}`}
              />
            }
          >
            <Sparkles className="h-3.5 w-3.5" /> {t("creative.adsContent.card.improve")}
          </Button>
        </div>
      </div>
    </div>
  );
}
