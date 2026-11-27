import React, { useEffect, useState } from "react"
import { hydrateRoot } from "react-dom/client"
import { I18nProvider } from "@/lib/i18n/client"
import { BriefReviewPanel } from "@/components/creative/BriefReviewPanel"
import { CheckpointRecovery } from "@/components/jobs/checkpoint-recovery"
import { draft } from "./review-recovery-data"
import type { BriefDraft } from "@/lib/creative-brief/types"
export const now = Date.parse("2026-11-27T01:00:00Z")
export const run = { runId: "synthetic-crashed-run", startedAt: new Date(now - 60001).toISOString(), finishedAt: null, durationMs: null }
export type Options = { locale: "vi" | "en"; mode: string }
type Call = { url: string; method: string; body: Record<string, unknown> | null }
declare global { interface Window { ready: boolean; calls: Call[]; options: Options; serverDraft: BriefDraft; recovered: boolean } }
export function Fixture({ locale, mode }: Options) {
  const [current, setCurrent] = useState(draft)
  useEffect(() => { window.ready = true }, [])
  return <I18nProvider locale={locale}>{mode.startsWith("recovery") ? <CheckpointRecovery run={run} now={now} /> : <BriefReviewPanel key={`${current.id}:${current.revision}`} draft={current} canEdit={mode !== "viewer"} onChange={setCurrent} />}</I18nProvider>
}
if (typeof window !== "undefined") {
  window.calls = []; window.serverDraft = structuredClone(draft); window.serverDraft.history = [snapshot(draft)]; window.recovered = false
  const mode = window.options.mode
  window.fetch = async (input, init) => {
    const url = String(input), method = init?.method ?? "GET"
    const body = init?.body ? JSON.parse(String(init.body)) : null
    window.calls.push({ url, method, body })
    if (url === "/api/jobs/quality_checkpoint/recover" && method === "POST") {
      if (body.runId !== run.runId || body.expectedStartedAt !== run.startedAt) throw Error("bad_recovery_contract")
      const status = mode === "recovery409" ? 409 : mode === "recovery503" ? 503 : 200
      if (status === 200) window.recovered = true
      return Response.json({ success: status === 200 }, { status })
    }
    if (url !== `/api/creative/brief/${draft.id}`) throw Error("unexpected_fetch")
    if (method === "GET") return Response.json({ success: true, data: { draft: window.serverDraft, canEdit: true } })
    if (method !== "PATCH" || mode === "viewer") throw Error("forbidden_mutation")
    if (mode === "error503") return Response.json({ success: false }, { status: 503 })
    if (mode === "conflict") {
      window.serverDraft = { ...window.serverDraft, revision: 2, contentHash: "server-current-hash", output: { ...draft.output!, usp: "server-current-usp" } }
      // The external revision is synthetic; history snapshots remain complete.
      window.serverDraft.history = [...(window.serverDraft.history ?? []), snapshot(window.serverDraft)]
    }
    const current = window.serverDraft
    if (body.expectedRevision !== current.revision || body.contentHash !== current.contentHash) return Response.json({ success: false }, { status: 409 })
    if (body.company !== current.input.company) throw Error("bad_company")
    if (body.action === "review") {
      current.review = { revision: current.revision!, contentHash: current.contentHash!, actorId: "server-reviewer", reviewedAt: "2026-11-27T01:00:00Z" }
      current.history = [snapshot(current)]
    } else if (body.action === "edit") {
      window.serverDraft = { ...current, revision: current.revision! + 1, contentHash: "edited-hash", review: undefined, output: { ...current.output!, usp: body.usp, valueProposition: body.valueProposition } }
      window.serverDraft.history = [...(current.history ?? [snapshot(current)]), snapshot(window.serverDraft)]
    } else throw Error("unexpected_action")
    return Response.json({ success: true, data: { draft: window.serverDraft } })
  }
  hydrateRoot(document.getElementById("root")!, <Fixture {...window.options} />)
}
function snapshot(d: BriefDraft) {
  return { revision: d.revision!, contentHash: d.contentHash!, name: d.name, input: structuredClone(d.input), output: structuredClone(d.output), savedAt: d.updatedAt, ...(d.review ? { review: structuredClone(d.review) } : {}) }
}
