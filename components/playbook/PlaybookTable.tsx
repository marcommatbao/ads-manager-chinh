// ============================================================
// Sổ kinh nghiệm — bảng "Nên dùng" / "Nên tránh" (Đợt 7a)
// ------------------------------------------------------------
// Dùng chung một cấu trúc bảng cho cả hai hướng (direction "use"/"avoid"),
// chỉ khác viền màu + văn bản "Vì sao". KHÔNG import giá trị từ lib/playbook/*
// (xem components/playbook/labels.ts) — chỉ `import type`.
// ============================================================
"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/measure/Pill";
import { vnd, num, datetimeVN } from "@/components/case/format";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { TFunction } from "@/lib/i18n/translate";
import {
  PLATFORM_LABEL,
  metricLabel,
  kindGroup,
  statusLabel,
  confidenceLabel,
  verdictLabel,
} from "@/components/playbook/labels";
import type { PlaybookEntry, EntryStatus } from "@/lib/playbook/store";

type Decision = "approved" | "rejected" | "suggested";

/** Các dòng văn bản ngắn giải thích "vì sao" — khác nhau giữa hướng dùng/tránh. */
function reasonLines(e: PlaybookEntry, t: TFunction, loc: string): string[] {
  const lines: string[] = [];
  if (e.direction === "avoid") {
    lines.push(t("overview.playbook.table.avoidLine", { cost: vnd(e.stat.cost, loc), n: num(e.stat.loseUnits, undefined, loc) }));
  } else {
    if (e.stat.cpr !== null && e.stat.lift !== null) {
      lines.push(t("overview.playbook.table.cprLift", { cpr: vnd(e.stat.cpr, loc), lift: e.stat.lift }));
    } else if (e.stat.cpr !== null) {
      lines.push(t("overview.playbook.table.cprOnly", { cpr: vnd(e.stat.cpr, loc) }));
    }
    lines.push(t("overview.playbook.table.winLine", { win: num(e.stat.winUnits, undefined, loc), n: num(e.stat.campaigns, undefined, loc) }));
  }
  lines.push(e.stat.halvesAgree ? t("overview.playbook.table.halvesYes") : t("overview.playbook.table.halvesNo"));
  return lines;
}

function actionsFor(status: EntryStatus): { label: MessageKey; decision: Decision; variant?: "outline" | "default" }[] {
  switch (status) {
    case "auto":
      return [{ label: "overview.playbook.table.drop", decision: "rejected", variant: "outline" }];
    case "suggested":
      return [
        { label: "overview.playbook.table.approve", decision: "approved" },
        { label: "overview.playbook.table.drop", decision: "rejected", variant: "outline" },
      ];
    case "approved":
      return [
        { label: "overview.playbook.table.drop", decision: "rejected", variant: "outline" },
        { label: "overview.playbook.table.backToSuggest", decision: "suggested", variant: "outline" },
      ];
    case "rejected":
      return [{ label: "overview.playbook.table.backToSuggest", decision: "suggested", variant: "outline" }];
    case "expired":
      return [];
  }
}

