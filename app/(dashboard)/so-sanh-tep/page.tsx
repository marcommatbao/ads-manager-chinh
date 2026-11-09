"use client";

// ============================================================
// So sánh tệp đối tượng (Meta) — Đợt 26
// ------------------------------------------------------------
// Chọn 2–3 chiến dịch Meta, so các NHÓM quảng cáo bên trong theo chi phí mỗi kết quả, chọn nhóm thắng và lưu làm
// "tệp thắng" để dùng lại ở Creative. Mặc định chỉ ĐỌC từ Meta; người có quyền chỉnh sửa có thể tạm dừng một nhóm kém rõ rệt (26d)
// và chạy A/B test tệp (27) — mọi thao tác ghi đều đi qua máy chủ, kiểm lại số liệu + trạng thái thật trên Meta trước khi ghi.
// Lib phía máy chủ (fs…) chỉ được `import type` ở đây.
// ============================================================

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import useSWR from "swr";
import { AlertTriangle, Loader2, RefreshCw, Scale, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { useSession } from "@/components/SessionProvider";
import { hasPermission, resolveCompanyScope } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Pill, type PillTone } from "@/components/measure/Pill";
import { vnd, num, pct, datetimeVN, ddmmyyyy } from "@/components/case/format";
import { getJson, postJson, deleteJson, ApiError } from "@/components/case/api";
import { metaObjectiveLabel } from "@/components/case/meta-copy";
import { DateRangeControl, type DateRangeValue } from "@/components/DateRangeControl";
import { DEFAULT_VIEW_DAYS, MAX_RANGE_DAYS, lastDays } from "@/lib/case/dates";
import type { Company } from "@/lib/case/types";
import type { OverviewRow } from "@/lib/case/service";
import { orderedCompanyIds, companyLabel } from "@/lib/companies/registry";
import type { CompareGroup, CompareVerdict, RankedAdset } from "@/lib/meta/audience-compare";
import type { CompareResult } from "@/lib/meta/audience-compare-fetch";
import type { WinningAudience } from "@/lib/meta/winning-audiences";
import type { AiAssessment } from "@/lib/meta/audience-compare-ai";
import { AbCreateForm, AbSection } from "./AbTests";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/messages";

const MAX_PICK = 3; // = MAX_COMPARE_CAMPAIGNS (không import giá trị từ lib phía máy chủ)

type CompareResponse = CompareResult & { success: true };

const VERDICT_UI: Record<CompareVerdict, { tone: PillTone; label: MessageKey; box: string }> = {
  winner: { tone: "green", label: "meta.cmp.v.winner", box: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  leaning: { tone: "amber", label: "meta.cmp.v.leaning", box: "border-amber-200 bg-amber-50 text-amber-800" },
  undecided: { tone: "grey", label: "meta.cmp.v.undecided", box: "border-slate-200 bg-slate-50 text-slate-700" },
  not_enough: { tone: "grey", label: "meta.cmp.v.undecided", box: "border-slate-200 bg-slate-50 text-slate-700" },
};

const sortRows = (rows: RankedAdset[]): RankedAdset[] => {
  const ranked = rows.filter((r) => r.rank !== null).sort((a, b) => a.rank! - b.rank!);
  const rest = rows.filter((r) => r.rank === null).sort((a, b) => b.spend - a.spend);
  return [...ranked, ...rest];
};

const rich = (s: string) => s.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));

const learningLabel = (l: string | null, t: TFunction): string =>
  l === "LEARNING" ? t("meta.cmp.learn.LEARNING") : l === "SUCCESS" ? t("meta.cmp.learn.SUCCESS") : l === "FAIL" ? t("meta.cmp.learn.FAIL") : l === "LEARNING_LIMITED" ? t("meta.cmp.learn.LEARNING_LIMITED") : l ? l : "—";

