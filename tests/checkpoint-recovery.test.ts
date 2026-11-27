import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { beforeEach, afterEach, it, expect, vi } from "vitest"
import { NextRequest } from "next/server"
const auth = vi.hoisted(() => ({ user: vi.fn() }))
vi.mock("@/lib/auth", () => ({ getCurrentUser: auth.user }))
vi.mock("@/lib/permissions", () => ({ isSuperAdmin: (role: string) => role === "super_admin" }))
let dir: string
let store: typeof import("@/lib/jobs/store")
let post: typeof import("@/app/api/jobs/[id]/recover/route").POST
const at = new Date(Date.now() - 120000).toISOString()
const run = (startedAt = at): import("@/lib/jobs/types").JobRunRecord => ({ jobId: "quality_checkpoint", runId: "original", status: "running", startedAt, finishedAt: null, durationMs: null, resultSummary: null, errorSummary: null, triggeredBy: "cron" })
const request = (runId = "original", expectedStartedAt = at, id = "quality_checkpoint") => post(new NextRequest("http://localhost/api/jobs/quality_checkpoint/recover", { method: "POST", body: JSON.stringify({ runId, expectedStartedAt }) }), { params: Promise.resolve({ id }) })
beforeEach(async () => {
  vi.resetModules()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-recovery-"))
  vi.spyOn(process, "cwd").mockReturnValue(dir)
  vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("network forbidden") })
  auth.user.mockResolvedValue({ role: "super_admin", email: "synthetic@example.test" })
  store = await import("@/lib/jobs/store")
  post = (await import("@/app/api/jobs/[id]/recover/route")).POST
})
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }) })
it("auth precedes corrupt store, only checkpoint supported", async () => {
  fs.mkdirSync(path.join(dir, "data")); fs.writeFileSync(path.join(dir, "data/job-history.json"), "broken")
  auth.user.mockResolvedValue(null); expect((await request()).status).toBe(401)
  auth.user.mockResolvedValue({ role: "viewer" }); expect((await request()).status).toBe(403)
  auth.user.mockResolvedValue({ role: "super_admin", email: "synthetic" })
  expect((await request("original", at, "nba_engine")).status).toBe(400)
  expect((await request()).status).toBe(503)
  expect(fs.readFileSync(path.join(dir, "data/job-history.json"), "utf8")).toBe("broken")
})
it("one concurrent CAS winner retains original evidence after restart and OFF", async () => {
  const original = run(); await store.appendJobRun(original)
  expect((await request("stale")).status).toBe(409)
  expect((await request("original", new Date().toISOString())).status).toBe(409)
  const results = await Promise.all([request(), request()]); expect(results.map(r => r.status).sort()).toEqual([200, 409])
  vi.resetModules(); store = await import("@/lib/jobs/store")
  const records = store.getJobHistory("quality_checkpoint")
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ status: "abandoned", finishedAt: null, durationMs: null, recovery: { original, acknowledgedBy: "synthetic@example.test" } })
  await store.updateJobRun("quality_checkpoint", "original", { status: "success" })
  expect(store.getJobHistory("quality_checkpoint")[0].status).toBe("abandoned")
  expect(store.getJobControl("quality_checkpoint").enabled).toBe(false)
  expect((await request()).status).toBe(409)
})
it.each(["bad", new Date(Date.now() + 100000).toISOString(), new Date().toISOString()])("refuses malformed/future/young start %s", async time => {
  await store.appendJobRun(run(time)); expect((await request("original", time)).status).toBe(409)
  expect(store.getJobHistory("quality_checkpoint")[0].status).toBe("running")
})
it("refuses known active same-process work even if expired", async () => {
  await store.appendJobRun(run())
  const { RUNNING_JOBS } = await import("@/lib/jobs/execution-state")
  RUNNING_JOBS.add("quality_checkpoint")
  expect((await request()).status).toBe(409)
  expect(RUNNING_JOBS.has("quality_checkpoint")).toBe(true)
})
it("corrupt controls/history fail closed without overwriting", async () => {
  fs.mkdirSync(path.join(dir, "data"))
  for (const [name, content] of [["job-history.json", '{"history":{"quality_checkpoint":{}}}'], ["job-control.json", "broken"]]) fs.writeFileSync(path.join(dir, "data", name), content)
  expect(() => store.getJobHistory("quality_checkpoint")).toThrow()
  expect(() => store.getJobControl("quality_checkpoint")).toThrow()
  expect((await request()).status).toBe(503)
})
