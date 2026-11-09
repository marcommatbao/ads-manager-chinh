// ============================================================
// Bật/tắt từng loại thẻ Teams của job orders_notify (app/api/cron/orders-notify).
// ============================================================

/**
 * Thẻ "⚠️ Đơn bị hủy — cần gọi lại chăm sóc". User tắt 26/10/2026 (task #7108): kênh nhận dồn thẻ hủy khi Odoo
 * đổi trạng thái hàng loạt (vd 09:02 26/10, đơn tạo 21–23/10) và đội không cần nhắc đơn hủy.
 * Mặc định TẮT; bật lại bằng ORDERS_NOTIFY_CANCEL=on. Khi tắt, job vẫn đánh dấu đơn hủy là "đã xem" để lúc bật
 * lại không xả dồn cả tồn đọng.
 */
export function cancelCardsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return ["on", "1", "true"].includes((env.ORDERS_NOTIFY_CANCEL ?? "").trim().toLowerCase())
}
