import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ check: vi.fn(), gateway: vi.fn(() => null as null | { url: string; key: string }), connection: vi.fn(() => ({})) }));
vi.mock("@/lib/connectors/checks/meta", () => ({ checkMeta: async () => ({ ok: false, status: "warning" }) }));
vi.mock("@/lib/connectors/checks/gemini", () => ({ checkGemini: async () => ({ ok: false, status: "warning" }) }));
vi.mock("@/lib/connectors/checks/telegram", () => ({ checkTelegram: async () => ({ ok: false, status: "warning" }) }));
vi.mock("@/lib/connectors/checks/odoo", () => ({ checkOdoo: async () => ({ ok: false, status: "warning" }) }));
vi.mock("@/lib/connectors/checks/passive", () => ({ passiveEnvCheck: async () => ({ ok: false, status: "warning" }) }));
vi.mock("@/lib/connectors/checks/google", () => ({ checkGoogle: mocks.check }));
vi.mock("@/lib/connect/gateway", () => ({ gatewayConfig: mocks.gateway }));
vi.mock("@/lib/connect/store", () => ({ readConnect: mocks.connection }));
vi.mock("@/lib/connect/env-satisfied", () => ({ envSatisfied: () => true }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ role: "super_admin" }) }));
vi.mock("@/lib/permissions", () => ({ hasPermission: () => true, isAdmin: () => true }));
vi.mock("@/lib/companies", () => ({ hasModule: () => false }));
let dir: string;
let engine: typeof import("@/lib/connectors/engine");
let store: typeof import("@/lib/connectors/health-store");
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "google-health-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  vi.resetModules();
  mocks.check.mockReset().mockResolvedValue({ ok: true, status: "healthy" });
  mocks.gateway.mockReturnValue(null); mocks.connection.mockReturnValue({});
  for (const name of Object.keys(process.env).filter(n => n.startsWith("GOOGLE_ADS_") || n.startsWith("MB_CONNECT_"))) vi.stubEnv(name, undefined);
  for (const name of ["CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN", "CUSTOMER_ID_MBC"]) vi.stubEnv(`GOOGLE_ADS_${name}`, `fixture-${name}`);
  engine = await import("@/lib/connectors/engine");
  store = await import("@/lib/connectors/health-store");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });
it("requires live proof; unchanged success remains healthy and marker stays disk-only", async () => {
  expect(engine.snapshotAllConnectors().google_ads.status).toBe("warning");
  const record = await engine.runLiveCheck("google_ads");
  expect(record.status).toBe("healthy");
  expect(engine.snapshotAllConnectors().google_ads.status).toBe("healthy");
  expect(store.getStoredHealth("google_ads")?.googleEvidenceBinding).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(record)).not.toContain("googleEvidenceBinding");
  const { GET, POST: refresh } = await import("@/app/api/connectors/health/route");
  const refreshed = await refresh();
  expect(refreshed.status).toBe(200);
  expect(await refreshed.text()).not.toContain("googleEvidenceBinding");
  expect(await (await GET()).text()).not.toContain("googleEvidenceBinding");
  const { POST } = await import("@/app/api/connectors/[id]/test/route");
  const response = await POST({} as never, { params: Promise.resolve({ id: "google_ads" }) });
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("googleEvidenceBinding");
});
it.each(["CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN", "CUSTOMER_ID_MBC", "CUSTOMER_ID_OTHER", "LOGIN_CUSTOMER_ID", "DEVELOPER_TOKEN"])("invalidates effective %s changes", async name => {
  await engine.runLiveCheck("google_ads");
  vi.stubEnv(`GOOGLE_ADS_${name}`, "changed-fixture");
  expect(engine.snapshotAllConnectors().google_ads.status).toBe("warning");
});
it("invalidates settings origin even with unchanged values", async () => {
  await engine.runLiveCheck("google_ads");
  const { markFromSettings } = await import("@/lib/settings/env-origin");
  markFromSettings("GOOGLE_ADS_CLIENT_ID");
  expect(engine.snapshotAllConnectors().google_ads.status).toBe("warning");
});
it.each(["url", "key", "connection", "account"])("invalidates gateway %s", async change => {
  mocks.gateway.mockReturnValue({ url: "https://fixture.invalid", key: "fixture" });
  const connection = { google: { connectionId: "a", accounts: [{ company: "MBC", customerId: "1", loginCustomerId: "2" }] } };
  mocks.connection.mockReturnValue(connection);
  await engine.runLiveCheck("google_ads");
  if (change === "url" || change === "key") mocks.gateway.mockReturnValue({ url: "https://fixture.invalid", key: "fixture", [change]: "changed" });
  if (change === "connection") connection.google.connectionId = "b";
  if (change === "account") connection.google.accounts[0].loginCustomerId = "3";
  expect(engine.snapshotAllConnectors().google_ads.status).toBe("warning");
});
it.each([null, "invalid", new Date(Date.now() + 86_400_000).toISOString(), new Date(Date.now() - 7_200_000).toISOString()])("rejects invalid success timestamp %s", async timestamp => {
  await engine.runLiveCheck("google_ads");
  await store.saveHealthRecord({ ...store.getStoredHealth("google_ads")!, lastSuccess: timestamp });
  expect(engine.snapshotAllConnectors().google_ads.status).toBe("warning");
});
it("rejects legacy and future check records", async () => {
  const record = await engine.runLiveCheck("google_ads");
  await store.saveHealthRecord(record);
  expect(engine.snapshotAllConnectors().google_ads.status).toBe("warning");
  await engine.runLiveCheck("google_ads");
  await store.saveHealthRecord({ ...store.getStoredHealth("google_ads")!, lastChecked: new Date(Date.now() + 86_400_000).toISOString() });
  expect(engine.snapshotAllConnectors().google_ads.status).toBe("warning");
});
it("cannot publish healthy when identity changes during the check", async () => {
  mocks.check.mockImplementationOnce(async () => {
    vi.stubEnv("GOOGLE_ADS_REFRESH_TOKEN", "changed-during-check");
    return { ok: true, status: "healthy" };
  });
  expect((await engine.runLiveCheck("google_ads")).status).toBe("warning");
  expect(store.getStoredHealth("google_ads")?.googleEvidenceBinding).toBeUndefined();
});
it("unbound traffic success cannot bless Google; denied and failed remain truthful", async () => {
  await engine.recordLiveOutcome("google_ads", { ok: true, status: "healthy" });
  expect(engine.snapshotAllConnectors().google_ads.status).toBe("warning");
  for (const status of ["auth_error", "service_error"] as const) {
    await engine.recordLiveOutcome("google_ads", { ok: false, status, failureReason: "fixture-denied" });
    expect(engine.snapshotAllConnectors().google_ads).toMatchObject({ status, failureReason: "fixture-denied" });
  }
  await engine.recordLiveOutcome("telegram", { ok: true, status: "healthy" });
  expect(engine.snapshotAllConnectors().telegram.status).toBe("healthy");
});
