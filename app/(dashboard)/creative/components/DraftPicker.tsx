"use client";

import type { DraftMeta } from "@/lib/creative-ai-draft";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";

// ─────────────────────────────────────────────
// DraftPicker
// ─────────────────────────────────────────────

export function DraftPicker({
  drafts,
  onSelect,
  onNew,
}: {
  drafts: DraftMeta[];
  onSelect: (draft: DraftMeta) => void;
  onNew: () => void;
}) {
  // Chụp mốc thời gian một lần lúc gắn component — xem chú thích cùng lý do ở
  // app/(dashboard)/competitors/page.tsx.
  const t = useT();
  const [mountedAt] = useState(() => Date.now());

  function formatRelativeTime(iso: string): string {
    const diff = mountedAt - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return t("creative.wizard.draft.justNow");
    if (mins < 60) return t("creative.wizard.draft.minsAgo", { n: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t("creative.wizard.draft.hrsAgo", { n: hrs });
    return t("creative.wizard.draft.daysAgo", { n: Math.floor(hrs / 24) });
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-1">{t("creative.wizard.draft.title")}</h2>
        <p className="text-sm text-gray-500 mb-4">
          {t("creative.wizard.draft.count", { n: drafts.length })}
        </p>

        <div className="space-y-2 mb-6 max-h-64 overflow-y-auto">
          {drafts.map(draft => {
            const step1 = draft.step1Data ? (JSON.parse(draft.step1Data) as Record<string, unknown>) : null;
            const daysLeft = Math.ceil(
              (new Date(draft.expiresAt).getTime() - mountedAt) / 86400_000
            );
            return (
              <button
                key={draft.id}
                onClick={() => onSelect(draft)}
                className="w-full rounded-xl border border-gray-200 p-4 text-left hover:border-amber-300 hover:bg-amber-50 transition-all group"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium text-sm">{draft.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {t("creative.wizard.draft.atStep", { n: draft.currentStep })}
                      {step1?.campaignName ? ` · ${step1.campaignName as string}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">{formatRelativeTime(draft.updatedAt)}</p>
                    <p className={`text-xs mt-0.5 ${daysLeft <= 1 ? "text-red-500" : "text-gray-300"}`}>
                      {t("creative.wizard.draft.expiresIn", { n: daysLeft })}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex gap-1">
                  {[1, 2, 3, 4].map(s => (
                    <div
                      key={s}
                      className={`flex-1 h-1 rounded-full ${s <= draft.currentStep ? "bg-amber-500" : "bg-gray-100"}`}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onNew}
            className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            {t("creative.wizard.draft.newBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}
