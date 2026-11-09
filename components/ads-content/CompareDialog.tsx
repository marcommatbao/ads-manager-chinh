"use client";

// ============================================================
// So sánh 2 creative — bản đối đầu đầy đủ
// ============================================================
// Bản trước chỉ đặt cạnh nhau Spend và Clicks, tức là gần như không trả lời
// được câu hỏi duy nhất người ta mở nó ra để hỏi: "video nào ăn hơn?". Bản
// này gọi /api/campaigns/ads-content/compare để lấy số liệu TRỌN VÒNG ĐỜI
// của từng ad (nên hai video chạy lệch tháng vẫn so được), rồi hiển thị:
//   • kết luận tổng, kèm mức độ tin cậy — hoặc nói thẳng là chưa đủ dữ liệu
//   • từng chỉ số, đánh dấu bên thắng, có giải thích chỉ số đó nghĩa là gì
//   • mức độ so sánh được: khác mục tiêu / khác tệp / khác thời điểm…
//
// Nguyên tắc: không bao giờ trao phần thắng cho một chênh lệch chưa đạt mức
// tin cậy 90%. Một video hơn 20% trên mẫu nhỏ vẫn chỉ là ngẫu nhiên.

import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle, Loader2, Trophy, Minus, CircleHelp, ChevronDown, Lightbulb, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CreativeTypeBadge } from "./CreativeTypeBadge";
import { CreativeStatusBadge } from "./CreativeStatusBadge";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { CreativeItem } from "@/types/creative-content.types";
import type { CompareResult, CompareSide, MetricVerdict, ComparabilityLevel } from "@/lib/creative-compare";

const fetcher = async ([url, ids, level]: [string, string[], string]): Promise<CompareResult> => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, level }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.data as CompareResult;
};

function formatValue(v: number | null, unit: MetricVerdict["unit"], currency: string, loc: string): string {
  if (v === null) return "—";
  switch (unit) {
    case "percent": return `${v.toFixed(2)}%`;
    case "currency": return formatCurrency(v, currency, false, loc);
    case "ratio": return `${v.toFixed(2)}x`;
    case "seconds": return `${v.toFixed(1)}s`;
  }
}

const LEVEL_STYLE: Record<ComparabilityLevel, { dot: string; text: string }> = {
  ok:      { dot: "bg-emerald-500", text: "text-slate-600" },
  warn:    { dot: "bg-amber-500",   text: "text-amber-700" },
  blocked: { dot: "bg-red-500",     text: "text-red-700" },
};

function SideHeader({ item, side, label }: { item: CreativeItem; side: CompareSide | null; label: string }) {
  const intl = useIntlLocale();
  const t = useT();
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <CreativeTypeBadge platform={item.platform} />
        <CreativeStatusBadge status={item.status} />
        {side?.isVideo && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">{t("creative.adsContent.compare.video")}</span>}
      </div>
      <p className="mt-1.5 truncate text-sm font-semibold text-slate-800" title={side?.adName ?? item.name}>
        {side?.adName ?? item.name}
      </p>
      <p className="truncate text-[11px] text-slate-400" title={side?.campaignName ?? item.campaignName}>
        {side?.campaignName ?? item.campaignName}
      </p>
      {side?.window && (
        <p className="mt-1 text-[11px] text-slate-500">
          {t("creative.adsContent.compare.window", { from: side.window.from, to: side.window.to, days: side.window.days })}
        </p>
      )}
      {side && (
        <p className="text-[11px] text-slate-500">
          {t("creative.adsContent.compare.spent", { spend: formatCurrency(side.metrics.spend, "VND", false, intl), impressions: formatNumber(side.metrics.impressions, intl), conversions: side.metrics.conversions })}
        </p>
      )}
      {side?.level === "campaign" && (
        <p className="text-[11px] text-slate-500">
          {t("creative.adsContent.compare.campaignScope", { ads: side.adCount ?? 0, videos: side.videoCount ?? 0 })}
          {(side.videoCount ?? 0) > 1 && <span className="text-amber-700">{t("creative.adsContent.compare.campaignScopeWarn")}</span>}
        </p>
      )}
    </div>
  );
}

