// GET  /api/settings/gemini — read current Gemini API key (masked)
// POST /api/settings/gemini — save Gemini API key
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

const SETTINGS_PATH = path.resolve(process.cwd(), "data/gemini-settings.json");

type GeminiSettings = { apiKey?: string };

const ENCRYPTED_FIELDS = ["apiKey"] as const;

function readSettings(): GeminiSettings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) as GeminiSettings;
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

async function saveSettings(settings: GeminiSettings): Promise<{ persisted: boolean }> {
  return withFileLock(SETTINGS_PATH, async () => {
    const existing = readSettingsForWrite();
    const merged = { ...existing, ...settings };
    if (merged.apiKey) process.env.GEMINI_API_KEY = merged.apiKey;
    try {
      fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
      const toWrite = encryptFields(merged, ENCRYPTED_FIELDS);
      writeFileAtomicSync(SETTINGS_PATH, JSON.stringify(toWrite, null, 2));
      return { persisted: true };
    } catch (e) {
      console.warn("[settings/gemini] Could not persist to disk:", e);
      return { persisted: false };
    }
  });
}

// GET — masked value; never expose raw secret
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const credGuard = guardViewCredentials(user);
  if (credGuard) return credGuard;

  const saved = readSettings();
  const rawApiKey = process.env.GEMINI_API_KEY || saved.apiKey || "";

  return NextResponse.json({
    ok: true,
    apiKey: maskSecret(rawApiKey),
    connected: { apiKey: !!rawApiKey },
  });
}

// POST — skip masked placeholder (client echoed it back unchanged)
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const editGuard = guardEditCredentials(user);
  if (editGuard) return editGuard;

  const body = await request.json() as { apiKey?: string };

  const settings: GeminiSettings = {};
  if (body.apiKey && !isMaskedPlaceholder(body.apiKey)) settings.apiKey = body.apiKey;

  if (Object.keys(settings).length === 0) {
    return NextResponse.json({ ok: true, message: "Không có thay đổi mới nào để lưu.", persisted: false });
  }

  let persisted: boolean;
  try { ({ persisted } = await saveSettings(settings)); }
  catch { return NextResponse.json({ ok: false, error: "Không đọc / giải mã được khoá đã lưu (khoá mã hoá DATA_ENCRYPTION_KEY đã đổi hoặc tệp hỏng) — KHÔNG ghi đè để khỏi mất các khoá khác. Liên hệ quản trị." }, { status: 500 }); }

  await writeAuditEntry(
    "credentials_gemini", user, "update",
    Object.keys(settings).join(", "),
    null, null, "ALL",
  );

  const message = persisted
    ? "Gemini API key đã lưu."
    : "API key áp dụng (in-memory). Disk write thất bại — sẽ reset khi restart.";

  return NextResponse.json({ ok: true, message, persisted });
}
