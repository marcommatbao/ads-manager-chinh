import type { Company } from "@/lib/case/types";
import { readLeadEvents } from "@/lib/leads/quality";
import { readOrders } from "@/lib/orders/sources";
import { leadEventEvidence, matchLeadsToOrders, realOrderEvidence, type AttributionReport } from "@/lib/attribution/matcher";

/**
 * Build attribution from the stores that already own normalized lead/order data.
 * Only won lead events and paid orders in the requested window participate.
 */
export async function readAttributionReport(
  company: Company,
  since: Date,
  until = new Date(),
): Promise<AttributionReport> {
  const [orders, storedLeads] = await Promise.all([
    readOrders(company, since, until),
    Promise.resolve(readLeadEvents(company)),
  ]);
  const from = since.getTime();
  const to = until.getTime();
  const leads = storedLeads
    .filter((event) => event.stage === "won")
    .filter((event) => {
      const time = new Date(event.time).getTime();
      return Number.isFinite(time) && time >= from && time <= to;
    })
    .map((event) => leadEventEvidence(event));
  return matchLeadsToOrders(leads, orders.map(realOrderEvidence));
}
