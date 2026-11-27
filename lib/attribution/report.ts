import type { Company } from "@/lib/case/types";
import type { LeadTruthMetadata } from "@/lib/leads/source-truth";
import { readLeadEvents } from "@/lib/leads/quality";
import { readOrdersTruth, type OrdersTruthMetadata } from "@/lib/orders/sources";
import { leadEventEvidence, matchLeadsToOrders, realOrderEvidence, type AttributionReport } from "@/lib/attribution/matcher";

/**
 * Build attribution from the stores that already own normalized lead/order data.
 * Only won lead events and paid orders in the requested window participate.
 */
export async function readAttributionReport(
  company: Company,
  since: Date,
  until = new Date(),
): Promise<Omit<AttributionReport, "duplicateOrders"> & { duplicateOrders: number | null; source: OrdersTruthMetadata & { status: "available" | "unavailable"; reason: string | null }; leadSource: LeadTruthMetadata; leadCount: number | null; currencyCount: number | null }> {
  const [truth, storedLeads] = await Promise.all([
    readOrdersTruth(company, since, until),
    Promise.resolve(readLeadEvents(company, { strict: true, since, until })),
  ]);
  const { orders, ...source } = truth;
  const { events, ...leadSource } = storedLeads;
  const leadCount = events === null ? null : events.filter(event => event.stage === "won").length;
  if (orders === null || events === null) return { source, leadSource, leadCount: null, currencyCount: null, matched: [], unmatched: [], duplicateOrders: null, matchedOrderRate: null, matchedRevenueRate: null };
  const from = since.getTime();
  const to = until.getTime();
  const leads = events
    .filter((event) => event.stage === "won")
    .filter((event) => {
      const time = new Date(event.time).getTime();
      return Number.isFinite(time) && time >= from && time <= to;
    })
    .map((event) => leadEventEvidence(event));
  return { ...matchLeadsToOrders(leads, orders.map(realOrderEvidence)), source, leadSource, leadCount, currencyCount: new Set(orders.map(o => o.currency ?? "VND")).size };
}
