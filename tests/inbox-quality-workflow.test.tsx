import React from "react"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ user: vi.fn(), snapshot: vi.fn() }))
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }))
vi.mock("@/lib/case/service", () => ({ CaseError: class extends Error {} }))
vi.mock("@/lib/case/store", () => ({ readCase: vi.fn() }))
vi.mock("@/lib/connectors/engine", () => ({ snapshotAllConnectors: mocks.snapshot }))
vi.mock("@/lib/teams-alert", () => ({ isTeamsAlertConfigured: () => false }))
vi.mock("@/lib/i18n/server", async () => { const { makeT } = await import("@/lib/i18n/translate"); return { getT: async () => makeT("en") } })
let dir: string
let workflow: typeof import("@/lib/inbox/quality-workflow")
let route: typeof import("@/app/api/inbox/quality/route")
const start = new Date("2026-11-26T01:00:00.000Z")
function health(status = "auth_error", at: string | null = start.toISOString()) {
  mocks.snapshot.mockReturnValue({ google_ads: { id: "google_ads", status, configComplete: true, partialConfig: false,
    lastChecked: at, lastSuccess: status === "healthy" ? at : null, maskedConfig: { secret: "PRIVATE" }, failureReason: "PRIVATE" } })
}
const get = (company = "MBC") => route.GET(new NextRequest(`http://localhost/api/inbox/quality?company=${company}`))
const post = (body: unknown) => route.POST(new NextRequest("http://localhost/api/inbox/quality", { method: "POST", body: JSON.stringify(body) }))
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(start)
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "health-loop-")); vi.spyOn(process, "cwd").mockReturnValue(dir)
  mocks.user.mockResolvedValue({ id: "fixture", email: "fixture@example.test", role: "admin", companies: ["MBC"] }); health()
  workflow = await import("@/lib/inbox/quality-workflow"); route = await import("@/app/api/inbox/quality/route")
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }) })
it("actual Inbox -> same scoped brief -> immutable external record -> inconclusive -> newer read -> timeline; idempotent and no auto resolution", async () => {
  const inbox = await import("@/app/api/inbox/route")
  const initial = await (await inbox.GET()).json()
  const brief = (await (await get()).json()).brief
  expect(brief.reference).toEqual(initial.actionBriefs[0].reference)
  expect(brief.key).toBe(initial.items[0].key)
  expect(initial.items[0].evidenceRef.registryId).toBe(brief.reference.registryId)
  expect(brief.reference.evidence).toEqual(initial.items[0].evidence)
  expect(JSON.stringify(initial.actionBriefs)).not.toMatch(/PRIVATE|MBI/)
  const input = { company: "MBC", operation: "record", registryId: brief.reference.registryId, expectedRevision: null }
  const action = (await (await post(input)).json()).action
  expect(action.execution).toBe("externally_recorded_unverified")
  expect(action.actor).toBe("fixture@example.test")
  expect((await (await post(input)).json()).action).toEqual(action)
  vi.setSystemTime(new Date(+start + 1000))
  const observe = { ...input, operation: "observe", expectedRevision: action.revision }
  const first = (await (await post(observe)).json()).action
  expect(first.observations[0].result).toBe("inconclusive")
  expect(first.observations[0].reason).toBe("no_new_read")
  expect((await (await post(observe)).json()).action).toEqual(first)
  vi.setSystemTime(new Date(+start + 60_000)); health("healthy", new Date(+start + 60_000).toISOString())
  const fresh = (await (await get()).json()).brief
  expect(fresh.action.baseline).toEqual(action.baseline)
  expect(fresh.reference.evidence).toBeNull()
  expect((await post({ ...observe, registryId: fresh.reference.registryId })).status).toBe(409)
  const result = await post({ ...observe, registryId: fresh.reference.registryId, expectedRevision: first.revision })
  expect(result.status).toBe(200)
  const latest = (await result.json()).action
  expect(latest.observations.map((o: { result: string }) => o.result)).toEqual(["inconclusive", "listing_observed"])
  expect(latest.baseline).toEqual(action.baseline)
  expect(latest.execution).toBe("externally_recorded_unverified")
  expect(fs.readdirSync(path.join(dir, "data"))).toEqual(["inbox-quality-workflow.json"])
})
it("auth, company and editor checks precede source/store access", async () => {
  mocks.user.mockResolvedValue(null); expect((await get()).status).toBe(401)
  mocks.user.mockResolvedValue({ id: "x", role: "viewer", companies: ["MBC"] })
  expect((await get("MBI")).status).toBe(403)
  expect((await post({ company: "MBC" })).status).toBe(403)
  expect(mocks.snapshot).not.toHaveBeenCalled(); expect(fs.existsSync(path.join(dir, "data"))).toBe(false)
})
it("rejects foreign references, arbitrary client metrics, expired refs and changed evidence", async () => {
  const [mbc, mbi] = await workflow.qualityBriefs(["MBC", "MBI"])
  const input = { company: "MBC", operation: "record", registryId: mbi.reference.registryId, expectedRevision: null }
  expect((await post(input)).status).toBe(409)
  expect((await post({ ...input, registryId: mbc.reference.registryId, observedBudget: 123 })).status).toBe(400)
  health("service_error")
  expect((await post({ ...input, registryId: mbc.reference.registryId })).status).toBe(409)
  vi.setSystemTime(new Date(+start + 16 * 60_000))
  await expect(workflow.writeQualityAction("MBC", { operation: "record", registryId: mbc.reference.registryId, expectedRevision: null }, "fixture")).rejects.toMatchObject({ code: "referenceMismatch" })
})
it("serialized concurrent writes retain one baseline, conflicts do not overwrite, corrupt storage fails closed", async () => {
  const [brief] = await workflow.qualityBriefs(["MBC"])
  const input = { operation: "record" as const, registryId: brief.reference.registryId, expectedRevision: null }
  const results = await Promise.all([workflow.writeQualityAction("MBC", input, "one"), workflow.writeQualityAction("MBC", input, "two")])
  expect(results[0]).toEqual(results[1])
  fs.writeFileSync(path.join(dir, "data/inbox-quality-workflow.json"), "broken")
  expect((await get()).status).toBe(503)
})
it("pure evidence matching rejects cross scope and returns inconclusive for stale, future, missing and pre-action reads", async () => {
  const [brief] = await workflow.qualityBriefs(["MBC"]), base = brief.reference
  for (const patch of [{ company: "MBI" }, { provider: "meta" }, { scope: "company_source" }, { key: "other" }, { sourceRef: "inbox:source" }]) {
    expect(() => workflow.assessHealth(base, { ...base, ...patch } as typeof base, start.toISOString(), start)).toThrow("referenceMismatch")
  }
  for (const readAt of [null, new Date(+start + 1000).toISOString(), new Date(+start - 3_600_000).toISOString(), start.toISOString()]) {
    expect(workflow.assessHealth(base, { ...base, readAt }, start.toISOString(), start).result).toBe("inconclusive")
  }
})
it.each(["vi", "en"] as const)("renders real component with exact reference, timeline and permission (%s)", async locale => {
  const { QualityBriefView } = await import("@/components/inbox/QualityActionBrief")
  const { I18nProvider } = await import("@/lib/i18n/client")
  const [brief] = await workflow.qualityBriefs(["MBC"])
  brief.action = await workflow.writeQualityAction("MBC", { operation: "record", registryId: brief.reference.registryId, expectedRevision: null }, "fixture")
  brief.action = await workflow.writeQualityAction("MBC", { operation: "observe", registryId: brief.reference.registryId, expectedRevision: brief.action.revision }, "fixture")
  const html = renderToStaticMarkup(<I18nProvider locale={locale}><QualityBriefView brief={brief} canEdit={false} /></I18nProvider>)
  expect(html).toContain(brief.reference.registryId)
  expect(html).toContain("/viec-hom-nay#MBC%3Ahealth%3Aconnection_google_ads")
  expect(html).toContain(locale === "en" ? "Inconclusive" : "Chưa đủ bằng chứng kết luận")
  expect(html).toContain(locale === "en" ? "Externally recorded, execution unverified" : "Đã ghi nhận bên ngoài, chưa xác minh thực thi")
  expect(html).not.toContain("<button")
  const editor = renderToStaticMarkup(<I18nProvider locale={locale}><QualityBriefView brief={brief} canEdit busy /></I18nProvider>)
  expect(editor).toContain("disabled")
})
it("atomic failure preserves bytes and baseline; process restart reloads the same action", async () => {
  const [brief] = await workflow.qualityBriefs(["MBC"])
  const action = await workflow.writeQualityAction("MBC", { operation: "record", registryId: brief.reference.registryId, expectedRevision: null }, "fixture")
  const filename = path.join(dir, "data/inbox-quality-workflow.json"), bytes = fs.readFileSync(filename, "utf8")
  const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("fixture failure") })
  expect((await post({ company: "MBC", operation: "observe", registryId: brief.reference.registryId, expectedRevision: action.revision })).status).toBe(503)
  expect(fs.readFileSync(filename, "utf8")).toBe(bytes)
  rename.mockRestore(); vi.resetModules()
  workflow = await import("@/lib/inbox/quality-workflow")
  expect((await workflow.qualityBriefs(["MBC"]))[0].action).toEqual(action)
})
it("healthy baseline is ineligible; fresh failure remains issue_observed, not resolved", async () => {
  health("healthy")
  const [healthy] = await workflow.qualityBriefs(["MBC"])
  await expect(workflow.writeQualityAction("MBC", { operation: "record", registryId: healthy.reference.registryId, expectedRevision: null }, "fixture")).rejects.toMatchObject({ code: "notEligible" })
  health(); const [brief] = await workflow.qualityBriefs(["MBC"])
  const action = await workflow.writeQualityAction("MBC", { operation: "record", registryId: brief.reference.registryId, expectedRevision: null }, "fixture")
  vi.setSystemTime(new Date(+start + 60_000)); health("auth_error", new Date().toISOString())
  const [next] = await workflow.qualityBriefs(["MBC"])
  const observed = await workflow.writeQualityAction("MBC", { operation: "observe", registryId: next.reference.registryId, expectedRevision: action.revision }, "fixture")
  expect(observed.observations[0].result).toBe("issue_observed")
  expect(observed.execution).toBe("externally_recorded_unverified")
})
it("caps observations and preserves action history beyond 90 days", async () => {
  const [brief] = await workflow.qualityBriefs(["MBC"])
  let action = await workflow.writeQualityAction("MBC", { operation: "record", registryId: brief.reference.registryId, expectedRevision: null }, "fixture")
  for (let n = 1; n <= 30; n++) {
    vi.setSystemTime(new Date(+start + n * 60_000)); health("auth_error", new Date().toISOString())
    const [next] = await workflow.qualityBriefs(["MBC"])
    action = await workflow.writeQualityAction("MBC", { operation: "observe", registryId: next.reference.registryId, expectedRevision: action.revision }, "fixture")
  }
  vi.setSystemTime(new Date(+start + 31 * 60_000)); health("auth_error", new Date().toISOString())
  const [next] = await workflow.qualityBriefs(["MBC"])
  await expect(workflow.writeQualityAction("MBC", { operation: "observe", registryId: next.reference.registryId, expectedRevision: action.revision }, "fixture")).rejects.toMatchObject({ code: "observationLimit" })
  vi.setSystemTime(new Date(+start + 91 * 86_400_000)); health()
  const [expired] = await workflow.qualityBriefs(["MBC"])
  expect(expired.action).toEqual(action)
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "data/inbox-quality-workflow.json"), "utf8"))
  expect(saved.references).toHaveLength(1)
  expect(saved.actions).toHaveLength(1)
})
it("rejects future-captured references and throttles a distinct observation without changing history", async () => {
  const [future] = await workflow.qualityBriefs(["MBC"], new Date(+start + 60_000))
  await expect(workflow.writeQualityAction("MBC", { operation: "record", registryId: future.reference.registryId, expectedRevision: null }, "fixture", start)).rejects.toMatchObject({ code: "referenceExpired" })
  vi.setSystemTime(new Date(+start + 60_000))
  const action = await workflow.writeQualityAction("MBC", { operation: "record", registryId: future.reference.registryId, expectedRevision: null }, "fixture")
  const observed = await workflow.writeQualityAction("MBC", { operation: "observe", registryId: future.reference.registryId, expectedRevision: action.revision }, "fixture")
  vi.setSystemTime(new Date(+start + 70_000)); health("service_error", new Date().toISOString())
  const [brief] = await workflow.qualityBriefs(["MBC"])
  expect((await post({ company: "MBC", operation: "observe", registryId: brief.reference.registryId, expectedRevision: observed.revision })).status).toBe(429)
  expect((await workflow.qualityBriefs(["MBC"]))[0].action).toEqual(observed)
})
it("does not count a reread of an older snapshot as a new health observation", async () => {
  const [brief] = await workflow.qualityBriefs(["MBC"])
  const at = new Date(+start + 60_000).toISOString(), now = new Date(+start + 120_000)
  const current = { ...brief.reference, readAt: at, capturedAt: now.toISOString() }
  expect(workflow.assessHealth(brief.reference, current, start.toISOString(), now, at)).toEqual({ result: "inconclusive", reason: "no_new_read" })
  expect(workflow.assessHealth(brief.reference, current, "invalid", now).result).toBe("inconclusive")
  expect(workflow.assessHealth(brief.reference, { ...current, capturedAt: start.toISOString() }, start.toISOString(), now)).toEqual({ result: "inconclusive", reason: "stale_or_unavailable" })
})
it("Inbox evidence and brief use one server read even when the Google record is absent", async () => {
  mocks.snapshot.mockReturnValue({})
  const inbox = await import("@/app/api/inbox/route")
  const data = await (await inbox.GET()).json()
  expect(mocks.snapshot).toHaveBeenCalledTimes(1)
  expect(data.items[0].evidence).toEqual(data.actionBriefs[0].reference.evidence)
  expect(data.items[0].evidenceRef.registryId).toBe(data.actionBriefs[0].reference.registryId)
})

