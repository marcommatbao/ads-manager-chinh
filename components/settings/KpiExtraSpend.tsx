"use client";

// Khoản chi bổ sung theo tháng (Đối tác hỗ trợ / Sản phẩm mới) — lưu trong từng tháng của KPI (extraSpend).
// Kiểu khai báo lại tại chỗ vì lib/settings/kpi-store.ts import "fs" (không dùng được ở client).

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { makeT, type TFunction } from "@/lib/i18n/translate";

export type ExtraSpendKind = "partner_support" | "new_product";
export interface ExtraSpendEntry {
  id: string; company: "MBC" | "MBI"; channel: string; kind: ExtraSpendKind;
  amount: number; note: string; campaignContains?: string;
}
interface MonthLike { adSpendMbc: number; adSpendMbi: number; extraSpend: ExtraSpendEntry[] }
interface ProgressItem { id: string; spent: number | null; campaigns: string[]; reason: string | null }

const KIND_LABEL: Record<ExtraSpendKind, MessageKey> = { partner_support: "creative.settingsKpiExtra.kind.partner_support", new_product: "creative.settingsKpiExtra.kind.new_product" };
const fmt = (v: number, loc: string) => v.toLocaleString(loc);
const INPUT = "w-full rounded-md border px-2 py-1 text-xs focus:outline-none focus:border-amber-400 disabled:bg-slate-50 disabled:text-slate-500";
const ok = "border-slate-200";
const bad = "border-red-400 bg-red-50/40";

function entryProblems(e: EntryLike, t: TFunction): { amount?: string; note?: string; camp?: string } {
  const r: { amount?: string; note?: string; camp?: string } = {};
  if (!(e.amount > 0)) r.amount = t("creative.settingsKpiExtra.prob.amountPositive");
  else if (e.amount > 1e12) r.amount = t("creative.settingsKpiExtra.prob.amountTooBig");
  if (e.note.length > 120) r.note = t("creative.settingsKpiExtra.prob.note");
  // Giống hệt máy chủ (validators/kpi.ts): ô có chữ (kể cả chỉ toàn dấu cách) thì phần đã bỏ khoảng trắng phải 2–60 ký tự.
  const raw = e.campaignContains ?? "";
  if (e.kind === "new_product" && raw !== "" && (raw.trim().length < 2 || raw.length > 60)) {
    r.camp = t("creative.settingsKpiExtra.prob.camp");
  }
  return r;
}
type EntryLike = ExtraSpendEntry;

/** Lỗi nhập liệu của mọi khoản bổ sung — rỗng nghĩa là được phép lưu. */
export function extraSpendErrors(months: { extraSpend: ExtraSpendEntry[] }[], t: TFunction = makeT("vi")): string[] {
  const out: string[] = [];
  months.forEach((m, mi) => {
    if (m.extraSpend.length > 50) out.push(t("creative.settingsKpiExtra.errs.max50", { m: mi + 1 }));
    m.extraSpend.forEach((e, ei) => {
      const p = entryProblems(e, t);
      const at = t("creative.settingsKpiExtra.errs.at", { m: mi + 1, i: ei + 1 });
      if (p.amount) out.push(`${at}: ${p.amount.toLowerCase()}`);
      if (p.note) out.push(t("creative.settingsKpiExtra.errs.note", { at }));
      if (p.camp) out.push(t("creative.settingsKpiExtra.errs.camp", { at }));
    });
  });
  return out;
}

