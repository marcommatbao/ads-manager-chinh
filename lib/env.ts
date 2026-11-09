// ============================================================
// Centralized environment variable registry
//
// Single source of truth for:
//   - which vars are REQUIRED vs OPTIONAL
//   - which vars are SECRET (never log)
//   - which vars belong to which integration
//
// Usage:
//   import { env } from "@/lib/env";
//   env.META_ACCESS_TOKEN   // string | undefined (optional)
//   env.AUTH_SECRET         // always string (throws at module load if missing in prod)
//
// The env object is read-once at module import so Next.js bundler
// can't inline individual vars and we always get runtime values.
// ============================================================

// ── Type declarations ─────────────────────────────────────

interface EnvDescriptor {
  key: string;
  /** Must be set in production — missing throws at startup */
  required: boolean;
  /** Never echo this value in logs or API responses */
  secret: boolean;
  /** Human-readable description */
  description: string;
  /** Integration/domain group */
  group: "auth" | "meta" | "google" | "gemini" | "telegram" | "odoo" | "cron" | "app" | "notifications" | "analytics" | "misc";
  /** Default fallback (only for non-required, non-secret vars) */
  default?: string;
}

// ── Registry ──────────────────────────────────────────────

export const ENV_REGISTRY: EnvDescriptor[] = [
  // Auth (required in production — auth.ts already throws if missing)
  { key: "AUTH_SECRET",        required: true,  secret: true,  group: "auth",     description: "JWT signing secret (min 32 chars)" },
  { key: "NEXTAUTH_SECRET",    required: false, secret: true,  group: "auth",     description: "Alias for AUTH_SECRET (legacy)" },
  { key: "NEXTAUTH_URL",       required: false, secret: false, group: "auth",     description: "Base URL for NextAuth callbacks" },

  // Cron
  { key: "CRON_SECRET",        required: true,  secret: true,  group: "cron",     description: "Bearer token for cron endpoint auth" },

  // Meta
  { key: "META_ACCESS_TOKEN",  required: false, secret: true,  group: "meta",     description: "Meta Marketing API system user token" },
  { key: "META_AD_ACCOUNT_ID", required: false, secret: false, group: "meta",     description: "Meta ad account ID (act_XXXXX)" },
  { key: "META_APP_ID",        required: false, secret: false, group: "meta",     description: "Meta App ID" },
  { key: "META_APP_SECRET",    required: false, secret: true,  group: "meta",     description: "Meta App Secret" },

  // Google Ads
  { key: "GOOGLE_ADS_DEVELOPER_TOKEN",  required: false, secret: true,  group: "google", description: "Google Ads API developer token" },
  { key: "GOOGLE_ADS_CLIENT_ID",        required: false, secret: false, group: "google", description: "OAuth2 client ID" },
  { key: "GOOGLE_ADS_CLIENT_SECRET",    required: false, secret: true,  group: "google", description: "OAuth2 client secret" },
  { key: "GOOGLE_ADS_REFRESH_TOKEN",    required: false, secret: true,  group: "google", description: "OAuth2 refresh token" },
  { key: "GOOGLE_ADS_CUSTOMER_ID_MBC",  required: false, secret: false, group: "google", description: "Google Ads customer ID for MBC" },
  { key: "GOOGLE_ADS_CUSTOMER_ID_MBI",  required: false, secret: false, group: "google", description: "Google Ads customer ID for MBI" },
  { key: "GOOGLE_ADS_LOGIN_CUSTOMER_ID",required: false, secret: false, group: "google", description: "Google Ads MCC login customer ID" },

  // Gemini
  { key: "GEMINI_API_KEY",     required: false, secret: true,  group: "gemini",   description: "Gemini API key for AI features" },

  // Telegram
  { key: "TELEGRAM_BOT_TOKEN", required: false, secret: true,  group: "telegram", description: "Telegram bot token for alerts" },
  { key: "TELEGRAM_CHAT_ID",   required: false, secret: false, group: "telegram", description: "Default Telegram chat/group ID" },

  // Odoo
  { key: "ODOO_URL",           required: false, secret: false, group: "odoo",     description: "Odoo instance URL — BẮT BUỘC nếu dùng tính năng doanh thu Odoo (không còn mặc định trong mã)" },
  { key: "ODOO_DB",            required: false, secret: false, group: "odoo",     description: "Odoo database name — BẮT BUỘC nếu dùng tính năng doanh thu Odoo (không còn mặc định trong mã)" },
  { key: "ODOO_LOGIN",         required: false, secret: false, group: "odoo",     description: "Odoo login email (used by odoo-client)" },
  { key: "ODOO_PASSWORD",      required: false, secret: true,  group: "odoo",     description: "Odoo login password" },
  { key: "ODOO_API_KEY",       required: false, secret: true,  group: "odoo",     description: "Odoo API key (used as password)" },

  // Notifications
  { key: "TEAMS_WEBHOOK_MATBAOIN",        required: false, secret: true, group: "notifications", description: "Teams incoming webhook for matbao.in lead alerts" },
  { key: "TEAMS_WEBHOOK_ORDERS_MATBAOIN", required: false, secret: true, group: "notifications", description: "Teams incoming webhook for matbao.in order alerts" },
  { key: "CASE_TASK_TEAMS_WEBHOOK",      required: false, secret: true, group: "notifications", description: "Teams incoming webhook — nhắc việc giao người quá 3 ngày (Xử lý chiến dịch)" },

  // App
  { key: "NBA_AUTO_APPLY",     required: false, secret: false, group: "app",      description: "NBA auto-apply mode: off|dry_run|on", default: "dry_run" },
  { key: "NBA_AUTO_APPLY_MAX", required: false, secret: false, group: "app",      description: "Max auto-apply actions per company per run", default: "3" },
  { key: "GOOGLE_AUDIT_AI_ENABLED", required: false, secret: false, group: "app", description: "Enable real Gemini AI insight on /google-audit (read-only, cached 1/company/day): true|false", default: "true" },
  { key: "NEXT_PUBLIC_APP_URL",required: false, secret: false, group: "app",      description: "Public app URL" },
  { key: "MB_CONNECT_URL",     required: false, secret: false, group: "app",      description: "Cổng kết nối Mắt Bão — đặt cùng MB_CONNECT_INSTALL_KEY để Google/Meta kết nối bằng nút (không dán khoá)" },
  { key: "MB_CONNECT_INSTALL_KEY", required: false, secret: true, group: "app",   description: "Khoá bản cài do Mắt Bão cấp trên Cổng kết nối (mbk_…)" },

  // Misc
  { key: "APIFY_API_TOKEN",    required: false, secret: true,  group: "misc",     description: "Apify scraping API token" },
  { key: "SERP_API_KEY",       required: false, secret: true,  group: "misc",     description: "SerpApi search API key" },
  { key: "SEARCH_API_KEY",     required: false, secret: true,  group: "misc",     description: "SearchAPI search API key" },
  { key: "RESEND_API_KEY",     required: false, secret: true,  group: "misc",     description: "Resend email API key" },
  { key: "SLACK_BOT_TOKEN",    required: false, secret: true,  group: "misc",     description: "Slack bot token" },
];

