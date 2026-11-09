// ============================================================
// Connector Capability Matrix
//
// Defines what each connector CAN DO (capabilities) and which
// modules REQUIRE which connectors.
//
// This extends the existing ConnectorDescriptor (registry.ts)
// with semantic capability labels — without modifying the
// existing type so health-store and check code stays intact.
// ============================================================

import type { ConnectorId } from "./types";
import type { ModuleId } from "@/lib/modules/types";

// ── Capability taxonomy ───────────────────────────────────

export type ConnectorCapability =
  | "campaign_read"            // read campaign/ad data
  | "campaign_write"           // create/update/pause campaigns
  | "audience_create"          // create/manage audiences
  | "ad_insights"              // pull performance metrics
  | "revenue_sync"             // sync revenue/order data from ERP
  | "analytics_read"           // website analytics (sessions, goals)
  | "creative_generation"      // generate ad copy / creative with AI
  | "notifications_delivery"   // send alerts / notifications
  | "report_send"              // send formatted reports to channels
  | "competitor_intelligence"  // research competitor ad activity
  | "keyword_research";        // search volume / keyword data

export type ConnectorCategory =
  | "ad_platform"    // Meta, Google Ads
  | "analytics"      // GA4
  | "ai"             // Gemini
  | "notifications"  // Telegram, Slack, Resend
  | "erp"            // Odoo
  | "research";      // Apify, SerpApi, SimilarWeb

// ── Connector metadata extension ─────────────────────────

export interface ConnectorMeta {
  id:           ConnectorId;
  category:     ConnectorCategory;
  capabilities: ConnectorCapability[];
  /**
   * Whether this connector is required or optional platform-wide.
   * required = core features break without it
   * optional = adds value but platform works without it
   */
  platformStatus: "required" | "optional";
}

export const CONNECTOR_META: ConnectorMeta[] = [
  {
    id:             "meta",
    category:       "ad_platform",
    platformStatus: "required",
    capabilities:   ["campaign_read", "campaign_write", "audience_create", "ad_insights", "report_send"],
  },
  {
    id:             "google_ads",
    category:       "ad_platform",
    platformStatus: "required",
    capabilities:   ["campaign_read", "campaign_write", "ad_insights", "keyword_research"],
  },
  {
    id:             "ga4",
    category:       "analytics",
    platformStatus: "required",
    capabilities:   ["analytics_read", "revenue_sync"],
  },
  {
    id:             "gemini",
    category:       "ai",
    platformStatus: "optional",
    capabilities:   ["creative_generation"],
  },
  {
    id:             "telegram",
    category:       "notifications",
    platformStatus: "optional",
    capabilities:   ["notifications_delivery", "report_send"],
  },
  {
    id:             "odoo",
    category:       "erp",
    platformStatus: "optional",
    capabilities:   ["revenue_sync"],
  },
  {
    id:             "slack",
    category:       "notifications",
    platformStatus: "optional",
    capabilities:   ["notifications_delivery", "report_send"],
  },
  {
    id:             "resend",
    category:       "notifications",
    platformStatus: "optional",
    capabilities:   ["notifications_delivery", "report_send"],
  },
  {
    id:             "apify",
    category:       "research",
    platformStatus: "optional",
    capabilities:   ["competitor_intelligence"],
  },
  {
    id:             "serpapi",
    category:       "research",
    platformStatus: "optional",
    capabilities:   ["competitor_intelligence", "keyword_research"],
  },
  {
    id:             "similarweb",
    category:       "research",
    platformStatus: "optional",
    capabilities:   ["competitor_intelligence", "analytics_read"],
  },
];

export const CONNECTOR_META_BY_ID = Object.fromEntries(
  CONNECTOR_META.map(c => [c.id, c])
) as Record<ConnectorId, ConnectorMeta>;

// ── Module → connector requirements ──────────────────────

/**
 * Which connector IDs a module needs.
 * required[] → module is severely degraded without these
 * optional[] → module benefits from these but still works
 */
export interface ModuleConnectorRequirements {
  moduleId:  ModuleId;
  required:  ConnectorId[];
  optional:  ConnectorId[];
}

export const MODULE_CONNECTOR_MATRIX: ModuleConnectorRequirements[] = [
  { moduleId: "dashboard",      required: [],                               optional: ["meta", "google_ads", "ga4"] },
  { moduleId: "campaigns",      required: ["meta"],                         optional: ["google_ads"] },
  { moduleId: "creative",       required: ["meta", "gemini"],               optional: [] },
  { moduleId: "visual-analysis",required: ["meta"],                         optional: ["gemini"] },
  { moduleId: "intelligence",   required: ["meta", "google_ads"],           optional: ["ga4"] },
  { moduleId: "google-pmax",    required: ["google_ads"],                   optional: ["ga4"] },
  { moduleId: "google-audit",   required: ["google_ads"],                   optional: [] },
  { moduleId: "improvements",   required: ["meta"],                         optional: ["google_ads", "gemini"] },
  { moduleId: "automation",     required: ["meta"],                         optional: ["google_ads", "telegram"] },
  { moduleId: "toolkit",        required: ["google_ads"],                   optional: ["meta"] },
  { moduleId: "audiences",      required: ["meta"],                         optional: [] },
  { moduleId: "reports",        required: [],                               optional: ["meta", "google_ads", "ga4"] },
  { moduleId: "notifications",  required: [],                               optional: ["telegram", "slack", "resend"] },
  { moduleId: "competitors",    required: [],                               optional: ["apify", "serpapi", "similarweb"] },
  { moduleId: "ab-testing",     required: ["meta"],                         optional: ["google_ads"] },
];

const MODULE_MATRIX_BY_ID = Object.fromEntries(
  MODULE_CONNECTOR_MATRIX.map(m => [m.moduleId, m])
) as Record<string, ModuleConnectorRequirements>;

// ── Lookup helpers ────────────────────────────────────────

export function getConnectorMeta(id: ConnectorId): ConnectorMeta | undefined {
  return CONNECTOR_META_BY_ID[id];
}

/** Which connectors provide a given capability */
export function connectorsWithCapability(cap: ConnectorCapability): ConnectorId[] {
  return CONNECTOR_META.filter(c => c.capabilities.includes(cap)).map(c => c.id);
}

/** All capabilities a connector provides */
export function capabilitiesOf(id: ConnectorId): ConnectorCapability[] {
  return CONNECTOR_META_BY_ID[id]?.capabilities ?? [];
}

/** Connectors required by a module */
export function requiredConnectorsForModule(moduleId: ModuleId): ConnectorId[] {
  return MODULE_MATRIX_BY_ID[moduleId]?.required ?? [];
}

/** Connectors optional for a module */
export function optionalConnectorsForModule(moduleId: ModuleId): ConnectorId[] {
  return MODULE_MATRIX_BY_ID[moduleId]?.optional ?? [];
}

/** All connectors (required + optional) a module can use */
export function allConnectorsForModule(moduleId: ModuleId): ConnectorId[] {
  const m = MODULE_MATRIX_BY_ID[moduleId];
  if (!m) return [];
  return [...new Set([...m.required, ...m.optional])];
}

/** Modules that depend on a given connector */
export function modulesUsingConnector(connectorId: ConnectorId): ModuleId[] {
  return MODULE_CONNECTOR_MATRIX
    .filter(m => m.required.includes(connectorId) || m.optional.includes(connectorId))
    .map(m => m.moduleId);
}
