"use client"
import { useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n/client"
import type { QualityBrief } from "@/lib/inbox/quality-workflow-types"
import { qualityText } from "@/lib/inbox/evidence"

function useWorkflowCopy() {
  const t = useT()
  return { title: t("overview.qualityWorkflow.title"), scope: t("overview.qualityWorkflow.scope"), independent: t("overview.qualityWorkflow.independent"), empty: t("overview.qualityWorkflow.empty"), loading: t("overview.qualityWorkflow.loading"), error: t("overview.qualityWorkflow.error"), refresh: t("overview.qualityWorkflow.refresh"), record: t("overview.qualityWorkflow.record"), recheck: t("overview.qualityWorkflow.recheck"), busy: t("overview.qualityWorkflow.busy"), permission: t("overview.qualityWorkflow.permission"), conflict: t("overview.qualityWorkflow.conflict"), recorded: t("overview.qualityWorkflow.recorded"), baseline: t("overview.qualityWorkflow.baseline"), read: t("overview.qualityWorkflow.read"), unknown: t("overview.qualityWorkflow.unknown"), captured: t("overview.qualityWorkflow.captured"), inbox: t("overview.qualityWorkflow.inbox"), healthy: t("overview.qualityWorkflow.healthy"), proposed: t("overview.qualityWorkflow.proposed"), listing_observed: t("overview.qualityWorkflow.listing_observed"), issue_observed: t("overview.qualityWorkflow.issue_observed"), inconclusive: t("overview.qualityWorkflow.inconclusive"), no_new_read: t("overview.qualityWorkflow.no_new_read"), stale_or_unavailable: t("overview.qualityWorkflow.stale_or_unavailable"), fresh_post_action: t("overview.qualityWorkflow.fresh_post_action"), pending: t("overview.qualityWorkflow.pending"), disclaimer: t("overview.qualityWorkflow.disclaimer") }
}
export function QualityBriefView({ brief, canEdit, busy = false, onWrite }: {
  brief: QualityBrief; canEdit: boolean; busy?: boolean; onWrite?: (operation: "record" | "observe" | "new_cycle", brief: QualityBrief) => void
}) {
  const t = useT(), c = useWorkflowCopy()
  const { reference: ref, action } = brief
  return <article id={`brief-${brief.key}`} className="min-w-0 space-y-2 rounded-lg border border-border bg-card p-4 text-card-foreground" data-evidence-ref={ref.registryId}>
    <h3 className="font-semibold">{brief.company} · {c.proposed}</h3>
    <p>{ref.evidence ? qualityText(ref.evidence, t).why : c.healthy}</p>
    <p className="text-xs text-muted-foreground">{c.scope}</p>
    <p className="break-all text-xs">{brief.version} · {brief.key}<br />{ref.registryId}</p>
    <p className="text-xs">{c.read}: {ref.readAt ? <time dateTime={ref.readAt}>{ref.readAt}</time> : c.unknown}<br />{c.captured}: <time dateTime={ref.capturedAt}>{ref.capturedAt}</time></p>
    <Link className="text-sm underline" href={`/viec-hom-nay#${encodeURIComponent(brief.key)}`}>{c.inbox}</Link>
    {action && <ol className="space-y-2 border-l border-border pl-3 text-sm">
      <li>{c.recorded} · <time dateTime={action.actionAt}>{action.actionAt}</time> · {action.actor}<p className="break-all text-xs">{c.baseline}: {action.baseline.registryId} · {action.baseline.readAt ?? c.unknown}</p></li>
      {action.observations.map(o => <li key={o.ref.registryId}>{c[o.result]} · {c[o.reason]}<p><time dateTime={o.at}>{o.at}</time> · {o.actor}</p><p className="break-all text-xs">{o.ref.registryId} · {o.ref.readAt ?? c.unknown}</p></li>)}
    </ol>}
    {action && <ul className="text-xs text-muted-foreground">{brief.checkpoints?.map(checkpoint =>
      <li key={checkpoint.day}>{t("overview.qualityWorkflow.checkpoint", { day: checkpoint.day })}: <time dateTime={checkpoint.dueAt}>{checkpoint.dueAt}</time> · {t(`overview.qualityWorkflow.${checkpoint.status}`)}{checkpoint.overdue && <> · {t("overview.qualityWorkflow.overdue")}</>}</li>
    )}</ul>}
    {!!brief.history?.length && <details className="text-sm"><summary className="cursor-pointer">{t("overview.qualityWorkflow.history")}</summary><ol className="space-y-3 pt-2">{brief.history.map(prior => <li key={prior.id} className="break-all">{c.recorded} · <time dateTime={prior.actionAt}>{prior.actionAt}</time> · {prior.actor}<p>{c.baseline}: {prior.baseline.registryId}</p><ol>{prior.observations.map(o => <li key={o.ref.registryId}>{c[o.result]} · {c[o.reason]} · <time dateTime={o.at}>{o.at}</time> · {o.actor}</li>)}</ol></li>)}</ol></details>}
    <p className="text-xs text-muted-foreground">{c.pending} {c.disclaimer}</p>
    {!canEdit ? <p className="text-sm">{c.permission}</p> : (action || ref.evidence) && <Button type="button" disabled={busy} variant="outline" onClick={() => onWrite?.(action ? "observe" : "record", brief)}>{busy ? c.busy : action ? c.recheck : c.record}</Button>}
    {canEdit && action && ref.evidence && <Button type="button" variant="outline" disabled={busy} onClick={() => {
      if (window.confirm(t("overview.qualityWorkflow.confirmCycle"))) onWrite?.("new_cycle", brief)
    }}>{t("overview.qualityWorkflow.newCycle")}</Button>}
  </article>
}
interface BriefResponse { success: boolean; actionBriefs: QualityBrief[]; canEdit: boolean }
async function load(url: string): Promise<BriefResponse> {
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) throw new Error("readFailed")
  return response.json()
}
/** Both overview and Inbox consume the SAME scoped GET/evidence identity. No AI cache. */
export function QualityActionBrief() {
  const { data, error, isLoading, mutate } = useSWR<BriefResponse>("/api/inbox", load)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null)
  const c = useWorkflowCopy()
  async function write(operation: "record" | "observe" | "new_cycle", brief: QualityBrief) {
    setBusy(true); setMessage(null)
    try {
      let registryId = brief.reference.registryId
      if (operation === "observe") {
        const response = await fetch(`/api/inbox/quality?company=${encodeURIComponent(brief.company)}`, { cache: "no-store" })
        if (!response.ok) throw new Error()
        registryId = (await response.json()).brief.reference.registryId
      }
      const response = await fetch("/api/inbox/quality", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(operation === "new_cycle" ? { confirmed: true } : {}), company: brief.company, operation, registryId, expectedRevision: brief.action?.revision ?? null }) })
      if (!response.ok) { setMessage(response.status === 409 ? c.conflict : c.error); if (response.status === 409) await mutate(); return }
      await mutate()
    } catch { setMessage(c.error) } finally { setBusy(false) }
  }
  return <section className="my-4 space-y-3 rounded-xl border border-border bg-background p-4 text-foreground" aria-label={c.title}>
    <h2 className="font-semibold">{c.title}</h2><p className="text-sm text-muted-foreground">{c.independent}</p>
    {isLoading && <p role="status">{c.loading}</p>}
    {(error || message) && <p role="alert">{message ?? c.error}</p>}
    <Button variant="outline" disabled={busy || isLoading} onClick={() => { setMessage(null); void mutate() }}>{c.refresh}</Button>
    {!error && data?.actionBriefs?.map(brief => <QualityBriefView key={brief.key} brief={brief} canEdit={data.canEdit} busy={busy} onWrite={write} />)}
    {data && !data.actionBriefs?.length && <p>{c.empty}</p>}
  </section>
}
