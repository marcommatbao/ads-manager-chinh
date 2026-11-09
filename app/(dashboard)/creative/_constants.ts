import {
  Globe, Cloud, Briefcase, Mail, Shield, Bot, Edit3,
  FileText, ClipboardList, DollarSign, Users, BarChart3, Rocket,
} from "lucide-react";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

export const PRODUCTS_BY_COMPANY: Record<string, Array<{ id: string; label: string; icon: typeof Globe; badge: string | null }>> = {
  MBC: [
    { id: "ten-mien",        label: "Tên miền",          icon: Globe,          badge: null },
    { id: "hosting",         label: "Hosting",           icon: Cloud,          badge: null },
    // Sản phẩm THẬT, không phải biến thể của "hosting": bán cho người dựng app
    // bằng AI mà không biết code. Trước 26/08/2026 chưa có trong danh sách nên
    // ai cũng phải gõ tay "Vibe Hosting" → productId thành `custom_Vibe Hosting`
    // → không khớp kiến thức sản phẩm nào → AI suy luận trắng.
    { id: "vibe-hosting",    label: "Vibe Hosting",      icon: Rocket,         badge: "🚀 Mới" },
    { id: "microsoft-365",   label: "Microsoft 365",     icon: Briefcase,      badge: null },
    { id: "google-workspace",label: "Google Workspace",   icon: Globe,          badge: null },
    { id: "email-dn",        label: "Email doanh nghiệp",icon: Mail,           badge: null },
    { id: "ssl",             label: "SSL Certificate",   icon: Shield,         badge: null },
    { id: "sale-ai",         label: "Sale.ai",           icon: Bot,            badge: "⭐ Đang push mạnh" },
    { id: "custom",          label: "Tuỳ chỉnh",        icon: Edit3,          badge: null },
  ],
  MBI: [
    { id: "hoa-don-dien-tu", label: "Hóa đơn điện tử",  icon: FileText,       badge: null },
    { id: "chu-ky-so",       label: "Chữ ký số",        icon: Shield,         badge: null },
    { id: "hop-dong-dien-tu",label: "Hợp đồng điện tử", icon: ClipboardList,  badge: null },
    { id: "hoa-don-ecom",    label: "Hóa đơn Ecom",     icon: FileText,       badge: "🔥 Hot" },
    { id: "custom",          label: "Tuỳ chỉnh",        icon: Edit3,          badge: null },
  ],
};

// Backward compat — flat list of all products for lookups
export const ALL_PRODUCTS_LIST = [...PRODUCTS_BY_COMPANY.MBC, ...PRODUCTS_BY_COMPANY.MBI];

// Company-specific objectives mapped to FB API
export const FB_OBJECTIVE_OPTIONS: Record<string, Array<{
  key: string; label: string; description: string; icon: typeof DollarSign;
}>> = {
  MBC: [
    { key: "OUTCOME_SALES",   label: "Doanh số",                    description: "Mua trực tiếp online — tối ưu cho conversion",     icon: DollarSign },
    { key: "OUTCOME_LEADS",   label: "Khách hàng tiềm năng",       description: "Thu thập form đăng ký, tư vấn",                    icon: Users },
    { key: "OUTCOME_TRAFFIC", label: "Lưu lượng truy cập",         description: "Đưa người vào website đọc",                        icon: BarChart3 },
  ],
  MBI: [
    { key: "OUTCOME_SALES",   label: "Doanh số",                    description: "Mua khoá học, đăng ký webinar trực tiếp",          icon: DollarSign },
    { key: "OUTCOME_TRAFFIC", label: "Lưu lượng truy cập",         description: "Đưa người vào landing page tìm hiểu",              icon: BarChart3 },
  ],
};

// Legacy OBJECTIVES kept for generate-text prompt
export const OBJECTIVES = [
  { value: "OUTCOME_SALES",   label: "Tăng doanh số" },
  { value: "OUTCOME_LEADS",   label: "Thu lead" },
  { value: "OUTCOME_TRAFFIC", label: "Tăng traffic" },
];

