"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Badge ─────────────────────────────────────

interface BadgeProp {
  count: number;
  variant: "danger" | "warning" | "info" | "success";
}

const BADGE_COLORS: Record<BadgeProp["variant"], string> = {
  danger:  "bg-red-100 text-red-700 border border-red-200",
  warning: "bg-amber-100 text-amber-700 border border-amber-200",
  info:    "bg-blue-100 text-blue-700 border border-blue-200",
  success: "bg-emerald-100 text-emerald-700 border border-emerald-200",
};

// ── Component ─────────────────────────────────

interface DashboardSectionProps {
  title: string;
  subtitle?: string;
  badge?: BadgeProp;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export function DashboardSection({
  title,
  subtitle,
  badge,
  actions,
  children,
  className,
  collapsible = false,
  defaultCollapsed = false,
}: DashboardSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Section header */}
      <div
        className={cn(
          "flex items-center justify-between pb-2 border-b border-slate-100",
          collapsible && "cursor-pointer select-none",
        )}
        onClick={collapsible ? () => setCollapsed(c => !c) : undefined}
      >
        <div className="flex items-center gap-2">
          {collapsible && (
            collapsed
              ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
              : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          )}
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {title}
          </h2>
          {badge && badge.count > 0 && (
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold",
              BADGE_COLORS[badge.variant],
            )}>
              {badge.count}
            </span>
          )}
        </div>
        {!collapsed && actions && (
          <div
            className="flex items-center gap-1"
            onClick={e => e.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </div>

      {subtitle && !collapsed && (
        <p className="text-xs text-slate-400 -mt-1">{subtitle}</p>
      )}

      {!collapsed && <div className="space-y-4">{children}</div>}
    </div>
  );
}
