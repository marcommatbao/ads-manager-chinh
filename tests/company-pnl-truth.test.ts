import { afterEach, describe, expect, it, vi } from "vitest";

let fetchMbcRevenueTruth: typeof import("@/lib/finance/company-pnl")["fetchMbcRevenueTruth"];
let fetchMbiOrdersTruth: typeof import("@/lib/finance/company-pnl")["fetchMbiOrdersTruth"];

async function loadTruthFunctions() {
  process.env.MATBAO_REPORT_API = "https://reports.test";
  ({ fetchMbcRevenueTruth, fetchMbiOrdersTruth } = await import("@/lib/finance/company-pnl"));
}

describe("company P&L source truth", () => {
  afterEach(() => vi.restoreAllMocks());

  it("marks Odoo 403 as unavailable instead of zero", async () => {
    await loadTruthFunctions();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("forbidden", { status: 403, statusText: "Forbidden" })));
    const mbc = await fetchMbcRevenueTruth("2026-11-01T00:00:00Z", "2026-11-18T00:00:00Z");
    const mbi = await fetchMbiOrdersTruth("2026-11-01T00:00:00Z", "2026-11-18T00:00:00Z");
    expect(mbc.revenue).toMatchObject({ value: null, status: "unavailable", source: "Odoo Report API" });
    expect(mbi).toMatchObject({ value: null, status: "unavailable" });
  });

  it("keeps a successful zero as real zero", async () => {
    await loadTruthFunctions();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { totalRevenue: 0, totalCount: 0 } }), { status: 200, headers: { "content-type": "application/json" } })));
    const mbc = await fetchMbcRevenueTruth("2026-11-01T00:00:00Z", "2026-11-18T00:00:00Z");
    expect(mbc.revenue).toMatchObject({ value: 0, status: "real" });
    expect(mbc.orders).toMatchObject({ value: 0, status: "real" });
  });
  it("sends the seven MBI sources with unchanged team, type and date filters", async () => {
    await loadTruthFunctions();
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: 7 }), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const from = "2026-11-01T00:00:00Z";
    const to = "2026-11-18T00:00:00Z";
    expect(await fetchMbiOrdersTruth(from, to)).toMatchObject({ value: 7, status: "real" });
    const { fetchMbiOrders } = await import("@/lib/finance/company-pnl");
    expect(await fetchMbiOrders(from, to)).toEqual({ orders: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toBe("https://reports.test/api/Report/count-sale-order-paid");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({
        typeId: [11, 4, 5, 2, 3, 1, 9, 6, 10],
        teamId: [60, 59, 39, 35, 53, 42, 54, 50],
        customerSource: [17, 29, 16, 19, 27, 243, 30],
        dateOrderFrom: from, dateOrderTo: to,
      });
    }
  });

});
