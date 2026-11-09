// ============================================================
// Audience Builder — Types, helpers, SHA256 hashing
// For Custom Audience + Lookalike creation via FB Graph API
// ============================================================

import { createHash } from "crypto";
import type { TFunction } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/messages";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type AudienceSource =
  | "offline_orders"     // KH đã mua
  | "good_cpl"           // KH có CPL tốt
  | "web_visitors"       // Xem web > 3 trang (cần Pixel)
  | "csv_upload";        // Upload file CSV

export type LookalikeRatio = 0.01 | 0.02 | 0.03 | 0.05 | 0.10;

export interface AudienceConfig {
  source: AudienceSource;
  company: string | "both";
  days: number;           // 90, 180, 365
  minAmount?: number;     // Min order value (VND)
  cplThreshold?: number;  // Max CPL for "good_cpl" source
  lookalikeRatios: LookalikeRatio[];
  audienceName?: string;
}

export interface CustomerRecord {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  name?: string;           // Full name (will be split into FN/LN)
  gender?: string;         // "male" | "female"
  dob?: string;            // "DD/MM/YYYY" or "YYYY-MM-DD"
  city?: string;
  province?: string;
  country?: string;
}

export interface AudienceResult {
  customAudienceId: string;
  customAudienceName: string;
  // Present for list-based (CUSTOM) audiences: offline_orders/good_cpl/
  // csv_upload. Absent for web_visitors (WEBSITE audience — no uploaded
  // list, so no customer count to report).
  customerCount?: number;
  // Meta computes real audience size (approximate_count_lower_bound /
  // approximate_count_upper_bound) asynchronously — it is NEVER available
  // on the creation response for either a Lookalike or a WEBSITE audience.
  // "pending" is the only honest value here; there is no real number to
  // show yet. See app/api/audiences/create-lookalike/route.ts and
  // app/api/audiences/create-website-audience/route.ts.
  sizeStatus?: "pending";
  lookalikes: Array<{
    id: string;
    name: string;
    ratio: number;
  }>;
  createdAt: string;
}

// Source metadata for UI
export interface SourceInfo {
  id: AudienceSource;
  label: string;
  description: string;
  icon: string;
  estimatedCount: number;
  requiresPixel: boolean;
  requiresUpload: boolean;
}

export const AUDIENCE_SOURCES: SourceInfo[] = [
  {
    id: "csv_upload",
    label: "Upload file CSV",
    description: "Tải lên danh sách email/SĐT khách hàng từ CRM hoặc file Excel",
    icon: "📄",
    // Real count comes from the parsed upload (see estimateAudienceSize's
    // realCount param) — this 0 is only a placeholder before a file exists.
    estimatedCount: 0,
    requiresPixel: false,
    requiresUpload: true,
  },
  {
    id: "offline_orders",
    label: "KH đã mua (offline orders)",
    description: "Cần upload CSV từ hệ thống order — xem hướng dẫn bên dưới",
    icon: "🛒",
    // REAL for MBI: app/api/audiences/offline-customers wires this to a
    // real Odoo query (lib/odoo-mbi-audience.ts) — sale.order (state=sale,
    // team_id/customer_source per MBI_ORDER_DOMAIN in
    // lib/mbi-order-sources.ts, same rule already proven live in
    // app/api/cron/orders-notify/route.ts) joined to res.partner for
    // name/phone/email. app/(dashboard)/audiences/page.tsx calls that route
    // directly when company === "MBI" and feeds the real customer count
    // into estimateAudienceSize() below — this static `estimatedCount: 0`
    // is only the Step-1 placeholder shown before a company is chosen.
    //
    // STILL CSV-ONLY for MBC / "both": there is no proven Odoo
    // company-split query for MBC's sale.order records in this codebase.
    // MBC's only revenue path (lib/finance/company-pnl.ts) goes through a
    // separate, aggregate-only internal Report API (MATBAO_REPORT_API) with
    // no customer records at all — guessing an MBC source_id filter (or a
    // "not MBI = MBC" exclusion) risks mixing the wrong company's customers
    // into an audience, which is worse than leaving MBC on manual CSV
    // upload. Do not "fix" this by guessing a filter — it needs a real,
    // confirmed MBC sale.order company-split query first.
    estimatedCount: 0,
    requiresPixel: false,
    requiresUpload: true,
  },
  {
    id: "good_cpl",
    label: "KH có CPL tốt",
    description: "Export lead chất lượng từ CRM rồi upload CSV",
    icon: "💰",
    // TODO(audience-size): genuinely not fixable without new Odoo-side
    // infrastructure. app/api/cron/leads-notify/route.ts's crm.lead query
    // (the closest real source — per-lead phone/email_from) has NO field
    // linking a lead back to the specific Meta campaign it came from, so
    // "this lead came from a campaign with good CPL this month" cannot be
    // determined from any data this app currently reads — CPL is computed
    // per-campaign (lib/cpl-calculator.ts), not per-lead. Fixing this needs
    // either (a) a custom Odoo field on crm.lead capturing the Meta
    // campaign_id at lead-creation time, or (b) unverified name-matching
    // against Odoo's own utm.campaign records — both are new Odoo-side
    // work, not something this app's existing reads can back into. Keep
    // estimatedCount: 0 and the CSV-upload requirement until one of those
    // exists.
    estimatedCount: 0,
    requiresPixel: false,
    requiresUpload: true,
  },
  {
    id: "web_visitors",
    label: "KH đã xem web > 3 trang",
    description: "Yêu cầu Facebook Pixel đã cài đặt trên website",
    icon: "🌐",
    // Structurally different from the other sources — not a "no count
    // wired in yet" gap. This is a real, live Meta WEBSITE Custom Audience
    // (subtype=WEBSITE, see lib/meta-client.ts's createWebsiteCustomAudience
    // + app/api/audiences/create-website-audience/route.ts): Meta computes
    // membership server-side from live Pixel traffic and — like Lookalike
    // size — never exposes a pre-creation size estimate for it, real or
    // otherwise. estimatedCount stays 0 permanently and is intentionally
    // NOT fed into estimateAudienceSize() for this source; the UI shows
    // honest copy ("Meta sẽ tự tính kích thước...") instead of any number.
    estimatedCount: 0,
    requiresPixel: true,
    requiresUpload: false,
  },
];

