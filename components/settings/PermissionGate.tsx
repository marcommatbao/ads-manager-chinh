"use client";

// ============================================================
// PermissionGate — conditional UI rendering based on role.
//
// Usage:
//   <PermissionGate allowed={perms.canEditBudget}>
//     <Button>Save</Button>
//   </PermissionGate>
//
//   <PermissionGate allowed={perms.canEditBudget} fallback="disable" reason="Chỉ admin">
//     <Input ... />
//   </PermissionGate>
// ============================================================

import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

interface Props {
  /** Whether the user has the required permission. */
  allowed: boolean;
  /**
   * "hide"    — render nothing (default)
   * "disable" — render grayed out, non-interactive
   */
  fallback?: "hide" | "disable";
  /** Tooltip / title shown when disabled. */
  reason?: string;
  className?: string;
  children: React.ReactNode;
}

export function PermissionGate({
  allowed,
  fallback = "hide",
  reason,
  className,
  children,
}: Props) {
  const t = useT();
  if (allowed) return <>{children}</>;
  if (fallback === "hide") return null;

  // fallback === "disable"
  return (
    <div
      className={cn("pointer-events-none select-none opacity-40", className)}
      title={reason ?? t("creative.settingsGate.noPerm")}
      aria-disabled="true"
    >
      {children}
    </div>
  );
}

// ── Read-only overlay badge ────────────────────────────────

/**
 * Thin banner shown at the top of settings sections for viewers.
 */
export function ReadOnlyBanner({ message }: { message?: string }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
      <span className="text-base">🔒</span>
      {message ?? t("creative.settingsGate.readOnly")}
    </div>
  );
}
