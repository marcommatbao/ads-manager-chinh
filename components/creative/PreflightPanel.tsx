"use client";

import { XCircle, AlertTriangle, CheckCircle, ShieldAlert, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import type { PreflightResult, PreflightCheck } from "@/lib/launch-preflight";

// ── Check row ─────────────────────────────────────────────────

function CheckRow({ check }: { check: PreflightCheck }) {
  const isError = check.severity === "error";
  return (
    <div className={cn(
      "rounded-lg border px-3 py-2.5 text-xs",
      isError
        ? "border-red-200 bg-red-50"
        : "border-amber-200 bg-amber-50",
    )}>
      <div className="flex items-start gap-2">
        {isError
          ? <XCircle     className="h-3.5 w-3.5 text-red-500   shrink-0 mt-0.5" />
          : <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
        }
        <div className="flex-1 min-w-0">
          <p className={cn("font-semibold", isError ? "text-red-700" : "text-amber-700")}>
            {check.message}
          </p>
          <p className="text-slate-500 mt-0.5 flex items-center gap-1">
            <ChevronRight className="h-3 w-3 shrink-0" />
            {check.fix}
          </p>
          <span className="inline-block mt-1 rounded bg-white/60 border border-current/20 px-1.5 py-px text-[9px] font-mono opacity-60">
            {check.code}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

interface Props {
  result:    PreflightResult;
  onProceed: () => void;  // only callable when status === "ready_with_warnings"
  onClose:   () => void;
}

export function PreflightPanel({ result, onProceed, onClose }: Props) {
  const t = useT();
  const isBlocked  = result.status === "blocked";
  const hasWarnings = result.warnings.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className={cn(
          "px-5 py-4 flex items-center gap-3",
          isBlocked ? "bg-red-600" : "bg-amber-500",
        )}>
          {isBlocked
            ? <ShieldAlert  className="h-5 w-5 text-white shrink-0" />
            : <AlertTriangle className="h-5 w-5 text-white shrink-0" />
          }
          <div>
            <p className="text-sm font-bold text-white">
              {isBlocked ? t("creative.brief.preflight.blockedTitle") : t("creative.brief.preflight.warnTitle")}
            </p>
            <p className="text-xs text-white/80 mt-0.5">
              {isBlocked
                ? t("creative.brief.preflight.blockedSub", { n: result.errors.length })
                : t("creative.brief.preflight.warnSub", { n: result.warnings.length })
              }
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {/* Errors first */}
          {result.errors.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                {t("creative.brief.preflight.errors", { n: result.errors.length })}
              </p>
              {result.errors.map((c, i) => <CheckRow key={i} check={c} />)}
            </div>
          )}

          {/* Warnings */}
          {hasWarnings && (
            <div className="space-y-2 mt-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                {t("creative.brief.preflight.warnings", { n: result.warnings.length })}
              </p>
              {result.warnings.map((c, i) => <CheckRow key={i} check={c} />)}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={cn(
          "px-5 py-4 border-t border-slate-100 flex items-center gap-3",
          isBlocked ? "justify-end" : "justify-between",
        )}>
          <Button variant="outline" size="sm" className="text-xs" onClick={onClose}>
            {t("creative.brief.preflight.fix")}
          </Button>

          {!isBlocked && (
            <Button
              size="sm"
              className="gap-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-white"
              onClick={() => { onClose(); onProceed(); }}
            >
              <CheckCircle className="h-3.5 w-3.5" />
              {t("creative.brief.preflight.proceed")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
