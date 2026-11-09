// ============================================================
// Cảnh báo hệ thống — gửi tới kênh NÀO ĐANG THẬT SỰ DÙNG ĐƯỢC
// ============================================================
// SỰ CỐ CÓ THẬT, đo ngày 24/09/2026:
//
// Toàn bộ cảnh báo hệ thống dựng ngày 22/09 đi qua `sendTeamsAlert`, mà biến
// `TEAMS_WEBHOOK_OPS_ALERTS` CHƯA HỀ được đặt trên production — hai ngày sau
// vẫn chưa. Prod chỉ có TEAMS_WEBHOOK_MATBAOIN và TEAMS_WEBHOOK_ORDERS_MATBAOIN.
// Nghĩa là mọi cảnh báo đều trả `notConfigured: true` rồi im lặng.
//
// Trong khi đó TELEGRAM_BOT_TOKEN và TELEGRAM_CHAT_ID ĐỀU CÓ giá trị thật và
// đang chạy bình thường cho các luồng khác.
//
// Nên roadmap v1 nói "tái dùng kênh Telegram đã có" là ĐÚNG, còn bản sửa của
// tôi ("dùng Teams vì mới hơn") là sai — mới hơn về mã nguồn không có nghĩa là
// dùng được. Module này chọn theo thứ ĐANG CẤU HÌNH, không theo thứ mới nhất.
//
// Thứ tự: Teams trước (thẻ đẹp hơn, đúng ý định ban đầu), thiếu thì rơi xuống
// Telegram. Không kênh nào cấu hình thì NÓI RA, không trả về im lặng — một
// cảnh báo không tới đâu mà báo "đã gửi" còn tệ hơn không có cảnh báo.
// ============================================================

import { sendTeamsAlert, isTeamsAlertConfigured, type TeamsAlertLevel } from "./teams-alert";
import { sendTelegram } from "./telegram";

export interface SystemAlertResult {
  sent: boolean;
  /** Kênh đã gửi đi thật. */
  channel: "teams" | "telegram" | null;
  /** true khi KHÔNG có kênh nào được cấu hình — khác với gửi hỏng. */
  notConfigured?: boolean;
  error?: string;
}

export const SYSTEM_ALERT_SETUP_HINT =
  "Cảnh báo hệ thống đang TẮT vì không kênh nào được cấu hình. " +
  "Đặt TEAMS_WEBHOOK_OPS_ALERTS (Teams → kênh → … → Connectors → Incoming Webhook) " +
  "hoặc TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID trong Coolify, rồi deploy lại.";

function telegramConfigured(): boolean {
  if (process.env.CONNECTOR_TELEGRAM_DISABLED === "1") return false;
  return Boolean((process.env.TELEGRAM_BOT_TOKEN ?? "").trim())
    && Boolean((process.env.TELEGRAM_CHAT_ID ?? "").trim());
}

/** Có ít nhất một đường ra cho cảnh báo hay không. */
export function isSystemAlertConfigured(): boolean {
  return isTeamsAlertConfigured() || telegramConfigured();
}

const ICON: Record<TeamsAlertLevel, string> = {
  danger: "🚨", warning: "⚠️", good: "✅",
};

export async function sendSystemAlert(opts: {
  title: string;
  level: TeamsAlertLevel;
  facts: Array<{ title: string; value: string }>;
  action?: string;
}): Promise<SystemAlertResult> {
  if (isTeamsAlertConfigured()) {
    const r = await sendTeamsAlert(opts);
    if (r.sent) return { sent: true, channel: "teams" };
    // Teams có cấu hình mà gửi hỏng thì vẫn thử Telegram — mục đích là để
    // cảnh báo TỚI ĐƯỢC NGƯỜI, không phải để trung thành với một kênh.
    if (!telegramConfigured()) return { sent: false, channel: null, error: r.error };
  }

  if (!telegramConfigured()) {
    return { sent: false, channel: null, notConfigured: true, error: SYSTEM_ALERT_SETUP_HINT };
  }

  const lines = [
    `${ICON[opts.level]} *${opts.title}*`,
    ...opts.facts.map(f => `· ${f.title}: ${f.value}`),
    ...(opts.action ? ["", opts.action] : []),
  ];
  const r = await sendTelegram(String(process.env.TELEGRAM_CHAT_ID), lines.join("\n"));
  return r.ok
    ? { sent: true, channel: "telegram" }
    : { sent: false, channel: null, error: r.error };
}