// PIXEL_EVENTS (5 sự kiện gõ cứng) đã được gỡ: danh sách sự kiện chuyển đổi
// nay lấy thật từ Pixel qua /api/creative/pixel-events, còn danh mục tiêu
// chuẩn nằm ở lib/meta-pixel-events.ts (nguồn sự thật duy nhất, dùng chung
// cho cả giao diện, đường khởi chạy và bảng tra CPL).

export const PLATFORMS: { value: string; label: string }[] = [
  { value: "facebook", label: "Facebook" },
  { value: "google",   label: "Google" },
  { value: "both",     label: "Cả hai" },
];

export const TONES = [
  { id: "professional",  label: "Chuyên nghiệp",   icon: "💼", description: "B2B, logic, số liệu",         sampleHook: "Giải pháp tên miền toàn diện cho doanh nghiệp Việt",    bestFor: ["ten-mien", "microsoft-365", "chu-ky-so"] },
  { id: "urgent",        label: "Khẩn cấp",         icon: "🔥", description: "Deadline, flash sale",        sampleHook: "Chỉ còn 48 giờ — Tên miền .COM giảm [x]%",              bestFor: ["ten-mien", "hosting"] },
  { id: "friendly",      label: "Thân thiện",        icon: "😊", description: "Gần gũi, dùng 'bạn', emoji", sampleHook: "Xin chào! Tên miền đẹp cho dự án của bạn đây 👋",       bestFor: ["ten-mien", "sale-ai"] },
  { id: "authority",     label: "Uy tín & Số liệu",  icon: "🏆", description: "Social proof, thành tựu",    sampleHook: "[Số khách hàng thật] doanh nghiệp Việt đã tin dùng Mắt Bão",           bestFor: ["microsoft-365", "sale-ai", "chu-ky-so"] },
  { id: "fomo",          label: "FOMO",               icon: "👀", description: "Đối thủ đang làm, đừng bỏ lỡ", sampleHook: "Đối thủ bạn đã có website — bạn thì sao?",           bestFor: ["ten-mien", "microsoft-365", "hoa-don-dien-tu"] },
  { id: "value",         label: "Giá trị/Tiết kiệm", icon: "💰", description: "Price-sensitive, SME nhỏ",   sampleHook: "Mua 1 tên miền — Nhận [ưu đãi thật]. Tiết kiệm ngay hôm nay",  bestFor: ["ten-mien", "hosting", "hoa-don-dien-tu"] },
];

export const MAX_TONES = 3;

export const STORAGE_KEY = "adscommand_saved_creatives";

// ─────────────────────────────────────────────
// Smart Pre-fill Templates per Product
// ─────────────────────────────────────────────

