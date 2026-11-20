import { describe, expect, it } from "vitest";
import { snapshotCollectionWindow, SNAPSHOT_TTL_MS } from "@/lib/automation/snapshot-window";
const start = new Date("2026-11-20T10:00:00Z");
describe("snapshot collection timing", () => {
 it("keeps expiry anchored to earliest provider read", () => {
  expect(snapshotCollectionWindow(start, new Date("2026-11-20T10:05:00Z"))).toEqual({ readAt: start.toISOString(), collectedAt: "2026-11-20T10:05:00.000Z", collectionDurationMs: 300000, expiresAt: "2026-11-20T10:15:00.000Z" });
 });
 it.each([new Date(start.getTime() + SNAPSHOT_TTL_MS), new Date(start.getTime() - 1), new Date("invalid")])("rejects exhausted collection or invalid clocks", end => {
  expect(() => snapshotCollectionWindow(start, end)).toThrow("SNAPSHOT_COLLECTION_EXPIRED");
 });
});
