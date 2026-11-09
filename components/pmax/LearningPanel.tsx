"use client";

// ============================================================
// PMax "🧪 Thí nghiệm" — D2: ngưỡng học của Smart Bidding. Chỉ đọc — không có
// hành động ghi nào ở đây (số liệu tính từ lib/pmax/signals.ts, module SERVER,
// nên chỉ `import type`). Dữ liệu do PmaxExperimentView tải chung (GET /signals).
// ============================================================

import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { vnd, num } from "@/components/case/format";
import type { LearningCheck } from "@/lib/pmax/signals";

interface LearningData {
  checks: LearningCheck[];
  merge: { ids: string[]; names: string[]; conv: number; text: string } | null;
}

const STATUS_META: Record<LearningCheck["status"], { label: MessageKey; cls: string }> = {
  ok: { label: "google.pmaxLearning.status.ok", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  thieu_don: { label: "google.pmaxLearning.status.fewConv", cls: "bg-red-50 text-red-700 border-red-200" },
  thieu_ngan_sach: { label: "google.pmaxLearning.status.fewBudget", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  dang_hoc: { label: "google.pmaxLearning.status.learning", cls: "bg-blue-50 text-blue-700 border-blue-200" },
};

function LearningRow({ c }: { c: LearningCheck }) {
  const intl = useIntlLocale();
  const t = useT();
  const meta = STATUS_META[c.status];
  return (
    <div className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-bold text-slate-800" title={c.name}>{c.name}</p>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.cls)}>{t(meta.label)}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
        <span>{t("google.pmaxLearning.conv30")} <strong className="text-slate-800">{num(c.conv, { maximumFractionDigits: 1 }, intl)}</strong> ({num(c.convClick, { maximumFractionDigits: 1 }, intl)} {t("google.pmaxLearning.clicks")})</span>
        <span>
          {t("google.pmaxLearning.budget")} <strong className="text-slate-800">{vnd(c.budget, intl)}{t("google.pmaxLearning.perDay")}</strong>
          {c.neededBudget != null && c.budget < c.neededBudget && <> → {t("google.pmaxLearning.need")} <strong className="text-slate-800">{vnd(c.neededBudget, intl)}</strong></>}
        </span>
        {c.cpa != null && <span>CPA: <strong className="text-slate-800">{vnd(c.cpa, intl)}</strong></span>}
      </div>
      {c.issues.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-slate-500">{c.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
      )}
    </div>
  );
}

export function LearningPanel({ data }: { data: LearningData }) {
  const t = useT();
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-extrabold text-slate-900">{t("google.pmaxLearning.title")}</h3>
        <p className="mt-1 text-xs text-slate-500">{t("google.pmaxLearning.intro")}</p>
      </div>

      {data.merge && (
        <div className="space-y-1 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3.5 text-xs text-indigo-800">
          <p className="font-semibold">{t("google.pmaxLearning.mergeTitle")}</p>
          <p>{data.merge.text}</p>
          <p className="text-indigo-500">{data.merge.names.join(" · ")}</p>
        </div>
      )}

      {data.checks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">{t("google.pmaxLearning.empty")}</p>
      ) : (
        <div className="space-y-2">{data.checks.map((c) => <LearningRow key={c.id} c={c} />)}</div>
      )}
    </section>
  );
}
