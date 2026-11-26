import Link from "next/link"
import { qualityText, type InboxEvidence } from "@/lib/inbox/evidence"
import type { TFunction } from "@/lib/i18n/translate"

/** Read-only disclosure; workflow controls remain owned by the existing card. */
export function SourceEvidence({ evidence, href, hrefLabel, t, reference }: { reference?: { registryId: string; capturedAt: string }; evidence: InboxEvidence; href: string; hrefLabel: string; t: TFunction }) {
  return (
    <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
      <p>{t(evidence.scope === "global_connector" ? "overview.inboxQuality.global" : "overview.inboxQuality.company")}</p>
      <p>{evidence.checkedAt ? <>{t("overview.inboxQuality.checkedAt")}: <time dateTime={evidence.checkedAt}>{new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(new Date(evidence.checkedAt))} (UTC+07:00)</time></> : t("overview.inboxQuality.unknownTime")}</p>
      <p>{qualityText(evidence, t).next}</p>
      {reference && <p className="break-all">{evidence.sourceRef} · {reference.registryId} · <time dateTime={reference.capturedAt}>{reference.capturedAt}</time></p>}
      <Link className="inline-block underline focus-visible:outline-2" href={href}>{hrefLabel} →</Link>
    </div>
  )
}
