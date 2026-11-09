"use client";

import { companyIds, companyLabel as companyName, hasModule } from "@/lib/companies/registry";
import { useState, useMemo, useCallback } from "react";
import useSWR from "swr";
import { formatDistanceToNow } from "date-fns";
import { vi, enUS } from "date-fns/locale";
import type { Locale as DfLocale } from "date-fns";
import {
  UserCog,
  UserPlus,
  Pencil,
  Trash2,
  Users,
  ShieldCheck,
  Eye,
  KeyRound,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ROLE_CONFIG,
  PERMISSION_LABELS,
  ALL_ROLES,
  getPermissions,
} from "@/lib/permissions";
import type { Role, PermissionKey } from "@/lib/permissions";
import type { MemberStatus, CompanyAccess } from "@/lib/team";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  company_access: CompanyAccess[];
  telegram_chat_id?: string;
  avatar?: string;
  last_active: string;
  last_login?: string;
  invited_at: string;
  status: MemberStatus;
  is_active: boolean;
}

// ─────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json()).then((d) => {
    if (!d.success) throw new Error(d.error ?? "API error");
    return d.data as SafeUser[];
  });

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function formatRelativeTime(isoString: string, dfLocale: DfLocale): string {
  try {
    return formatDistanceToNow(new Date(isoString), {
      addSuffix: true,
      locale: dfLocale,
    });
  } catch {
    return isoString;
  }
}

function companyLabel(access: CompanyAccess[]): string {
  // Đợt 21 A5: theo công ty của bản cài (bản Mắt Bão vẫn ra "MBC & MBI")
  if (access.includes("ALL")) return companyIds().map(companyName).join(" & ");
  return access.map(companyName).join(" & ");
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Permission chips config — maps to RolePermissions keys
const PERM_CHIPS: { key: PermissionKey; short: MessageKey }[] = [
  { key: "can_edit",            short: "creative.settingsUsers.chip.edit" },
  { key: "can_manage_budget",   short: "creative.settingsUsers.chip.budget" },
  { key: "can_view_cpl",        short: "creative.settingsUsers.chip.cpl" },
  { key: "can_input_offline",   short: "creative.settingsUsers.chip.offline" },
  { key: "can_edit_thresholds", short: "creative.settingsUsers.chip.cplThreshold" },
];

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function AvatarCell({ user }: { user: SafeUser }) {
  const cfg = ROLE_CONFIG[user.role];
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold",
          cfg.bg,
          cfg.color,
          "border",
          cfg.border
        )}
      >
        {user.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatar}
            alt={user.name}
            className="h-9 w-9 rounded-full object-cover"
          />
        ) : (
          getInitials(user.name)
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-800">{user.name}</p>
        <p className="truncate text-xs text-slate-400">{user.telegram_chat_id ? `@tg:${user.telegram_chat_id}` : "—"}</p>
      </div>
    </div>
  );
}

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

function StatusBadge({ status }: { status: MemberStatus }) {
  const t = useT();
  const map: Record<MemberStatus, { label: MessageKey; classes: string; dot: string }> = {
    active:   { label: "creative.settingsUsers.status.active",  classes: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
    pending:  { label: "creative.settingsUsers.status.pending",  classes: "bg-amber-50 text-amber-700 border-amber-200",       dot: "bg-amber-500" },
    disabled: { label: "creative.settingsUsers.status.disabled",    classes: "bg-red-50 text-red-600 border-red-200",             dot: "bg-red-500" },
  };
  const s = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold", s.classes)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {t(s.label)}
    </span>
  );
}

