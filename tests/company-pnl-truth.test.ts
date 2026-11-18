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
});
