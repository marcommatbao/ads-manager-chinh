"use client";

// ============================================================
// PMax "🧪 Thí nghiệm" — C4: Tắt PMax ở một vùng trong N tuần, so đơn thật
// vùng đó với nơi khác trước/trong thí nghiệm, để biết PMax (gồm YouTube) có
// tạo đơn THÊM thật hay không.
// ------------------------------------------------------------
// Đọc/ghi qua lib/pmax/geo-experiment.ts + lib/pmax/geo-design.ts — cả hai đều
// là module SERVER (kéo google-ads SDK) nên ở đây CHỈ `import type`. Luồng ghi
// giống PmaxActionsPanel: Kiểm trước (validateOnly, không ghi) → gõ confirmText
// (đọc từ server, không hard-code) → Bật thật → server tự đọc lại.
// ============================================================

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, TestTube2, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { getJson, postJson, ApiError } from "@/components/case/api";
import { vnd, num, pct, ddmmyyyy, datetimeVN } from "@/components/case/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { CopyButton } from "./CopyButton";
import type { ExperimentDesign, GeoExperiment } from "@/lib/pmax/geo-experiment";
import type { DesignCandidate, ExperimentResult } from "@/lib/pmax/geo-design";

type Company = string;
type Source = "auto" | "ga4" | "csv" | "google";

interface ExperimentGetResponse {
  design: ExperimentDesign;
  experiments: GeoExperiment[];
  csv: { uploadedAt: string; rows: number; from: string; to: string } | null;
  serviceAccountEmail: string | null;
  weeks: { min: number; max: number; default: number };
  canEdit: boolean;
  confirmText: string;
}

const SOURCE_LABEL: Record<Source, MessageKey> = { auto: "google.pmaxExperiment.src.auto", ga4: "google.pmaxExperiment.src.ga4", csv: "google.pmaxExperiment.src.csv", google: "google.pmaxExperiment.src.google" };

