import type { TagDoctorReport } from "./tag-doctor";

export const TRACKING_LAYERS = ["configured", "tag_fired", "request_sent", "platform_received", "business_reconciled"] as const;
export type TrackingLayer = typeof TRACKING_LAYERS[number];
export type EvidenceReason = "configuration_only" | "missing" | "partial" | "scope" | "stale" | "ambiguous_time" | "runtime" | "network" | "receipt" | "reconciliation";
export interface TrackingEvidence {
  version: 1;
  company: string;
  layers: { layer: TrackingLayer; status: "observed" | "unverified"; reason: EvidenceReason; sourceRef?: "tag-doctor:gtm"; readAt?: string; sources?: { sourceRef: "gtm:api" | "gtm:public" | "tag-doctor:gtm"; readAt: string | null; configVersion?: string }[] }[];
}

/** Configuration provenance only. Oldest completed read controls freshness;
 * assembly time and legacy cache entries cannot establish source freshness. */
export function projectTrackingEvidence(company: string, report: Pick<TagDoctorReport, "company" | "gtm" | "sources" | "collectedAt">, now = Date.now()): TrackingEvidence {
  const source = report.sources.find((s) => s.id === "gtm");
  const scoped = report.company === company;
  const times = report.gtm.map((g) => typeof g.readAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(g.readAt) ? Date.parse(g.readAt) : NaN);
  const valid = Number.isFinite(now) && times.length > 0 && times.every((time, index) => Number.isFinite(time) && time <= now && new Date(time).toISOString() === report.gtm[index].readAt);
  const oldest = valid ? Math.min(...times) : NaN;
  // Only allow normalized, bounded metadata. Never spread provider objects.
  const sources = scoped ? report.gtm.slice(0, 20).map((g, index) => ({
    sourceRef: g.source === "api" ? "gtm:api" as const : g.source === "public" ? "gtm:public" as const : "tag-doctor:gtm" as const,
    readAt: Number.isFinite(times[index]) && times[index] <= now && new Date(times[index]).toISOString() === g.readAt ? new Date(times[index]).toISOString() : null,
    ...(typeof g.version === "string" && /^\d{1,20}$/.test(g.version) ? { configVersion: g.version } : {}),
  })) : [];
  let reason: EvidenceReason = "missing";
  if (!scoped) reason = "scope";
  else if (source?.status !== "ok") reason = source ? "partial" : "missing";
  else if (!valid) reason = "ambiguous_time";
  else if (now - oldest > 30 * 60_000) reason = "stale";
  else if (report.gtm.some((g) => g.pixelTags.length > 0 || g.googleAdsLabels.length > 0)) reason = "configuration_only";
  return {
    version: 1, company,
    layers: TRACKING_LAYERS.map((layer) => ({
      layer,
      status: layer === "configured" && reason === "configuration_only" ? "observed" : "unverified",
      reason: layer === "configured" ? reason : ({ tag_fired: "runtime", request_sent: "network", platform_received: "receipt", business_reconciled: "reconciliation" } as const)[layer],
      ...(layer === "configured" && scoped ? { sourceRef: "tag-doctor:gtm" as const, sources, ...(valid ? { readAt: new Date(oldest).toISOString() } : {}) } : {}),
    })),
  };
}
