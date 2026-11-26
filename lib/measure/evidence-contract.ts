import type { TagDoctorReport } from "./tag-doctor";

export const TRACKING_LAYERS = ["configured", "tag_fired", "request_sent", "platform_received", "business_reconciled"] as const;
export type TrackingLayer = typeof TRACKING_LAYERS[number];
export type EvidenceReason = "configuration_only" | "missing" | "partial" | "scope" | "stale" | "ambiguous_time" | "runtime" | "network" | "receipt" | "reconciliation";
export interface TrackingEvidence {
  version: 1;
  company: string;
  layers: { layer: TrackingLayer; status: "observed" | "unverified"; reason: EvidenceReason; sourceRef?: "tag-doctor:gtm" }[];
}

/** Read-only projection of the authorized report, never a new reader. No event-level
 * evidence exists here. Aggregate counts, screenshots and variable Names cannot
 * establish runtime values, delivery, receipt or attribution. collectedAt is the
 * report assembly time, NOT a GTM read time; deliberately omit readAt/healthy. */
export function projectTrackingEvidence(company: string, report: Pick<TagDoctorReport, "company" | "gtm" | "sources" | "collectedAt">, now = Date.now()): TrackingEvidence {
  const source = report.sources.find((s) => s.id === "gtm");
  const time = Date.parse(report.collectedAt);
  let reason: EvidenceReason = "missing";
  if (report.company !== company) reason = "scope";
  else if (!Number.isFinite(time) || time > now) reason = "ambiguous_time";
  else if (now - time > 30 * 60_000) reason = "stale";
  else if (source?.status !== "ok") reason = source ? "partial" : "missing";
  else if (report.gtm.some((g) => g.pixelTags.length > 0 || g.googleAdsLabels.length > 0)) reason = "configuration_only";
  return {
    version: 1, company,
    layers: TRACKING_LAYERS.map((layer) => ({
      layer,
      status: layer === "configured" && reason === "configuration_only" ? "observed" : "unverified",
      reason: layer === "configured" ? reason : ({ tag_fired: "runtime", request_sent: "network", platform_received: "receipt", business_reconciled: "reconciliation" } as const)[layer],
      ...(layer === "configured" && reason === "configuration_only" ? { sourceRef: "tag-doctor:gtm" as const } : {}),
    })),
  };
}
