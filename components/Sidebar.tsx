"use client";

import { moduleOfPage } from "@/lib/companies/modules";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Megaphone,
  Sparkles,
  Zap,
  BarChart2,
  Bell,
  Settings,
  // Target — chỉ còn dùng ở các mục đang bị ẩn (CPL, Intelligence); bỏ import
  // để không phát sinh lỗi lint. Mở lại mục nào thì thêm lại icon đó.
  Users,
  LogOut, KeyRound,
  ChevronDown,
  ChevronRight,
  Wrench,
  Search,
  Lightbulb,
  PieChart,
  PenTool,
  ShieldCheck,
  Beaker,
  Eye,
  BookOpen,
  Images,
  Radar,
  GitBranch,
  Receipt,
  Stethoscope,
  HeartPulse,
  ListChecks, History,
  ListTodo, CalendarRange, Target,
  BookOpenCheck,
  ScanLine,
  Scale,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/components/SessionProvider";
import type { Role } from "@/lib/permissions";

// ─────────────────────────────────────────────
// Nav Items with role-based visibility
// ─────────────────────────────────────────────

import { isHiddenPage } from "@/lib/hidden-pages";
import type { ModuleId } from "@/lib/companies/defaults";
import { hasModule } from "@/lib/companies/registry";
import { useSetupFlags } from "@/lib/setup/client";
import { useCompaniesVersion } from "@/lib/companies/use-companies";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

export interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  description?: string; // shown as a tooltip — disambiguates adjacent-purpose items
  roles?: Role[]; // If undefined, all roles can see
  badge?: "improvements"; // dynamic badge key
  children?: { label: string; href: string; roles?: Role[] }[];
  /** Ẩn dòng "Tổng quan <tên>" dẫn về trang gốc của nhóm.
   *
   *  Chỉ đặt khi trang gốc không có gì thêm ngoài việc liệt kê lại đúng các
   *  mục con — như /toolkit, vốn chỉ là lưới thẻ trỏ tới chính những mục đã
   *  nằm ngay bên dưới trong sidebar.
   *
   *  LƯU Ý: nút bật/tắt của nhóm chỉ mở/đóng chứ KHÔNG điều hướng, nên ẩn
   *  dòng này là trang gốc không còn bấm tới được từ sidebar (vẫn mở được
   *  bằng URL trực tiếp). Đó là lý do mặc định phải hiện. */
  hideRootLink?: boolean;
  // Every item in a group carries the same `section` value (not just the
  // first) — needed so the header still renders correctly when role-based
  // filtering hides the group's first item but not a later one (e.g. a
  // viewer role sees "Radar Chính Sách" but not Intelligence/PMax/Audit,
  // which are admin-only within the same "Phân tích" section).
  section?: string;
  /** Đợt 21 A2: mô-đun của bản cài. Bỏ trống = lõi Marketing (luôn hiện). */
  module?: ModuleId;
}

const ALL_ROLES: Role[] = ["super_admin", "admin_mbc", "admin_mbi", "viewer_mbc", "viewer_mbi", "admin", "viewer"];
const ADMIN_ROLES: Role[] = ["super_admin", "admin_mbc", "admin_mbi", "admin"]; // Đợt 21 A5: + vai trò chung

