// ============================================================
// Bước 1 — Phân tích: chiến dịch đang ở đâu, cấu hình hiện tại ra sao.
// ============================================================
"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { vnd, num, pct, ddmmyyyy } from "./format";
import { metaObjectiveLabel } from "./meta-copy";
import type { CampaignCase } from "@/lib/case/store";
import { metaGoalKind, metaResults } from "@/lib/case/goal-kind";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

const BIDDING_LABEL: Record<string, MessageKey> = {
  MAXIMIZE_CONVERSIONS: "overview.step1.bidding.MAXIMIZE_CONVERSIONS",
  TARGET_CPA: "overview.step1.bidding.TARGET_CPA",
  MAXIMIZE_CONVERSION_VALUE: "overview.step1.bidding.MAXIMIZE_CONVERSION_VALUE",
  TARGET_ROAS: "overview.step1.bidding.TARGET_ROAS",
  MANUAL_CPC: "overview.step1.bidding.MANUAL_CPC",
};

export function Step1Analysis({ c, onNext, busy }: { c: CampaignCase; onNext: () => void; busy?: boolean }) {
  const intl = useIntlLocale();
  const t = useT();
  const ev = c.evidence;
  if (!ev) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title={t("overview.step1.noEvidence.title")}
        description={t("overview.step1.noEvidence.desc")}
      />
    );
  }

  if (ev.kind === "meta") {
    const camp = ev.campaign;
    // Đợt 23 (3d): chiến dịch thu lead hiện lead / chi phí mỗi lead thay cho lượt mua.
    const leads = metaGoalKind(camp.objective) === "leads";
    const results = metaResults(camp, leads ? "leads" : "sales");
    const word = leads ? t("overview.step1.word.lead") : t("overview.step1.word.purchase");
    const cpa = results > 0 ? camp.cost / results : null;
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">{t("overview.step1.title")}</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {t("overview.step1.sourceMeta", { company: c.company, from: ddmmyyyy(c.range.from, intl), to: ddmmyyyy(c.range.to, intl) })}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label={t("overview.step1.kpi.spent")} value={vnd(camp.cost, intl)} bad={results === 0} />
          <Kpi label={leads ? t("overview.step1.kpi.leadMeta") : t("overview.step1.kpi.purchaseMeta")} value={num(results, undefined, intl)} bad={results === 0} sub={leads ? t("overview.step1.goalLeads") : t("overview.step1.goalPurchase")} />
          <Kpi label={leads ? t("overview.step1.kpi.costPerLead") : t("overview.step1.kpi.costPerPurchase")} value={cpa !== null ? vnd(cpa, intl) : "—"} />
          {leads
            ? <Kpi label={t("overview.step1.landingViews")} value={num(camp.landingViews, undefined, intl)} />
            : <Kpi label={t("overview.step1.kpi.metaRevenue")} value={vnd(camp.purchaseValue, intl)} bad={camp.purchases > 0 && camp.purchaseValue <= 0} />}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">{t("overview.step1.config")}</div>
          <table className="w-full text-sm">
            <tbody>
              <Row label={t("overview.step1.row.objective")}>{metaObjectiveLabel(camp.objective, t)}</Row>
              <Row label={t("overview.step1.row.dailyBudget")}>
                <span className="tabular-nums">{camp.dailyBudget !== null ? vnd(camp.dailyBudget, intl) : t("overview.step1.adsetLevelBudget")}</span>
              </Row>
              <Row label={t("overview.step1.row.frequency")}>
                <span className="tabular-nums">{camp.frequency !== null ? camp.frequency.toFixed(2) : "—"}</span>
                {" · "}{t("overview.step1.reach")} <span className="tabular-nums">{num(camp.reach, undefined, intl)}</span>
              </Row>
              <Row label={t("overview.step1.row.linkClicks")}><span className="tabular-nums">{num(camp.linkClicks, undefined, intl)}</span></Row>
              <Row label={t("overview.step1.landingViews")}><span className="tabular-nums">{num(camp.landingViews, undefined, intl)}</span></Row>
              <Row label={t("overview.step1.row.status")}>{camp.status === "ACTIVE" ? t("overview.step1.running") : camp.status}</Row>
            </tbody>
          </table>
        </div>

        <div
          className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
            results === 0 ? "border-red-200 bg-red-50 text-red-700" : "border-blue-200 bg-blue-50 text-blue-700"
          }`}
        >
          {results === 0 ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          <span>
            {results === 0
              ? t("overview.step1.zeroMeta", { word, cost: vnd(camp.cost, intl) })
              : t("overview.step1.someMeta", { n: num(results, undefined, intl), word, cost: vnd(camp.cost, intl) })}
          </span>
        </div>

        <div className="flex justify-end">
          <Button className="h-10" onClick={onNext} disabled={busy}>{t("overview.step1.collect")}</Button>
        </div>
      </div>
    );
  }

  const camp = ev.campaign;
  const cpc = camp.clicks > 0 ? camp.cost / camp.clicks : null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-900">{t("overview.step1.title")}</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          {t("overview.step1.sourceGoogle", { company: c.company, from: ddmmyyyy(c.range.from, intl), to: ddmmyyyy(c.range.to, intl) })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label={t("overview.step1.kpi.spent")} value={vnd(camp.cost, intl)} bad={camp.orders === 0} />
        <Kpi label={t("overview.step1.kpi.clicks")} value={num(camp.clicks, undefined, intl)} sub={cpc !== null ? t("overview.step1.avgCpc", { cpc: vnd(cpc, intl) }) : undefined} />
        <Kpi label={t("overview.step1.kpi.orders")} value={num(camp.orders, undefined, intl)} bad={camp.orders === 0} sub={t("overview.step1.goalPurchase")} />
        <Kpi label={t("overview.step1.kpi.allConv")} value={num(camp.allConversions, { maximumFractionDigits: 1 }, intl)} sub={t("overview.step1.kpi.allConvSub")} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">{t("overview.step1.config")}</div>
        <table className="w-full text-sm">
          <tbody>
            <Row label={t("overview.step1.row.bidding")}>
              {BIDDING_LABEL[camp.biddingType] ? t(BIDDING_LABEL[camp.biddingType]) : camp.biddingType}
              {camp.targetCpa !== null && <> · {t("overview.step1.bidding.TARGET_CPA")} <b className="tabular-nums">{vnd(camp.targetCpa, intl)}</b></>}
              {camp.targetRoas !== null && <> · {t("overview.step1.bidding.TARGET_ROAS")} <b className="tabular-nums">{camp.targetRoas}</b></>}
            </Row>
            <Row label={t("overview.step1.row.dailyBudget")}><span className="tabular-nums">{vnd(camp.budgetDaily, intl)}</span></Row>
            {ev?.kind !== "google_pmax" && (
            <Row label={t("overview.step1.row.impShare")}>
              <span className="tabular-nums">{pct(camp.impressionShare, 1, intl)}</span>
              {camp.lostIsBudget !== null && <> · {t("overview.step1.lost")} <span className="tabular-nums">{pct(camp.lostIsBudget, 1, intl)}</span> {t("overview.step1.dueBudget")}</>}
              {camp.lostIsRank !== null && <> · <span className="tabular-nums">{pct(camp.lostIsRank, 1, intl)}</span> {t("overview.step1.dueRank")}</>}
            </Row>
            )}
            <Row label={t("overview.step1.row.status")}>{camp.status === "ENABLED" ? t("overview.step1.running") : camp.status}</Row>
          </tbody>
        </table>
      </div>

      {ev?.network && ev.network.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">{t("overview.step1.pmaxTitle")}</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">{t("overview.step1.th.channel")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("overview.step1.th.spend")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("overview.step1.kpi.clicks")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("overview.step1.th.orders")}</th>
              </tr>
            </thead>
            <tbody>
              {ev.network.filter((n) => n.cost > 0).map((n) => (
                <tr key={n.network} className="border-t border-slate-50">
                  <td className="px-4 py-2 text-slate-700">{NETWORK_LABEL[n.network] ? t(NETWORK_LABEL[n.network]) : n.network}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{vnd(n.cost, intl)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{num(n.clicks, undefined, intl)}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${n.conversions === 0 ? "font-semibold text-red-600" : "text-slate-800"}`}>{num(n.conversions, { maximumFractionDigits: 1 }, intl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div
        className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
          camp.orders === 0 ? "border-red-200 bg-red-50 text-red-700" : "border-blue-200 bg-blue-50 text-blue-700"
        }`}
      >
        {camp.orders === 0 ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
        <span>
          {camp.orders === 0
            ? t("overview.step1.zeroGoogle", { cost: vnd(camp.cost, intl) })
            : t("overview.step1.someGoogle", { n: num(camp.orders, undefined, intl), cost: vnd(camp.cost, intl) })}
        </span>
      </div>

      <div className="flex justify-end">
        <Button className="h-10" onClick={onNext} disabled={busy}>{t("overview.step1.collect")}</Button>
      </div>
    </div>
  );
}

const NETWORK_LABEL: Record<string, MessageKey> = {
  SEARCH: "overview.step1.network.SEARCH",
  SEARCH_PARTNERS: "overview.step1.network.SEARCH_PARTNERS",
  CONTENT: "overview.step1.network.CONTENT",
  YOUTUBE: "overview.step1.network.YOUTUBE",
  GMAIL: "overview.step1.network.GMAIL",
  DISCOVER: "overview.step1.network.DISCOVER",
  MAPS: "overview.step1.network.MAPS",
  MIXED: "overview.step1.network.MIXED",
  GOOGLE_TV: "overview.step1.network.GOOGLE_TV",
};

function Kpi({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${bad ? "text-red-600" : "text-slate-900"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr className="border-b border-slate-50 last:border-0">
      <td className="w-56 px-4 py-2 text-slate-500">{label}</td>
      <td className="px-4 py-2 text-slate-800">{children}</td>
    </tr>
  );
}
