import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), query: vi.fn(), ids: ["MBC", "MBI"] }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/companies", () => ({ companyIds: () => m.ids, envFor: (id: string) => process.env[`GOOGLE_ADS_CUSTOMER_ID_${id}`] ?? "" }));
vi.mock("@/lib/companies/registry", () => ({ companyIds: () => m.ids }));
vi.mock("@/lib/connect/gateway", () => ({ gatewayEnabled: () => false }));
vi.mock("@/lib/connect/store", () => ({ gatewayCustomerIdFor: () => null, loginCustomerIdFor: () => null }));
vi.mock("@/lib/google-ads-client", () => ({ googleDevToken: () => undefined }));
vi.mock("google-ads-api", () => ({ GoogleAdsApi: class {
  Customer({ customer_id }: { customer_id: string }) { return { query: (sql: string) => m.query(customer_id, sql) }; }
} }));
let GET: typeof import("@/app/api/google/debug/route").GET;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); m.ids = ["MBC", "MBI"];
  m.user.mockResolvedValue({ role: "super_admin", companies: ["ALL"] });
  for (const key of ["CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN"]) vi.stubEnv(`GOOGLE_ADS_${key}`, "fixture");
  vi.stubEnv("GOOGLE_ADS_CUSTOMER_ID_MBC", "111"); vi.stubEnv("GOOGLE_ADS_CUSTOMER_ID_MBI", "222");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network prohibited"); }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  GET = (await import("@/app/api/google/debug/route")).GET;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("all OAuth reads failing cannot report healthy or leak legacy errors", async () => {
  m.query.mockRejectedValue(new Error("invalid_client client_id=private https://oauth2.googleapis.com/token secret"));
  const body = await (await GET()).json();
  expect(body).toMatchObject({ ok: false, status: "failed", reason: "account_reads_failed", accounts: [] });
  expect(body.failures).toHaveLength(2);
  expect(JSON.stringify(body)).not.toMatch(/invalid_client|private|oauth2|secret/);
});
it("partial success is explicit and omits metrics", async () => {
  m.query.mockImplementation((id: string) => id === "111" ? Promise.resolve([]) : Promise.reject(new Error("denied")));
  const body = await (await GET()).json();
  expect(body).toMatchObject({ ok: false, status: "partial", accounts: [{ id: "111", name: "111" }] });
  expect(body.failures).toEqual([{ id: "222", reason: "account_read_failed" }]);
  expect(JSON.stringify(body)).not.toContain("costMicros");
});
it("successful reads returning zero campaigns prove account readability", async () => {
  m.query.mockResolvedValue([]);
  const body = await (await GET()).json();
  expect(body).toMatchObject({ ok: true, status: "account_readable", reason: "read_succeeded" });
  expect(body.accounts).toHaveLength(2); expect(m.query).toHaveBeenCalledTimes(2);
});
it("no configured accounts is unverified, not healthy", async () => {
  vi.stubEnv("GOOGLE_ADS_CUSTOMER_ID_MBC", ""); vi.stubEnv("GOOGLE_ADS_CUSTOMER_ID_MBI", "");
  expect(await (await GET()).json()).toMatchObject({ ok: false, status: "unverified", accounts: [] });
  expect(m.query).not.toHaveBeenCalled();
});
it("missing credentials never calls provider", async () => {
  vi.stubEnv("GOOGLE_ADS_REFRESH_TOKEN", "");
  expect(await (await GET()).json()).toMatchObject({ ok: false, status: "missing_config" });
  expect(m.query).not.toHaveBeenCalled();
});
it.each([null, { role: "viewer_mbc" }, { role: "admin_mbc" }])("auth and credential role guard precede provider: %j", async user => {
  m.user.mockResolvedValue(user);
  expect((await GET()).status).toBe(user ? 403 : 401); expect(m.query).not.toHaveBeenCalled();
});
it("no authorized company stops before provider", async () => {
  m.ids = [];
  expect((await GET()).status).toBe(403); expect(m.query).not.toHaveBeenCalled();
});
it("local results survive interleaving and preserve legacy error snapshot", async () => {
  const { googleAdsClient: client } = await import("@/lib/google-client");
  m.query.mockRejectedValue(new Error("legacy failure"));
  await client.getAccountBreakdown({ from: "2026-01-01", to: "2026-01-02" });
  const legacy = client.lastBreakdownErrors;
  let release!: (rows: never[]) => void;
  m.query.mockImplementation((id: string) => id === "111" ? new Promise(resolve => { release = resolve; }) : Promise.reject(new Error("second failure")));
  const first = client.getAccountBreakdownResult({ from: "2026-01-01", to: "2026-01-02" }, ["MBC"]);
  const second = await client.getAccountBreakdownResult({ from: "2026-01-01", to: "2026-01-02" }, ["MBI"]);
  release([]);
  expect((await first).accounts.map(a => a.accountId)).toEqual(["111"]);
  expect(second.errors.map(e => e.accountId)).toEqual(["222"]);
  expect(client.lastBreakdownErrors).toBe(legacy);
});
it("company filtering happens before provider reads", async () => {
  const permissions = await import("@/lib/permissions");
  vi.spyOn(permissions, "canAccessCompany").mockImplementation((_user, company) => company === "MBC");
  m.query.mockResolvedValue([]);
  const body = await (await GET()).json();
  expect(body.accounts).toEqual([{ id: "111", name: "111" }]);
  expect(m.query.mock.calls.map(call => call[0])).toEqual(["111"]);
});
