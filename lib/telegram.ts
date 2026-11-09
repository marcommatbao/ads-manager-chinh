// ============================================================
// AdsCommand — Telegram Bot Integration
// ============================================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export interface TelegramResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

/**
 * Report what a real send actually did into the connector health store, so a
 * revoked bot token shows up in Settings → Kết nối instead of only as a line in
 * the container log. Discovered the hard way: production was logging
 * `[Telegram] Send failed: Unauthorized` on every alert while the UI kept
 * showing Telegram as configured, because the env var was still present and
 * nobody had clicked "Test".
 *
 * Fire-and-forget and fully swallowed — notification delivery must never fail
 * because bookkeeping failed. Imported lazily to keep this module free of the
 * connector registry's import graph.
 */
function reportTelegramOutcome(ok: boolean, description?: string, telegramErrorCode?: number): void {
  void (async () => {
    try {
      const { recordLiveOutcome } = await import("@/lib/connectors/engine");
      if (ok) {
        await recordLiveOutcome("telegram", { ok: true, status: "healthy" });
        return;
      }
      // Telegram answers 401/"Unauthorized" for a bad or revoked bot token —
      // that is an auth problem to fix, not a transient outage to retry.
      const isAuth = telegramErrorCode === 401 || /unauthorized/i.test(description ?? "");
      await recordLiveOutcome("telegram", {
        ok: false,
        status: isAuth ? "auth_error" : "service_error",
        failureCategory: isAuth ? "auth" : "server_error",
        failureReason: isAuth
          ? `Bot token bị Telegram từ chối (${description ?? "Unauthorized"}) — cần cấp lại TELEGRAM_BOT_TOKEN`
          : (description ?? "Telegram send failed"),
      });
    } catch { /* ignore */ }
  })();
}

/**
 * Send a message to a single Telegram chat.
 */
export async function sendTelegram(
  chatId: string,
  message: string,
  parseMode: "Markdown" | "HTML" = "Markdown"
): Promise<TelegramResult> {
  // 29/09: user ngừng dùng Telegram (token hỏng) — tắt thì KHÔNG gọi, không ghi lỗi (tránh "Send failed: Unauthorized" mỗi lượt).
  if (process.env.CONNECTOR_TELEGRAM_DISABLED === "1") return { ok: false, error: "Telegram đã tắt (CONNECTOR_TELEGRAM_DISABLED=1)" };
  if (!TELEGRAM_BOT_TOKEN) {
    console.error("[Telegram] TELEGRAM_BOT_TOKEN not set");
    reportTelegramOutcome(false, "TELEGRAM_BOT_TOKEN chưa được cấu hình");
    return { ok: false, error: "TELEGRAM_BOT_TOKEN not configured" };
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: parseMode,
          disable_web_page_preview: true,
        }),
      }
    );

    const json = await res.json();

    if (!json.ok) {
      console.error("[Telegram] Send failed:", json.description);
      reportTelegramOutcome(false, json.description, json.error_code);
      return { ok: false, error: json.description ?? "Unknown error" };
    }

    console.log(`[Telegram] Sent to ${chatId}, msgId: ${json.result?.message_id}`);
    reportTelegramOutcome(true);
    return { ok: true, messageId: json.result?.message_id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Telegram] Error:", msg);
    reportTelegramOutcome(false, msg);
    return { ok: false, error: msg };
  }
}

/**
 * Broadcast a message to multiple chat IDs.
 * Returns results per chat.
 */
export async function broadcastTelegram(
  chatIds: string[],
  message: string,
  parseMode: "Markdown" | "HTML" = "Markdown"
): Promise<TelegramResult[]> {
  const unique = [...new Set(chatIds.filter(Boolean))];

  const results = await Promise.allSettled(
    unique.map((id) => sendTelegram(id, message, parseMode))
  );

  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { ok: false, error: r.reason?.message ?? "Unknown error" }
  );
}

/**
 * Send a message using an explicit bot token (not the default TELEGRAM_BOT_TOKEN).
 * Used by dedicated bots — e.g. the daily KPI report bot (baocaokpimkt_bot).
 */
export async function sendTelegramVia(
  botToken: string,
  chatId: string,
  message: string,
  parseMode: "Markdown" | "HTML" = "HTML"
): Promise<TelegramResult> {
  if (!botToken) return { ok: false, error: "bot token not configured" };
  if (!chatId) return { ok: false, error: "chat id not configured" };

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: parseMode,
          disable_web_page_preview: true,
        }),
      }
    );

    const json = await res.json();
    if (!json.ok) {
      console.error("[Telegram] sendTelegramVia failed:", json.description);
      return { ok: false, error: json.description ?? "Unknown error" };
    }
    return { ok: true, messageId: json.result?.message_id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Telegram] sendTelegramVia error:", msg);
    return { ok: false, error: msg };
  }
}

/**
 * Send a test message with a custom bot token (for settings page testing).
 */
export async function sendTestMessage(
  botToken: string,
  chatId: string
): Promise<TelegramResult> {
  const now = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

  const message = [
    "✅ *AdsCommand Test Message*",
    "",
    "Kết nối Telegram thành công! 🎉",
    "",
    "Bot đang hoạt động và sẵn sàng gửi:",
    "• Budget alerts",
    "• Campaign health warnings",
    "• Automation notifications",
    "",
    `_Thời gian: ${now}_`,
  ].join("\n");

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        }),
      }
    );

    const json = await res.json();

    if (!json.ok) {
      return { ok: false, error: json.description ?? "Unknown error" };
    }

    return { ok: true, messageId: json.result?.message_id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * Verify bot token by calling getMe.
 */
export async function verifyBotToken(
  botToken: string
): Promise<{ ok: boolean; botName?: string; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const json = await res.json();

    if (json.ok) {
      return { ok: true, botName: json.result?.username };
    }
    return { ok: false, error: json.description };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * Send a budget alert with level-based emoji prefix.
 * Used by the budget cron job.
 */
export interface BudgetAlertOptions {
  chatId: string;
  level: "info" | "warning" | "critical" | "forecast_warning";
  message: string;
}

const BUDGET_ALERT_EMOJI: Record<BudgetAlertOptions["level"], string> = {
  info:             "ℹ️",
  warning:          "⚠️",
  critical:         "🚨",
  forecast_warning: "📉",
};

export async function sendBudgetAlert(
  opts: BudgetAlertOptions
): Promise<{ success: boolean; error?: string }> {
  const emoji = BUDGET_ALERT_EMOJI[opts.level] ?? "🔔";
  const prefixed = `${emoji} ${opts.message}`;
  const result = await sendTelegram(opts.chatId, prefixed);
  return { success: result.ok, error: result.error };
}
