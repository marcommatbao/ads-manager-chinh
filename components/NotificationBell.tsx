"use client";

import { useState, useEffect, useRef } from "react";
import { Bell, Check, CheckCheck, ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";

interface AlertItem {
  id: string;
  type: string;
  severity: "critical" | "warning" | "info";
  campaign_id: string;
  campaign_name: string;
  company: string;
  message: string;
  is_read: boolean;
  is_resolved: boolean;
  created_at: string;
  root_cause?: {
    likely_causes: string[];
    ai_generated: boolean;
  };
}

const CPL_ALERT_TYPES = new Set(["cpl_critical", "cpl_warning"]);

function timeAgo(dateStr: string, t: TFunction): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return t("panels.bell.justNow");
  if (mins < 60) return t("panels.bell.minAgo", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("panels.bell.hourAgo", { n: hours });
  const days = Math.floor(hours / 24);
  return t("panels.bell.dayAgo", { n: days });
}

const SEVERITY_ICON: Record<string, { dot: string; ringColor: string }> = {
  critical: { dot: "bg-red-500", ringColor: "ring-red-500" },
  warning: { dot: "bg-amber-500", ringColor: "ring-amber-500" },
  info: { dot: "bg-blue-500", ringColor: "ring-blue-500" },
};

export default function NotificationBell() {
  const t = useT();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchAlerts = async () => {
    try {
      const res = await fetch("/api/notifications?limit=8&resolved=false");
      const json = await res.json();
      if (json.success) {
        setAlerts(json.data);
        setUnreadCount(json.unread_count ?? 0);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchAlerts();
    // Poll every 60s
    const interval = setInterval(fetchAlerts, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleMarkAllRead = async () => {
    setLoading(true);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_all_read" }),
      });
      setUnreadCount(0);
      setAlerts((prev) => prev.map((a) => ({ ...a, is_read: true })));
    } finally {
      setLoading(false);
    }
  };

  const handleResolve = async (id: string) => {
    await fetch(`/api/notifications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resolve" }),
    });
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    setUnreadCount((prev) => Math.max(0, prev - 1));
  };

  const hasCritical = alerts.some((a) => a.severity === "critical" && !a.is_read);

  return (
    <div className="relative" ref={ref}>
      {/* Bell Button */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
          open
            ? "bg-slate-100 text-slate-700"
            : "text-slate-400 hover:bg-slate-100 hover:text-slate-600",
          hasCritical && "animate-pulse"
        )}
        aria-label={t("panels.bell.aria")}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-sm">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-[380px] rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              {t("panels.bell.title")}
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                disabled={loading}
                className="text-[11px] font-semibold text-amber-700 hover:text-amber-800 flex items-center gap-1"
              >
                <CheckCheck className="h-3 w-3" /> {t("panels.bell.markAll")}
              </button>
            )}
          </div>

          {/* Alert List */}
          <div className="max-h-[400px] overflow-y-auto divide-y divide-slate-100">
            {alerts.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm text-slate-400">{t("panels.bell.empty")}</p>
              </div>
            ) : (
              alerts.slice(0, 5).map((alert) => {
                const sev = SEVERITY_ICON[alert.severity] || SEVERITY_ICON.info;
                return (
                  <div
                    key={alert.id}
                    className={cn(
                      "px-4 py-3 hover:bg-slate-50 transition-colors",
                      !alert.is_read && "bg-blue-50/30"
                    )}
                  >
                    <div className="flex gap-3">
                      <div className={cn("h-2 w-2 rounded-full mt-1.5 shrink-0", sev.dot)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-700 leading-snug">
                          {alert.message}
                        </p>
                        {CPL_ALERT_TYPES.has(alert.type) && alert.root_cause?.likely_causes?.[0] && (
                          <p className="text-[11px] text-indigo-600 mt-1 leading-snug">
                            <span className="font-semibold">{t("panels.bell.why")}</span> {alert.root_cause.likely_causes[0]}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={cn(
                            "text-[10px] font-bold px-1.5 py-0.5 rounded",
                            alert.company === "MBC" ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700"
                          )}>
                            {alert.company}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {timeAgo(alert.created_at, t)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={() => handleResolve(alert.id)}
                            className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-0.5"
                          >
                            <Check className="h-3 w-3" /> {t("panels.bell.resolve")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-amber-700 hover:text-amber-800 flex items-center justify-center gap-1"
            >
              {t("panels.bell.viewAll")} <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
