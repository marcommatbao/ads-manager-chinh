"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users,
  ArrowRight,
  Loader2,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ROLE_CONFIG } from "@/lib/permissions";
import type { Role } from "@/lib/permissions";
import type { MemberStatus, CompanyAccess } from "@/lib/team";
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  company_access: CompanyAccess[];
  last_active: string;
  last_login?: string;
  status: MemberStatus;
}

// ─────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────

const fetcher = (url: string) =>
  fetch(url)
    .then((r) => r.json())
    .then((d) => {
      if (!d.success) throw new Error(d.error ?? "API error");
      return d.data as SafeUser[];
    });

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function formatRelative(iso: string, t: TFunction): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return t("creative.settingsTeam.rel.min", { n: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t("creative.settingsTeam.rel.hour", { n: hrs });
    const days = Math.floor(hrs / 24);
    return t("creative.settingsTeam.rel.day", { n: days });
  } catch {
    return iso;
  }
}

// ─────────────────────────────────────────────
// Role Badge
// ─────────────────────────────────────────────

function RoleBadge({ role }: { role: Role }) {
  const cfg = ROLE_CONFIG[role];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold",
        cfg.color,
        cfg.bg,
        cfg.border
      )}
    >
      {cfg.label}
    </span>
  );
}

// ─────────────────────────────────────────────
// Status Badge
// ─────────────────────────────────────────────

function StatusBadge({ status }: { status: MemberStatus }) {
  const t = useT();
  const map: Record<MemberStatus, { label: string; classes: string; dot: string }> = {
    active: {
      label: t("creative.settingsTeam.status.active"),
      classes: "bg-emerald-50 text-emerald-700 border-emerald-200",
      dot: "bg-emerald-500",
    },
    pending: {
      label: t("creative.settingsTeam.status.pending"),
      classes: "bg-amber-50 text-amber-700 border-amber-200",
      dot: "bg-amber-500",
    },
    disabled: {
      label: t("creative.settingsTeam.status.disabled"),
      classes: "bg-red-50 text-red-600 border-red-200",
      dot: "bg-red-500",
    },
  };
  const s = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold",
        s.classes
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

// ─────────────────────────────────────────────
// Skeleton Loader
// ─────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-slate-100 px-5 py-4 last:border-0"
        >
          <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-48 animate-pulse rounded bg-slate-100" />
          <div className="h-5 w-20 animate-pulse rounded-md bg-slate-100" />
          <div className="h-5 w-16 animate-pulse rounded-md bg-slate-100" />
          <div className="ml-auto h-4 w-24 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

export default function TeamSettingsPage() {
  const t = useT();
  const { data: users, error, isLoading } = useSWR<SafeUser[]>(
    "/api/settings/users",
    fetcher
  );

  const previewUsers = users?.slice(0, 5) ?? [];
  const hasMore = (users?.length ?? 0) > 5;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Main redirect card */}
      <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 rounded-full bg-amber-500" />
            <CardTitle className="text-lg font-semibold text-slate-800">
              {t("creative.settingsTeam.title")}
            </CardTitle>
          </div>
          <CardDescription className="text-sm text-slate-500 mt-1">
            {t("creative.settingsTeam.desc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/settings/users">
            <Button className="gap-2 bg-amber-500 text-amber-950 hover:bg-amber-600">
              {t("creative.settingsTeam.goUsers")}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* Preview table */}
      <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
        <CardHeader className="border-b border-slate-200 pb-4">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
              <Users className="h-4 w-4 text-blue-600" />
              {t("creative.settingsTeam.recent")}{" "}
              {users && (
                <Badge
                  variant="outline"
                  className="border-slate-200 text-xs text-slate-500"
                >
                  {t("creative.settingsTeam.count", { n: users.length })}
                </Badge>
              )}
            </CardTitle>
            {hasMore && (
              <Link
                href="/settings/users"
                className="text-xs font-medium text-amber-700 hover:text-amber-800 hover:underline"
              >
                {t("creative.settingsTeam.viewAll")}
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && <TableSkeleton />}

          {error && (
            <div className="flex items-center justify-center gap-2 py-12 text-red-500">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm">{t("creative.settingsTeam.err.load")}</span>
            </div>
          )}

          {!isLoading && !error && previewUsers.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400">
              <Users className="h-8 w-8 text-slate-200" />
              <p className="text-sm">{t("creative.settingsTeam.empty")}</p>
              <Link href="/settings/users">
                <Button variant="outline" size="sm" className="mt-1 gap-2 border-slate-200">
                  <Users className="h-3.5 w-3.5" />
                  {t("creative.settingsTeam.add")}
                </Button>
              </Link>
            </div>
          )}

          {!isLoading && !error && previewUsers.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50">
                    {[t("creative.settingsTeam.th.name"), t("creative.settingsTeam.th.email"), t("creative.settingsTeam.th.role"), t("creative.settingsTeam.th.status"), t("creative.settingsTeam.th.lastLogin")].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {previewUsers.map((user) => (
                    <tr
                      key={user.id}
                      className="border-b border-slate-100 last:border-0 transition-colors hover:bg-slate-50/60"
                    >
                      <td className="px-5 py-3">
                        <p className="text-sm font-semibold text-slate-800">{user.name}</p>
                      </td>
                      <td className="px-5 py-3 text-[13px] text-slate-500">{user.email}</td>
                      <td className="px-5 py-3">
                        <RoleBadge role={user.role} />
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={user.status} />
                      </td>
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <Clock className="h-3 w-3 shrink-0" />
                          {user.last_login
                            ? formatRelative(user.last_login, t)
                            : t("creative.settingsTeam.neverLogin")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {hasMore && (
            <div className="border-t border-slate-100 px-5 py-3">
              <Link href="/settings/users">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-slate-200 text-slate-600 hover:text-amber-700"
                >
                  {t("creative.settingsTeam.viewAllN", { n: users?.length ?? 0 })}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
