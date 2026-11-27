import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { beforeEach, afterEach, it, expect, vi } from "vitest"
const mocks = vi.hoisted(() => ({ snapshot: vi.fn() }))
vi.mock("@/lib/connectors/engine", () => ({ snapshotAllConnectors: mocks.snapshot }))
let dir: string
let w: typeof import("@/lib/inbox/quality-workflow")
let store: typeof import("@/lib/jobs/store")
const start = new Date("2026-11-01T00:00:00.000Z")
const due = new Date(+start + 3 * 86400000)
function record(at = start, status: import("@/lib/connectors/types").ConnectorStatus = "auth_error"): import("@/lib/connectors/types").ConnectorHealthRecord {
  return { id: "google_ads", status, configComplete: true, partialConfig: false, lastChecked: at.toISOString(), lastSuccess: status === "healthy" ? at.toISOString() : null, lastFailure: null, failureCategory: null, maskedConfig: { secret: "PRIVATE" }, failureReason: "PRIVATE" }
}
async function seed(company = "MBC") {
  const [b] = await w.qualityBriefs([company], start, { google_ads: record() })
  return w.writeQualityAction(company, { operation: "record", registryId: b.reference.registryId, expectedRevision: null }, "synthetic", start)
}
const disk = () => JSON.parse(fs.readFileSync(path.join(dir, "data/inbox-quality-workflow.json"), "utf8"))
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-")); vi.spyOn(process, "cwd").mockReturnValue(dir)
  w = await import("@/lib/inbox/quality-workflow"); store = await import("@/lib/jobs/store")
})
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }) })
it("default OFF blocks before source/store work and appears OFF in job controls", async () => {
  const { runQualityCheckpoint } = await import("@/lib/jobs/quality-checkpoint")
  expect(store.getJobControl("quality_checkpoint").enabled).toBe(false)
  expect(store.getAllJobControls().quality_checkpoint?.enabled).toBe(false)
  expect((await runQualityCheckpoint()).status).toBe(423)
  expect(mocks.snapshot).not.toHaveBeenCalled(); expect(fs.readdirSync(dir)).toEqual([])
})
it("enabled handler uses real history/runId, count-only audit and existing tick registry", async () => {
  await seed(); const { dueJobs } = await import("@/lib/jobs/tick")
  expect(dueJobs(new Date("2026-11-04T00:25:00Z")).some(j => j.id === "quality_checkpoint")).toBe(true)
  await store.saveJobControl({ ...store.getJobControl("quality_checkpoint"), enabled: true })
  mocks.snapshot.mockReturnValue({ google_ads: record(new Date(), "healthy") })
  const { runQualityCheckpoint } = await import("@/lib/jobs/quality-checkpoint")
  const response = await runQualityCheckpoint("test")
  expect(response.status).toBe(200)
  const body = await response.json(); expect(body.runId).toBeTruthy()
  const [history] = store.getJobHistory("quality_checkpoint")
  expect(history.status).toBe("success"); expect(history.runId).toBe(body.runId)
  expect(history.resultSummary).toMatch(/^examined=\d+; observed=/)
  expect(JSON.stringify(history)).not.toMatch(/PRIVATE|synthetic|MBC|registryId/)
})
it("non-due and wrong company do no observations; missing/disabled snapshots no result", async () => {
  await seed()
  for (const snapshot of [{}, { google_ads: record(start, "disabled") }]) {
    expect((await w.sweepQualityCheckpoints(["MBC"], snapshot, due)).examined).toBe(0)
  }
  await w.sweepQualityCheckpoints(["MBI"], { google_ads: record(due) }, due)
  await w.sweepQualityCheckpoints(["MBC"], { google_ads: record(start) }, start)
  expect(disk().actions[0].observations).toEqual([])
})
it("overlap, retries and module restart retain one source/cycle/day observation; newer read retries", async () => {
  await seed()
  const overlap = await Promise.all([1, 2].map(() => w.sweepQualityCheckpoints(["MBC"], { google_ads: record() }, due)))
  expect(overlap.reduce((n, c) => n + c.conflicts, 0)).toBe(1)
  expect(disk().actions[0].observations).toHaveLength(1)
  expect(disk().actions[0].observations[0]).toMatchObject({ result: "inconclusive", reason: "stale_or_unavailable", checkpointDay: 3 })
  vi.resetModules(); w = await import("@/lib/inbox/quality-workflow")
  await w.sweepQualityCheckpoints(["MBC"], { google_ads: record() }, due)
  expect(disk().actions[0].observations).toHaveLength(1)
  await w.sweepQualityCheckpoints(["MBC"], { google_ads: record(due, "healthy") }, due)
  expect(disk().actions[0].observations).toHaveLength(2)
  expect(disk().actions[0].observations[1].result).toBe("listing_observed")
  expect(JSON.stringify(disk())).not.toContain("PRIVATE")
})
it("batch cap is hard, day7 distinct, saved manual revision conflicts never overwrite", async () => {
  const action = await seed()
  const day7 = new Date(+start + 7 * 86400000)
  expect((await w.sweepQualityCheckpoints(["MBC"], { google_ads: record() }, day7, 1)).examined).toBe(1)
  expect(disk().actions[0].observations).toHaveLength(1)
  await w.sweepQualityCheckpoints(["MBC"], { google_ads: record() }, day7)
  expect(disk().actions[0].observations.map((o: { checkpointDay: number }) => o.checkpointDay)).toEqual([3, 7])
  const [brief] = await w.qualityBriefs(["MBC"], day7, { google_ads: record(day7) })
  await expect(w.writeQualityAction("MBC", { operation: "observe", registryId: brief.reference.registryId, expectedRevision: action.revision }, "manual", day7)).rejects.toMatchObject({ code: "revisionConflict" })
  expect(disk().actions[0].observations).toHaveLength(2)
})

