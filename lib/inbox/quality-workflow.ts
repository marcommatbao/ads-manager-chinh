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
import type { HealthAction, HealthObservation, HealthReference, QualityBrief, HealthCheckpoint } from "./quality-workflow-types"

const TTL = 15 * 60_000, CAP = 2000
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
    if (Object.keys(data).some(k => !["version", "references", "actions"].includes(k)) || data.version !== 1 || !Array.isArray(data.references) || !Array.isArray(data.actions)
      || data.references.length > CAP || data.actions.length > CAP || data.references.some(r => !intactReference(r))
      || new Set(data.actions.map(a => a.id)).size !== data.actions.length
      || data.actions.some(a => Object.keys(a).some(k => !["id", "company", "key", "revision", "baseline", "actor", "actionAt", "execution", "observations", "previousRevision"].includes(k))
        || (a.previousRevision !== undefined && typeof a.previousRevision !== "string") || !a.id || !a.revision || !a.actor || !Number.isFinite(Date.parse(a.actionAt))
        || a.execution !== "externally_recorded_unverified" || !intactReference(a.baseline)
        || a.baseline.company !== a.company || a.baseline.key !== a.key || !Array.isArray(a.observations) || a.observations.length > 30
        || a.observations.some(o => Object.keys(o).some(k => !["ref", "at", "actor", "result", "reason", "checkpointDay"].includes(k)) || !intactReference(o.ref) || o.ref.company !== a.company || o.ref.key !== a.key
          || (o.checkpointDay !== undefined && o.checkpointDay !== 3 && o.checkpointDay !== 7)
          || !o.actor || !Number.isFinite(Date.parse(o.at)) || !["listing_observed", "issue_observed", "inconclusive"].includes(o.result)))) throw new Error()
    for (let index = 0; index < data.actions.length; index++) {
      const action = data.actions[index]
      const prior = data.actions.slice(0, index).filter(a => a.company === action.company && a.key === action.key).at(-1)
      if ((prior && action.previousRevision !== prior.revision) || (!prior && action.previousRevision !== undefined)) throw new Error()
    }
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
    const cycles = data.actions.filter(a => a.company === company && a.key === key)
    const action = cycles.at(-1) ?? null
    return { version: "google-source-health-v1", company, key, reference: ref,
      action, history: cycles.slice(0, -1).slice(-5).reverse(), checkpoints: action ? healthCheckpoints(action, now) : [] }
  }))
}
/** Equality is not execution proof or causal improvement. No account/campaign outcome. */
export function assessHealth(baseline: HealthReference, current: HealthReference, actionAt: string, now: Date, previousReadAt?: string | null): Pick<HealthObservation, "result" | "reason"> {
  if (current.company !== baseline.company || current.key !== baseline.key || current.provider !== baseline.provider
    || current.scope !== baseline.scope || current.sourceRef !== baseline.sourceRef) reject("referenceMismatch")
  const at = current.readAt ? Date.parse(current.readAt) : NaN
  if (!Number.isFinite(Date.parse(actionAt)) || Date.parse(actionAt) > +now || !Number.isFinite(+now)) return { result: "inconclusive", reason: "stale_or_unavailable" }
  if (!Number.isFinite(at) || at > Date.parse(current.capturedAt) || at > +now || +now - at >= 3_600_000 || current.health.freshness !== "recent") return { result: "inconclusive", reason: "stale_or_unavailable" }
  if (at <= Date.parse(actionAt) || (baseline.readAt && at <= Date.parse(baseline.readAt)) || (previousReadAt && at <= Date.parse(previousReadAt))) return { result: "inconclusive", reason: "no_new_read" }
  return current.health.outcome === "listing" ? { result: "listing_observed", reason: "fresh_post_action" }
    : current.health.outcome === "failed" || current.evidence ? { result: "issue_observed", reason: "fresh_post_action" }
    : { result: "inconclusive", reason: "stale_or_unavailable" }
}
/** Only explicitly collected, suitable post-deadline snapshots can satisfy a checkpoint. */
export function healthCheckpoints(action: HealthAction, now: Date): HealthCheckpoint[] {
  return ([3, 7] as const).map(day => {
    const due = Date.parse(action.actionAt) + day * 86_400_000
    const attempts = action.observations.filter(o => Date.parse(o.at) >= due && Date.parse(o.at) <= +now)
    const observed = attempts.some(o => o.result !== "inconclusive"
      && Date.parse(o.ref.readAt ?? "") >= due && Date.parse(o.ref.readAt ?? "") > Date.parse(action.actionAt)
      && assessHealth(action.baseline, o.ref, action.actionAt, new Date(o.at)).result !== "inconclusive")
    const status = +now < due ? "not_due" : observed ? "observed" : attempts.length ? "inconclusive" : "due"
    return { day, dueAt: new Date(due).toISOString(), status, overdue: +now > due && !observed }
  })
}
// Capture/expiry/freshness change on re-fetch; source identity does not.
const sourceIdentity = (ref: HealthReference) => hash([ref.company, ref.key, ref.scope, ref.sourceRef, ref.readAt, ref.health.outcome])
export interface WorkflowInput { operation: "record" | "observe" | "new_cycle"; registryId: string; expectedRevision: string | null }
export async function writeQualityAction(company: string, input: WorkflowInput, actor: string, now = new Date()): Promise<HealthAction> {
  return change(now, data => {
    const ref = resolve(data, input.registryId, company, now)
    const cycles = data.actions.filter(a => a.company === company && a.key === ref.key)
    const existing = cycles.at(-1)
    if (input.operation === "new_cycle") {
      const replay = cycles.find(a => a.previousRevision === input.expectedRevision && sourceIdentity(a.baseline) === sourceIdentity(ref))
      if (replay) return replay
    }
    // Retries return the immutable prior write without reapplying it, even with the old revision.
    if (input.operation === "record" && cycles[0] && sourceIdentity(cycles[0].baseline) === sourceIdentity(ref)) return cycles[0]
    if (input.operation === "observe" && existing?.observations.some(o => sourceIdentity(o.ref) === sourceIdentity(ref))) return existing
    if ((existing?.revision ?? null) !== input.expectedRevision) reject("revisionConflict")
    if (input.operation === "record" || input.operation === "new_cycle") {
      if (input.operation === "record" && existing) reject("alreadyRecorded")
      if (input.operation === "new_cycle" && !existing) reject("actionNotFound", 404)
      if (cycles.length >= 20) reject("cycleLimit", 503)
      if (input.operation === "new_cycle" && (cycles.some(a => sourceIdentity(a.baseline) === sourceIdentity(ref))
        || !ref.readAt || !Number.isFinite(Date.parse(ref.readAt)) || Date.parse(ref.readAt) > +now
        || Date.parse(ref.readAt) <= Date.parse(existing!.baseline.readAt ?? existing!.actionAt))) reject("sourceUnchanged")
      if (!ref.evidence || ref.health.outcome === "disabled") reject("notEligible")
      const action: HealthAction = { id: randomUUID(), company, key: ref.key, revision: randomUUID(), baseline: ref,
        ...(existing ? { previousRevision: existing.revision } : {}), actor, actionAt: now.toISOString(), execution: "externally_recorded_unverified", observations: [] }
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

/** Bounded stored-health sweep. Same authority, assessment and file transaction as manual writes.
 * No cross-process lease: deployment must use the existing single-process file-store boundary.
 * A newer source identity permits a retry; the same source/cycle/day is persisted only once.
 */
export async function sweepQualityCheckpoints(companies: string[], snapshot: { google_ads?: ConnectorHealthRecord | null }, now = new Date(), limit = 20) {
  const counts = { examined: 0, observed: 0, inconclusive: 0, skipped: 0, conflicts: 0 }
  const cap = Math.max(0, Math.min(20, Math.floor(limit) || 0))
  if (!cap || !Number.isFinite(+now)) return counts
  // Missing snapshots are no-result: never manufacture checkedAt from sweep time.
  if (!snapshot.google_ads || snapshot.google_ads.status === "disabled") return counts
  const briefs = await qualityBriefs([...new Set(companies)], now, snapshot)
  for (const brief of briefs) {
    if (!brief.action || Date.parse(brief.action.actionAt) > +now) continue
    for (const checkpoint of brief.checkpoints ?? []) {
      if (counts.examined >= cap) return counts
      if (checkpoint.status === "not_due" || checkpoint.status === "observed") continue
      counts.examined++
      const outcome = await change(now, data => {
        const action = data.actions.filter(a => a.company === brief.company && a.key === brief.key).at(-1)
        if (!action || action.id !== brief.action!.id || action.revision !== brief.action!.revision) return "conflicts" as const
        const ref = resolve(data, brief.reference.registryId, brief.company, now)
        if (ref.health.outcome === "disabled" || action.observations.length >= 30) return "skipped" as const
        if (action.observations.some(o => o.checkpointDay === checkpoint.day && sourceIdentity(o.ref) === sourceIdentity(ref))) return "skipped" as const
        const previousReadAt = action.observations.filter(o => o.checkpointDay === undefined || o.checkpointDay === checkpoint.day)
          .map(o => o.ref.readAt).filter((v): v is string => v !== null).sort().at(-1)
        const assessment = assessHealth(action.baseline, ref, action.actionAt, now, previousReadAt)
        if (assessment.result !== "inconclusive" && Date.parse(ref.readAt ?? "") < Date.parse(checkpoint.dueAt)) {
          assessment.result = "inconclusive"; assessment.reason = "no_new_read"
        }
        action.observations.push({ ref, at: now.toISOString(), actor: "job:quality_checkpoint", checkpointDay: checkpoint.day, ...assessment })
        action.revision = randomUUID()
        // Carry our own revision forward for day7, while still detecting external writes.
        brief.action!.revision = action.revision
        return assessment.result === "inconclusive" ? "inconclusive" as const : "observed" as const
      })
      counts[outcome]++
    }
  }
  return counts
}