// NOTE: this previously had an `estimatedSize` field computed as
// ratio × Vietnam's population (e.g. "~800K người VN" for 1%) — a fabricated
// number with no relationship to Meta's real audience size, shown before an
// audience even existed. Removed. The ratio itself (1%/2%/3%/5%/10%) is a
// genuine Meta Lookalike parameter — only the invented size claim is gone.
export const LOOKALIKE_OPTIONS: Array<{
  ratio: LookalikeRatio;
  label: string;
  description: string;
}> = [
  { ratio: 0.01, label: "1% Lookalike", description: "Giống nhất — chất lượng cao" },
  { ratio: 0.02, label: "2% Lookalike", description: "Cân bằng chất lượng & quy mô" },
  { ratio: 0.03, label: "3% Lookalike", description: "Rộng hơn, ít chính xác hơn" },
  { ratio: 0.05, label: "5% Lookalike", description: "Scale lớn" },
];

export const TIME_RANGES = [
  { days: 90, label: "90 ngày gần nhất" },
  { days: 180, label: "180 ngày" },
  { days: 365, label: "365 ngày" },
];

export const MIN_AMOUNTS = [
  { value: 0, label: "Tất cả" },
  { value: 500000, label: "Từ ₫500K trở lên (KH chất lượng cao)" },
  { value: 1000000, label: "Từ ₫1M trở lên (KH VIP)" },
  { value: 3000000, label: "Từ ₫3M trở lên (KH Premium)" },
];

// ─────────────────────────────────────────────
// SHA256 Hashing (required by FB Custom Audiences)
// ─────────────────────────────────────────────

export function hashSHA256(value: string): string {
  if (!value) return "";
  const normalized = value.trim().toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

export function normalizePhone(phone: string): string {
  // Convert VN phone formats: 0901234567 → 84901234567
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "84" + cleaned.slice(1);
  }
  if (!cleaned.startsWith("84")) {
    cleaned = "84" + cleaned;
  }
  return cleaned;
}

/**
 * Normalize VN phone and return SHA256 hashes for BOTH 0xxx and 84xxx formats.
 * This doubles the Facebook match rate for Vietnamese phone numbers.
 */
export function normalizeAndHashPhone(raw: string): string[] {
  if (!raw) return [];

  // Clean: remove spaces, dashes, dots, plus sign
  const cleaned = raw
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .replace(/\./g, "")
    .replace(/\+/g, "");

  const hashed: string[] = [];

  // Format: 0912345678 (10 digits starting with 0)
  if (cleaned.startsWith("0") && cleaned.length === 10) {
    hashed.push(hashSHA256(cleaned));
    // Also hash as 84xxx
    const with84 = "84" + cleaned.slice(1);
    hashed.push(hashSHA256(with84));
  }
  // Format: 84912345678 (11 digits starting with 84)
  else if (cleaned.startsWith("84") && cleaned.length === 11) {
    hashed.push(hashSHA256(cleaned));
    // Also hash as 0xxx
    const with0 = "0" + cleaned.slice(2);
    hashed.push(hashSHA256(with0));
  }
  // Other formats (8+ digits) — hash as-is
  else if (cleaned.length >= 8) {
    hashed.push(hashSHA256(cleaned));
  }

  return hashed;
}