const OBJ_KEYS: Record<string, MessageKey> = {
  OUTCOME_SALES: "meta.cmp.obj.OUTCOME_SALES", OUTCOME_LEADS: "meta.cmp.obj.OUTCOME_LEADS", OUTCOME_ENGAGEMENT: "meta.cmp.obj.OUTCOME_ENGAGEMENT", OUTCOME_AWARENESS: "meta.cmp.obj.OUTCOME_AWARENESS",
  OUTCOME_TRAFFIC: "meta.cmp.obj.OUTCOME_TRAFFIC", OUTCOME_APP_PROMOTION: "meta.cmp.obj.OUTCOME_APP_PROMOTION", CONVERSIONS: "meta.cmp.obj.CONVERSIONS", PRODUCT_CATALOG_SALES: "meta.cmp.obj.PRODUCT_CATALOG_SALES",
  LINK_CLICKS: "meta.cmp.obj.LINK_CLICKS", REACH: "meta.cmp.obj.REACH", BRAND_AWARENESS: "meta.cmp.obj.BRAND_AWARENESS", VIDEO_VIEWS: "meta.cmp.obj.VIDEO_VIEWS", MESSAGES: "meta.cmp.obj.MESSAGES",
};
const objectiveLabel = (o: string, t: TFunction): string => (OBJ_KEYS[o] ? t(OBJ_KEYS[o]) : metaObjectiveLabel(o));

