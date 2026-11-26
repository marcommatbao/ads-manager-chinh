import { describe, expect, it } from "vitest"
import { fromGoogleHealth, fromSourceErrors } from "@/lib/inbox/evidence"
import { pickDigest, rankItems } from "@/lib/inbox/build"
import { localizeItem } from "@/lib/inbox/localize"
import { makeT } from "@/lib/i18n/translate"
import type { ConnectorHealthRecord } from "@/lib/connectors/types"
const now = Date.parse("2026-11-26T10:00:00.000Z")
const record: ConnectorHealthRecord = { id: "google_ads", status: "warning", configComplete: true, partialConfig: false, lastChecked: null, lastSuccess: null, lastFailure: null, failureReason: "PRIVATE account-other", failureCategory: null, maskedConfig: { account: "PRIVATE" } }
describe("Inbox source quality", () => {
  it.each([
    [{}, "never_checked"],
    [{ status: "auth_error" }, "auth_error"],
    [{ status: "service_error" }, "service_error"],
    [{ configComplete: false }, "missing"],
    [{ lastChecked: "2026-11-26T08:00:00.000Z" }, "stale"],
    [{ lastChecked: "2026-11-26T09:59:00.000Z" }, "recheck"],
    [{ lastChecked: "invalid" }, "recheck"],
  ] as const)("distinguishes evidence %j", (patch, reason) => {
    const items = fromGoogleHealth(["MBC", "MBC"], { ...record, ...patch }, now)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: "MBC:health:connection_google_ads", money: null, campaignIds: [], evidence: { reasonCode: reason, scope: "global_connector" } })
    expect(JSON.stringify(items)).not.toContain("PRIVATE")
    expect(fromGoogleHealth(["MBC"], { ...record, ...patch }, now + 1)[0].key).toBe(items[0].key)
  })
  it("healthy listing avoids issue; unknown authority cannot clear it; no invented timestamp", () => {
    const checked = new Date(now - 1000).toISOString()
    expect(fromGoogleHealth(["MBC"], { ...record, status: "healthy", lastChecked: checked, lastSuccess: checked }, now)).toEqual([])
    expect(fromGoogleHealth(["MBC"], record, now)[0].evidence?.checkedAt).toBeNull()
    expect(fromGoogleHealth(["MBC"], { ...record, status: "healthy" }, now)).toHaveLength(1)
    expect(fromGoogleHealth(["MBC"], { ...record, lastChecked: new Date(now + 1).toISOString() }, now)[0].evidence?.checkedAt).toBeNull()
  })
  it("deduplicates scoped source errors, preserves ranking and existing digest selection", () => {
    const errors = [{ company: "ALL", source: "search" }, { company: "MBC", source: "search" }, { company: "MBI", source: "meta" }] as const
    const items = fromSourceErrors(["MBC"], [...errors])
    expect(items).toHaveLength(1)
    expect(items[0].evidence).toMatchObject({ checkedAt: null, reasonCode: "source_error" })
    const opportunity = { ...items[0], evidence: undefined, key: "opportunity", kind: 3 as const, money: 100 }
    expect(rankItems([opportunity, ...items])[0].key).toBe(items[0].key)
    expect(pickDigest(rankItems([opportunity, ...items]))).toEqual([opportunity])
    expect(localizeItem(items[0], makeT("en")).why).toContain("could not be read")
  })
})
