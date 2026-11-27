import React from "react"
import fs from "node:fs"
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { checkpointVisibility, checkpointCounts, checkpointHeartbeat, type CheckpointState } from "@/lib/jobs/checkpoint-visibility"
import { CheckpointVisibility } from "@/components/jobs/checkpoint-visibility"
import { I18nProvider } from "@/lib/i18n/client"
const now = Date.parse("2026-11-27T01:00:00Z")
const iso = (delta: number) => new Date(now + delta).toISOString()
const summary = "examined=4; observed=1; inconclusive=1; skipped=1; conflicts=1"
const base: CheckpointState = { enabled: true, lastRun: null, intervalMs: 3600000, nextExpectedAt: iso(60000), isStale: false }
const run = (status: NonNullable<CheckpointState["lastRun"]>["status"], delta = -60000): CheckpointState => ({ ...base, lastRun: { status, startedAt: iso(delta), finishedAt: status === "running" ? null : iso(-1000), resultSummary: summary } })
describe("checkpoint stored evidence projection", () => {
  it("keeps duration aligned with the registered checkpoint without importing server modules", () => {
    const source = fs.readFileSync("lib/jobs/registry.ts", "utf8")
    const checkpoint = source.slice(source.indexOf('id: "quality_checkpoint"'), source.indexOf('id: "playbook_meta_sync"'))
    expect(checkpoint).toContain("maxDurationSec: 60")
    expect(checkpoint).toContain("defaultEnabled: false")
  })
  it.each([
    [{ ...base, enabled: false }, "disabled"], [base, "never_run"],
    [run("success"), "success"], [run("failure"), "failure"], [run("skipped"), "skipped"], [run("preflight_failed"), "preflight_failed"],
    [run("running", -60000), "running"], [run("running", -60001), "suspected_stale"],
    [run("running", 1), "unknown"], [{ ...run("running"), lastRun: { ...run("running").lastRun!, startedAt: "bad" } }, "unknown"],
    [{ ...run("running", -60001), enabled: false }, "disabled"],
  ])("projects status %#", (state, expected) => {
    expect(checkpointVisibility(state as CheckpointState, now).status).toBe(expected)
  })
  it.each([
    [base, "expected"], [{ ...base, nextExpectedAt: iso(0) }, "expected"], [{ ...base, nextExpectedAt: iso(-1) }, "overdue"],
    [{ ...base, isStale: true }, "stale"], [{ ...base, intervalMs: null }, "unknown"],
    [{ ...base, nextExpectedAt: "bad" }, "unknown"], [{ ...base, enabled: false, isStale: true }, "disabled"],
  ])("projects schedule %#", (state, expected) => expect(checkpointVisibility(state, now).schedule).toBe(expected))
  it("keeps real timestamps only and never synthesizes finish", () => {
    const running = run("running")
    expect(checkpointVisibility(running, now)).toMatchObject({ startedAt: iso(-60000), finishedAt: null })
    expect(checkpointVisibility(run("success"), now).finishedAt).toBe(iso(-1000))
    for (const finish of [null, "bad", iso(1), iso(-60001)]) {
      const projected = checkpointVisibility({ ...run("success"), lastRun: { ...run("success").lastRun!, finishedAt: finish } }, now)
      expect(projected.finishedAt).toBeNull()
      expect(projected.status).toBe("unknown")
    }
  })
  it("parses only a complete unique safe integer count set", () => {
    expect(checkpointCounts(summary)).toEqual({ examined: 4, observed: 1, inconclusive: 1, skipped: 1, conflicts: 1 })
    expect(checkpointCounts(summary.replaceAll(/\d/g, "0"))?.examined).toBe(0)
    for (const bad of [null, "", summary + "; secret=value", summary.replace("observed=1", "examined=1"), summary.replace("observed=1", "observed=-1"), summary.replace("observed=1", "observed=1.5"), summary.replace("observed=1", "observed=9007199254740992"), "x".repeat(257), summary.replace("observed=1; ", "")]) expect(checkpointCounts(bad)).toBeNull()
  })
  it.each([
    [undefined, "unknown"], [{ status: "ok", lastTickAt: iso(-300000) }, "ok"],
    [{ status: "ok", lastTickAt: iso(-300001) }, "unknown"], [{ status: "ok", lastTickAt: null }, "unknown"],
    [{ status: "ok", lastTickAt: iso(1) }, "unknown"], [{ status: "stale", lastTickAt: iso(-400000) }, "stale"],
    [{ status: "never", lastTickAt: null }, "never"], [{ status: "warming_up", lastTickAt: null }, "warming_up"],
  ])("separates heartbeat %#", (heartbeat, expected) => expect(checkpointHeartbeat(heartbeat, now)).toBe(expected))
})
for (const locale of ["vi", "en"] as const) {
  it(`renders real Jobs checkpoint consumer in ${locale}, count-only and no controls`, () => {
    const render = (state: CheckpointState) => renderToStaticMarkup(<I18nProvider locale={locale}><CheckpointVisibility state={state} now={now} /></I18nProvider>)
    const html = render(run("success"))
    expect(html).toContain('dateTime="' + iso(-60000) + '"')
    expect(html).toContain('dateTime="' + iso(-1000) + '"')
    expect(html).toContain(locale === "en" ? "Observed" : "Đã quan sát")
    expect(html).toContain(locale === "en" ? "stored snapshots only" : "ảnh nguồn đã lưu")
    expect(html).not.toContain("<button")
    const malformed = render({ ...run("success"), lastRun: { ...run("success").lastRun!, resultSummary: "secret=PRIVATE" } })
    expect(malformed).not.toContain("PRIVATE")
    expect(malformed).toContain(locale === "en" ? "No valid count" : "Chưa có tóm tắt")
    const matrix = [
      [base, locale === "en" ? "Never run" : "Chưa từng chạy"],
      [{ ...base, enabled: false }, locale === "en" ? "Disabled" : "Đang tắt"],
      [run("failure"), locale === "en" ? "Last run failed" : "Lần cuối thất bại"],
      [run("running"), locale === "en" ? "Running" : "Đang chạy"],
      [run("running", -60001), locale === "en" ? "Suspected stale" : "Nghi treo"],
    ] as const
    for (const [state, expected] of matrix) {
      expect(render(state)).toContain(expected)
      expect(render(state)).not.toContain("creative.checkpoint.")
    }
  })
}
