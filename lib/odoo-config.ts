// ============================================================
// Odoo connection config — CHỈ đọc từ biến môi trường
// ------------------------------------------------------------
// Đổi 17/09/2026: bỏ mọi giá trị mặc định trong mã.
//
// Vì sao: repo này sẽ ở trạng thái công khai. Host Odoo và tên database là
// thông tin hạ tầng nội bộ — biết host + tên DB là đã có 2/4 mảnh để thử
// đăng nhập (chỉ còn thiếu user/mật khẩu), và cũng lộ luôn việc hệ thống
// nào đang nối với ERP.
//
// Thiếu biến → trả chuỗi rỗng và chỗ gọi báo "chưa cấu hình". CỐ Ý không
// rơi về host thật: để vậy thì host vẫn nằm trong repo, tức việc chuyển ra
// biến môi trường không có tác dụng gì.
// ============================================================

/** URL Odoo, đã bỏ dấu "/" cuối. Chuỗi rỗng = chưa cấu hình. */
export function odooUrl(): string {
  // ODOO_BASE_URL là tên biến cũ dùng ở cron orders-notify — nhận cả hai để
  // cấu hình đang chạy trên Coolify không bị đứt khi đổi sang tên chuẩn.
  const raw = process.env.ODOO_URL || process.env.ODOO_BASE_URL || "";
  return raw.trim().replace(/\/+$/, "");
}

/** Tên database Odoo. Chuỗi rỗng = chưa cấu hình. */
export function odooDb(): string {
  return (process.env.ODOO_DB ?? "").trim();
}

/**
 * Thông tin đăng nhập Odoo — MỘT chỗ đọc cho cả odoo-client lẫn trang kiểm kết nối (Đợt 20b).
 * Trước đây client đọc ODOO_LOGIN/ODOO_API_KEY còn trang kiểm + Cài đặt (instrumentation) dùng ODOO_USER/ODOO_PASSWORD
 * → trang kiểm báo sai, và Odoo nhập qua trang Cài đặt không bao giờ chạy được với phần đọc đơn.
 * Ưu tiên tên chuẩn của client, rơi về tên cũ. secret = API key (Odoo cho dùng thay mật khẩu) hoặc mật khẩu.
 */
export function odooCredentials(): { login: string; secret: string; via: "login/api_key" | "user/password" | "mixed" | "none" } {
  const login = (process.env.ODOO_LOGIN || process.env.ODOO_USER || "").trim()
  const secret = (process.env.ODOO_API_KEY || process.env.ODOO_PASSWORD || "").trim()
  if (!login || !secret) return { login, secret, via: "none" }
  const std = !!process.env.ODOO_LOGIN && !!process.env.ODOO_API_KEY, old = !process.env.ODOO_LOGIN && !process.env.ODOO_API_KEY
  return { login, secret, via: std ? "login/api_key" : old ? "user/password" : "mixed" }
}

export function odooConfigured(): boolean {
  return odooUrl() !== "" && odooDb() !== "";
}

/** Dùng ở chỗ KHÔNG thể chạy khi thiếu cấu hình (odoo-client). */
export function requireOdooUrl(): string {
  const url = odooUrl();
  if (!url) {
    throw new Error(
      "Odoo chưa cấu hình: thiếu biến môi trường ODOO_URL (mã KHÔNG còn giá trị mặc định). " +
      "Đặt ODOO_URL và ODOO_DB trên nền tảng triển khai rồi khởi động lại."
    );
  }
  return url;
}
