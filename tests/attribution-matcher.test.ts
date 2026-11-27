import { describe, expect, it } from "vitest";
import { leadEventEvidence, matchLeadsToOrders, realOrderEvidence } from "@/lib/attribution/matcher";

describe("phase 5 lead to order matcher", () => {
  it("adapts normalized lead and order store records without exposing identity fields", () => {
    const report = matchLeadsToOrders(
      [leadEventEvidence({ leadId: "lead-1", gclid: "gclid-1234567890" })],
      [realOrderEvidence({ orderId: "order-1", key: "webhook-order-1", value: 500, gclid: "gclid-1234567890" })],
    );
    expect(report.matched[0]).toMatchObject({ leadId: "lead-1", method: "click_id", value: 500 });
    expect(report.matched[0]).not.toHaveProperty("email");
    expect(report.matched[0]).not.toHaveProperty("phone");
  });

  it("prefers exact click evidence over weaker campaign evidence", () => {
    const report = matchLeadsToOrders(
      [
        { leadId: "lead-click", clickIds: ["gclid-1"], campaignLabel: "domain_brand" },
        { leadId: "lead-campaign", campaignLabel: "domain_brand" },
      ],
      [{ orderId: 1, value: 100, clickIds: ["GCLID-1"], campaignLabel: "domain_brand" }],
    );
    expect(report.matched).toEqual([expect.objectContaining({ leadId: "lead-click", method: "click_id" })]);
    expect(report.matchedRevenueRate).toBe(1);
  });

  it("matches UTM campaign, then campaign label, without identity-only attribution", () => {
    const report = matchLeadsToOrders(
      [
        { leadId: "lead-utm", utmCampaign: "summer" },
        { leadId: "lead-label", campaignLabel: "domain_brand" },
      ],
      [
        { orderId: 1, value: 200, utmCampaign: "SUMMER" },
        { orderId: 2, value: 300, campaignLabel: "domain_brand" },
        { orderId: 3, value: 500 },
      ],
    );
    expect(report.matched.map((row) => row.method)).toEqual(["utm_campaign", "campaign_label"]);
    expect(report.unmatched).toEqual([expect.objectContaining({ orderId: 3, reason: "no_ad_evidence" })]);
    expect(report.matchedRevenueRate).toBe(0.5);
  });

  it("does not assign ambiguous or duplicate orders", () => {
    const report = matchLeadsToOrders(
      [{ leadId: "a", campaignLabel: "same" }, { leadId: "b", campaignLabel: "same" }],
      [
        { orderId: "x", key: "stable-x", value: 100, campaignLabel: "same" },
        { orderId: "x-copy", key: "stable-x", value: 100, campaignLabel: "same" },
      ],
    );
    expect(report.matched).toHaveLength(0);
    expect(report.duplicateOrders).toBe(1);
    expect(report.unmatched.map((row) => row.reason)).toEqual(["ambiguous_evidence", "duplicate_order"]);
  });
});

describe("unique revenue denominator", () => {
  const leads = [{ leadId: "l", clickIds: ["a"] }];
  const order = { orderId: "o", key: "k", value: 100, clickIds: ["a"] };
  it("counts identical duplicates once in both denominators", () => {
    const result = matchLeadsToOrders(leads, [order, { ...order }, { orderId: "other", value: 100 }]);
    expect(result.matchedOrderRate).toBe(0.5);
    expect(result.matchedRevenueRate).toBe(0.5);
    expect(result.duplicateOrders).toBe(1);
  });
  it.each([{ value: 200 }, { clickIds: ["b"] }, { currency: "USD" }])("rejects conflicting duplicate evidence regardless of order: %j", (change) => {
    for (const rows of [[order, { ...order, ...change }], [{ ...order, ...change }, order]]) {
      const result = matchLeadsToOrders(leads, rows);
      expect(result.matched).toEqual([]);
      expect(result.matchedRevenueRate).toBeNull();
      expect(result.matchedOrderRate).toBeNull();
      expect(result.unmatched[0]).toMatchObject({ reason: "duplicate_conflict", value: null });
    }
  });
  it("has unknown coverage with no eligible orders", () => {
    expect(matchLeadsToOrders([], [])).toMatchObject({ matchedOrderRate: null, matchedRevenueRate: null });
  });
});

it("does not add revenue across currencies for coverage", () => {
  expect(matchLeadsToOrders([{ leadId: "l", clickIds: ["a"] }], [
    { orderId: 1, value: 100, currency: "VND", clickIds: ["a"] },
    { orderId: 2, value: 100, currency: "USD" },
  ]).matchedRevenueRate).toBeNull();
});
