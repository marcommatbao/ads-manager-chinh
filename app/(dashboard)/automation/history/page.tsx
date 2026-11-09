"use client";

import { useState, useEffect } from "react";
import { History } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIntlLocale, useT } from "@/lib/i18n/client";

interface ChangeEntry {
  campaignName: string;
  company: string;
  actionType: string;
  actionLabel: string;
  appliedAt: string;
}

function CompanyBadge({ company }: { company: string }) {
  const isMBC = company?.toUpperCase() === "MBC";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold",
        isMBC
          ? "bg-blue-100 text-blue-700"
          : "bg-violet-100 text-violet-700"
      )}
    >
      {company}
    </span>
  );
}

export default function HistoryPage() {
  const t = useT();
  const loc = useIntlLocale();
  const [logs, setLogs] = useState<ChangeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/automation/change-history")
      .then((res) => res.json())
      .then((json) => {
        const items: ChangeEntry[] = Array.isArray(json)
          ? json
          : Array.isArray(json?.data)
          ? json.data
          : [];
        setLogs(items);
      })
      .catch(() => {
        setLogs([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
          <div className="rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 p-2.5 shadow-lg shadow-slate-200">
            <History className="h-5 w-5 text-white" />
          </div>
          {t("creative.autoHistory.title")}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t("creative.autoHistory.subtitle")}
        </p>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm animate-pulse"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="h-4 w-10 rounded bg-slate-200" />
                <div className="h-3 w-24 rounded bg-slate-100" />
              </div>
              <div className="h-4 w-48 rounded bg-slate-200 mb-2" />
              <div className="h-3 w-full rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50">
          <History className="h-12 w-12 text-slate-300 mb-4" />
          <p className="text-sm font-semibold text-slate-500">
            {t("creative.autoHistory.emptyTitle")}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {t("creative.autoHistory.emptyHint")}
          </p>
        </div>
      ) : (
        <div className="relative space-y-3 before:absolute before:left-5 before:top-2 before:h-[calc(100%-1rem)] before:w-0.5 before:bg-slate-200">
          {logs.map((entry, idx) => (
            <div key={idx} className="relative flex items-start pl-12">
              {/* Timeline dot */}
              <div className="absolute left-[15px] top-5 h-3 w-3 rounded-full border-2 border-white bg-amber-500 ring-2 ring-slate-100" />

              <div className="flex-1 rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-300 transition-colors">
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <CompanyBadge company={entry.company} />
                  <span className="text-[10px] text-slate-400">
                    {new Date(entry.appliedAt).toLocaleString(loc)}
                  </span>
                </div>
                <p className="text-sm font-bold text-slate-800 mb-1">
                  {entry.campaignName}
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {entry.actionLabel}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
