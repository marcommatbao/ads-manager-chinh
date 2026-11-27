import fs from "fs";
import type { Company } from "@/lib/case/types";
import type { LeadEvent } from "@/lib/leads/quality";

export interface LeadTruthMetadata {
  company: Company; source: "lead_events"; from: string; to: string;
  readAt: string | null; scope: "selected_local_store";
  status: "available" | "unavailable"; complete: boolean;
  reason: "store_unreadable" | "store_invalid" | "completeness_unverified" | "invalid_range" | null;
}
export type LeadTruth = LeadTruthMetadata & { events: LeadEvent[] | null };

/** Full local read only; the count-pruned store has no upstream watermark. */
export function readLeadTruth(company: Company, file: string, since: Date, until: Date, cap: number): LeadTruth {
  const validRange = Number.isFinite(+since) && Number.isFinite(+until) && +since <= +until;
  const meta: LeadTruthMetadata = { company, source: "lead_events", from: Number.isFinite(+since) ? since.toISOString() : "", to: Number.isFinite(+until) ? until.toISOString() : "", readAt: null, scope: "selected_local_store", status: "unavailable", complete: false, reason: null };
  const unavailable = (reason: LeadTruthMetadata["reason"]): LeadTruth => ({ ...meta, reason, events: null });
  if (!validRange) return unavailable("invalid_range");
  let rows: unknown;
  try {
    const raw = fs.readFileSync(file, "utf-8");
    meta.readAt = new Date().toISOString();
    rows = JSON.parse(raw);
  } catch (error) { return unavailable(error instanceof SyntaxError ? "store_invalid" : "store_unreadable"); }
  const valid = (row: unknown): row is LeadEvent => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const r = row as LeadEvent;
    return typeof r.leadId === "string" && !!r.leadId.trim()
      && typeof r.key === "string" && !!r.key.trim()
      && ["qualified", "won", "junk"].includes(r.stage)
      && typeof r.time === "string" && Number.isFinite(Date.parse(r.time))
      && ["pending", "uploaded", "failed", "skipped"].includes(r.status)
      && ["webhook", "csv", "odoo"].includes(r.source)
      && typeof r.receivedAt === "string" && Number.isFinite(Date.parse(r.receivedAt))
      && typeof r.currency === "string" && /^[A-Z]{3}$/.test(r.currency)
      && [r.gclid, r.gbraid, r.wbraid, (r as LeadEvent & { utmCampaign?: unknown }).utmCampaign, (r as LeadEvent & { campaignLabel?: unknown }).campaignLabel].every(v => v === undefined || typeof v === "string");
  };
  if (!Array.isArray(rows) || !rows.every(valid)) return unavailable("store_invalid");
  if (rows.length >= cap) return unavailable("completeness_unverified");
  return { ...meta, status: "available", complete: true, reason: null,
    events: rows.filter(r => Date.parse(r.time) >= +since && Date.parse(r.time) <= +until) };
}
