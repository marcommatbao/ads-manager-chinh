"use client";

// ============================================================
// Giá thầu thủ công — đề xuất từ dữ liệu đã chạy
// ============================================================
// Bày kết quả của lib/google-manual-bid.ts và cho áp dụng có duyệt.
// Hai điều màn hình này CỐ Ý luôn nói ra, vì thiếu chúng là dễ đặt nhầm giá:
//   • chiến dịch đang chạy đấu thầu tự động thì đừng chuyển sang thủ công
//   • con số đề xuất luôn kèm KHOẢNG và mức tin cậy, không phải một số chắc nịch

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  Gauge, RefreshCw, AlertTriangle, Loader2, ChevronDown, Info,
  TrendingDown, TrendingUp, Minus, Ban, HelpCircle, Check,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/Toast";
import { cn } from "@/lib/utils";
import type { CampaignBidSummary, KeywordBidRec, BidVerdict } from "@/lib/google-manual-bid";
import { companyIds, orderedCompanyIds } from "@/lib/companies/registry";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

const fetcher = (url: string) => fetch(url).then(async (r) => {
  const j = await r.json();
  if (!r.ok || !j.success) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as { campaigns: CampaignBidSummary[]; warnings: string[]; generatedAt: string };
});

const fmtVnd = (n: number, loc: string) => `₫${Math.round(n).toLocaleString(loc)}`;

const VERDICT_META: Record<BidVerdict, { label: MessageKey; cls: string; Icon: typeof Minus }> = {
  giam:            { label: "google.manualBid.vReduce",        cls: "bg-red-50 text-red-700 border-red-200",         Icon: TrendingDown },
  tang:            { label: "google.manualBid.vRaise",     cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: TrendingUp },
  giu:             { label: "google.manualBid.vKeep",     cls: "bg-slate-50 text-slate-600 border-slate-200",   Icon: Minus },
  khong_dat_duoc:  { label: "google.manualBid.vUnreachable",  cls: "bg-amber-50 text-amber-700 border-amber-200",   Icon: Ban },
  thieu_du_lieu:   { label: "google.manualBid.vNoData",   cls: "bg-slate-50 text-slate-400 border-slate-200",   Icon: HelpCircle },
};

const CONFIDENCE_LABEL: Record<string, MessageKey> = {
  du: "google.manualBid.confEnough",
  tam: "google.manualBid.confTemp",
  thieu: "google.manualBid.confThin",
};