function Row({
  entry,
  canDecide,
  acting,
  onDecide,
}: {
  entry: PlaybookEntry;
  canDecide: boolean;
  acting: boolean;
  onDecide: (decision: Decision) => void;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const statusInfo = statusLabel(entry.status, t);
  const isIntermediate = entry.metric !== "purchase";
  const actions = canDecide ? actionsFor(entry.status) : [];

  return (
    <tr className="border-b border-slate-50 align-top last:border-0">
      <td className="px-4 py-3">
        <div className="font-semibold text-slate-900">{entry.label}</div>
        <div className="mt-0.5 text-xs text-slate-400">
          {PLATFORM_LABEL[entry.platform]} · {entry.company} · {entry.product} · {kindGroup(entry.kind, t)}
          <span className="ml-1 text-slate-300">({entry.unitType})</span>
        </div>
        {entry.note && (
          <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
            ⚠ {entry.note}
          </div>
        )}
        {entry.outcome && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Pill tone="blue">{t("overview.playbook.table.outcome", { confirmed: entry.outcome.confirmed, refuted: entry.outcome.refuted })}</Pill>
            {entry.demoted ? (
              <Pill tone="amber">{t("overview.playbook.table.demoted")}</Pill>
            ) : entry.status === "approved" && entry.outcome.demoted ? (
              <Pill tone="amber">{t("overview.playbook.table.demotedWarn")}</Pill>
            ) : null}
          </div>
        )}
      </td>
      <td className="px-3 py-3 text-slate-600">
        <div className="space-y-0.5">
          {reasonLines(entry, t, intl).map((line, i) => (
            <div key={i} className={i === reasonLines(entry, t, intl).length - 1 ? "text-xs text-slate-400" : ""}>{line}</div>
          ))}
        </div>
        {entry.evidence.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold text-blue-600">
              {t("overview.playbook.table.evidence", { n: entry.evidence.length })}
            </summary>
            <div className="mt-1.5 space-y-1 text-xs text-slate-500">
              {entry.evidence.map((ev, i) => {
                const v = verdictLabel(ev.verdict, t);
                return (
                  <div key={i} className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-slate-700">{ev.unitName}</span>
                    <span>· {ev.campaignName}</span>
                    <span>· {vnd(ev.cost, intl)}</span>
                    <span>{t("overview.playbook.table.evResults", { n: num(ev.results, undefined, intl) })}</span>
                    <Pill tone={v.tone}>{v.text}</Pill>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="font-medium text-slate-800">{metricLabel(entry.metric, t)}</div>
        {isIntermediate && (
          <div className="mt-1">
            <Pill tone="amber">{t("overview.playbook.table.intermediate")}</Pill>
          </div>
        )}
      </td>
      <td className="px-3 py-3">
        <Pill tone={confidenceLabel(entry.confidence, t).tone}>{confidenceLabel(entry.confidence, t).text}</Pill>
      </td>
      <td className="px-3 py-3">
        <Pill tone={statusInfo.tone}>{statusInfo.text}</Pill>
        {entry.decidedAt && (
          <div className="mt-1 text-[11px] text-slate-400">
            {entry.decidedBy ? `${entry.decidedBy} · ` : ""}
            {datetimeVN(entry.decidedAt, intl)}
          </div>
        )}
      </td>
      <td className="px-3 py-3">
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {actions.map((a) => (
              <Button
                key={a.decision}
                size="sm"
                variant={a.variant ?? "default"}
                disabled={acting}
                onClick={() => onDecide(a.decision)}
              >
                {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                {t(a.label)}
              </Button>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

export function PlaybookTable({
  title,
  description,
  entries,
  accent,
  canDecide,
  actingId,
  onDecide,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  description?: string;
  entries: PlaybookEntry[];
  accent: "use" | "avoid";
  canDecide: boolean;
  actingId: string | null;
  onDecide: (entry: PlaybookEntry, decision: Decision) => void;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      <div
        className={
          accent === "avoid"
            ? "overflow-hidden rounded-xl border border-slate-200 border-l-4 border-l-red-400 bg-white"
            : "overflow-hidden rounded-xl border border-slate-200 bg-white"
        }
      >
        {entries.length === 0 ? (
          <EmptyState compact title={emptyTitle} description={emptyDescription} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="min-w-[200px] px-4 py-2.5 font-medium">{t("overview.playbook.table.thTakeaway")}</th>
                  <th className="min-w-[260px] px-3 py-2.5 font-medium">{t("overview.playbook.table.thWhy")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("overview.playbook.table.thMetric")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("overview.playbook.table.thConfidence")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("overview.playbook.table.thStatus")}</th>
                  <th className="px-3 py-2.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <Row
                    key={e.id}
                    entry={e}
                    canDecide={canDecide}
                    acting={actingId === e.id}
                    onDecide={(decision) => onDecide(e, decision)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
