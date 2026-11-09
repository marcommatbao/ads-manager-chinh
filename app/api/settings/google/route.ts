// GET  /api/settings/google — read current Google Ads credentials (masked)
// POST /api/settings/google — save Google Ads credentials
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { maskSecret, isMaskedPlaceholder } from "@/lib/settings/validators/credentials";
import { writeAuditEntry } from "@/lib/settings/audit";
import { guardViewCredentials, guardEditCredentials } from "@/lib/settings/guards";
import { encryptFields, decryptFields } from "@/lib/crypto/data-encryption";
import { withFileLock } from "@/lib/file-lock";
import fs from "fs";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import path from "path";
import { cleanCompanyMap, digitsOnly, envSuffix } from "@/lib/settings/company-ids";
import { companyIds, companyLabel } from "@/lib/companies";

const SETTINGS_PATH = path.resolve(process.cwd(), "data/google-settings.json");

type GoogleSettings = {
  developerToken?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  customerIdMBC?: string;
  customerIdMBI?: string;
  loginCustomerId?: string;
  /** Đợt 21 A4: mã khách hàng theo MỌI công ty của bản cài (MBC/MBI vẫn dùng 2 trường cũ). */
  customerIds?: Record<string, string>;
};

// Real secrets only — clientId/customerIds/loginCustomerId are account
// identifiers, not credentials, and stay plaintext (see file header in
// lib/crypto/data-encryption.ts for why field-level, not whole-file).
const ENCRYPTED_FIELDS = ["developerToken", "clientSecret", "refreshToken"] as const;

function readSettings(): GoogleSettings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) as GoogleSettings;
      return decryptFields(raw, ENCRYPTED_FIELDS);
    }
  } catch { /* ignore */ }
  return {};
}

/** Đợt 21 A4 (soát bảo mật): đọc để GHI — lỗi đọc / giải mã thì NÉM, không trả {} (trả {} rồi ghi = xoá sạch khoá đã lưu khác). */
function readSettingsForWrite(): ReturnType<typeof readSettings> {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  return decryptFields(raw, ENCRYPTED_FIELDS) as ReturnType<typeof readSettings>;
}

async function saveSettings(settings: GoogleSettings): Promise<{ persisted: boolean }> {
  return withFileLock(SETTINGS_PATH, async () => {
    const existing = readSettingsForWrite();
    const merged = { ...existing, ...settings };

    if (merged.developerToken)  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = merged.developerToken;
    if (merged.clientId)        process.env.GOOGLE_ADS_CLIENT_ID = merged.clientId;
    if (merged.clientSecret)    process.env.GOOGLE_ADS_CLIENT_SECRET = merged.clientSecret;
    if (merged.refreshToken)    process.env.GOOGLE_ADS_REFRESH_TOKEN = merged.refreshToken;
    if (merged.customerIdMBC)   process.env.GOOGLE_ADS_CUSTOMER_ID_MBC = merged.customerIdMBC;
    if (merged.customerIdMBI)   process.env.GOOGLE_ADS_CUSTOMER_ID_MBI = merged.customerIdMBI;
    if (merged.loginCustomerId) process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = merged.loginCustomerId;
    for (const [co, id] of Object.entries(merged.customerIds ?? {})) {
      const name = `GOOGLE_ADS_CUSTOMER_ID_${envSuffix(co)}`;
      if (id) process.env[name] = id; else if (settings.customerIds && co in settings.customerIds) delete process.env[name]; // xoá trắng = bỏ ngay
    }

    try {
      fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
      const toWrite = encryptFields(merged, ENCRYPTED_FIELDS);
      writeFileAtomicSync(SETTINGS_PATH, JSON.stringify(toWrite, null, 2));
      return { persisted: true };
    } catch (e) {
      console.warn("[settings/google] Could not persist to disk:", e);
      return { persisted: false };
    }
  });
}