it("route creates two immutable cycles; concurrent actors and reference re-fetch replay once; stale revisions fail", async () => {
  const brief = (await (await get()).json()).brief
  const first = (await (await post({ company: "MBC", operation: "record", registryId: brief.reference.registryId, expectedRevision: null })).json()).action
  const firstBytes = JSON.stringify(first)
  vi.setSystemTime(new Date(+start + 60_000)); health("auth_error", new Date().toISOString())
  const next = (await (await get()).json()).brief
  const input = { company: "MBC", operation: "new_cycle", confirmed: true, registryId: next.reference.registryId, expectedRevision: first.revision }
  const responses = await Promise.all([post(input), post(input)])
  expect(responses.map(r => r.status)).toEqual([200, 200])
  const second = (await responses[0].json()).action
  expect((await responses[1].json()).action).toEqual(second)
  expect(second.id).not.toBe(first.id)
  vi.setSystemTime(new Date(+start + 16 * 60_000))
  const fetched = (await (await get()).json()).brief
  expect(fetched.reference.registryId).not.toBe(input.registryId)
  expect((await (await post({ ...input, registryId: fetched.reference.registryId })).json()).action).toEqual(second)
  expect(fetched.history).toEqual([first]); expect(JSON.stringify(fetched.history[0])).toBe(firstBytes)
  expect((await post({ ...input, registryId: fetched.reference.registryId, expectedRevision: second.revision })).status).toBe(409)
  health("auth_error", new Date().toISOString())
  const third = (await (await get()).json()).brief
  expect((await post({ ...input, registryId: third.reference.registryId })).status).toBe(409)
  expect((await get("MBI")).status).toBe(403)
  expect((await post({ ...input, company: "MBI" })).status).toBe(403)
  expect((await post({ ...input, confirmed: false })).status).toBe(400)
})
it("DAY3/7 use UTC elapsed time and explicit suitable observations only", async () => {
  const [brief] = await workflow.qualityBriefs(["MBC"])
  let action = await workflow.writeQualityAction("MBC", { operation: "record", registryId: brief.reference.registryId, expectedRevision: null }, "fixture")
  const due = +start + 3 * 86_400_000
  expect(workflow.healthCheckpoints(action, new Date(due - 1))[0].status).toBe("not_due")
  expect(workflow.healthCheckpoints(action, new Date(due))[0]).toMatchObject({ status: "due", overdue: false })
  vi.setSystemTime(new Date(due + 1))
  // New capture of an old source cannot satisfy the checkpoint.
  health("healthy", new Date(due - 1).toISOString())
  let [current] = await workflow.qualityBriefs(["MBC"])
  action = await workflow.writeQualityAction("MBC", { operation: "observe", registryId: current.reference.registryId, expectedRevision: action.revision }, "fixture")
  expect(workflow.healthCheckpoints(action, new Date())[0]).toMatchObject({ status: "inconclusive", overdue: true })
  vi.setSystemTime(new Date(due + 60_000)); health("healthy", new Date().toISOString())
  ;[current] = await workflow.qualityBriefs(["MBC"])
  action = await workflow.writeQualityAction("MBC", { operation: "observe", registryId: current.reference.registryId, expectedRevision: action.revision }, "fixture")
  expect(workflow.healthCheckpoints(action, new Date())[0]).toMatchObject({ status: "observed", overdue: false })
  expect(workflow.healthCheckpoints(action, new Date())[1].status).toBe("not_due")
  const day7 = new Date("2026-12-03T08:00:00+07:00")
  expect(workflow.healthCheckpoints(action, day7)[1].status).toBe("due")
  expect(action.execution).toBe("externally_recorded_unverified")
})
it("unknown stored arrays fail closed without rewriting bytes", async () => {
  await get()
  const filename = path.join(dir, "data/inbox-quality-workflow.json")
  const data = JSON.parse(fs.readFileSync(filename, "utf8")); data.futureCycles = []
  const bytes = JSON.stringify(data); fs.writeFileSync(filename, bytes)
  expect((await get()).status).toBe(503)
  expect(fs.readFileSync(filename, "utf8")).toBe(bytes)
})

