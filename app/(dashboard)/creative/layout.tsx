"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Sparkles, FileText } from "lucide-react";

const tabs = [
  { label: "Creative AI", href: "/creative",          icon: Sparkles },
  { label: "AI Ad Copy",  href: "/creative/ad-copy",  icon: FileText },
];

export default function CreativeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm w-fit">
        {tabs.map(({ label, href, icon: Icon }) => {
          const isActive =
            href === "/creative"
              ? pathname === "/creative"
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
      </div>

      {/* Page Content */}
      {children}
    </div>
  );
}
