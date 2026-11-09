"use client";

import Link from "next/link";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { vnd, ddmmyyyy, datetimeVN } from "@/components/case/format";
import type { NumbersCheckResult } from "@/lib/jobs/numbers-check";
import { Badge, NUMBERS_STATUS_META } from "./badges";
import { useT, useIntlLocale } from "@/lib/i18n/client";

export function NumbersCheckTable({ numbersCheck }: { numbersCheck: NumbersCheckResult | null }) {
  const intl = useIntlLocale();
  const t = useT();
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
      <p className="text-sm font-semibold text-slate-800">{t("overview.health.numbers.title")}</p>

      {!numbersCheck ? (
        <p className="text-sm text-slate-400">
          {t("overview.health.numbers.empty1")} ({t("overview.health.numbers.empty2")}{" "}
          <Link href="/settings/jobs" className="text-blue-600 hover:underline">{t("overview.health.numbers.empty3")}</Link>).
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            {t("overview.health.numbers.range", { from: ddmmyyyy(numbersCheck.range.from, intl), to: ddmmyyyy(numbersCheck.range.to, intl), time: datetimeVN(numbersCheck.at, intl) })}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("overview.health.numbers.th.company")}</TableHead>
                <TableHead>{t("overview.health.numbers.th.metric")}</TableHead>
                <TableHead>{t("overview.health.numbers.th.tool")}</TableHead>
                <TableHead>{t("overview.health.numbers.th.reference")}</TableHead>
                <TableHead>{t("overview.health.numbers.th.diff")}</TableHead>
                <TableHead>{t("overview.health.numbers.th.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {numbersCheck.checks.map((c, i) => {
                const meta = NUMBERS_STATUS_META[c.status];
                return (
                  <TableRow key={`${c.company}-${c.name}-${i}`}>
                    <TableCell className="text-xs font-medium text-slate-700">{c.company}</TableCell>
                    <TableCell className="whitespace-normal max-w-[220px] text-xs text-slate-600">{c.name}</TableCell>
                    <TableCell className="text-xs tabular-nums text-slate-700">{vnd(c.tool, intl)}</TableCell>
                    <TableCell className="text-xs tabular-nums text-slate-700">{vnd(c.reference, intl)}</TableCell>
                    <TableCell className="text-xs tabular-nums text-slate-600">
                      {c.diff === null ? "—" : `${Math.round(c.diff * 100)}%`}
                    </TableCell>
                    <TableCell>
                      <Badge cls={meta.cls}>{t(meta.label)}</Badge>
                      {c.note && c.status === "loi" && (
                        <p className="text-[11px] text-slate-400 mt-0.5">{c.note}</p>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}