it("retention caps fail closed and do not delete any live cycle", async () => {
  let brief = (await (await get()).json()).brief
  let action = (await (await post({ company: "MBC", operation: "record", registryId: brief.reference.registryId, expectedRevision: null })).json()).action
  for (let n = 1; n < 20; n++) {
    vi.setSystemTime(new Date(+start + n * 60_000)); health("auth_error", new Date().toISOString())
    brief = (await (await get()).json()).brief
    const response = await post({ company: "MBC", operation: "new_cycle", confirmed: true, registryId: brief.reference.registryId, expectedRevision: action.revision })
    expect(response.status).toBe(200); action = (await response.json()).action
  }
  vi.setSystemTime(new Date(+start + 20 * 60_000)); health("auth_error", new Date().toISOString())
  brief = (await (await get()).json()).brief
  expect(brief.history).toHaveLength(5)
  const filename = path.join(dir, "data/inbox-quality-workflow.json"), bytes = fs.readFileSync(filename, "utf8")
  const response = await post({ company: "MBC", operation: "new_cycle", confirmed: true, registryId: brief.reference.registryId, expectedRevision: action.revision })
  expect(response.status).toBe(503); expect((await response.json()).code).toBe("cycleLimit")
  expect(fs.readFileSync(filename, "utf8")).toBe(bytes)
  expect(JSON.parse(bytes).actions).toHaveLength(20)
})
it("same-process distinct actor CAS keeps one new cycle and freezes earlier observations", async () => {
  const [brief] = await workflow.qualityBriefs(["MBC"])
  const first = await workflow.writeQualityAction("MBC", { operation: "record", registryId: brief.reference.registryId, expectedRevision: null }, "one")
  vi.setSystemTime(new Date(+start + 60_000)); health("auth_error", new Date().toISOString())
  const [next] = await workflow.qualityBriefs(["MBC"])
  const input = { operation: "new_cycle" as const, registryId: next.reference.registryId, expectedRevision: first.revision }
  const [a, b] = await Promise.all([workflow.writeQualityAction("MBC", input, "one"), workflow.writeQualityAction("MBC", input, "two")])
  expect(a).toEqual(b)
  const [saved] = await workflow.qualityBriefs(["MBC"])
  expect(saved.history).toEqual([first])
  await expect(workflow.writeQualityAction("MBI", input, "two")).rejects.toMatchObject({ code: "referenceMismatch" })
})
it("day7 stale and future reads remain inconclusive; unchanged source never creates a new cycle", async () => {
  const [brief] = await workflow.qualityBriefs(["MBC"])
  let action = await workflow.writeQualityAction("MBC", { operation: "record", registryId: brief.reference.registryId, expectedRevision: null }, "one")
  await expect(workflow.writeQualityAction("MBC", { operation: "new_cycle", registryId: brief.reference.registryId, expectedRevision: action.revision }, "one")).rejects.toMatchObject({ code: "sourceUnchanged" })
  const due = +start + 7 * 86_400_000
  for (const [offset, readOffset] of [[0, -3_600_000], [60_000, 120_000]]) {
    vi.setSystemTime(new Date(due + offset)); health("healthy", new Date(due + readOffset).toISOString())
    const [fresh] = await workflow.qualityBriefs(["MBC"])
    action = await workflow.writeQualityAction("MBC", { operation: "observe", registryId: fresh.reference.registryId, expectedRevision: action.revision }, "one")
    expect(action.observations.at(-1)?.result).toBe("inconclusive")
    expect(workflow.healthCheckpoints(action, new Date())[1].status).toBe("inconclusive")
  }
})
