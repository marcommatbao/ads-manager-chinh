// ============================================================
// Hằng số nhắm mục tiêu Google Ads — MỘT nguồn duy nhất
// ------------------------------------------------------------
// VÌ SAO GOM VỀ ĐÂY: trước bản này bốn tệp tự gõ lại mã vị trí và ngôn ngữ
// (launch/search, launch/pmax, launch/precheck, google-keyword-planner). Ba
// trong bốn tệp ghi `languageConstants/1020` kèm chú thích "Vietnamese".
//
//   1020 KHÔNG phải tiếng Việt. 1020 là **tiếng Bulgaria**.
//   Tiếng Việt là **1040**.
//
// Tra thẳng từ Google ngày 18/09/2026 (bảng language_constant của tài khoản
// MBC): 1000 = English (en) · 1020 = Bulgarian (bg) · 1040 = Vietnamese (vi).
//
// Hậu quả của con số sai: Google chỉ phục vụ người có ngôn ngữ duyệt web là
// tiếng Bulgaria và đang ở Việt Nam — gần như không ai. Campaign không "chạy
// kém", nó gần như KHÔNG HIỂN THỊ. Mà không có gì báo cho người dùng biết:
// campaign vẫn hiện "đang chạy", chỉ là không ra lượt nào.
//
// Chính codebase tự tố cáo nhau: google-keyword-planner.ts dùng 1040 ĐÚNG để
// nghiên cứu từ khoá, rồi launch/search đem kết quả đó tạo campaign nhắm
// Bulgaria. Nghiên cứu một đằng, chạy một nẻo — và không ai phát hiện vì mã số
// nào trông cũng giống mã số nào.
//
// Quy tắc từ đây: KHÔNG gõ lại hằng số này ở bất cứ đâu khác. Import từ tệp
// này. Mã số không tự nói lên nó là gì — chỉ có tên biến mới nói được, và tên
// biến chỉ đáng tin khi có đúng một chỗ định nghĩa.
// ============================================================

/** Việt Nam (cấp quốc gia). Đã xác minh: geo_target_constant.name = "Vietnam",
 *  country_code = "VN", target_type = "Country". */
export const GEO_VIETNAM = "geoTargetConstants/2704";

/** Tiếng Việt. Đã xác minh: language_constant.code = "vi". */
export const LANG_VIETNAMESE = "languageConstants/1040";

/** Tiếng Anh — nhiều người Việt để giao diện Google bằng tiếng Anh, nên bỏ qua
 *  nhóm này là tự cắt mất một phần khách thật. Các campaign do người dựng tay
 *  trong tài khoản MBC đều nhắm CẢ HAI (1000 + 1040). */
export const LANG_ENGLISH = "languageConstants/1000";

/**
 * Ngôn ngữ mặc định cho campaign chạy ở Việt Nam.
 *
 * Gồm cả tiếng Anh có chủ đích, theo đúng cách các campaign đang chạy thật
 * trong tài khoản được dựng. Chỉ nhắm mỗi tiếng Việt sẽ bỏ sót người dùng để
 * Chrome/Google ở tiếng Anh — rất phổ biến trong nhóm khách kỹ thuật (hosting,
 * tên miền, máy chủ).
 */
export const DEFAULT_LANGUAGES = [LANG_VIETNAMESE, LANG_ENGLISH];

/**
 * Kiểu nhắm vị trí.
 *
 * `PRESENCE`             — chỉ người ĐANG Ở trong vùng đã chọn.
 * `PRESENCE_OR_INTEREST` — thêm cả người ở NGOÀI vùng nhưng tỏ ra quan tâm tới
 *                          vùng đó (tìm kiếm về nó, xem nội dung về nó).
 *
 * Google đặt PRESENCE_OR_INTEREST làm mặc định, và nó là lý do quen thuộc của
 * chuyện "sao quảng cáo hiện ở nước ngoài": người ở Mỹ tìm "hosting Việt Nam"
 * vẫn nằm trong tệp. Với dịch vụ bán cho người trong nước, PRESENCE thường
 * đúng hơn — nhưng đây là quyết định NGHIỆP VỤ, không phải kỹ thuật, nên để
 * người chạy quảng cáo chọn thay vì đổi ngầm.
 */
