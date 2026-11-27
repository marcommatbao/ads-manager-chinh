import type { readAttributionReport } from "@/lib/attribution/report";

/** Explicit aggregate projection: never spread the detail report into this response. */
export function aggregateAttribution(report: Awaited<ReturnType<typeof readAttributionReport>>) {
  const available = report.source.status === "available" && report.leadSource.status === "available";
  const uniqueUnmatched = report.unmatched.filter(row => row.reason !== "duplicate_order");
  return {
    source: report.source, leadSource: report.leadSource,
    status: available ? "available" : report.source.status !== report.leadSource.status ? "partial" : "unavailable",
    campaignBinding: "not_established" as const,
    leadCount: available ? report.leadCount : null,
    uniqueOrders: available ? report.matched.length + uniqueUnmatched.length : null,
    matchedOrders: available ? report.matched.length : null,
    unmatchedOrders: available ? uniqueUnmatched.length : null,
    ambiguousOrders: available ? uniqueUnmatched.filter(r => r.reason === "ambiguous_evidence").length : null,
    duplicateOrders: available ? report.duplicateOrders : null,
    duplicateConflicts: available ? uniqueUnmatched.filter(r => r.reason === "duplicate_conflict").length : null,
    currencyCount: available ? report.currencyCount : null,
    matchedOrderRate: available ? report.matchedOrderRate : null,
    matchedRevenueRate: available ? report.matchedRevenueRate : null,
  };
}
export type AttributionAggregate = ReturnType<typeof aggregateAttribution>;
