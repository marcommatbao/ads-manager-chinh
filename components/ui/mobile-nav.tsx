"use client";

import { moduleOfPage } from "@/lib/companies/modules";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { Menu, Bell, LayoutDashboard, Megaphone, Target, Zap, BarChart2, Settings, X, LogOut, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { navItems, useNavT } from "@/components/Sidebar";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useT } from "@/lib/i18n/client";
import type { Role } from "@/lib/permissions";
import { hasModule } from "@/lib/companies/registry";

// ─────────────────────────────────────────────
// Shared Logic
// ─────────────────────────────────────────────

function useNotificationCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const fetchUnread = async () => {
      try {
        const res = await fetch("/api/notifications");
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            setCount(json.data.filter((n: any) => !n.is_read).length);
          }
        }
      } catch {
        // ignore
      }
    };
    fetchUnread();
    
    // Poll every 1 minute
    const interval = setInterval(fetchUnread, 60000);
    return () => clearInterval(interval);
  }, []);

  return count;
}

// ─────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────

export function MobileTopbar({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  const { user } = useSession();
  const unreadCount = useNotificationCount();

  return (
    <div className="flex lg:hidden h-[60px] items-center justify-between border-b bg-white px-4 shrink-0 shadow-sm sticky top-0 z-40">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenDrawer}
          className="p-2 -ml-2 text-slate-600 hover:text-slate-900 focus:outline-none"
        >
          <Menu className="h-6 w-6" />
        </button>
        <span className="text-[17px] font-bold text-slate-800 tracking-tight">
          ⚡ AdsCommand
        </span>
      </div>

      <div className="flex items-center gap-3">
        <LanguageSwitch />
        <Link href="/notifications" className="relative p-2 text-slate-600 hover:text-slate-900">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Link>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: "#0F172A" }}
        >
          {user?.name ? user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "A"}
        </div>
      </div>
    </div>
  );
}

export function MobileDrawer({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { user, logout } = useSession();
  const t = useT();
  const nav = useNavT();
  const pathname = usePathname();
  const userRole = user?.role || "super_admin";

  function canSee(roles?: Role[]): boolean {
    if (!roles) return true;
    return roles.includes(userRole);
  }

  // Handle body scroll locking
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm lg:hidden animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Drawer */}
      <div 
        className="fixed inset-y-0 left-0 z-50 w-72 bg-white flex flex-col shadow-2xl lg:hidden animate-in slide-in-from-left duration-200"
      >
        <div className="flex items-center justify-between h-[60px] px-5 border-b border-slate-100 shrink-0">
          <span className="text-[18px] font-bold text-slate-800 tracking-tight">
            ⚡ AdsCommand
          </span>
          <button onClick={onClose} className="p-2 -mr-2 text-slate-500 hover:text-slate-800 rounded-full">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((item) => {
            if (!canSee(item.roles) || !hasModule(item.module)) return null;

            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));

            if (item.children) {
              const hasVisibleChildren = item.children.some(c => canSee(c.roles));
              if (!hasVisibleChildren && item.children.length > 0) return null;
            }

            return (
              <div key={item.href}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 px-3 py-3 rounded-xl text-[15px] font-medium transition-colors",
                    isActive
                      ? "bg-amber-50 text-amber-800 font-semibold"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  )}
                >
                  <item.icon className={cn("h-5 w-5", isActive ? "text-amber-700" : "text-slate-500")} strokeWidth={isActive ? 2.2 : 1.8} />
                  <span className="flex-1">{nav.label(item)}</span>
                </Link>

                {/* Always expand settings on mobile for simplicity if active or has children */}
                {item.children && (
                  <div className="mt-1 ml-4 pl-4 border-l-2 border-slate-100 space-y-1">
                    {item.children.map(child => {
                      if (!canSee(child.roles) || !hasModule(moduleOfPage(child.href))) return null;
                      const isChildActive = pathname === child.href;
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onClose}
                          className={cn(
                            "block px-3 py-2.5 rounded-lg text-sm transition-colors",
                            isChildActive
                              ? "text-amber-800 font-semibold bg-amber-50/50"
                              : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                          )}
                        >
                          {nav.child(child)}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer info */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm" style={{ backgroundColor: "#0F172A" }}>
              {user?.name ? user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "A"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">{user?.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                <p className="text-xs text-slate-500 truncate">{user?.role?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</p>
              </div>
            </div>
          </div>
          <button
            onClick={() => { onClose(); logout(); }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm border border-slate-200 hover:bg-slate-50 active:bg-slate-100 transition-colors"
          >
            <LogOut className="h-4 w-4 text-slate-500" /> {t("shell.logout")}
          </button>
        </div>
      </div>
    </>
  );
}

export function BottomTabBar() {
  const t = useT();
  const pathname = usePathname();
  const unreadCount = useNotificationCount();

  const tabs = [
    { label: t("shell.tab.home"), href: "/", icon: LayoutDashboard },
    { label: t("shell.tab.campaigns"), href: "/campaigns", icon: Megaphone },
    { label: t("shell.tab.cpl"), href: "/cpl", icon: Target },
    { label: t("shell.tab.alerts"), href: "/notifications", icon: Bell, badge: unreadCount },
    { label: t("shell.tab.more"), href: "/options", icon: MoreHorizontal, isMenuTrigger: true },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 shadow-[0_-4px_12px_rgba(0,0,0,0.03)] lg:hidden pb-safe">
      <div className="flex items-center justify-around h-[64px] px-1">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;

          if (tab.isMenuTrigger) {
            // We'll let the More button trigger the drawer via context/state in a real app, 
            // but for simplicity, we can let the Topbar handle the drawer, and this can link to Settings
            return (
              <Link
                key={tab.label}
                href="/settings"
                className={cn(
                  "flex flex-col items-center justify-center w-full h-full gap-1 active:scale-95 transition-transform",
                  pathname.startsWith("/settings") ? "text-amber-700" : "text-slate-500"
                )}
              >
                <Settings className={cn("h-6 w-6", pathname.startsWith("/settings") && "fill-amber-100/50")} strokeWidth={pathname.startsWith("/settings") ? 2.5 : 2} />
                <span className="text-[10px] font-semibold">{tab.label}</span>
              </Link>
            )
          }

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "relative flex flex-col items-center justify-center w-full h-full gap-1 active:scale-95 transition-transform",
                isActive ? "text-amber-700" : "text-slate-500 hover:text-slate-700"
              )}
            >
              <div className="relative">
                <tab.icon className={cn("h-6 w-6", isActive && "fill-amber-100/50")} strokeWidth={isActive ? 2.5 : 2} />
                {!!tab.badge && tab.badge > 0 && (
                  <span className="absolute -top-1 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white shadow-sm ring-2 ring-white">
                    {tab.badge > 9 ? "9+" : tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-semibold">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
