import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { readFileSync, getCurrentUser, getCompaniesForRole, readPaidOrders } = vi.hoisted(() => ({ readFileSync: vi.fn(), getCurrentUser: vi.fn(), getCompaniesForRole: vi.fn(), readPaidOrders: vi.fn() }));
vi.mock("fs", () => ({ default: { readFileSync } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ getCompaniesForRole }));
vi.mock("@/lib/conversions/real-orders", () => ({ readPaidOrders, unsupportedReason: () => null, metaEmail: vi.fn(), metaPhone: vi.fn() }));
import { readLeadEvents } from "@/lib/leads/quality";
import { GET } from "@/app/api/attribution/report/route";

const since = new Date("2026-11-01T00:00:00Z");
const until = new Date("2026-11-26T23:59:59.999Z");
const options = { strict: true as const, since, until };
const lead = { key: "private-key", leadId: "private-lead", stage: "won", time: "2026-11-10T00:00:00Z", gclid: "private-click", currency: "VND", status: "pending", receivedAt: "2026-11-10T00:00:00Z", source: "webhook", hashedEmail: "private-hash" };
const order = { orderId: "private-order", key: "private-order-key", value: 100, currency: "VND", time: "2026-11-11T00:00:00Z", source: "csv", gclid: "private-click" };
let leads: string | undefined;
let orders: string;
let config: string;
const request = (q = "company=MBC&from=2026-11-01&to=2026-11-26&aggregate=1") => new NextRequest(`http://localhost/api/attribution/report?${q}`);
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-27T12:00:00Z"));
  leads = "[]"; orders = "[]"; config = '{"MBC":{"source":"csv"}}';
  getCurrentUser.mockResolvedValue({ id: "actor" }); getCompaniesForRole.mockReturnValue(["MBC"]);
  readFileSync.mockImplementation((file: string) => {
    const raw = file.endsWith("-events.json") ? leads : file.endsWith("order-sources.json") ? config : orders;
    if (raw === undefined) throw Object.assign(new Error("private-diagnostic"), { code: "ENOENT" });
    return raw;
  });
});
afterEach(() => vi.useRealTimers());

describe("strict lead read opt-in", () => {
  it("preserves legacy empty-on-error while strict missing is unavailable with no read time", () => {
    leads = undefined;
    expect(readLeadEvents("MBC")).toEqual([]);
    expect(readLeadEvents("MBC", options)).toMatchObject({ events: null, reason: "store_unreadable", readAt: null });
  });
  it.each(["{", "{}", "null", '[null]', JSON.stringify([{ ...lead, stage: "bad" }]), JSON.stringify([{ ...lead, time: "bad" }]), JSON.stringify([{ ...lead, gclid: {} }])])("rejects corrupt/invalid whole store %s", raw => {
    leads = raw;
    expect(readLeadEvents("MBC", options)).toMatchObject({ events: null, reason: "store_invalid", readAt: "2026-11-27T12:00:00.000Z" });
  });
  it("binds company/range and returns only selected-range rows", () => {
    leads = JSON.stringify([lead, { ...lead, time: "2026-10-31T23:59:59Z" }, { ...lead, time: "2026-11-27T00:00:00Z" }]);
    expect(readLeadEvents("MBI", options)).toMatchObject({ company: "MBI", from: since.toISOString(), to: until.toISOString(), status: "available", events: [lead] });
    expect(readFileSync).toHaveBeenCalledWith(expect.stringContaining("MBI-events.json"), "utf-8");
  });
  it("does not read invalid ranges or certify capped stores", () => {
    expect(readLeadEvents("MBC", { ...options, since: until, until: since })).toMatchObject({ reason: "invalid_range", readAt: null });
    expect(readFileSync).not.toHaveBeenCalled();
    leads = JSON.stringify(Array(20000).fill(lead));
    expect(readLeadEvents("MBC", options)).toMatchObject({ reason: "completeness_unverified", events: null });
  });
});

describe("real route + report + strict stores", () => {
  it("authenticates and authorizes before either store including ALL", async () => {
    getCurrentUser.mockResolvedValue(null); expect((await GET(request())).status).toBe(401);
    getCurrentUser.mockResolvedValue({ id: "actor" }); expect((await GET(request("company=MBI&aggregate=1"))).status).toBe(403);
    getCompaniesForRole.mockReturnValue(["MBC", "MBI"]); expect((await GET(request("company=ALL&aggregate=1"))).status).toBe(400);
    expect(readFileSync).not.toHaveBeenCalled();
  });
  it.each(["from=2026-02-30&to=2026-03-01", "from=2026-11-20&to=2026-11-01", "range=BAD"])("rejects invalid dates before store: %s", async query => {
    expect((await GET(request(`company=MBC&${query}`))).status).toBe(400);
    expect(readFileSync).not.toHaveBeenCalled();
  });
  it("distinguishes successful empty from lead failure, with nullable aggregate totals", async () => {
    expect((await (await GET(request())).json()).report).toMatchObject({ status: "available", uniqueOrders: 0, leadCount: 0, matchedOrderRate: null, matchedRevenueRate: null, duplicateOrders: 0 });
    leads = undefined;
    expect((await (await GET(request())).json()).report).toMatchObject({ status: "partial", leadSource: { reason: "store_unreadable", readAt: null }, uniqueOrders: null, leadCount: null, duplicateOrders: null, matchedOrderRate: null });
    leads = "{private-diagnostic"; orders = "{";
    const body = await (await GET(request())).json();
    expect(body.report).toMatchObject({ status: "unavailable", leadSource: { reason: "store_invalid" }, uniqueOrders: null });
    expect(JSON.stringify(body)).not.toContain("private-diagnostic");
  });
  it("projects unique denominator/conflicts/currency without raw identifiers, preserves detail clients", async () => {
    leads = JSON.stringify([lead, { ...lead, leadId: "not-won", stage: "qualified" }]);
    orders = JSON.stringify([order, order, { ...order, orderId: "other", key: "other", currency: "USD", gclid: undefined }]);
    const body = await (await GET(request())).json();
    expect(body.report).toMatchObject({ leadCount: 1, uniqueOrders: 2, matchedOrders: 1, unmatchedOrders: 1, duplicateOrders: 1, currencyCount: 2, matchedOrderRate: 0.5, matchedRevenueRate: null, campaignBinding: "not_established" });
    expect(JSON.stringify(body)).not.toMatch(/private-|orderId|leadId|orderKey|gclid|hashedEmail/);
    const detail = await (await GET(request("company=MBC&from=2026-11-01&to=2026-11-26"))).json();
    expect(detail.report.matched[0].orderId).toBe("private-order");
    orders = JSON.stringify([order, { ...order, value: 200 }]);
    expect((await (await GET(request())).json()).report).toMatchObject({ uniqueOrders: 1, duplicateConflicts: 1, matchedOrderRate: null, matchedRevenueRate: null });
  });
  it("uses selected UI range ending yesterday, does not call Odoo", async () => {
    config = '{"MBC":{"source":"odoo"}}';
    const body = await (await GET(request("company=MBC&range=LAST_30_DAYS&aggregate=1"))).json();
    expect(body).toMatchObject({ from: "2026-10-28", to: "2026-11-26", report: { source: { reason: "completeness_unverified", readAt: null }, uniqueOrders: null } });
    expect(readPaidOrders).not.toHaveBeenCalled();
  });
});