const VERDICT_META: Record<ExperimentResult["verdict"], { label: MessageKey; cls: string }> = {
  chua_du: { label: "google.pmaxExperiment.verdict.notEnough", cls: "bg-slate-100 text-slate-500 border-slate-200" },
  google_dung: { label: "google.pmaxExperiment.verdict.googleRight", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  mot_phan: { label: "google.pmaxExperiment.verdict.partial", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  khong_them: { label: "google.pmaxExperiment.verdict.none", cls: "bg-red-50 text-red-700 border-red-200" },
  khong_ro: { label: "google.pmaxExperiment.verdict.unclear", cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

// ── Một phương án (radio) ──

function CandidateCard({ c, selected, onSelect, disabled }: {
  c: ExperimentDesign["candidates"][number]; selected: boolean; onSelect: () => void; disabled: boolean;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  const names = c.holdoutNames;
  const shown = showAll ? names : names.slice(0, 6);
  return (
    <label className={cn("block cursor-pointer space-y-2 rounded-xl border p-3.5 text-xs", selected ? "border-indigo-300 bg-indigo-50/40" : "border-slate-200 bg-white", disabled && "cursor-default opacity-70")}>
      <div className="flex items-start gap-2.5">
        <input type="radio" name="pmax-experiment-candidate" checked={selected} onChange={onSelect} disabled={disabled} className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-800">{c.label}</p>
            <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold", c.sensitive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200")}>
              {c.sensitive ? t("google.pmaxExperiment.sensitive") : t("google.pmaxExperiment.insensitive")}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {shown.map((n) => <span key={n} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{n}</span>)}
            {names.length > 6 && (
              <button type="button" onClick={(e) => { e.preventDefault(); setShowAll((s) => !s); }} className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700">
                {showAll ? t("google.pmaxExperiment.collapse") : t("google.pmaxExperiment.moreProvinces", { n: names.length - 6 })}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-600 sm:grid-cols-3">
            <span>{t("google.pmaxExperiment.kpiShare")} <strong className="text-slate-800">{pct(c.holdoutShare, 0, intl)}</strong></span>
            <span>{t("google.pmaxExperiment.kpiPerWeek")} <strong className="text-slate-800">{num(c.kpiHoldoutPerWeek, { maximumFractionDigits: 1 }, intl)}</strong></span>
            <span>{t("google.pmaxExperiment.pmaxClaimPerWeek")} <strong className="text-slate-800">{num(c.pmaxClaimPerWeek, { maximumFractionDigits: 1 }, intl)}</strong></span>
            <span>{t("google.pmaxExperiment.pmaxCostPerWeek")} <strong className="text-slate-800">{vnd(c.pmaxCostPerWeek, intl)}</strong></span>
            <span>{t("google.pmaxExperiment.ifGoogleRight")} <strong className="text-slate-800">~{pct(c.expectedEffect, 0, intl)}</strong></span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
            <span>{t("google.pmaxExperiment.mde4", { pct: pct(c.mde[4] ?? 1, 0, intl) })}</span>
            <span>{t("google.pmaxExperiment.mde6", { pct: pct(c.mde[6] ?? 1, 0, intl) })}</span>
          </div>
          <p className="text-[11px] italic text-slate-500">{c.note}</p>
        </div>
      </div>
    </label>
  );
}

// ── Kết quả Kiểm trước ──

function ValidateResultCard({ exp }: { exp: GeoExperiment }) {
  const t = useT();
  const ok = exp.errors.length === 0;
  return (
    <div className={cn("rounded-lg border p-2.5 text-xs", ok ? "border-sky-200 bg-sky-50" : "border-red-200 bg-red-50")}>
      <div className={cn("flex items-center gap-1.5 font-semibold", ok ? "text-sky-800" : "text-red-700")}>
        {ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        {ok ? t("google.pmaxExperiment.validateOk", { n: exp.ops.length }) : t("google.pmaxExperiment.validateRejected")}
      </div>
      {exp.skipped.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-slate-600">{exp.skipped.map((s, i) => <li key={i}>{s}</li>)}</ul>
      )}
      {exp.errors.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-red-700">{exp.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
      )}
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: ExperimentResult["verdict"] }) {
  const t = useT();
  const m = VERDICT_META[verdict];
  return <span className={cn("inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", m.cls)}>{t(m.label)}</span>;
}

// ── Thí nghiệm đang chạy ──

function RunningExperimentCard({ exp, company, canEdit, onChanged }: {
  exp: GeoExperiment; company: Company; canEdit: boolean; onChanged: () => void;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const [local, setLocal] = useState(exp);
  useEffect(() => setLocal(exp), [exp]);
  const [remeasuring, setRemeasuring] = useState(false);
  const [remeasureErr, setRemeasureErr] = useState<string | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endErr, setEndErr] = useState<string | null>(null);

  async function remeasure() {
    setRemeasuring(true); setRemeasureErr(null);
    try {
      const json = await getJson(`/api/google/pmax/experiment/status?company=${company}&id=${local.id}`);
      setLocal(json.experiment as GeoExperiment);
    } catch (e) {
      setRemeasureErr(e instanceof ApiError ? e.message : t("google.pmaxExperiment.remeasureError"));
    } finally { setRemeasuring(false); }
  }

  async function doEnd() {
    setEnding(true); setEndErr(null);
    try {
      await postJson("/api/google/pmax/experiment/end", { company, id: local.id });
      setEndOpen(false);
      onChanged();
    } catch (e) {
      setEndErr(e instanceof ApiError ? e.message : t("google.pmaxExperiment.endError"));
    } finally { setEnding(false); }
  }

  const totalDays = Math.max(1, Math.round((Date.parse(local.plannedEnd) - Date.parse(local.start)) / 86_400_000) + 1);
  const doneDays = Math.min(totalDays, Math.max(0, Math.round((Date.now() - Date.parse(local.start)) / 86_400_000) + 1));
  const progress = Math.min(100, Math.max(0, Math.round((doneDays / totalDays) * 100)));
  const r = local.lastResult;

  return (
    <div className="space-y-2.5 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-indigo-900">{local.label}</p>
          <p className="text-xs text-indigo-700/80">{local.holdoutNames.join(", ")}</p>
        </div>
        <span className="shrink-0 rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{t("google.pmaxExperiment.running")}</span>
      </div>
      <div>
        <div className="flex items-center justify-between text-[11px] text-indigo-700/80">
          <span>{ddmmyyyy(local.start, intl)} → {ddmmyyyy(local.plannedEnd, intl)}</span>
          <span>{progress}%</span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-indigo-100">
          <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${progress}%` }} />
        </div>
      </div>
      {r && (
        <div className="space-y-1 rounded-lg border border-white bg-white/70 p-2.5 text-xs text-indigo-900">
          <p>{r.text || t("google.pmaxExperiment.notEnoughWeeks")}</p>
          {r.testWeeks >= 2 && (
            <>
              <p>{t("google.pmaxExperiment.change")} <strong>{pct(r.change, 0, intl)}</strong> ({t("google.pmaxExperiment.ci")} {pct(r.ciLow, 0, intl)} … {pct(r.ciHigh, 0, intl)})</p>
              <VerdictBadge verdict={r.verdict} />
            </>
          )}
          {r.leakCost > 0 && <p className="text-amber-700">{t("google.pmaxExperiment.leak", { cost: vnd(r.leakCost, intl) })}</p>}
          <p className="text-[10px] text-indigo-400">{t("google.pmaxExperiment.measuredAt", { time: datetimeVN(r.at, intl) })}</p>
        </div>
      )}
      {remeasureErr && <p className="text-xs text-red-600">{remeasureErr}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={remeasure} disabled={remeasuring}>
          {remeasuring ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.pmaxExperiment.remeasure")}
        </Button>
        {canEdit && (
          <Button type="button" variant="destructive" size="sm" className="h-9" onClick={() => { setEndErr(null); setEndOpen(true); }}>
            {t("google.pmaxExperiment.endNow")}
          </Button>
        )}
      </div>
      <Dialog open={endOpen} onOpenChange={(o) => { setEndOpen(o); if (!o) setEndErr(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("google.pmaxExperiment.endTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-500">{t("google.pmaxExperiment.endDesc", { names: local.holdoutNames.join(", ") })}</p>
          {endErr && <p className="text-xs text-red-600">{endErr}</p>}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.pmaxExperiment.cancel")}</DialogClose>
            <Button className="h-10" variant="destructive" onClick={doEnd} disabled={ending}>
              {ending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.pmaxExperiment.endNow")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EndedExperimentCard({ exp }: { exp: GeoExperiment }) {
  const intl = useIntlLocale();
  const t = useT();
  return (
    <div className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-700">{exp.label}</p>
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", exp.status === "failed" ? "border-red-200 bg-red-50 text-red-600" : "border-slate-200 bg-slate-100 text-slate-500")}>
          {exp.status === "failed" ? t("google.pmaxExperiment.failedStart") : t("google.pmaxExperiment.ended")}
        </span>
      </div>
      <p className="text-slate-400">{ddmmyyyy(exp.start, intl)} → {exp.endedAt ? datetimeVN(exp.endedAt, intl) : ddmmyyyy(exp.plannedEnd, intl)}</p>
      {exp.lastResult?.text && <p className="text-slate-600">{exp.lastResult.text}</p>}
      {exp.endReport && exp.endReport.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-slate-500">{exp.endReport.map((l, i) => <li key={i}>{l}</li>)}</ul>
      )}
      {exp.errors.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-red-600">{exp.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
      )}
    </div>
  );
}

// ── Root ──

export function ExperimentPanel({ company }: { company: Company }) {
  const intl = useIntlLocale();
  const t = useT();
  const ga4Id = useId(), weeksId = useId(), confirmId = useId();

  const [source, setSource] = useState<Source>("auto");
  const [ga4Event, setGa4Event] = useState("purchase");
  const [ga4NewOnly, setGa4NewOnly] = useState(true);
  const [data, setData] = useState<ExperimentGetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = data?.canEdit ?? false;
  const confirmText = data?.confirmText ?? "XAC NHAN";

  const [candidateId, setCandidateId] = useState<DesignCandidate["id"] | null>(null);
  const [checkedCampaigns, setCheckedCampaigns] = useState<Record<string, boolean>>({});
  const [weeks, setWeeks] = useState<number | null>(null);

  const load = useCallback(async (force?: boolean) => {
    if (force) setReloading(true); else setLoading(true);
    setError(null);
    try {
      const json = await getJson(`/api/google/pmax/experiment?company=${company}&source=${source}&ga4Event=${encodeURIComponent(ga4Event)}&ga4NewOnly=${ga4NewOnly ? 1 : 0}`);
      const d = json as ExperimentGetResponse;
      setData(d);
      setCandidateId((prev) => (prev && d.design.candidates.some((c) => c.id === prev) ? prev : d.design.candidates[0]?.id ?? null));
      setCheckedCampaigns((prev) => {
        const next: Record<string, boolean> = {};
        for (const c of d.design.campaigns) next[c.id] = c.id in prev ? prev[c.id] : true;
        return next;
      });
      setWeeks((prev) => prev ?? d.weeks.default);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("google.pmaxExperiment.connError"));
    } finally {
      setLoading(false); setReloading(false);
    }
  }, [company, source, ga4Event, ga4NewOnly]);

  useEffect(() => { load(); }, [load]);

  const selectedCampaignIds = useMemo(
    () => (data ? data.design.campaigns.filter((c) => checkedCampaigns[c.id]).map((c) => c.id) : []),
    [data, checkedCampaigns],
  );
  const sig = `${candidateId ?? ""}|${selectedCampaignIds.slice().sort().join(",")}|${weeks ?? ""}|${source}|${ga4Event}|${ga4NewOnly}`;

  // ── Kiểm trước / Bật thí nghiệm ──
  const [validating, setValidating] = useState(false);
  const [validateExp, setValidateExp] = useState<GeoExperiment | null>(null);
  const [validateErr, setValidateErr] = useState<string | null>(null);
  const [validatedSig, setValidatedSig] = useState<string | null>(null);

  async function doValidate() {
    if (!candidateId || !selectedCampaignIds.length || !weeks) return;
    setValidating(true); setValidateErr(null); setValidateExp(null);
    try {
      const json = await postJson("/api/google/pmax/experiment", { company, candidateId, campaignIds: selectedCampaignIds, weeks, source, ga4Event, ga4NewOnly, validateOnly: true });
      const exp = json.experiment as GeoExperiment;
      setValidateExp(exp);
      setValidatedSig(exp.errors.length === 0 ? sig : null);
    } catch (e) {
      setValidateErr(e instanceof ApiError ? e.message : t("google.pmaxExperiment.validateError"));
      setValidatedSig(null);
    } finally { setValidating(false); }
  }

  const [launchOpen, setLaunchOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [launching, setLaunching] = useState(false);
  const [launchErr, setLaunchErr] = useState<string | null>(null);

  async function doLaunch() {
    if (!candidateId || !weeks) return;
    setLaunching(true); setLaunchErr(null);
    try {
      const json = await postJson("/api/google/pmax/experiment", { company, candidateId, campaignIds: selectedCampaignIds, weeks, source, ga4Event, ga4NewOnly, validateOnly: false, confirmText: confirmInput });
      const exp = json.experiment as GeoExperiment;
      if (exp.status === "running") {
        setLaunchOpen(false); setConfirmInput(""); setValidatedSig(null); setValidateExp(null);
        load(true);
      } else {
        setLaunchErr(exp.errors.join(" · ") || t("google.pmaxExperiment.launchRejected"));
      }
    } catch (e) {
      setLaunchErr(e instanceof ApiError ? e.message : t("google.pmaxExperiment.launchError"));
    } finally { setLaunching(false); }
  }

  const hasRunning = data?.experiments.some((e) => e.status === "running") ?? false;
  const canApplyLaunch = !!candidateId && selectedCampaignIds.length > 0 && !!weeks && sig === validatedSig && !hasRunning;

  // ── CSV đơn theo tỉnh ──
  const [csvText, setCsvText] = useState("");
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvErr, setCsvErr] = useState<string | null>(null);
  const [csvResult, setCsvResult] = useState<{ rows: number; errors: string[] } | null>(null);

  async function submitCsv() {
    if (!csvText.trim()) return;
    setCsvBusy(true); setCsvErr(null); setCsvResult(null);
    try {
      const json = await postJson("/api/google/pmax/experiment/csv", { company, csv: csvText });
      setCsvResult({ rows: json.rows as number, errors: (json.errors as string[]) ?? [] });
      setCsvText("");
      load(true);
    } catch (e) {
      setCsvErr(e instanceof ApiError ? e.message : t("google.pmaxExperiment.csvError"));
    } finally { setCsvBusy(false); }
  }

  function onCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    void file.text().then(setCsvText);
    e.target.value = "";
  }

  return (
    <section className="space-y-4">
      <div>
        <h3 className="flex items-center gap-1.5 text-base font-extrabold text-slate-900">
          <TestTube2 className="h-4 w-4" aria-hidden="true" /> {t("google.pmaxExperiment.title")}
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          {t("google.pmaxExperiment.intro")}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> <span>{error}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div>
      ) : !data ? null : (
        <>
          {!canEdit && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">{t("google.pmaxExperiment.readOnly")}</p>
          )}

          {/* Nguồn KPI */}
          <div className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-600">{data.design.kpi.note}</p>
              <Button type="button" variant="outline" size="sm" className="h-8 bg-white" onClick={() => load(true)} disabled={loading || reloading}>
                {reloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.pmaxExperiment.reload")}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(Object.keys(SOURCE_LABEL) as Source[]).map((s) => (
                <button key={s} type="button" onClick={() => setSource(s)}
                  className={cn("rounded-lg border px-2.5 py-1 text-[11px] font-semibold", source === s ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500 hover:border-slate-300")}>
                  {t(SOURCE_LABEL[s])}
                </button>
              ))}
              <div className="flex items-center gap-1.5">
                <label htmlFor={ga4Id} className="text-[11px] text-slate-500">{t("google.pmaxExperiment.ga4Event")}</label>
                <Input id={ga4Id} value={ga4Event} onChange={(e) => setGa4Event(e.target.value)} className="h-8 w-28" />
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-600" title={t("google.pmaxExperiment.ga4NewOnlyTitle")}>
                <input type="checkbox" checked={ga4NewOnly} onChange={(e) => setGa4NewOnly(e.target.checked)} className="h-3.5 w-3.5 accent-indigo-600" />
                {t("google.pmaxExperiment.ga4NewOnly")}
              </label>
            </div>

            {data.design.kpi.source === "google" && (
              <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <p className="font-semibold">{t("google.pmaxExperiment.weakKpi")}</p>
                <p>{t("google.pmaxExperiment.weakKpiFix")}</p>
                {data.serviceAccountEmail && (
                  <div className="flex items-center gap-1.5">
                    <code className="rounded bg-white px-1.5 py-0.5">{data.serviceAccountEmail}</code>
                    <CopyButton text={data.serviceAccountEmail} />
                  </div>
                )}
                <Link href="/guide/ket-noi#ga4-thi-nghiem" className="inline-flex items-center gap-1 font-semibold text-amber-900 underline">
                  {t("google.pmaxExperiment.ga4Guide")} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </Link>
              </div>
            )}

            {data.design.kpi.unmatched.length > 0 && (
              <p className="text-[11px] text-slate-400">{t("google.pmaxExperiment.unmatched", { names: data.design.kpi.unmatched.join(", ") })}</p>
            )}

            <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
              <p className="text-[11px] font-semibold text-slate-500">{t("google.pmaxExperiment.csvTitle")} <code>ngay,tinh,so_don</code>)</p>
              {data.csv && (
                <p className="text-[11px] text-slate-400">{t("google.pmaxExperiment.csvInUse", { date: data.csv.uploadedAt.slice(0, 10), rows: data.csv.rows, from: ddmmyyyy(data.csv.from, intl), to: ddmmyyyy(data.csv.to, intl) })}</p>
              )}
              {canEdit && (
                <>
                  <input type="file" accept=".csv,text/csv" onChange={onCsvFile} className="block text-[11px] text-slate-500" />
                  <Textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder={t("google.pmaxExperiment.csvPlaceholder")} className="h-24 text-xs" />
                  <Button type="button" variant="outline" size="sm" className="h-8 bg-white" onClick={submitCsv} disabled={csvBusy || !csvText.trim()}>
                    {csvBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.pmaxExperiment.csvUpload")}
                  </Button>
                  {csvErr && <p className="text-xs text-red-600">{csvErr}</p>}
                  {csvResult && (
                    <p className="text-[11px] text-slate-500">
                      {csvResult.errors.length ? t("google.pmaxExperiment.csvReceivedErr", { rows: csvResult.rows, errors: csvResult.errors.length, list: csvResult.errors.slice(0, 3).join(" · ") }) : t("google.pmaxExperiment.csvReceived", { rows: csvResult.rows })}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Phương án */}
          {data.design.candidates.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">{t("google.pmaxExperiment.noCandidates")}</p>
          ) : (
            <div className="space-y-2">
              {data.design.candidates.map((c) => (
                <CandidateCard key={c.id} c={c} selected={candidateId === c.id} onSelect={() => setCandidateId(c.id)} disabled={!canEdit} />
              ))}
            </div>
          )}

          {/* Chiến dịch áp dụng */}
          {data.design.campaigns.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
              <p className="text-xs font-semibold text-slate-600">{t("google.pmaxExperiment.applyTo")}</p>
              <div className="space-y-1">
                {data.design.campaigns.map((cp) => (
                  <label key={cp.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/40 px-2.5 py-1.5 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <Checkbox checked={!!checkedCampaigns[cp.id]} onCheckedChange={() => setCheckedCampaigns((p) => ({ ...p, [cp.id]: !p[cp.id] }))} disabled={!canEdit} />
                      <span className="truncate text-slate-700">{cp.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-400">{vnd(cp.cost, intl)}{t("google.pmaxExperiment.per30d")}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <label htmlFor={weeksId} className="text-xs font-medium text-slate-500">{t("google.pmaxExperiment.runFor")}</label>
            <select id={weeksId} value={weeks ?? data.weeks.default} onChange={(e) => setWeeks(Number(e.target.value))}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs" disabled={!canEdit}>
              {Array.from({ length: data.weeks.max - data.weeks.min + 1 }, (_, i) => data.weeks.min + i).map((w) => (
                <option key={w} value={w}>{t("google.pmaxExperiment.weeksOpt", { n: w })}</option>
              ))}
            </select>
          </div>

          {canEdit && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={doValidate} disabled={validating || !candidateId || !selectedCampaignIds.length}>
                  {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null} {t("google.pmaxExperiment.validate")}
                </Button>
                <Button type="button" size="sm" className="h-9"
                  onClick={() => { setConfirmInput(""); setLaunchErr(null); setLaunchOpen(true); }}
                  disabled={!canApplyLaunch}
                  title={hasRunning ? t("google.pmaxExperiment.hasRunningTitle") : !canApplyLaunch ? t("google.pmaxExperiment.validateFirst") : undefined}>
                  {t("google.pmaxExperiment.launch")}
                </Button>
                {hasRunning && <span className="text-[11px] text-amber-600">{t("google.pmaxExperiment.hasRunningNote")}</span>}
              </div>
              {validateErr && <p className="text-xs text-red-600">{validateErr}</p>}
              {validateExp && <ValidateResultCard exp={validateExp} />}
            </div>
          )}

          {hasRunning && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-600">{t("google.pmaxExperiment.running")}</p>
              {data.experiments.filter((e) => e.status === "running").map((e) => (
                <RunningExperimentCard key={e.id} exp={e} company={company} canEdit={canEdit} onChanged={() => load(true)} />
              ))}
            </div>
          )}

          {data.experiments.some((e) => e.status !== "running") && (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer select-none py-1 font-semibold text-slate-600">
                {t("google.pmaxExperiment.history", { n: data.experiments.filter((e) => e.status !== "running").length })}
              </summary>
              <div className="mt-2 space-y-2">
                {data.experiments.filter((e) => e.status !== "running").map((e) => <EndedExperimentCard key={e.id} exp={e} />)}
              </div>
            </details>
          )}
        </>
      )}

      <Dialog open={launchOpen} onOpenChange={(o) => { setLaunchOpen(o); if (!o) setConfirmInput(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("google.pmaxExperiment.dlgTitle", { company })}</DialogTitle>
          </DialogHeader>
          {validateExp && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t("google.pmaxExperiment.dlgWarnA", { names: validateExp.holdoutNames.join(", "), weeks: validateExp.weeks, cost: vnd(validateExp.pmaxCostPerWeek, intl) })}{" "}
              {t("google.pmaxExperiment.dlgWarnB", { date: ddmmyyyy(validateExp.plannedEnd, intl) })}
            </p>
          )}
          <div className="space-y-1.5">
            <label htmlFor={confirmId} className="text-xs font-medium text-slate-500">
              {t("google.pmaxExperiment.typeA")} <code className="rounded bg-slate-100 px-1 py-0.5">{confirmText}</code> {t("google.pmaxExperiment.typeB")}
            </label>
            <Input id={confirmId} value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} placeholder={confirmText} autoComplete="off" className="h-10" />
          </div>
          {launchErr && <p className="text-xs text-red-600">{launchErr}</p>}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.pmaxExperiment.cancel")}</DialogClose>
            <Button className="h-10" onClick={doLaunch} disabled={launching || confirmInput.trim() !== confirmText}>
              {launching && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.pmaxExperiment.launchReal")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