export type GeoTargetType = "PRESENCE" | "PRESENCE_OR_INTEREST";

/**
 * MẶC ĐỊNH `PRESENCE` — chỉ người đang ở trong vùng đã chọn.
 *
 * Đổi từ PRESENCE_OR_INTEREST (mặc định của Google) theo quyết định nghiệp vụ
 * ngày 18/09/2026: dịch vụ bán cho khách trong nước, không phục vụ người ở
 * nước ngoài. PRESENCE_OR_INTEREST kéo cả người ở Mỹ tìm "hosting Việt Nam"
 * vào tệp — đó là lý do quen thuộc của chuyện "sao quảng cáo hiện ở nước ngoài".
 */
export const DEFAULT_GEO_TARGET_TYPE: GeoTargetType = "PRESENCE";

export const GEO_TARGET_TYPE_VI: Record<GeoTargetType, string> = {
  PRESENCE: "Chỉ người đang Ở TRONG vùng đã chọn",
  PRESENCE_OR_INTEREST: "Người ở trong vùng HOẶC ở ngoài nhưng quan tâm tới vùng đó",
};

// ============================================================
// Phân tầng vị trí — vì sao KHÔNG xếp phẳng theo tên
// ------------------------------------------------------------
// Google giữ SONG SONG hai bộ đơn vị hành chính Việt Nam sau đợt sáp nhập
// 2025, và cả hai đều ENABLED, đều gắn được, không có lỗi nào phân biệt:
//
//   9040331  "Ha Noi"              cha = Vietnam   → CẢ Hà Nội (cấp tỉnh/thành)
//   1028580  "Hanoi"               cha = Ha Noi    → chỉ nội thành Hà Nội
//   9040373  "Ho Chi Minh"         cha = Vietnam   → CẢ TP.HCM
//   1028581  "Ho Chi Minh City"    cha = Ho Chi Minh → chỉ nội thành
//   (Da Nang, Hue, Hai Phong, Can Tho đều có cặp tương tự)
//
// Hai cái tên gần như giống hệt nhau, vùng phủ thì khác hẳn. Chọn nhầm là tự
// thu hẹp tệp khách mà KHÔNG có dấu hiệu gì — đúng loại lỗi im lặng như vụ
// languageConstants/1020. Nên bộ chọn phải xếp theo QUAN HỆ CHA-CON, không
// phải theo tên.
//
// Đo ngày 18/09/2026 trên tài khoản MBC: VN có 3.422 vị trí ENABLED —
// 1 Country · 12 Municipality · 28 Province · 69 City · 686 Ward · 2.621 Commune.
// Phường/xã quá vụn cho quảng cáo hosting nên bộ chọn chỉ lấy 4 tầng đầu.
// ============================================================

/** Các tầng vị trí đủ dùng cho quảng cáo — bỏ phường/xã. */
export const GEO_PICKER_TARGET_TYPES = ["Country", "Municipality", "Province", "City"] as const;

export type GeoTier = "country" | "province" | "city";

export const GEO_TIER_VI: Record<GeoTier, string> = {
  country: "Cả nước",
  province: "Tỉnh / Thành phố trực thuộc TW",
  city: "Thành phố / Khu vực trong tỉnh",
};

/**
 * Xếp tầng một vị trí theo CHA của nó, không theo `target_type`.
 *
 * `target_type` không tách được hai loại "Municipality" nói trên — cả
 * `Ha Noi` lẫn `Hanoi` đều mang nhãn Municipality. Chỉ quan hệ cha mới tách
 * được: cha là Việt Nam nghĩa là đơn vị cấp tỉnh/thành.
 */
