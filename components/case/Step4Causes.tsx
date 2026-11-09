// ============================================================
// Bước 4 — Nguyên nhân, xếp theo số tiền liên quan. Không cộng dồn các
// khoản (một click có thể dính nhiều nguyên nhân).
// ============================================================
"use client";

import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { vnd, pct } from "./format";
import type { CampaignCase } from "@/lib/case/store";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

const SHARE_OF_LABEL: Record<string, MessageKey> = {
  campaign_cost: "overview.step4.shareOf.campaign_cost",
  visible_terms: "overview.step4.shareOf.visible_terms",
};

export function Step4Causes({
  c,
  onBack,
  onNext,
  busy,
}: {
  c: CampaignCase;
  onBack: () => void;
  onNext: () => void;
  busy?: boolean;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const dx = c.diagnosis;
  const campaignCost = c.evidence?.campaign.cost ?? 0;

  if (!dx) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title={t("overview.step4.empty.title")}
        description={t("overview.step4.empty.desc")}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-900">{t("overview.step4.title")}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{t("overview.step4.subtitle")}</p>
      </div>

      {dx.context.map((line, i) => (
        <div key={i} className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{line}</span>
        </div>
      ))}

      {dx.causes.length === 0 ? (
        <EmptyState compact title={t("overview.step4.none.title")} description={t("overview.step4.none.desc")} />
      ) : (
        <div className="space-y-2">
          {dx.causes.map((cause, i) => {
            const barPct = cause.money !== null && campaignCost > 0 ? Math.min(100, (cause.money / campaignCost) * 100) : 0;
            return (
              <details key={cause.id} open={i === 0} className="group rounded-xl border border-slate-200 bg-white">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-3.5 [&::-webkit-details-marker]:hidden">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900">{cause.title}</div>
                      {cause.money !== null && (
                        <div className="mt-1.5 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-red-400" style={{ width: `${barPct}%` }} />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`tabular-nums font-bold ${cause.money !== null ? "text-red-600" : "text-slate-700"}`}>
                      {cause.money !== null ? vnd(cause.money, intl) : t("overview.step4.inseparable")}
                    </div>
                    {cause.share !== null && cause.shareOf && (
                      <div className="text-xs text-slate-400">{pct(cause.share, 1, intl)} {SHARE_OF_LABEL[cause.shareOf] ? t(SHARE_OF_LABEL[cause.shareOf]) : cause.shareOf}</div>
                    )}
                  </div>
                </summary>
                <div className="border-t border-slate-100 px-3.5 py-3 text-sm text-slate-600">
                  <p>{cause.detail}</p>
                  {cause.evidence.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {cause.evidence.map((e, j) => (
                        <span key={j} className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1 text-xs text-slate-600">
                          {e.label}
                          {e.cost !== undefined && <b className="tabular-nums">· {vnd(e.cost, intl)}</b>}
                          {e.clicks !== undefined && <span className="tabular-nums text-slate-400">· {t("overview.step4.clicks", { n: e.clicks })}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">{t("overview.step4.ruledOut")}</div>
        <div className="space-y-2 p-4 text-sm">
          {dx.notCauses.length === 0 ? (
            <p className="text-slate-400">{t("overview.step4.noneRuledOut")}</p>
          ) : (
            dx.notCauses.map((ok) => (
              <div key={ok.id} className="flex items-start gap-2 text-slate-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>{ok.text}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex justify-between">
        <Button className="h-10" variant="outline" onClick={onBack} disabled={busy}>{t("overview.step4.back")}</Button>
        <Button className="h-10" onClick={onNext} disabled={busy}>{t("overview.step4.next")}</Button>
      </div>
    </div>
  );
}
