"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import type { AttributionAggregate } from "@/lib/attribution/aggregate";
import type { MessageKey } from "@/lib/i18n/messages";

export type EvidenceState = { status: "loading" | "error" | "permission" } | { status: "ready"; report: AttributionAggregate; company: string; from: string; to: string };
const key = (name: string) => `overview.leadOrderEvidence.${name}` as MessageKey;

export function EvidenceView({ state, t }: { state: EvidenceState; t: TFunction }) {
  const count = (value: number | null) => value === null ? "—" : String(value);
  const rate = (value: number | null) => value === null ? t(key("unknown")) : `${(value * 100).toFixed(1)}%`;
  return <Card aria-label={t(key("title"))}>
    <CardHeader><CardTitle>{t(key("title"))}</CardTitle></CardHeader>
    <CardContent className="space-y-3 text-sm">
      {state.status !== "ready" ? <p role={state.status === "loading" ? "status" : "alert"}>{t(key(state.status))}</p> : <>
        <p className="text-muted-foreground">{state.company} · {state.from} → {state.to} (UTC)</p>
        <p role="status">{t(key(state.report.status))}{state.report.status === "available" && state.report.uniqueOrders === 0 ? ` · ${t(key("empty"))}` : ""}</p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(["leadCount", "uniqueOrders", "matchedOrders", "unmatchedOrders", "ambiguousOrders", "duplicateOrders", "duplicateConflicts", "currencyCount"] as const).map(name => <div key={name}><dt className="text-muted-foreground">{t(key(name))}</dt><dd className="font-medium tabular-nums">{count(state.report[name])}</dd></div>)}
          <div><dt>{t(key("orderCoverage"))}</dt><dd>{rate(state.report.matchedOrderRate)}</dd></div>
          <div><dt>{t(key("revenueCoverage"))}</dt><dd>{rate(state.report.matchedRevenueRate)}</dd></div>
        </dl>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {([state.report.source, state.report.leadSource]).map((source, index) => <li key={index}>
            {t(key(index ? "leadSource" : "orderSource"))}: {source.source ?? t(key("noSource"))} · {t(key(source.status))}
            {source.reason && <> · {t(key(source.reason))}</>}
            {" · "}{t(key("readAt"))}: {source.readAt ?? "—"}
            {" · "}{source.from} → {source.to}
          </li>)}
        </ul>
      </>}
      <p className="text-xs text-muted-foreground">{t(key("limits"))}</p>
      <p className="text-xs text-muted-foreground">{t(key("binding"))}</p>
    </CardContent>
  </Card>;
}

export function LeadOrderEvidence({ company, range }: { company: string; range: string }) {
  const t = useT();
  const scope = `${company}:${range}`;
  const [result, setResult] = useState<{ scope: string; state: EvidenceState } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ company, range, aggregate: "1" });
    void (async () => {
      try {
        const response = await fetch(`/api/attribution/report?${query}`, { signal: controller.signal, cache: "no-store" });
        if (response.status === 401 || response.status === 403) {
          if (!controller.signal.aborted) setResult({ scope, state: { status: "permission" } });
          return;
        }
        const json = await response.json();
        if (!response.ok || !json.success || !json.report) throw new Error("report unavailable");
        if (!controller.signal.aborted) setResult({ scope, state: { status: "ready", report: json.report, company: json.company, from: json.from, to: json.to } });
      } catch {
        if (!controller.signal.aborted) setResult({ scope, state: { status: "error" } });
      }
    })();
    return () => controller.abort();
  }, [company, range, scope]);
  return <EvidenceView t={t} state={result?.scope === scope ? result.state : { status: "loading" }} />;
}
