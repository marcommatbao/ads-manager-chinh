import React from "react"
import { hydrateRoot } from "react-dom/client"
import { SWRConfig } from "swr"
import { I18nProvider } from "@/lib/i18n/client"
import { QualityActionBrief } from "@/components/inbox/QualityActionBrief"
import type { QualityBrief } from "@/lib/inbox/quality-workflow-types"

export function Fixture() {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0, revalidateOnFocus: false }}><I18nProvider locale="en"><QualityActionBrief /></I18nProvider></SWRConfig>
}
// Entire API is synthetic and in-memory. Any unexpected fetch fails closed.
if (typeof window !== "undefined") {
  const state = window as unknown as { fixture: QualityBrief; calls: unknown[]; ready: boolean }
  state.calls = []
  const mode = new URLSearchParams(location.search).get("mode")
  if (mode === "proposed") state.fixture.action = null
  window.fetch = async (input, init) => {
    const url = String(input)
    state.calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (mode === "loading") return new Promise<Response>(() => {})
    if (mode === "error") return new Response("{}", { status: 503 })
    if (url === "/api/inbox") return Response.json({ success: true, actionBriefs: [state.fixture], canEdit: mode !== "viewer" })
    if (url.startsWith("/api/inbox/quality?")) return Response.json({ brief: state.fixture })
    if (url === "/api/inbox/quality" && init?.method === "POST") return Response.json({}, { status: mode === "conflict" ? 409 : 200 })
    throw new Error("unexpected_fixture_fetch")
  }
  hydrateRoot(document.getElementById("root")!, <Fixture />)
  state.ready = true
}