export function geoTier(id: string | number, parentResourceName?: string | null): GeoTier {
  if (String(id) === "2704") return "country";
  if (parentResourceName && parentResourceName.split("/").pop() === "2704") return "province";
  return "city";
}

/**
 * Tên tiếng Việt + cách gọi quen thuộc cho các vị trí hay dùng.
 *
 * Google trả tên KHÔNG DẤU và theo lối phiên âm cũ ("Ha Noi", "Ho Chi Minh",
 * "Haiphong"). Người chạy quảng cáo gõ "Hà Nội", "TPHCM", "Sài Gòn" — đo thật
 * ngày 18/09/2026: gõ "tp hcm" ra **0 kết quả**. Bảng này để ô tìm kiếm khớp
 * được cách người ta thực sự gõ, và để danh sách đọc ra tiếng Việt.
 *
 * Khoá là `name` Google trả về, không phải id — vì cùng một tên xuất hiện ở
 * hai tầng (xem chú thích phân tầng ở trên) và cả hai đều nên hiện tiếng Việt.
 */
export const GEO_NAME_VI: Record<string, { vi: string; aliases: string[] }> = {
  "Vietnam":          { vi: "Việt Nam (cả nước)", aliases: ["vietnam", "vn", "canuoc", "toanquoc"] },
  "Ha Noi":           { vi: "Hà Nội",            aliases: ["hanoi", "hn", "thudo"] },
  "Hanoi":            { vi: "Hà Nội (nội thành)", aliases: ["hanoi", "hn"] },
  "Ho Chi Minh":      { vi: "TP. Hồ Chí Minh",   aliases: ["hochiminh", "tphcm", "hcm", "saigon", "sg"] },
  "Ho Chi Minh City": { vi: "TP.HCM (nội thành)", aliases: ["hochiminh", "tphcm", "hcm", "saigon", "sg"] },
  "Da Nang":          { vi: "Đà Nẵng",           aliases: ["danang", "dn"] },
  "Hai Phong":        { vi: "Hải Phòng",         aliases: ["haiphong", "hp"] },
  "Haiphong":         { vi: "Hải Phòng (nội thành)", aliases: ["haiphong", "hp"] },
  "Can Tho":          { vi: "Cần Thơ",           aliases: ["cantho", "ct"] },
  "Hue":              { vi: "Huế",               aliases: ["hue", "thuathienhue"] },
  "An Giang":         { vi: "An Giang",          aliases: ["angiang"] },
  "Bac Ninh":         { vi: "Bắc Ninh",          aliases: ["bacninh"] },
  "Ca Mau":           { vi: "Cà Mau",            aliases: ["camau"] },
  "Cao Bang":         { vi: "Cao Bằng",          aliases: ["caobang"] },
  "Dak Lak":          { vi: "Đắk Lắk",           aliases: ["daklak", "buonmathuot"] },
  "Dien Bien":        { vi: "Điện Biên",         aliases: ["dienbien"] },
  "Dong Nai City":    { vi: "Đồng Nai",          aliases: ["dongnai", "bienhoa"] },
  "Dong Thap":        { vi: "Đồng Tháp",         aliases: ["dongthap"] },
  "Gia Lai":          { vi: "Gia Lai",           aliases: ["gialai", "pleiku"] },
  "Ha Tinh":          { vi: "Hà Tĩnh",           aliases: ["hatinh"] },
  "Hung Yen":         { vi: "Hưng Yên",          aliases: ["hungyen"] },
  "Khanh Hoa":        { vi: "Khánh Hoà",         aliases: ["khanhhoa", "nhatrang"] },
  "Lai Chau":         { vi: "Lai Châu",          aliases: ["laichau"] },
  "Lam Dong":         { vi: "Lâm Đồng",          aliases: ["lamdong", "dalat"] },
  "Lang Son":         { vi: "Lạng Sơn",          aliases: ["langson"] },
  "Lao Cai":          { vi: "Lào Cai",           aliases: ["laocai", "sapa"] },
  "Nghe An":          { vi: "Nghệ An",           aliases: ["nghean", "vinh"] },
  "Ninh Binh":        { vi: "Ninh Bình",         aliases: ["ninhbinh"] },
  "Phu Tho":          { vi: "Phú Thọ",           aliases: ["phutho", "viettri"] },
  "Quang Ngai":       { vi: "Quảng Ngãi",        aliases: ["quangngai"] },
  "Quang Ninh":       { vi: "Quảng Ninh",        aliases: ["quangninh", "halong"] },
  "Quang Tri":        { vi: "Quảng Trị",         aliases: ["quangtri"] },
  "Son La":           { vi: "Sơn La",            aliases: ["sonla"] },
  "Tay Ninh":         { vi: "Tây Ninh",          aliases: ["tayninh"] },
  "Thai Nguyen":      { vi: "Thái Nguyên",       aliases: ["thainguyen"] },
  "Thanh Hoa":        { vi: "Thanh Hoá",         aliases: ["thanhhoa"] },
  "Tuyen Quang":      { vi: "Tuyên Quang",       aliases: ["tuyenquang"] },
  "Vinh Long":        { vi: "Vĩnh Long",         aliases: ["vinhlong"] },
};

