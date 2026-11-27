"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n/client"
import { CHECKPOINT_MAX_DURATION_MS } from "@/lib/jobs/checkpoint-visibility"

export function CheckpointRecovery({ run, now }: { now?: number; run: { runId: string; startedAt: string; finishedAt: string | null; durationMs: number | null } }) {
  const t = useT()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<"done" | "error" | null>(null)
  const [checkedAt] = useState(() => now ?? Date.now())
  const start = Date.parse(run.startedAt)
  if (!Number.isFinite(start) || new Date(start).toISOString() !== run.startedAt || checkedAt - start <= CHECKPOINT_MAX_DURATION_MS || run.finishedAt !== null || run.durationMs !== null) return null
  async function recover() {
    setBusy(true)
    try {
      const response = await fetch("/api/jobs/quality_checkpoint/recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: run.runId, expectedStartedAt: run.startedAt }) })
      setResult(response.ok ? "done" : "error")
    } catch { setResult("error") } finally { setBusy(false) }
  }
  return <div className="rounded border border-amber-200 p-3 text-xs space-y-2">
    <p className="break-all">{run.runId} · {run.startedAt}</p>
    <p>{t("creative.checkpoint.recovery.confirm")}</p>
    {result ? <p role="status">{t(`creative.checkpoint.recovery.${result}`)}</p> : <>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} disabled={busy} />{t("creative.checkpoint.recovery.recover")}</label>
      <Button size="sm" variant="outline" disabled={!confirm || busy} onClick={recover}>{t("creative.checkpoint.recovery.recover")}</Button>
    </>}
  </div>
}
