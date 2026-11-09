"use client";

// A/B test tệp — Đợt 27. Tool giữ nhóm A, tạo nhóm B y hệt (chỉ đổi tệp), đo bằng phép thử của bảng so sánh.
// Mọi thao tác ghi đi qua /api/meta/ab-audience (máy chủ kiểm lại quyền + trạng thái thật trên Meta).
// Lib phía máy chủ chỉ được `import type` ở đây.

import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Pill, type PillTone } from "@/components/measure/Pill";
import { vnd, num, datetimeVN } from "@/components/case/format";
import { getJson, postJson, ApiError } from "@/components/case/api";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { CompareGroup, RankedAdset } from "@/lib/meta/audience-compare";
import type { AbAudienceTest } from "@/lib/meta/ab-audience";
import type { WinningAudience } from "@/lib/meta/winning-audiences";

type Reading = { tone: "win_a" | "win_b" | "leaning" | "wait"; text: string };
type Entry = {
  test: AbAudienceTest;
  measure: { group: CompareGroup | null; days: number; range: { from: string; to: string } | null } | null;
  reading: Reading | null;
  error: string | null;
};
type ListResponse = { success: true; company: string; canEdit: boolean; tests: Entry[] };

type Plan = {
  campaignId: string; campaignName: string; goalKind: string;
  a: { adsetId: string; adsetName: string; summary: string };
  bName: string; bSummary: string; bTargeting: unknown; droppedKeys: string[];
  dailyBudget: number | null; ads: number; overlapPct: number;
  blockers: string[]; warnings: string[]; validated: boolean; metaError: string | null;
};

const abKey = (company: string) => `/api/meta/ab-audience?company=${company}`;
const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const rich = (s: string) => s.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));

const STATUS_UI: Record<AbAudienceTest["status"], { tone: PillTone; label: MessageKey }> = {
  draft: { tone: "grey", label: "meta.ab.st.draft" },
  running: { tone: "blue", label: "meta.ab.st.running" },
  ended: { tone: "green", label: "meta.ab.st.ended" },
  discarded: { tone: "grey", label: "meta.ab.st.discarded" },
};

const READING_BOX: Record<Reading["tone"], string> = {
  win_a: "border-emerald-200 bg-emerald-50 text-emerald-800",
  win_b: "border-emerald-200 bg-emerald-50 text-emerald-800",
  leaning: "border-amber-200 bg-amber-50 text-amber-800",
  wait: "border-slate-200 bg-slate-50 text-slate-700",
};

// ---------- Form tạo nhóm B từ một dòng nhóm quảng cáo ----------

