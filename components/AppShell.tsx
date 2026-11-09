"use client";

import { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import NotificationBell from "@/components/NotificationBell";
import AIChatbot from "@/components/AIChatbot";
import { MobileTopbar, MobileDrawer, BottomTabBar } from "@/components/ui/mobile-nav";
import { useSession } from "@/components/SessionProvider";
import { ToastProvider } from "@/components/Toast";
import { useAdsStore } from "@/store/useAdsStore";
import { usePathname } from "next/navigation";
import { ChevronDown, LogOut, User } from "lucide-react";
import type { Platform } from "@/types/ads.types";
import { cn } from "@/lib/utils";
import { CompaniesBoot } from "@/components/CompaniesBoot";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

const PAGE_TITLES: Record<string, MessageKey> = {
  "/":           "shell.page.dashboard",
  "/campaigns":  "shell.page.campaigns",
  "/creative":   "shell.page.creative",
  "/automation": "shell.page.automation",
  "/reports":    "shell.page.reports",
  "/settings":   "shell.page.settings",
};

interface GoogleAccount {
  id: string;
  name: string;
  connected: boolean;
}

function AvatarMenu() {
  const { user, logout } = useSession();
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const initials = user?.name
    ? user.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : "AD";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white hover:opacity-80 transition-opacity cursor-pointer"
        style={{ backgroundColor: "#0F172A" }}
        title={user?.name || t("shell.user")}
      >
        {initials}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-52 rounded-xl border border-slate-200 bg-white shadow-lg py-1 animate-fade-in">
          {/* User info */}
          <div className="px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white shrink-0" style={{ backgroundColor: "#0F172A" }}>
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800 truncate">{user?.name || t("shell.user")}</p>
                <p className="text-[10px] text-slate-400 truncate">{user?.email || ""}</p>
              </div>
            </div>
          </div>

          {/* Profile link */}
          <button
            className="flex w-full items-center gap-2 px-4 py-2 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
            onClick={() => { setOpen(false); window.location.href = "/settings"; }}
          >
            <User className="h-3.5 w-3.5 text-slate-400" />
            {t("shell.accountSettings")}
          </button>

          {/* Logout */}
          <button
            className="flex w-full items-center gap-2 px-4 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors"
            onClick={() => { setOpen(false); logout(); }}
          >
            <LogOut className="h-3.5 w-3.5" />
            {t("shell.logout")}
          </button>
        </div>
      )}
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useT();
  const { user } = useSession();
  const { selectedPlatform, setSelectedPlatform, selectedGoogleAccount, setSelectedGoogleAccount } = useAdsStore();

  const [googleAccounts, setGoogleAccounts] = useState<GoogleAccount[]>([]);
  const [googleDropdownOpen, setGoogleDropdownOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch Google accounts for the dropdown
  useEffect(() => {
    fetch("/api/status")
      .then(res => res.json())
      .then(data => setGoogleAccounts(data.googleAccounts ?? []))
      .catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setGoogleDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const pageTitle = PAGE_TITLES[pathname] ? t(PAGE_TITLES[pathname]) : "AdsCommand";

  const handlePlatformClick = (value: Platform) => {
    if (value === "google" && googleAccounts.length > 0) {
      // Toggle dropdown instead of immediately selecting
      setGoogleDropdownOpen(prev => !prev);
    } else {
      setSelectedPlatform(value);
      setSelectedGoogleAccount(null);
      setGoogleDropdownOpen(false);
    }
  };

  const handleGoogleAccountSelect = (accountId: string | null) => {
    setSelectedPlatform("google");
    setSelectedGoogleAccount(accountId);
    setGoogleDropdownOpen(false);
  };

  const googleLabel = (() => {
    if (selectedPlatform !== "google") return "Google";
    if (!selectedGoogleAccount) return "Google";
    const account = googleAccounts.find(a => a.id === selectedGoogleAccount);
    return account ? account.name : "Google";
  })();

  return (
    // ToastProvider hosts the one toast container for every dashboard page.
    // Components that raise toasts (CampaignTable, EditBudgetModal,
    // EditRsaModal, dayparting, competitors…) used to each hold their own
    // isolated toast list with nothing rendering it.
    <ToastProvider>
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar — hidden on mobile, 64px on tablet, 240px on desktop */}
      <Sidebar />

      {/* Mobile Drawer */}
      <MobileDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* Right column */}
      <div className="flex flex-1 flex-col overflow-hidden md:ml-[64px] lg:ml-[240px]">

        {/* ── Topbar (Mobile) ── */}
        <MobileTopbar onOpenDrawer={() => setDrawerOpen(true)} />

        {/* ── Top Header Bar (Desktop & Tablet) ── */}
        <header className="hidden md:flex h-[60px] shrink-0 items-center justify-between border-b bg-white px-6 shadow-sm">

          {/* Left: page title */}
          <h1 className="text-[15px] font-semibold text-slate-800">
            {pageTitle}
          </h1>

          {/* Center: platform filter tabs */}
          <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1">
            {/* All */}
            <button
              onClick={() => handlePlatformClick("all")}
              className={cn(
                "rounded-full px-4 py-1 text-sm font-medium transition-colors duration-150",
                selectedPlatform === "all"
                  ? "bg-amber-500 text-amber-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              {t("shell.platform.all")}
            </button>

            {/* Facebook */}
            <button
              onClick={() => handlePlatformClick("facebook")}
              className={cn(
                "rounded-full px-4 py-1 text-sm font-medium transition-colors duration-150",
                selectedPlatform === "facebook"
                  ? "bg-amber-500 text-amber-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              Facebook
            </button>

            {/* Google with dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => handlePlatformClick("google")}
                className={cn(
                  "flex items-center gap-1 rounded-full px-4 py-1 text-sm font-medium transition-colors duration-150",
                  selectedPlatform === "google"
                    ? "bg-amber-500 text-amber-950 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                )}
              >
                {googleLabel}
                {googleAccounts.length > 0 && (
                  <ChevronDown className={cn("h-3 w-3 transition-transform", googleDropdownOpen && "rotate-180")} />
                )}
              </button>

              {/* Dropdown */}
              {googleDropdownOpen && googleAccounts.length > 0 && (
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  <button
                    onClick={() => handleGoogleAccountSelect(null)}
                    className={cn(
                      "w-full text-left px-4 py-2 text-sm hover:bg-slate-50 transition-colors",
                      selectedPlatform === "google" && !selectedGoogleAccount
                        ? "text-amber-700 font-medium bg-amber-50/50"
                        : "text-slate-700"
                    )}
                  >
                    {t("shell.allGoogleAds")}
                  </button>
                  <div className="border-t border-slate-100 my-0.5" />
                  {googleAccounts.map(account => (
                    <button
                      key={account.id}
                      onClick={() => handleGoogleAccountSelect(account.id)}
                      className={cn(
                        "w-full text-left px-4 py-2 text-sm hover:bg-slate-50 transition-colors flex items-center gap-2",
                        selectedGoogleAccount === account.id
                          ? "text-amber-700 font-medium bg-amber-50/50"
                          : "text-slate-700"
                      )}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-green-400 shrink-0" />
                      {account.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: notification bell + avatar */}
          <div className="flex items-center gap-3">
            <LanguageSwitch />
            <NotificationBell />

            {/* Avatar with dropdown */}
            <AvatarMenu />
          </div>
        </header>

        {/* ── Page Content ── */}
        {/* pb clears bottom nav (--nav-h 4rem) + FAB (3rem) + gaps + safe area.
            Desktop lg+: no bottom nav, simple pb-6. */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-[calc(8rem+env(safe-area-inset-bottom))] lg:pb-6">
          <CompaniesBoot>{children}</CompaniesBoot>
        </main>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <BottomTabBar />

      {/* AI Chatbot — floating on all pages */}
      <AIChatbot />
    </div>
    </ToastProvider>
  );
}
