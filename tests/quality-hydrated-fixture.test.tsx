import React from "react"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { renderToString } from "react-dom/server"
import { it, vi, expect } from "vitest"
vi.mock("@/lib/connectors/engine", () => ({ snapshotAllConnectors: () => ({}) }))
it("prepares deterministic SSR fixture for real component hydration, synthetic store only", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-browser-store-"))
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir)
  try {
    const w = await import("@/lib/inbox/quality-workflow")
    const at = new Date("2026-11-01T00:00:00.000Z")
    const [brief] = await w.qualityBriefs(["MBC"], at, { google_ads: { id: "google_ads", status: "auth_error", configComplete: true, partialConfig: false, lastChecked: at.toISOString(), lastSuccess: null, lastFailure: null, failureReason: null, failureCategory: null, maskedConfig: {} } })
    brief.action = await w.writeQualityAction("MBC", { operation: "record", registryId: brief.reference.registryId, expectedRevision: null }, "fixture@example.test", at)
    // Normalize random write identifiers: this fixture is not a workflow authority input.
    brief.action.id = "synthetic-cycle"; brief.action.revision = "synthetic-revision"
    const { Fixture } = await import("./fixtures/quality-hydrated")
    const html = renderToString(<Fixture />)
    expect(html).toContain("role=\"status\"")
    fs.mkdirSync("/tmp/ads-quality-hydrated", { recursive: true })
    fs.writeFileSync("/tmp/ads-quality-hydrated/index.html", `<!doctype html><meta charset="utf-8"><div id="root">${html}</div><script>window.fixture=${JSON.stringify(brief)};</script><script type="module" src="./fixture.js"></script>`)
  } finally { cwd.mockRestore(); fs.rmSync(dir, { recursive: true, force: true }) }
})
