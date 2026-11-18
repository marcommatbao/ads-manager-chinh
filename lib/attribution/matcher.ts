// ============================================================
// Phase 5 — evidence-bounded lead → order attribution
//
// This matcher never uses customer identity alone to assign ad revenue.
// A match needs an exact shared advertising key or an exact campaign label.
// Duplicate order keys are counted once; ambiguous evidence is unmatched.
// ============================================================

export type AttributionMatchMethod = "click_id" | "utm_campaign" | "campaign_label";
export type UnmatchedReason = "no_ad_evidence" | "ambiguous_evidence" | "duplicate_order";

export interface LeadAttributionEvidence {
  leadId: string;
  clickIds?: string[];
  utmCampaign?: string;
  campaignLabel?: string;
}

export interface OrderAttributionEvidence {
  orderId: string | number;
  key?: string;
  value: number;
  currency?: string;
  clickIds?: string[];
  utmCampaign?: string;
  campaignLabel?: string;
}

export interface MatchedAttribution {
  orderId: string | number;
  orderKey: string;
  leadId: string;
  value: number;
  currency: string;
  method: AttributionMatchMethod;
}

export interface UnmatchedAttribution {
  orderId: string | number;
  orderKey: string;
  value: number;
  reason: UnmatchedReason;
}

export interface AttributionReport {
  matched: MatchedAttribution[];
  unmatched: UnmatchedAttribution[];
  duplicateOrders: number;
  matchedOrderRate: number;
  matchedRevenueRate: number;
}

export function leadEventEvidence(event: { leadId: string; gclid?: string; gbraid?: string; wbraid?: string; utmCampaign?: string; campaignLabel?: string }): LeadAttributionEvidence {
  return {
    leadId: event.leadId,
    clickIds: [event.gclid, event.gbraid, event.wbraid].filter((value): value is string => Boolean(value)),
    utmCampaign: event.utmCampaign,
    campaignLabel: event.campaignLabel,
  };
}

export function realOrderEvidence(order: { orderId: string | number; key?: string; value: number; currency?: string; gclid?: string; gbraid?: string; wbraid?: string; utm?: { campaign?: string }; productGroup?: string }): OrderAttributionEvidence {
  return {
    orderId: order.orderId,
    key: order.key,
    value: order.value,
    currency: order.currency,
    clickIds: [order.gclid, order.gbraid, order.wbraid].filter((value): value is string => Boolean(value)),
    utmCampaign: order.utm?.campaign,
    campaignLabel: order.productGroup,
  };
}

const clean = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return text || null;
};

const keys = (values: string[] | undefined): string[] =>
  [...new Set((values ?? []).map(clean).filter((value): value is string => Boolean(value)))];

const orderKey = (order: OrderAttributionEvidence): string =>
  clean(order.key) ?? `order-${String(order.orderId)}`;

function findByExactKey(
  orderValue: string | undefined,
  leads: LeadAttributionEvidence[],
  getValue: (lead: LeadAttributionEvidence) => string | undefined,
): LeadAttributionEvidence[] {
  const value = clean(orderValue);
  return value ? leads.filter((lead) => clean(getValue(lead)) === value) : [];
}

function findByClickIds(order: OrderAttributionEvidence, leads: LeadAttributionEvidence[]): LeadAttributionEvidence[] {
  const orderIds = new Set(keys(order.clickIds));
  return orderIds.size
    ? leads.filter((lead) => keys(lead.clickIds).some((id) => orderIds.has(id)))
    : [];
}

export function matchLeadsToOrders(
  leads: LeadAttributionEvidence[],
  orders: OrderAttributionEvidence[],
): AttributionReport {
  const matched: MatchedAttribution[] = [];
  const unmatched: UnmatchedAttribution[] = [];
  const seenOrders = new Set<string>();
  let duplicateOrders = 0;

  for (const order of orders) {
    const key = orderKey(order);
    if (seenOrders.has(key)) {
      duplicateOrders += 1;
      unmatched.push({ orderId: order.orderId, orderKey: key, value: order.value, reason: "duplicate_order" });
      continue;
    }
    seenOrders.add(key);

    const candidates: Array<{ method: AttributionMatchMethod; rows: LeadAttributionEvidence[] }> = [
      { method: "click_id", rows: findByClickIds(order, leads) },
      { method: "utm_campaign", rows: findByExactKey(order.utmCampaign, leads, (lead) => lead.utmCampaign) },
      { method: "campaign_label", rows: findByExactKey(order.campaignLabel, leads, (lead) => lead.campaignLabel) },
    ];

    const selected = candidates.find((candidate) => candidate.rows.length > 0);
    if (!selected) {
      unmatched.push({ orderId: order.orderId, orderKey: key, value: order.value, reason: "no_ad_evidence" });
      continue;
    }
    if (selected.rows.length !== 1) {
      unmatched.push({ orderId: order.orderId, orderKey: key, value: order.value, reason: "ambiguous_evidence" });
      continue;
    }

    matched.push({
      orderId: order.orderId,
      orderKey: key,
      leadId: selected.rows[0].leadId,
      value: order.value,
      currency: order.currency ?? "VND",
      method: selected.method,
    });
  }

  const uniqueOrders = matched.length + unmatched.filter((row) => row.reason !== "duplicate_order").length;
  const totalRevenue = [...matched, ...unmatched].reduce((sum, row) => sum + row.value, 0);
  const matchedRevenue = matched.reduce((sum, row) => sum + row.value, 0);
  return {
    matched,
    unmatched,
    duplicateOrders,
    matchedOrderRate: uniqueOrders > 0 ? matched.length / uniqueOrders : 0,
    matchedRevenueRate: totalRevenue > 0 ? matchedRevenue / totalRevenue : 0,
  };
}