function VerdictRow({ v, currency }: { v: MetricVerdict; currency: string }) {
  const intl = useIntlLocale();
  const t = useT();
  const [open, setOpen] = useState(false);
  const aWins = v.winner === "a";
  const bWins = v.winner === "b";

  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium text-slate-700">{v.label}</span>
          <ChevronDown className={cn("h-3 w-3 shrink-0 text-slate-300 transition", open && "rotate-180")} />
        </span>
        <span className={cn(
          "flex items-center justify-end gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs tabular-nums",
          aWins ? "bg-emerald-50 font-bold text-emerald-700" : "text-slate-600"
        )}>
          {aWins && <Trophy className="h-3 w-3" />}
          {formatValue(v.aValue, v.unit, currency, intl)}
        </span>
        <span className={cn(
          "flex items-center justify-end gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs tabular-nums",
          bWins ? "bg-emerald-50 font-bold text-emerald-700" : "text-slate-600"
        )}>
          {bWins && <Trophy className="h-3 w-3" />}
          {formatValue(v.bValue, v.unit, currency, intl)}
        </span>
      </button>

      <div className="px-3 pb-2 -mt-1">
        {v.winner === "unknown" && (
          <p className="flex items-start gap-1 text-[11px] text-amber-700">
            <CircleHelp className="mt-0.5 h-3 w-3 shrink-0" />
            {v.insufficientReason ?? t("creative.adsContent.compare.insufficient")}
          </p>
        )}
        {v.winner === "tie" && (
          <p className="flex items-center gap-1 text-[11px] text-slate-500"><Minus className="h-3 w-3" /> {t("creative.adsContent.compare.tie")}</p>
        )}
        {(aWins || bWins) && (
          <p className="text-[11px] text-emerald-700">
            {v.deltaPercent !== null ? t("creative.adsContent.compare.betterBy", { side: aWins ? "A" : "B", pct: `${v.deltaPercent.toFixed(0)}%` }) : t("creative.adsContent.compare.better", { side: aWins ? "A" : "B" })}
            {v.confidence !== null ? t("creative.adsContent.compare.confidence", { n: v.confidence }) : t("creative.adsContent.compare.noTest")}
          </p>
        )}
        {open && <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{v.meaning}</p>}
      </div>
    </div>
  );
}

interface CompareDialogProps {
  items: [CreativeItem, CreativeItem] | null;
  currency: string;
  onOpenChange: (open: boolean) => void;
}

