// ============================================================
// Đợt 21 A4 — Nạp khoá đã dán ở Cài đặt → API Keys (data/*-settings.json) vào biến môi trường lúc khởi động.
// ============================================================
// Trước đây viết tay trong instrumentation.node.ts và có 2 lỗi thật (03/10):
//   1. gemini-settings.json / telegram-settings.json được route MÃ HOÁ ({iv,tag,data}) nhưng lúc khởi động gán THẲNG đối tượng
//      vào process.env → GEMINI_API_KEY = "[object Object]" → mọi tính năng AI hỏng sau lần khởi động lại đầu tiên (bản
//      Mắt Bão không lộ vì Coolify đặt sẵn biến — biến môi trường được ưu tiên).
//   2. google-settings.json lưu `customerIdMBC` (chữ hoa) nhưng lúc khởi động đọc `customerIdMbc` → mã khách hàng dán ở Cài đặt
//      không bao giờ được nạp lại sau khởi động.
// Quy tắc GIỮ NGUYÊN: biến môi trường đã có giá trị thì THẮNG (bản Mắt Bão không đổi). Giá trị không phải chuỗi → bỏ, không gán.

import { decryptFields } from "@/lib/crypto/data-encryption"
import { markFromSettings } from "./env-origin"
import { SERVICE_KEYS, SERVICE_KEYS_FILE } from "./service-keys-def"

interface Source { file: string; encrypted: string[]; map: Record<string, string> }

export const SAVED_SOURCES: Source[] = [
  { file: "meta-settings.json", encrypted: ["accessToken", "appSecret"], map: { accessToken: "META_ACCESS_TOKEN", adAccountId: "META_AD_ACCOUNT_ID", appId: "META_APP_ID", appSecret: "META_APP_SECRET" } },
  {
    file: "google-settings.json", encrypted: ["developerToken", "clientSecret", "refreshToken"],
    map: {
      developerToken: "GOOGLE_ADS_DEVELOPER_TOKEN", clientId: "GOOGLE_ADS_CLIENT_ID", clientSecret: "GOOGLE_ADS_CLIENT_SECRET", refreshToken: "GOOGLE_ADS_REFRESH_TOKEN",
      customerIdMBC: "GOOGLE_ADS_CUSTOMER_ID_MBC", customerIdMbc: "GOOGLE_ADS_CUSTOMER_ID_MBC", customerIdMBI: "GOOGLE_ADS_CUSTOMER_ID_MBI", customerIdMbi: "GOOGLE_ADS_CUSTOMER_ID_MBI",
      loginCustomerId: "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
    },
  },
  { file: "gemini-settings.json", encrypted: ["apiKey"], map: { apiKey: "GEMINI_API_KEY" } },
  { file: "telegram-settings.json", encrypted: ["botToken"], map: { botToken: "TELEGRAM_BOT_TOKEN", chatId: "TELEGRAM_CHAT_ID" } },
  {
    file: "teams-webhooks-settings.json", encrypted: ["leads_notify", "orders_notify", "job_health_monitor", "ads", "case_task", "measure_monitor", "orders_paid", "orders_cancelled"],
    map: { leads_notify: "TEAMS_WEBHOOK_MATBAOIN", orders_notify: "TEAMS_WEBHOOK_ORDERS_MATBAOIN", job_health_monitor: "TEAMS_WEBHOOK_OPS_ALERTS", ads: "TEAMS_WEBHOOK_ADS", case_task: "CASE_TASK_TEAMS_WEBHOOK", measure_monitor: "MEASURE_MONITOR_TEAMS_WEBHOOK", orders_paid: "TEAMS_WEBHOOK_PAID_MATBAOIN", orders_cancelled: "TEAMS_WEBHOOK_CANCELLED_MATBAOIN" },
  },
  // Đợt 24a: khoá dịch vụ phụ (SerpApi, SearchAPI, Apify, Resend, bot Telegram KPI) — lib/settings/service-keys.ts.
  { file: SERVICE_KEYS_FILE, encrypted: SERVICE_KEYS.filter((k) => k.secret).map((k) => k.key), map: Object.fromEntries(SERVICE_KEYS.map((k) => [k.key, k.envVar])) },
  { file: "odoo-settings.json", encrypted: ["password", "apiKey"], map: { url: "ODOO_URL", db: "ODOO_DB", user: "ODOO_USER", password: "ODOO_PASSWORD", apiKey: "ODOO_API_KEY" } },
]

