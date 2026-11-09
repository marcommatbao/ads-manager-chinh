// ============================================================
// Bảng "Nguồn dữ liệu" — cùng mẫu với components/case/Step2Evidence.tsx,
// tách riêng vì Sức khoẻ đo lường dùng ở 2 trang (Facebook + Google).
// ============================================================
import { CheckCircle2, TriangleAlert, AlertTriangle } from "lucide-react";
import { num } from "@/components/case/format";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { EvidenceSource, SourceStatus } from "@/lib/case/types";

const SOURCE_PILL: Record<SourceStatus, { icon: typeof CheckCircle2; cls: string; text: MessageKey }> = {
  ok: { icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-700 border-emerald-200", text: "meta.measure.src.ok" },
  partial: { icon: TriangleAlert, cls: "bg-amber-50 text-amber-700 border-amber-200", text: "meta.measure.src.partial" },
  error: { icon: AlertTriangle, cls: "bg-red-50 text-red-700 border-red-200", text: "meta.measure.src.error" },
};

export function SourceTable({ sources }: { sources: EvidenceSource[] }) {
  const t = useT();
  const intl = useIntlLocale();
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">{t("meta.measure.src.title")}</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
            <th className="px-4 py-2 font-medium">{t("meta.measure.src.source")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("meta.measure.src.fetched")}</th>
            <th className="px-3 py-2 font-medium">{t("meta.measure.src.note")}</th>
            <th className="px-3 py-2 font-medium">{t("meta.measure.src.status")}</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => {
            const pill = SOURCE_PILL[s.status];
            const Icon = pill.icon;
            return (
              <tr key={s.id} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-2.5 text-slate-800">{s.label}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{num(s.rows, undefined, intl)}</td>
                <td className="px-3 py-2.5 text-slate-500">{s.note ?? "—"}</td>
                <td className="px-3 py-2.5">
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${pill.cls}`}>
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {t(pill.text)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
