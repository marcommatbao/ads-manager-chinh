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
import { cleanCompanyMap, envSuffix } from "@/lib/settings/company-ids";
import { companyIds, companyLabel } from "@/lib/companies";

const SETTINGS_PATH = path.resolve(process.cwd(), "data/meta-settings.json");

type MetaSettings = {
  accessToken?: string;
  adAccountId?: string;
  appId?: string;
  appSecret?: string;
  /** Đợt 21 A4: pixel / trang Meta theo công ty của bản cài → NEXT_PUBLIC_META_PIXEL_ID_<hậu tố>… (đọc lúc chạy ở máy chủ). */
  companies?: Record<string, { pixelId?: string; pageId?: string }>;
};

// Real secrets only — appId/adAccountId are identifiers, not credentials.
const ENCRYPTED_FIELDS = ["accessToken", "appSecret"] as const;

function readSettings(): MetaSettings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) as MetaSettings;
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

async function saveSettings(settings: MetaSettings): Promise<{ persisted: boolean }> {
  return withFileLock(SETTINGS_PATH, async () => {
    const existing = readSettingsForWrite();
    const merged = { ...existing, ...settings };
    // Apply to runtime process.env immediately (works for current process lifetime)
    if (merged.accessToken) process.env.META_ACCESS_TOKEN = merged.accessToken;
    if (merged.adAccountId) process.env.META_AD_ACCOUNT_ID = merged.adAccountId;
    if (merged.appId) process.env.META_APP_ID = merged.appId;
    if (merged.appSecret) process.env.META_APP_SECRET = merged.appSecret;
    for (const [co, v] of Object.entries(merged.companies ?? {})) {
      for (const [k, prefix] of [["pixelId", "NEXT_PUBLIC_META_PIXEL_ID"], ["pageId", "NEXT_PUBLIC_META_PAGE_ID"]] as const) {
        const name = `${prefix}_${envSuffix(co)}`, val = v[k];
        if (val) process.env[name] = val; else if (settings.companies?.[co] && k in settings.companies[co]) delete process.env[name]; // xoá trắng = bỏ ngay
      }
    }
    // Write to disk for persistence across restarts
    try {
      fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
      const toWrite = encryptFields(merged, ENCRYPTED_FIELDS);
      writeFileAtomicSync(SETTINGS_PATH, JSON.stringify(toWrite, null, 2));
      return { persisted: true };
    } catch (e) {
      console.warn("[settings/meta] Could not persist to disk:", e);
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
  const rawAccessToken = process.env.META_ACCESS_TOKEN || saved.accessToken || "";
  const rawAccountId   = process.env.META_AD_ACCOUNT_ID || saved.adAccountId || "";
  const rawAppId       = process.env.META_APP_ID || saved.appId || "";
  const rawAppSecret   = process.env.META_APP_SECRET || saved.appSecret || "";
  const fmtAccountId   = rawAccountId ? (rawAccountId.startsWith("act_") ? rawAccountId : `act_${rawAccountId}`) : "";

  return NextResponse.json({
    ok: true,
    adAccountId: fmtAccountId,            // not a secret — return as-is
    accessToken: maskSecret(rawAccessToken),
    appId:       maskSecret(rawAppId),
    appSecret:   maskSecret(rawAppSecret),
    // Đợt 21 A4: pixel / trang theo công ty (mã công khai, không phải bí mật)
    companies: companyIds().map((co) => ({ id: co, label: companyLabel(co),
      pixelId: process.env[`NEXT_PUBLIC_META_PIXEL_ID_${envSuffix(co)}`] || saved.companies?.[co]?.pixelId || "",
      pageId: process.env[`NEXT_PUBLIC_META_PAGE_ID_${envSuffix(co)}`] || saved.companies?.[co]?.pageId || "" })),
    connected: {
      accessToken: !!rawAccessToken,
      adAccountId: !!rawAccountId,
    },
  });
}

// POST — skip fields that are masked placeholders (client echoed them back unchanged)
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const editGuard = guardEditCredentials(user);
  if (editGuard) return editGuard;

  const body = await request.json() as { accessToken?: string; adAccountId?: string; appId?: string; appSecret?: string; companies?: Record<string, { pixelId?: string; pageId?: string }> };

  const settings: MetaSettings = {};
  if (body.companies !== undefined) {
    const px = cleanCompanyMap(Object.fromEntries(Object.entries(body.companies ?? {}).map(([k, v]) => [k, v?.pixelId ?? ""])), [10, 20]);
    const pg = cleanCompanyMap(Object.fromEntries(Object.entries(body.companies ?? {}).map(([k, v]) => [k, v?.pageId ?? ""])), [5, 20]);
    const errs = [...px.errors, ...pg.errors];
    if (errs.length) return NextResponse.json({ ok: false, error: errs.join(" · ") }, { status: 400 });
    const cur = readSettings().companies ?? {};
    settings.companies = { ...cur };
    for (const co of new Set([...Object.keys(px.map), ...Object.keys(pg.map)])) settings.companies[co] = { ...cur[co], ...(co in px.map ? { pixelId: px.map[co] } : {}), ...(co in pg.map ? { pageId: pg.map[co] } : {}) };
  }
  if (body.accessToken && !isMaskedPlaceholder(body.accessToken)) settings.accessToken = body.accessToken;
  if (body.adAccountId)                                           settings.adAccountId  = body.adAccountId.replace(/^act_/, "");
  if (body.appId      && !isMaskedPlaceholder(body.appId))       settings.appId        = body.appId;
  if (body.appSecret  && !isMaskedPlaceholder(body.appSecret))   settings.appSecret    = body.appSecret;

  if (Object.keys(settings).length === 0) {
    return NextResponse.json({ ok: true, message: "Không có thay đổi mới nào để lưu.", persisted: false });
  }

  let persisted: boolean;
  try { ({ persisted } = await saveSettings(settings)); }
  catch { return NextResponse.json({ ok: false, error: "Không đọc / giải mã được khoá đã lưu (khoá mã hoá DATA_ENCRYPTION_KEY đã đổi hoặc tệp hỏng) — KHÔNG ghi đè để khỏi mất các khoá khác. Liên hệ quản trị." }, { status: 500 }); }

  // Log field names only — never values (SECRET domain)
  await writeAuditEntry(
    "credentials_meta", user, "update",
    Object.keys(settings).join(", "),
    null, null, "ALL",
  );

  const message = persisted
    ? "Meta credentials đã lưu."
    : "Credentials áp dụng (in-memory). Disk write thất bại — sẽ reset khi restart.";

  return NextResponse.json({ ok: true, message, persisted });
}
