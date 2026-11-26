import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetchGtm: vi.fn(), ids: vi.fn() }));
vi.mock("google-ads-api", () => ({ enums: {} }));
vi.mock("@/lib/google-ads-client", () => ({ getGoogleAdsCustomer: () => ({ query: async () => [] }) }));
vi.mock("@/lib/odoo-client", () => ({ readGroup: vi.fn() }));
vi.mock("@/lib/case/meta-graph", () => ({ metaGet: vi.fn() }));
vi.mock("@/lib/measure/utm-links", () => ({ readStandardLinks: () => ({ links: [] }) }));
vi.mock("@/lib/measure/gtm", () => ({ detectGtmIds: mocks.ids, fetchGtm: mocks.fetchGtm }));
vi.mock("@/lib/measure/gtm-api", () => ({ gtmApiConfigured: () => false }));
vi.mock("@/lib/measure/meta-health", () => ({ HEALTH_DAYS: 28, epochRange: () => ({}), metaHealth: async () => ({ range: { from: "2026-11-01", to: "2026-11-25" }, pixels: [] }) }));
import { tagDoctor } from "@/lib/measure/tag-doctor";
import { projectTrackingEvidence } from "@/lib/measure/evidence-contract";
const old = "2026-11-26T00:00:00.000Z";
const container = () => ({ id: "GTM-TEST123", source: "public", version: "123", readAt: old, pixelTags: [], googleAdsLabels: [{ tagId: "1", sendTo: "PRIVATE" }] });
describe("actual report assembly/cache provenance with mocked readers", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("keeps old source time through new assembly and report cache hits", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-26T01:00:00Z"));
    mocks.ids.mockResolvedValue(["GTM-TEST123"]); mocks.fetchGtm.mockResolvedValue(container());
    const assembled = await tagDoctor("MBC", { force: true });
    expect(assembled.collectedAt).toBe("2026-11-26T01:00:00.000Z");
    expect(projectTrackingEvidence("MBC", assembled).layers[0].reason).toBe("stale");
    vi.setSystemTime(new Date("2026-11-26T01:05:00Z"));
    const cached = await tagDoctor("MBC");
    expect(cached).toBe(assembled);
    expect(cached.gtm[0].readAt).toBe(old);
    expect(mocks.fetchGtm).toHaveBeenCalledTimes(1);
    expect(projectTrackingEvidence("MBC", cached).layers[0].reason).toBe("stale");
  });
  it("fails closed when one of multiple GTM reads fails", async () => {
    mocks.ids.mockResolvedValue(["GTM-TEST123", "GTM-FAIL123"]);
    mocks.fetchGtm.mockImplementation(async id => { if (id === "GTM-FAIL123") throw new Error("TEST ONLY failure"); return container(); });
    const report = await tagDoctor("MBC", { force: true });
    expect(report.sources.find(s => s.id === "gtm")?.status).toBe("error");
    expect(projectTrackingEvidence("MBC", report).layers[0].status).toBe("unverified");
  });
});
