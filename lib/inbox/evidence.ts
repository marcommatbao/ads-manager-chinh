// Client-safe evidence vocabulary. Wording is proposed pending BA review.
import type { ConnectorHealthRecord } from "@/lib/connectors/types"
import { projectConnectorEvidence } from "@/lib/connectors/evidence"
import type { Company } from "@/lib/case/types"
import type { InboxItem, InboxSource } from "./build"
import { makeT, type TFunction } from "@/lib/i18n/translate"

export type QualityReason = "auth_error" | "service_error" | "missing" | "stale" | "never_checked" | "recheck" | "source_error"
export interface InboxEvidence {
  type: "data_quality"
  sourceRef: "connector:google_ads" | "inbox:source"
  /** Global connector checks do not prove company/account data access. */
  scope: "global_connector" | "company_source"
  reasonCode: QualityReason
  checkedAt: string | null
  nextCheck: "connection" | "source"
}
export function qualityText(e: InboxEvidence, t: TFunction = makeT("vi")) {
  return {
    title: t("overview.inboxQuality.title"),
    why: t(`overview.inboxQuality.${e.reasonCode}`),
    next: t(e.nextCheck === "connection" ? "overview.inboxQuality.nextConnection" : "overview.inboxQuality.nextSource"),
    hrefLabel: t("overview.inboxQuality.open"),
  }
}
function qualityItem(company: Company, source: InboxSource, key: string, evidence: InboxEvidence): InboxItem {
  const text = qualityText(evidence)
  return { key, company, source, kind: 1, title: text.title, why: text.why,
    money: null, moneyLabel: null, campaignIds: [], evidence,
    href: evidence.nextCheck === "connection" ? "/settings/health" : source === "pmax" ? "/google-pmax?tab=xray" : source === "search" ? "/google-search?tab=xray" : source === "meta" ? "/meta-xray" : "/settings/health",
    hrefLabel: text.hrefLabel }
}
/** Input MUST be the engine snapshot, never a raw disk record. No provider IO. */
export function fromGoogleHealth(companies: Company[], record: ConnectorHealthRecord | null, now = Date.now()): InboxItem[] {
  const e = projectConnectorEvidence(record, now)
  if (e.outcome === "listing" || e.outcome === "disabled") return []
  const reasonCode: QualityReason = record?.status === "auth_error" ? "auth_error"
    : record?.status === "service_error" ? "service_error"
    : e.configuration === "missing" || e.configuration === "partial" ? "missing"
    : e.freshness === "stale" ? "stale" : e.freshness === "never" ? "never_checked" : "recheck"
  return [...new Set(companies)].map(co => qualityItem(co, "health", `${co}:health:connection_google_ads`, {
    type: "data_quality", sourceRef: "connector:google_ads", scope: "global_connector", reasonCode,
    checkedAt: e.checkedAt, nextCheck: "connection",
  }))
}
/** Source failures have no observation time: build time is not source read time. */
export function fromSourceErrors(companies: Company[], errors: { company: Company | "ALL"; source: InboxSource }[]): InboxItem[] {
  const items = new Map<string, InboxItem>()
  for (const co of new Set(companies)) for (const error of errors) {
    if (error.company !== "ALL" && error.company !== co) continue
    const key = `${co}:${error.source}:source_unavailable`
    items.set(key, qualityItem(co, error.source, key, { type: "data_quality", sourceRef: "inbox:source", scope: "company_source", reasonCode: "source_error", checkedAt: null, nextCheck: "source" }))
  }
  return [...items.values()]
}