export default function SoSanhTepPage() {
  const intl = useIntlLocale();
  const t = useT();
  const { user } = useSession();
  const allowedCompanies = resolveCompanyScope(user?.companies, user?.role);
  const canEdit = !!user && hasPermission(user.role, "can_edit");
  const [company, setCompany] = useState<Company>(() => (orderedCompanyIds([])[0] ?? "") as Company);
  const [range, setRange] = useState<DateRangeValue>(() => lastDays(DEFAULT_VIEW_DAYS));
  const [picked, setPicked] = useState<string[]>([]);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [comparing, setComparing] = useState(false);
  const [compareErr, setCompareErr] = useState<string | null>(null);
  const effectiveCompany = allowedCompanies.includes(company) ? company : allowedCompanies[0];

  const campaigns = useSWR<{ rows: OverviewRow[] }>(
    effectiveCompany ? `/api/cases/overview?company=${effectiveCompany}&from=${range.from}&to=${range.to}&platform=facebook` : null,
    getJson,
  );
  const saved = useSWR<{ rows: WinningAudience[] }>(
    effectiveCompany ? `/api/meta/winning-audiences?company=${effectiveCompany}` : null,
    getJson,
  );

  const campaignRows = useMemo(
    () => [...(campaigns.data?.rows ?? [])].filter((r) => r.perf.cost > 0).sort((a, b) => b.perf.cost - a.perf.cost),
    [campaigns.data],
  );

  function resetSelection() {
    setPicked([]);
    setResult(null);
    setCompareErr(null);
  }

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_PICK ? p : [...p, id]));
  }

  async function runCompare(force: boolean) {
    if (!effectiveCompany || picked.length < 2) return;
    setComparing(true);
    setCompareErr(null);
    try {
      const q = `company=${effectiveCompany}&ids=${picked.join(",")}&from=${range.from}&to=${range.to}${force ? "&force=1" : ""}`;
      setResult(await getJson(`/api/meta/audience-compare?${q}`));
    } catch (e) {
      setResult(null);
      setCompareErr(e instanceof ApiError ? e.message : t("meta.cmp.compareFail"));
    } finally {
      setComparing(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <Scale className="h-5 w-5 text-blue-600" aria-hidden="true" /> {t("meta.cmp.title")}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          {t("meta.cmp.intro")}
        </p>
      </div>

      {/* Điều khiển */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="mb-1 text-xs font-medium text-slate-400">{t("meta.cmp.company")}</div>
          <div role="tablist" aria-label={t("meta.cmp.company")} className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {(orderedCompanyIds([]) as Company[]).map((v) => {
              const allowed = allowedCompanies.includes(v);
              return (
                <button
                  key={v}
                  role="tab"
                  aria-selected={effectiveCompany === v}
                  disabled={!allowed}
                  onClick={() => { setCompany(v); resetSelection(); }}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                    effectiveCompany === v ? "bg-blue-600 text-white" : allowed ? "text-slate-600 hover:bg-slate-50" : "cursor-not-allowed text-slate-300",
                  )}
                >
                  {companyLabel(v)}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-400">{t("meta.cmp.dateRange")}</div>
          <DateRangeControl value={range} onChange={(r) => { setRange(r); resetSelection(); }} maxDays={MAX_RANGE_DAYS} />
        </div>
      </div>

      {allowedCompanies.length === 0 && (
        <EmptyState icon={AlertTriangle} title={t("meta.cmp.noCompany")} description={t("meta.cmp.noCompanyDesc")} />
      )}

      {allowedCompanies.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label={t("meta.cmp.pick.aria")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">{t("meta.cmp.pick.title", { n: picked.length, max: MAX_PICK })}</h2>
            <div className="flex items-center gap-2">
              {result && (
                <Button className="h-10" variant="outline" size="sm" onClick={() => runCompare(true)} disabled={comparing || picked.length < 2}>
                  <RefreshCw className={cn("h-3.5 w-3.5", comparing && "animate-spin")} aria-hidden="true" /> {t("meta.cmp.pick.refresh")}
                </Button>
              )}
              <Button className="h-10" size="sm" onClick={() => runCompare(false)} disabled={comparing || picked.length < 2 || picked.length > MAX_PICK}>
                {comparing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Scale className="h-4 w-4" aria-hidden="true" />} {t("meta.cmp.pick.compare")}
              </Button>
            </div>
          </div>

          {campaigns.isLoading && <p className="mt-3 text-sm text-slate-500">{t("meta.cmp.pick.loading")}</p>}
          {!campaigns.isLoading && campaigns.error && (
            <p className="mt-3 text-sm text-red-600">{campaigns.error instanceof ApiError ? campaigns.error.message : t("meta.cmp.pick.loadFail")}</p>
          )}
          {!campaigns.isLoading && !campaigns.error && campaignRows.length === 0 && (
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">{t("meta.cmp.pick.none")}</p>
          )}
          {campaignRows.length > 0 && (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {campaignRows.map((c) => {
                const on = picked.includes(c.campaignId);
                const locked = !on && picked.length >= MAX_PICK;
                return (
                  <li key={c.campaignId}>
                    <label
                      className={cn(
                        "flex items-start gap-3 rounded-lg border p-3 text-sm",
                        on ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white",
                        locked ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-slate-300",
                      )}
                    >
                      <input type="checkbox" className="mt-1 h-4 w-4" checked={on} disabled={locked} onChange={() => toggle(c.campaignId)} />
                      <span className="min-w-0">
                        <span className="block break-words font-medium text-slate-800">{c.name}</span>
                        <span className="block text-xs text-slate-500">
                          {t("meta.cmp.pick.spend", { objective: objectiveLabel(c.channel, t), value: vnd(c.perf.cost, intl) })}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {picked.length === MAX_PICK && <p className="mt-2 text-xs text-slate-400">{t("meta.cmp.pick.full", { max: MAX_PICK })}</p>}
        </section>
      )}

      {compareErr && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{compareErr}</div>
      )}
      {comparing && !result && <p className="text-sm text-slate-500">{t("meta.cmp.reading")}</p>}

      {result && (
        <ResultView
          result={result}
          company={effectiveCompany}
          canEdit={canEdit}
          campaignIds={picked}
          onSaved={() => saved.mutate()}
          saved={saved.data?.rows ?? []}
        />
      )}
      {result && <AiAssess key={`${result.fetchedAt}|${picked.join(",")}`} company={effectiveCompany} ids={picked} range={result.range} />}

      {allowedCompanies.length > 0 && (
        <SavedList
          loading={saved.isLoading}
          error={saved.error}
          rows={saved.data?.rows ?? []}
          canEdit={canEdit}
          onChanged={() => saved.mutate()}
        />
      )}

      {allowedCompanies.length > 0 && effectiveCompany && <AbSection company={effectiveCompany} canEdit={canEdit} />}
    </div>
  );
}

function ResultView({ result, company, canEdit, campaignIds, onSaved, saved }: {
  result: CompareResponse; company: Company; canEdit: boolean; campaignIds: string[]; onSaved: () => void; saved: WinningAudience[];
}) {
  const intl = useIntlLocale();
  const t = useT();
  return (
    <section className="space-y-4" aria-label={t("meta.cmp.res.aria")}>
      <div className="text-xs text-slate-400">
        {t("meta.cmp.res.range", { from: ddmmyyyy(result.range.from, intl), to: ddmmyyyy(result.range.to, intl), time: datetimeVN(result.fetchedAt, intl) })}
      </div>
      {result.mixedKinds && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          {t("meta.cmp.res.mixed")}
        </div>
      )}
      {result.groups.length === 0 && (
        <EmptyState icon={Scale} title={t("meta.cmp.res.emptyTitle")} description={t("meta.cmp.res.emptyDesc")} />
      )}
      {result.groups.map((g) => (
        <GroupView key={g.goalKind} group={g} range={result.range} company={company} canEdit={canEdit} campaignIds={campaignIds} onSaved={onSaved} saved={saved} />
      ))}
    </section>
  );
}

function GroupView({ group, range, company, canEdit, campaignIds, onSaved, saved }: {
  group: CompareGroup; range: { from: string; to: string }; company: Company; canEdit: boolean; campaignIds: string[]; onSaved: () => void; saved: WinningAudience[];
}) {
  const intl = useIntlLocale();
  const t = useT();
  const ui = VERDICT_UI[group.verdict];
  const word = group.goalKind === "leads" ? t("meta.cmp.word.leads") : t("meta.cmp.word.purchases");
  const rows = useMemo(() => sortRows(group.rows), [group.rows]);
  const [formFor, setFormFor] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 26d — tạm dừng nhóm kém rõ rệt; 27 — A/B test
  const [pausedIds, setPausedIds] = useState<Set<string>>(() => new Set());
  const [pauseFor, setPauseFor] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);
  const [pauseMsg, setPauseMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const [abFor, setAbFor] = useState<string | null>(null);
  const [abMsg, setAbMsg] = useState<string | null>(null);

  async function pause(r: RankedAdset) {
    setPausing(true);
    setPauseMsg(null);
    try {
      const res = await postJson("/api/meta/audience-compare/pause", { company, ids: campaignIds, from: range.from, to: range.to, adsetId: r.id });
      setPausedIds((s) => new Set(s).add(r.id));
      setPauseFor(null);
      setPauseMsg(
        res.ok === false
          ? { tone: "warn", text: t("meta.cmp.pause.warn", { name: res.adsetName ?? r.name, state: res.after }) }
          : { tone: "ok", text: t("meta.cmp.pause.ok", { name: res.adsetName ?? r.name, state: res.after }) },
      );
    } catch (e) {
      setPauseMsg({ tone: "err", text: e instanceof ApiError ? e.message : t("meta.cmp.pause.fail") });
    } finally {
      setPausing(false);
    }
  }

  function openForm(r: RankedAdset) {
    setFormFor(r.id);
    setName(r.name);
    setNote("");
    setMsg(null);
  }

  async function save(r: RankedAdset) {
    setSaving(true);
    setMsg(null);
    try {
      await postJson("/api/meta/winning-audiences", { company, campaignIds, from: range.from, to: range.to, adsetId: r.id, name, note });
      setMsg({ ok: true, text: t("meta.cmp.save.ok", { name: name.trim() || r.name }) });
      setFormFor(null);
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : t("meta.cmp.save.fail") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className={cn("flex flex-wrap items-start gap-2 rounded-t-xl border-b p-3 text-sm", ui.box)}>
        <Pill tone={ui.tone}>{t(ui.label)}</Pill>
        <span className="text-xs font-semibold uppercase tracking-wide opacity-70">{group.goalKind === "leads" ? t("meta.cmp.goal.leads") : t("meta.cmp.goal.sales")}</span>
        <p className="w-full">{group.summary}</p>
      </div>
      {msg && (
        <div role="status" className={cn("mx-3 mt-3 rounded-lg border p-2 text-sm", msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700")}>
          {msg.text}
        </div>
      )}
      {pauseMsg && (
        <div
          role={pauseMsg.tone === "err" ? "alert" : "status"}
          className={cn(
            "mx-3 mt-3 rounded-lg border p-2 text-sm",
            pauseMsg.tone === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-700",
            pauseMsg.tone === "warn" && "border-amber-200 bg-amber-50 text-amber-800",
            pauseMsg.tone === "err" && "border-red-200 bg-red-50 text-red-700",
          )}
        >
          {pauseMsg.text}
          {pauseMsg.tone !== "err" && <> <Link href="/xu-ly/da-lam" className="font-medium underline">{t("meta.cmp.done")}</Link></>}
        </div>
      )}
      {abMsg && <div role="status" className="mx-3 mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700">{abMsg}</div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="p-3 font-medium">{t("meta.cmp.th.adset")}</th>
              <th className="p-3 text-right font-medium">{t("meta.cmp.th.spend")}</th>
              <th className="p-3 text-right font-medium" title={t("meta.cmp.th.resultsTitle")}>{t("meta.cmp.th.results", { word })}</th>
              <th className="p-3 text-right font-medium">{t("meta.cmp.th.cpr")}</th>
              <th className="p-3 text-right font-medium">CTR</th>
              <th className="p-3 text-right font-medium">{t("meta.cmp.th.clickResult")}</th>
              <th className="p-3 text-right font-medium">{t("meta.cmp.th.freq")}</th>
              <th className="p-3 font-medium">{t("meta.cmp.th.learning")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const win = group.winnerId === r.id;
              return (
                <Fragment key={r.id}>
                  <tr className={cn(win && "bg-emerald-50")}>
                    <td className="p-3 align-top">
                      <div className="flex items-start gap-2">
                        {r.rank !== null && (
                          <span aria-label={t("meta.cmp.rank", { n: r.rank })} className={cn("mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-bold", win ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700")}>{r.rank}</span>
                        )}
                        <div className="min-w-0">
                          <div className="break-words font-medium text-slate-800">{win && "🏆 "}{r.name}</div>
                          <div className="text-xs text-slate-500">{r.campaignName}</div>
                          <div className="text-xs text-slate-400">{r.optEventLabel}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-right align-top tabular-nums">{vnd(r.spend, intl)}</td>
                    <td className="p-3 text-right align-top tabular-nums">
                      {num(r.results, undefined, intl)}
                      {/* Chấm theo lượt BẤM 7 ngày; Meta báo tổng gồm cả người chỉ xem (1 ngày) */}
                      {r.resultsAll !== undefined && r.resultsAll !== r.results && (
                        <div className="text-[11px] font-normal text-slate-400">{t("meta.cmp.metaReports", { n: num(r.resultsAll, undefined, intl) })}</div>
                      )}
                    </td>
                    <td className="p-3 text-right align-top tabular-nums">
                      {r.costPerResult !== null ? vnd(r.costPerResult, intl) : "—"}
                      {r.cprLow !== null && r.cprHigh !== null && (
                        <div className="text-xs text-slate-400">≈ {vnd(r.cprLow, intl)}–{vnd(r.cprHigh, intl)}</div>
                      )}
                    </td>
                    <td className="p-3 text-right align-top tabular-nums">{r.ctr !== null ? pct(r.ctr, 1, intl) : "—"}</td>
                    <td className="p-3 text-right align-top tabular-nums">{r.clickToResult !== null ? pct(r.clickToResult, 1, intl) : "—"}</td>
                    <td className="p-3 text-right align-top tabular-nums">{r.frequency !== null ? r.frequency.toFixed(1) : "—"}</td>
                    <td className="p-3 align-top text-xs text-slate-600">{learningLabel(r.learning, t)}</td>
                  </tr>
                  <tr className={cn(win && "bg-emerald-50")}>
                    <td colSpan={8} className="px-3 pb-3">
                      {r.flags.length > 0 && (
                        <ul className="space-y-0.5 text-xs text-amber-700">
                          {r.flags.map((f, i) => <li key={i}>{f}</li>)}
                        </ul>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        {r.results > 0 && canEdit && formFor !== r.id && (
                          <Button className="mt-2 h-9" variant="outline" size="sm" onClick={() => openForm(r)}>{t("meta.cmp.btn.save")}</Button>
                        )}
                        {canEdit && r.status === "ACTIVE" && abFor !== r.id && !pausedIds.has(r.id) && (
                          <Button className="mt-2 h-9" variant="outline" size="sm" onClick={() => { setAbFor(r.id); setAbMsg(null); }}>{t("meta.cmp.btn.ab")}</Button>
                        )}
                        {pausedIds.has(r.id) && <span className="mt-2"><Pill tone="grey">{t("meta.cmp.paused")}</Pill></span>}
                        {canEdit && r.clearlyWorse && r.status === "ACTIVE" && !pausedIds.has(r.id) && pauseFor !== r.id && (
                          <Button className="mt-2 h-9 text-red-700" variant="outline" size="sm" disabled={pausing} onClick={() => { setPauseFor(r.id); setPauseMsg(null); }}>{t("meta.cmp.btn.pause")}</Button>
                        )}
                      </div>
                      {pauseFor === r.id && (
                        <div role="alertdialog" aria-label={t("meta.cmp.pdlg.aria")} className="mt-2 max-w-xl space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-slate-700">
                          <p>
                            {rich(t("meta.cmp.pdlg.text", { name: r.name }))}
                            <Link href="/xu-ly/da-lam" className="font-medium underline">{t("meta.cmp.done")}</Link>.
                          </p>
                          <div className="flex gap-2">
                            <Button className="h-9" size="sm" onClick={() => pause(r)} disabled={pausing}>
                              {pausing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("meta.cmp.pdlg.confirm")}
                            </Button>
                            <Button className="h-9" variant="outline" size="sm" onClick={() => setPauseFor(null)} disabled={pausing}>{t("meta.cmp.cancel")}</Button>
                          </div>
                        </div>
                      )}
                      {abFor === r.id && (
                        <AbCreateForm
                          company={company}
                          source={r}
                          saved={saved}
                          onClose={() => setAbFor(null)}
                          onCreated={(text) => { setAbFor(null); setAbMsg(text); }}
                        />
                      )}
                      {formFor === r.id && (
                        <div className="mt-2 max-w-xl space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                          <label className="block text-xs font-medium text-slate-500">
                            {t("meta.cmp.form.name")}
                            <Input className="mt-1" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
                          </label>
                          <label className="block text-xs font-medium text-slate-500">
                            {t("meta.cmp.form.note")}
                            <Input className="mt-1" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t("meta.cmp.form.notePh")} />
                          </label>
                          <div className="flex gap-2">
                            <Button className="h-9" size="sm" onClick={() => save(r)} disabled={saving || !name.trim()}>
                              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("meta.cmp.save")}
                            </Button>
                            <Button className="h-9" variant="outline" size="sm" onClick={() => setFormFor(null)} disabled={saving}>{t("meta.cmp.cancel")}</Button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!canEdit && <p className="px-3 pb-3 text-xs text-slate-400">{t("meta.cmp.viewOnly")}</p>}
    </div>
  );
}

function SavedList({ loading, error, rows, canEdit, onChanged }: {
  loading: boolean; error: unknown; rows: WinningAudience[]; canEdit: boolean; onChanged: () => void;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const now = Date.now();

  async function remove(w: WinningAudience) {
    if (!window.confirm(t("meta.cmp.sv.confirm", { name: w.name }))) return;
    setBusy(w.id);
    setErr(null);
    try {
      await deleteJson(`/api/meta/winning-audiences?id=${encodeURIComponent(w.id)}`);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("meta.cmp.sv.deleteFail"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3" aria-label={t("meta.cmp.sv.aria")}>
      <div>
        <h2 className="text-base font-bold text-slate-900">{t("meta.cmp.sv.title")}</h2>
        <p className="text-xs text-slate-500">{t("meta.cmp.sv.hint")}</p>
      </div>
      {loading && <p className="text-sm text-slate-500">{t("meta.cmp.sv.loading")}</p>}
      {!loading && !!error && <p className="text-sm text-red-600">{error instanceof ApiError ? error.message : t("meta.cmp.sv.loadFail")}</p>}
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">{t("meta.cmp.sv.empty")}</p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((w) => {
          const overdue = Date.parse(w.reviewBy) < now;
          const ev = w.evidence;
          return (
            <article key={w.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <div className="flex items-start justify-between gap-2">
                <h3 className="break-words font-semibold text-slate-800">{w.name}</h3>
                {canEdit && (
                  <Button variant="outline" size="sm" className="h-9 shrink-0" disabled={busy === w.id} onClick={() => remove(w)} aria-label={t("meta.cmp.sv.delete", { name: w.name })}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> {t("meta.cmp.sv.deleteBtn")}
                  </Button>
                )}
              </div>
              <p className="mt-1 text-slate-600">{w.summary}</p>
              {w.note && <p className="mt-1 text-xs italic text-slate-500">{t("meta.cmp.sv.note", { note: w.note })}</p>}
              <p className="mt-2 text-xs text-slate-500">
                {t("meta.cmp.sv.saved", { time: datetimeVN(w.savedAt, intl), by: w.savedBy, adset: w.source.adsetName, campaign: w.source.campaignName })}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {t("meta.cmp.sv.evidence", { from: ddmmyyyy(ev.range.from, intl), to: ddmmyyyy(ev.range.to, intl), spend: vnd(ev.spend, intl), n: num(ev.results, undefined, intl), word: w.goalKind === "leads" ? t("meta.cmp.word.leads") : t("meta.cmp.word.purchases") })}
                {ev.costPerResult !== null && <>{t("meta.cmp.sv.cpr", { value: vnd(ev.costPerResult, intl) })}</>}
                {ev.comparedWith.length > 0 && <>{t("meta.cmp.sv.vs", { n: ev.comparedWith.length })}</>}
              </p>
              <p className="mt-1 text-xs text-slate-500">{ev.groupSummary}</p>
              <p className="mt-1 text-xs text-slate-400">{t("meta.cmp.sv.recheck", { date: ddmmyyyy(w.reviewBy.slice(0, 10), intl) })}</p>
              {overdue && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">{t("meta.cmp.sv.overdue")}</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}


// Đợt 26b — AI đánh giá: máy chủ dựng lại bảng, chỉ đưa bảng đó cho AI, rồi soát từng con số AI viết ra.
function AiAssess({ company, ids, range }: { company: Company; ids: string[]; range: { from: string; to: string } }) {
  const intl = useIntlLocale();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<{ assessment: AiAssessment; unsupported: number[]; cached: boolean } | null>(null);
  async function run() {
    setBusy(true); setErr(null);
    try { setData(await postJson("/api/meta/audience-compare/ai", { company, ids, from: range.from, to: range.to })); }
    catch (e) { setErr(e instanceof ApiError ? e.message : t("meta.cmp.ai.fail")); }
    finally { setBusy(false); }
  }
  const Points = ({ title, items }: { title: string; items: AiAssessment["why"] }) => items.length === 0 ? null : (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <ul className="space-y-1.5">
        {items.map((p, i) => (
          <li key={i} className="text-sm text-slate-700">
            {p.text}
            {p.evidence.length > 0 && <span className="ml-1 text-xs text-slate-400">({p.evidence.join(" · ")})</span>}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4" aria-label={t("meta.cmp.ai.aria")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{t("meta.cmp.ai.title")}</h2>
          <p className="text-xs text-slate-500">{t("meta.cmp.ai.hint")}</p>
        </div>
        <Button className="h-10" size="sm" onClick={run} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{busy ? t("meta.cmp.ai.running") : data ? t("meta.cmp.ai.again") : t("meta.cmp.ai.run")}
        </Button>
      </div>
      {err && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {data && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-900">{data.assessment.conclusion}</p>
          <Points title={t("meta.cmp.ai.why")} items={data.assessment.why} />
          <Points title={t("meta.cmp.ai.actions")} items={data.assessment.actions} />
          {data.assessment.caveats.length > 0 && (
            <div className="text-xs text-slate-500">{t("meta.cmp.ai.caveats", { list: data.assessment.caveats.join(" · ") })}</div>
          )}
          {data.unsupported.length > 0 && (
            <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("meta.cmp.ai.unsupported", { list: data.unsupported.map((n) => num(n, undefined, intl)).join(", ") })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
