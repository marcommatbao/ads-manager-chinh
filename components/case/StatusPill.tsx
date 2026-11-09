// ============================================================
// Pill trạng thái theo verdict — LUÔN kèm icon + chữ, không dùng riêng màu
// (luật thiết kế #đọc icon/chữ trong DESIGN-ARCH-XU-LY-CHIEN-DICH.md).
// ============================================================
"use client";

import { CheckCircle2, XCircle, TriangleAlert, CircleDashed, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VerdictStatus } from "@/lib/case/verdict";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

const STYLE: Record<VerdictStatus, { icon: typeof CheckCircle2; cls: string }> = {
  red: { icon: XCircle, cls: "bg-red-50 text-red-700 border-red-200" },
  amber: { icon: TriangleAlert, cls: "bg-amber-50 text-amber-700 border-amber-200" },
  green: { icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  grey: { icon: CircleDashed, cls: "bg-slate-50 text-slate-500 border-slate-200" },
  no_target: { icon: Target, cls: "bg-slate-50 text-slate-500 border-slate-200" },
};

export function StatusPill({ status, label, className }: { status: VerdictStatus; label: string; className?: string }) {
  const { icon: Icon, cls } = STYLE[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium", cls, className)}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

export function CaseStatusPill({ status }: { status: "open" | "done" | "reopened" }) {
  const t = useT();
  const map: Record<"open" | "done" | "reopened", { icon: typeof CheckCircle2; cls: string; text: MessageKey }> = {
    open: { icon: CircleDashed, cls: "bg-blue-50 text-blue-700 border-blue-200", text: "overview.status.open" },
    done: { icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-700 border-emerald-200", text: "overview.status.done" },
    reopened: { icon: TriangleAlert, cls: "bg-amber-50 text-amber-700 border-amber-200", text: "overview.status.reopened" },
  };
  const { icon: Icon, cls, text } = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", cls)}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {t(text)}
    </span>
  );
}
