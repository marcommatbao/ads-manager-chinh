// ============================================================
// Hướng dẫn xử lý cho từng tiêu chí audit
// ============================================================
// Những tiêu chí KHÔNG có bước sửa tự động vẫn có một nút mời người dùng
// bấm. Trước đây bấm vào chỉ nhận lại đúng một câu: "chưa có bước sửa tự
// động — cần xử lý thủ công trong Google Ads". Đó là câu thật, nhưng nút
// ghi "Xem hướng dẫn xử lý" mà không đưa ra hướng dẫn nào thì vẫn là một
// lời hứa suông — chỉ khác là hứa suông một cách trung thực.
//
// Tra cứu theo `id` của tiêu chí, KHÔNG theo tên. Route auto-fix cũ so
// tên bằng `checkName.includes("Budget")` — đổi tiêu đề hiển thị một chữ
// là rơi thẳng xuống nhánh mặc định mà không ai biết.

export interface AuditGuide {
  /** Vì sao tiêu chí này đáng quan tâm — nói bằng tiền/khách, không nói bằng chỉ số. */
  why: string;
  /** Các bước làm được ngay, theo thứ tự. */
  steps: string[];
  /** Đường đi trong giao diện Google Ads, nếu có. */
  path?: string;
  /** Cảnh báo trước khi làm — chỗ dễ làm hỏng. */
  caution?: string;
}

