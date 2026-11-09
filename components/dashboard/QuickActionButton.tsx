"use client";

import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type QuickActionVariant = "primary" | "secondary" | "danger" | "warning" | "ghost";

interface QuickActionButtonProps {
  label:     string;
  href:      string;
  variant?:  QuickActionVariant;
  Icon?:     LucideIcon;
  className?: string;
}

const VARIANTS: Record<QuickActionVariant, string> = {
  primary:   "bg-amber-500 text-amber-950 hover:bg-amber-600",
  secondary: "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50",
  danger:    "bg-red-50 border border-red-200 text-red-700 hover:bg-red-100",
  warning:   "bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100",
  ghost:     "text-amber-700 hover:text-amber-800 hover:bg-amber-50",
};

export function QuickActionButton({
  label,
  href,
  variant = "secondary",
  Icon,
  className,
}: QuickActionButtonProps) {
  return (
    <Link href={href}>
      <span className={cn(
        "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
        VARIANTS[variant],
        className,
      )}>
        {Icon && <Icon className="h-3 w-3 shrink-0" />}
        {label}
        {!Icon && <ArrowRight className="h-3 w-3 shrink-0 opacity-60" />}
      </span>
    </Link>
  );
}
