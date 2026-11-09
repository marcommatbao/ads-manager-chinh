// ============================================================
// Gửi thẻ cảnh báo vào Microsoft Teams
// ------------------------------------------------------------
// VÌ SAO TÁCH RA: hàm gửi thẻ đang bị chép ở hai nơi —
// app/api/cron/job-health-monitor và app/api/cron/leads-notify. Chép đôi thì
// sửa một chỗ quên chỗ kia, và cả hai đều ném lỗi khi thiếu webhook rồi bị
// `catch` nuốt mất.
//
// SỰ CỐ CÓ THẬT (đo 22/09/2026): biến `TEAMS_WEBHOOK_OPS_ALERTS` CHƯA HỀ được
// đặt trên production — chỉ có TEAMS_WEBHOOK_MATBAOIN và
// TEAMS_WEBHOOK_ORDERS_MATBAOIN. Nghĩa là toàn bộ cảnh báo hệ thống đã dựng
// sẵn nhưng **chưa bao giờ gửi được một thẻ nào**, và người dùng không có cách
// nào biết: job-health-monitor bắt lỗi rồi `console.warn` — chìm trong log.
//
// Nên ở đây PHÂN BIỆT hai trạng thái, thay vì gộp thành "gửi thất bại":
//   • CHƯA CẤU HÌNH — thiếu webhook. Không phải lỗi lúc chạy, là việc phải
//     làm một lần. Nơi gọi phải hiện ra cho người dùng thấy.
//   • GỬI HỎNG      — có webhook nhưng Teams từ chối. Đây mới là lỗi chạy.
// ============================================================

export type TeamsAlertLevel = "danger" | "warning" | "good";

const COLOR: Record<TeamsAlertLevel, string> = {
  danger: "Attention",
  warning: "Warning",
  good: "Good",
};

export interface TeamsAlertResult {
  sent: boolean;
  /** true khi KHÔNG gửi vì thiếu webhook — phân biệt với gửi hỏng. */
  notConfigured?: boolean;
  error?: string;
}

/** Đã cấu hình để gửi được cảnh báo hệ thống chưa. */
export function isTeamsAlertConfigured(): boolean {
  return Boolean((process.env.TEAMS_WEBHOOK_OPS_ALERTS ?? "").trim());
}

/**
 * Câu giải thích cho người dùng khi cảnh báo đang tắt.
 * Nói rõ PHẢI LÀM GÌ, không chỉ nói "chưa cấu hình".
 */
export const TEAMS_ALERT_SETUP_HINT =
  "Cảnh báo Teams đang TẮT vì thiếu biến TEAMS_WEBHOOK_OPS_ALERTS. " +
  "Lấy link webhook của kênh Teams muốn nhận (Teams → kênh → … → Connectors → " +
  "Incoming Webhook), rồi thêm biến đó trong Coolify và deploy lại.";

/**
 * Gửi một thẻ cảnh báo.
 *
 * KHÔNG ném lỗi — trả về kết quả để nơi gọi quyết định. Ném lỗi ở đây là mời
 * người ta bọc `try/catch` rồi nuốt mất, đúng cái đã xảy ra.
 */
export async function sendTeamsAlert(opts: {
  title: string;
  level: TeamsAlertLevel;
  facts: Array<{ title: string; value: string }>;
  /** Một câu nói rõ nên làm gì tiếp. */
  action?: string;
  /** Kênh riêng (vd nhắc việc xử lý chiến dịch). Bỏ trống = kênh cảnh báo hệ thống. */
  webhookUrl?: string;
  /** Câu hướng dẫn khi kênh riêng chưa cấu hình. */
  setupHint?: string;
}): Promise<TeamsAlertResult> {
  const webhookUrl = (opts.webhookUrl ?? process.env.TEAMS_WEBHOOK_OPS_ALERTS ?? "").trim();
  if (!webhookUrl) return { sent: false, notConfigured: true, error: opts.setupHint ?? TEAMS_ALERT_SETUP_HINT };

  const body = [
    { type: "TextBlock", text: opts.title, weight: "Bolder", size: "Medium", color: COLOR[opts.level] },
    { type: "FactSet", facts: opts.facts },
    ...(opts.action ? [{ type: "TextBlock", text: opts.action, wrap: true, isSubtle: true }] : []),
  ];

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "message",
        attachments: [{
          contentType: "application/vnd.microsoft.card.adaptive",
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.5",
            body,
          },
        }],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { sent: false, error: `Teams trả ${res.status}: ${text.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}
