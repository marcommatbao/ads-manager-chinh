import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: "test-admin" }) }));
vi.mock("@/lib/settings/guards", () => ({ guardViewCredentials: () => null, guardEditCredentials: () => null }));
vi.mock("@/lib/settings/audit", () => ({ writeAuditEntry: vi.fn() }));
vi.mock("@/lib/companies", () => ({ companyIds: () => ["MBC", "MBI"], companyLabel: (co: string) => co, companyDef: (co: string) => ({ envSuffix: co }) }));
const root = process.cwd();
const key = Buffer.alloc(32, 7).toString("base64");
const names = ["DEVELOPER_TOKEN", "CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN", "CUSTOMER_ID_MBC", "CUSTOMER_ID_MBI", "LOGIN_CUSTOMER_ID"].map(s => `GOOGLE_ADS_${s}`);
let dir: string, file: string;
let store: typeof import("@/lib/settings/google-credentials");
let route: typeof import("@/app/api/settings/google/route");
const post = async (body: unknown) => route.POST(new Request("http://localhost/api/settings/google", { method: "POST", body: JSON.stringify(body) }) as never);
function cold(extra: Record<string, string> = {}) {
  return JSON.parse(execFileSync(process.execPath, [path.join(root, "tests/fixtures/google-credentials-child.cjs"), root, file], {
    env: { NODE_ENV: "test", DATA_ENCRYPTION_KEY: key, ...extra }, encoding: "utf8", timeout: 15000,
  }));
}
beforeEach(async () => {
  vi.resetModules();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "google-durability-")); file = path.join(dir, "data/google-settings.json");
  for (const name of names) vi.stubEnv(name, undefined);
  vi.stubEnv("DATA_ENCRYPTION_KEY", key);
  (globalThis as { __adsSettingsEnv?: Set<string> }).__adsSettingsEnv = new Set();
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  store = await import("@/lib/settings/google-credentials");
  route = await import("@/app/api/settings/google/route");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("Google save → cold process with encrypted temporary storage", () => {
  it("saves encrypted, reloads absent env, and reports matching effective settings without auth claims", async () => {
    const res = await post({ developerToken: "synthetic-developer-secret", refreshToken: "synthetic-refresh-secret", customerIds: { MBC: "1234567890" }, provenance: { origin: "env" } });
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, persisted: true, effective: true, restartConflict: false });
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(raw.refreshToken.__enc).toBe(true);
    expect(raw.provenance).toBeUndefined();
    expect(cold()).toEqual(data.provenance);
    expect(cold()).toMatchObject({ auth: "not-tested", restart: "same-env-key-storage-required" });
    expect(JSON.stringify(data)).not.toContain("synthetic");
    const get = await (await route.GET()).json();
    expect(get.provenance).toEqual(data.provenance);
    expect(JSON.stringify(get)).not.toContain("synthetic-refresh-secret");
  });
  it("keeps raw env effective on save and cold startup, reporting conflict", async () => {
    vi.stubEnv("GOOGLE_ADS_REFRESH_TOKEN", "synthetic-infra");
    const data = await (await post({ refreshToken: "synthetic-settings" })).json();
    expect(process.env.GOOGLE_ADS_REFRESH_TOKEN).toBe("synthetic-infra");
    expect(data).toMatchObject({ persisted: true, effective: false, restartConflict: true });
    expect(data.provenance.fields.find((f: { field: string }) => f.field === "refreshToken")).toMatchObject({ origin: "env", matchesSaved: false });
    expect(cold({ GOOGLE_ADS_REFRESH_TOKEN: "synthetic-infra" })).toEqual(data.provenance);
  });
  it("recognizes settings-origin through env-origin and allows subsequent saves", async () => {
    const { patchFromSettings } = await import("@/lib/settings/env-origin");
    patchFromSettings("GOOGLE_ADS_REFRESH_TOKEN", "synthetic-first");
    expect((await (await post({ refreshToken: "synthetic-second" })).json()).restartConflict).toBe(false);
    expect(process.env.GOOGLE_ADS_REFRESH_TOKEN).toBe("synthetic-second");
    await post({ refreshToken: "synthetic-third" });
    expect(process.env.GOOGLE_ADS_REFRESH_TOKEN).toBe("synthetic-third");
    expect(cold().effective).toBe(true);
  });
  it("never replaces another secret with a masked placeholder or caller metadata", async () => {
    await post({ refreshToken: "synthetic-refresh-secret", clientSecret: "synthetic-client-secret" });
    await post({ refreshToken: "synt****cret", developerToken: "synthetic-new", provenance: { effective: true } });
    expect(store.readGoogleCredentials(file)).toMatchObject({ refreshToken: "synthetic-refresh-secret", clientSecret: "synthetic-client-secret", developerToken: "synthetic-new" });
    const noChange = await (await post({ refreshToken: "****" })).json();
    expect(noChange).toMatchObject({ persisted: false, ok: true });
  });
  it("reports wrong/missing key on cold startup without assigning encrypted objects", async () => {
    await post({ refreshToken: "synthetic-secret" });
    for (const DATA_ENCRYPTION_KEY of ["", Buffer.alloc(32, 8).toString("base64")]) {
      const p = cold({ DATA_ENCRYPTION_KEY });
      expect(p).toMatchObject({ storage: "unreadable", persisted: false, effective: false, restart: "unknown" });
      expect(p.fields.find((f: { field: string }) => f.field === "refreshToken").origin).toBe("unset");
    }
  });
  it("rejects wrong-key and corrupt stores without overwrite or runtime changes", async () => {
    await post({ refreshToken: "synthetic-old" });
    const raw = fs.readFileSync(file, "utf8");
    const encrypted = JSON.parse(raw); encrypted.refreshToken.tag = Buffer.alloc(16).toString("base64");
    for (const content of [JSON.stringify(encrypted), "{corrupt"]) {
      fs.writeFileSync(file, content);
      const res = await post({ developerToken: "synthetic-new" });
      expect(res.status).toBe(500); expect(fs.readFileSync(file, "utf8")).toBe(content);
      expect(process.env.GOOGLE_ADS_DEVELOPER_TOKEN).toBeUndefined();
      expect(process.env.GOOGLE_ADS_REFRESH_TOKEN).toBe("synthetic-old");
      expect(JSON.stringify(await res.json())).not.toContain("synthetic");
    }
  });
  it("on atomic-write failure preserves both runtime and encrypted previous file", async () => {
    await post({ refreshToken: "synthetic-old" });
    const raw = fs.readFileSync(file, "utf8");
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("synthetic-sensitive-error"); });
    const res = await post({ refreshToken: "synthetic-new" });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, persisted: false });
    expect(process.env.GOOGLE_ADS_REFRESH_TOKEN).toBe("synthetic-old");
    expect(fs.readFileSync(file, "utf8")).toBe(raw);
  });
  it("fails on an unwritable path and missing encryption key before runtime mutation", async () => {
    fs.writeFileSync(path.join(dir, "data"), "not-a-directory");
    expect((await post({ refreshToken: "synthetic-new" })).status).toBe(500);
    expect(process.env.GOOGLE_ADS_REFRESH_TOKEN).toBeUndefined();
    fs.unlinkSync(path.join(dir, "data"));
    vi.stubEnv("DATA_ENCRYPTION_KEY", undefined);
    expect((await post({ refreshToken: "synthetic-new" })).status).toBe(500);
    expect(process.env.GOOGLE_ADS_REFRESH_TOKEN).toBeUndefined();
    expect(fs.existsSync(file)).toBe(false);
  });
  it("refuses wrong-key writes and keeps existing ciphertext", async () => {
    await post({ refreshToken: "synthetic-original" });
    const before = fs.readFileSync(file, "utf8");
    vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    vi.resetModules();
    route = await import("@/app/api/settings/google/route");
    const res = await post({ developerToken: "synthetic-new" });
    expect(res.status).toBe(500);
    expect((await res.json()).provenance.storage).toBe("unreadable");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(process.env.GOOGLE_ADS_DEVELOPER_TOKEN).toBeUndefined();
    expect(process.env.GOOGLE_ADS_REFRESH_TOKEN).toBe("synthetic-original");
  });
  it("retains legacy OAuth file format, aliases and company map updates", async () => {
    const { encryptFields } = await import("@/lib/crypto/data-encryption");
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(encryptFields({ refreshToken: "synthetic-oauth", customerIdMbc: "1234567890", customerIds: { MBI: "2345678901" } }, ["refreshToken"])));
    await post({ developerToken: "synthetic-added", customerIds: { MBI: "3456789012" } });
    expect(store.readGoogleCredentials(file)).toMatchObject({ refreshToken: "synthetic-oauth", customerIdMBC: "1234567890", customerIds: { MBI: "3456789012" } });
    expect(cold().effective).toBe(true);
  });
  it("distinguishes missing storage, rejects object secrets, and redacts audit and errors", async () => {
    expect(cold()).toMatchObject({ storage: "missing", persisted: false, effective: false });
    expect((await post({ refreshToken: { __enc: true }, provenance: { effective: true } })).status).toBe(400);
    await post({ refreshToken: "synthetic-audit-secret" });
    const { writeAuditEntry } = await import("@/lib/settings/audit");
    expect(JSON.stringify(vi.mocked(writeAuditEntry).mock.calls)).not.toContain("synthetic");
    const warn = vi.spyOn(console, "warn");
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("synthetic-private-path-token"); });
    const data = await (await post({ refreshToken: "synthetic-replacement" })).json();
    expect(JSON.stringify(data)).not.toContain("synthetic");
    expect(warn).not.toHaveBeenCalled();
  });

});
