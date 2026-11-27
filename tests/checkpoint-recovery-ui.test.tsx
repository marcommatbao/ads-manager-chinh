import React from "react"
import { expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CheckpointRecovery } from "@/components/jobs/checkpoint-recovery"
import { I18nProvider } from "@/lib/i18n/client"
const now = Date.parse("2026-11-27T01:00:00Z")
const run = { runId: "synthetic-crashed-run", startedAt: new Date(now - 60001).toISOString(), finishedAt: null, durationMs: null }
it.each(["vi", "en"] as const)("expired recovery fixture %s requires explicit confirmation", locale => {
  const html = renderToStaticMarkup(<I18nProvider locale={locale}><CheckpointRecovery run={run} now={now} /></I18nProvider>)
  expect(html).toContain("synthetic-crashed-run")
  expect(html).toContain('type="checkbox"')
  expect(html).toMatch(/<button[^>]*disabled/)
  expect(html).not.toContain("creative.checkpoint.recovery")
})
it("does not offer recovery at exact threshold or invalid start", () => {
  for (const startedAt of [new Date(now - 60000).toISOString(), "bad", new Date(now + 1).toISOString()]) {
    expect(renderToStaticMarkup(<I18nProvider locale="en"><CheckpointRecovery run={{ ...run, startedAt }} now={now} /></I18nProvider>)).toBe("")
  }
})