/** Bỏ dấu tiếng Việt + khoảng trắng để so khớp lúc tìm.
 *  Google trả tên KHÔNG DẤU ("Ha Noi", "Da Nang") nhưng người dùng gõ có dấu
 *  ("Hà Nội") — không chuẩn hoá thì gõ đúng vẫn không ra kết quả nào. */
export function normalizeGeoQuery(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

// ============================================================
// Tên thành phố Google trả về → tiếng Việt có dấu (CHỈ để hiển thị)
// ------------------------------------------------------------
// Tách khỏi GEO_NAME_VI vì hai bảng làm hai việc khác nhau: GEO_NAME_VI phục
// vụ ô TÌM KIẾM lúc chọn vị trí (nên mỗi mục cần `aliases`), còn bảng này chỉ
// để ĐỌC báo cáo — không cần alias, và nhiều gấp mấy lần.
//
// Vì sao cần: `geo_target_constant.name` trả tên không dấu ("Buon Ma Thuot",
// "Rach Gia"). In thẳng ra báo cáo thì đọc được nhưng chướng.
//
// Danh sách lấy từ chính hai tài khoản MBC + MBI (21/09/2026): quét toàn bộ
// `geographic_view` 30 ngày rồi lọc ra tên nào chưa có bản tiếng Việt — 78
// tên. Không chép danh mục hành chính từ đâu khác vào, chỉ thêm đúng thứ thực
// sự xuất hiện trong dữ liệu.
//
// Tên nào không chắc thì KHÔNG đoán — để nguyên bản không dấu còn hơn gán sai
// một địa phương.
// ============================================================
export const GEO_CITY_NAME_VI: Record<string, string> = {
  "An Nhon": "An Nhơn",           "Bac Giang": "Bắc Giang",     "Bac Kan": "Bắc Kạn",
  "Bac Lieu": "Bạc Liêu",         "Bao Loc": "Bảo Lộc",         "Ben Cat": "Bến Cát",
  "Ben Tre": "Bến Tre",           "Bien Hoa": "Biên Hòa",       "Bim Son": "Bỉm Sơn",
  "Binh Long": "Bình Long",       "Binh Minh": "Bình Minh",     "Buon Ho": "Buôn Hồ",
  "Buon Ma Thuot": "Buôn Ma Thuột", "Cam Pha": "Cẩm Phả",       "Cam Ranh": "Cam Ranh",
  "Cao Lanh": "Cao Lãnh",         "Chau Doc": "Châu Đốc",       "Cua Lo": "Cửa Lò",
  "Dalat": "Đà Lạt",              "Di An": "Dĩ An",             "Dien Bien Phu": "Điện Biên Phủ",
  "Dong Gia Nghia": "Gia Nghĩa",  "Dong Ha": "Đông Hà",         "Dong Hoi": "Đồng Hới",
  "Dong Xoai": "Đồng Xoài",       "Go Cong": "Gò Công",         "Ha Giang": "Hà Giang",
  "Ha Long": "Hạ Long",           "Hoa Binh": "Hòa Bình",       "Hoa Lu": "Hoa Lư",
  "Hoang Mai": "Hoàng Mai",       "Hoi An": "Hội An",           "Hong Ngu": "Hồng Ngự",
  "Huong Thuy": "Hương Thủy",     "Huong Tra": "Hương Trà",     "Kien Tuong": "Kiến Tường",
  "Kon Tum": "Kon Tum",           "La Gi": "La Gi",             "Long Khanh": "Long Khánh",
  "Long Xuyen": "Long Xuyên",     "Mong Cai": "Móng Cái",       "My Tho": "Mỹ Tho",
  "Nam Dinh": "Nam Định",         "Nha Trang": "Nha Trang",     "Ninh Hoa": "Ninh Hòa",
  "Phan Rang": "Phan Rang",       "Phan Thiet": "Phan Thiết",   "Phu Ly": "Phủ Lý",
  "Phu Quoc": "Phú Quốc",         "Phuc Yen": "Phúc Yên",       "Phuoc Long": "Phước Long",
  "Pleiku": "Pleiku",             "Quang Yen": "Quảng Yên",     "Quy Nhon": "Quy Nhơn",
  "Rach Gia": "Rạch Giá",         "Sa Dec": "Sa Đéc",           "Sam Son": "Sầm Sơn",
  "Son Tay": "Sơn Tây",           "Song Cau": "Sông Cầu",       "Song Cong": "Sông Công",
  "Tam Diep": "Tam Điệp",         "Tan An": "Tân An",           "Tan Chau": "Tân Châu",
  "Tan Uyen": "Tân Uyên",         "Thai Binh": "Thái Bình",     "Thai Hoa": "Thái Hòa",
  "Thu Dau Mot": "Thủ Dầu Một",   "Thuan An": "Thuận An",       "Tra Vinh": "Trà Vinh",
  "Tu Son": "Từ Sơn",             "Tuy Hoa": "Tuy Hòa",         "Uong Bi": "Uông Bí",
  "Viet Tri": "Việt Trì",         "Vinh Yen": "Vĩnh Yên",       "Vo Xu": "Võ Xu",
  "Vung Tau": "Vũng Tàu",         "Yen Bai": "Yên Bái",
  // CỐ Ý BỎ TRỐNG: "Thanh Vinh" — không chắc là địa phương nào, để nguyên bản
  // không dấu còn hơn gán nhầm.
};

/**
 * Tên địa điểm để HIỂN THỊ, từ `geo_target_constant.name`.
 *
 * Google đính số vào một số tên ("Ha Giang 1", "Mong Cai 1", "1 Bao Loc") —
 * đó là cách họ phân biệt mã trùng tên, không phải một phần tên thật. Cắt số
 * đi trước khi tra, nếu không thì tra trượt toàn bộ những tên đó.
 *
 * Không tra được thì trả về ĐÚNG tên Google đưa, không bịa.
 */
export function geoDisplayNameVi(rawName: string | undefined | null): string | null {
  const raw = (rawName ?? "").trim();
  if (!raw) return null;
  const bare = raw.replace(/^\d+\s+/, "").replace(/\s+\d+$/, "").trim();
  return GEO_NAME_VI[raw]?.vi ?? GEO_NAME_VI[bare]?.vi
      ?? GEO_CITY_NAME_VI[raw] ?? GEO_CITY_NAME_VI[bare]
      ?? raw;
}
