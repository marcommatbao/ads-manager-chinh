"use client";

import { hasModule } from "@/lib/companies/registry";
import { moduleOfPage } from "@/lib/companies/modules";
import { useCompaniesVersion } from "@/lib/companies/use-companies";
import { useState, useEffect, useCallback } from "react";
import { isHiddenPage } from "@/lib/hidden-pages";
import {
  BookOpen, LayoutDashboard, Megaphone, Sparkles, Eye,
  Target, PieChart, ShieldCheck, Lightbulb, Zap, Wrench,
  Bell, Settings, ChevronDown, ChevronRight,
  CheckCircle2, AlertCircle, Info, ArrowRight, Search,
  Bot, DollarSign, Radar, Loader2,
  ListTodo, CalendarRange, Stethoscope, ListChecks, BookOpenCheck,
  ScanLine, HeartPulse, Images, Split,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/messages";
import { companyIds, companyLabel } from "@/lib/companies/registry";

// ─────────────────────────────────────────────
// Data
//
// Thứ tự + tên nhóm KHỚP đúng menu trái (components/Sidebar.tsx, trường `section`).
// Trang đang tạm ẩn (lib/hidden-pages.ts: Audiences, Doanh thu thật, Attribution,
// Reports, Google Audit, và các mục con N-Gram / Budget Pacing / Cấu trúc nhóm QC /
// Automation → Audience) KHÔNG được viết ở đây. Khi mở lại một trang: xoá dòng của nó
// trong lib/hidden-pages.ts, rồi thêm mục tương ứng vào nhóm bên dưới.
// ─────────────────────────────────────────────

interface Feature {
  id: string;
  label: string;
  href: string;
  icon: typeof BookOpen;
  color: string;
  badge?: string;
  /** Mục chỉ tài khoản Admin thấy trong menu (khớp `roles` ở Sidebar). */
  adminOnly?: boolean;
  /** 1 dòng "dùng cho việc gì" — hiện ở mục lục và ở đầu thẻ. */
  summary: string;
  /** "Dùng để làm gì" */
  description: string;
  /** "Khi nào dùng" */
  when?: string;
  /** "Các bước chính" */
  steps?: string[];
  tips?: string[];
  warnings?: string[];
  visual?: {
    title: string;
    items: { label: string; value: string; color?: string }[];
  };
}

interface FeatureGroup {
  id: string;
  label: string;
  intro: string;
  features: Feature[];
}

const buildGroups = (t: TFunction): FeatureGroup[] => [
  // ───────────── Dashboard ─────────────
  {
    id: "nhom-dashboard",
    label: t("creative.guide.g.nhom-dashboard.label"),
    intro: t("creative.guide.g.nhom-dashboard.intro"),
    features: [
      {
        id: "dashboard",
        label: t("creative.guide.f.dashboard.label"),
        href: "/",
        icon: LayoutDashboard,
        color: "from-slate-500 to-slate-700",
        summary: t("creative.guide.f.dashboard.summary"),
        description:
          t("creative.guide.f.dashboard.description"),
        when: t("creative.guide.f.dashboard.when"),
      },
      {
        id: "adsbot",
        label: t("creative.guide.f.adsbot.label"),
        href: "/",
        icon: Bot,
        color: "from-amber-500 to-orange-600",
        summary: t("creative.guide.f.adsbot.summary"),
        description:
          t("creative.guide.f.adsbot.description"),
        when: t("creative.guide.f.adsbot.when"),
        steps: [
          t("creative.guide.f.adsbot.steps.1"),
          t("creative.guide.f.adsbot.steps.2"),
          t("creative.guide.f.adsbot.steps.3"),
        ],
        tips: [t("creative.guide.f.adsbot.tips.1")],
      },
    ],
  },

  // ───────────── Hằng ngày ─────────────
  {
    id: "nhom-hang-ngay",
    label: t("creative.guide.g.nhom-hang-ngay.label"),
    intro: t("creative.guide.g.nhom-hang-ngay.intro"),
    features: [
      {
        id: "viec-hom-nay",
        label: t("creative.guide.f.viec-hom-nay.label"),
        href: "/viec-hom-nay",
        icon: ListTodo,
        color: "from-blue-500 to-indigo-600",
        summary: t("creative.guide.f.viec-hom-nay.summary"),
        description:
          t("creative.guide.f.viec-hom-nay.description"),
        when: t("creative.guide.f.viec-hom-nay.when"),
        steps: [
          t("creative.guide.f.viec-hom-nay.steps.1"),
          t("creative.guide.f.viec-hom-nay.steps.2"),
          t("creative.guide.f.viec-hom-nay.steps.3"),
          t("creative.guide.f.viec-hom-nay.steps.4"),
        ],
        tips: [
          t("creative.guide.f.viec-hom-nay.tips.1"),
        ],
        warnings: [
          t("creative.guide.f.viec-hom-nay.warnings.1"),
          t("creative.guide.f.viec-hom-nay.warnings.2"),
        ],
      },
      {
        id: "bao-cao-tuan",
        label: t("creative.guide.f.bao-cao-tuan.label"),
        href: "/bao-cao-tuan",
        icon: CalendarRange,
        color: "from-teal-500 to-emerald-700",
        summary: t("creative.guide.f.bao-cao-tuan.summary"),
        description:
          t("creative.guide.f.bao-cao-tuan.description"),
        when: t("creative.guide.f.bao-cao-tuan.when"),
        steps: [
          t("creative.guide.f.bao-cao-tuan.steps.1"),
          t("creative.guide.f.bao-cao-tuan.steps.2"),
          t("creative.guide.f.bao-cao-tuan.steps.3"),
        ],
      },
      {
        id: "notifications",
        label: t("creative.guide.f.notifications.label"),
        href: "/notifications",
        icon: Bell,
        color: "from-orange-500 to-red-600",
        summary: t("creative.guide.f.notifications.summary"),
        description:
          t("creative.guide.f.notifications.description"),
        when: t("creative.guide.f.notifications.when"),
      },
    ],
  },

  // ───────────── Xử lý chiến dịch ─────────────
  {
    id: "nhom-xu-ly-chien-dich",
    label: t("creative.guide.g.nhom-xu-ly-chien-dich.label"),
    intro: t("creative.guide.g.nhom-xu-ly-chien-dich.intro"),
    features: [
      {
        id: "xu-ly",
        label: t("creative.guide.f.xu-ly.label"),
        href: "/xu-ly",
        icon: Stethoscope,
        color: "from-rose-500 to-red-700",
        summary: t("creative.guide.f.xu-ly.summary"),
        description:
          t("creative.guide.f.xu-ly.description"),
        when: t("creative.guide.f.xu-ly.when"),
        steps: [
          t("creative.guide.f.xu-ly.steps.1"),
          t("creative.guide.f.xu-ly.steps.2"),
          t("creative.guide.f.xu-ly.steps.3"),
          t("creative.guide.f.xu-ly.steps.4"),
          t("creative.guide.f.xu-ly.steps.5"),
        ],
        warnings: [
          t("creative.guide.f.xu-ly.warnings.1"),
          t("creative.guide.f.xu-ly.warnings.2"),
          t("creative.guide.f.xu-ly.warnings.3"),
        ],
      },
      {
        id: "theo-doi",
        label: t("creative.guide.f.theo-doi.label"),
        href: "/xu-ly/theo-doi",
        icon: ListChecks,
        color: "from-sky-500 to-blue-700",
        summary: t("creative.guide.f.theo-doi.summary"),
        description:
          t("creative.guide.f.theo-doi.description"),
        when: t("creative.guide.f.theo-doi.when"),
        steps: [
          t("creative.guide.f.theo-doi.steps.1"),
          t("creative.guide.f.theo-doi.steps.2"),
        ],
        tips: [t("creative.guide.f.theo-doi.tips.1")],
      },
      {
        id: "so-kinh-nghiem",
        label: t("creative.guide.f.so-kinh-nghiem.label"),
        href: "/so-kinh-nghiem",
        icon: BookOpenCheck,
        color: "from-violet-500 to-purple-700",
        summary: t("creative.guide.f.so-kinh-nghiem.summary"),
        description:
          t("creative.guide.f.so-kinh-nghiem.description"),
        when: t("creative.guide.f.so-kinh-nghiem.when"),
        steps: [
          t("creative.guide.f.so-kinh-nghiem.steps.1"),
          t("creative.guide.f.so-kinh-nghiem.steps.2"),
          t("creative.guide.f.so-kinh-nghiem.steps.3"),
        ],
        tips: [
          t("creative.guide.f.so-kinh-nghiem.tips.1"),
        ],
      },
    ],
  },

  // ───────────── Google Ads ─────────────
  {
    id: "nhom-google-ads",
    label: t("creative.guide.g.nhom-google-ads.label"),
    intro: t("creative.guide.g.nhom-google-ads.intro"),
    features: [
      {
        id: "google-search",
        label: t("creative.guide.f.google-search.label"),
        href: "/google-search",
        icon: Search,
        color: "from-red-500 to-rose-700",
        adminOnly: true,
        summary: t("creative.guide.f.google-search.summary"),
        description:
          t("creative.guide.f.google-search.description"),
        when: t("creative.guide.f.google-search.when"),
        visual: {
          title: t("creative.guide.f.google-search.vis.title"),
          items: [
            { label: t("creative.guide.f.google-search.vis.1.label"), value: t("creative.guide.f.google-search.vis.1.value"), color: "text-red-600" },
            { label: t("creative.guide.f.google-search.vis.2.label"), value: t("creative.guide.f.google-search.vis.2.value"), color: "text-blue-600" },
            { label: t("creative.guide.f.google-search.vis.3.label"), value: t("creative.guide.f.google-search.vis.3.value"), color: "text-violet-600" },
            { label: t("creative.guide.f.google-search.vis.4.label"), value: t("creative.guide.f.google-search.vis.4.value"), color: "text-slate-600" },
          ],
        },
        steps: [
          t("creative.guide.f.google-search.steps.1"),
          t("creative.guide.f.google-search.steps.2"),
          t("creative.guide.f.google-search.steps.3"),
          t("creative.guide.f.google-search.steps.4"),
          t("creative.guide.f.google-search.steps.5"),
          t("creative.guide.f.google-search.steps.6"),
        ],
        tips: [
          t("creative.guide.f.google-search.tips.1"),
          t("creative.guide.f.google-search.tips.2"),
          t("creative.guide.f.google-search.tips.3"),
        ],
        warnings: [
          t("creative.guide.f.google-search.warnings.1"),
          t("creative.guide.f.google-search.warnings.2"),
        ],
      },
      {
        id: "search-split",
        label: t("creative.guide.f.search-split.label"),
        href: "/google-search",
        icon: Split,
        color: "from-orange-500 to-red-600",
        adminOnly: true,
        summary: t("creative.guide.f.search-split.summary"),
        description:
          t("creative.guide.f.search-split.description"),
        when: t("creative.guide.f.search-split.when"),
        visual: {
          title: t("creative.guide.f.search-split.vis.title"),
          items: [
            { label: t("creative.guide.f.search-split.vis.1.label"), value: t("creative.guide.f.search-split.vis.1.value") },
            { label: t("creative.guide.f.search-split.vis.2.label"), value: t("creative.guide.f.search-split.vis.2.value") },
            { label: t("creative.guide.f.search-split.vis.3.label"), value: t("creative.guide.f.search-split.vis.3.value") },
            { label: t("creative.guide.f.search-split.vis.4.label"), value: t("creative.guide.f.search-split.vis.4.value") },
          ],
        },
        steps: [
          t("creative.guide.f.search-split.steps.1"),
          t("creative.guide.f.search-split.steps.2"),
          t("creative.guide.f.search-split.steps.3"),
          t("creative.guide.f.search-split.steps.4"),
          t("creative.guide.f.search-split.steps.5"),
          t("creative.guide.f.search-split.steps.6"),
        ],
        tips: [
          t("creative.guide.f.search-split.tips.1"),
          t("creative.guide.f.search-split.tips.2"),
          t("creative.guide.f.search-split.tips.3"),
          t("creative.guide.f.search-split.tips.4"),
          t("creative.guide.f.search-split.tips.5"),
          t("creative.guide.f.search-split.tips.6"),
        ],
        warnings: [
          t("creative.guide.f.search-split.warnings.1"),
          t("creative.guide.f.search-split.warnings.2"),
          t("creative.guide.f.search-split.warnings.3"),
        ],
      },
      {
        id: "pmax",
        label: t("creative.guide.f.pmax.label"),
        href: "/google-pmax",
        icon: PieChart,
        color: "from-indigo-500 to-blue-700",
        adminOnly: true,
        summary: t("creative.guide.f.pmax.summary"),
        description:
          t("creative.guide.f.pmax.description"),
        when: t("creative.guide.f.pmax.when"),
        visual: {
          title: t("creative.guide.f.pmax.vis.title"),
          items: [
            { label: t("creative.guide.f.pmax.vis.1.label"), value: t("creative.guide.f.pmax.vis.1.value"), color: "text-blue-600" },
            { label: t("creative.guide.f.pmax.vis.2.label"), value: t("creative.guide.f.pmax.vis.2.value"), color: "text-red-600" },
            { label: t("creative.guide.f.pmax.vis.3.label"), value: t("creative.guide.f.pmax.vis.3.value"), color: "text-violet-600" },
            { label: t("creative.guide.f.pmax.vis.4.label"), value: t("creative.guide.f.pmax.vis.4.value"), color: "text-emerald-600" },
            { label: t("creative.guide.f.pmax.vis.5.label"), value: t("creative.guide.f.pmax.vis.5.value"), color: "text-amber-600" },
            { label: t("creative.guide.f.pmax.vis.6.label"), value: t("creative.guide.f.pmax.vis.6.value"), color: "text-slate-600" },
          ],
        },
        steps: [
          t("creative.guide.f.pmax.steps.1"),
          t("creative.guide.f.pmax.steps.2"),
          t("creative.guide.f.pmax.steps.3"),
          t("creative.guide.f.pmax.steps.4"),
        ],
        tips: [
          t("creative.guide.f.pmax.tips.1"),
          t("creative.guide.f.pmax.tips.2"),
        ],
        warnings: [t("creative.guide.f.pmax.warnings.1")],
      },
    ],
  },

  // ───────────── Facebook / Meta ─────────────
  {
    id: "nhom-facebook-meta",
    label: t("creative.guide.g.nhom-facebook-meta.label"),
    intro: t("creative.guide.g.nhom-facebook-meta.intro"),
    features: [
      {
        id: "meta-xray",
        label: t("creative.guide.f.meta-xray.label"),
        href: "/meta-xray",
        icon: ScanLine,
        color: "from-blue-500 to-indigo-700",
        adminOnly: true,
        summary: t("creative.guide.f.meta-xray.summary"),
        description:
          t("creative.guide.f.meta-xray.description"),
        when: t("creative.guide.f.meta-xray.when"),
        steps: [
          t("creative.guide.f.meta-xray.steps.1"),
          t("creative.guide.f.meta-xray.steps.2"),
          t("creative.guide.f.meta-xray.steps.3"),
        ],
      },
      {
        id: "creative-don-that",
        label: t("creative.guide.f.creative-don-that.label"),
        href: "/creative-don-that",
        icon: Target,
        color: "from-fuchsia-500 to-pink-700",
        adminOnly: true,
        summary: t("creative.guide.f.creative-don-that.summary"),
        description:
          t("creative.guide.f.creative-don-that.description"),
        when: t("creative.guide.f.creative-don-that.when"),
        steps: [
          t("creative.guide.f.creative-don-that.steps.1"),
          t("creative.guide.f.creative-don-that.steps.2"),
        ],
      },
    ],
  },

  // ───────────── Đo lường & đơn thật ─────────────
  {
    id: "nhom-do-luong",
    label: t("creative.guide.g.nhom-do-luong.label"),
    intro: t("creative.guide.g.nhom-do-luong.intro"),
    features: [
      {
        id: "do-luong",
        label: t("creative.guide.f.do-luong.label"),
        href: "/do-luong",
        icon: HeartPulse,
        color: "from-emerald-500 to-teal-700",
        summary: t("creative.guide.f.do-luong.summary"),
        description:
          t("creative.guide.f.do-luong.description"),
        when: t("creative.guide.f.do-luong.when"),
        visual: {
          title: t("creative.guide.f.do-luong.vis.title"),
          items: [
            { label: t("creative.guide.f.do-luong.vis.1.label"), value: t("creative.guide.f.do-luong.vis.1.value"), color: "text-blue-600" },
            { label: t("creative.guide.f.do-luong.vis.2.label"), value: t("creative.guide.f.do-luong.vis.2.value"), color: "text-slate-600" },
            { label: t("creative.guide.f.do-luong.vis.3.label"), value: t("creative.guide.f.do-luong.vis.3.value"), color: "text-red-600" },
            { label: t("creative.guide.f.do-luong.vis.4.label"), value: t("creative.guide.f.do-luong.vis.4.value"), color: "text-indigo-600" },
            { label: t("creative.guide.f.do-luong.vis.5.label"), value: t("creative.guide.f.do-luong.vis.5.value"), color: "text-emerald-600" },
          ],
        },
        steps: [
          t("creative.guide.f.do-luong.steps.1"),
          t("creative.guide.f.do-luong.steps.2"),
          t("creative.guide.f.do-luong.steps.3"),
          t("creative.guide.f.do-luong.steps.4"),
          t("creative.guide.f.do-luong.steps.5"),
          t("creative.guide.f.do-luong.steps.6"),
          t("creative.guide.f.do-luong.steps.7"),
        ],
        tips: [
          t("creative.guide.f.do-luong.tips.1"),
          t("creative.guide.f.do-luong.tips.2"),
          t("creative.guide.f.do-luong.tips.3"),
          t("creative.guide.f.do-luong.tips.4"),
          t("creative.guide.f.do-luong.tips.5"),
        ],
        warnings: [
          t("creative.guide.f.do-luong.warnings.1"),
          t("creative.guide.f.do-luong.warnings.2"),
          t("creative.guide.f.do-luong.warnings.3"),
          t("creative.guide.f.do-luong.warnings.4"),
          t("creative.guide.f.do-luong.warnings.5"),
        ],
      },
    ],
  },

  // ───────────── Chiến dịch & Creative ─────────────
  {
    id: "nhom-chien-dich-creative",
    label: t("creative.guide.g.nhom-chien-dich-creative.label"),
    intro: t("creative.guide.g.nhom-chien-dich-creative.intro"),
    features: [
      {
        id: "campaigns",
        label: t("creative.guide.f.campaigns.label"),
        href: "/campaigns",
        icon: Megaphone,
        color: "from-blue-500 to-blue-700",
        summary: t("creative.guide.f.campaigns.summary"),
        description:
          t("creative.guide.f.campaigns.description"),
        when: t("creative.guide.f.campaigns.when"),
      },
      {
        id: "ads-content",
        label: t("creative.guide.f.ads-content.label"),
        href: "/campaigns/ads-content",
        icon: Images,
        color: "from-cyan-500 to-sky-600",
        summary: t("creative.guide.f.ads-content.summary"),
        description: t("creative.guide.f.ads-content.description"),
        when: t("creative.guide.f.ads-content.when"),
      },
      {
        id: "creative",
        label: t("creative.guide.f.creative.label"),
        href: "/creative",
        icon: Sparkles,
        color: "from-violet-500 to-purple-700",
        adminOnly: true,
        summary: t("creative.guide.f.creative.summary"),
        description:
          t("creative.guide.f.creative.description"),
        when: t("creative.guide.f.creative.when"),
        tips: [
          t("creative.guide.f.creative.tips.1"),
          t("creative.guide.f.creative.tips.2"),
        ],
      },
      {
        id: "visual-analysis",
        label: t("creative.guide.f.visual-analysis.label"),
        href: "/creative/analysis",
        icon: Eye,
        color: "from-cyan-500 to-teal-600",
        adminOnly: true,
        summary: t("creative.guide.f.visual-analysis.summary"),
        description:
          t("creative.guide.f.visual-analysis.description"),
        when: t("creative.guide.f.visual-analysis.when"),
        steps: [
          t("creative.guide.f.visual-analysis.steps.1"),
          t("creative.guide.f.visual-analysis.steps.2"),
        ],
      },
    ],
  },

  // ───────────── Tối ưu & Tự động ─────────────
  {
    id: "nhom-toi-uu-tu-dong",
    label: t("creative.guide.g.nhom-toi-uu-tu-dong.label"),
    intro: t("creative.guide.g.nhom-toi-uu-tu-dong.intro"),
    features: [
      {
        id: "improvements",
        label: t("creative.guide.f.improvements.label"),
        href: "/improvements",
        icon: Lightbulb,
        color: "from-yellow-500 to-amber-600",
        adminOnly: true,
        badge: t("creative.guide.f.improvements.badge"),
        summary: t("creative.guide.f.improvements.summary"),
        description:
          t("creative.guide.f.improvements.description"),
        when: t("creative.guide.f.improvements.when"),
      },
      {
        id: "automation",
        label: t("creative.guide.f.automation.label"),
        href: "/automation",
        icon: Zap,
        color: "from-blue-500 to-indigo-700",
        adminOnly: true,
        summary: t("creative.guide.f.automation.summary"),
        description:
          t("creative.guide.f.automation.description"),
        when: t("creative.guide.f.automation.when"),
        steps: [
          t("creative.guide.f.automation.steps.1"),
          t("creative.guide.f.automation.steps.2"),
          t("creative.guide.f.automation.steps.3"),
        ],
        warnings: [t("creative.guide.f.automation.warnings.1")],
      },
      {
        id: "toolkit",
        label: t("creative.guide.f.toolkit.label"),
        href: "/toolkit",
        icon: Wrench,
        color: "from-slate-500 to-slate-700",
        adminOnly: true,
        summary: t("creative.guide.f.toolkit.summary"),
        description: t("creative.guide.f.toolkit.description"),
        when: t("creative.guide.f.toolkit.when"),
        visual: {
          title: t("creative.guide.f.toolkit.vis.title"),
          items: [
            { label: t("creative.guide.f.toolkit.vis.1.label"), value: t("creative.guide.f.toolkit.vis.1.value"), color: "text-violet-600" },
            { label: t("creative.guide.f.toolkit.vis.2.label"), value: t("creative.guide.f.toolkit.vis.2.value"), color: "text-amber-600" },
            { label: t("creative.guide.f.toolkit.vis.3.label"), value: t("creative.guide.f.toolkit.vis.3.value"), color: "text-blue-600" },
          ],
        },
      },
    ],
  },

  // ───────────── Báo cáo & chính sách ─────────────
  {
    id: "nhom-bao-cao-chinh-sach",
    label: t("creative.guide.g.nhom-bao-cao-chinh-sach.label"),
    intro: t("creative.guide.g.nhom-bao-cao-chinh-sach.intro"),
    features: [
      {
        id: "policy-radar",
        label: t("creative.guide.f.policy-radar.label"),
        href: "/policy-radar",
        icon: Radar,
        color: "from-sky-500 to-blue-700",
        summary: t("creative.guide.f.policy-radar.summary"),
        description:
          t("creative.guide.f.policy-radar.description"),
        when: t("creative.guide.f.policy-radar.when"),
      },
    ],
  },

  // ───────────── Cài đặt ─────────────
  {
    id: "nhom-cai-dat",
    label: t("creative.guide.g.nhom-cai-dat.label"),
    intro: t("creative.guide.g.nhom-cai-dat.intro"),
    features: [
      {
        id: "settings",
        label: t("creative.guide.f.settings.label"),
        href: "/settings",
        icon: Settings,
        color: "from-slate-600 to-slate-800",
        summary: t("creative.guide.f.settings.summary"),
        description:
          t("creative.guide.f.settings.description"),
        when: t("creative.guide.f.settings.when"),
        steps: [
          t("creative.guide.f.settings.steps.1"),
          t("creative.guide.f.settings.steps.2"),
          t("creative.guide.f.settings.steps.3"),
        ],
        tips: [
          t("creative.guide.f.settings.tips.1"),
          t("creative.guide.f.settings.tips.2"),
          t("creative.guide.f.settings.tips.3"),
        ],
        warnings: [
          t("creative.guide.f.settings.warnings.1"),
          t("creative.guide.f.settings.warnings.2"),
        ],
      },
    ],
  },
];

// ─────────────────────────────────────────────
// Chi phí vận hành (AI)
//
// Token hiển thị ở đây là số ĐÃ ĐO THẬT (lib/gemini-usage.ts ghi lại ngay sau
// mỗi lần gọi Gemini thành công) — không phải ước lượng. Đơn giá do NGƯỜI
// DÙNG tự nhập (giá thật họ xem ở Google Cloud Console của chính họ); app chỉ
// nhân đơn giá đó với token đã đo, tuyệt đối không tự bịa mức giá.
// ─────────────────────────────────────────────

// Rút từ grep thật `callGemini|generateWithTools|streamGeminiChat` trên toàn
// bộ app (20 file, 2026-09-18) — không phải danh sách suy đoán.
const GEMINI_FEATURES: MessageKey[] = [
  "creative.guide.gemini.1",
  "creative.guide.gemini.2",
  "creative.guide.gemini.3",
  "creative.guide.gemini.4",
  "creative.guide.gemini.5",
  "creative.guide.gemini.6",
  "creative.guide.gemini.7",
];
const FREE_FEATURES: MessageKey[] = [
  "creative.guide.free.1",
  "creative.guide.free.2",
  "creative.guide.free.3",
  "creative.guide.free.4",
];

function fmtInt(n: number, loc: string): string {
  return new Intl.NumberFormat(loc).format(Math.round(n));
}

interface CostData {
  settings: { inputPricePerMillion?: number; outputPricePerMillion?: number; currency?: "VND" | "USD" };
  usage: {
    firstRecordedAt: string | null;
    month: string;
    monthPromptTokens: number;
    monthCandidateTokens: number;
    monthCalls: number;
  };
  estimatedCost: number | null;
}

function AiCostSection() {
  const t = useT();
  const loc = useIntlLocale();
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [inputPrice, setInputPrice] = useState("");
  const [outputPrice, setOutputPrice] = useState("");
  const [currency, setCurrency] = useState<"VND" | "USD">("VND");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadCost = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/ai-cost");
      setData(res.ok ? await res.json() as CostData : null);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadCost(); }, [loadCost]);

  const startEdit = () => {
    setSaveError(null);
    setInputPrice(data?.settings.inputPricePerMillion !== undefined ? String(data.settings.inputPricePerMillion) : "");
    setOutputPrice(data?.settings.outputPricePerMillion !== undefined ? String(data.settings.outputPricePerMillion) : "");
    setCurrency(data?.settings.currency ?? "VND");
    setEditing(true);
  };

  const savePrice = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/settings/ai-cost", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputPricePerMillion: Number(inputPrice),
          outputPricePerMillion: Number(outputPrice),
          currency,
        }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && json.ok) { setEditing(false); await loadCost(); }
      else setSaveError(json.error ?? t("creative.guide.cost.saveFail"));
    } catch { setSaveError(t("creative.guide.cost.network")); }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
      </div>
    );
  }
  if (!data) return null;

  const { usage, estimatedCost, settings } = data;

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-6 space-y-4">
      <div className="flex items-center gap-2">
        <DollarSign className="h-5 w-5 text-emerald-600" />
        <h2 className="text-sm font-bold text-slate-800">{t("creative.guide.cost.title")}</h2>
      </div>

      {!usage.firstRecordedAt ? (
        <p className="text-xs text-slate-500 leading-relaxed">
          {t("creative.guide.cost.noData")}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-semibold uppercase text-slate-400">{t("creative.guide.cost.tokenMonth", { month: usage.month })}</p>
            <p className="text-lg font-bold text-slate-800 mt-1">
              {fmtInt(usage.monthPromptTokens + usage.monthCandidateTokens, loc)}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">{t("creative.guide.cost.calls", { n: fmtInt(usage.monthCalls, loc) })}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-semibold uppercase text-slate-400">{t("creative.guide.cost.tokensInOut")}</p>
            <p className="text-sm font-semibold text-slate-700 mt-1">
              {fmtInt(usage.monthPromptTokens, loc)} / {fmtInt(usage.monthCandidateTokens, loc)}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">{t("creative.guide.cost.inOutNote")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-semibold uppercase text-slate-400">{t("creative.guide.cost.estMonth")}</p>
            <p className="text-lg font-bold text-emerald-700 mt-1">
              {estimatedCost !== null ? `${fmtInt(estimatedCost, loc)} ${settings.currency ?? "VND"}` : "—"}
            </p>
            {estimatedCost === null && <p className="text-[10px] text-amber-600 mt-0.5">{t("creative.guide.cost.noPrice")}</p>}
          </div>
        </div>
      )}

      {editing ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-700">{t("creative.guide.cost.priceHeading")}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-500">
              {t("creative.guide.cost.inputPrice")}
              <input type="number" min="0" step="0.01" value={inputPrice} onChange={(e) => setInputPrice(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </label>
            <label className="text-xs text-slate-500">
              {t("creative.guide.cost.outputPrice")}
              <input type="number" min="0" step="0.01" value={outputPrice} onChange={(e) => setOutputPrice(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <select value={currency} onChange={(e) => setCurrency(e.target.value === "USD" ? "USD" : "VND")}
              className="rounded border border-slate-200 px-2 py-1.5 text-xs">
              <option value="VND">VND</option>
              <option value="USD">USD</option>
            </select>
            <button onClick={savePrice} disabled={saving || !inputPrice || !outputPrice}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              {saving && <Loader2 className="h-3 w-3 animate-spin" />} {t("creative.guide.cost.savePrice")}
            </button>
            <button onClick={() => setEditing(false)} className="text-xs text-slate-400 hover:text-slate-600">{t("creative.guide.cost.cancel")}</button>
          </div>
          {saveError && <p className="text-xs text-red-600">{saveError}</p>}
        </div>
      ) : (
        <button onClick={startEdit} className="text-xs font-medium text-emerald-700 hover:text-emerald-800 underline underline-offset-2">
          {settings.inputPricePerMillion !== undefined ? t("creative.guide.cost.editPrice") : t("creative.guide.cost.enterPrice")}
        </button>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-emerald-100">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{t("creative.guide.cost.aiFeatures")}</p>
          <ul className="space-y-1">
            {GEMINI_FEATURES.map((f) => (
              <li key={f} className="text-xs text-slate-600 flex gap-1.5">
                <span className="text-amber-500 shrink-0">•</span>{t(f)}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{t("creative.guide.cost.freeFeatures")}</p>
          <ul className="space-y-1">
            {FREE_FEATURES.map((f) => (
              <li key={f} className="text-xs text-slate-600 flex gap-1.5">
                <span className="text-emerald-500 shrink-0">•</span>{t(f)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="text-[10px] text-slate-400 leading-relaxed">
        {t("creative.guide.cost.footnote")}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────
// Role permissions table
// ─────────────────────────────────────────────

const ROLES: { role: string; color: string; access: MessageKey }[] = [
  {
    role: "Super Admin",
    color: "bg-amber-100 text-amber-800 border-amber-200",
    access: "creative.guide.roles.superAdmin",
  },
  {
    role: "Admin MBC",
    color: "bg-blue-100 text-blue-800 border-blue-200",
    access: "creative.guide.roles.adminMbc",
  },
  {
    role: "Admin MBI",
    color: "bg-violet-100 text-violet-800 border-violet-200",
    access: "creative.guide.roles.adminMbi",
  },
  {
    role: "Viewer MBC",
    color: "bg-slate-100 text-slate-700 border-slate-200",
    access: "creative.guide.roles.viewerMbc",
  },
  {
    role: "Viewer MBI",
    color: "bg-slate-100 text-slate-700 border-slate-200",
    access: "creative.guide.roles.viewerMbi",
  },
];

// Đợt 25: hướng dẫn theo bản cài — "MBC / MBI" trong chữ đổi thành công ty của bản cài; vai trò theo công ty chỉ hiện khi bản
// cài có công ty đó (bản khách: Admin / Viewer chung). Bản Mắt Bão: chữ y nguyên.
function coText(s: string): string {
  const ids = companyIds()
  if (ids.includes("MBC") && ids.includes("MBI")) return s
  const list = ids.map(companyLabel).join(" / ")
  return s.replace(/MBC\s*\/\s*MBI|MBC hoặc MBI|MBC or MBI/g, list).replace(/\((?:hiện )?chỉ MBI[^)]*\)|\((?:currently )?only MBI[^)]*\)/g, "")
}
function rolesForInstall(): { role: string; color: string; access: MessageKey }[] {
  const ids = companyIds()
  const keep = ROLES.filter((r) => !/MBC$/.test(r.role) || ids.includes("MBC")).filter((r) => !/MBI$/.test(r.role) || ids.includes("MBI"))
  if (ids.includes("MBC") || ids.includes("MBI")) return keep
  return [
    ...keep,
    { role: "Admin", color: "bg-blue-100 text-blue-800 border-blue-200", access: "creative.guide.roles.adminGeneric" },
    { role: "Viewer", color: "bg-slate-100 text-slate-700 border-slate-200", access: "creative.guide.roles.viewerGeneric" },
  ]
}

// ─────────────────────────────────────────────
// Feature Card
// ─────────────────────────────────────────────

function FeatureCard({ feature }: { feature: Feature }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <div className={cn(
      "rounded-2xl border transition-all duration-200",
      open ? "border-slate-300 shadow-md" : "border-slate-200 hover:border-slate-300 hover:shadow-sm"
    )}>
      {/* Header — always visible */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-4 p-5 text-left"
      >
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow", feature.color)}>
          <feature.icon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-slate-900">{feature.label}</h3>
            {feature.badge && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-600">
                {feature.badge}
              </span>
            )}
            {feature.adminOnly && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                {t("creative.guide.card.adminOnly")}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{feature.summary}</p>
        </div>
        <div className="shrink-0 text-slate-400">
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </div>
      </button>

      {/* Expanded content */}
      {open && (
        <div className="border-t border-slate-100 px-5 pb-6 pt-4 space-y-4">
          {/* Dùng để làm gì */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t("creative.guide.card.what")}</p>
            <p className="text-sm text-slate-600 leading-relaxed">{coText(feature.description)}</p>
          </div>

          {/* Khi nào dùng */}
          {feature.when && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t("creative.guide.card.when")}</p>
              <p className="text-sm text-slate-600 leading-relaxed">{feature.when}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Visual breakdown */}
            {feature.visual && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                  {feature.visual.title}
                </p>
                <ul className="space-y-2">
                  {feature.visual.items.map((item, i) => (
                    <li key={i} className="flex gap-2 text-xs">
                      <ArrowRight size={12} className={cn("mt-0.5 shrink-0", item.color ?? "text-slate-400")} />
                      <span>
                        <strong className="text-slate-700">{item.label}:</strong>{" "}
                        <span className="text-slate-500">{item.value}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Steps */}
            {feature.steps && (
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-3">
                  {t("creative.guide.card.steps")}
                </p>
                <ol className="space-y-2">
                  {feature.steps.map((step, i) => (
                    <li key={i} className="flex gap-2 text-xs text-slate-600">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold text-white mt-0.5">
                        {i + 1}
                      </span>
                      {coText(step)}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          {/* Tips */}
          {feature.tips && (
            <div className="space-y-1.5">
              {feature.tips.map((tip, i) => (
                <div key={i} className="flex gap-2 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs text-emerald-700">
                  <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-emerald-500" />
                  {coText(tip)}
                </div>
              ))}
            </div>
          )}

          {/* Warnings */}
          {feature.warnings && (
            <div className="space-y-1.5">
              {feature.warnings.map((w, i) => (
                <div key={i} className="flex gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-700">
                  <AlertCircle size={13} className="shrink-0 mt-0.5 text-amber-500" />
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* Link to feature */}
          <div className="pt-1">
            <a
              href={feature.href}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors"
            >
              {t("creative.guide.card.open")} <ArrowRight size={12} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

// Tính năng thực sự hiện ra = bỏ mục trỏ tới trang đang tạm ẩn (lib/hidden-pages.ts)
// — cùng một nguồn với menu, để trang Hướng dẫn không đi giới thiệu một trang
// không vào được. Nhóm nào rỗng sau khi lọc thì bỏ luôn.
// Đợt 21 A2: bỏ cả mục thuộc mô-đun đang TẮT ở bản cài (tính trong component — cấu hình nạp sau lần vẽ đầu).
const visibleGroups = (t: TFunction): FeatureGroup[] => buildGroups(t)
  .map((g) => ({ ...g, features: g.features.filter((f) => !isHiddenPage(f.href) && hasModule(moduleOfPage(f.href))) }))
  .filter((g) => g.features.length > 0);

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function GuidePage() {
  const t = useT();
  useCompaniesVersion();
  const VISIBLE_GROUPS = visibleGroups(t);
  const VISIBLE_FEATURES = VISIBLE_GROUPS.flatMap((g) => g.features);
  const [search, setSearch] = useState("");

  const q = search.toLowerCase();
  const matches = (f: Feature) =>
    q === "" ||
    f.label.toLowerCase().includes(q) ||
    f.summary.toLowerCase().includes(q) ||
    f.description.toLowerCase().includes(q) ||
    (f.when ?? "").toLowerCase().includes(q);
  const filteredGroups = VISIBLE_GROUPS
    .map((g) => ({ ...g, features: g.features.filter(matches) }))
    .filter((g) => g.features.length > 0);
  const filteredCount = filteredGroups.reduce((n, g) => n + g.features.length, 0);

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* ── Header ── */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 p-8 text-white">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 backdrop-blur">
            <BookOpen className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t("creative.guide.page.title")}</h1>
            <p className="text-sm text-white/60">{t("creative.guide.page.version")}</p>
          </div>
        </div>
        <p className="text-sm text-white/70 leading-relaxed max-w-2xl">
          {t("creative.guide.page.intro")}
        </p>

        {/* Stats */}
        <div className="mt-5 grid grid-cols-3 gap-3 max-w-sm">
          {[
            { label: t("creative.guide.page.statFeatures"), value: String(VISIBLE_FEATURES.length) },
            { label: t("creative.guide.page.statPlatform"), value: "Meta + Google" },
            { label: t("creative.guide.page.statModel"), value: "Gemini" },
          ].map((s) => (
            <div key={s.label} className="rounded-lg bg-white/10 px-3 py-2">
              <p className="text-lg font-bold">{s.value}</p>
              <p className="text-[10px] text-white/50 uppercase tracking-wide">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Hướng dẫn kết nối ── */}
      <a
        href="/guide/ket-noi"
        className="flex items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-5 hover:border-amber-300 hover:bg-amber-50 transition-colors"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow">
          <BookOpen size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-slate-900">{t("creative.guide.page.connectTitle")}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{t("creative.guide.page.connectDesc")}</p>
        </div>
        <ArrowRight size={16} className="shrink-0 text-amber-600" />
      </a>

      <AiCostSection />

      {/* ── Search ── */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder={t("creative.guide.page.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent shadow-sm"
        />
      </div>

      {/* ── Mục lục theo nhóm menu ── */}
      {search === "" && (
        <nav aria-label={t("creative.guide.page.tocAria")} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">
            {t("creative.guide.page.tocTitle")}
          </p>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
            {VISIBLE_GROUPS.map((g) => (
              <div key={g.id}>
                <a
                  href={`#${g.id}`}
                  onClick={(e) => { e.preventDefault(); scrollToId(g.id); }}
                  className="text-sm font-bold text-slate-800 hover:text-amber-700"
                >
                  {g.label}
                </a>
                <ul className="mt-1.5 space-y-1">
                  {g.features.map((f) => (
                    <li key={f.id}>
                      <a
                        href={`#${f.id}`}
                        onClick={(e) => { e.preventDefault(); scrollToId(f.id); }}
                        className="group flex gap-1.5 text-xs leading-snug"
                      >
                        <f.icon size={12} className="mt-0.5 shrink-0 text-slate-400 group-hover:text-amber-600" />
                        <span>
                          <span className="font-semibold text-slate-700 group-hover:text-amber-700">{f.label}</span>
                          <span className="text-slate-500"> — {f.summary}</span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>
      )}

      {/* ── Danh sách theo nhóm ── */}
      <div className="space-y-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          {t("creative.guide.page.count", { n: filteredCount })} {search ? t("creative.guide.page.match", { q: search }) : ""}
        </p>
        {filteredGroups.map((g) => (
          <section key={g.id} id={g.id} className="space-y-3 scroll-mt-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">{g.label}</h2>
              <p className="text-xs text-slate-500">{coText(g.intro)}</p>
            </div>
            {g.features.map((f) => (
              <div key={f.id} id={f.id} className="scroll-mt-4">
                <FeatureCard feature={f} />
              </div>
            ))}
          </section>
        ))}
        {filteredCount === 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-10 text-center">
            <Info className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">{t("creative.guide.page.noMatch")}</p>
          </div>
        )}
      </div>

      {/* ── Roles & Permissions ── */}
      {search === "" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            {t("creative.guide.page.rolesTitle")}
          </h2>
          <div className="space-y-2">
            {rolesForInstall().map((r) => (
              <div key={r.role} className="flex items-start gap-3 rounded-lg border border-slate-100 p-3">
                <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-bold shrink-0", r.color)}>
                  {r.role}
                </span>
                <p className="text-xs text-slate-500 leading-relaxed">{t(r.access)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Quick Tips ── */}
      {search === "" && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-6">
          <h2 className="text-sm font-bold text-blue-800 mb-4 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-blue-500" />
            {t("creative.guide.page.quickTitle")}
          </h2>
          <ul className="space-y-2.5">
            {([
              "creative.guide.quick.1",
              "creative.guide.quick.2",
              "creative.guide.quick.3",
              "creative.guide.quick.4",
              "creative.guide.quick.5",
              "creative.guide.quick.6",
            ] as MessageKey[]).map((tip, i) => (
              <li key={i} className="flex gap-2 text-xs text-blue-700">
                <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-blue-400" />
                {coText(t(tip))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
