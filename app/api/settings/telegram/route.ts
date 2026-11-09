// GET  /api/settings/telegram — read current Telegram bot config (token masked)
// POST /api/settings/telegram — save Telegram bot config
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

const SETTINGS_PATH = path.resolve(process.cwd(), "data/telegram-settings.json");

type TelegramSettings = { botToken?: string; chatId?: string };

// chatId is a routing target, not a credential — stays plaintext like Meta's adAccountId.
const ENCRYPTED_FIELDS = ["botToken"] as const;

function readSettings(): TelegramSettings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) as TelegramSettings;
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

async function saveSettings(settings: TelegramSettings): Promise<{ persisted: boolean }> {
  return withFileLock(SETTINGS_PATH, async () => {
    const existing = readSettingsForWrite();
    const merged = { ...existing, ...settings };
    if (merged.botToken) process.env.TELEGRAM_BOT_TOKEN = merged.botToken;
    if (merged.chatId)   process.env.TELEGRAM_CHAT_ID = merged.chatId;
    try {
      fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
      const toWrite = encryptFields(merged, ENCRYPTED_FIELDS);
      writeFileAtomicSync(SETTINGS_PATH, JSON.stringify(toWrite, null, 2));
      return { persisted: true };
    } catch (e) {
      console.warn("[settings/telegram] Could not persist to disk:", e);
      return { persisted: false };
    }
  });
}

// GET — masked token; chatId is not a secret, returned as-is
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const credGuard = guardViewCredentials(user);
  if (credGuard) return credGuard;

  const saved = readSettings();
  const rawBotToken = process.env.TELEGRAM_BOT_TOKEN || saved.botToken || "";
  const rawChatId   = process.env.TELEGRAM_CHAT_ID   || saved.chatId   || "";

  return NextResponse.json({
    ok: true,
    chatId: rawChatId,
    botToken: maskSecret(rawBotToken),
    connected: { botToken: !!rawBotToken, chatId: !!rawChatId },
  });
}

// POST — skip masked placeholder (client echoed it back unchanged)
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const editGuard = guardEditCredentials(user);
  if (editGuard) return editGuard;

  const body = await request.json() as { botToken?: string; chatId?: string };

  const settings: TelegramSettings = {};
  if (body.botToken && !isMaskedPlaceholder(body.botToken)) settings.botToken = body.botToken;
  if (body.chatId) settings.chatId = body.chatId;

  if (Object.keys(settings).length === 0) {
    return NextResponse.json({ ok: true, message: "Không có thay đổi mới nào để lưu.", persisted: false });
  }

  let persisted: boolean;
  try { ({ persisted } = await saveSettings(settings)); }
  catch { return NextResponse.json({ ok: false, error: "Không đọc / giải mã được khoá đã lưu (khoá mã hoá DATA_ENCRYPTION_KEY đã đổi hoặc tệp hỏng) — KHÔNG ghi đè để khỏi mất các khoá khác. Liên hệ quản trị." }, { status: 500 }); }

  await writeAuditEntry(
    "credentials_telegram", user, "update",
    Object.keys(settings).join(", "),
    null, null, "ALL",
  );

  const message = persisted
    ? "Telegram config đã lưu."
    : "Config áp dụng (in-memory). Disk write thất bại — sẽ reset khi restart.";

  return NextResponse.json({ ok: true, message, persisted });
}