// ─────────────────────────────────────────────
// Name normalization (strip VN diacritics → hash)
// ─────────────────────────────────────────────

export function normalizeName(raw: string): string {
  if (!raw) return "";
  const noAccent = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .trim()
    .toLowerCase();
  return hashSHA256(noAccent);
}

// ─────────────────────────────────────────────
// City normalization (VN city → FB key → hash)
// ─────────────────────────────────────────────

const CITY_MAP: Record<string, string> = {
  "hồ chí minh": "ho chi minh city",
  "hcm": "ho chi minh city",
  "tp.hcm": "ho chi minh city",
  "tp hcm": "ho chi minh city",
  "sài gòn": "ho chi minh city",
  "hà nội": "hanoi",
  "hn": "hanoi",
  "đà nẵng": "da nang",
  "cần thơ": "can tho",
  "bình dương": "binh duong",
  "đồng nai": "dong nai",
  "hải phòng": "hai phong",
  "long an": "long an",
  "bà rịa vũng tàu": "ba ria vung tau",
};

export function normalizeCity(raw: string): string {
  if (!raw) return "";
  const key = raw.trim().toLowerCase();
  const mapped = CITY_MAP[key] || key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d");
  return hashSHA256(mapped);
}

// ─────────────────────────────────────────────
// Build audience payload — dynamic schema
// Only includes fields that have actual data
// ─────────────────────────────────────────────

interface FieldEntry { key: string; value: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildAudiencePayload(customers: Array<Record<string, any>>) {
  const rows: FieldEntry[][] = [];
  const VN_HASH = hashSHA256("vn");

  for (const c of customers) {
    // ── Normalize each field ──
    const email = c.customer_email || c.email || "";
    const phone = c.customer_phone || c.phone || "";
    const name = c.customer_name || c.name || "";
    const city = c.customer_city || c.city || "";
    const gender = c.customer_gender || c.gender || "";
    const firstName = c.firstName || "";
    const lastName = c.lastName || "";

    const emailHash = email ? hashSHA256(email.trim().toLowerCase()) : null;
    const phoneHashes = normalizeAndHashPhone(phone);

    // Split full name into FN/LN (Vietnamese: lastName is first word)
    let fnHash: string | null = null;
    let lnHash: string | null = null;
    if (firstName || lastName) {
      fnHash = firstName ? normalizeName(firstName) : null;
      lnHash = lastName ? normalizeName(lastName) : null;
    } else if (name) {
      const parts = name.trim().split(/\s+/);
      lnHash = parts[0] ? normalizeName(parts[0]) : null;
      fnHash = parts.length > 1 ? normalizeName(parts.slice(1).join(" ")) : null;
    }

    const cityHash = city ? normalizeCity(city) : null;
    const genHash = gender
      ? hashSHA256(gender.toLowerCase().startsWith("f") ? "f" : "m")
      : null;

    // Skip if no email AND no phone
    if (!emailHash && phoneHashes.length === 0) continue;

    // ── Build field entries (only fields with data) ──
    const fieldEntries: FieldEntry[] = [];
    if (emailHash) fieldEntries.push({ key: "EMAIL", value: emailHash });
    // PHONE will be inserted per-row below
    if (fnHash) fieldEntries.push({ key: "FN", value: fnHash });
    if (lnHash) fieldEntries.push({ key: "LN", value: lnHash });
    if (genHash) fieldEntries.push({ key: "GEN", value: genHash });
    if (cityHash) fieldEntries.push({ key: "CT", value: cityHash });
    fieldEntries.push({ key: "COUNTRY", value: VN_HASH });

    // ── Create rows: each phone format = 1 row ──
    const phonesToProcess = phoneHashes.length > 0 ? phoneHashes : [null];

    for (const phoneHash of phonesToProcess) {
      const rowFields = [...fieldEntries];
      if (phoneHash) {
        const emailIdx = rowFields.findIndex(f => f.key === "EMAIL");
        rowFields.splice(emailIdx + 1, 0, { key: "PHONE", value: phoneHash });
      }
      rows.push(rowFields);
    }
  }

  // ── Build schema from all keys present ──
  const allKeys = new Set<string>();
  for (const row of rows) {
    for (const field of row) {
      allKeys.add(field.key);
    }
  }