const ALL_NAV_ITEMS: NavItem[] = [
  { label: "Dashboard",      href: "/",              icon: LayoutDashboard, description: "Tổng quan chi tiêu, cảnh báo và tóm tắt AI mỗi sáng." },

  // Sắp lại 03/10 (user): nhóm theo VIỆC — mỗi mục chỉ ở một chỗ, tên mục giữ nguyên (câu chữ do BA duyệt).
  // ── HẰNG NGÀY: mở đầu ngày, xem việc + báo cáo ──
  { label: "Việc hôm nay", href: "/viec-hom-nay", icon: ListTodo, description: "Hộp việc gộp từ PMax, Search, Meta, phiên xử lý & sức khoẻ đo lường — xếp theo số đo sai, lãng phí, cơ hội.", section: "Hằng ngày" },
  { label: "Báo cáo tuần", href: "/bao-cao-tuan", icon: CalendarRange, description: "Mỗi thứ Hai: tiền & kết quả từng công ty, số đáng tin tới đâu, tool đã làm gì, việc tồn, thử nghiệm.", section: "Hằng ngày" },
  { label: "Thông báo",      href: "/notifications", icon: Bell, description: "Cảnh báo chiến dịch theo thời gian thực.", section: "Hằng ngày" },

  // ── XỬ LÝ CHIẾN DỊCH: phiên 7 bước từ phát hiện tới đo lại ──
  { label: "Xử lý chiến dịch", href: "/xu-ly", icon: Stethoscope, description: "Chiến dịch nào đang tiêu vượt mục tiêu, vì sao, và xử lý tới khi xong.", section: "Xử lý chiến dịch" },
  { label: "Theo dõi phiên", href: "/xu-ly/theo-doi", icon: ListChecks, description: "Mọi phiên đang mở, đang chờ đo lại, hoặc vừa mở lại vì đo lại không cải thiện.", section: "Xử lý chiến dịch" },
  { label: "Đã làm & kết quả", href: "/xu-ly/da-lam", icon: History, description: "Mọi thay đổi tool đã ghi lên Google / Meta và kết quả đo lại sau 7 và 14 ngày.", section: "Xử lý chiến dịch" },
  { label: "Sổ kinh nghiệm", href: "/so-kinh-nghiem", icon: BookOpenCheck, description: "Học từ những gì đã thắng 180 ngày qua — dùng lại khi tạo chiến dịch mới.", section: "Xử lý chiến dịch" },

  // ── GOOGLE ADS ──
  { label: "Google Search", href: "/google-search", icon: Search, roles: ADMIN_ROLES, description: "Bật/tắt, đổi ngân sách, chặn cụm đốt tiền, xem duyệt chính sách.", section: "Google Ads" },
  { label: "PMax Insights", href: "/google-pmax",   icon: PieChart, roles: ADMIN_ROLES, description: "Xếp hạng asset PMax, search categories, phân bổ kênh.", section: "Google Ads" },
  { label: "Google Audit",  href: "/google-audit",  icon: ShieldCheck, roles: ADMIN_ROLES, description: "14 tiêu chí chẩn đoán tài khoản Google Ads + tóm tắt AI.", section: "Google Ads" },

  // ── FACEBOOK / META ──
  { label: "Meta X-quang",  href: "/meta-xray",     icon: ScanLine, roles: ADMIN_ROLES, description: "Đơn Meta báo tách bấm thật vs chỉ xem, đối chiếu GA4, việc nên làm cho từng chiến dịch.", section: "Facebook / Meta" },
  { label: "So sánh tệp đối tượng", href: "/so-sanh-tep", icon: Scale, roles: ADMIN_ROLES, description: "So các nhóm quảng cáo Meta theo chi phí mỗi kết quả để chọn tệp thắng và lưu lại dùng cho lần tạo sau.", section: "Facebook / Meta" },
  { label: "Creative đơn thật", href: "/creative-don-that", icon: Target, roles: ADMIN_ROLES, description: "Mẫu quảng cáo nào thật sự ra đơn — chấm theo đơn đã thu tiền / lượt bấm, không theo số Meta tự báo.", section: "Facebook / Meta", module: "orders" },

  // ── ĐO LƯỜNG & ĐƠN THẬT: số có đáng tin không, đơn đã thu tiền về Google/Meta ──
  { label: "Sức khoẻ đo lường", href: "/do-luong", icon: HeartPulse, description: "Kiểm pixel/sự kiện chuyển đổi có bắn đúng trước khi đọc chi phí/đơn.", section: "Đo lường & đơn thật" },
  { label: "Doanh thu thật", href: "/revenue-attribution", icon: Receipt, roles: ADMIN_ROLES, description: "Đối chiếu chi quảng cáo với đơn hàng thật trong Odoo theo nhãn campaign.", section: "Đo lường & đơn thật", module: "matbao" },
  { label: "Attribution",    href: "/reports/attribution", icon: GitBranch, description: "Vai trò từng kênh trong hành trình chuyển đổi (Google + Meta).", section: "Đo lường & đơn thật" },

  // ── CHIẾN DỊCH & CREATIVE: xem / tạo ──
  { label: "Campaigns",      href: "/campaigns",     icon: Megaphone, description: "Bảng chiến dịch đầy đủ — chỉnh sửa, đồng bộ, export.", section: "Chiến dịch & Creative" },
  { label: "Ads Content",    href: "/campaigns/ads-content", icon: Images, description: "Creative đang chạy theo từng chiến dịch trong tháng.", section: "Chiến dịch & Creative" },
  { label: "Audiences",      href: "/audiences",     icon: Users,    roles: ADMIN_ROLES, description: "Tạo Custom Audience & Lookalike từ dữ liệu khách hàng.", section: "Chiến dịch & Creative" },
  {
    label: "Creative AI",
    href: "/creative",
    icon: Sparkles,
    roles: ADMIN_ROLES,
    description: "Tạo chiến dịch mới bằng AI — audience, ad copy, launch.",
    section: "Chiến dịch & Creative",
    children: [
      { label: "Creative Brief", href: "/creative/brief" },
    ],
  },
  { label: "Creative Library",href: "/creative/analysis", icon: Eye, roles: ADMIN_ROLES, description: "Thư viện creative đã lưu + chấm điểm nội dung (không phải phân tích ảnh/ad thật).", section: "Chiến dịch & Creative" },

  // ── TỐI ƯU & TỰ ĐỘNG ──
  { label: "Improvements",   href: "/improvements",  icon: Lightbulb, roles: ADMIN_ROLES, badge: "improvements", description: "Danh sách gợi ý tối ưu ưu tiên theo tác động, một số auto-apply được.", section: "Tối ưu & Tự động" },
  {
    label: "Automation",
    href: "/automation",
    icon: Zap,
    roles: ADMIN_ROLES,
    description: "Rule tự động Facebook + Google + tối ưu ngân sách theo lịch.",
    section: "Tối ưu & Tự động",
    children: [
      { label: "Budget Redistribution", href: "/automation/redistribution" },
    ],
  },
  {
    label: "Toolkit",
    href: "/toolkit",
    icon: Wrench,
    roles: ADMIN_ROLES,
    description: "Công cụ rời: N-Gram, Day-Parting, Budget Pacing, Quality Score, Cấu trúc nhóm QC, Phân khúc Bid.",
    section: "Tối ưu & Tự động",
    // Trang /toolkit chỉ là lưới thẻ lặp lại đúng các mục con bên dưới.
    hideRootLink: true,
    children: [
      { label: "N-Gram Finder",    href: "/toolkit/ngram" },
      { label: "Day-Parting",      href: "/toolkit/dayparting" },
      { label: "💰 Budget Pacing", href: "/toolkit/budget-pacing" },
      { label: "🎯 Quality Score", href: "/toolkit/quality-score" },
      { label: "🧩 Cấu trúc nhóm QC", href: "/toolkit/ad-group-structure" },
      { label: "📊 Phân khúc Bid", href: "/toolkit/segments" },
    ],
  },

  // ── BÁO CÁO & CHÍNH SÁCH ──
  { label: "Reports",        href: "/reports",       icon: BarChart2, description: "Báo cáo KPI + Odoo ERP, export PDF/Excel.", section: "Báo cáo & chính sách" },
  { label: "Radar Chính Sách", href: "/policy-radar", icon: Radar, description: "Cập nhật chính sách Google Ads + Meta, chấm mức ảnh hưởng và việc cần làm.", section: "Báo cáo & chính sách" },

  // ── (cuối, không tiêu đề) ──
  { label: "Hướng dẫn",     href: "/guide",          icon: BookOpen, description: "Giải thích từng tính năng trong app." },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    description: "Cấu hình tài khoản, ngân sách, KPI, nhóm, tracking.",
    children: [
      { label: "Quản lý Users", href: "/settings/users",          roles: ["super_admin"] },
      { label: "Ngân sách",     href: "/settings/budget" },
      { label: "Scheduled Jobs",href: "/settings/jobs",           roles: ["super_admin"] },
      { label: "Sức khoẻ tool", href: "/settings/health",         roles: ["super_admin"] },
      { label: "KPI",           href: "/settings/kpi" },
      { label: "Hồ sơ doanh nghiệp", href: "/settings/brand-profile" },
      { label: "Team",          href: "/settings/team",           roles: ["super_admin"] },
      { label: "Tracking",      href: "/settings/tracking" },
      // { label: "CPL Thresholds", href: "/settings/cpl-thresholds", roles: ["super_admin"] },
    ],
  },
];

