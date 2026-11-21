"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import CampaignSnapshotPanel from "@/components/automation/CampaignSnapshotPanel";
import ApprovalLifecyclePanel from "@/components/automation/ApprovalLifecyclePanel";
import { useIntlLocale, useT } from "@/lib/i18n/client";

type Row = { decisionId: string | null; company: string; campaignId: string; campaignName: string; action: "blocked" | "hold" | "increase_budget" | "decrease_budget"; mode: "simulation" | "dry_run" | "evaluate"; currentBudget: number; proposedBudget: number | null; reasonCode: string; createdAt: string; provider: string | null; policyRevision: string | null };
export default function DecisionHistoryPage() {
  const t = useT(); const locale = useIntlLocale();
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/automation/decisions", { signal: controller.signal, cache: "no-store" }).then(async response => {
      const payload = await response.json();
      if (!response.ok || !payload.success || !Array.isArray(payload.decisions)) throw new Error("history");
      if (!controller.signal.aborted) { setRows(payload.decisions); setState("ready"); }
    }).catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [refresh]);
  return <section className="space-y-4">
    <div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-xl font-semibold">{t("overview.decisions.title")}</h1><p className="text-sm text-slate-500">{t("overview.decisions.note")}</p></div><button type="button" onClick={() => { setState("loading"); setRefresh(x => x + 1); }} className="rounded-lg border px-4 py-2 text-sm">{t("overview.decisions.reload")}</button></div>
    <ApprovalLifecyclePanel />
    <CampaignSnapshotPanel onRecorded={() => setRefresh(x => x + 1)} />
    <Link href="/settings/automation" className="inline-block text-sm underline">{t("overview.policy.title")}</Link>
    {state === "loading" && <p role="status">{t("overview.decisions.loading")}</p>}
    {state === "error" && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{t("overview.decisions.error")}</p>}
    {state === "ready" && !rows.length && <p className="rounded-xl border p-6 text-slate-500">{t("overview.decisions.empty")}</p>}
    {state === "ready" && rows.map((row, i) => <article key={row.decisionId ?? `${row.campaignId}-${i}`} className="space-y-2 rounded-xl border bg-white p-4 text-sm">
      <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold break-all">{row.company} · {row.campaignName}</h2><span>{t(`overview.decisions.${row.action}`)}</span></div>
      <p className="text-amber-800">{t(`overview.decisions.${row.mode}`)}</p>
      <p>{row.provider ?? "—"} · {new Date(row.createdAt).toLocaleString(locale)}</p>
      <dl className="grid gap-2 sm:grid-cols-2"><div><dt className="text-slate-500">{t("overview.decisions.reason")}</dt><dd className="break-all">{row.reasonCode === "snapshot_not_approvable" ? t("overview.evidence.blocked") : row.reasonCode}</dd></div><div><dt className="text-slate-500">{t("overview.decisions.policy")}</dt><dd className="break-all">{row.policyRevision ?? "—"}</dd></div></dl>
      <details><summary className="cursor-pointer">{t("overview.decisions.current")} / {t("overview.decisions.proposed")}</summary><p className="tabular-nums">{Number.isFinite(row.currentBudget) ? row.currentBudget.toLocaleString(locale) : "—"} → {row.proposedBudget === null ? "—" : row.proposedBudget.toLocaleString(locale)}</p><p className="text-xs text-slate-500">{t("overview.decisions.budgetNote")}</p></details>
    </article>)}
  </section>;
}
