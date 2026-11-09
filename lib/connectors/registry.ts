// ============================================================
// Connector registry — static descriptor for every integration
// ============================================================

import type { ConnectorDescriptor, ConnectorId } from "./types";

export const CONNECTOR_REGISTRY: ConnectorDescriptor[] = [
  {
    id: "meta",
    displayName: "Meta (Facebook) Ads",
    requiredEnv: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"],
    optionalEnv: ["META_APP_ID", "META_APP_SECRET"],
    secretEnv:   ["META_ACCESS_TOKEN", "META_APP_SECRET"],
    supportsLiveTest: true,
    color: "bg-blue-500",
    icon: "📘",
  },
  {
    id: "google_ads",
    displayName: "Google Ads",
    // 12/10/2026: developer token sang optionalEnv — Google bỏ từ 09/09/2026, thiếu token vẫn gọi được API.
    requiredEnv: [
      "GOOGLE_ADS_CLIENT_ID",
      "GOOGLE_ADS_CLIENT_SECRET",
      "GOOGLE_ADS_REFRESH_TOKEN",
    ],
    optionalEnv: [
      "GOOGLE_ADS_DEVELOPER_TOKEN",
      "GOOGLE_ADS_CUSTOMER_ID_MBC",
      "GOOGLE_ADS_CUSTOMER_ID_MBI",
      "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
    ],
    secretEnv: [
      "GOOGLE_ADS_DEVELOPER_TOKEN",
      "GOOGLE_ADS_CLIENT_SECRET",
      "GOOGLE_ADS_REFRESH_TOKEN",
    ],
    supportsLiveTest: true,
    color: "bg-amber-500",
    icon: "📊",
  },
  {
    id: "ga4",
    displayName: "Google Analytics 4",
    requiredEnv: ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_REFRESH_TOKEN"],
    secretEnv:   ["GOOGLE_ADS_REFRESH_TOKEN"],
    supportsLiveTest: false,
    color: "bg-orange-500",
    icon: "📈",
  },
  {
    id: "gemini",
    displayName: "Google Gemini AI",
    requiredEnv: ["GEMINI_API_KEY"],
    secretEnv:   ["GEMINI_API_KEY"],
    supportsLiveTest: true,
    color: "bg-purple-500",
    icon: "✨",
  },
  {
    id: "telegram",
    displayName: "Telegram Bot",
    requiredEnv: ["TELEGRAM_BOT_TOKEN"],
    optionalEnv: ["TELEGRAM_CHAT_ID"],
    secretEnv:   ["TELEGRAM_BOT_TOKEN"],
    supportsLiveTest: true,
    color: "bg-sky-500",
    icon: "💬",
  },
  {
    id: "odoo",
    displayName: "Odoo ERP",
    // Đợt 20b: đăng nhập nhận HAI cặp tên (ODOO_LOGIN+ODOO_API_KEY hoặc ODOO_USER+ODOO_PASSWORD) — checkOdoo() kiểm
    // cặp nào cũng được; ở đây chỉ bắt buộc URL + DB để không báo "thiếu" khi đang dùng cặp kia.
    requiredEnv: ["ODOO_URL", "ODOO_DB"],
    optionalEnv: ["ODOO_LOGIN", "ODOO_API_KEY", "ODOO_USER", "ODOO_PASSWORD"],
    secretEnv:   ["ODOO_API_KEY", "ODOO_PASSWORD"],
    supportsLiveTest: true,
    color: "bg-rose-500",
    icon: "🏢",
  },
  {
    id: "slack",
    displayName: "Slack",
    requiredEnv: ["SLACK_BOT_TOKEN"],
    optionalEnv: ["SLACK_CHANNEL_ID"],
    secretEnv:   ["SLACK_BOT_TOKEN"],
    supportsLiveTest: false,
    color: "bg-green-500",
    icon: "💼",
  },
  {
    id: "resend",
    displayName: "Resend (Email)",
    requiredEnv: ["RESEND_API_KEY"],
    secretEnv:   ["RESEND_API_KEY"],
    supportsLiveTest: false,
    color: "bg-zinc-600",
    icon: "📧",
  },
  {
    id: "apify",
    displayName: "Apify",
    requiredEnv: ["APIFY_API_TOKEN"],
    secretEnv:   ["APIFY_API_TOKEN"],
    supportsLiveTest: false,
    color: "bg-teal-500",
    icon: "🕸️",
  },
  {
    id: "serpapi",
    displayName: "SerpApi",
    // Đợt 24a: mã đọc SERP_API_KEY (lib/intelligence-fetcher.ts) — tên cũ SERPAPI_KEY làm bảng này luôn báo "chưa cấu hình".
    requiredEnv: ["SERP_API_KEY"],
    secretEnv:   ["SERP_API_KEY"],
    supportsLiveTest: false,
    color: "bg-indigo-500",
    icon: "🔍",
  },
  {
    id: "similarweb",
    displayName: "SimilarWeb",
    requiredEnv: [],          // no key needed — public API with 24h cache
    supportsLiveTest: false,
    color: "bg-cyan-500",
    icon: "🌐",
  },
];

export const CONNECTORS_BY_ID = Object.fromEntries(
  CONNECTOR_REGISTRY.map(c => [c.id, c]),
) as Record<ConnectorId, ConnectorDescriptor>;

export function getDescriptor(id: ConnectorId): ConnectorDescriptor {
  return CONNECTORS_BY_ID[id];
}

/** Returns true when connector is explicitly disabled via env */
export function isConnectorDisabled(id: ConnectorId): boolean {
  const key = `CONNECTOR_${id.toUpperCase()}_DISABLED`;
  return process.env[key] === "1" || process.env[key] === "true";
}
