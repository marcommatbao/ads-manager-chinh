// Đợt 24a — danh sách khoá dịch vụ phụ dán được ở Cài đặt → API Keys (tệp THUẦN, giao diện dùng được).
// Trước đây chỉ đặt bằng biến môi trường (Coolify) → khách bản cài riêng không tự nối được.
// KHÔNG đưa vào đây khoá hạ tầng (AUTH_SECRET, DATA_ENCRYPTION_KEY, CRON_SECRET, BOOTSTRAP_*): chúng phải ở biến môi trường.
export const SERVICE_KEYS_FILE = "service-keys-settings.json"

export interface ServiceKeyDef {
  key: string
  envVar: string
  label: string
  help: string
  secret: boolean
  /** Mô-đun cần bật để hiện ô này (vd "matbao": báo cáo KPI chỉ bản Mắt Bão). Bỏ trống = mọi bản cài. */
  module?: "matbao" | "orders"
}

// 08/10/2026: SerpApi / SearchAPI / Apify chỉ phục vụ trang Intelligence + Competitor Spy (đã ẩn khỏi menu,
// danh sách đối thủ viết cứng của Mắt Bão) và Resend chưa có tính năng nào gửi mail → gắn gói "matbao" để bản
// cài khách không thấy ô vô dụng. Bản Mắt Bão giữ nguyên. Mở lại cho khách: bỏ `module` khi tính năng có thật.
export const SERVICE_KEYS: ServiceKeyDef[] = [
  { key: "serpApiKey", envVar: "SERP_API_KEY", label: "SerpApi — API key", help: "Tra kết quả tìm kiếm Google (Đối thủ / Thị trường).", secret: true, module: "matbao" },
  { key: "searchApiKey", envVar: "SEARCH_API_KEY", label: "SearchAPI — API key", help: "Nguồn tra tìm kiếm thay thế SerpApi.", secret: true, module: "matbao" },
  { key: "apifyToken", envVar: "APIFY_API_TOKEN", label: "Apify — API token", help: "Đọc thư viện quảng cáo Facebook của đối thủ, nhóm Facebook. Tốn tiền theo lượt chạy.", secret: true, module: "matbao" },
  { key: "resendApiKey", envVar: "RESEND_API_KEY", label: "Resend — API key (gửi email)", help: "Để sẵn cho tính năng gửi email (lời mời, quên mật khẩu) — hiện CHƯA tính năng nào gửi email.", secret: true, module: "matbao" },
  { key: "telegramKpiBotToken", envVar: "TELEGRAM_KPI_BOT_TOKEN", label: "Telegram báo cáo KPI — bot token", help: "Bot gửi báo cáo KPI hằng ngày.", secret: true, module: "matbao" },
  { key: "telegramKpiChatId", envVar: "TELEGRAM_KPI_CHAT_ID", label: "Telegram báo cáo KPI — chat ID", help: "Nhóm/kênh nhận báo cáo KPI.", secret: false, module: "matbao" },
]
