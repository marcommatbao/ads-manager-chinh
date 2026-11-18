import { describe, expect, it } from "vitest";
import { matchLeadsToOrders } from "@/lib/attribution/matcher";

describe("phase 5 lead to order matcher", () => {
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
