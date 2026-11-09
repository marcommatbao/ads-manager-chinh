"use client";

// ============================================================
// Dashboard → "📈 Diễn biến" (Đợt 28)
// So kỳ này với kỳ liền trước (cùng số ngày): thẻ KPI, biểu đồ theo ngày kèm mốc "đã làm gì",
// và "Đáng chú ý". Dữ liệu: GET /api/dashboard/trends. Chỉ import type/giá trị thuần từ lib (không fs).
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill, type PillTone } from "@/components/measure/Pill";
import { DateRangeControl, type DateRangeValue } from "@/components/DateRangeControl";
import { num, vnd } from "@/components/case/format";
import { getJson, ApiError } from "@/components/case/api";
import { useSession } from "@/components/SessionProvider";
import { resolveCompanyScope } from "@/lib/permissions";
import { orderedCompanyIds, companyLabel } from "@/lib/companies/registry";
import { DEFAULT_VIEW_DAYS, MAX_RANGE_DAYS, lastDays } from "@/lib/case/dates";
import { VERDICT_LABEL, type Verdict } from "@/lib/writes/verdict";
import type { Card, Notable, TrendDay } from "@/lib/trends/build";
import type { BTable, BRowOut } from "@/lib/trends/breakdown";
import { cn } from "@/lib/utils";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { TFunction } from "@/lib/i18n/translate";

type PlatformFilter = "all" | "meta" | "google";
type Range = { from: string; to: string };
type TrendMarker = { date: string; platform: string; label: string; by: string; verdict7: Verdict | null; verdict14: Verdict | null };
type TrendsResponse = {
  success: true;
  company: string;
  platform: PlatformFilter;
  range: Range;
  prevRange: Range;
  errors: { platform: string; error: string }[];
  cards: Card[];
  days: TrendDay[];
  markers: TrendMarker[];
  notable: { good: Notable[]; watch: Notable[] };
};

const PLATFORMS: { value: PlatformFilter; label: MessageKey | null }[] = [
  { value: "all", label: "overview.trends.both" },
  { value: "meta", label: null },
  { value: "google", label: null },
];
const PLATFORM_NAME: Record<string, string> = { meta: "Meta", google: "Google" };

const CHANGE_BADGE: Record<Card["change"], { tone: PillTone; text: MessageKey } | null> = {
  real_better: { tone: "green", text: "overview.trends.betterReal" },
  real_worse: { tone: "red", text: "overview.trends.worseReal" },
  noise: { tone: "grey", text: "overview.trends.noise" },
  few: { tone: "grey", text: "overview.trends.few" },
  none: null,
};

