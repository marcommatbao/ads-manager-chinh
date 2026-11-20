"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Zap, Target, RefreshCw, History } from "lucide-react";
import { isHiddenPage } from "@/lib/hidden-pages";
import { useT } from "@/lib/i18n/client";

// Danh sách đầy đủ. Mục nào nằm trong lib/hidden-pages.ts sẽ bị lọc ở dưới —
// KHÔNG xoá dòng ở đây. Xoá tay là cách cũ, nó bỏ sót các link trong app.
const tabs = [
  { label: "Automation",      href: "/automation",                icon: Zap },
  { label: "Audience",        href: "/automation/audience",       icon: Target },
  { label: "Redistribution",  href: "/automation/redistribution", icon: RefreshCw },
  { label: "History",         href: "/automation/history",        icon: History },
].filter(t => !isHiddenPage(t.href));

export default function AutomationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const t = useT();

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm w-fit max-w-full">
        {tabs.map(({ label, href, icon: Icon }) => {
          const isActive =
            href === "/automation"
              ? pathname === "/automation"
              : pathname.startsWith(href);

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all",
                isActive
                  ? "bg-amber-500 text-amber-950 shadow-sm"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
        <Link href="/automation/decisions" className={cn("rounded-lg px-4 py-2 text-sm font-medium", pathname === "/automation/decisions" ? "bg-amber-500 text-amber-950" : "text-slate-500 hover:bg-slate-50")}>
          {t("overview.decisions.title")}
        </Link>
      </div>

      {/* Page Content */}
      {children}
    </div>
  );
}