export default function KpiExtraSpend({ year, months, channels, canEdit, onChange }: {
  year: number;
  months: MonthLike[];
  channels: { key: string; label: string; hidden?: boolean }[];
  canEdit: boolean;
  onChange: (monthIndex: number, entries: ExtraSpendEntry[]) => void;
}) {
  const t = useT();
  const loc = useIntlLocale();
  const nowDate = new Date();
  const [sel, setSel] = useState(year === nowDate.getFullYear() ? nowDate.getMonth() : 0);
  const [progress, setProgress] = useState<Record<string, ProgressItem>>({});
  const [loading, setLoading] = useState(false);
  const [progErr, setProgErr] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const monthsRef = useRef(months);
  useEffect(() => { monthsRef.current = months; });

  const entries = months[sel]?.extraSpend ?? [];
  const mNum = sel + 1;
  const hasTracked = entries.some(e => e.kind === "new_product" && (e.campaignContains?.trim().length ?? 0) >= 2);

  const refresh = useCallback(async () => {
    setLoading(true); setProgErr(null);
    try {
      const res = await fetch(`/api/settings/kpi/extra-progress?month=${year}-${String(sel + 1).padStart(2, "0")}`);
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (!res.ok || !json.success) throw new Error(json.error ?? t("creative.settingsKpiExtra.err.progress", { status: res.status }));
      const map: Record<string, ProgressItem> = {};
      for (const it of json.items as ProgressItem[]) map[it.id] = it;
      setProgress(map);
    } catch (err) {
      setProgErr(err instanceof Error ? err.message : t("creative.settingsKpiExtra.err.connection"));
    } finally { setLoading(false); }
  }, [year, sel, t]);

  // Chỉ tự đo khi đổi tháng mà tháng đó đã có khoản "Sản phẩm mới" gắn tên chiến dịch (chạy nền, không chặn trang).
  useEffect(() => {
    setProgress({}); setProgErr(null);
    const has = (monthsRef.current[sel]?.extraSpend ?? []).some(e => e.kind === "new_product" && (e.campaignContains?.trim().length ?? 0) >= 2);
    if (has) void refresh();
  }, [sel, year, refresh]);

  const update = (id: string, patch: Partial<ExtraSpendEntry>) =>
    onChange(sel, entries.map(e => (e.id === id ? { ...e, ...patch } : e)));
  const remove = (id: string) => onChange(sel, entries.filter(e => e.id !== id));
  const visibleCh = channels.filter(c => !c.hidden);
  const add = () => {
    const ch = visibleCh.find(c => c.key === "google") ?? visibleCh[0] ?? channels[0];
    onChange(sel, [...entries, { id: crypto.randomUUID(), company: "MBC", channel: ch?.key ?? "google", kind: "partner_support", amount: 0, note: "" }]);
  };

  const summary = (["MBC", "MBI"] as const).map(co => {
    const fixed = (co === "MBC" ? months[sel]?.adSpendMbc : months[sel]?.adSpendMbi) ?? 0;
    const mine = entries.filter(e => e.company === co && e.amount > 0);
    const partner = mine.filter(e => e.kind === "partner_support").reduce((s, e) => s + e.amount, 0);
    const prod = mine.filter(e => e.kind === "new_product").reduce((s, e) => s + e.amount, 0);
    return { co, fixed, partner, prod, extra: partner + prod };
  }).filter(s => s.fixed > 0 || s.extra > 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-slate-700">{t("creative.settingsKpiExtra.title")}</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          {t("creative.settingsKpiExtra.desc1")}
        </p>
        <p className="text-xs text-slate-500">
          <strong>{t(KIND_LABEL.partner_support)}</strong>{t("creative.settingsKpiExtra.desc2.partner")}{" "}
          <strong>{t(KIND_LABEL.new_product)}</strong>{t("creative.settingsKpiExtra.desc2.product")}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("creative.settingsKpiExtra.pickMonth")}>
        {months.map((m, i) => (
          <button key={i} type="button" onClick={() => setSel(i)} aria-pressed={i === sel}
            className={cn("relative px-3 py-1 rounded-lg border text-xs font-semibold",
              i === sel ? "bg-amber-500 border-amber-500 text-amber-950" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")}>
            {t("creative.settingsKpiExtra.monthShort", { n: i + 1 })}
            {m.extraSpend.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-slate-800 text-white text-[10px]">{m.extraSpend.length}</span>
            )}
          </button>
        ))}
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-slate-400">{t("creative.settingsKpiExtra.empty", { m: mNum })}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[1000px]">
            <thead>
              <tr className="text-left text-[11px] text-slate-400 uppercase">
                {[t("creative.settingsKpiExtra.th.company"), t("creative.settingsKpiExtra.th.channel"), t("creative.settingsKpiExtra.th.kind"), t("creative.settingsKpiExtra.th.amount"), t("creative.settingsKpiExtra.th.note"), t("creative.settingsKpiExtra.th.camp"), t("creative.settingsKpiExtra.th.spent"), ""].map(h => <th key={h} className="px-1.5 py-1 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {entries.map((e, idx) => {
                const p = entryProblems(e, t);
                const isNew = e.kind === "new_product";
                const pr = progress[e.id];
                const base = `kpi-extra-${year}-${mNum}-${e.id}`;
                const opts = channels.filter(c => !c.hidden || c.key === e.channel);
                const hasCamp = isNew && (e.campaignContains?.trim().length ?? 0) >= 2;
                return (
                  <tr key={e.id} className="border-t border-slate-100 align-top">
                    <td className="px-1.5 py-1.5 w-24">
                      <select id={`${base}-company`} aria-label={t("creative.settingsKpiExtra.aria.company", { i: idx + 1 })} disabled={!canEdit} value={e.company}
                        onChange={ev => update(e.id, { company: ev.target.value === "MBI" ? "MBI" : "MBC" })} className={cn(INPUT, ok)}>
                        <option value="MBC">MBC</option><option value="MBI">MBI</option>
                      </select>
                    </td>
                    <td className="px-1.5 py-1.5 w-32">
                      <select id={`${base}-channel`} aria-label={t("creative.settingsKpiExtra.aria.channel", { i: idx + 1 })} disabled={!canEdit} value={e.channel}
                        onChange={ev => update(e.id, { channel: ev.target.value })} className={cn(INPUT, ok)}>
                        {opts.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                    </td>
                    <td className="px-1.5 py-1.5 w-36">
                      <select id={`${base}-kind`} aria-label={t("creative.settingsKpiExtra.aria.kind", { i: idx + 1 })} disabled={!canEdit} value={e.kind}
                        onChange={ev => {
                          const kind: ExtraSpendKind = ev.target.value === "new_product" ? "new_product" : "partner_support";
                          update(e.id, kind === "new_product" ? { kind } : { kind, campaignContains: undefined });
                        }} className={cn(INPUT, ok)}>
                        {(Object.keys(KIND_LABEL) as ExtraSpendKind[]).map(k => <option key={k} value={k}>{t(KIND_LABEL[k])}</option>)}
                      </select>
                    </td>
                    <td className="px-1.5 py-1.5 w-36">
                      <input id={`${base}-amount`} aria-label={t("creative.settingsKpiExtra.aria.amount", { i: idx + 1 })} type="number" min={0} disabled={!canEdit}
                        value={e.amount || ""} placeholder="0" onChange={ev => update(e.id, { amount: Math.max(0, Number(ev.target.value) || 0) })}
                        className={cn(INPUT, "text-right tabular-nums", p.amount ? bad : ok)} />
                      <p className={cn("mt-0.5 text-[10px] text-right", p.amount ? "text-red-600" : "text-slate-400")}>{p.amount ?? `${fmt(e.amount, loc)}đ`}</p>
                    </td>
                    <td className="px-1.5 py-1.5 w-52">
                      <input id={`${base}-note`} aria-label={t("creative.settingsKpiExtra.aria.note", { i: idx + 1 })} type="text" disabled={!canEdit} value={e.note}
                        placeholder={isNew ? t("creative.settingsKpiExtra.note.phNew") : t("creative.settingsKpiExtra.note.phPartner")}
                        onChange={ev => update(e.id, { note: ev.target.value })} className={cn(INPUT, p.note ? bad : ok)} />
                      {p.note && <p className="mt-0.5 text-[10px] text-red-600">{p.note}</p>}
                    </td>
                    <td className="px-1.5 py-1.5 w-44">
                      <input id={`${base}-camp`} aria-label={t("creative.settingsKpiExtra.aria.camp", { i: idx + 1 })} type="text" disabled={!canEdit || !isNew}
                        value={e.campaignContains ?? ""} placeholder={isNew ? t("creative.settingsKpiExtra.camp.ph") : "—"}
                        onChange={ev => update(e.id, { campaignContains: ev.target.value || undefined })} className={cn(INPUT, p.camp ? bad : ok)} />
                      {p.camp && <p className="mt-0.5 text-[10px] text-red-600">{p.camp}</p>}
                    </td>
                    <td className="px-1.5 py-1.5 w-56">
                      {!isNew || !hasCamp ? <span className="text-slate-300">—</span> : loading ? (
                        <span className="text-slate-400">{t("creative.settingsKpiExtra.measuring")}</span>
                      ) : !pr ? <span className="text-slate-300">—</span> : pr.spent === null ? (
                        <span className="text-amber-600">{pr.reason ?? t("creative.settingsKpiExtra.notMeasured")}</span>
                      ) : (
                        <div>
                          <p className="tabular-nums text-slate-700">{fmt(pr.spent, loc)}đ / {fmt(e.amount, loc)}đ</p>
                          <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className={cn("h-full", pr.spent > e.amount ? "bg-red-500" : "bg-amber-500")}
                              style={{ width: `${e.amount > 0 ? Math.min(100, (pr.spent / e.amount) * 100) : 0}%` }} />
                          </div>
                          <button type="button" onClick={() => setOpenIds(o => ({ ...o, [e.id]: !o[e.id] }))}
                            aria-expanded={!!openIds[e.id]} className="mt-1 flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-amber-600">
                            {openIds[e.id] ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            {t("creative.settingsKpiExtra.matched", { n: pr.campaigns.length })}
                          </button>
                          {openIds[e.id] && (
                            <ul className="mt-0.5 list-disc pl-4 text-[10px] text-slate-500 space-y-0.5">
                              {pr.campaigns.map(c => <li key={c}>{c}</li>)}
                            </ul>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-1.5 py-1.5 w-10">
                      {canEdit && (
                        <button type="button" aria-label={t("creative.settingsKpiExtra.remove")} title={t("creative.settingsKpiExtra.remove")} onClick={() => remove(e.id)}
                          className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <button type="button" onClick={add}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 text-amber-950 text-xs font-semibold hover:bg-amber-600">
            <Plus className="h-3.5 w-3.5" />{t("creative.settingsKpiExtra.add")}
          </button>
        )}
        {hasTracked && (
          <>
            <button type="button" onClick={() => void refresh()} disabled={loading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />{t("creative.settingsKpiExtra.refresh")}
            </button>
            <span className="text-[10px] text-slate-400">{t("creative.settingsKpiExtra.spentNote")}</span>
          </>
        )}
        {progErr && <span className="text-xs text-amber-700" role="alert">{progErr}</span>}
      </div>

      {summary.length > 0 && (
        <ul className="text-xs text-slate-600 space-y-0.5 border-t border-slate-100 pt-2">
          {summary.map(s => (
            <li key={s.co}>
              {t("creative.settingsKpiExtra.cap.pre", { co: s.co, m: mNum })}<strong>{fmt(s.fixed, loc)}đ</strong>{t("creative.settingsKpiExtra.cap.fixed")}<strong>{fmt(s.extra, loc)}đ</strong>{t("creative.settingsKpiExtra.cap.extra")}<strong>{fmt(s.fixed + s.extra, loc)}đ</strong>
              {s.extra > 0 && <>{t("creative.settingsKpiExtra.cap.breakdown", { partner: fmt(s.partner, loc), prod: fmt(s.prod, loc) })}</>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