// Menu thực tế = mảng trên trừ đi các trang đang tạm ẩn (lib/hidden-pages.ts).
// Lọc ở ĐÂY chứ không xoá từng dòng: components/ui/mobile-nav.tsx cũng import
// `navItems` từ file này, nên menu mobile tự ẩn theo, không phải nhớ sửa hai chỗ.
// Lọc CẢ mục con. Bản trước chỉ lọc mục cấp trên, nên một trang con nằm trong
// HIDDEN_PAGES vẫn hiện trong menu xổ xuống — đúng cái bẫy khiến người ta quay
// về kiểu xoá tay.
export const navItems: NavItem[] = ALL_NAV_ITEMS
  .filter(item => !isHiddenPage(item.href))
  .map(item => item.children
    ? { ...item, children: item.children.filter(c => !isHiddenPage(c.href)) }
    : item);

// Nhãn menu dịch theo href (dữ liệu navItems giữ nguyên tiếng Việt — test golden + mobile-nav dùng chung).
// Khoá: shell.nav.<slug> / shell.navdesc.<slug> / shell.navc.<slug>; thiếu khoá → dùng nhãn gốc.
export const navSlug = (href: string) => (href === "/" ? "dashboard" : href.replace(/^\/+/, "").replace(/\//g, "_"));
export const SECTION_KEYS: Record<string, MessageKey> = {
  "Hằng ngày": "shell.section.daily",
  "Xử lý chiến dịch": "shell.section.handling",
  "Google Ads": "shell.section.google",
  "Facebook / Meta": "shell.section.meta",
  "Đo lường & đơn thật": "shell.section.measure",
  "Chiến dịch & Creative": "shell.section.campaigns",
  "Tối ưu & Tự động": "shell.section.optimize",
  "Báo cáo & chính sách": "shell.section.reports",
};

export function useNavT() {
  const t = useT();
  const pick = (key: string, fallback: string) => {
    const s = t(key as MessageKey);
    return s === key ? fallback : s;
  };
  return {
    label: (item: { label: string; href: string }) => pick(`shell.nav.${navSlug(item.href)}`, item.label),
    description: (item: { label: string; href: string; description?: string }) =>
      item.description ? pick(`shell.navdesc.${navSlug(item.href)}`, item.description) : pick(`shell.nav.${navSlug(item.href)}`, item.label),
    child: (c: { label: string; href: string }) => pick(`shell.navc.${navSlug(c.href)}`, c.label),
    section: (s: string) => { const k = SECTION_KEYS[s]; return k ? t(k) : s; },
  };
}

// ─────────────────────────────────────────────
// Role badge
// ─────────────────────────────────────────────

const ROLE_BADGE: Record<Role, { label: string; color: string }> = {
  super_admin: { label: "Super Admin",  color: "bg-amber-500/20 text-amber-300" },
  admin_mbc:   { label: "Admin MBC",    color: "bg-blue-500/20 text-blue-300" },
  admin_mbi:   { label: "Admin MBI",    color: "bg-violet-500/20 text-violet-300" },
  viewer_mbc:  { label: "Viewer MBC",   color: "bg-slate-500/20 text-slate-300" },
  viewer_mbi:  { label: "Viewer MBI",   color: "bg-slate-500/20 text-slate-300" },
  admin:       { label: "Admin",        color: "bg-blue-500/20 text-blue-300" },
  viewer:      { label: "Viewer",       color: "bg-slate-500/20 text-slate-300" },
};

// ─────────────────────────────────────────────
// Google Accounts (for connectivity display)
// ─────────────────────────────────────────────

interface GoogleAccount {
  id: string;
  name: string;
  connected: boolean;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useSession();
  const t = useT();
  const nav = useNavT();
  // Keyed by item.href — generalized from the old settingsOpen/toolkitOpen
  // pair so any nav item with `children` (Creative AI, Automation, Toolkit,
  // Settings) gets independent expand/collapse state, not just the two
  // that happened to exist before.
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});
  const [improvementsCount, setImprovementsCount] = useState(0);
  const [connections, setConnections] = useState<{
    facebook: boolean;
    google: boolean;
    googleAccounts: GoogleAccount[];
  }>({
    facebook: false,
    google: false,
    googleAccounts: [],
  });

  useEffect(() => {
    fetch("/api/status")
      .then((res) => res.json())
      .then((data) =>
        setConnections({
          facebook: data.facebook ?? false,
          google: data.google ?? false,
          googleAccounts: data.googleAccounts ?? [],
        })
      )
      .catch(() => {});

    // Fetch improvements count for badge
    fetch("/api/improvements?company=ALL")
      .then((res) => res.json())
      .then((data) => setImprovementsCount(data.total ?? 0))
      .catch(() => {});
  }, []);

  // Auto-open whichever menu the current page belongs to
  useEffect(() => {
    const owner = navItems.find((item) => item.children && pathname.startsWith(item.href));
    if (owner) setOpenMenus((prev) => ({ ...prev, [owner.href]: true }));
  }, [pathname]);

  // Default to super_admin while session is loading so all nav items remain visible
  const userRole = user?.role || "super_admin";

  useCompaniesVersion(); // vẽ lại khi cấu hình bản cài (mô-đun) nạp xong
  const setup = useSetupFlags(); // Đợt 21 A6: mục "Thiết lập ban đầu" chỉ ở bản cài bật SETUP_WIZARD (không có ở bản Mắt Bão)
  function canSee(roles?: Role[]): boolean {
    if (!roles) return true;
    return roles.includes(userRole);
  }

  return (
    <aside
      className="hidden md:flex fixed inset-y-0 left-0 z-50 flex-col md:w-[64px] lg:w-[240px] transition-all duration-300 bg-sidebar"
    >
      {/* ---- Logo (60px) ---- */}
      <div className="flex h-[60px] shrink-0 items-center justify-center lg:justify-start border-b border-sidebar-border lg:px-5">
        <span className="text-[18px] font-bold text-sidebar-foreground tracking-tight flex items-center gap-2">
          <Zap size={18} className="text-sidebar-primary" strokeWidth={2.2} />
          <span className="hidden lg:block">AdsCommand</span>
        </span>
      </div>

      {/* ---- Navigation ---- */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {navItems.filter((item) => canSee(item.roles) && hasModule(item.module)).map((item, idx, visibleItems) => {
          // Compares against the previous VISIBLE item (not the previous
          // item in the full array) so a header still renders correctly
          // when role-based filtering hides a group's first item but not
          // a later one in the same section — a pure lookup via the
          // filtered array's own index, no render-time mutation.
          const showSectionHeader = !!item.section && item.section !== visibleItems[idx - 1]?.section;
          const sectionHeader = showSectionHeader ? (
            <p className="px-4 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/25 hidden lg:block">
              {nav.section(item.section!)}
            </p>
          ) : null;

          // Items with children (Settings, Toolkit, Creative AI, Automation)
          if (item.children) {
            const isActive = pathname.startsWith(item.href);
            const isOpen = openMenus[item.href] ?? false;
            const setOpen = (next: boolean) => setOpenMenus((prev) => ({ ...prev, [item.href]: next }));

            return (
              <div key={item.href}>
              {sectionHeader}
              <div className="relative group">
                <button
                  onClick={() => setOpen(!isOpen)}
                  title={nav.description(item)}
                  className={cn(
                    "flex w-full items-center justify-center lg:justify-start gap-3 rounded-lg md:px-0 lg:px-4 py-3 text-sm font-medium transition-colors duration-150 relative",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )}
                >
                  <item.icon size={20} strokeWidth={1.8} className="shrink-0" />
                  <span className="flex-1 text-left hidden lg:block">{nav.label(item)}</span>
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 text-sidebar-foreground/40 hidden lg:block" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-sidebar-foreground/40 hidden lg:block" />
                  )}
                </button>
                {/* Tooltip for tablet */}
                <span className="absolute left-full top-1/2 -translate-y-1/2 ml-2 hidden group-hover:md:block lg:hidden rounded bg-slate-800 px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none whitespace-nowrap">
                  {nav.label(item)}
                </span>

                <div className={cn("mt-0.5 space-y-0.5 border-sidebar-border", isOpen ? "block" : "hidden")}>
                  <div className="hidden lg:block ml-8 pl-3 border-l">
                    {/* Root link — the toggle button above only expands/collapses,
                        it doesn't navigate, so every item with children needs this
                        or its own root page is unreachable by click (this was the
                        actual bug behind Toolkit's landing page being orphaned). */}
                    {!item.hideRootLink && (
                      <Link
                        href={item.href}
                        className={cn(
                          "block rounded-md px-3 py-2 text-xs font-medium transition-colors",
                          pathname === item.href
                            ? "text-sidebar-foreground bg-sidebar-accent"
                            : "text-sidebar-foreground/50 hover:text-sidebar-foreground/80"
                        )}
                      >
                        {item.href === "/settings" ? t("shell.nav.general_settings") : t("shell.nav.overview", { name: nav.label(item) })}
                      </Link>
                    )}
                    {(item.href === "/settings" && setup.enabled ? [{ label: "Thiết lập ban đầu", href: "/setup", roles: ["super_admin"] as Role[] }, ...item.children] : item.children).map((child) => {
                      if (!canSee(child.roles) || !hasModule(moduleOfPage(child.href))) return null;
                      const isActive = pathname === child.href;
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={cn(
                            "block rounded-md px-3 py-2 text-xs font-medium transition-colors",
                            isActive
                              ? "text-sidebar-foreground bg-sidebar-accent"
                              : "text-sidebar-foreground/50 hover:text-sidebar-foreground/80"
                          )}
                        >
                          {nav.child(child)}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
              </div>
            );
          }

          // Normal nav item
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <div key={item.href}>
            {sectionHeader}
            <Link
              href={item.href}
              title={nav.description(item)}
              className={cn(
                "group relative flex items-center justify-center lg:justify-start gap-3 rounded-lg md:px-0 lg:px-4 py-3 text-sm font-medium transition-colors duration-150",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
            >
              <item.icon size={20} strokeWidth={1.8} className="shrink-0" />
              <span className="hidden lg:block">{nav.label(item)}</span>
              {/* Badge for improvements count */}
              {item.badge === "improvements" && improvementsCount > 0 && (
                <span className="ml-auto hidden lg:flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                  {improvementsCount}
                </span>
              )}
              {/* Tooltip for tablet */}
              <span className="absolute left-full top-1/2 -translate-y-1/2 ml-2 hidden group-hover:md:block lg:hidden rounded bg-slate-800 px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none whitespace-nowrap">
                {nav.label(item)}
              </span>
            </Link>
            </div>
          );
        })}
      </nav>

      {/* ---- Connection Status ---- */}
      <div className="shrink-0 border-t border-sidebar-border px-0 lg:px-5 py-3 space-y-4 lg:space-y-1.5 hidden md:block">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/25 mb-1 hidden lg:block">
          {t("shell.connections")}
        </p>
        <div className="flex items-center justify-center lg:justify-start gap-2" title="Facebook">
          <span className={cn("h-1.5 w-1.5 rounded-full", connections.facebook ? "bg-blue-500" : "bg-white/20")} />
          <span className="text-[11px] text-sidebar-foreground/40 hidden lg:block">Facebook</span>
          <span className="ml-auto text-[10px] hidden lg:block">
            {connections.facebook ? <span className="text-blue-400">{t("shell.connected")}</span> : <span className="text-sidebar-foreground/20">—</span>}
          </span>
        </div>
        <div className="flex items-center justify-center lg:justify-start gap-2" title="Google Ads">
          <span className={cn("h-1.5 w-1.5 rounded-full", connections.google ? "bg-red-500" : "bg-white/20")} />
          <span className="text-[11px] text-sidebar-foreground/40 hidden lg:block">Google Ads</span>
          <span className="ml-auto text-[10px] hidden lg:block">
            {connections.google ? <span className="text-green-400">{t("shell.connected")}</span> : <span className="text-sidebar-foreground/20">—</span>}
          </span>
        </div>
      </div>

      {/* ---- User Info + Logout ---- */}
      {user && (
        <div className="shrink-0 border-t border-sidebar-border px-0 lg:px-4 py-3">
          <div className="flex flex-col lg:flex-row items-center gap-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold bg-sidebar-primary text-sidebar-primary-foreground shrink-0"
              title={user.name}
            >
              {user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0 hidden lg:block">
              <p className="text-sm font-semibold text-white truncate">{user.name}</p>
              <span className={cn("inline-block px-1.5 py-0.5 rounded text-[9px] font-bold mt-0.5", ROLE_BADGE[userRole].color)}>
                {ROLE_BADGE[userRole].label}
              </span>
            </div>
            <Link
              href="/doi-mat-khau"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-sidebar-foreground/30 hover:text-sidebar-foreground/70 hover:bg-sidebar-accent transition-colors"
              title={t("shell.changePassword")}
            >
              <KeyRound size={14} />
            </Link>
            <button
              onClick={logout}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-sidebar-foreground/30 hover:text-sidebar-foreground/70 hover:bg-sidebar-accent transition-colors"
              title={t("shell.logout")}
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
