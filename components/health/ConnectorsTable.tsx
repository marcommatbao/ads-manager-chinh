"use client";

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import type { HealthConnector } from "./types";
import { Badge, CONNECTOR_STATUS_META } from "./badges";
import { absTime } from "./format";
import { useT, useIntlLocale } from "@/lib/i18n/client";

export function ConnectorsTable({ connectors }: { connectors: HealthConnector[] }) {
  const intl = useIntlLocale();
  const t = useT();
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
      <p className="text-sm font-semibold text-slate-800">{t("overview.health.connectors.title")}</p>
      {connectors.length === 0 ? (
        <p className="text-sm text-slate-400">{t("overview.health.connectors.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("overview.health.connectors.title")}</TableHead>
              <TableHead>{t("overview.health.connectors.th.status")}</TableHead>
              <TableHead>{t("overview.health.connectors.th.reason")}</TableHead>
              <TableHead>{t("overview.health.connectors.th.lastChecked")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connectors.map((c) => {
              const meta = CONNECTOR_STATUS_META[c.status];
              return (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs text-slate-700">{c.id}</TableCell>
                  <TableCell><Badge cls={meta.cls}>{t(meta.label)}</Badge></TableCell>
                  <TableCell className="whitespace-normal max-w-[280px] text-xs text-slate-500">{c.reason ?? "—"}</TableCell>
                  <TableCell className="text-xs text-slate-500">{absTime(c.lastChecked, intl)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