  const KEY_ORDER = ["EMAIL", "PHONE", "FN", "LN", "GEN", "DOB", "CT", "ST", "COUNTRY"];
  const schema = KEY_ORDER.filter(k => allKeys.has(k));

  // ── Convert rows to arrays matching schema order ──
  const data = rows.map(rowFields => {
    const rowMap = Object.fromEntries(rowFields.map(f => [f.key, f.value]));
    return schema.map(key => rowMap[key] || "");
  });

  return { schema, data };
}

// ─────────────────────────────────────────────
// Generate audience name
// ─────────────────────────────────────────────

export function generateAudienceName(config: AudienceConfig): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(2);
  const company = config.company === "both" ? "ALL" : config.company;

  const sourceKey: Record<AudienceSource, string> = {
    offline_orders: "Buyers",
    good_cpl: "GoodLeads",
    web_visitors: "WebVisitors",
    csv_upload: "CSVUpload",
  };

  return `${company}-${sourceKey[config.source]}-${month}/${year}`;
}

// ─────────────────────────────────────────────
// Estimate audience size based on filters
// ─────────────────────────────────────────────

export function estimateAudienceSize(config: AudienceConfig, realCount?: number): number {
  // CSV upload: we already know the exact row count from the parsed file.
  // offline_orders + MBI: app/(dashboard)/audiences/page.tsx has already
  // fetched the real customer list from Odoo (see
  // app/api/audiences/offline-customers/route.ts / lib/odoo-mbi-audience.ts)
  // and passes its length here. Both cases return the real number directly
  // instead of "estimating" from a hardcoded 0 — the company/time-range/
  // amount multipliers below only make sense for sources whose numbers are
  // still genuinely guessed (they don't apply to real, already-filtered
  // data — the Odoo query and CSV both already reflect the chosen
  // company/date/amount filters).
  if (
    typeof realCount === "number" &&
    (config.source === "csv_upload" || (config.source === "offline_orders" && config.company === "MBI"))
  ) {
    return Math.max(0, realCount);
  }

  const source = AUDIENCE_SOURCES.find(s => s.id === config.source);
  if (!source) return 0;

  let estimate = source.estimatedCount;

  // Company filter reduces by ~50%
  if (config.company !== "both") {
    estimate = Math.round(estimate * 0.55);
  }

  // Time range reduces proportionally
  if (config.days < 365) {
    estimate = Math.round(estimate * (config.days / 365));
  }

  // Min amount filter
  if (config.minAmount && config.minAmount >= 3000000) {
    estimate = Math.round(estimate * 0.15);
  } else if (config.minAmount && config.minAmount >= 1000000) {
    estimate = Math.round(estimate * 0.35);
  } else if (config.minAmount && config.minAmount >= 500000) {
    estimate = Math.round(estimate * 0.55);
  }

  return Math.max(0, estimate);
}

// Minimum audience size for FB Lookalike
export const MIN_AUDIENCE_SIZE = 100;

// ─────────────────────────────────────────────
// Nhãn theo ngôn ngữ (GĐ3) — không truyền `t` thì trả đúng bản tiếng Việt ở các bảng trên.
// ─────────────────────────────────────────────
export const sourceLabel = (id: AudienceSource, t?: TFunction): string => (t ? t(`libmeta.aud.src.${id}.label` as MessageKey) : (AUDIENCE_SOURCES.find((s) => s.id === id)?.label ?? id));
export const sourceDescription = (id: AudienceSource, t?: TFunction): string => (t ? t(`libmeta.aud.src.${id}.desc` as MessageKey) : (AUDIENCE_SOURCES.find((s) => s.id === id)?.description ?? ""));
/** Mô tả của một mức lookalike (nhãn "N% Lookalike" giống nhau ở cả hai ngôn ngữ). */
export const lookalikeDescription = (ratio: LookalikeRatio, t?: TFunction): string => (t && ratio !== 0.10 ? t(`libmeta.aud.la.${Math.round(ratio * 100)}.desc` as MessageKey) : (LOOKALIKE_OPTIONS.find((o) => o.ratio === ratio)?.description ?? ""));
export const timeRangeLabel = (days: number, t?: TFunction): string => (t && [90, 180, 365].includes(days) ? t(`libmeta.aud.range.${days}` as MessageKey) : (TIME_RANGES.find((r) => r.days === days)?.label ?? String(days)));
export const minAmountLabel = (value: number, t?: TFunction): string => (t && [0, 500000, 1000000, 3000000].includes(value) ? t(`libmeta.aud.amt.${value}` as MessageKey) : (MIN_AMOUNTS.find((a) => a.value === value)?.label ?? String(value)));