export const PRODUCT_PREFILLS: Record<string, {
  usp: string;
  socialProof: string;
  customerDesc: string;
  painPoints: string;
  motivation: string;
  competitors: string;
}> = {
  "ten-mien": {
    usp: "Tên miền .vn/.com chính ngạch, đăng ký trực tuyến nhanh gọn, có đội hỗ trợ kỹ thuật", // 07/10: bỏ "5 phút", "24/7" — chưa có nguồn
    socialProof: "Đối tác chính thức VNNIC & ICANN", // 07/10: gỡ con số chưa có nguồn
    customerDesc: "Chủ doanh nghiệp/startup 28-45 tuổi vừa thành lập công ty, muốn bảo vệ thương hiệu online",
    painPoints: "Sợ bị mất tên thương hiệu, không biết đăng ký ở đâu uy tín, lo bị lừa đảo domain",
    motivation: "Muốn có email @congty.vn chuyên nghiệp, bảo vệ thương hiệu, tăng uy tín online",
    competitors: "Vietnix, VNPT, PA Vietnam, Mắt Bão",
  },
  "hosting": {
    usp: "Hosting SSD NVMe tốc độ cao, cPanel miễn phí, có đội hỗ trợ kỹ thuật", // 07/10: bỏ "uptime 99.9%", "24/7" — chỉ ghi lại khi có cam kết SLA bằng văn bản
    socialProof: "", // 07/10: gỡ con số chưa có nguồn
    customerDesc: "Web developer hoặc chủ website SME cần hosting ổn định, tốc độ cao cho kinh doanh online",
    painPoints: "Hosting hiện tại chậm, hay down, hỗ trợ kém, giá ẩn phí",
    motivation: "Muốn website load nhanh, không bị gián đoạn, tiết kiệm chi phí vận hành",
    competitors: "Vietnix, VNPT Hosting, Mắt Bão Hosting",
  },
  "vibe-hosting": {
    usp: "Đưa app/web dựng bằng AI lên mạng nhanh — không cần biết code, AI báo lỗi bằng tiếng Việt, quay lại bản cũ 1 chạm", // 07/10: bỏ "3 phút" — chưa đo
    socialProof: "Nhận thẳng code từ Claude, ChatGPT, v0.dev, Bolt, Codex, Antigravity, Lovable, Cursor",
    customerDesc: "Freelancer/designer 22-35 vừa dựng xong app bằng AI nhưng không biết đưa lên mạng; và chủ SME tự làm công cụ nội bộ mà không có người IT",
    painPoints: "AI viết xong web rồi mà không biết deploy thế nào; hosting cPanel không chạy được app Node/Next; log lỗi toàn tiếng Anh không đọc nổi",
    motivation: "Cho khách xem sản phẩm ngay hôm nay, không phải chờ hay thuê dev; có hóa đơn VAT để quyết toán",
    competitors: "Vercel, Railway, Render, hosting cPanel truyền thống",
  },
  "microsoft-365": {
    usp: "Microsoft 365 bản quyền chính hãng, hỗ trợ triển khai cho doanh nghiệp", // 07/10: bỏ "trong 1 ngày", "giá tốt nhất thị trường" (Luật Quảng cáo: chữ "nhất" phải có tài liệu chứng minh)
    socialProof: "", // 07/10: gỡ con số chưa có nguồn
    customerDesc: "Doanh nghiệp vừa và nhỏ 20-100 nhân viên cần công cụ làm việc cộng tác và email doanh nghiệp",
    painPoints: "Đang dùng phần mềm crack, lo bị kiểm tra bản quyền, email miễn phí không chuyên nghiệp",
    motivation: "Nâng cao hình ảnh doanh nghiệp, cải thiện năng suất làm việc nhóm, tuân thủ bản quyền",
    competitors: "Google Workspace, Zoho Mail, FPT Office",
  },
  "google-workspace": {
    usp: "Google Workspace bản quyền, email @domain riêng, lưu trữ Drive theo gói, hỗ trợ tiếng Việt", // 07/10: bỏ "Drive không giới hạn" — dung lượng tuỳ gói
    socialProof: "", // 07/10: gỡ con số chưa có nguồn
    customerDesc: "Startup, SME 5-50 người cần email công ty và công cụ cộng tác online linh hoạt",
    painPoints: "Email Gmail cá nhân không chuyên nghiệp, khó quản lý tài liệu nhóm, bảo mật kém",
    motivation: "Email @congty.vn chuyên nghiệp, chia sẻ tài liệu dễ dàng, làm việc từ xa hiệu quả",
    competitors: "Microsoft 365, Zoho Workplace",
  },
  "email-dn": {
    usp: "Email doanh nghiệp @domain.vn, chống spam tốt, dung lượng lớn, bảo mật cao",
    socialProof: "", // 07/10: gỡ con số chưa có nguồn
    customerDesc: "Chủ doanh nghiệp cần email công ty riêng, muốn tách biệt email cá nhân và công việc",
    painPoints: "Đang dùng Gmail cá nhân, email không chuyên nghiệp, hay bị vào spam",
    motivation: "Tạo dựng hình ảnh doanh nghiệp chuyên nghiệp, tăng tỷ lệ email được đọc",
    competitors: "Google Workspace, Microsoft 365, Zoho Mail",
  },
  "ssl": {
    usp: "SSL Certificate từ các CA uy tín, hỗ trợ cài đặt, đảm bảo HTTPS", // 07/10: bỏ "10 phút" — chưa đo
    socialProof: "", // 07/10: gỡ con số chưa có nguồn
    customerDesc: "Chủ website thương mại điện tử, landing page cần HTTPS để tăng uy tín và SEO",
    painPoints: "Website chưa có HTTPS, khách hàng lo ngại khi nhập thông tin, Google rank thấp",
    motivation: "Tăng tin cậy cho khách hàng, cải thiện SEO, bảo mật dữ liệu người dùng",
    competitors: "Vietnix SSL, Comodo, Sectigo",
  },
  "sale-ai": {
    usp: "AI Sales tự động trả lời, hỗ trợ chốt đơn cả ngoài giờ, tích hợp Facebook & Zalo", // 07/10: bỏ "24/7", "trong vài giờ" — chưa đo
    socialProof: "", // 07/10: gỡ con số chưa có nguồn
    customerDesc: "Chủ shop online, SME bán hàng qua Facebook/Zalo đang quá tải tin nhắn khách hàng",
    painPoints: "Bỏ lỡ khách hàng ngoài giờ, nhân viên sale bị quá tải, phản hồi chậm làm mất đơn",
    motivation: "Tự động hóa chăm sóc khách hàng cả ngoài giờ, tăng doanh thu mà không cần tăng nhân sự",
    competitors: "Pancake, Haravan Bot, Chatbot thủ công",
  },
  "hoa-don-dien-tu": {
    usp: "Hóa đơn điện tử đúng Nghị định 123, kết nối CQT trực tiếp, tích hợp ERP/phần mềm kế toán",
    socialProof: "", // 07/10: gỡ con số chưa có nguồn
    customerDesc: "Kế toán trưởng/Giám đốc doanh nghiệp 20-200 nhân viên đang chuẩn bị chuyển đổi HĐĐT bắt buộc",
    painPoints: "Chưa hiểu quy trình chuyển đổi HĐĐT, lo sai sót kê khai thuế, sợ phức tạp kỹ thuật",
    motivation: "Tuân thủ quy định Bộ Tài chính, giảm chi phí in ấn, tự động hóa kế toán",
    competitors: "MISA, Fast Accounting, VNPT Invoice, BKAV",
  },
  "chu-ky-so": {
    usp: "Chữ ký số USB Token & Cloud theo chuẩn ETSI, ký hợp đồng hợp pháp mọi lúc mọi nơi",
    socialProof: "", // 07/10: gỡ con số chưa có nguồn
    customerDesc: "Giám đốc/kế toán trưởng cần ký hợp đồng, HĐĐT, hồ sơ pháp lý số hóa từ xa",
    painPoints: "Phải in ra ký tay tốn thời gian, lo chữ ký scan không có giá trị pháp lý",
    motivation: "Ký kết từ xa trong vài giây, giảm chi phí in ấn, hồ sơ pháp lý đầy đủ giá trị",
    competitors: "VNPT-CA, Viettel-CA, BKAV-CA, FPT-CA",
  },
  "hop-dong-dien-tu": {
    usp: "Hợp đồng điện tử có giá trị pháp lý, chữ ký đa bên, lưu trữ đám mây an toàn",
    socialProof: "", // 07/10: gỡ con số chưa có nguồn
    customerDesc: "Bộ phận pháp lý/kinh doanh ký nhiều hợp đồng với đối tác, muốn rút ngắn thời gian",
    painPoints: "Ký hợp đồng giấy chậm, khó lưu trữ và tra cứu, chi phí in ấn cao",
    motivation: "Rút ngắn thời gian ký kết từ ngày xuống phút, lưu trữ tập trung dễ quản lý",
    competitors: "DocuSign, VNPT eContract, FPT eContract",
  },
  "hoa-don-ecom": {
    usp: "Hóa đơn điện tử cho Ecom, tích hợp Shopee/Lazada/Tiki, phát hành tự động theo đơn",
    socialProof: "", // 07/10: gỡ con số chưa có nguồn
    customerDesc: "Chủ shop thương mại điện tử bán hàng đa sàn, cần tự động hóa hóa đơn theo Nghị định 123",
    painPoints: "Phát hành hóa đơn thủ công tốn thời gian, hay sai sót, không theo kịp đơn hàng lớn",
    motivation: "Tự động hóa hoàn toàn quy trình hóa đơn, tuân thủ quy định, tiết kiệm nhân lực",
    competitors: "MISA Ecom, VNPT Invoice API, BKAV Invoice",
  },
};

