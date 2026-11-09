import { CheckCircle2, Flag, Archive, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { PolicyPlatform, PolicyReviewStatus, PolicySeverity } from "@/lib/policy-radar/types";

const SEVERITY_STYLE: Record<PolicySeverity, { label: MessageKey; className: string }> = {
  high:   { label: "meta.policy.sev.high",   className: "bg-red-100 text-red-700 border-red-200" },
  medium: { label: "meta.policy.sev.medium", className: "bg-amber-100 text-amber-700 border-amber-200" },
  low:    { label: "meta.policy.sev.low",    className: "bg-slate-100 text-slate-600 border-slate-200" },
};

export function SeverityBadge({ severity, className }: { severity: PolicySeverity; className?: string }) {
  const t = useT();
  const style = SEVERITY_STYLE[severity];
  return (
    <Badge variant="outline" className={cn("rounded-full font-bold tracking-wide", style.className, className)}>
      {t(style.label)}
    </Badge>
  );
}

// Validated pair (dataviz skill's validate_palette.js): #3B82F6/#4338CA passes
// CVD separation (ΔE 14.1 deutan / 17.9 normal). The app's own --chart-5
// violet (#8B5CF6) was tried first and FAILS next to this blue (ΔE 1.3
// deutan) — see docs/policy-radar/CHART-SYSTEM-BRIEF.md §2A.
const PLATFORM_STYLE: Record<PolicyPlatform, { label: string; dot: string; className: string }> = {
  google_ads: { label: "Google Ads", dot: "bg-[#3B82F6]", className: "bg-blue-50 text-blue-700 border-blue-200" },
  meta:       { label: "Meta",       dot: "bg-[#4338CA]", className: "bg-indigo-50 text-indigo-700 border-indigo-200" },
};

export function PolicyPlatformBadge({ platform, className }: { platform: PolicyPlatform; className?: string }) {
  const style = PLATFORM_STYLE[platform];
  return (
    <Badge variant="outline" className={cn("inline-flex items-center gap-1.5 rounded-md", style.className, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
      {style.label}
    </Badge>
  );
}

// Positive trust marker for official + verified sources — previously the app
// only ever showed a marker for the *non*-official/unverified case, so the
// real, fully-verified Google items rendered with no trust signal at all.
export function OfficialSourceBadge({ className }: { className?: string }) {
  const t = useT();
  return (
    <Badge className={cn("inline-flex items-center gap-1 rounded-md bg-slate-900 text-white border-transparent", className)}>
      <ShieldCheck className="h-3 w-3" /> {t("meta.policy.official")}
    </Badge>
  );
}

const STATUS_STYLE: Record<Exclude<PolicyReviewStatus, "unread">, { className: string; icon: typeof CheckCircle2 }> = {
  reviewed:             { className: "text-emerald-700 bg-emerald-50 border-emerald-200", icon: CheckCircle2 },
  flagged_for_followup: { className: "text-amber-700 bg-amber-50 border-amber-200",       icon: Flag },
  archived:             { className: "text-slate-500 bg-slate-50 border-slate-200",       icon: Archive },
};

export function ReviewStatusBadge({ status, label, className }: { status: PolicyReviewStatus; label: string; className?: string }) {
  if (status === "unread") return null;
  const style = STATUS_STYLE[status];
  const Icon = style.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 border", style.className, className)}>
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}
