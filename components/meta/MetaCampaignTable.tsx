"use client";

// ============================================================
// Bảng chiến dịch của /meta-xray — sắp theo chi phí mặc định, bấm cột khác để
// đổi. Bấm một dòng để mở rộng xem đầy đủ text của các cờ (chip chỉ hiện icon).
// ============================================================

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import { vnd, num, pct } from "@/components/case/format";
import type { MetaCampaignXray } from "@/lib/meta/xray";

type SortKey = "name" | "spend" | "purchases" | "click" | "view" | "cpaClick" | "cpaMeta" | "frequency";
type SortDir = "asc" | "desc";

/** "CHỈ XEM" / lệch GA4 tốn tiền hơn hẳn tần suất cao hay sai sự kiện tối ưu — tô đỏ hai loại đó, còn lại tô amber. */
function flagTone(text: string): "red" | "amber" {
  return /CHỈ XEM|GA4/.test(text) ? "red" : "amber";
}

function FlagChip({ text }: { text: string }) {
  const red = flagTone(text) === "red";
  return (
    <span
      className={cn("inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold",
        red ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700")}
      title={text}
    >
      {red ? "✕" : "⚠"}
    </span>
  );
}

function ClickViewBar({ click, view }: { click: number | null; view: number | null }) {
  const c = click ?? 0, v = view ?? 0, total = c + v;
  const cPct = total > 0 ? (c / total) * 100 : 0;
  return (
    <div className="flex h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-amber-200" aria-hidden="true">
      {total > 0 && <span className="h-full bg-blue-500" style={{ width: `${cPct}%` }} />}
    </div>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir | null }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 text-slate-300" aria-hidden="true" />;
  return dir === "asc" ? <ChevronUp className="h-3 w-3 text-indigo-600" aria-hidden="true" /> : <ChevronDown className="h-3 w-3 text-indigo-600" aria-hidden="true" />;
}

function Th({ col, label, align = "left", sortKey, sortDir, onSort }: {
  col: SortKey; label: string; align?: "left" | "right"; sortKey: SortKey; sortDir: SortDir; onSort: (col: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <th className={cn("px-3 py-2 font-medium", align === "right" && "text-right")} aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(col)} className={cn("inline-flex items-center gap-1 hover:text-slate-700", align === "right" && "w-full justify-end")}>
        {label}<SortIcon active={active} dir={active ? sortDir : null} />
      </button>
    </th>
  );
}

function CampaignRow({ c, open, onToggle }: { c: MetaCampaignXray; open: boolean; onToggle: () => void }) {
  const intl = useIntlLocale();
  const t = useT();
  const wrongOpt = !!c.optEvent && c.optEvent !== "PURCHASE" && c.optEvent !== "LEAD";
  return (
    <>
      <tr className="cursor-pointer border-b border-slate-50 align-top last:border-0 hover:bg-slate-50" onClick={onToggle}>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            {open ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />}
            <span className="max-w-[220px] truncate font-medium text-slate-800" title={c.name}>{c.name}</span>
          </div>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{vnd(c.spend, intl)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{num(c.purchases, { maximumFractionDigits: 1 }, intl)}</td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <ClickViewBar click={c.click} view={c.view} />
            <span className="whitespace-nowrap tabular-nums text-slate-600">{t("meta.xray.tbl.clicksViews", { click: c.click ?? "—", view: c.view ?? "—" })}</span>
          </div>
          {c.viewShare !== null && <span className="text-[10px] text-slate-400">{t("meta.xray.tbl.viewShare", { pct: pct(c.viewShare, 0, intl) })}</span>}
        </td>
        <td className="px-3 py-2.5 text-right">
          <div className="tabular-nums font-semibold text-slate-800">{vnd(c.cpaClick, intl)}</div>
          <div className="tabular-nums text-[10px] text-slate-400">{t("meta.xray.tbl.metaReports", { value: vnd(c.cpaMeta, intl) })}</div>
        </td>
        <td className="px-3 py-2.5">
          <span className={cn(wrongOpt && "font-semibold text-amber-700")}>{c.optEventLabel ?? c.optEvent ?? "—"}</span>
        </td>
        <td className="px-3 py-2.5 text-slate-500">{c.attribution}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{c.frequency !== null ? num(c.frequency, { maximumFractionDigits: 1 }, intl) : "—"}</td>
        <td className="px-3 py-2.5">
          {c.utm.length ? <span className="text-slate-600">{c.utm.join(", ")}</span> : <span className="text-slate-300">—</span>}
          {c.utmShared && <span className="ml-1 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">{t("meta.xray.tbl.shared")}</span>}
          <div className="text-[10px] text-slate-400">GA4: {c.ga4Purchases !== null ? num(c.ga4Purchases, { maximumFractionDigits: 1 }, intl) : "—"}</div>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex flex-wrap gap-1">{c.flags.map((f, i) => <FlagChip key={i} text={f} />)}</div>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-slate-50 bg-slate-50/50 last:border-0">
          <td colSpan={10} className="p-3">
            {c.flags.length > 0 ? (
              <ul className="space-y-1 text-xs">
                {c.flags.map((f, i) => (
                  <li key={i} className={cn("flex gap-1.5", flagTone(f) === "red" ? "text-red-700" : "text-amber-700")}>
                    <span className="shrink-0 font-bold">{flagTone(f) === "red" ? "✕" : "⚠"}</span><span>{f}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">{t("meta.xray.tbl.noFlags")}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function MetaCampaignTable({ campaigns }: { campaigns: MetaCampaignXray[] }) {
  const t = useT();
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [openId, setOpenId] = useState<string | null>(null);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  const rows = useMemo(() => {
    const val = (c: MetaCampaignXray): number | string => {
      switch (sortKey) {
        case "name": return c.name;
        case "spend": return c.spend;
        case "purchases": return c.purchases;
        case "click": return c.click ?? -1;
        case "view": return c.view ?? -1;
        case "cpaClick": return c.cpaClick ?? Infinity;
        case "cpaMeta": return c.cpaMeta ?? Infinity;
        case "frequency": return c.frequency ?? -1;
      }
    };
    return [...campaigns].sort((a, b) => {
      const av = val(a), bv = val(b);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [campaigns, sortKey, sortDir]);

  if (campaigns.length === 0) {
    return <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">{t("meta.xray.tbl.empty")}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[1180px] text-xs">
        <thead>
          <tr className="border-b border-slate-100 text-left text-[11px] text-slate-500">
            <Th col="name" label={t("meta.xray.tbl.campaign")} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <Th col="spend" label={t("meta.xray.tbl.spend")} align="right" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <Th col="purchases" label={t("meta.xray.tbl.metaOrders")} align="right" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <th className="px-3 py-2 font-medium">{t("meta.xray.tbl.clickView")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("meta.xray.tbl.cpa")}</th>
            <th className="px-3 py-2 font-medium">{t("meta.xray.tbl.optEvent")}</th>
            <th className="px-3 py-2 font-medium">{t("meta.xray.tbl.attribution")}</th>
            <Th col="frequency" label={t("meta.xray.tbl.frequency")} align="right" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <th className="px-3 py-2 font-medium">UTM · GA4</th>
            <th className="px-3 py-2 font-medium">{t("meta.xray.tbl.flags")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => <CampaignRow key={c.id} c={c} open={openId === c.id} onToggle={() => setOpenId((id) => (id === c.id ? null : c.id))} />)}
        </tbody>
      </table>
    </div>
  );
}
