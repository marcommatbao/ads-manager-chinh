import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ user: vi.fn(), audit: vi.fn(), exchange: vi.fn(), ga4Save: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/settings/audit", () => ({ writeAuditEntry: mocks.audit }));
vi.mock("@/lib/ga4-oauth", () => ({ exchangeCodeForRefreshToken: mocks.exchange, saveGA4OAuth: mocks.ga4Save }));
vi.mock("@/lib/companies", () => ({ companyDef: (co: string) => ({ envSuffix: co }) }));
const root = process.cwd();
const key = Buffer.alloc(32, 17).toString("base64");
const names = ["DEVELOPER_TOKEN", "CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN", "CUSTOMER_ID_MBC", "CUSTOMER_ID_MBI", "LOGIN_CUSTOMER_ID"].map(s => `GOOGLE_ADS_${s}`);
let dir: string, file: string;
let route: typeof import("@/app/api/google/callback/route");
let store: typeof import("@/lib/settings/google-credentials");
let provider: ReturnType<typeof vi.fn>;
function request(flow = "ads", query = "code=synthetic-code", cookie = true) {
  const state = `${flow}:synthetic-nonce`;
  return new NextRequest(`http://localhost/api/google/callback?${query}&state=${state}`, { headers: cookie ? { cookie: `google_oauth_state=${state}` } : {} });
}
function status(res: Response, error?: string) {
  const url = new URL(res.headers.get("location")!);
  expect(url.searchParams.get("google_connected")).toBeNull();
  expect(url.searchParams.get("google_oauth_saved")).toBeNull();
  if (error) expect(url.searchParams.get("google_error")).toBe(error);
  expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(url.toString()).not.toContain("synthetic");
}
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "google-callback-")); file = path.join(dir, "data/google-settings.json");
  for (const name of names) vi.stubEnv(name, undefined);
  vi.stubEnv("DATA_ENCRYPTION_KEY", key); vi.stubEnv("APP_URL", "http://localhost");
  vi.stubEnv("GOOGLE_ADS_CLIENT_ID", "synthetic-current-client");
  vi.stubEnv("GOOGLE_ADS_CLIENT_SECRET", "synthetic-current-secret");
  (globalThis as { __adsSettingsEnv?: Set<string> }).__adsSettingsEnv = new Set();
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  mocks.user.mockResolvedValue({ id: "fixture-admin", email: "fixture@example.invalid", role: "super_admin" });
  mocks.audit.mockResolvedValue(undefined);
  mocks.exchange.mockResolvedValue("synthetic-ga4-refresh"); mocks.ga4Save.mockResolvedValue(undefined);
  provider = vi.fn().mockResolvedValue(new Response(JSON.stringify({ refresh_token: "synthetic-new-refresh" }), { status: 200 }));
  vi.stubGlobal("fetch", provider);
  store = await import("@/lib/settings/google-credentials");
  route = await import("@/app/api/google/callback/route");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });

it("GET persists encrypted credentials, uses the exchange client pair, and reloads in a cold process", async () => {
  await store.saveGoogleCredentials(file, { clientId: "synthetic-stale-client", clientSecret: "synthetic-stale-secret" }, co => co);
  // Simulate a newer client pair already loaded by settings, with stale disk counterparts.
  const { markFromSettings } = await import("@/lib/settings/env-origin");
  markFromSettings("GOOGLE_ADS_CLIENT_ID"); markFromSettings("GOOGLE_ADS_CLIENT_SECRET");
  const res = await route.GET(request());
  expect(res.headers.get("location")).toBe("http://localhost/settings?google_oauth_saved=true");
  expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  const body = provider.mock.calls[0][1].body as URLSearchParams;
  expect(body.get("client_id")).toBe("synthetic-current-client");
  expect(body.get("client_secret")).toBe("synthetic-current-secret");
  expect(store.readGoogleCredentials(file)).toMatchObject({ clientId: "synthetic-current-client", clientSecret: "synthetic-current-secret", refreshToken: "synthetic-new-refresh" });
  expect(process.env.GOOGLE_ADS_CLIENT_SECRET).toBe("synthetic-current-secret");
  expect(JSON.parse(fs.readFileSync(file, "utf8")).refreshToken.__enc).toBe(true);
  const cold = JSON.parse(execFileSync(process.execPath, [path.join(root, "tests/fixtures/google-credentials-child.cjs"), root, file], { env: { NODE_ENV: "test", DATA_ENCRYPTION_KEY: key }, encoding: "utf8", timeout: 15000 }));
  expect(cold).toMatchObject({ effective: true, persisted: true, auth: "not-tested" });
  expect(mocks.audit).toHaveBeenCalledWith("credentials_google", expect.anything(), "update", "refreshToken, clientId, clientSecret", null, null, "ALL", { note: "oauth_saved_effective; google_api_read_not_tested" });
  expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("synthetic");
});

it("atomic write failure cannot change runtime or report success", async () => {
  await store.saveGoogleCredentials(file, { refreshToken: "synthetic-old" }, co => co);
  const before = fs.readFileSync(file, "utf8");
  const warn = vi.spyOn(console, "warn"); const error = vi.spyOn(console, "error");
  vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("synthetic-private-token-path"); });
  status(await route.GET(request()), "credentials_persist_failed");
  expect(process.env.GOOGLE_ADS_REFRESH_TOKEN).toBe("synthetic-old");
  expect(fs.readFileSync(file, "utf8")).toBe(before);
  expect(mocks.audit).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
});