export function AbCreateForm({ company, source, saved, onClose, onCreated }: {
  company: string;
  source: RankedAdset;
  saved: WinningAudience[];
  onClose: () => void;
  onCreated: (text: string) => void;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const options = saved.filter((w) => w.goalKind === source.goalKind);
  const [mode, setMode] = useState<"winning" | "edit">(options.length > 0 ? "winning" : "edit");
  const [winningId, setWinningId] = useState(options[0]?.id ?? "");
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [gender, setGender] = useState<"all" | "1" | "2">("all");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<"plan" | "create" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const ageOk = Number.isInteger(ageMin) && Number.isInteger(ageMax) && ageMin >= 18 && ageMax <= 65 && ageMin <= ageMax;
  const formOk = mode === "winning" ? !!winningId : ageOk;

  function variant() {
    if (mode === "winning") {
      const w = options.find((o) => o.id === winningId);
      return { kind: "winning", winningId, name: w?.name ?? "" };
    }
    return { kind: "edit", ageMin, ageMax, genders: gender === "all" ? [] : [Number(gender)] };
  }

  function touch() { setPlan(null); setErr(null); }

  async function run(action: "plan" | "create") {
    setBusy(action);
    setErr(null);
    try {
      const res = await postJson("/api/meta/ab-audience", { action, company, sourceAdsetId: source.id, variant: variant() });
      if (action === "plan") setPlan(res.plan as Plan);
      else {
        await globalMutate(abKey(company));
        onCreated(t("meta.ab.form.created", { name: source.name }));
      }
    } catch (e) {
      setErr(errMsg(e, action === "plan" ? t("meta.ab.form.planFail") : t("meta.ab.form.createFail")));
    } finally {
      setBusy(null);
    }
  }

  const canCreate = !!plan && plan.validated && plan.blockers.length === 0 && !plan.metaError;

  return (
    <div className="mt-2 max-w-2xl space-y-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="font-semibold text-slate-800">{t("meta.ab.form.title", { name: source.name })}</div>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-slate-500">{t("meta.ab.form.which")}</legend>
        <label className={cn("flex items-start gap-2", options.length === 0 && "opacity-60")}>
          <input type="radio" className="mt-1 h-4 w-4" name={`ab-mode-${source.id}`} checked={mode === "winning"} disabled={options.length === 0} onChange={() => { setMode("winning"); touch(); }} />
          <span>
            {t("meta.ab.form.useWinning")}
            {options.length === 0 && <span className="block text-xs text-slate-500">{t("meta.ab.form.noWinning", { kind: source.goalKind === "leads" ? t("meta.ab.form.kindLeads") : t("meta.ab.form.kindSales") })}</span>}
          </span>
        </label>
        {mode === "winning" && options.length > 0 && (
          <label className="block pl-6 text-xs font-medium text-slate-500">
            {t("meta.ab.form.winning")}
            <select className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800" value={winningId} onChange={(e) => { setWinningId(e.target.value); touch(); }}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name} — {o.summary}</option>)}
            </select>
          </label>
        )}
        <label className="flex items-start gap-2">
          <input type="radio" className="mt-1 h-4 w-4" name={`ab-mode-${source.id}`} checked={mode === "edit"} onChange={() => { setMode("edit"); touch(); }} />
          <span>{t("meta.ab.form.editAge")}</span>
        </label>
        {mode === "edit" && (
          <div className="grid gap-2 pl-6 sm:grid-cols-3">
            <label className="block text-xs font-medium text-slate-500">
              {t("meta.ab.form.ageFrom")}
              <Input className="mt-1" type="number" min={18} max={65} value={ageMin} onChange={(e) => { setAgeMin(Number(e.target.value)); touch(); }} />
            </label>
            <label className="block text-xs font-medium text-slate-500">
              {t("meta.ab.form.ageTo")}
              <Input className="mt-1" type="number" min={18} max={65} value={ageMax} onChange={(e) => { setAgeMax(Number(e.target.value)); touch(); }} />
            </label>
            <label className="block text-xs font-medium text-slate-500">
              {t("meta.ab.form.gender")}
              <select className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800" value={gender} onChange={(e) => { setGender(e.target.value as "all" | "1" | "2"); touch(); }}>
                <option value="all">{t("meta.ab.form.all")}</option>
                <option value="1">{t("meta.ab.form.male")}</option>
                <option value="2">{t("meta.ab.form.female")}</option>
              </select>
            </label>
            {!ageOk && <p className="text-xs text-red-600 sm:col-span-3">{t("meta.ab.form.ageErr")}</p>}
          </div>
        )}
      </fieldset>

      {err && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-700">{err}</div>}

      {plan && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div><div className="text-xs font-semibold text-slate-500">{t("meta.ab.form.groupAKeep")}</div><div className="text-slate-800">{plan.a.adsetName}</div><div className="text-xs text-slate-600">{plan.a.summary}</div></div>
            <div><div className="text-xs font-semibold text-slate-500">{t("meta.ab.form.groupBNew")}</div><div className="text-slate-800">{plan.bName}</div><div className="text-xs text-slate-600">{plan.bSummary}</div></div>
          </div>
          <ul className="space-y-0.5 text-xs text-slate-700">
            <li>{t("meta.ab.form.overlap", { n: num(plan.overlapPct, undefined, intl) })}</li>
            <li>{t("meta.ab.form.copyAds", { n: num(plan.ads, undefined, intl) })}</li>
            <li>{plan.dailyBudget !== null ? t("meta.ab.form.budget", { value: vnd(plan.dailyBudget, intl) }) : t("meta.ab.form.budgetNone")}</li>
            {plan.droppedKeys.length > 0 && <li>{t("meta.ab.form.dropped", { list: plan.droppedKeys.join(", ") })}</li>}
          </ul>
          {plan.blockers.length > 0 && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              <div className="font-semibold">{t("meta.ab.form.blockers")}</div>
              <ul className="list-disc pl-4">{plan.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
            </div>
          )}
          {plan.metaError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{t("meta.ab.form.metaErr", { error: plan.metaError })}</div>}
          {plan.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              <div className="font-semibold">{t("meta.ab.form.notes")}</div>
              <ul className="list-disc pl-4">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
          {plan.validated && !plan.metaError && <div className="text-xs font-medium text-emerald-700">{t("meta.ab.form.valid")}</div>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button className="h-9" variant="outline" size="sm" onClick={() => run("plan")} disabled={busy !== null || !formOk}>
          {busy === "plan" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("meta.ab.form.preview")}
        </Button>
        <Button className="h-9" size="sm" onClick={() => run("create")} disabled={busy !== null || !canCreate}>
          {busy === "create" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("meta.ab.form.create")}
        </Button>
        <Button className="h-9" variant="outline" size="sm" onClick={onClose} disabled={busy !== null}>{t("meta.ab.form.close")}</Button>
      </div>
    </div>
  );
}

// ---------- Mục danh sách A/B test ----------

export function AbSection({ company, canEdit }: { company: string; canEdit: boolean }) {
  const t = useT();
  const { data, error, isLoading, mutate } = useSWR<ListResponse>(company ? abKey(company) : null, getJson);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshErr, setRefreshErr] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setRefreshErr(null);
    try {
      await mutate(getJson(`${abKey(company)}&force=1`) as Promise<ListResponse>, { revalidate: false });
    } catch (e) {
      setRefreshErr(errMsg(e, t("meta.ab.sec.refreshFail")));
    } finally {
      setRefreshing(false);
    }
  }

  const tests = data?.tests ?? [];
  const editable = canEdit && (data?.canEdit ?? true);

  return (
    <section className="space-y-3" aria-label={t("meta.ab.sec.aria")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="max-w-3xl">
          <h2 className="text-base font-bold text-slate-900">{t("meta.ab.sec.title")}</h2>
          <p className="text-xs text-slate-500">
            {t("meta.ab.sec.intro")}
          </p>
        </div>
        <Button className="h-10" variant="outline" size="sm" onClick={refresh} disabled={refreshing || !company}>
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden="true" /> {t("meta.ab.sec.refresh")}
        </Button>
      </div>
      {isLoading && <p className="text-sm text-slate-500">{t("meta.ab.sec.loading")}</p>}
      {!isLoading && !!error && <p role="alert" className="text-sm text-red-600">{errMsg(error, t("meta.ab.sec.listFail"))}</p>}
      {refreshErr && <p role="alert" className="text-sm text-red-600">{refreshErr}</p>}
      {!isLoading && !error && tests.length === 0 && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">{t("meta.ab.sec.empty")}</p>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {tests.map((e) => <TestCard key={e.test.id} entry={e} canEdit={editable} onChanged={() => mutate()} />)}
      </div>
    </section>
  );
}

function TestCard({ entry, canEdit, onChanged }: { entry: Entry; canEdit: boolean; onChanged: () => void }) {
  const intl = useIntlLocale();
  const tr = useT();
  const { test: t, measure, reading, error } = entry;
  const ui = STATUS_UI[t.status];
  const [panel, setPanel] = useState<"start" | "discard" | "end" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<string[] | null>(null);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      const res = await postJson("/api/meta/ab-audience", { ...body, id: t.id });
      if (body.action === "discard") setReport((res.report as string[]) ?? []);
      setPanel(null);
      onChanged();
    } catch (e) {
      setErr(errMsg(e, tr("meta.ab.card.failTryLater")));
    } finally {
      setBusy(false);
    }
  }

  const loser = reading?.tone === "win_a" ? "b" : reading?.tone === "win_b" ? "a" : null;
  const pausedLabel = t.result?.paused === t.a.adsetId ? tr("meta.ab.card.pausedA") : t.result?.paused === t.b.adsetId ? tr("meta.ab.card.pausedB") : t.result?.paused ? t.result.paused : tr("meta.ab.card.pausedNone");

  return (
    <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={ui.tone}>{tr(ui.label)}</Pill>
        <span className="break-words font-semibold text-slate-800">{t.campaignName}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div><div className="text-xs font-semibold text-slate-500">{tr("meta.ab.card.groupA")}</div><div className="break-words text-slate-800">{t.a.adsetName}</div><div className="text-xs text-slate-600">{t.a.summary}</div></div>
        <div><div className="text-xs font-semibold text-slate-500">{tr("meta.ab.card.groupB")}</div><div className="break-words text-slate-800">{t.b.adsetName}</div><div className="text-xs text-slate-600">{t.b.summary}</div></div>
      </div>
      <p className="text-xs text-slate-500">
        {tr("meta.ab.card.created", { time: datetimeVN(t.createdAt, intl), by: t.createdBy })}
        {t.startedAt && <>{tr("meta.ab.card.started", { time: datetimeVN(t.startedAt, intl) })}</>}
        {t.endedAt && <>{tr("meta.ab.card.endedAt", { time: datetimeVN(t.endedAt, intl) })}</>}
        {t.overlapPct > 0 && <>{tr("meta.ab.card.overlap", { n: num(t.overlapPct, undefined, intl) })}</>}
      </p>
      {t.warnings.length > 0 && (
        <details className="text-xs text-amber-800">
          <summary className="cursor-pointer font-medium">{tr("meta.ab.card.notes", { n: t.warnings.length })}</summary>
          <ul className="mt-1 list-disc pl-4">{t.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}

      {t.status === "running" && (
        <div className="space-y-2">
          {reading && <div className={cn("rounded-lg border p-2 text-sm", READING_BOX[reading.tone])}>{reading.text}</div>}
          {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
          {measure && <p className="text-xs text-slate-500">{tr("meta.ab.card.ranDays", { n: num(measure.days, undefined, intl) })}{measure.days < 7 && tr("meta.ab.card.notEnough")}.</p>}
          {measure?.group && measure.group.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-xs">
                <thead className="text-slate-500">
                  <tr className="border-b border-slate-100">
                    <th className="py-1.5 pr-2 font-medium">{tr("meta.ab.card.th.group")}</th>
                    <th className="py-1.5 pr-2 text-right font-medium">{tr("meta.ab.card.th.spend")}</th>
                    <th className="py-1.5 pr-2 text-right font-medium">{tr("meta.ab.card.th.results")}</th>
                    <th className="py-1.5 text-right font-medium">{tr("meta.ab.card.th.cpr")}</th>
                  </tr>
                </thead>
                <tbody>
                  {measure.group.rows.map((r) => {
                    const label = r.id === t.a.adsetId ? "A" : r.id === t.b.adsetId ? "B" : "";
                    return (
                      <tr key={r.id} className="border-b border-slate-50 align-top">
                        <td className="py-1.5 pr-2">
                          <span className="font-medium text-slate-800">{label && `${label} · `}{r.name}</span>
                          {r.flags.length > 0 && <ul className="text-[11px] text-amber-700">{r.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{vnd(r.spend, intl)}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{num(r.results, undefined, intl)}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {r.costPerResult !== null ? vnd(r.costPerResult, intl) : "—"}
                          {r.cprLow !== null && r.cprHigh !== null && <div className="text-[11px] text-slate-400">≈ {vnd(r.cprLow, intl)}–{vnd(r.cprHigh, intl)}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {t.status === "ended" && t.result && (
        <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
          <p>{t.result.summary}</p>
          <p>{tr("meta.ab.card.measured", { n: num(t.result.days, undefined, intl), what: t.result.paused ? tr("meta.ab.card.pausedWhat", { which: pausedLabel }) : tr("meta.ab.card.keepBoth") })}</p>
        </div>
      )}

      {report && report.length > 0 && (
        <div role="status" className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
          <ul className="list-disc pl-4">{report.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}
      {err && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{err}</div>}

      {canEdit && (t.status === "draft" || t.status === "running") && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {t.status === "draft" && panel !== "start" && (
              <Button className="h-9" size="sm" disabled={busy} onClick={() => { setPanel("start"); setErr(null); }}>{tr("meta.ab.card.start")}</Button>
            )}
            {t.status === "running" && panel !== "end" && (
              <Button className="h-9" size="sm" disabled={busy} onClick={() => { setPanel("end"); setErr(null); }}>{tr("meta.ab.card.end")}</Button>
            )}
            {t.status === "draft" && panel !== "discard" && (
              <Button className="h-9" variant="outline" size="sm" disabled={busy} onClick={() => { setPanel("discard"); setErr(null); }}>{tr("meta.ab.card.discard")}</Button>
            )}
          </div>
          {panel === "start" && (
            <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-slate-700">
              <p>
                {t.dailyBudget !== null ? <>{rich(tr("meta.ab.card.startExtra", { value: vnd(t.dailyBudget, intl) }))}</> : tr("meta.ab.card.startNow")}
                {tr("meta.ab.card.startCheck")}
              </p>
              <div className="flex gap-2">
                <Button className="h-9" size="sm" disabled={busy} onClick={() => act({ action: "start" })}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {tr("meta.ab.card.confirmStart")}</Button>
                <Button className="h-9" variant="outline" size="sm" disabled={busy} onClick={() => setPanel(null)}>{tr("meta.ab.card.no")}</Button>
              </div>
            </div>
          )}
          {panel === "discard" && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-slate-700">
              <p>{tr("meta.ab.card.discardNote")}</p>
              <div className="flex gap-2">
                <Button className="h-9" size="sm" disabled={busy} onClick={() => act({ action: "discard" })}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {tr("meta.ab.card.confirmDiscard")}</Button>
                <Button className="h-9" variant="outline" size="sm" disabled={busy} onClick={() => setPanel(null)}>{tr("meta.ab.card.no")}</Button>
              </div>
            </div>
          )}
          {panel === "end" && (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <p>{tr("meta.ab.card.endPick", { hint: loser ? tr("meta.ab.card.endHint", { which: loser === "a" ? "A" : "B" }) : "" })}</p>
              <div className="flex flex-wrap gap-2">
                <Button className="h-9" variant="outline" size="sm" disabled={busy} onClick={() => act({ action: "end", pause: null })}>{tr("meta.ab.card.endKeep")}</Button>
                <Button className={cn("h-9", loser === "a" && "border-emerald-400")} variant="outline" size="sm" disabled={busy} onClick={() => act({ action: "end", pause: "a" })}>{tr("meta.ab.card.endPauseA")}{loser === "a" && tr("meta.ab.card.suggested")}</Button>
                <Button className={cn("h-9", loser === "b" && "border-emerald-400")} variant="outline" size="sm" disabled={busy} onClick={() => act({ action: "end", pause: "b" })}>{tr("meta.ab.card.endPauseB")}{loser === "b" && tr("meta.ab.card.suggested")}</Button>
                <Button className="h-9" variant="outline" size="sm" disabled={busy} onClick={() => setPanel(null)}>{tr("meta.ab.card.no")}</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