export function CompareDialog({ items, currency, onOpenChange }: CompareDialogProps) {
  const t = useT();
  // Cấp so sánh: "creative" = đúng hai ad đã chọn; "campaign" = gộp cả chiến
  // dịch chứa chúng. Cùng một cặp đã chọn, chỉ đổi góc nhìn — nên đặt ngay
  // trong bảng thay vì bắt quay ra chọn lại.
  const [level, setLevel] = useState<"creative" | "campaign">("creative");
  const bothFacebook = items ? items.every((i) => i.platform === "facebook") : false;
  const sameCampaign = items ? items[0].campaignId === items[1].campaignId : false;

  const ids = items && bothFacebook
    ? level === "campaign"
      ? [items[0].campaignId, items[1].campaignId]
      : [items[0].nativeId, items[1].nativeId]
    : null;

  const { data, error, isLoading } = useSWR<CompareResult>(
    ids ? (["/api/campaigns/ads-content/compare", ids, level] as [string, string[], string]) : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  return (
    <Dialog open={Boolean(items)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("creative.adsContent.compare.title")}</DialogTitle>
        </DialogHeader>

        {items && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {(["creative", "campaign"] as const).map((lv) => (
                <button
                  key={lv}
                  type="button"
                  onClick={() => setLevel(lv)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                    level === lv
                      ? "border-amber-400 bg-amber-50 text-amber-800"
                      : "border-slate-200 text-slate-500 hover:border-slate-300"
                  )}
                >
                  {lv === "creative" ? t("creative.adsContent.compare.levelCreative") : t("creative.adsContent.compare.levelCampaign")}
                </button>
              ))}
              {level === "campaign" && sameCampaign && (
                <span className="text-[11px] text-amber-700">
                  {t("creative.adsContent.compare.sameCampaign")}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <SideHeader item={items[0]} side={data?.a ?? null} label={level === "campaign" ? t("creative.adsContent.compare.sideACampaign") : "A"} />
              <div className="hidden w-px bg-slate-100 sm:block" />
              <SideHeader item={items[1]} side={data?.b ?? null} label={level === "campaign" ? t("creative.adsContent.compare.sideBCampaign") : "B"} />
            </div>

            {!bothFacebook && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("creative.adsContent.compare.facebookOnly")}
              </p>
            )}

            {isLoading && (
              <p className="flex items-center gap-2 py-6 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("creative.adsContent.compare.loading")}
              </p>
            )}

            {error && (
              <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("creative.adsContent.compare.error", { message: error instanceof Error ? error.message : String(error) })}
              </p>
            )}

            {data && (
              <>
                <div className={cn(
                  "rounded-lg border px-3 py-2.5 text-sm",
                  data.comparabilityLevel === "blocked" ? "border-red-200 bg-red-50 text-red-800"
                    : data.decidedBy ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-amber-200 bg-amber-50 text-amber-900"
                )}>
                  <p className="font-semibold">{t("creative.adsContent.compare.conclusion")}</p>
                  <p className="mt-0.5 leading-relaxed">{data.summary}</p>
                </div>

                <div className="rounded-lg border border-slate-100">
                  <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    <span>{t("creative.adsContent.compare.metric")}</span>
                    <span className="text-right">A</span>
                    <span className="text-right">B</span>
                  </div>
                  {data.verdicts.map((v) => <VerdictRow key={v.key} v={v} currency={currency} />)}
                </div>

                {data.narrative?.text && (
                  <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2.5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-800">
                      <Sparkles className="h-3.5 w-3.5" /> {t("creative.adsContent.compare.narrative")}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-violet-900">{data.narrative.text}</p>
                    <p className="mt-1.5 text-[10px] text-violet-500">
                      {t("creative.adsContent.compare.narrativeNote")}
                    </p>
                  </div>
                )}
                {data.narrative && !data.narrative.text && data.narrative.note && (
                  <p className="text-[11px] text-slate-400">{t("creative.adsContent.compare.noNarrative", { note: data.narrative.note })}</p>
                )}

                {data.recommendations.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                      <Lightbulb className="h-3.5 w-3.5 text-amber-500" /> {t("creative.adsContent.compare.nextSteps")}
                    </p>
                    <div className="flex flex-col gap-2">
                      {data.recommendations.map((r, i) => (
                        <div key={r.key} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                          <p className="text-xs font-semibold text-slate-800">
                            {i + 1}. {r.title}
                          </p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                            <span className="font-medium text-slate-600">{t("creative.adsContent.compare.why")}</span>{r.evidence}
                          </p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-emerald-800">
                            <span className="font-medium">{t("creative.adsContent.compare.action")}</span>{r.action}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="mb-1.5 text-xs font-semibold text-slate-700">{t("creative.adsContent.compare.comparability")}</p>
                  <div className="flex flex-col gap-1.5">
                    {data.comparability.map((c) => (
                      <div key={c.key} className="flex items-start gap-2 text-[11px]">
                        <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", LEVEL_STYLE[c.level].dot)} />
                        <span className={LEVEL_STYLE[c.level].text}>
                          <span className="font-medium">{c.label}:</span> {c.detail}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {data.warnings.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                    {data.warnings.map((w, i) => <p key={i}>{w}</p>)}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
