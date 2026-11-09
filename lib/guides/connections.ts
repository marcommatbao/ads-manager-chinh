// ============================================================
// Hướng dẫn kết nối (user yêu cầu 28/09) — nội dung cho trang /guide/ket-noi
// ============================================================
// Viết cho NGƯỜI DÙNG TOOL (có thể là công ty khác), không gắn ID riêng của Mắt Bão. Từng bước theo
// đúng tên nút trên giao diện Meta / Google tại thời điểm viết (09/2026) — giao diện của họ có thể đổi
// chữ; mỗi bước ghi kèm đường dẫn để tìm lại được. Module THUẦN (client import được).

export interface GuideStep { text: string; detail?: string; warn?: string; link?: { href: string; label: string } }
export interface GuideSection { title: string; steps: GuideStep[] }
export interface ConnectionGuide {
  id: string
  title: string
  /** Dùng để làm gì trong tool. */
  purpose: string
  /** Ai làm được (quyền cần có). */
  who: string
  minutes: number
  /** Nơi dán kết quả trong tool. */
  pasteInto: { label: string; href: string }
  sections: GuideSection[]
  verify: string[]
  errors: { symptom: string; fix: string }[]
  security: string[]
}

export const CONNECTION_GUIDES: ConnectionGuide[] = [
  // ── 1. Token quảng cáo Meta ─────────────────────────────
  {
    id: "meta-ads",
    title: "Meta (Facebook) — token quảng cáo",
    purpose: "Kết nối chính: đọc số chiến dịch, nhóm, quảng cáo, pixel; tạo và sửa chiến dịch (khi bạn bấm xác nhận).",
    who: "Quản trị viên Business Manager (Trình quản lý doanh nghiệp) có quyền trên tài khoản quảng cáo và ứng dụng Meta.",
    minutes: 15,
    pasteInto: { label: "Cài đặt → Meta (Facebook) Ads", href: "/settings" },
    sections: [
      {
        title: "A. Chuẩn bị ứng dụng Meta (làm 1 lần)",
        steps: [
          { text: "Mở developers.facebook.com → Ứng dụng của tôi → Tạo ứng dụng → chọn loại Doanh nghiệp (Business).", link: { href: "https://developers.facebook.com/apps", label: "Mở trang Ứng dụng" } },
          { text: "Trong ứng dụng: Thêm sản phẩm → Marketing API → Thiết lập." },
          { text: "Vào Cài đặt ứng dụng → Thông tin cơ bản: ghi lại ID ứng dụng (App ID) và Khoá bí mật ứng dụng (App Secret — bấm Hiển thị).", warn: "App Secret là khoá bí mật — không gửi qua chat, email." },
          { text: "Gắn ứng dụng vào doanh nghiệp: business.facebook.com → Cài đặt doanh nghiệp → Tài khoản → Ứng dụng → Thêm → Kết nối ID ứng dụng.", link: { href: "https://business.facebook.com/settings/apps", label: "Mở Cài đặt → Ứng dụng" } },
        ],
      },
      {
        title: "B. Tạo người dùng hệ thống và mã (token)",
        steps: [
          { text: "business.facebook.com → Cài đặt doanh nghiệp → Người dùng → Người dùng hệ thống → Thêm.", link: { href: "https://business.facebook.com/settings/system-users", label: "Mở Người dùng hệ thống" } },
          { text: "Đặt tên (vd “AdsCommand”), vai trò Nhân viên (Employee) hoặc Quản trị viên → Tạo người dùng hệ thống." },
          { text: "Chọn người dùng vừa tạo → nút “…” → Chỉ định tài sản:", detail: "• Tài khoản quảng cáo: bật Quản lý chiến dịch (hoặc Toàn quyền).\n• Tập dữ liệu / Pixel: bật Quản lý.\n• Trang: bật Nội dung — để tool đọc được link quảng cáo bài viết (xem hướng dẫn Token Trang)." },
          { text: "Bấm Tạo mã (Generate new token) → chọn đúng ứng dụng ở bước A." },
          { text: "Thời hạn mã: chọn KHÔNG BAO GIỜ (Never).", warn: "Chọn 60 ngày thì hết hạn là tool ngừng đọc số — phải làm lại." },
          { text: "Tích quyền: ads_read, ads_management, business_management, read_insights, pages_show_list, pages_read_engagement → Tạo mã." },
          { text: "Meta chỉ hiện mã MỘT LẦN (bắt đầu bằng EAA…, dài ~150–250 ký tự) → bấm Sao chép.", warn: "Không chụp màn hình lúc mã đang hiện." },
        ],
      },
      {
        title: "C. Dán vào tool",
        steps: [
          { text: "AdsCommand → Cài đặt → Meta (Facebook) Ads: dán Access Token (mã vừa tạo), App ID, App Secret." },
          { text: "Ad Account ID: business.facebook.com → Tài khoản quảng cáo → số ID (tool tự thêm “act_” nếu thiếu)." },
          { text: "Bấm Lưu → Kiểm tra kết nối." },
        ],
      },
    ],
    verify: ["Nút Kiểm tra kết nối báo thành công.", "Dashboard hiện chi tiêu hôm qua của tài khoản quảng cáo."],
    errors: [
      { symptom: "(#200) Permissions error / không đủ quyền", fix: "Người dùng hệ thống chưa được chỉ định tài khoản quảng cáo, hoặc mã thiếu quyền ads_read/ads_management — chỉ định lại tài sản rồi TẠO MÃ MỚI (mã cũ không tự thêm quyền)." },
      { symptom: "(#17) / (#80004) User request limit reached", fix: "Ứng dụng ở bậc Phát triển chỉ có ~60 lượt gọi/giờ. Chờ 10–60 phút; muốn nhiều hơn thì xin nâng bậc Marketing API (Standard access) trong trang ứng dụng." },
      { symptom: "Mã hết hạn sau vài giờ / 60 ngày", fix: "Bạn đã lấy mã ở Graph API Explorer hoặc chọn thời hạn có giới hạn. Làm lại bước B, chọn thời hạn Không bao giờ." },
    ],
    security: ["Mã có quyền tạo và sửa quảng cáo — chỉ dán vào tool, không gửi qua chat/email.", "Tool lưu mã đã MÃ HOÁ; giao diện chỉ hiện dạng che (EAA…xxxx).", "Thu hồi: Người dùng hệ thống → Thu hồi mã."],
  },

  // ── 2. Token Trang ──────────────────────────────────────
  {
    id: "meta-page",
    title: "Meta — token Trang (đọc link quảng cáo bài viết)",
    purpose: "Quảng cáo dựng từ bài viết có sẵn của Trang: link đích nằm trong bài. Có token Trang, tool đọc được link để kiểm utm, khớp đơn Odoo theo utm, và học nội dung bài vào Sổ kinh nghiệm.",
    who: "Cách A: quản trị viên Business Manager. Cách B: người có quyền quản trị (Admin) trên chính Trang đó.",
    minutes: 10,
    pasteInto: { label: "Cài đặt → Kết nối → Trang Facebook", href: "/settings#ket-noi" },
    sections: [
      {
        title: "Cách A — Trang đã thuộc Business Manager của bạn (không cần dán gì thêm)",
        steps: [
          { text: "business.facebook.com → Cài đặt doanh nghiệp → Người dùng → Người dùng hệ thống → chọn người dùng hệ thống đang dùng cho tool (hướng dẫn Token quảng cáo)." },
          { text: "Nút “…” → Chỉ định tài sản → tab Trang → tích các Trang đang chạy quảng cáo → bật Nội dung (hoặc Toàn quyền) → Lưu." },
          { text: "Xong — tool tự lấy token Trang từ mã người dùng hệ thống đã dán. Vào Cài đặt → Kết nối → Trang Facebook → Kiểm tra để xem Trang đã hiện chưa." },
          { text: "Trang chưa có trong Business Manager? Cài đặt doanh nghiệp → Tài khoản → Trang → Thêm → “Yêu cầu quyền truy cập vào Trang” → nhập tên/ID Trang → người quản trị Trang duyệt → quay lại bước 2.", warn: "Nếu Trang thuộc doanh nghiệp khác hoặc tài khoản cá nhân và không duyệt được → dùng Cách B." },
        ],
      },
      {
        title: "Cách B — người quản trị Trang tạo token Trang KHÔNG HẾT HẠN",
        steps: [
          { text: "Người quản trị Trang mở Graph API Explorer, chọn Ứng dụng trên Meta = ứng dụng của tool (bước A hướng dẫn Token quảng cáo).", link: { href: "https://developers.facebook.com/tools/explorer", label: "Mở Graph API Explorer" } },
          { text: "Người dùng hoặc Trang = Mã người dùng → bấm Generate Access Token → tích pages_show_list và pages_read_engagement → đăng nhập, cho phép." },
          { text: "Sao chép mã vừa tạo → mở Access Token Debugger → dán → Debug → cuộn xuống → bấm Extend Access Token → sao chép mã DÀI HẠN.", link: { href: "https://developers.facebook.com/tools/debug/accesstoken", label: "Mở Access Token Debugger" }, warn: "Mã chưa đổi sang dài hạn chỉ sống ~1–2 giờ." },
          { text: "Dán mã dài hạn vào AdsCommand → Cài đặt → Kết nối → Trang Facebook → Thêm Trang.", detail: "Tool tự đổi mã người dùng này ra token của TỪNG Trang người đó quản trị (token Trang sinh từ mã dài hạn thì không hết hạn), kiểm đọc được bài, rồi chỉ lưu token Trang — mã người dùng KHÔNG được lưu." },
          { text: "Hoặc tự lấy token Trang: dán mã dài hạn vào Graph API Explorer, gửi me/accounts?fields=id,name,access_token → mỗi Trang có một access_token → dán từng cái vào ô Thêm Trang." },
        ],
      },
    ],
    verify: ["Cài đặt → Kết nối → Trang Facebook: Trang hiện trong danh sách, bấm Kiểm tra báo “đọc được bài”.", "Đo lường → Facebook: mục Liên kết quảng cáo ghi “N quảng cáo bài viết đọc link bằng token Trang”."],
    errors: [
      { symptom: "“Không phải token truy cập Meta”", fix: "Bạn dán nhầm App Secret / Client Token (chuỗi 32–40 ký tự chữ số hệ 16). Token đúng bắt đầu bằng EAA và dài ~150–250 ký tự." },
      { symptom: "“Invalid OAuth 2.0 Access Token” khi đọc bài", fix: "Đọc bài phải dùng token TRANG — tool tự đổi; nếu vẫn lỗi, người dùng hệ thống / người tạo mã chưa có quyền Nội dung trên Trang." },
      { symptom: "“Tài khoản này không quản trị Trang nào”", fix: "Người tạo mã không phải quản trị viên Trang, hoặc thiếu quyền pages_show_list khi tạo mã." },
      { symptom: "Teams báo “Token Trang hết hiệu lực”", fix: "Người quản trị đổi mật khẩu / gỡ ứng dụng / mất quyền Trang → làm lại Cách B và dán token mới." },
    ],
    security: ["Token Trang chỉ đọc được bài của Trang, lưu MÃ HOÁ.", "Mã người dùng dài hạn có quyền rộng — tool không lưu, chỉ dùng tại chỗ để lấy token Trang."],
  },

  // ── 3. GTM ──────────────────────────────────────────────
  {
    id: "gtm",
    title: "Google Tag Manager — tài khoản dịch vụ (đọc + sửa GTM)",
    purpose: "Tool đọc cấu hình GTM thật (thẻ nào bắn theo trigger nào) để chẩn đoán đo lường, và sửa được thẻ (đổi trigger, đổi sự kiện sang chuẩn) — publish chỉ khi bạn gõ XAC NHAN, hoàn tác được.",
    who: "Người có quyền Owner/Editor trên một dự án Google Cloud + quản trị viên tài khoản GTM.",
    minutes: 15,
    pasteInto: { label: "Cài đặt → Kết nối → Google Tag Manager", href: "/settings#ket-noi" },
    sections: [
      {
        title: "A. Tạo tài khoản dịch vụ trên Google Cloud",
        steps: [
          { text: "Mở console.cloud.google.com → chọn (hoặc tạo) một dự án.", link: { href: "https://console.cloud.google.com/iam-admin/serviceaccounts", label: "Mở Service Accounts" } },
          { text: "IAM & Admin → Service Accounts → + Create service account." },
          { text: "Service account name: vd “adscommand-gtm”. Description: “AdsCommand — đọc/sửa/xuất bản GTM”. Bấm Create and continue." },
          { text: "Permissions (optional): ĐỂ TRỐNG, không chọn vai trò nào → Continue.", detail: "Quyền GTM cấp trong GTM (phần C). Gán vai trò Google Cloud ở đây là cho thừa quyền trên cả dự án." },
          { text: "Principals with access (optional): để trống → Done. Ghi lại email dạng ten@du-an.iam.gserviceaccount.com." },
        ],
      },
      {
        title: "B. Bật Tag Manager API và tạo khoá JSON",
        steps: [
          { text: "APIs & Services → Library → tìm “Tag Manager API” → Enable (thấy chữ Manage là đã bật).", link: { href: "https://console.cloud.google.com/apis/library/tagmanager.googleapis.com", label: "Mở Tag Manager API" } },
          { text: "Quay lại Service Accounts → bấm vào ĐÚNG tài khoản vừa tạo (kiểm tiêu đề trang đúng tên).", warn: "Tạo khoá nhầm vào tài khoản dịch vụ khác (của hệ thống khác) thì GTM từ chối, và thu hồi khoá sau này làm hỏng luôn hệ thống kia." },
          { text: "Tab Keys → Add key → Create new key → chọn JSON → Create → máy tải về một tệp .json." },
          { text: "Báo lỗi “Service account key creation is disabled”? Tổ chức đang chặn tạo khoá (chính sách iam.disableServiceAccountKeyCreation) → nhờ quản trị Google Cloud của công ty mở cho dự án này." },
        ],
      },
      {
        title: "C. Cấp quyền trong GTM",
        steps: [
          { text: "Mở tagmanager.google.com → tài khoản chứa container của website → Quản trị (Admin) → Quản lý người dùng (User Management) ở cột Tài khoản.", link: { href: "https://tagmanager.google.com", label: "Mở Tag Manager" } },
          { text: "Bấm + → Thêm người dùng → dán email tài khoản dịch vụ (phần A)." },
          { text: "Quyền tài khoản: Người dùng (User). Quyền container: bật container của website → chọn Xuất bản (Publish) — gồm cả Đọc, Chỉnh sửa, Phê duyệt → Mời (Invite).", detail: "Chỉ muốn tool CHẨN ĐOÁN, không sửa: chọn Đọc (Read)." },
        ],
      },
      {
        title: "D. Dán vào tool",
        steps: [
          { text: "Mở tệp .json đã tải bằng Notepad/TextEdit → chọn tất cả → sao chép TOÀN BỘ nội dung (từ { đến })." },
          { text: "AdsCommand → Cài đặt → Kết nối → Google Tag Manager → dán vào ô → Kiểm tra & Lưu.", detail: "Tool thử gọi Tag Manager API (chỉ đọc) và liệt kê các container thấy được trước khi lưu. Khoá lưu MÃ HOÁ." },
          { text: "Lưu thành công thì XOÁ tệp .json khỏi máy (thư mục Tải về) — không để khoá nằm lại." },
        ],
      },
    ],
    verify: ["Kiểm tra & Lưu liệt kê đúng container của website (dạng GTM-XXXXXXX).", "Đo lường → Gắn thẻ: nguồn GTM ghi “(API)”; mục “Sửa trên GTM” có nút Kiểm trước."],
    errors: [
      { symptom: "“Khoá hợp lệ nhưng … chưa được thêm vào container GTM nào”", fix: "Làm phần C — thêm email tài khoản dịch vụ vào GTM." },
      { symptom: "“Tài khoản dịch vụ thiếu quyền trên GTM” khi Kiểm trước / Publish", fix: "Quyền container đang là Đọc/Chỉnh sửa → đổi thành Xuất bản (Publish)." },
      { symptom: "“Tag Manager API has not been used in project … or it is disabled”", fix: "Làm phần B bước 1 — bật Tag Manager API đúng dự án chứa tài khoản dịch vụ." },
      { symptom: "“Không phải tệp JSON khoá tài khoản dịch vụ”", fix: "Dán thiếu — phải dán CẢ tệp, gồm cả dòng private_key dài." },
    ],
    security: ["Khoá JSON = quyền publish GTM của website — không gửi qua chat/email/Drive.", "Thu hồi: Service Accounts → Keys → xoá khoá; hoặc gỡ email khỏi GTM.", "Tool không bao giờ sửa trong Default Workspace, và luôn cần XAC NHAN để publish."],
  },

  // ── 4. Google Ads ───────────────────────────────────────
  {
    id: "google-ads",
    title: "Google Ads — Google Cloud + OAuth",
    purpose: "Đọc chiến dịch, từ khoá, lượt tìm kiếm, chuyển đổi; sửa mục tiêu đặt giá / hành động chính khi bạn xác nhận.",
    who: "Quản trị viên tài khoản người quản lý (MCC) Google Ads + người có quyền Owner/Editor trên một dự án Google Cloud.",
    minutes: 20,
    pasteInto: { label: "Cài đặt → Google Ads", href: "/settings" },
    sections: [
      // 12/10/2026: Google bỏ developer token từ 09/09/2026 — quyền truy cập tính theo Google Cloud project.
      {
        title: "A. Google Cloud project và mức truy cập",
        steps: [
          { text: "console.cloud.google.com → tạo (hoặc chọn) dự án → APIs & Services → Library → bật “Google Ads API”. Dự án mới bật API chỉ gọi được tài khoản thử.", link: { href: "https://console.cloud.google.com/apis/library/googleads.googleapis.com", label: "Mở Google Ads API" } },
          { text: "APIs & Services → OAuth consent screen: loại Internal (nếu dùng Google Workspace) hoặc External; điền tên ứng dụng + email hỗ trợ. Hoàn tất xác minh thương hiệu (brand verification) của dự án." },
          { text: "Mở trang Google Ads API Overview của dự án → Upgrade access level → Apply for access: xin mức Explorer (gọi được tài khoản thật, 2.880 thao tác/ngày), rồi xin tiếp mức Basic (15.000 thao tác/ngày).", link: { href: "https://console.cloud.google.com/google/ads-apis/overview", label: "Mở Google Ads API Overview" }, warn: "Phải xác minh thương hiệu xong mới xin được Basic. Không còn cần developer token: Google đã bỏ từ 09/2026." },
        ],
      },
      {
        title: "B. OAuth client (Google Cloud)",
        steps: [
          { text: "APIs & Services → Credentials → Create credentials → OAuth client ID → Web application." },
          { text: "Authorized redirect URIs: thêm đúng địa chỉ tool + /api/google/callback (vd https://ten-tool.cong-ty.vn/api/google/callback) → Create → sao chép Client ID và Client secret." },
        ],
      },
      {
        title: "C. Dán vào tool và cấp quyền",
        steps: [
          { text: "AdsCommand → Cài đặt → Google Ads: dán Client ID, Client Secret. Ô Developer Token để trống." },
          { text: "Login Customer ID (MCC): số tài khoản người quản lý, dạng 123-456-7890. Customer ID của từng công ty: số tài khoản quảng cáo con." },
          { text: "Bấm Lưu → bấm “Authorize via OAuth” → đăng nhập bằng tài khoản có quyền trên MCC → Cho phép. Tool tự nhận Refresh Token." },
        ],
      },
    ],
    verify: ["Cài đặt → Google Ads hiện “Đã kết nối”.", "Trang Google Search / Pmax hiện chiến dịch."],
    errors: [
      { symptom: "Gọi được tài khoản thử nhưng tài khoản thật bị từ chối", fix: "Dự án Google Cloud mới ở mức Test — xác minh thương hiệu rồi xin mức Basic (phần A)." },
      { symptom: "redirect_uri_mismatch khi bấm Authorize", fix: "Địa chỉ ở Authorized redirect URIs phải khớp TỪNG KÝ TỰ với địa chỉ tool + /api/google/callback (https, không dấu / cuối)." },
      { symptom: "USER_PERMISSION_DENIED", fix: "Login Customer ID sai, hoặc tài khoản bấm Authorize không có quyền trên MCC đó." },
    ],
    security: ["Client secret và refresh token lưu MÃ HOÁ.", "Thu hồi: myaccount.google.com → Bảo mật → Ứng dụng bên thứ ba → gỡ quyền của ứng dụng."],
  },

  // ── 5. Teams ────────────────────────────────────────────
  {
    id: "teams",
    title: "Microsoft Teams — webhook nhận thông báo",
    purpose: "Nhận thẻ lead mới, đơn hàng mới, và cảnh báo hệ thống (job ngừng chạy, token hết hiệu lực) vào kênh Teams.",
    who: "Thành viên kênh Teams có quyền thêm Workflows (Power Automate) vào kênh.",
    minutes: 5,
    pasteInto: { label: "Cài đặt → Jobs → Webhook Teams", href: "/settings/jobs" },
    sections: [
      {
        title: "Tạo webhook cho một kênh",
        steps: [
          { text: "Mở Teams → vào kênh muốn nhận thông báo → nút “…” cạnh tên kênh → Workflows." },
          { text: "Chọn mẫu “Post to a channel when a webhook request is received” (Đăng lên kênh khi nhận yêu cầu webhook) → đặt tên (vd “AdsCommand”) → Next → chọn Nhóm + Kênh → Add workflow." },
          { text: "Sao chép đường dẫn webhook hiện ra (dạng https://…logic.azure.com/… hoặc …powerplatform.com/…).", warn: "Ai có đường dẫn này đều đăng được tin vào kênh — coi như khoá bí mật." },
          { text: "Kênh cũ còn dùng “Incoming Webhook” (Connectors) vẫn được, nhưng Microsoft đang ngừng dần — ưu tiên Workflows." },
        ],
      },
      {
        title: "Dán vào tool",
        steps: [
          { text: "AdsCommand → Cài đặt → Jobs → mục Webhook Teams: dán vào đúng dòng — Lead mới, Đơn hàng mới, Cảnh báo hệ thống → Lưu. Có hiệu lực ngay, không cần khởi động lại." },
          { text: "Nên dùng kênh RIÊNG cho Cảnh báo hệ thống (kênh IT/vận hành) để không lẫn với lead/đơn." },
        ],
      },
    ],
    verify: ["Cài đặt → Jobs: dòng webhook hiện “Đã cấu hình”.", "Trang Jobs → bấm chạy thử job tương ứng → thẻ hiện trong kênh."],
    errors: [
      { symptom: "Lưu rồi mà thẻ vẫn vào kênh cũ", fix: "Máy chủ có đặt biến môi trường cho webhook đó (ưu tiên hơn Cài đặt) — nhờ quản trị máy chủ gỡ biến." },
      { symptom: "Không có mục Workflows", fix: "Tổ chức chặn Power Automate cho Teams — nhờ quản trị Microsoft 365 mở, hoặc dùng Incoming Webhook nếu còn." },
    ],
    security: ["Đường dẫn webhook lưu MÃ HOÁ; giao diện chỉ hiện dạng che.", "Lộ đường dẫn → xoá workflow trong Teams và tạo lại."],
  },

  // ── 6. GA4 cho thí nghiệm PMax (Đợt 10c) ────────────────
  {
    id: "ga4-thi-nghiem",
    title: "GA4 — cho tool đọc đơn theo tỉnh (thí nghiệm PMax)",
    purpose: "Thí nghiệm tắt PMax theo vùng cần ĐƠN THẬT mọi kênh theo tỉnh để biết PMax/YouTube có tạo đơn thêm hay không. Không có GA4 thì tool dùng số Google của chiến dịch không phải PMax — yếu hơn (đơn chạy sang tự nhiên/trực tiếp không thấy).",
    who: "Người có quyền Quản trị (Administrator) trên property GA4 của website. Cần làm xong hướng dẫn Google Tag Manager trước (dùng lại cùng tài khoản dịch vụ).",
    minutes: 5,
    pasteInto: { label: "PMax Insights → tab Thí nghiệm", href: "/google-pmax?tab=experiment" },
    sections: [
      {
        title: "A. Bật Google Analytics Data API",
        steps: [
          { text: "Mở console.cloud.google.com → ĐÚNG dự án chứa tài khoản dịch vụ GTM → APIs & Services → Library → tìm “Google Analytics Data API” → Enable.", link: { href: "https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com", label: "Mở Google Analytics Data API" } },
        ],
      },
      {
        title: "B. Cấp quyền Người xem (Viewer) trong GA4",
        steps: [
          { text: "Mở analytics.google.com → chọn property của website → Quản trị (Admin, bánh răng góc trái dưới) → Quyền truy cập thuộc tính (Property access management).", link: { href: "https://analytics.google.com", label: "Mở Google Analytics" } },
          { text: "Bấm + → Thêm người dùng → dán email tài khoản dịch vụ (dạng ten@du-an.iam.gserviceaccount.com — tab Thí nghiệm có hiện email này).", detail: "Bỏ chọn “Thông báo người dùng mới qua email” (tài khoản dịch vụ không có hộp thư)." },
          { text: "Vai trò: Người xem (Viewer) → Thêm.", detail: "Tool chỉ ĐỌC số theo tỉnh — không cần quyền cao hơn." },
          { text: "Làm lại cho property của công ty thứ hai (nếu có)." },
        ],
      },
      {
        title: "C. Chọn sự kiện đo",
        steps: [
          { text: "Tab Thí nghiệm → Nguồn số: GA4 → Sự kiện: mặc định “purchase”. Website bán qua form thì nhập tên sự kiện lead (vd generate_lead).", warn: "Sự kiện phải bắn ĐÚNG trên website thật (xem Đo lường → Sức khoẻ đo lường) — sự kiện hỏng thì thí nghiệm đo ra rác." },
        ],
      },
    ],
    verify: ["Tab Thí nghiệm: dòng “Nguồn số” hiện “GA4 — sự kiện … mọi kênh theo tỉnh”.", "Các phương án hiện số đơn/tuần của vùng tắt khác 0."],
    errors: [
      { symptom: "“service account chưa được cấp quyền Viewer trên GA4”", fix: "Làm phần B — đúng property (số property trong Cài đặt phải khớp property vừa cấp quyền)." },
      { symptom: "“Google Analytics Data API has not been used in project…”", fix: "Làm phần A — bật API ở đúng dự án chứa tài khoản dịch vụ." },
      { symptom: "“GA4 không có sự kiện … trong kỳ”", fix: "Sai tên sự kiện hoặc sự kiện chưa bắn — kiểm trong GA4 → Báo cáo → Sự kiện." },
      { symptom: "Báo tỉnh không khớp", fix: "GA4 đặt tên theo địa danh tiếng Anh; tỉnh sáp nhập mới có thể chưa khớp mã vùng Google — tool liệt kê tỉnh không khớp và bỏ qua, không đoán." },
    ],
    security: ["Quyền Người xem chỉ đọc báo cáo — không đổi được cấu hình GA4.", "Thu hồi: GA4 → Quyền truy cập thuộc tính → xoá email tài khoản dịch vụ."],
  },

  // ── 7. Chất lượng lead → Google (Đợt 10c · C3) ──────────
  {
    id: "lead-quality",
    title: "Chất lượng lead → Google (webhook hoặc CSV từ CRM)",
    purpose: "Báo cho Google lead nào ĐẠT CHUẨN / CHỐT ĐƠN để quảng cáo học đuổi lead thật thay vì lead rác. Dùng được với mọi CRM/ERP (webhook JSON hoặc tệp CSV) — không cần Odoo.",
    who: "Người quản trị CRM (thêm webhook/tự động hoá) hoặc người xuất được danh sách lead ra CSV. Tạo hành động chuyển đổi cần quyền Sửa trong AdsCommand.",
    minutes: 20,
    pasteInto: { label: "PMax Insights → tab Thí nghiệm → Chất lượng lead", href: "/google-pmax?tab=experiment#lead-quality" },
    sections: [
      {
        title: "A. Chuẩn bị (làm 1 lần)",
        steps: [
          { text: "Website phải lưu gclid vào lead: form có trường ẩn “gclid” lấy từ tham số ?gclid= trên đường dẫn, CRM giữ trường đó cùng lead.", detail: "Không lưu được gclid vẫn gửi được bằng email/SĐT — tool BĂM trước khi lưu và gửi; Google khớp với người đã bấm quảng cáo (tỉ lệ khớp thấp hơn gclid)." },
          { text: "Tab Chất lượng lead → “Tạo hành động chuyển đổi” → nhập giá trị mặc định (vd lead đạt chuẩn ₫500.000, chốt đơn ₫5.000.000) → Kiểm trước → gõ XAC NHAN → Tạo.", detail: "Tool tạo 2 hành động kiểu “Tải lên” ở dạng PHỤ — chưa ảnh hưởng đặt giá." },
        ],
      },
      {
        title: "B1. Cách webhook (tự động, khuyên dùng)",
        steps: [
          { text: "Tab Chất lượng lead → “Tạo khoá webhook” → sao chép khoá (CHỈ HIỆN MỘT LẦN) và đường dẫn webhook.", warn: "Ai có khoá đều gửi được dữ liệu chuyển đổi vào tài khoản quảng cáo — cất như mật khẩu." },
          { text: "Trong CRM: tạo tự động hoá “khi lead đổi trạng thái” → gửi POST tới đường dẫn webhook, header Authorization: Bearer <khoá>, Content-Type: application/json." },
          { text: "Nội dung: {\"events\":[{\"leadId\":\"L123\",\"stage\":\"qualified\",\"time\":\"2026-09-28T10:00:00+07:00\",\"gclid\":\"…\",\"email\":\"…\",\"phone\":\"…\",\"value\":5000000}]}", detail: "stage: qualified (đạt chuẩn) · won (chốt đơn) · junk (rác — chỉ ghi nhận, không gửi). time không ghi múi giờ thì hiểu là giờ Việt Nam. Tối đa 500 sự kiện/lần." },
          { text: "Máy chủ AdsCommand phải nhận được yêu cầu từ CRM: nếu ứng dụng đang giới hạn theo IP, nhờ quản trị máy chủ mở riêng đường dẫn /api/leads/quality/webhook cho IP của CRM." },
        ],
      },
      {
        title: "B2. Cách CSV (thủ công)",
        steps: [
          { text: "Xuất lead từ CRM ra CSV có tiêu đề: lead_id, stage, time + ít nhất một trong gclid / email / phone; value tuỳ chọn. Tên cột tiếng Việt cũng được (Mã lead, Trạng thái, Thời gian, SĐT…)." },
          { text: "Tab Chất lượng lead → Tải CSV → tool nhận, băm email/SĐT, gửi Google ngay và báo từng dòng lỗi." },
        ],
      },
      {
        title: "C. Đưa vào đặt giá (khi số đã đều)",
        steps: [
          { text: "Chờ 2–4 tuần thấy số “Lead đạt chuẩn” đổ về đều trong Google Ads → Mục tiêu → Chuyển đổi.", warn: "Đổi mục tiêu đặt giá làm chiến dịch học lại — làm từng chiến dịch, không đổi hàng loạt." },
          { text: "Google Ads → Mục tiêu → Chuyển đổi → Tóm tắt → hành động “AdsCommand · Lead đạt chuẩn” → đổi thành Chính (Primary); cân nhắc hạ “Để lại thông tin” thành Phụ." },
        ],
      },
    ],
    verify: ["Tab Chất lượng lead: số “Đã gửi” tăng sau mỗi lô; dòng lỗi (nếu có) ghi rõ lý do.", "Sau ~1 ngày: Google Ads → Chuyển đổi → hành động AdsCommand · Lead đạt chuẩn có số."],
    errors: [
      { symptom: "401 “Sai hoặc thiếu khoá webhook”", fix: "Header phải là Authorization: Bearer <khoá>; tạo khoá mới thì khoá cũ hết hiệu lực." },
      { symptom: "Dòng lỗi “cần gclid hoặc email/SĐT”", fix: "Lead không có cách nào để Google khớp lượt bấm — bổ sung gclid (phần A) hoặc email/SĐT." },
      { symptom: "Google báo lượt bấm quá cũ / không tìm thấy gclid", fix: "Google chỉ nhận trong 90 ngày sau lượt bấm, và gclid phải của đúng tài khoản quảng cáo này." },
      { symptom: "Sự kiện nằm ở “chờ tạo hành động”", fix: "Chưa làm phần A bước 2 — tạo hành động xong, job gửi lại mỗi giờ." },
    ],
    security: ["Email/SĐT băm SHA-256 ngay khi nhận; tool không lưu bản thô.", "Khoá webhook chỉ lưu dạng băm — mất khoá thì tạo khoá mới.", "Chỉ gửi vào 2 hành động do tool tạo, không đụng hành động chuyển đổi khác."],
  },
]

export const guideById = (id: string) => CONNECTION_GUIDES.find((g) => g.id === id) ?? null