export const AUDIT_GUIDES: Record<string, AuditGuide> = {
  campaign_count: {
    why: "Quá nhiều chiến dịch làm dữ liệu chuyển đổi bị chia nhỏ, Smart Bidding không đủ tín hiệu để học ở bất kỳ chiến dịch nào — mỗi cái một ít, không cái nào đủ.",
    path: "Google Ads → Campaigns → sắp theo Cost 30 ngày",
    steps: [
      "Lọc các chiến dịch có dưới 30 chuyển đổi/tháng — đây là nhóm Smart Bidding không học được.",
      "Gộp những chiến dịch cùng mục tiêu và cùng nhóm từ khoá vào một chiến dịch, tách thành ad group thay vì tách thành campaign.",
      "Giữ riêng chiến dịch chỉ khi có lý do THẬT: khác ngân sách trần, khác vùng địa lý, khác ngôn ngữ, hoặc cần báo cáo tách bạch cho kế toán.",
      "Tạm dừng (không xoá) chiến dịch đã gộp, để giữ lịch sử dữ liệu.",
    ],
    caution: "Gộp chiến dịch sẽ reset giai đoạn học của Smart Bidding — chấp nhận 1–2 tuần hiệu suất dao động.",
  },

  budget_utilization: {
    why: "Chiến dịch tiêu chưa tới 30% ngân sách nghĩa là tiền đã duyệt nhưng quảng cáo không có chỗ để hiện — thường do nhắm chọn quá hẹp hoặc giá thầu quá thấp, không phải do thiếu tiền.",
    path: "Google Ads → chọn chiến dịch → Settings + Keywords",
    steps: [
      "Xem cột Impression Share: nếu mất phần lớn do Ad Rank (không phải do ngân sách) thì vấn đề là giá thầu/chất lượng, tăng ngân sách sẽ không giúp gì.",
      "Kiểm tra nhắm địa lý: có đang giới hạn ở phạm vi quá nhỏ không.",
      "Kiểm tra từ khoá: nếu toàn Exact match, thêm vài từ Phrase để mở rộng vùng phủ.",
      "Nếu chiến dịch thật sự không còn nhu cầu tìm kiếm, HẠ ngân sách xuống đúng mức tiêu thật thay vì để treo — ngân sách ảo làm sai mọi báo cáo phân bổ.",
    ],
    caution: "Đừng tăng giá thầu trước khi biết mất hiển thị vì lý do gì. Tăng nhầm chỗ là đốt tiền nhanh hơn chứ không phải bán được nhiều hơn.",
  },

  ad_strength: {
    why: "Ad Strength thấp nghĩa là Google không có đủ nguyên liệu để ghép quảng cáo phù hợp với từng truy vấn — cùng ngân sách nhưng ít cơ hội khớp hơn.",
    path: "Creative AI Studio của công cụ này, hoặc Google Ads → Ads & assets → Ads",
    steps: [
      "Mở mỗi RSA, đếm số Headline: dưới 8 thì Google gần như không thể đạt Good/Excellent.",
      "Bổ sung cho đủ 12–15 Headline và 4 Description, mỗi cái nói MỘT ý khác nhau (giá, thời gian giao, bảo hành, uy tín…). Viết 15 câu cùng nghĩa không giúp gì.",
      "Nhét từ khoá chính của ad group vào ít nhất 3 Headline.",
      "Ghim (pin) càng ít càng tốt — ghim nhiều là tự tay bỏ đi khả năng ghép của Google, và Ad Strength sẽ tụt.",
    ],
    caution: "Sửa quảng cáo đang chạy sẽ tạo bản mới và reset dữ liệu học của nó. Sửa một lần cho đủ, đừng sửa lắt nhắt nhiều lần.",
  },

  ad_extensions: {
    why: "Asset (extension) làm quảng cáo chiếm nhiều diện tích màn hình hơn và cộng trực tiếp vào Ad Rank — đây là thứ tăng hiển thị mà không cần tăng giá thầu.",
    path: "Google Ads → Campaigns → Assets → Asset table",
    steps: [
      "Sitelink: thêm tối thiểu 4 (các trang thật, không phải trang chủ lặp lại).",
      "Callout: thêm 4–6 câu ngắn về cam kết (bảo hành, hỗ trợ 24/7, giao nhanh…).",
      "Structured Snippet: chọn một danh mục phù hợp rồi liệt kê 3–5 mục.",
      "Call asset nếu có tổng đài; Image asset nếu có ảnh sản phẩm đúng tỉ lệ.",
      "Đặt ở cấp Account để mọi chiến dịch dùng chung, rồi ghi đè ở cấp chiến dịch khi cần nói khác đi.",
    ],
  },

  negative_lists: {
    why: "Không có danh sách phủ định dùng chung thì mỗi chiến dịch phải tự chặn lại từ đầu — và chiến dịch mới tạo sẽ luôn bắt đầu bằng việc đốt tiền vào những truy vấn bạn đã biết là sai từ lâu.",
    path: "Google Ads → Tools → Shared library → Negative keyword lists",
    steps: [
      'Tạo 3 danh sách tách biệt: "Rác chung" (miễn phí, crack, tuyển dụng, cách tự làm…), "Đối thủ", và "Sai ngành" (những nghĩa khác của từ khoá).',
      "Gắn cả 3 vào mọi chiến dịch Search đang chạy.",
      "Mỗi tuần mở báo cáo Search Terms, thấy truy vấn sai loại nào thì bỏ vào đúng danh sách đó — chặn một lần, mọi chiến dịch được bảo vệ.",
    ],
    caution: 'Đừng bỏ tên đối thủ vào danh sách gắn cho chiến dịch săn đối thủ (nếu có) — nó sẽ tự tắt chính chiến dịch đó.',
  },

  keyword_coverage: {
    why: "Ad group 20+ từ khoá buộc một bộ quảng cáo phải nói vừa lòng quá nhiều ý định khác nhau. Kết quả là câu quảng cáo chung chung, Ad Relevance tụt, Quality Score tụt, và giá mỗi nhấp chuột tăng cho đúng những từ khoá bạn muốn rẻ.",
    path: "Google Ads → Ad groups → sắp theo số từ khoá",
    steps: [
      "Mở ad group đang có trên 20 từ khoá, xếp các từ khoá theo Ý ĐỊNH chứ không theo chữ giống nhau: nhóm muốn mua, nhóm đang so sánh, nhóm chỉ tìm hiểu.",
      "Tách mỗi nhóm ý định thành một ad group riêng, mỗi ad group 5–15 từ khoá.",
      "Viết RSA riêng cho từng ad group, nhắc lại đúng cụm từ khoá của nhóm đó trong Headline.",
      "Ad group dưới 3 từ khoá thì ngược lại: gộp vào nhóm cùng ý định, vì quá ít dữ liệu để tối ưu riêng.",
    ],
    caution: "Chuyển từ khoá sang ad group mới là tạo từ khoá mới — lịch sử Quality Score bắt đầu lại. Chỉ tách khi nhóm đó đủ lưu lượng để học lại.",
  },

  conversion_tracking: {
    why: "Đây là tiêu chí gốc. Không đo đúng chuyển đổi thì mọi thứ phía sau — Smart Bidding, đánh giá từ khoá, quyết định ngân sách — đều đang tối ưu cho một con số sai.",
    path: "Google Ads → Goals → Conversions → Summary",
    steps: [
      'Kiểm tra cột "Status": hành động nào ghi "No recent conversions" là đang hỏng, không phải đang ế.',
      'Đảm bảo đúng MỘT hành động chính (thường là Purchase) được đặt "Primary"; các hành động phụ để "Secondary" để không bị đếm chồng.',
      "Thêm ít nhất một micro-conversion (thêm giỏ hàng, gửi form) làm tín hiệu phụ khi chuyển đổi chính quá ít.",
      "Đối chiếu số chuyển đổi Google Ads với số đơn thật trong 7 ngày — lệch quá 20% là có vấn đề đo lường, cần sửa trước khi tin bất cứ báo cáo nào.",
    ],
    caution: "Đổi hành động Primary sẽ đổi mục tiêu Smart Bidding đang tối ưu. Chấp nhận giai đoạn học lại, và đừng đổi giữa mùa cao điểm.",
  },

  geo_targeting: {
    why: 'Chế độ mặc định "Presence or Interest" cho quảng cáo hiện với cả người chỉ QUAN TÂM tới khu vực mà không thực sự ở đó — với dịch vụ bán tại chỗ, đây là nguồn nhấp chuột rác lặng lẽ và đều đặn.',
    path: "Google Ads → chọn chiến dịch → Settings → Locations → Location options",
    steps: [
      'Mở "Location options" (nút nhỏ, mặc định thu gọn nên rất dễ bỏ sót).',
      'Đổi Target sang "Presence: People in or regularly in your targeted locations".',
      'Đổi Exclude sang "Presence: People in your excluded locations".',
      "Làm cho từng chiến dịch — thiết lập này KHÔNG có ở cấp tài khoản.",
      "Sau 2 tuần, xem báo cáo Locations → User locations để xác nhận lưu lượng ngoài vùng đã giảm.",
    ],
    caution: "Nếu bán online toàn quốc hoặc phục vụ khách du lịch/khách sắp chuyển tới thì GIỮ Presence or Interest — đổi sẽ cắt mất khách thật.",
  },

  lp_speed: {
    why: "Trải nghiệm trang đích là một trong ba thành phần của Quality Score. Trang chậm hoặc khó dùng trên điện thoại làm tăng giá mỗi nhấp chuột trên toàn bộ từ khoá, chứ không chỉ mất khách ở trang đó.",
    path: "PageSpeed Insights (pagespeed.web.dev) — Google Ads API không cung cấp số liệu tốc độ",
    steps: [
      "Đo trang đích đang tiêu nhiều tiền nhất bằng PageSpeed Insights, xem tab Mobile.",
      "Nén ảnh sang WebP/AVIF — đây gần như luôn là khoản nặng nhất.",
      "Bật cache CDN cho ảnh và tài nguyên tĩnh.",
      "Hoãn (defer) các script không cần cho lần vẽ đầu tiên: chat, heatmap, pixel phụ.",
      "Mở trang trên điện thoại thật: nút bấm có đủ to không, form có tự phóng to không, nội dung chính có phải cuộn mới thấy không.",
    ],
    caution: "Đây là việc của tầng server/CDN, công cụ này không sửa được. Đừng chờ điểm audit tự tăng sau khi bấm nút ở đây.",
  },

  impression_share: {
    why: "Mất Impression Share là những lần khách CÓ tìm nhưng quảng cáo không hiện. Phải tách rõ mất vì thiếu tiền hay mất vì thứ hạng thấp — hai nguyên nhân này cần hai cách chữa ngược nhau.",
    path: "Google Ads → Campaigns → thêm cột Search Lost IS (budget) và Search Lost IS (rank)",
    steps: [
      "Thêm cả hai cột trên vào bảng, so xem cột nào lớn hơn.",
      "Nếu mất do NGÂN SÁCH: tăng ngân sách cho đúng chiến dịch đó — nhưng chỉ khi CPA của nó đang đạt, còn không thì đang xin thêm tiền để lỗ nhanh hơn.",
      "Nếu mất do AD RANK (trường hợp của tài khoản này): cải thiện Quality Score trước — Ad Relevance qua RSA sát từ khoá, trải nghiệm trang đích, và bổ sung asset.",
      "Tăng giá thầu chỉ là cách chữa cuối, vì nó đẩy chi phí lên ngay còn Quality Score thì hạ chi phí lâu dài.",
    ],
    caution: "Impression Share 100% không phải mục tiêu. Những lần hiển thị cuối cùng thường là đắt nhất và kém chất lượng nhất.",
  },

  bidding_strategy: {
    why: "Chiến dịch đã có đủ dữ liệu chuyển đổi mà vẫn đặt giá thầu tay nghĩa là đang bỏ không phần tối ưu theo thời gian thực — Google điều chỉnh theo từng phiên đấu giá, con người thì không.",
    path: "Google Ads → chọn chiến dịch → Settings → Bidding",
    steps: [
      "Chỉ chuyển những chiến dịch có từ 30 chuyển đổi/tháng trở lên; ít hơn thì Smart Bidding không đủ dữ liệu và sẽ chạy tệ hơn tay.",
      'Bước đệm an toàn: chuyển sang "Maximize Conversions" KHÔNG đặt Target CPA, chạy 2–3 tuần để hệ thống học.',
      "Sau khi ổn định, đặt Target CPA bằng đúng CPA trung bình đang đạt — đừng đặt mục tiêu tham vọng ngay, hệ thống sẽ ghìm hiển thị lại để đạt cho bằng được.",
      "Chuyển từng chiến dịch một, cách nhau ít nhất một tuần, để còn biết cái nào gây ra thay đổi.",
    ],
    caution: "Giai đoạn học kéo dài 1–2 tuần và hiệu suất sẽ dao động. Đừng đổi lại giữa chừng — đổi qua đổi lại là reset học liên tục và không bao giờ ổn định.",
  },
};

/** Tiêu chí có bước sửa tự động — hướng dẫn nằm ngay trong luồng xem trước. */
export const AUTO_FIXABLE_IDS = new Set(["search_term_waste", "quality_score", "device_bid"]);
