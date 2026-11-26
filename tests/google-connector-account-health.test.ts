import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/google-ads-client", () => ({ googleDevToken: () => undefined }));
vi.mock("@/lib/connect/env-satisfied", () => ({ envSatisfied: () => true }));
vi.mock("@/lib/connect/gateway", () => ({ gatewayEnabled: () => false, getGatewayToken: vi.fn(), GatewayError: class extends Error {} }));
import { checkGoogle } from "@/lib/connectors/checks/google";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  for (const key of ["CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN"]) vi.stubEnv(`GOOGLE_ADS_${key}`, "synthetic");
  fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "synthetic" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it.each([{}, { resourceNames: null }, { resourceNames: "customers/1" }, { resourceNames: ["unexpected"] }, { resourceNames: [null] }])("does not report malformed account response healthy: %j", async payload => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));
  expect(await checkGoogle()).toMatchObject({ ok: false, status: "service_error", failureReason: "google_accounts_response_unverified" });
});
it("reports empty accessible accounts as unverified warning, not healthy", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ resourceNames: [] }), { status: 200 }));
  expect(await checkGoogle()).toMatchObject({ ok: false, status: "warning", failureReason: "google_no_accessible_accounts" });
});
it("positive control proves listing only, not configured campaign data access", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ resourceNames: ["customers/123"] }), { status: 200 }));
  const result = await checkGoogle();
  expect(result).toMatchObject({ ok: true, status: "healthy" });
  expect(result.note).toContain("configured account access not verified");
});