/** Khoá THEO CÔNG TY (Đợt 21 A4): { [mã công ty]: giá trị } trong tệp → <PREFIX>_<hậu tố công ty>. */
export const PER_COMPANY: { file: string; field: string; sub?: string; prefix: string }[] = [
  { file: "google-settings.json", field: "customerIds", prefix: "GOOGLE_ADS_CUSTOMER_ID" },
  { file: "meta-settings.json", field: "companies", sub: "pixelId", prefix: "NEXT_PUBLIC_META_PIXEL_ID" },
  { file: "meta-settings.json", field: "companies", sub: "pageId", prefix: "NEXT_PUBLIC_META_PAGE_ID" },
]

const ID_RE = /^[A-Z][A-Z0-9_]{1,15}$/

/**
 * HÀM THUẦN theo đầu vào: `files` = nội dung đã đọc (JSON) theo tên tệp, `env` = đối tượng biến môi trường (sửa tại chỗ),
 * `suffixOf` = hậu tố biến của công ty. Trả danh sách TÊN biến đã đặt (không bao giờ giá trị).
 */
export function applySaved(files: Record<string, unknown>, env: Record<string, string | undefined>, suffixOf: (co: string) => string | null): string[] {
  const set: string[] = []
  const put = (name: string, v: unknown) => {
    if (typeof v !== "string") return
    const s = v.trim()
    if (!s || env[name]) return
    env[name] = s; set.push(name)
    if (env === process.env) markFromSettings(name) // Đợt 24a: lưu lại ở Cài đặt sau đó được ghi đè ngay
  }
  for (const src of SAVED_SOURCES) {
    const raw = files[src.file]
    if (!raw || typeof raw !== "object") continue
    let saved: Record<string, unknown>
    try { saved = decryptFields(raw as Record<string, unknown>, src.encrypted) } catch { continue } // sai khoá giải mã → bỏ cả tệp, không gán rác
    for (const [field, name] of Object.entries(src.map)) put(name, saved[field])
  }
  for (const p of PER_COMPANY) {
    const raw = files[p.file] as Record<string, unknown> | undefined
    const m = raw?.[p.field]
    if (!m || typeof m !== "object") continue
    for (const [co, val] of Object.entries(m as Record<string, unknown>)) {
      if (!ID_RE.test(co)) continue
      const suf = suffixOf(co)
      if (!suf) continue
      put(`${p.prefix}_${suf}`, p.sub ? (val as Record<string, unknown> | null)?.[p.sub] : val)
    }
  }
  return set
}

/** Đọc data/*-settings.json thật rồi áp vào process.env (gọi lúc khởi động). */
export async function applySavedCredentials(): Promise<string[]> {
  const fs = (await import("fs")).default
  const path = (await import("path")).default
  const { companyDef } = await import("@/lib/companies")
  const files: Record<string, unknown> = {}
  const names = new Set([...SAVED_SOURCES.map((s) => s.file), ...PER_COMPANY.map((p) => p.file)])
  for (const f of names) {
    const p = path.resolve(process.cwd(), "data", f)
    try { if (fs.existsSync(p)) files[f] = JSON.parse(fs.readFileSync(p, "utf8")) } catch (e) { console.warn(`[startup] ${f} không đọc được — bỏ qua:`, e instanceof Error ? e.message : e) }
  }
  return applySaved(files, process.env as Record<string, string | undefined>, (co) => companyDef(co)?.envSuffix ?? null)
}
