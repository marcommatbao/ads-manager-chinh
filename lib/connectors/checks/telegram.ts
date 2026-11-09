// Telegram bot connector check — getMe
import type { CheckResult } from "../types";

export async function checkTelegram(): Promise<CheckResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { ok: false, status: "missing_config", failureCategory: "invalid_config", failureReason: "TELEGRAM_BOT_TOKEN not set" };
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getMe`,
      { signal: AbortSignal.timeout(6000) },
    );
    const data = await res.json() as { ok: boolean; result?: { username?: string; first_name?: string }; error_code?: number; description?: string };

    if (!data.ok) {
      const code = data.error_code ?? res.status;
      if (code === 401) {
        return { ok: false, status: "auth_error", failureCategory: "auth", failureReason: "Bot token unauthorized (401)" };
      }
      return { ok: false, status: "service_error", failureCategory: "server_error", failureReason: data.description ?? `Telegram error ${code}` };
    }

    const name = data.result?.username ? `@${data.result.username}` : data.result?.first_name ?? "Bot";
    return { ok: true, status: "healthy", note: name };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: "service_error", failureCategory: "network", failureReason: `Network error: ${msg}` };
  }
}