const ddmm = (ymd: string) => (ymd.length >= 10 ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` : ymd);
const shortVnd = (n: number, loc: string, t: TFunction) => {
  const a = Math.abs(n);
  const f = (x: number) => x.toLocaleString(loc, { maximumFractionDigits: 1 });
  if (a >= 1e9) return t("overview.trends.unitB", { v: f(n / 1e9) });
  if (a >= 1e6) return t("overview.trends.unitM", { v: f(n / 1e6) });
  if (a >= 1e3) return `${f(n / 1e3)}k`;
  return f(n);
};
const fmtCard = (n: number | null, unit: Card["unit"], loc: string) =>
  n === null ? "—" : unit === "vnd" ? vnd(n, loc) : unit === "pct" ? `${n.toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : num(n, undefined, loc);
const verdictText = (v: Verdict | null, t: TFunction) => (v ? VERDICT_LABEL[v] : t("overview.trends.notMeasured"));

function KpiCard({ card }: { card: Card }) {
  const t = useT();
  const loc = useIntlLocale();
  const badge = CHANGE_BADGE[card.change];
  const pctTxt = card.changePct === null ? null : `${card.changePct > 0 ? "▲" : card.changePct < 0 ? "▼" : "="} ${Math.abs(card.changePct).toLocaleString(loc, { maximumFractionDigits: 1 })}%`;
  const tone = card.change === "real_better" ? "text-emerald-600" : card.change === "real_worse" ? "text-red-600" : "text-slate-500";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5" title={card.note ?? undefined}>
      <div className="text-xs text-slate-500">{card.label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums text-slate-900">{fmtCard(card.cur, card.unit, loc)}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
        <span>{t("overview.trends.prevPeriod", { v: fmtCard(card.prev, card.unit, loc) })}</span>
        {pctTxt && <span className={cn("font-semibold tabular-nums", tone)}>{pctTxt}</span>}
      </div>
      {badge && <div className="mt-1.5"><Pill tone={badge.tone}>{t(badge.text)}</Pill></div>}
      {card.note && <div className="mt-1 text-[11px] leading-snug text-slate-400">{card.note}</div>}
    </div>
  );
}

function NotableList({ title, tone, items }: { title: string; tone: "good" | "watch"; items: Notable[] }) {
  const t = useT();
  return (
    <div className={cn("rounded-xl border p-3.5", tone === "good" ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/40")}>
      <h3 className={cn("text-sm font-bold", tone === "good" ? "text-emerald-700" : "text-red-700")}>{tone === "good" ? "✓ " : "⚠ "}{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">{t("overview.trends.noCampaigns")}</p>
      ) : (
        <ul className="mt-2 space-y-2.5">
          {items.map((it) => (
            <li key={`${it.platform}-${it.id}`} className="rounded-lg border border-slate-200 bg-white p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">{it.name}</span>
                <Pill tone={it.platform === "meta" ? "blue" : "amber"}>{PLATFORM_NAME[it.platform] ?? it.platform}</Pill>
              </div>
              <p className="mt-1 text-xs text-slate-600">{it.reason}</p>
              <Link href={`/xu-ly?platform=${it.platform === "meta" ? "facebook" : "google"}`} className="mt-1 inline-block text-xs font-medium text-blue-600 hover:underline">
                {t("overview.trends.openActions")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type BreakdownResponse = { success: true; tables: BTable[]; errors: { platform: string; error: string }[] };

// dim bắt đầu bằng "google_" hoặc "meta_"; Meta trước, Google sau.
const tablePlatform = (t: BTable): "meta" | "google" => (t.dim.startsWith("google_") ? "google" : "meta");

function BreakdownRow({ row, kind }: { row: BRowOut; kind: BTable["kind"] }) {
  const t = useT();
  const loc = useIntlLocale();
  const pct = Math.max(0, Math.min(100, row.share * 100));
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="py-2 pr-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-slate-800">{row.label}</span>
          {row.tag === "dat_ro" && <Pill tone="red">{t("overview.trends.tagExpensive")}</Pill>}
          {row.tag === "re_ro" && <Pill tone="green">{t("overview.trends.tagCheap")}</Pill>}
        </div>
        {row.note && <div className="mt-0.5 text-[11px] leading-snug text-slate-500">{row.note}</div>}
      </td>
      <td className="min-w-[110px] py-2 pr-3">
        <div className="text-xs tabular-nums text-slate-700">{pct.toLocaleString(loc, { maximumFractionDigits: 1 })}%</div>
        <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100" aria-hidden="true">
          <div className="h-1.5 rounded-full bg-blue-400" style={{ width: `${pct}%` }} />
        </div>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{vnd(row.spend, loc)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{num(row.results, undefined, loc)} <span className="text-xs text-slate-400">{kind === "sales" ? t("overview.trends.unitPurchases") : t("overview.trends.unitLeads")}</span></td>
      <td className="py-2 pr-3 text-right tabular-nums">{row.costPerResult === null ? "—" : vnd(row.costPerResult, loc)}</td>
      <td className="py-2 text-right tabular-nums">{row.ctr === null ? "—" : `${row.ctr.toLocaleString(loc, { maximumFractionDigits: 2 })}%`}</td>
    </tr>
  );
}

function BreakdownSection({ company, platform, from, to }: { company: string; platform: PlatformFilter; from: string; to: string }) {
  const t = useT();
  const [res, setRes] = useState<BreakdownResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setRes(null); setErr(null); }, [company, platform, from, to]);

  const run = async (force: boolean) => {
    if (!company) return;
    setBusy(true);
    setErr(null);
    try {
      const json = await getJson(`/api/dashboard/trends/breakdown?company=${company}&platform=${platform}&from=${from}&to=${to}${force ? "&force=1" : ""}`);
      setRes(json);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("overview.trends.bdErr"));
    } finally {
      setBusy(false);
    }
  };

  const groups = (["meta", "google"] as const).map((pf) => ({
    pf,
    tables: (res?.tables ?? []).filter((t) => tablePlatform(t) === pf).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "sales" ? -1 : 1)),
  })).filter((g) => g.tables.length > 0);

  return (
    <section aria-label={t("overview.trends.bdTitle")} className="space-y-3">
      <h3 className="text-sm font-bold text-slate-800">{t("overview.trends.bdTitle")}</h3>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
        <p className="max-w-2xl text-sm text-slate-600">
          {t("overview.trends.bdDesc")}
        </p>
        <Button variant="outline" size="sm" onClick={() => run(!!res)} disabled={busy || !company}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} {res ? t("overview.trends.bdReload") : t("overview.trends.bdRun")}
        </Button>
      </div>

      {err && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {err}
        </div>
      )}

      {res && (
        <div className={cn("space-y-4", busy && "opacity-60")}>
          {res.errors.map((e) => (
            <div key={e.platform} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span><b>{PLATFORM_NAME[e.platform] ?? e.platform}:</b> {e.error}</span>
            </div>
          ))}
          {groups.length === 0 && res.errors.length === 0 && (
            <p className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500">{t("overview.trends.bdEmpty")}</p>
          )}
          {groups.map((g) => (
            <div key={g.pf} className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">{PLATFORM_NAME[g.pf]}</h4>
              {g.tables.map((tb) => (
                <div key={`${g.pf}-${tb.dim}`} className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <h5 className="text-sm font-semibold text-slate-800">{tb.title}</h5>
                  {tb.totalResults === 0 && <p className="mt-1 text-xs text-slate-400">{t("overview.trends.bdNoResults")}</p>}
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead>
                        <tr className="text-left text-xs text-slate-400">
                          <th className="pb-1.5 pr-3 font-medium">{t("overview.trends.thGroup")}</th>
                          <th className="pb-1.5 pr-3 font-medium">{t("overview.trends.thSpendPct")}</th>
                          <th className="pb-1.5 pr-3 text-right font-medium">{t("overview.trends.thCost")}</th>
                          <th className="pb-1.5 pr-3 text-right font-medium">{t("overview.trends.thResults")}</th>
                          <th className="pb-1.5 pr-3 text-right font-medium">{t("overview.trends.thCostPerResult")}</th>
                          <th className="pb-1.5 text-right font-medium">CTR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tb.rows.map((r) => <BreakdownRow key={r.key} row={r} kind={tb.kind} />)}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ))}
          <p className="text-xs text-slate-500">{t("overview.trends.bdFootnote")}</p>
        </div>
      )}
    </section>
  );
}

export function TrendsTab() {
  const t = useT();
  const loc = useIntlLocale();
  const { user } = useSession();
  const allowedCompanies = resolveCompanyScope(user?.companies, user?.role);
  const [company, setCompany] = useState<string>(() => orderedCompanyIds(["MBC", "MBI"])[0] ?? "");
  const effectiveCompany = allowedCompanies.includes(company) ? company : allowedCompanies[0];
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [range, setRange] = useState<DateRangeValue>(() => lastDays(DEFAULT_VIEW_DAYS));
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force?: boolean) => {
    if (!effectiveCompany) { setLoading(false); return; }
    if (force) setPulling(true); else setLoading(true);
    setError(null);
    try {
      const json = await getJson(`/api/dashboard/trends?company=${effectiveCompany}&platform=${platform}&from=${range.from}&to=${range.to}${force ? "&force=1" : ""}`);
      setData(json);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("overview.trends.loadErr"));
      setData(null);
    } finally {
      setLoading(false);
      setPulling(false);
    }
  }, [effectiveCompany, platform, range.from, range.to, t]);

  useEffect(() => { load(); }, [load]);

  const hasSeries = useMemo(() => ({
    purchases: !!data?.days.some((d) => d.purchases > 0),
    leads: !!data?.days.some((d) => d.leads > 0),
  }), [data]);
  const dateSet = useMemo(() => new Set((data?.days ?? []).map((d) => d.date)), [data]);
  const markersByDate = useMemo(() => {
    const m = new Map<string, TrendMarker[]>();
    for (const x of data?.markers ?? []) m.set(x.date, [...(m.get(x.date) ?? []), x]);
    return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [data]);
  const hasRight = hasSeries.purchases || hasSeries.leads;
  const prevOk = !!data && dateSet.has(data.prevRange.from) && dateSet.has(data.prevRange.to);

  return (
    <div className="space-y-6 pt-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">{t("overview.trends.title")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">{t("overview.trends.subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="mb-1 text-xs font-medium text-slate-400">{t("overview.trends.platform")}</div>
          <div role="tablist" aria-label={t("overview.trends.platform")} className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {PLATFORMS.map((p) => (
              <button key={p.value} role="tab" aria-selected={platform === p.value} onClick={() => setPlatform(p.value)}
                className={cn("rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", platform === p.value ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50")}>
                {p.label ? t(p.label) : PLATFORM_NAME[p.value]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-400">{t("overview.trends.company")}</div>
          <div role="tablist" aria-label={t("overview.trends.company")} className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {orderedCompanyIds(["MBC", "MBI"]).map((v) => {
              const allowed = allowedCompanies.includes(v);
              return (
                <button key={v} role="tab" aria-selected={effectiveCompany === v} disabled={!allowed} onClick={() => setCompany(v)}
                  className={cn("rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", effectiveCompany === v ? "bg-blue-600 text-white" : allowed ? "text-slate-600 hover:bg-slate-50" : "cursor-not-allowed text-slate-300")}>
                  {v === "MBC" || v === "MBI" ? v : companyLabel(v)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeControl value={range} onChange={setRange} maxDays={MAX_RANGE_DAYS} />
          <Button className="h-10" variant="outline" size="sm" onClick={() => load(true)} disabled={loading || pulling}>
            {pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} {t("overview.trends.refreshNew")}
          </Button>
        </div>
      </div>
      {data && (
        <p className="-mt-3 text-xs text-slate-500">
          {t("overview.trends.compare", { from: ddmm(data.prevRange.from), to: ddmm(data.prevRange.to) })}
        </p>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
        </div>
      )}

      {loading && !data && (
        <div className="space-y-4" aria-busy="true">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}
          </div>
          <div className="h-72 animate-pulse rounded-xl bg-slate-100" />
        </div>
      )}

      {data && (
        <div className={cn("space-y-6", (loading || pulling) && "opacity-60")}>
          {data.errors.map((e) => (
            <div key={e.platform} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span><b>{PLATFORM_NAME[e.platform] ?? e.platform}:</b> {e.error}</span>
            </div>
          ))}

          {data.days.length === 0 ? (
            <EmptyState title={t("overview.trends.emptyTitle")} description={t("overview.trends.emptyDesc")} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                {data.cards.map((c) => <KpiCard key={c.key} card={c} />)}
              </div>

              <section aria-label={t("overview.trends.chartAria")} className="rounded-xl border border-slate-200 bg-white p-3">
                <h3 className="mb-2 text-sm font-bold text-slate-800">{t("overview.trends.byDay")}</h3>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.days} margin={{ top: 16, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tickFormatter={ddmm} tick={{ fontSize: 11 }} minTickGap={24} />
                      <YAxis yAxisId="left" tickFormatter={(v: number) => shortVnd(v, loc, t)} tick={{ fontSize: 11 }} width={44} />
                      {hasRight && <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={{ fontSize: 11 }} width={28} />}
                      {prevOk && (
                        <ReferenceArea yAxisId="left" x1={data.prevRange.from} x2={data.prevRange.to} fill="#94a3b8" fillOpacity={0.12}
                          label={{ value: t("overview.trends.refPrev"), position: "insideTopLeft", fontSize: 11, fill: "#64748b" }} />
                      )}
                      {dateSet.has(data.range.from) && (
                        <ReferenceLine yAxisId="left" x={data.range.from} stroke="#64748b" label={{ value: t("overview.trends.refCur"), position: "insideTopRight", fontSize: 11, fill: "#64748b" }} />
                      )}
                      {markersByDate.filter(([d]) => dateSet.has(d)).map(([d]) => (
                        <ReferenceLine key={d} yAxisId="left" x={d} stroke="#f59e0b" strokeDasharray="4 3" />
                      ))}
                      <Tooltip
                        labelFormatter={(l) => ddmm(String(l))}
                        formatter={(v, name) => [name === t("overview.trends.thCost") ? vnd(Number(v), loc) : num(Number(v), undefined, loc), name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar yAxisId="left" dataKey="spend" name={t("overview.trends.thCost")} fill="#93c5fd" />
                      {hasSeries.purchases && <Line yAxisId="right" type="monotone" dataKey="purchases" name={t("overview.trends.serPurchases")} stroke="#059669" strokeWidth={2} dot={false} />}
                      {hasSeries.leads && <Line yAxisId="right" type="monotone" dataKey="leads" name={t("overview.trends.serLeads")} stroke="#7c3aed" strokeWidth={2} dot={false} />}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {markersByDate.length > 0 && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <div className="text-xs font-semibold text-amber-700">{t("overview.trends.markerHint")}</div>
                    <ul className="mt-1.5 space-y-1 text-xs text-slate-600">
                      {markersByDate.flatMap(([d, list]) => list.map((m, i) => (
                        <li key={`${d}-${i}`}>
                          {t("overview.trends.markerLine", { date: ddmm(d), label: m.label, by: m.by, v7: verdictText(m.verdict7, t), v14: verdictText(m.verdict14, t) })}
                        </li>
                      )))}
                    </ul>
                  </div>
                )}
              </section>
            </>
          )}

          <section aria-label={t("overview.trends.notable")}>
            <h3 className="mb-2 text-sm font-bold text-slate-800">{t("overview.trends.notable")}</h3>
            {data.notable.good.length === 0 && data.notable.watch.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500">
                {t("overview.trends.notableEmpty")}
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <NotableList title={t("overview.trends.good")} tone="good" items={data.notable.good} />
                <NotableList title={t("overview.trends.watch")} tone="watch" items={data.notable.watch} />
              </div>
            )}
          </section>

          <BreakdownSection company={effectiveCompany ?? ""} platform={platform} from={range.from} to={range.to} />
        </div>
      )}
    </div>
  );
}
