// ============================================================
// Tenant / Workspace Core — Types
//
// A Tenant is the fundamental isolation boundary in AdsCommand.
// Current internal companies (MBC, MBI, SALE_AI) are tenants
// with plan="internal".  Future clients use plan="starter"|"pro".
//
// The legacy `legacyCompanyKey` field bridges all existing code
// that uses string string literals — nothing breaks.
// ============================================================

/** Lowercase slug used in new code. e.g. "mbc", "mbi", "sale_ai" */
export type TenantId = string;

export type TenantPlan = "internal" | "starter" | "pro" | "enterprise";

export type TenantStatus = "active" | "suspended" | "trial";

// ── Integration slots ─────────────────────────────────────

export interface TenantGA4 {
  propertyId:    string;
  streamId:      string;
  measurementId: string;
}

export interface TenantFacebook {
  pixelId: string;
}

export interface TenantGoogleAds {
  customerId?: string;
}

export interface TenantIntegrations {
  ga4?:        TenantGA4;
  facebook?:   TenantFacebook;
  googleAds?:  TenantGoogleAds;
}

// ── Tenant metadata ───────────────────────────────────────

export interface TenantMetadata {
  industry?:  string;
  country?:   string;       // e.g. "VN"
  timezone?:  string;       // e.g. "Asia/Ho_Chi_Minh"
  currency?:  string;       // e.g. "VND"
  language?:  string;       // e.g. "vi"
  ownerEmail?: string;
}

// ── Per-tenant settings (overrides global defaults) ───────

export interface TenantSettings {
  /** Feature flag overrides — key: flag name, value: enabled */
  features?: Record<string, boolean>;
  /** Numeric limit overrides — e.g. nba_auto_apply_max: 5 */
  limits?: Record<string, number>;
  notifications?: {
    telegramChatId?: string;
  };
  /** Arbitrary domain-level config to support future settings */
  custom?: Record<string, unknown>;
}

// ── Tenant (core entity) ──────────────────────────────────

export interface Tenant {
  /** Slug used in new code. e.g. "mbc" */
  id:            TenantId;

  /** Display name. e.g. "MBC - Mắt Bão Cloud" */
  name:          string;

  /** Short label shown in UI. e.g. "MBC" */
  shortLabel:    string;

  /** Primary domain. e.g. "matbao.net" */
  domain?:       string;

  /** UI accent color (Tailwind name). e.g. "blue" */
  color?:        string;

  status:        TenantStatus;
  plan:          TenantPlan;
  createdAt:     string;  // ISO

  /**
   * Bridge to legacy company silo code.
   * All existing JSON records use this key (e.g. "MBC") in their
   * `company` field.  New code maps TenantId → legacyCompanyKey
   * when it must call old APIs.
   */
  legacyCompanyKey: string;   // e.g. "MBC"

  metadata:      TenantMetadata;
  integrations:  TenantIntegrations;
  settings:      TenantSettings;
}