it("pre-deadline and future source timestamps cannot satisfy due checkpoints", async () => {
  await seed()
  for (const at of [new Date(+due - 1), new Date(+due + 1)]) {
    await w.sweepQualityCheckpoints(["MBC"], { google_ads: record(at, "healthy") }, due)
  }
  expect(disk().actions[0].observations.every((o: { result: string }) => o.result === "inconclusive")).toBe(true)
  const [brief] = await w.qualityBriefs(["MBC"], due, { google_ads: record(due) })
  expect(brief.checkpoints?.[0].status).toBe("inconclusive")
})
it("job overlap uses existing guard and failure history is sanitized", async () => {
  await seed()
  await store.saveJobControl({ ...store.getJobControl("quality_checkpoint"), enabled: true })
  mocks.snapshot.mockReturnValue({ google_ads: record() })
  const { runQualityCheckpoint } = await import("@/lib/jobs/quality-checkpoint")
  const results = await Promise.all([runQualityCheckpoint(), runQualityCheckpoint()])
  expect(results.map(r => r.status).sort()).toEqual([200, 409])
  mocks.snapshot.mockImplementation(() => { throw new Error("PRIVATE") })
  expect((await runQualityCheckpoint()).status).toBe(503)
  expect(store.getJobHistory("quality_checkpoint")[0].errorSummary).toBe("quality_checkpoint_failed")
})

it("one suitable day7 snapshot can satisfy both due checkpoints without causal claims", async () => {
  await seed()
  const day7 = new Date(+start + 7 * 86400000)
  const result = await w.sweepQualityCheckpoints(["MBC"], { google_ads: record(day7, "healthy") }, day7)
  expect(result.observed).toBe(2)
  expect(disk().actions[0].execution).toBe("externally_recorded_unverified")
  const [brief] = await w.qualityBriefs(["MBC"], day7, { google_ads: record(day7, "healthy") })
  expect(brief.checkpoints?.map(c => c.status)).toEqual(["observed", "observed"])
})

it("a stored record without trusted read time stays inconclusive and null", async () => {
  await seed()
  const missing = { ...record(), lastChecked: null }
  await w.sweepQualityCheckpoints(["MBC"], { google_ads: missing }, due)
  const observation = disk().actions[0].observations[0]
  expect(observation.result).toBe("inconclusive")
  expect(observation.ref.readAt).toBeNull()
  expect(observation.reason).toBe("stale_or_unavailable")
})

it("expired history acknowledgement survives restart; later stored-only sweeps retain dedup", async () => {
  await seed()
  const startedAt = new Date(Date.now() - 120000).toISOString()
  await store.appendJobRun({ jobId: "quality_checkpoint", runId: "crashed", status: "running", startedAt, finishedAt: null, durationMs: null, resultSummary: null, errorSummary: null, triggeredBy: "synthetic" })
  // Simulate observation persisted before crash but no successful run finish.
  await w.sweepQualityCheckpoints(["MBC"], { google_ads: record() }, due)
  expect(await store.acknowledgeExpiredCheckpoint("crashed", startedAt, "synthetic")).toBe(true)
  vi.resetModules()
  store = await import("@/lib/jobs/store"); w = await import("@/lib/inbox/quality-workflow")
  await w.sweepQualityCheckpoints(["MBC"], { google_ads: record() }, due)
  expect(disk().actions[0].observations).toHaveLength(1)
  expect(store.getJobHistory("quality_checkpoint")[0].status).toBe("abandoned")
  expect(store.getJobControl("quality_checkpoint").enabled).toBe(false)
  expect(mocks.snapshot).not.toHaveBeenCalled()
})
