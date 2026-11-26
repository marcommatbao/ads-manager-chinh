import type { InboxEvidence } from "./evidence"
import type { projectConnectorEvidence } from "@/lib/connectors/evidence"

export interface HealthReference {
  registryId: string
  company: string
  key: string
  provider: "google"
  scope: "global_connector"
  sourceRef: "connector:google_ads"
  capturedAt: string
  expiresAt: string
  readAt: string | null
  health: ReturnType<typeof projectConnectorEvidence>
  evidence: InboxEvidence | null
}
export interface HealthObservation {
  ref: HealthReference
  at: string
  actor: string
  result: "listing_observed" | "issue_observed" | "inconclusive"
  reason: "fresh_post_action" | "no_new_read" | "stale_or_unavailable"
}
export interface HealthAction {
  id: string
  previousRevision?: string
  company: string
  key: string
  revision: string
  baseline: HealthReference
  actor: string
  actionAt: string
  execution: "externally_recorded_unverified"
  observations: HealthObservation[]
}
export interface QualityBrief {
  version: "google-source-health-v1"
  company: string
  key: string
  reference: HealthReference
  action: HealthAction | null
  history?: HealthAction[]
  checkpoints?: HealthCheckpoint[]
}

export interface HealthCheckpoint {
  day: 3 | 7
  dueAt: string
  status: "not_due" | "due" | "inconclusive" | "observed"
  overdue: boolean
}
