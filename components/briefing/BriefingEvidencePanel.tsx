"use client";

import { useT } from "@/lib/i18n/client";

type Evidence = {
  id: string;
  source: string;
  from: string;
  to: string;
  readAt: string;
  status: "complete" | "partial" | "unavailable";
  critical: boolean;
  note?: string;
};

const statusClass = {
  complete: "text-emerald-700 bg-emerald-50",
  partial: "text-amber-700 bg-amber-50",
  unavailable: "text-red-700 bg-red-50",
} as const;

const statusLabelKey = {
  complete: "overview.home.briefingEvidenceComplete",
  partial: "overview.home.briefingEvidencePartial",
  unavailable: "overview.home.briefingEvidenceUnavailable",
} as const;

export function BriefingEvidencePanel({ evidence }: { evidence: Evidence[] }) {
  const t = useT();
  if (!evidence.length) return null;
  return (
    <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px]">
      <summary className="cursor-pointer font-semibold text-slate-700">
        {t("overview.home.briefingEvidence", { n: evidence.length })}
      </summary>
      <div className="mt-2 space-y-1.5">
        {evidence.map((item) => (
          <div key={`${item.id}-${item.readAt}`} className="flex flex-wrap items-center gap-2 text-slate-600">
            <span className="font-medium">{item.source}</span>
            <span>{item.from} → {item.to}</span>
            <span className={`rounded px-1.5 py-0.5 font-medium ${statusClass[item.status]}`}>
              {t(statusLabelKey[item.status])}
            </span>
            {item.critical && <span className="font-semibold text-red-700">!</span>}
            {item.note && <span className="basis-full text-slate-500">{item.note}</span>}
          </div>
        ))}
      </div>
    </details>
  );
}