function PermissionChips({ role }: { role: Role }) {
  const t = useT();
  const perms = getPermissions(role);
  return (
    <div className="flex flex-wrap gap-1">
      {PERM_CHIPS.map(({ key, short }) => (
        <span
          key={key}
          title={PERMISSION_LABELS[key]}
          className={cn(
            "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
            perms[key]
              ? "bg-emerald-50 text-emerald-700"
              : "bg-slate-100 text-slate-400"
          )}
        >
          {t(short)}
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Stats Row
// ─────────────────────────────────────────────

function StatsRow({ users }: { users: SafeUser[] }) {
  const t = useT();
  const total = users.length;
  const active = users.filter((u) => u.status === "active").length;
  const admins = users.filter((u) =>
    ["super_admin", "admin_mbc", "admin_mbi", "admin"].includes(u.role)
  ).length;
  const viewers = users.filter((u) =>
    ["viewer_mbc", "viewer_mbi", "viewer"].includes(u.role)
  ).length;

  const stats = [
    { label: t("creative.settingsUsers.stats.total"),   value: total,   icon: Users,       color: "text-blue-600",   bg: "bg-blue-50"   },
    { label: t("creative.settingsUsers.stats.active"), value: active, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: t("creative.settingsUsers.stats.admins"),        value: admins,  icon: ShieldCheck,  color: "text-amber-600",  bg: "bg-amber-50"  },
    { label: t("creative.settingsUsers.stats.viewers"),       value: viewers, icon: Eye,          color: "text-violet-600", bg: "bg-violet-50" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <Card key={s.label} className="border border-slate-200 bg-white shadow-sm">
          <CardContent className="flex items-center gap-3 py-4">
            <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", s.bg)}>
              <s.icon className={cn("h-5 w-5", s.color)} />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{s.value}</p>
              <p className="text-xs text-slate-500">{s.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// User Form (Add / Edit)
// ─────────────────────────────────────────────

interface UserFormData {
  email: string;
  name: string;
  role: Role;
  company_access: CompanyAccess[];
  password: string;
  telegram_chat_id: string;
  status: MemberStatus;
}

// Đợt 25: vai trò theo công ty (admin_mbc / viewer_mbi…) chỉ hiện khi bản cài có công ty đó; bản Mắt Bão y như cũ.
const visibleRoles = () => { const ids = companyIds(); return ALL_ROLES.filter((r) => !(r.endsWith("_mbc") && !ids.includes("MBC")) && !(r.endsWith("_mbi") && !ids.includes("MBI"))) };
const hasMbc = () => companyIds().includes("MBC");
const DEFAULT_FORM: UserFormData = {
  email: "",
  name: "",
  // Đợt 25: bản khách không có vai trò viewer_mbc → mặc định "viewer" + công ty đầu tiên của bản cài (getter: đọc lúc dùng).
  get role() { return hasMbc() ? "viewer_mbc" : "viewer" },
  get company_access() { return hasMbc() ? ["MBC"] : [companyIds()[0] ?? "MBC"] },
  password: "",
  telegram_chat_id: "",
  status: "active",
};

function defaultCompanyAccessForRole(role: Role): CompanyAccess[] {
  if (role === "super_admin") return ["ALL"];
  if (role === "admin_mbc" || role === "viewer_mbc") return ["MBC"];
  if (role === "admin_mbi" || role === "viewer_mbi") return ["MBI"];
  return [companyIds()[0] ?? "MBC"]; // Đợt 21 A5: vai trò chung → công ty đầu tiên của bản cài
}

interface UserFormProps {
  data: UserFormData;
  onChange: (patch: Partial<UserFormData>) => void;
  isEdit?: boolean;
  onResetPassword?: () => void;
  submitting?: boolean;
}

function UserForm({ data, onChange, isEdit, onResetPassword, submitting }: UserFormProps) {
  const t = useT();
  const selectedCfg = ROLE_CONFIG[data.role];
  const isSuperAdmin = data.role === "super_admin";
  // Đợt 21 A5: ô tích theo công ty của bản cài (trước đây cố định MBC / MBI).
  const ids = companyIds();
  const checked = (co: string) => isSuperAdmin || data.company_access.includes(co) || data.company_access.includes("ALL");

  const handleRoleChange = (newRole: Role | null) => {
    if (!newRole) return;
    onChange({ role: newRole, company_access: defaultCompanyAccessForRole(newRole) });
  };

  const toggle = (co: string) => {
    if (isSuperAdmin || submitting) return;
    const cur = data.company_access.includes("ALL") ? ids : data.company_access;
    if (checked(co) && cur.filter((c) => c !== co).length === 0) return; // phải giữ ít nhất một
    const next = (checked(co) ? cur.filter((c) => c !== co) : [...cur, co]) as CompanyAccess[];
    onChange({ company_access: next });
  };

  return (
    <div className="space-y-4">
      {/* Email */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">
          Email <span className="text-red-500">*</span>
        </label>
        <Input
          type="email"
          placeholder={t("creative.settingsUsers.form.emailPlaceholder")}
          value={data.email}
          onChange={(e) => onChange({ email: e.target.value })}
          disabled={isEdit || submitting}
          className="border-slate-200"
        />
      </div>

      {/* Full name */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">
          {t("creative.settingsUsers.form.fullName")} <span className="text-red-500">*</span>
        </label>
        <Input
          type="text"
          placeholder={t("creative.settingsUsers.form.namePlaceholder")}
          value={data.name}
          onChange={(e) => onChange({ name: e.target.value })}
          disabled={submitting}
          className="border-slate-200"
        />
      </div>

      {/* Role */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">
          Role <span className="text-red-500">*</span>
        </label>
        <Select
          value={data.role}
          onValueChange={handleRoleChange}
          disabled={submitting}
        >
          <SelectTrigger className="w-full border-slate-200">
            <SelectValue placeholder={t("creative.settingsUsers.form.selectRole")}>{(v: string) => ROLE_CONFIG[v as keyof typeof ROLE_CONFIG]?.label ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {visibleRoles().map((r) => {
              const cfg = ROLE_CONFIG[r];
              return (
                <SelectItem key={r} value={r}>
                  <div className="flex w-full items-center justify-between gap-3">
                    <div>
                      <span className={cn("text-sm font-semibold", cfg.color)}>{cfg.label}</span>
                      <p className="text-xs text-slate-500">{cfg.description}</p>
                    </div>
                    <span
                      className={cn(
                        "ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold",
                        cfg.bg,
                        cfg.color,
                        "border",
                        cfg.border
                      )}
                    >
                      {cfg.companyLabel}
                    </span>
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {/* Description preview */}
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
            selectedCfg.bg,
            selectedCfg.border,
            selectedCfg.color
          )}
        >
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span>{selectedCfg.description}</span>
        </div>
      </div>

      {/* Company Access */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">
          {t("creative.settingsUsers.form.companyAccess")} <span className="text-red-500">*</span>
        </label>
        <div className="flex flex-wrap gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          {ids.map((co) => (
            <label key={co}
              className={cn(
                "flex items-center gap-2.5 select-none",
                isSuperAdmin || submitting ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              )}
            >
              <input
                type="checkbox"
                checked={checked(co)}
                onChange={() => toggle(co)}
                disabled={isSuperAdmin || submitting}
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
              />
              <span className={cn("text-sm font-semibold", co === "MBI" ? "text-violet-700" : "text-blue-700")}>{companyName(co)}</span>
              {co === "MBC" && <span className="text-xs text-slate-400">Mắt Bão Cloud</span>}
              {co === "MBI" && <span className="text-xs text-slate-400">Mắt Bão Invest</span>}
            </label>
          ))}
        </div>
        {isSuperAdmin ? (
          <p className="text-[11px] text-slate-400">{t("creative.settingsUsers.form.superAdminNote")}</p>
        ) : (
          <p className="text-[11px] text-slate-400">{t("creative.settingsUsers.form.companyHint")}</p>
        )}
      </div>

      {/* Password */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">
          {isEdit ? t("creative.settingsUsers.form.passwordNew") : <>{t("creative.settingsUsers.form.password")} <span className="text-red-500">*</span></>}
        </label>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder={isEdit ? "••••••••" : t("creative.settingsUsers.form.passwordPlaceholder")}
            value={data.password}
            onChange={(e) => onChange({ password: e.target.value })}
            disabled={submitting}
            className="border-slate-200"
          />
          {isEdit && onResetPassword && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onResetPassword}
              disabled={submitting}
              className="shrink-0 gap-1.5 border-slate-200 text-slate-600 hover:text-amber-700"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Telegram */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">
          Telegram Chat ID <span className="text-slate-400 font-normal">{t("creative.settingsUsers.form.optional")}</span>
        </label>
        <Input
          type="text"
          placeholder="123456789"
          value={data.telegram_chat_id}
          onChange={(e) => onChange({ telegram_chat_id: e.target.value })}
          disabled={submitting}
          className="border-slate-200"
        />
      </div>

      {/* Status (edit only) */}
      {isEdit && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">{t("creative.settingsUsers.status")}</label>
          <Select
            value={data.status}
            onValueChange={(v) => onChange({ status: v as MemberStatus })}
            disabled={submitting}
          >
            <SelectTrigger className="w-full border-slate-200">
              <SelectValue>{(v: string) => ({ active: t("creative.settingsUsers.status.active"), pending: t("creative.settingsUsers.status.pending"), disabled: t("creative.settingsUsers.status.disabled") } as Record<string, string>)[v] ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  {t("creative.settingsUsers.status.active")}
                </span>
              </SelectItem>
              <SelectItem value="pending">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  {t("creative.settingsUsers.status.pending")}
                </span>
              </SelectItem>
              <SelectItem value="disabled">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  {t("creative.settingsUsers.status.disabled")}
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Permission Matrix
// ─────────────────────────────────────────────

function PermissionMatrix() {
  const t = useT();
  const PERM_KEYS: PermissionKey[] = [
    "can_edit",
    "can_manage_budget",
    "can_manage_users",
    "can_view_cpl",
    "can_input_offline",
    "can_edit_thresholds",
  ].filter((k) => hasModule("matbao") || (k !== "can_view_cpl" && k !== "can_input_offline")) as PermissionKey[]; // Đợt 25: CPL tracking / đơn offline là gói Mắt Bão

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
        <p className="text-sm font-bold text-slate-800">{t("creative.settingsUsers.matrix.title")}</p>
        <p className="mt-0.5 text-xs text-slate-500">{t("creative.settingsUsers.matrix.sub")}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50">
              <th className="py-3 pl-5 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {t("creative.settingsUsers.perms")}
              </th>
              {visibleRoles().map((r) => {
                const cfg = ROLE_CONFIG[r];
                return (
                  <th key={r} className="px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-wider">
                    <span className={cn("rounded px-2 py-0.5", cfg.bg, cfg.color)}>
                      {cfg.label}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {PERM_KEYS.map((pk, i) => (
              <tr
                key={pk}
                className={cn(
                  "border-b border-slate-100 last:border-0 transition-colors hover:bg-slate-50/60",
                  i % 2 === 0 ? "bg-white" : "bg-slate-50/20"
                )}
              >
                <td className="py-3 pl-5 pr-4 text-[13px] text-slate-700">
                  {PERMISSION_LABELS[pk]}
                </td>
                {visibleRoles().map((r) => {
                  const perms = getPermissions(r);
                  const has = perms[pk];
                  return (
                    <td key={r} className="px-3 py-3 text-center">
                      {has ? (
                        <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-500" />
                      ) : (
                        <XCircle className="mx-auto h-4 w-4 text-slate-200" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

export default function UsersPage() {
  const t = useT();
  const dfLocale = useLocale() === "en" ? enUS : vi;
  const { data: users = [], error, isLoading, mutate } = useSWR<SafeUser[]>(
    "/api/settings/users",
    fetcher
  );

  // Modal state
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<SafeUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<SafeUser | null>(null);

  // Form state
  const [addForm, setAddForm] = useState<UserFormData>({ ...DEFAULT_FORM });
  const [editForm, setEditForm] = useState<UserFormData>({ ...DEFAULT_FORM });

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Stats (memoised)
  const stats = useMemo(() => {
    return { users };
  }, [users]);

  // Open add modal
  const openAdd = useCallback(() => {
    setAddForm({ ...DEFAULT_FORM });
    setFormError(null);
    setFormSuccess(null);
    setAddOpen(true);
  }, []);

  // Open edit modal
  const openEdit = useCallback((user: SafeUser) => {
    setEditForm({
      email: user.email,
      name: user.name,
      role: user.role,
      company_access: user.company_access.length > 0 ? user.company_access : defaultCompanyAccessForRole(user.role),
      password: "",
      telegram_chat_id: user.telegram_chat_id ?? "",
      status: user.status,
    });
    setFormError(null);
    setFormSuccess(null);
    setEditUser(user);
  }, []);

  // Handle add submit
  const handleAdd = async () => {
    setFormError(null);
    if (!addForm.email || !addForm.name || !addForm.password) {
      setFormError(t("creative.settingsUsers.err.fillAll"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/settings/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: addForm.email,
          name: addForm.name,
          role: addForm.role,
          company_access: addForm.company_access,
          password: addForm.password,
          telegram_chat_id: addForm.telegram_chat_id || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      await mutate();
      setAddOpen(false);
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : t("creative.settingsUsers.err.create"));
    } finally {
      setSubmitting(false);
    }
  };

  // Handle edit submit
  const handleEdit = async () => {
    if (!editUser) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: editForm.name,
        role: editForm.role,
        company_access: editForm.company_access,
        status: editForm.status,
        is_active: editForm.status === "active",
        telegram_chat_id: editForm.telegram_chat_id || undefined,
      };
      if (editForm.password) body.password = editForm.password;

      const res = await fetch(`/api/settings/users/${editUser.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      await mutate();
      setEditUser(null);
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : t("creative.settingsUsers.err.update"));
    } finally {
      setSubmitting(false);
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!deleteUser) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/settings/users/${deleteUser.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      await mutate();
      setDeleteUser(null);
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : t("creative.settingsUsers.err.delete"));
    } finally {
      setSubmitting(false);
    }
  };

  // Reset password (prefill a generated hint)
  const handleResetPasswordHint = () => {
    const generated = Math.random().toString(36).slice(2, 10);
    setEditForm((prev) => ({ ...prev, password: generated }));
    setFormSuccess(t("creative.settingsUsers.resetHint", { pw: generated }));
  };

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-800">
            <UserCog className="h-5 w-5 text-blue-600" />
            {t("creative.settingsUsers.title")}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {t("creative.settingsUsers.subtitle")}
          </p>
        </div>
        <Button
          onClick={openAdd}
          className="gap-2 bg-amber-500 text-amber-950 hover:bg-amber-600"
        >
          <UserPlus className="h-4 w-4" />
          {t("creative.settingsUsers.add")}
        </Button>
      </div>

      {/* ── Stats ── */}
      {!isLoading && !error && <StatsRow users={stats.users} />}

      {/* ── User Table Card ── */}
      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200 pb-4">
          <CardTitle className="text-base font-semibold text-slate-800">
            {t("creative.settingsUsers.listTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">{t("creative.settingsUsers.loading")}</span>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center gap-2 py-16 text-red-500">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-sm">{error.message}</span>
            </div>
          )}

          {!isLoading && !error && users.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Users className="mb-3 h-10 w-10 text-slate-200" />
              <p className="text-sm font-medium">{t("creative.settingsUsers.empty")}</p>
              <p className="mt-1 text-xs">{t("creative.settingsUsers.emptyHint")}</p>
            </div>
          )}

          {!isLoading && !error && users.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50">
                    {([
                      "creative.settingsUsers.th.employee",
                      "creative.settingsUsers.th.email",
                      "creative.settingsUsers.th.role",
                      "creative.settingsUsers.th.company",
                      "creative.settingsUsers.perms",
                      "creative.settingsUsers.status",
                      "creative.settingsUsers.th.lastActive",
                      "",
                    ] as const).map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 last:text-right"
                      >
                        {h ? t(h) : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr
                      key={user.id}
                      className="border-b border-slate-100 last:border-0 transition-colors hover:bg-slate-50/60"
                    >
                      <td className="px-4 py-3">
                        <AvatarCell user={user} />
                      </td>
                      <td className="px-4 py-3 text-[13px] text-slate-600">
                        {user.email}
                      </td>
                      <td className="px-4 py-3">
                        <RoleBadge role={user.role} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                          <Building2 className="h-3 w-3" />
                          {companyLabel(user.company_access)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <PermissionChips role={user.role} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={user.status} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <Clock className="h-3 w-3 shrink-0" />
                          {formatRelativeTime(user.last_active, dfLocale)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => openEdit(user)}
                            className="text-slate-400 hover:text-amber-700"
                            title={t("creative.settingsUsers.edit")}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => {
                              setFormError(null);
                              setDeleteUser(user);
                            }}
                            className="text-slate-400 hover:text-red-500"
                            title={t("creative.settingsUsers.del")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Permission Matrix ── */}
      <PermissionMatrix />

      {/* ════════════════════════════════════════
          Add User Modal
      ════════════════════════════════════════ */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!submitting) setAddOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800">
              <UserPlus className="h-4 w-4 text-blue-600" />
              {t("creative.settingsUsers.modal.addTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto pr-1">
            {formError && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {formError}
              </div>
            )}
            <UserForm
              data={addForm}
              onChange={(patch) => setAddForm((prev) => ({ ...prev, ...patch }))}
              submitting={submitting}
            />
          </div>

          <DialogFooter showCloseButton>
            <Button
              onClick={handleAdd}
              disabled={submitting}
              className="gap-2 bg-amber-500 text-amber-950 hover:bg-amber-600"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {t("creative.settingsUsers.modal.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════
          Edit User Modal
      ════════════════════════════════════════ */}
      <Dialog open={editUser !== null} onOpenChange={(o) => { if (!submitting && !o) setEditUser(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800">
              <Pencil className="h-4 w-4 text-blue-600" />
              {t("creative.settingsUsers.modal.editTitle", { name: editUser?.name ?? "" })}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto pr-1">
            {formError && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {formError}
              </div>
            )}
            {formSuccess && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {formSuccess}
              </div>
            )}
            <UserForm
              data={editForm}
              onChange={(patch) => setEditForm((prev) => ({ ...prev, ...patch }))}
              isEdit
              onResetPassword={handleResetPasswordHint}
              submitting={submitting}
            />
          </div>

          <DialogFooter showCloseButton>
            <Button
              onClick={handleEdit}
              disabled={submitting}
              className="gap-2 bg-amber-500 text-amber-950 hover:bg-amber-600"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {t("creative.settingsUsers.modal.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════
          Delete Confirm Dialog
      ════════════════════════════════════════ */}
      <Dialog open={deleteUser !== null} onOpenChange={(o) => { if (!submitting && !o) setDeleteUser(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-4 w-4" />
              {t("creative.settingsUsers.modal.deleteTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {formError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {formError}
              </div>
            )}
            <p className="text-sm text-slate-600">
              {t("creative.settingsUsers.modal.deleteAsk")}{" "}
              <strong className="text-slate-800">{deleteUser?.name}</strong> (
              {deleteUser?.email})?
            </p>
            <p className="text-xs text-slate-400">{t("creative.settingsUsers.modal.irreversible")}</p>
          </div>

          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={submitting}
              className="gap-2"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {t("creative.settingsUsers.modal.deleteBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
