/** Google connector health only. Never binds a global listing check to an account/campaign. */
import fs from "node:fs"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { snapshotAllConnectors } from "@/lib/connectors/engine"
import type { ConnectorHealthRecord } from "@/lib/connectors/types"
import { projectConnectorEvidence } from "@/lib/connectors/evidence"
import { fromGoogleHealth } from "./evidence"
import type { HealthAction, HealthObservation, HealthReference, QualityBrief } from "./quality-workflow-types"

const TTL = 15 * 60_000, KEEP = 90 * 86_400_000, CAP = 2000
const file = () => path.join(process.cwd(), "data", "inbox-quality-workflow.json")
interface Data { version: 1; references: HealthReference[]; actions: HealthAction[] }
export class QualityWorkflowError extends Error {
  constructor(public status: number, public code: string) { super(code) }
}
function reject(code: string, status = 409): never { throw new QualityWorkflowError(status, code) }
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex")
function intactReference(ref: HealthReference): boolean {
  if (!ref || typeof ref.registryId !== "string" || !ref.health || ref.provider !== "google"
    || ref.scope !== "global_connector" || ref.sourceRef !== "connector:google_ads"
    || ref.key !== `${ref.company}:health:connection_google_ads` || ref.readAt !== ref.health.checkedAt
    || !Number.isFinite(Date.parse(ref.capturedAt)) || Date.parse(ref.expiresAt) - Date.parse(ref.capturedAt) !== TTL) return false
  const { registryId, ...payload } = ref
  return registryId === hash(payload)
}
function read(): Data {
  try {
    const data = JSON.parse(fs.readFileSync(file(), "utf8")) as Data
    if (data.version !== 1 || !Array.isArray(data.references) || !Array.isArray(data.actions)
      || data.references.length > CAP || data.actions.length > CAP || data.references.some(r => !intactReference(r))
      || data.actions.some(a => !a.id || !a.revision || !a.actor || !Number.isFinite(Date.parse(a.actionAt))
        || a.execution !== "externally_recorded_unverified" || !intactReference(a.baseline)
        || a.baseline.company !== a.company || a.baseline.key !== a.key || !Array.isArray(a.observations) || a.observations.length > 30
        || a.observations.some(o => !intactReference(o.ref) || o.ref.company !== a.company || o.ref.key !== a.key
          || !o.actor || !Number.isFinite(Date.parse(o.at)) || !["listing_observed", "issue_observed", "inconclusive"].includes(o.result)))) throw new Error()
    return data
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, references: [], actions: [] }
    throw new QualityWorkflowError(503, "storeUnavailable")
  }
}
async function change<T>(now: Date, fn: (data: Data) => T): Promise<T> {
  return withFileLock(file(), async () => {
    const data = read()
    const before = JSON.stringify(data)
    data.references = data.references.filter(r => Date.parse(r.expiresAt) > +now)
    data.actions = data.actions.filter(a => +now - Date.parse(a.actionAt) <= KEEP)
    const result = fn(data)
    if (data.references.length > CAP || data.actions.length > CAP) reject("capacity", 503)
    const serialized = JSON.stringify(data)
    if (serialized !== before) {
      fs.mkdirSync(path.dirname(file()), { recursive: true })
      writeFileAtomicSync(file(), serialized)
    }
    return structuredClone(result)
  })
}
function resolve(data: Data, id: string, company: string, now: Date): HealthReference {
  const ref = data.references.find(r => r.registryId === id && r.company === company)
  if (!ref || ref.provider !== "google" || ref.scope !== "global_connector" || ref.sourceRef !== "connector:google_ads"
    || ref.key !== `${company}:health:connection_google_ads`) reject("referenceMismatch")
  if (!Number.isFinite(Date.parse(ref.capturedAt)) || Date.parse(ref.capturedAt) > +now
    || Date.parse(ref.expiresAt) <= +now || Date.parse(ref.expiresAt) - Date.parse(ref.capturedAt) !== TTL) reject("referenceExpired")
  const { registryId, ...payload } = ref
  if (registryId !== hash(payload)) reject("referenceMismatch")
  return ref
}
/** Call only AFTER authentication and company authorization. Existing engine snapshot; no live IO. */
export async function qualityBriefs(companies: string[], now = new Date(), snapshot?: { google_ads?: ConnectorHealthRecord | null }): Promise<QualityBrief[]> {
  const record = snapshot ? snapshot.google_ads : snapshotAllConnectors().google_ads
  const health = projectConnectorEvidence(record, +now)
  const items = fromGoogleHealth(companies, record ?? null, +now)
  return change(now, data => companies.map<QualityBrief>(company => {
    const key = `${company}:health:connection_google_ads`
    const evidence = items.find(i => i.company === company)?.evidence ?? null
    const identity = { company, key, provider: "google" as const, scope: "global_connector" as const,
      sourceRef: "connector:google_ads" as const, readAt: health.checkedAt, health, evidence }
    let ref = data.references.find(r => r.company === company && Date.parse(r.capturedAt) <= +now && hash({ ...identity }) === hash({ company: r.company, key: r.key, provider: r.provider, scope: r.scope, sourceRef: r.sourceRef, readAt: r.readAt, health: r.health, evidence: r.evidence }))
    if (!ref) {
      const payload = { ...identity, capturedAt: now.toISOString(), expiresAt: new Date(+now + TTL).toISOString() }
      ref = { ...payload, registryId: hash(payload) }
      data.references.push(ref)
    }
    return { version: "google-source-health-v1", company, key, reference: ref,
      action: data.actions.find(a => a.company === company && a.key === key) ?? null }
  }))
}
/** Equality is not execution proof or causal improvement. No account/campaign outcome. */
export function assessHealth(baseline: HealthReference, current: HealthReference, actionAt: string, now: Date, previousReadAt?: string | null): Pick<HealthObservation, "result" | "reason"> {
  if (current.company !== baseline.company || current.key !== baseline.key || current.provider !== baseline.provider
    || current.scope !== baseline.scope || current.sourceRef !== baseline.sourceRef) reject("referenceMismatch")
  const at = current.readAt ? Date.parse(current.readAt) : NaN
  if (!Number.isFinite(Date.parse(actionAt)) || Date.parse(actionAt) > +now || !Number.isFinite(+now)) return { result: "inconclusive", reason: "stale_or_unavailable" }
  if (!Number.isFinite(at) || at > +now || +now - at >= 3_600_000 || current.health.freshness !== "recent") return { result: "inconclusive", reason: "stale_or_unavailable" }
  if (at <= Date.parse(actionAt) || (baseline.readAt && at <= Date.parse(baseline.readAt)) || (previousReadAt && at <= Date.parse(previousReadAt))) return { result: "inconclusive", reason: "no_new_read" }
  return current.health.outcome === "listing" ? { result: "listing_observed", reason: "fresh_post_action" }
    : current.health.outcome === "failed" || current.evidence ? { result: "issue_observed", reason: "fresh_post_action" }
    : { result: "inconclusive", reason: "stale_or_unavailable" }
}
export interface WorkflowInput { operation: "record" | "observe"; registryId: string; expectedRevision: string | null }
export async function writeQualityAction(company: string, input: WorkflowInput, actor: string, now = new Date()): Promise<HealthAction> {
  return change(now, data => {
    const ref = resolve(data, input.registryId, company, now)
    const existing = data.actions.find(a => a.company === company && a.key === ref.key)
    // Retries return the immutable prior write without reapplying it, even with the old revision.
    if (input.operation === "record" && existing?.baseline.registryId === ref.registryId) return existing
    if (input.operation === "observe" && existing?.observations.some(o => o.ref.registryId === ref.registryId)) return existing
    if ((existing?.revision ?? null) !== input.expectedRevision) reject("revisionConflict")
    if (input.operation === "record") {
      if (existing) reject("alreadyRecorded")
      if (!ref.evidence || ref.health.outcome === "disabled") reject("notEligible")
      const action: HealthAction = { id: randomUUID(), company, key: ref.key, revision: randomUUID(), baseline: ref,
        actor, actionAt: now.toISOString(), execution: "externally_recorded_unverified", observations: [] }
      data.actions.push(action)
      return action
    }
    if (!existing) reject("actionNotFound", 404)
    if (existing.observations.length >= 30) reject("observationLimit")
    if (existing.observations.length && +now - Date.parse(existing.observations.at(-1)!.at) < 30_000) reject("recheckThrottled", 429)
    const previousReadAt = existing.observations.map(o => o.ref.readAt).filter((at): at is string => at !== null).sort().at(-1)
    const assessment = assessHealth(existing.baseline, ref, existing.actionAt, now, previousReadAt)
    existing.observations.push({ ref, at: now.toISOString(), actor, ...assessment })
    existing.revision = randomUUID()
    return existing
  })
}