// ─────────────────────────────────────────────
// Công ty KHÔNG thuộc bản Mắt Bão (đợt 21) — không đụng hằng số riêng MBC/MBI
// ─────────────────────────────────────────────

/** Mục tiêu chung cho công ty ngoài MBC/MBI (nhãn trung tính, không nhắc sản phẩm Mắt Bão). */
export const GENERIC_FB_OBJECTIVE_OPTIONS: Array<{
  key: string; label: string; description: string; icon: typeof DollarSign;
}> = [
  { key: "OUTCOME_SALES",   label: "Doanh số",              description: "Mua trực tiếp online — tối ưu cho conversion", icon: DollarSign },
  { key: "OUTCOME_LEADS",   label: "Khách hàng tiềm năng", description: "Thu thập form đăng ký, tư vấn",                icon: Users },
  { key: "OUTCOME_TRAFFIC", label: "Lưu lượng truy cập",   description: "Đưa người vào website đọc",                    icon: BarChart3 },
];

/** Mục tiêu theo công ty — luôn có giá trị (không bao giờ undefined). `legacy=false` = công ty ngoài bản Mắt Bão. */
export function fbObjectiveOptions(company: string, legacy?: boolean) {
  return (legacy === false ? undefined : FB_OBJECTIVE_OPTIONS[company]) ?? GENERIC_FB_OBJECTIVE_OPTIONS;
}