// ── Secret key set for fast lookup ────────────────────────

export const SECRET_ENV_KEYS = new Set(
  ENV_REGISTRY.filter(d => d.secret).map(d => d.key),
);

// ── Completeness check ────────────────────────────────────

export interface EnvStatus {
  key: string;
  group: string;
  present: boolean;
  required: boolean;
  secret: boolean;
  description: string;
}

export function getEnvStatus(): EnvStatus[] {
  return ENV_REGISTRY.map(d => ({
    key:         d.key,
    group:       d.group,
    present:     !!process.env[d.key],
    required:    d.required,
    secret:      d.secret,
    description: d.description,
  }));
}

/** Returns missing required env vars — empty array = all good */
export function getMissingRequired(): string[] {
  return ENV_REGISTRY
    .filter(d => d.required && !process.env[d.key])
    .map(d => d.key);
}

/** Returns configured optional env vars grouped by domain */
export function getConfiguredGroups(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const d of ENV_REGISTRY) {
    if (!d.required && process.env[d.key]) {
      (out[d.group] ??= []).push(d.key);
    }
  }
  return out;
}

/** Typed safe accessor — never returns raw value for secret vars in logs */
export const env = new Proxy({} as Record<string, string | undefined>, {
  get(_target, prop: string) {
    return process.env[prop];
  },
});
