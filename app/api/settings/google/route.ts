// GET  /api/settings/google — read current Google Ads credentials (masked)
// POST /api/settings/google — save Google Ads credentials
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { maskSecret, isMaskedPlaceholder } from "@/lib/settings/validators/credentials";
import { writeAuditEntry } from "@/lib/settings/audit";
import { guardViewCredentials, guardEditCredentials } from "@/lib/settings/guards";
import path from "path";
import { readGoogleCredentials, saveGoogleCredentials, googleCredentialProvenance, type GoogleSettings } from "@/lib/settings/google-credentials";
import { cleanCompanyMap, digitsOnly, envSuffix } from "@/lib/settings/company-ids";
import { companyIds, companyLabel } from "@/lib/companies";

const SETTINGS_PATH = path.resolve(process.cwd(), "data/google-settings.json");

function readSettings(): GoogleSettings {
  try { return readGoogleCredentials(SETTINGS_PATH); } catch { return {}; }
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
    provenance: googleCredentialProvenance(SETTINGS_PATH, envSuffix),
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

  for (const field of ["developerToken", "clientId", "clientSecret", "refreshToken"] as const) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return NextResponse.json({ ok: false, error: "Credential fields must be strings." }, { status: 400 });
    }
  }
  const settings: GoogleSettings = {};
  if (body.customerIds !== undefined) {
    const c = cleanCompanyMap(body.customerIds, [10, 10]);
    if (c.errors.length) return NextResponse.json({ ok: false, error: c.errors.join(" · ") }, { status: 400 });
    settings.customerIds = c.map;
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
    return NextResponse.json({ ok: true, message: "Không có thay đổi mới nào để lưu.", persisted: false, provenance: googleCredentialProvenance(SETTINGS_PATH, envSuffix) });
  }

  let provenance;
  try { provenance = await saveGoogleCredentials(SETTINGS_PATH, settings, envSuffix); }
  catch { return NextResponse.json({ ok: false, persisted: false, provenance: googleCredentialProvenance(SETTINGS_PATH, envSuffix), error: "Không lưu được cấu hình Google (lỗi đọc, giải mã hoặc ghi tệp). Chưa thay đổi credentials đang chạy; liên hệ quản trị kiểm tra storage/key." }, { status: 500 }); }

  await writeAuditEntry(
    "credentials_google", user, "update",
    Object.keys(settings).join(", "),
    null, null, "ALL",
  );

  const message = provenance.restartConflict
    ? "Đã lưu vào tệp; env đang được ưu tiên. Cấu hình đã lưu chưa có hiệu lực đầy đủ và vẫn xung đột khi khởi động lại với cùng env."
    : "Đã lưu và áp dụng cấu hình Google. Nạp lại sau restart cần giữ nguyên env, khoá mã hoá và storage; chưa kiểm tra xác thực Google.";

  return NextResponse.json({ ok: true, message, persisted: true, effective: provenance.effective, restartConflict: provenance.restartConflict, provenance });
}