// GET — masked values; never expose raw secrets
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const credGuard = guardViewCredentials(user);
  if (credGuard) return credGuard;

  const saved = readSettings();
  const raw = {
    developerToken:  process.env.GOOGLE_ADS_DEVELOPER_TOKEN   || saved.developerToken  || "",
    clientId:        process.env.GOOGLE_ADS_CLIENT_ID         || saved.clientId        || "",
    clientSecret:    process.env.GOOGLE_ADS_CLIENT_SECRET     || saved.clientSecret    || "",
    refreshToken:    process.env.GOOGLE_ADS_REFRESH_TOKEN     || saved.refreshToken    || "",
    customerIdMBC:   process.env.GOOGLE_ADS_CUSTOMER_ID_MBC   || saved.customerIdMBC   || "",
    customerIdMBI:   process.env.GOOGLE_ADS_CUSTOMER_ID_MBI   || saved.customerIdMBI   || "",
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || saved.loginCustomerId || "",
  };

  return NextResponse.json({
    ok: true,
    // customer IDs are not secrets — return as-is
    customerIdMBC:   raw.customerIdMBC,
    customerIdMBI:   raw.customerIdMBI,
    loginCustomerId: raw.loginCustomerId,
    // Đợt 21 A4: mọi công ty của bản cài (mã khách hàng không phải bí mật)
    companies: companyIds().map((co) => ({ id: co, label: companyLabel(co), customerId: process.env[`GOOGLE_ADS_CUSTOMER_ID_${envSuffix(co)}`] || saved.customerIds?.[co] || (co === "MBC" ? raw.customerIdMBC : co === "MBI" ? raw.customerIdMBI : "") || "" })),
    // secrets — masked
    developerToken:  maskSecret(raw.developerToken),
    clientId:        maskSecret(raw.clientId),
    clientSecret:    maskSecret(raw.clientSecret),
    refreshToken:    maskSecret(raw.refreshToken),
    connected: {
      developerToken: !!raw.developerToken,
      refreshToken:   !!raw.refreshToken,
    },
  });
}

// POST — skip masked placeholders; log audit (field names only)
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const editGuard = guardEditCredentials(user);
  if (editGuard) return editGuard;

  const body = await request.json() as {
    developerToken?: string;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    customerIdMBC?: string;
    customerIdMBI?: string;
    loginCustomerId?: string;
    customerIds?: Record<string, string>;
  };

  const settings: GoogleSettings = {};
  if (body.customerIds !== undefined) {
    const c = cleanCompanyMap(body.customerIds, [10, 10]);
    if (c.errors.length) return NextResponse.json({ ok: false, error: c.errors.join(" · ") }, { status: 400 });
    settings.customerIds = { ...(readSettings().customerIds ?? {}), ...c.map };
  }
  if (body.developerToken  && !isMaskedPlaceholder(body.developerToken))  settings.developerToken  = body.developerToken;
  if (body.clientId        && !isMaskedPlaceholder(body.clientId))        settings.clientId        = body.clientId;
  if (body.clientSecret    && !isMaskedPlaceholder(body.clientSecret))    settings.clientSecret    = body.clientSecret;
  if (body.refreshToken    && !isMaskedPlaceholder(body.refreshToken))    settings.refreshToken    = body.refreshToken;
  // Đợt 21 A4: chỉ nhận chuỗi chữ số 10 số (trước đây giá trị không phải chuỗi làm route ném 500).
  for (const k of ["customerIdMBC", "customerIdMBI", "loginCustomerId"] as const) {
    const v = body[k];
    if (v === undefined || v === null || v === "") continue;
    const d = digitsOnly(v, [10, 10]);
    if (!d) return NextResponse.json({ ok: false, error: `${k}: mã tài khoản Google Ads phải gồm 10 chữ số` }, { status: 400 });
    settings[k] = d;
  }

  if (Object.keys(settings).length === 0) {
    return NextResponse.json({ ok: true, message: "Không có thay đổi mới nào để lưu.", persisted: false });
  }

  let persisted: boolean;
  try { ({ persisted } = await saveSettings(settings)); }
  catch { return NextResponse.json({ ok: false, error: "Không đọc / giải mã được khoá đã lưu (khoá mã hoá DATA_ENCRYPTION_KEY đã đổi hoặc tệp hỏng) — KHÔNG ghi đè để khỏi mất các khoá khác. Liên hệ quản trị." }, { status: 500 }); }

  await writeAuditEntry(
    "credentials_google", user, "update",
    Object.keys(settings).join(", "),
    null, null, "ALL",
  );

  const message = persisted
    ? "Google Ads credentials đã lưu."
    : "Credentials áp dụng (in-memory). Disk write thất bại — sẽ reset khi restart.";

  return NextResponse.json({ ok: true, message, persisted });
}