function KeywordRow({
  kw, checked, onToggle,
}: { kw: KeywordBidRec; checked: boolean; onToggle: () => void }) {
  const t = useT();
  const loc = useIntlLocale();
  const vnd = (n: number) => fmtVnd(n, loc);
  const [open, setOpen] = useState(false);
  const meta = VERDICT_META[kw.verdict];
  const selectable = kw.recommendedBid !== null && kw.verdict !== "giu";

  return (
    <div className="border-b border-slate-100 last:border-0">
      <div className="flex items-start gap-3 px-3 py-2.5">
        <div className="pt-0.5">
          <Checkbox checked={checked} onCheckedChange={onToggle} disabled={!selectable} />
        </div>

        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium text-slate-800">{kw.text}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{kw.matchType}</span>
            <span className={cn("flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium", meta.cls)}>
              <meta.Icon className="h-3 w-3" /> {t(meta.label)}
            </span>
            {kw.qualityScore !== null && (
              <span className={cn("rounded px-1.5 py-0.5 text-[10px]", kw.qualityScore <= 4 ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500")}>
                QS {kw.qualityScore}
              </span>
            )}
            <ChevronDown className={cn("h-3 w-3 text-slate-300 transition", open && "rotate-180")} />
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {t("google.manualBid.kwStats", { clicks: kw.clicks, conv: kw.conversions, cost: vnd(kw.cost), cpc: vnd(kw.avgCpc) })}
          </p>
          {open && (
            <div className="mt-1.5 rounded-md bg-slate-50 px-2 py-1.5">
              <p className="text-[11px] leading-relaxed text-slate-600">{kw.reason}</p>
              <p className="mt-1 text-[10px] text-slate-400">
                {t("google.manualBid.confidence", { level: t(CONFIDENCE_LABEL[kw.confidence]), cpa: vnd(kw.targetCpa) })}
                {kw.targetCpaSource === "noi_bo" ? t("google.manualBid.cpaInternal") : t("google.manualBid.cpaGoogle")}
                {kw.firstPageCpc !== null && t("google.manualBid.firstPage", { v: vnd(kw.firstPageCpc) })}
                {kw.topOfPageCpc !== null && t("google.manualBid.topOfPage", { v: vnd(kw.topOfPageCpc) })}
              </p>
            </div>
          )}
        </button>

        <div className="shrink-0 text-right">
          <p className="text-[10px] text-slate-400">{t("google.manualBid.currentBid")}</p>
          <p className="text-xs tabular-nums text-slate-600">{kw.currentBid > 0 ? vnd(kw.currentBid) : "—"}</p>
        </div>
        <div className="w-px self-stretch bg-slate-100" />
        <div className="shrink-0 text-right">
          <p className="text-[10px] text-slate-400">{t("google.manualBid.recommended")}</p>
          <p className={cn("text-xs font-bold tabular-nums", kw.recommendedBid === null ? "text-slate-300" : "text-slate-800")}>
            {kw.recommendedBid === null ? "—" : vnd(kw.recommendedBid)}
          </p>
          {kw.bidRange && kw.recommendedBid !== null && (
            <p className="text-[10px] text-slate-400">{vnd(kw.bidRange[0])}–{vnd(kw.bidRange[1])}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ManualBidPage() {
  const t = useT();
  const loc = useIntlLocale();
  const vnd = (n: number) => fmtVnd(n, loc);
  const { toast } = useToast();
  const [company, setCompany] = useState<string>(() => orderedCompanyIds(["MBC"])[0] ?? "MBC") // Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ);
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState<string | null>(null);

  const { data, error, isLoading, mutate, isValidating } = useSWR(
    `/api/google/manual-bid?company=${company}&days=${days}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const campaigns = useMemo(() => data?.campaigns ?? [], [data]);
  const totalOverspend = campaigns.reduce((s, c) => s + c.overspendPerMonth, 0);

  function toggle(rn: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rn)) next.delete(rn); else next.add(rn);
      return next;
    });
  }

  async function apply(camp: CampaignBidSummary, dryRun: boolean) {
    const rns = camp.keywords.filter((k) => selected.has(k.resourceName)).map((k) => k.resourceName);
    if (rns.length === 0) { toast({ title: t("google.manualBid.noneSelected") }); return; }
    setApplying(camp.campaignId);
    try {
      const res = await fetch("/api/google/manual-bid/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, days, campaignId: camp.campaignId, resourceNames: rns, dryRun }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? `HTTP ${res.status}`);
      if (dryRun) {
        const lines = (j.preview ?? []).slice(0, 5).map((p: { keyword: string; from: number; to: number }) => `${p.keyword}: ${vnd(p.from)} → ${vnd(p.to)}`);
        toast({ title: t("google.manualBid.previewToast", { n: j.preview?.length ?? 0 }) + (lines.length ? " · " + lines.join(" · ") : "") });
      } else {
        toast({ title: t("google.manualBid.appliedToast", { n: j.applied }) });
        setSelected(new Set());
        mutate();
      }
      if (j.skipped?.length) {
        toast({ title: t("google.manualBid.skippedToast", { n: j.skipped.length, list: j.skipped.slice(0, 3).map((s: { keyword: string; why: string }) => `${s.keyword} (${s.why})`).join("; ") }) });
      }
      (j.warnings ?? []).forEach((w: string) => toast({ title: `⚠️ ${w}` }));
    } catch (err) {
      toast({ title: `❌ ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setApplying(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-indigo-100 p-2"><Gauge className="h-5 w-5 text-indigo-600" /></div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">{t("google.manualBid.title")}</h1>
            <p className="text-xs text-slate-400">{t("google.manualBid.subtitle")}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {companyIds().map((c) => (
            <button key={c} onClick={() => { setCompany(c); setSelected(new Set()); }}
              className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium",
                company === c ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500")}>
              {c}
            </button>
          ))}
          <select value={days} onChange={(e) => { setDays(Number(e.target.value)); setSelected(new Set()); }}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600">
            <option value={14}>{t("google.manualBid.days", { n: 14 })}</option>
            <option value={30}>{t("google.manualBid.days", { n: 30 })}</option>
            <option value={60}>{t("google.manualBid.days", { n: 60 })}</option>
            <option value={90}>{t("google.manualBid.days", { n: 90 })}</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => mutate()} disabled={isValidating}>
            <RefreshCw className={cn("h-3.5 w-3.5", isValidating && "animate-spin")} /> {t("google.manualBid.refresh")}
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
        <div>
          <p><strong>{t("google.manualBid.howLabel")}</strong> {t("google.manualBid.how1")} <strong>{t("google.manualBid.ceilingLabel")}</strong> {t("google.manualBid.how2")} <strong>{t("google.manualBid.floorLabel")}</strong> {t("google.manualBid.how3")}</p>
          <p className="mt-1"><strong>{t("google.manualBid.overLabel")}</strong> {t("google.manualBid.over1")}</p>
        </div>
      </div>

      {campaigns.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-6 py-4">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{t("google.manualBid.kpiCampaigns")}</p>
              <p className="text-xl font-bold text-slate-800">{campaigns.length}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{t("google.manualBid.kpiOverspend")}</p>
              <p className="text-xl font-bold text-red-600">{vnd(totalOverspend)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{t("google.manualBid.kpiReduce")}</p>
              <p className="text-xl font-bold text-slate-800">{campaigns.reduce((s, c) => s + c.countGiam, 0)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{t("google.manualBid.kpiManual")}</p>
              <p className="text-xl font-bold text-slate-800">{campaigns.filter((c) => c.isManualCpc).length}/{campaigns.length}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && <p className="flex items-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> {t("google.manualBid.loading")}</p>}

      {error && (
        <EmptyState icon={AlertTriangle} title={t("google.manualBid.loadFailed")}
          description={error instanceof Error ? error.message : String(error)} />
      )}

      {data?.warnings?.map((w, i) => (
        <p key={i} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}
        </p>
      ))}

      {!isLoading && !error && campaigns.length === 0 && (
        <EmptyState icon={Gauge} title={t("google.manualBid.emptyTitle")}
          description={t("google.manualBid.emptyDesc")} />
      )}

      {campaigns.map((camp) => {
        const selectedHere = camp.keywords.filter((k) => selected.has(k.resourceName)).length;
        return (
          <Card key={camp.campaignId}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-sm">{camp.campaignName}</CardTitle>
                <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium",
                  camp.isManualCpc ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-slate-50 text-slate-500")}>
                  {camp.biddingStrategy}
                </span>
                {camp.overspendPerMonth > 0 && (
                  <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                    {t("google.manualBid.overBy", { amount: vnd(camp.overspendPerMonth) })}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                {t("google.manualBid.campStats", { days: camp.days, clicks: camp.clicks, conv: camp.conversions.toFixed(0), cost: vnd(camp.cost) })} ·
                {" "}{t("google.manualBid.campVerdicts", { reduce: camp.countGiam, raise: camp.countTang, keep: camp.countGiu })}
                {camp.countKhongDatDuoc > 0 && t("google.manualBid.campUnreachable", { n: camp.countKhongDatDuoc })}
                {camp.countThieuDuLieu > 0 && t("google.manualBid.campNoData", { n: camp.countThieuDuLieu })}
              </p>
            </CardHeader>
            <CardContent className="pt-0">
              {camp.gateNote && (
                <p className={cn("mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed",
                  camp.gateNote.includes("ĐỪNG") ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800")}>
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{camp.gateNote}
                </p>
              )}

              <div className="rounded-lg border border-slate-100">
                {camp.keywords.slice(0, 40).map((kw) => (
                  <KeywordRow key={kw.resourceName} kw={kw}
                    checked={selected.has(kw.resourceName)} onToggle={() => toggle(kw.resourceName)} />
                ))}
              </div>
              {camp.keywords.length > 40 && (
                <p className="mt-1 text-[11px] text-slate-400">{t("google.manualBid.showing", { total: camp.keywords.length })}</p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">{t("google.manualBid.selectedCount", { n: selectedHere })}</span>
                <div className="ml-auto flex gap-2">
                  <Button variant="outline" size="sm" disabled={selectedHere === 0 || applying === camp.campaignId}
                    onClick={() => apply(camp, true)}>
                    {applying === camp.campaignId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Info className="h-3.5 w-3.5" />} {t("google.manualBid.preview")}
                  </Button>
                  <Button variant="default" size="sm"
                    disabled={selectedHere === 0 || !camp.canApply || applying === camp.campaignId}
                    title={!camp.canApply ? t("google.manualBid.cannotApply", { strategy: camp.biddingStrategy }) : undefined}
                    onClick={() => {
                      if (!confirm(t("google.manualBid.confirmApply", { n: selectedHere, name: camp.campaignName }))) return;
                      apply(camp, false);
                    }}>
                    {applying === camp.campaignId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {t("google.manualBid.applyToGoogle")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