it.each(["corrupt", "wrong-key"])("preserves %s storage and runtime", async kind => {
  await store.saveGoogleCredentials(file, { refreshToken: "synthetic-old" }, co => co);
  if (kind === "corrupt") fs.writeFileSync(file, "{corrupt");
  else {
    vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 18).toString("base64"));
    vi.resetModules(); route = await import("@/app/api/google/callback/route");
  }
  const before = fs.readFileSync(file, "utf8");
  status(await route.GET(request()), "credentials_persist_failed");
  expect(fs.readFileSync(file, "utf8")).toBe(before);
  expect(process.env.GOOGLE_ADS_REFRESH_TOKEN).toBe("synthetic-old"); expect(mocks.audit).not.toHaveBeenCalled();
});

it("persists but explicitly requires reconnect when infra refresh token wins", async () => {
  vi.stubEnv("GOOGLE_ADS_REFRESH_TOKEN", "synthetic-infra-refresh");
  status(await route.GET(request()), "reconnect_required_env_conflict");
  expect(process.env.GOOGLE_ADS_REFRESH_TOKEN).toBe("synthetic-infra-refresh");
  expect(store.readGoogleCredentials(file).refreshToken).toBe("synthetic-new-refresh");
  expect(mocks.audit.mock.calls[0][7]).toEqual({ note: "oauth_saved_reconnect_required; google_api_read_not_tested" });
});

it.each(["unauthorized", "rbac", "state"])("%s blocks exchange and every store write", async kind => {
  if (kind === "unauthorized") mocks.user.mockResolvedValue(null);
  if (kind === "rbac") mocks.user.mockResolvedValue({ id: "viewer", role: "viewer" });
  const res = await route.GET(request("ads", "code=synthetic-code", kind !== "state"));
  if (kind === "state") status(res, "invalid_state");
  else expect(res.status).toBe(kind === "unauthorized" ? 401 : 403);
  expect(provider).not.toHaveBeenCalled(); expect(fs.existsSync(file)).toBe(false);
  expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.exchange).not.toHaveBeenCalled();
});

it.each(["consent", "payload", "http", "exception"])("%s provider error is generic with no persistence", async kind => {
  if (kind === "payload") provider.mockResolvedValue(new Response(JSON.stringify({ error: "synthetic-provider-error", error_description: "synthetic-secret" })));
  if (kind === "http") provider.mockResolvedValue(new Response(JSON.stringify({ refresh_token: "synthetic-refresh" }), { status: 500 }));
  if (kind === "exception") provider.mockRejectedValue(new Error("synthetic-secret"));
  status(await route.GET(request("ads", kind === "consent" ? "error=synthetic-consent-secret" : undefined)), kind === "consent" ? "authorization_failed" : kind === "exception" ? "oauth_callback_failed" : "token_exchange_failed");
  expect(fs.existsSync(file)).toBe(false); expect(process.env.GOOGLE_ADS_REFRESH_TOKEN).toBeUndefined();
  expect(mocks.audit).not.toHaveBeenCalled();
});

it("GA4 still uses its own exchange, persistence, audit and success redirect", async () => {
  const res = await route.GET(request("ga4"));
  expect(res.headers.get("location")).toBe("http://localhost/settings/ga4?ga4_connected=true");
  expect(mocks.exchange).toHaveBeenCalledWith("synthetic-code");
  expect(mocks.ga4Save).toHaveBeenCalledWith({ refreshToken: "synthetic-ga4-refresh", connectedAt: expect.any(String), connectedBy: "fixture@example.invalid" });
  expect(mocks.audit).toHaveBeenCalledWith("credentials_ga4", expect.anything(), "update", "oauth_connect", null, null, "ALL");
  expect(provider).not.toHaveBeenCalled(); expect(fs.existsSync(file)).toBe(false);
  expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
});
it("GA4 exchange failure remains on GA4 settings with sanitized error", async () => {
  mocks.exchange.mockRejectedValue(new Error("synthetic-provider-secret"));
  const res = await route.GET(request("ga4"));
  expect(res.headers.get("location")).toBe("http://localhost/settings/ga4?ga4_error=ga4_token_exchange_failed");
  expect(mocks.ga4Save).not.toHaveBeenCalled(); expect(fs.existsSync(file)).toBe(false);
});

it.each(["ads", "ga4"])("%s invalid or missing state never reaches either provider or storage", async flow => {
  const attempts = [
    new NextRequest(`http://localhost/api/google/callback?code=synthetic-code`),
    new NextRequest(`http://localhost/api/google/callback?code=synthetic-code&state=${flow}:wrong`, { headers: { cookie: `google_oauth_state=${flow}:expected` } }),
    new NextRequest(`http://localhost/api/google/callback?code=synthetic-code&state=unknown:nonce`, { headers: { cookie: "google_oauth_state=unknown:nonce" } }),
  ];
  for (const req of attempts) status(await route.GET(req), "invalid_state");
  expect(provider).not.toHaveBeenCalled(); expect(mocks.exchange).not.toHaveBeenCalled();
  expect(mocks.ga4Save).not.toHaveBeenCalled(); expect(fs.existsSync(file)).toBe(false);
});
it.each(["no_code", "missing_credentials"])("%s returns cleared state and never exchanges", async reason => {
  if (reason === "missing_credentials") vi.stubEnv("GOOGLE_ADS_CLIENT_SECRET", undefined);
  status(await route.GET(request("ads", reason === "no_code" ? "" : "code=synthetic-code")), reason);
  expect(provider).not.toHaveBeenCalled(); expect(fs.existsSync(file)).toBe(false);
});
it("unusable storage path fails before any refresh runtime mutation", async () => {
  fs.writeFileSync(path.join(dir, "data"), "synthetic-not-a-directory");
  status(await route.GET(request()), "credentials_persist_failed");
  expect(process.env.GOOGLE_ADS_REFRESH_TOKEN).toBeUndefined();
  expect(mocks.audit).not.toHaveBeenCalled();
});
