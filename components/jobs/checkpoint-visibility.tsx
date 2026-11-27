"use client"
import { useIntlLocale, useT } from "@/lib/i18n/client"
import { checkpointVisibility, checkpointHeartbeat, CHECKPOINT_COUNT_KEYS, type CheckpointState } from "@/lib/jobs/checkpoint-visibility"

export function CheckpointVisibility({ state, scheduler, now = Date.now() }: {
  state: CheckpointState; scheduler?: { status: string; lastTickAt: string | null }; now?: number
}) {
  const t = useT()
  const locale = useIntlLocale()
  const view = checkpointVisibility(state, now)
  const time = (iso: string | null) => iso ? <time dateTime={iso}>{new Date(iso).toLocaleString(locale, { timeZone: "UTC" })} UTC</time> : "—"
  return <section aria-label={t("creative.checkpoint.title")} className="border-t border-slate-100 px-4 py-3 text-xs space-y-2">
    <p className="font-semibold text-slate-800">{t("creative.checkpoint.title")}: {t(`creative.checkpoint.status.${view.status}`)}</p>
    <p className="text-slate-600">{t("creative.checkpoint.schedule")}: {t(`creative.checkpoint.schedule.${view.schedule}`)}</p>
    <p className="text-slate-600">{t("creative.checkpoint.heartbeat")}: {t(`creative.checkpoint.heartbeat.${checkpointHeartbeat(scheduler, now)}`)}</p>
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-slate-600">
      <div><dt>{t("creative.checkpoint.start")}</dt><dd>{time(view.startedAt)}</dd></div>
      <div><dt>{t("creative.checkpoint.finish")}</dt><dd>{time(view.finishedAt)}</dd></div>
    </dl>
    {view.counts ? <dl className="flex flex-wrap gap-x-4 gap-y-1">{CHECKPOINT_COUNT_KEYS.map(key => <div key={key}><dt>{t(`creative.checkpoint.count.${key}`)}</dt><dd>{view.counts![key]}</dd></div>)}</dl> : <p>{t("creative.checkpoint.noCounts")}</p>}
    {view.status === "suspected_stale" && <p className="text-amber-700">{t("creative.checkpoint.suspected")}</p>}
    <p className="text-slate-500">{t("creative.checkpoint.caveat")}</p>
  </section>
}
