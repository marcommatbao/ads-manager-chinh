import { beforeEach, describe, expect, it, vi } from "vitest";

const { readLeadEvents, readOrders } = vi.hoisted(() => ({ readLeadEvents: vi.fn(), readOrders: vi.fn() }));
vi.mock("@/lib/leads/quality", () => ({ readLeadEvents }));
vi.mock("@/lib/orders/sources", () => ({ readOrders }));

import { readAttributionReport } from "@/lib/attribution/report";

describe("phase 5 event-store attribution report", () => {
  beforeEach(() => vi.clearAllMocks());

  it("joins won leads to paid orders inside the requested window", async () => {
    readLeadEvents.mockReturnValue([
      { leadId: "lead-won", stage: "won", time: "2026-11-10T00:00:00.000Z", gclid: "click-1234567890" },
      { leadId: "lead-old", stage: "won", time: "2026-10-01T00:00:00.000Z", gclid: "old-click-123456" },
      { leadId: "lead-qualified", stage: "qualified", time: "2026-11-10T00:00:00.000Z", gclid: "qualified-123456" },
    ]);
    readOrders.mockResolvedValue([
      { orderId: "o1", key: "webhook-o1", value: 1000, currency: "VND", time: "2026-11-11T00:00:00.000Z", gclid: "click-1234567890" },
      { orderId: "o2", key: "webhook-o2", value: 500, currency: "VND", time: "2026-11-11T00:00:00.000Z" },
    ]);

    const report = await readAttributionReport("MBC", new Date("2026-11-01"), new Date("2026-11-30"));
    expect(report.matched).toHaveLength(1);
    expect(report.matched[0]).toMatchObject({ orderId: "o1", leadId: "lead-won" });
    expect(report.unmatched).toEqual([expect.objectContaining({ orderId: "o2", reason: "no_ad_evidence" })]);
    expect(report.matchedRevenueRate).toBeCloseTo(2 / 3);
  });
});
