import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readFileSync, readPaidOrders, getCurrentUser, getCompaniesForRole } = vi.hoisted(() => ({ readFileSync: vi.fn(), readPaidOrders: vi.fn(), getCurrentUser: vi.fn(), getCompaniesForRole: vi.fn() }));
vi.mock("fs", () => ({ default: { readFileSync } }));
vi.mock("@/lib/conversions/real-orders", () => ({
  readPaidOrders, unsupportedReason: (co: string) => co === "MBI" ? null : "unsupported",
  metaEmail: vi.fn(), metaPhone: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ getCompaniesForRole }));
vi.mock("@/lib/leads/quality", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/leads/quality")>(), readLeadEvents: () => ({ status: "available", events: [] }) }));
import { GET } from "@/app/api/attribution/report/route";
import { NextRequest } from "next/server";
import { readOrders, readOrdersTruth } from "@/lib/orders/sources";

const from = new Date("2026-11-01T00:00:00Z");
const to = new Date("2026-11-27T23:59:59Z");
let config: string | undefined;
let store: string | undefined;
const missing = () => Object.assign(new Error("private diagnostic"), { code: "ENOENT" });
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-27T12:00:00Z"));
  config = JSON.stringify({ MBC: { source: "csv" } });
  store = "[]";
  readPaidOrders.mockClear();
  readFileSync.mockImplementation((p: string) => {
    const result = p.endsWith("order-sources.json") ? config : store;
    if (result === undefined) throw missing();
    return result;
  });
});

afterEach(() => vi.useRealTimers());

describe("opt-in order source truth", () => {
  it("distinguishes absent configuration and unsupported Odoo without a provider read", async () => {
    config = undefined;
    expect(await readOrdersTruth("MBC", from, to)).toMatchObject({ status: "unavailable", reason: "not_configured", orders: null, readAt: null });
    config = JSON.stringify({ MBC: { source: "odoo" } });
    expect(await readOrdersTruth("MBC", from, to)).toMatchObject({ reason: "unsupported_source", readAt: null });
    expect(await readOrdersTruth("MBI", from, to)).toMatchObject({ reason: "completeness_unverified", readAt: null });
    expect(readPaidOrders).not.toHaveBeenCalled();
  });
  it.each(["{", "[]", "null", '{"MBC":{"source":"wrong"}}'])("rejects malformed configuration %s", async (raw) => {
    config = raw;
    expect(await readOrdersTruth("MBC", from, to)).toMatchObject({ reason: "invalid_config", orders: null, readAt: null });
  });
  it("records only actual successful store reads and preserves company/range", async () => {
    expect(await readOrdersTruth("MBC", from, to)).toEqual({ company: "MBC", source: "csv", from: from.toISOString(), to: to.toISOString(), status: "available", complete: true, reason: null, orders: [], readAt: new Date().toISOString(), scope: "selected_local_store" });
    store = undefined;
    expect(await readOrdersTruth("MBC", from, to)).toMatchObject({ reason: "store_unreadable", readAt: null });
  });
  it.each(["{", "{}", "null", '[{"orderId":"o","value":100,"time":"bad","source":"csv"}]'])("rejects corrupt store %s", async (raw) => {
    store = raw;
    expect(await readOrdersTruth("MBC", from, to)).toMatchObject({ status: "unavailable", reason: "store_invalid", orders: null, readAt: new Date().toISOString() });
  });
  it("keeps selected source and date filters and exposes no config secrets", async () => {
    config = JSON.stringify({ MBC: { source: "csv", secretHash: "private-hash" } });
    const row = { orderId: "a", value: 100, time: "2026-11-10T00:00:00Z", source: "csv" };
    store = JSON.stringify([row, { ...row, orderId: "b", source: "webhook" }, { ...row, orderId: "c", time: "2026-10-01T00:00:00Z" }]);
    const truth = await readOrdersTruth("MBC", from, to);
    expect(truth.orders).toEqual([row]);
    expect(JSON.stringify(truth)).not.toContain("private-hash");
  });
  it("does not certify ranges beyond local retention", async () => {
    expect(await readOrdersTruth("MBC", new Date("2026-01-01"), to)).toMatchObject({ reason: "range_not_retained", orders: null });
  });
  it("leaves legacy missing/corrupt store and no-config callers unchanged", async () => {
    store = "{";
    expect(await readOrders("MBC", from, to)).toEqual([]);
    config = undefined;
    expect(await readOrders("MBC", from, to)).toEqual([]);
  });
});

describe("real attribution route/source boundary", () => {
  const request = (company = "MBC") => new NextRequest(`http://localhost/api/attribution/report?company=${company}&from=2026-11-01&to=2026-11-27`);
  it("denies auth/company before any source read", async () => {
    readFileSync.mockClear();
    getCurrentUser.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(readFileSync).not.toHaveBeenCalled();
    getCurrentUser.mockResolvedValue({ id: "u" });
    getCompaniesForRole.mockReturnValue(["MBI"]);
    expect((await GET(request())).status).toBe(403);
    expect(readFileSync).not.toHaveBeenCalled();
    getCompaniesForRole.mockReturnValue(["MBC", "MBI"]);
    expect((await GET(request("ALL"))).status).toBe(400);
    expect(readFileSync).not.toHaveBeenCalled();
  });
  it("projects corrupt vs empty store through the real report and route without diagnostics", async () => {
    getCurrentUser.mockResolvedValue({ id: "u" });
    getCompaniesForRole.mockReturnValue(["MBC"]);
    store = "{private-diagnostic";
    const bad = await (await GET(request())).json();
    expect(bad.report).toMatchObject({ source: { company: "MBC", status: "unavailable", reason: "store_invalid" }, duplicateOrders: null, matchedRevenueRate: null });
    expect(JSON.stringify(bad)).not.toContain("private-diagnostic");
    store = "[]";
    const empty = await (await GET(request())).json();
    expect(empty.report).toMatchObject({ source: { status: "available", complete: true }, matched: [], unmatched: [], duplicateOrders: 0, matchedRevenueRate: null });
  });
});
