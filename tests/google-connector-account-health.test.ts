import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/google-ads-client", () => ({ googleDevToken: () => undefined }));
vi.mock("@/lib/connect/env-satisfied", () => ({ envSatisfied: () => true }));
vi.mock("@/lib/connect/gateway", () => ({ gatewayEnabled: vi.fn(() => false), gatewayFetch: vi.fn(), GatewayError: class extends Error {} }));
vi.mock("@/lib/connect/store", () => ({ readConnect: () => ({ google: { connectionId: "fixture-connection" } }) }));
import { gatewayEnabled, gatewayFetch } from "@/lib/connect/gateway";
import { checkGoogle } from "@/lib/connectors/checks/google";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.mocked(gatewayEnabled).mockReturnValue(false);
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

it("gateway health obtains fresh scope token rather than the connection cache", async () => {
  vi.mocked(gatewayEnabled).mockReturnValue(true);
  vi.mocked(gatewayFetch).mockResolvedValue({ accessToken: "fresh-fixture-token" });
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ resourceNames: ["customers/123"] }), { status: 200 }));
  expect(await checkGoogle()).toMatchObject({ ok: true, status: "healthy" });
  expect(gatewayFetch).toHaveBeenCalledWith("/api/v1/token", { body: { connectionId: "fixture-connection" } });
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer fresh-fixture-token");
});
