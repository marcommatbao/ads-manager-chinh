"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Shield,
  Wallet,
  DollarSign,
  Bell,
  Users,
  Activity,
  UserCog,
  Target,
  Timer,
  Bot,
  LineChart,
  HeartPulse, Building2 } from "lucide-react";

import { hasModule } from "@/lib/companies/registry";
import { moduleOfPage } from "@/lib/companies/modules";
import { useCompaniesVersion } from "@/lib/companies/use-companies";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

const tabs: { label: MessageKey; href: string; icon: typeof Shield }[] = [
  { label: "settings.tab.apiKeys",       href: "/settings",               icon: Shield },
  { label: "settings.tab.budget",      href: "/settings/budget",        icon: Wallet },
  { label: "settings.tab.revenue",      href: "/settings/revenue",       icon: DollarSign },
  { label: "settings.tab.kpi",            href: "/settings/kpi",           icon: Target },
  { label: "settings.tab.brandProfile", href: "/settings/brand-profile", icon: Building2 },
  { label: "settings.tab.manualSpend", href: "/settings/manual-spend", icon: Wallet },
  { label: "settings.tab.notifications",      href: "/settings/notifications", icon: Bell },
  { label: "settings.tab.team",           href: "/settings/team",          icon: Users },
  { label: "settings.tab.users",  href: "/settings/users",         icon: UserCog },
  { label: "settings.tab.tracking",       href: "/settings/tracking",      icon: Activity },
  { label: "settings.tab.jobs",      href: "/settings/jobs",          icon: Timer },
  { label: "settings.tab.health",  href: "/settings/health",        icon: HeartPulse },
  { label: "settings.tab.automation",     href: "/settings/automation",    icon: Bot },
  { label: "settings.tab.ga4",            href: "/settings/ga4",           icon: LineChart },
  { label: "settings.tab.claude",         href: "/settings/claude",        icon: Bot },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  useCompaniesVersion(); // Đợt 21 B: vẽ lại khi mô-đun của bản cài nạp xong

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t("settings.subtitle")}
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm overflow-x-auto">
        {tabs.filter(({ href }) => hasModule(moduleOfPage(href))).map(({ label, href, icon: Icon }) => { /* Đợt 21 B: ẩn tab thuộc mô-đun không bật */
          const isActive =
            href === "/settings"
              ? pathname === "/settings"
              : pathname.startsWith(href);

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-all",
                isActive
                  ? "bg-amber-500 text-amber-950 shadow-sm"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              )}
            >
              <Icon className="h-4 w-4" />
              {t(label)}
            </Link>
          );
        })}
      </div>

      {/* Page Content */}
      {children}
    </div>
  );
}
