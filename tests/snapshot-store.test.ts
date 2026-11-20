import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SnapshotBinding } from "@/lib/automation/snapshot-store";
const binding: SnapshotBinding = { provider: "google", company: "MBC", accountId: "111", campaignId: "123", policyRevision: "p1" };
const payload = { ...binding, readAt: "2026-11-20T00:00:00Z", expiresAt: "2026-11-20T00:15:00Z", approvable: false };
const now = new Date("2026-11-20T00:01:00Z");
let dir: string | undefined;
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = undefined; });
async function setup() { dir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-fixture-")); vi.spyOn(process, "cwd").mockReturnValue(dir); return import("@/lib/automation/snapshot-store"); }
describe("server snapshot registry", () => {
 it("persists and reloads a bound snapshot", async () => {
  const store = await setup(); const saved = await store.persistCampaignSnapshot(payload, binding, now);
  expect(store.resolveCampaignSnapshot(saved.registryId, binding, now)).toEqual(saved);
  expect(JSON.parse(fs.readFileSync(path.join(dir!, "data/automation-snapshots.json"), "utf8"))).toHaveLength(1);
 });
 it.each(["company", "provider", "accountId", "campaignId", "policyRevision"] as const)("rejects changed %s binding", async key => {
  const store = await setup(); const saved = await store.persistCampaignSnapshot(payload, binding, now);
  expect(() => store.resolveCampaignSnapshot(saved.registryId, { ...binding, [key]: "different" }, now)).toThrow("SNAPSHOT_BINDING_MISMATCH");
 });
 it("rejects expiry at exact TTL boundary and overlong TTL", async () => {
  const store = await setup(); const saved = await store.persistCampaignSnapshot(payload, binding, now);
  expect(() => store.resolveCampaignSnapshot(saved.registryId, binding, new Date(payload.expiresAt))).toThrow("SNAPSHOT_EXPIRED_OR_INVALID");
  await expect(store.persistCampaignSnapshot({ ...payload, expiresAt: "2026-11-21T00:00:00Z" }, binding, now)).rejects.toThrow("SNAPSHOT_EXPIRED_OR_INVALID");
 });
 it("detects modified payload and refuses corrupt registry", async () => {
  const store = await setup(); const saved = await store.persistCampaignSnapshot(payload, binding, now);
  const filename = path.join(dir!, "data/automation-snapshots.json");
  const rows = JSON.parse(fs.readFileSync(filename, "utf8")); rows[0].payload.accountId = "evil";
  fs.writeFileSync(filename, JSON.stringify(rows));
  expect(() => store.resolveCampaignSnapshot(saved.registryId, binding, now)).toThrow("SNAPSHOT_INTEGRITY_FAILED");
  fs.writeFileSync(filename, "corrupt");
  await expect(store.persistCampaignSnapshot(payload, binding, now)).rejects.toThrow("SNAPSHOT_STORE_UNAVAILABLE");
 });
});
