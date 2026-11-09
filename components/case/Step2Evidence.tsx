// ============================================================
// Bước 2 — Thu thập bằng chứng. CHỈ ĐỌC: không đổi gì trên tài khoản quảng cáo.
// ============================================================
"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { vnd, num, pct, datetimeVN } from "./format";
import { postJson, ApiError } from "./api";
import { metaEventLabel, META_EVENT_ORDER, metaLearningLabel } from "./meta-copy";
import type { CampaignCase } from "@/lib/case/store";
import type { MetaEvidence, MetaPlacementSlice, SourceStatus } from "@/lib/case/types";
import { metaGoalKind } from "@/lib/case/goal-kind";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

const SOURCE_PILL: Record<SourceStatus, { icon: typeof CheckCircle2; cls: string; text: MessageKey }> = {
  ok: { icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-700 border-emerald-200", text: "overview.step2.pill.ok" },
  partial: { icon: TriangleAlert, cls: "bg-amber-50 text-amber-700 border-amber-200", text: "overview.step2.pill.partial" },
  error: { icon: AlertTriangle, cls: "bg-red-50 text-red-700 border-red-200", text: "overview.step2.pill.error" },
};

/** Chi phí/xem trang đích/lượt mua (thu lead: lead) theo vị trí, gộp qua mọi nhóm quảng cáo — sắp theo chi phí. */
function aggregatePlacements(placements: MetaPlacementSlice[], leads: boolean) {
  const by = new Map<string, { key: string; label: string; cost: number; landingViews: number; purchases: number }>();
  for (const p of placements) {
    const cur = by.get(p.key) ?? { key: p.key, label: p.label, cost: 0, landingViews: 0, purchases: 0 };
    cur.cost += p.cost;
    cur.landingViews += p.landingViews;
    cur.purchases += leads ? p.leads ?? 0 : p.purchases;
    by.set(p.key, cur);
  }
  const totalCost = [...by.values()].reduce((s, r) => s + r.cost, 0);
  return [...by.values()]
    .map((r) => ({ ...r, share: totalCost > 0 ? r.cost / totalCost : 0 }))
    .sort((a, b) => b.cost - a.cost);
}

export function Step2Evidence({
  c,
  onRefresh,
  onBack,
  onNext,
  busy,
}: {
  c: CampaignCase;
  onRefresh: (next: CampaignCase) => void;
  onBack: () => void;
  onNext: () => void;
  busy?: boolean;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const [collecting, setCollecting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function recollect() {
    setCollecting(true);
    setErr(null);
    try {
      const json = await postJson(`/api/cases/${c.id}/collect`);
      onRefresh(json.case);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("overview.step2.recollectFail"));
    } finally {
      setCollecting(false);
    }
  }

  if (!c.evidence) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title={t("overview.step2.empty.title")}
        description={t("overview.step2.empty.desc", { platform: c.platform === "facebook" ? "Meta" : "Google Ads" })}
        action={
          <Button className="h-10" onClick={recollect} disabled={collecting}>
            {collecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {t("overview.step2.repull")}
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900">{t("overview.step2.title")}</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {t("overview.step2.readOnly", { platform: c.platform === "facebook" ? "Meta" : "Google Ads", time: datetimeVN(c.evidence.collectedAt, intl) })}
          </p>
        </div>
        <Button className="h-10" variant="outline" size="sm" onClick={recollect} disabled={collecting}>
          {collecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
          {t("overview.step2.repull")}
        </Button>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th className="px-4 py-2 font-medium">{t("overview.step2.th.source")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("overview.step2.th.rows")}</th>
              <th className="px-3 py-2 font-medium">{t("overview.step2.th.note")}</th>
              <th className="px-3 py-2 font-medium">{t("overview.step2.th.status")}</th>
            </tr>
          </thead>
          <tbody>
            {c.evidence.sources.map((s) => {
              const pill = SOURCE_PILL[s.status];
              const Icon = pill.icon;
              return (
                <tr key={s.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2.5 text-slate-800">{s.label}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{num(s.rows, undefined, intl)}</td>
                  <td className="px-3 py-2.5 text-slate-500">{s.note ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${pill.cls}`}>
                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {t(pill.text)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {c.evidence.kind === "meta" && <MetaEvidenceBlocks ev={c.evidence} />}

      <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t("overview.step2.missingNote")}</span>
      </div>

      <div className="flex justify-between">
        <Button className="h-10" variant="outline" onClick={onBack} disabled={busy}>{t("overview.step2.back")}</Button>
        <Button className="h-10" onClick={onNext} disabled={busy}>{t("overview.step2.next")}</Button>
      </div>
    </div>
  );
}

function MetaEvidenceBlocks({ ev }: { ev: MetaEvidence }) {
  const intl = useIntlLocale();
  const t = useT();
  const leads = metaGoalKind(ev.campaign.objective) === "leads"; // Đợt 23 (3d)
  const placementRows = aggregatePlacements(ev.placements, leads);
  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">{t("overview.step2.adsets")}</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th className="px-4 py-2 font-medium">{t("overview.step2.adsets")}</th>
              <th className="px-3 py-2 font-medium">{t("overview.step2.th.status")}</th>
              <th className="px-3 py-2 font-medium">{t("overview.step2.th.optEvent")}</th>
              <th className="px-3 py-2 font-medium">{t("overview.step2.th.learning")}</th>
              <th className="px-3 py-2 font-medium">{t("overview.step2.th.placement")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("overview.step2.th.cost")}</th>
              <th className="px-3 py-2 text-right font-medium">{leads ? t("overview.step2.leadOrPurchase.lead") : t("overview.step2.leadOrPurchase.purchase")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("overview.step2.th.results")}</th>
            </tr>
          </thead>
          <tbody>
            {ev.adsets.map((a) => (
              <tr key={a.id} className="border-b border-slate-50 last:border-0 align-top">
                <td className="px-4 py-2.5 text-slate-800">{a.name}</td>
                <td className="px-3 py-2.5 text-slate-600">{a.status === "ACTIVE" ? t("overview.step2.running") : a.status}</td>
                <td className="px-3 py-2.5 text-slate-600">{a.optEvent.label}</td>
                <td className="px-3 py-2.5 text-slate-600">
                  {a.learning.status ? (metaLearningLabel(a.learning.status, t) ?? a.learning.status) : "—"}
                  {a.learning.conversions !== null && <span className="text-slate-400"> ({t("overview.step2.events", { n: num(a.learning.conversions, undefined, intl) })})</span>}
                </td>
                <td className="px-3 py-2.5 text-slate-600">{a.automaticPlacement ? t("overview.step2.auto") : t("overview.step2.manual")}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{vnd(a.cost, intl)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{num(leads ? a.leads ?? 0 : a.purchases, undefined, intl)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <span title={a.optResultsApprox ? t("overview.step2.approxHint") : undefined}>
                    {num(a.optResults, undefined, intl)}{a.optResultsApprox ? "≈" : ""}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {placementRows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">{t("overview.step2.placementTitle")}</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">{t("overview.step2.th.placement")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("overview.step2.th.cost")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("overview.step2.th.costShare")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("overview.step2.th.landing")}</th>
                <th className="px-3 py-2 text-right font-medium">{leads ? t("overview.step2.leadOrPurchase.lead") : t("overview.step2.leadOrPurchase.purchase")}</th>
              </tr>
            </thead>
            <tbody>
              {placementRows.map((r) => (
                <tr key={r.key} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2.5 text-slate-800">{r.label}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{vnd(r.cost, intl)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.share, 1, intl)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(r.landingViews, undefined, intl)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(r.purchases, undefined, intl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-sm">
          <div className="mb-1.5 font-semibold text-slate-800">{t("overview.step2.odoo.title")}</div>
          {ev.odoo.checked && (
            <div className="mb-1.5 space-y-0.5 text-slate-700">
              <div>{t("overview.step2.odoo.tags", { tags: ev.odoo.tags.map((tag) => `“${tag}”`).join(", ") })}</div>
              <div>{t("overview.step2.odoo.orders")}: <span className="tabular-nums font-semibold">{num(ev.odoo.orders, undefined, intl)}</span> · {t("overview.step2.odoo.revenue")}: <span className="tabular-nums font-semibold">{vnd(ev.odoo.revenue, intl)}</span></div>
            </div>
          )}
          <p className="text-xs text-slate-500">{ev.odoo.note}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-sm">
          <div className="mb-1.5 font-semibold text-slate-800">{t("overview.step2.peers.title")}</div>
          <p className="mb-1.5 text-slate-700">{t("overview.step2.peers.same")}: <b className="tabular-nums">{num(ev.peers.campaigns, undefined, intl)}</b> {t("overview.step2.peers.campaigns")} (<span className="tabular-nums">{num(ev.peers.activeCampaigns, undefined, intl)}</span> {t("overview.step2.peers.spending")})</p>
          <ul className="space-y-0.5 text-xs text-slate-600">
            {META_EVENT_ORDER.filter((k) => ev.peers.eventsPerWeek[k] !== undefined).map((k) => (
              <li key={k}>{metaEventLabel(k, t)}: <span className="tabular-nums">{num(ev.peers.eventsPerWeek[k], undefined, intl)}</span>{t("overview.step2.perWeek")}</li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