/** Sản phẩm cố định theo công ty — luôn có giá trị. */
export function legacyProducts(company: string) {
  return PRODUCTS_BY_COMPANY[company] ?? [];
}

/** Lớp màu nút công ty cho id không có trong bản Mắt Bão (Tailwind cần chuỗi tĩnh nên liệt kê). */
const COMPANY_COLOR_ACTIVE: Record<string, string> = {
  blue: "border-blue-500 bg-blue-600 text-white",
  indigo: "border-indigo-500 bg-indigo-600 text-white",
  violet: "border-violet-500 bg-violet-600 text-white",
  emerald: "border-emerald-500 bg-emerald-600 text-white",
  green: "border-green-500 bg-green-600 text-white",
  red: "border-red-500 bg-red-600 text-white",
  orange: "border-orange-500 bg-orange-600 text-white",
  amber: "border-amber-500 bg-amber-600 text-white",
  rose: "border-rose-500 bg-rose-600 text-white",
  teal: "border-teal-500 bg-teal-600 text-white",
  cyan: "border-cyan-500 bg-cyan-600 text-white",
  sky: "border-sky-500 bg-sky-600 text-white",
};
export function companyActiveClass(id: string, color: string | undefined): string {
  if (id === "MBC") return "border-blue-500 bg-blue-600 text-white";
  if (id === "MBI") return "border-violet-500 bg-violet-600 text-white";
  return COMPANY_COLOR_ACTIVE[color ?? ""] ?? "border-slate-600 bg-slate-700 text-white";
}

/** Ô "Tuỳ chỉnh" (gõ tay) — luôn có ở công ty ngoài bản Mắt Bão, sau các sản phẩm trong hồ sơ. */
export const CUSTOM_PRODUCT_OPTION: { id: string; label: string; icon: typeof Globe; badge: string | null } =
  { id: "custom", label: "Tuỳ chỉnh", icon: Edit3, badge: null };
