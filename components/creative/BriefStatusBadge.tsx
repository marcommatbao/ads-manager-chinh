"use client";

import { AlertTriangle, CheckCircle, Globe, Facebook, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import type { CreativeBrief } from "@/lib/creative-brief/types";

const FUNNEL_CFG = {
  top:    { label: "TOFU", cls: "bg-sky-50 text-sky-600 border-sky-200" },
  mid:    { label: "MOFU", cls: "bg-amber-50 text-amber-600 border-amber-200" },
  bottom: { label: "BOFU", cls: "bg-emerald-50 text-emerald-600 border-emerald-200" },
};

const PLATFORM_CFG = {
  facebook: { icon: <Facebook className="h-3 w-3" />, label: "Meta",   cls: "bg-blue-50 text-blue-700 border-blue-200" },
  google:   { icon: <Globe className="h-3 w-3" />,    label: "Google", cls: "bg-red-50 text-red-600 border-red-200" },
  both:     { icon: <Globe className="h-3 w-3" />,    label: "Meta + Google", cls: "bg-slate-50 text-slate-600 border-slate-200" },
};

interface Props {
  brief: Pick<CreativeBrief, "funnelStage" | "platform" | "complianceNotes">;
  className?: string;
}

export function BriefStatusBadge({ brief, className }: Props) {
  const t = useT();
  const funnel   = FUNNEL_CFG[brief.funnelStage];
  const platform = PLATFORM_CFG[brief.platform];
  const warns    = brief.complianceNotes.filter(n => n.severity === "warn").length;
  const blocks   = brief.complianceNotes.filter(n => n.severity === "block").length;

  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
      {/* Funnel pill */}
      <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold", funnel.cls)}>
        {funnel.label}
      </span>

      {/* Platform */}
      <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold", platform.cls)}>
        {platform.icon} {platform.label}
      </span>

      {/* Compliance */}
      {blocks > 0 && (
        <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
          <ShieldAlert className="h-3 w-3" /> {t("creative.brief.status.block", { n: blocks })}
        </span>
      )}
      {warns > 0 && (
        <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
          <AlertTriangle className="h-3 w-3" /> {t("creative.brief.status.warn", { n: warns })}
        </span>
      )}
      {warns === 0 && blocks === 0 && (
        <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
          <CheckCircle className="h-3 w-3" /> {t("creative.brief.status.ok")}
        </span>
      )}
    </div>
  );
}
