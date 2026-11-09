"use client";

// ============================================================
// Luồng "Tách lượt tìm chung khỏi chiến dịch thương hiệu" (Đợt 11e) — mở từ
// thẻ đề xuất `action.type === "split"` trong SearchXrayTab.tsx.
// ------------------------------------------------------------
// Đọc/ghi qua lib/search/split.ts — module SERVER, ở đây CHỈ `import type`.
// Bước 1 (dựng chiến dịch TẠM DỪNG): Kiểm trước (validateOnly, không ghi) →
// gõ confirmText → Tạo (ghi thật). Bước 2/3 + hoàn tác: mỗi nút thao tác trên
// một bản tách đã có đều qua cùng một hộp thoại gõ confirmText.
// ============================================================

import { useCallback, useEffect, useId, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2, Split as SplitIcon, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getJson, postJson, ApiError } from "@/components/case/api";
import { vnd, num } from "@/components/case/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import type { SplitPlan, SplitAdGroup, SplitRecord, SplitAdGroupAds } from "@/lib/search/split";
import { EditRsaModal } from "@/components/EditRsaModal";
import type { AssetCount, AssetReport } from "@/lib/search/split-assets";
import type { SplitSeries } from "@/lib/search/split-tracking";
import type { SplitAssessment } from "@/lib/search/split-assessment";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

const rich = (s: string) => s.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));

type Company = string;
type Range = { from: string; to: string };
type SplitAction = "enable" | "pause" | "move" | "unmove" | "remove" | "clear_tcpa" | "source_budget";

interface SplitResponse {
  plan: SplitPlan | null;
  assessment: SplitAssessment | null;
  splits: SplitRecord[];
  canEdit: boolean;
  confirmText: string;
}

interface CheckpointResponse {
  record: SplitRecord;
  days: number;
  result: { lines: string[]; verdict: "tot" | "theo_doi" | "dung" } | null;
  note?: string;
}

const MATCH_LABEL: Record<string, MessageKey> = { EXACT: "google.searchSplit.match.exact", PHRASE: "google.searchSplit.match.phrase", BROAD: "google.searchSplit.match.broad" };
const STEP_LABEL: Record<SplitRecord["step"], MessageKey> = {
  created: "google.searchSplit.step.created", moved: "google.searchSplit.step.moved", removed: "google.searchSplit.step.removed", failed: "google.searchSplit.step.failed",
};
const STEP_CLS: Record<SplitRecord["step"], string> = {
  created: "bg-sky-50 text-sky-700 border-sky-200", moved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  removed: "bg-slate-100 text-slate-500 border-slate-200", failed: "bg-red-50 text-red-700 border-red-200",
};
const VERDICT_LABEL: Record<"tot" | "theo_doi" | "dung", MessageKey> = { tot: "google.searchSplit.verdict.good", theo_doi: "google.searchSplit.verdict.watch", dung: "google.searchSplit.verdict.undo" };
const VERDICT_CLS: Record<"tot" | "theo_doi" | "dung", string> = {
  tot: "bg-emerald-50 text-emerald-700 border-emerald-200", theo_doi: "bg-amber-50 text-amber-700 border-amber-200",
  dung: "bg-red-50 text-red-700 border-red-200",
};

function AdGroupPreview({ g }: { g: SplitAdGroup }) {
  const intlLoc = useIntlLocale();
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-slate-100 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="min-w-0 truncate text-xs font-semibold text-slate-700" title={g.name}>{g.name}</span>
        <span className="shrink-0 text-[11px] text-slate-400">{t("google.searchSplit.kwAds", { kw: g.keywords.length, ads: g.ads.length })}</span>
        {open ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />}
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-slate-100 px-3 py-2">
          <table className="w-full text-[11px]">
            <thead><tr className="text-left text-slate-400"><th className="py-1 pr-2 font-medium">{t("google.searchSplit.col.keyword")}</th><th className="py-1 pr-2 font-medium">{t("google.searchSplit.col.match")}</th><th className="py-1 pr-2 text-right font-medium">{t("google.searchSplit.col.cost")}</th><th className="py-1 text-right font-medium">{t("google.searchSplit.col.orders")}</th></tr></thead>
            <tbody>
              {g.keywords.map((k) => (
                <tr key={k.criterion} className="border-t border-slate-50">
                  <td className="py-1 pr-2 text-slate-700">{k.text}</td>
                  <td className="py-1 pr-2 text-slate-500">{MATCH_LABEL[k.match] ? t(MATCH_LABEL[k.match]) : k.match}</td>
                  <td className="py-1 pr-2 text-right tabular-nums text-slate-600">{vnd(k.cost, intlLoc)}</td>
                  <td className="py-1 text-right tabular-nums text-slate-600">{num(k.purchases, { maximumFractionDigits: 1 }, intlLoc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="text-xs font-semibold text-slate-700">{title}</span>
        {open ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />}
      </button>
      {open && <div className="border-t border-slate-100 px-3 py-2.5">{children}</div>}
    </div>
  );
}

function AssessmentView({
  assessment, selectedOption, onSelectOption,
}: {
  assessment: SplitAssessment; selectedOption: "keep_total" | "grow"; onSelectOption: (id: "keep_total" | "grow", genericBudget: number) => void;
}) {
  const intlLoc = useIntlLocale();
  const t = useT();
  return (
    <div className="space-y-2">
      <p className="text-sm font-bold text-slate-800">{t("google.searchSplit.assess.title")}</p>

      <Section title={t("google.searchSplit.assess.now")} defaultOpen>
        <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">{assessment.now.map((n, i) => <li key={i}>{n}</li>)}</ul>
      </Section>

      <Section title={t("google.searchSplit.assess.structure")}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {assessment.structure.map((s, i) => (
            <div key={i} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-semibold text-slate-700" title={s.name}>{s.name}</span>
                <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold", i === 0 ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-emerald-50 text-emerald-700 border-emerald-200")}>{s.role}</span>
              </div>
              <p className="mt-1 text-slate-500">{s.keywords}</p>
              <p className="mt-1 text-slate-400">{t("google.searchSplit.perDay", { amount: vnd(s.budgetPerDay, intlLoc) })} · {s.bidding}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("google.searchSplit.assess.budget")} defaultOpen>
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {assessment.budgetOptions.map((o) => {
              const checked = selectedOption === o.id;
              return (
                <label key={o.id} className={cn("flex cursor-pointer flex-col gap-1 rounded-lg border p-2.5 text-xs", checked ? "border-indigo-400 bg-indigo-50/60 ring-1 ring-indigo-300" : "border-slate-200 bg-white hover:border-slate-300")}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                      <input type="radio" name="budget-option" checked={checked} onChange={() => onSelectOption(o.id, o.genericBudget)} className="h-3.5 w-3.5" />
                      {o.label}
                    </span>
                    {assessment.recommendedOption === o.id && <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{t("google.searchSplit.recommended")}</span>}
                  </span>
                  <span className="text-slate-500">{t("google.searchSplit.budgetLine", { brand: vnd(o.brandBudget, intlLoc), generic: vnd(o.genericBudget, intlLoc), total: vnd(o.total, intlLoc) })}</span>
                  <span className="text-slate-400">{o.note}</span>
                </label>
              );
            })}
          </div>
          <p className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">{t("google.searchSplit.brandBudgetNote")}</p>
        </div>
      </Section>

      <Section title={t("google.searchSplit.assess.bidding")}>
        <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">{assessment.bidding.map((b, i) => <li key={i}>{b}</li>)}</ul>
      </Section>

      <Section title={t("google.searchSplit.assess.timeline")} defaultOpen>
        <ol className="space-y-2.5 border-l border-slate-200 pl-3">
          {assessment.timeline.map((tl, i) => (
            <li key={i} className="relative text-xs">
              <span className="absolute -left-[15px] top-0.5 h-2 w-2 rounded-full border-2 border-white bg-indigo-400" aria-hidden="true" />
              <p className="font-semibold text-slate-700">{tl.when}</p>
              <p className="text-slate-500">{tl.what}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title={t("google.searchSplit.assess.success")}>
        <ul className="space-y-1 text-xs text-emerald-700">
          {assessment.success.map((s, i) => (
            <li key={i} className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>{s}</span></li>
          ))}
        </ul>
      </Section>

      <Section title={t("google.searchSplit.assess.abort")}>
        <ul className="space-y-1 text-xs text-red-700">
          {assessment.abort.map((a, i) => (
            <li key={i} className="flex items-start gap-1.5"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>{a}</span></li>
          ))}
        </ul>
      </Section>

      <Section title={t("google.searchSplit.assess.caveats")}>
        <ul className="list-disc space-y-1 pl-4 text-xs text-slate-400">{assessment.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
      </Section>
    </div>
  );
}

function PlanView({
  plan, assessment, company, range, confirmText, onCreated,
}: {
  plan: SplitPlan; assessment: SplitAssessment | null; company: Company; range: Range; confirmText: string; onCreated: (rec: SplitRecord) => void;
}) {
  const intlLoc = useIntlLocale();
  const t = useT();
  const confirmId = useId();
  const [budget, setBudget] = useState(String(plan.budgetPerDay));
  const [targetCpa, setTargetCpa] = useState("");
  // Mặc định KHÔNG mục tiêu CPA (đánh giá khuyên 2 tuần đầu) — trước đây ô trống = giữ tCPA của gốc (user 01/10).
  const [cpaMode, setCpaMode] = useState<"none" | "keep" | "set">("none");
  const [selectedBudgetOption, setSelectedBudgetOption] = useState<"keep_total" | "grow">(assessment?.recommendedOption ?? "keep_total");

  const [validating, setValidating] = useState(false);
  const [validateOk, setValidateOk] = useState(false);
  const [validateLog, setValidateLog] = useState<string[]>([]);
  const [validateErrs, setValidateErrs] = useState<string[]>([]);
  const [validatedSig, setValidatedSig] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const sig = `${budget}|${cpaMode}|${targetCpa}|${selectedBudgetOption}`;
  const brandBudget = selectedBudgetOption === "keep_total" ? assessment?.budgetOptions.find((o) => o.id === "keep_total")?.brandBudget : undefined;
  const canCreate = validateOk && sig === validatedSig;

  function selectBudgetOption(id: "keep_total" | "grow", genericBudget: number) {
    setSelectedBudgetOption(id);
    setBudget(String(genericBudget));
    setValidateOk(false);
  }

  const genericKeywords = plan.adGroups.reduce((s, g) => s + g.keywords.length, 0);
  const genericAds = plan.adGroups.reduce((s, g) => s + g.ads.length, 0);
  const budgetIncreaseNote = plan.notes.find((n) => n.startsWith("Tổng ngân sách/ngày tăng"));
  const otherNotes = plan.notes.filter((n) => n !== budgetIncreaseNote);

  async function run(validateOnly: boolean, confirmTextInput?: string) {
    const b = Number(budget);
    const cpa = cpaMode === "set" && targetCpa.trim() ? Number(targetCpa) : undefined;
    return postJson("/api/google/search/split", {
      company, op: "create", campaignId: plan.sourceId, from: range.from, to: range.to,
      budgetPerDay: Number.isFinite(b) && b > 0 ? b : undefined,
      targetCpa: cpa !== undefined && Number.isFinite(cpa) && cpa > 0 ? cpa : undefined, cpaMode,
      sourceBudgetPerDay: brandBudget && !plan.sourceBudgetShared ? brandBudget : undefined,
      validateOnly, confirmText: confirmTextInput,
    });
  }

  async function doValidate() {
    setValidating(true); setValidateErrs([]); setValidateLog([]); setValidateOk(false); setValidatedSig(null);
    try {
      const json = await run(true);
      const rec = json.record as SplitRecord;
      setValidateLog(rec.log ?? []);
      if (rec.errors.length) setValidateErrs(rec.errors);
      else { setValidateOk(true); setValidatedSig(sig); }
    } catch (e) {
      setValidateErrs([e instanceof ApiError ? e.message : t("google.searchSplit.validateFailed")]);
    } finally { setValidating(false); }
  }

  async function doCreate() {
    setCreating(true); setCreateErr(null);
    try {
      const json = await run(false, confirmInput);
      const rec = json.record as SplitRecord;
      if (rec.step === "created" || rec.step === "moved") {
        setCreateOpen(false); setConfirmInput(""); setValidateOk(false); setValidatedSig(null);
        onCreated(rec);
      } else {
        setCreateErr(rec.errors.join(" · ") || t("google.searchSplit.createRejected"));
      }
    } catch (e) {
      setCreateErr(e instanceof ApiError ? e.message : t("google.searchSplit.createFailed"));
    } finally { setCreating(false); }
  }

  return (
    <div className="space-y-3">
      {assessment && (
        <AssessmentView assessment={assessment} selectedOption={selectedBudgetOption} onSelectOption={selectBudgetOption} />
      )}

      <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2.5 text-xs text-indigo-900">
        <p>{rich(t("google.searchSplit.stepsIntro"))}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
          <p className="font-semibold text-slate-700">{t("google.searchSplit.newCampaign")}</p>
          <p className="mt-1 text-slate-600">{plan.newName}</p>
          <p className="mt-1 text-slate-400">{t("google.searchSplit.planSummary", { bidding: plan.bidding, kw: genericKeywords, groups: plan.adGroups.length, ads: genericAds })}</p>
        </div>
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs">
          <label className="block">
            <span className="font-semibold text-slate-700">{t("google.searchSplit.dailyBudget")}</span>
            <Input type="number" min={0} value={budget} onChange={(e) => { setBudget(e.target.value); setValidateOk(false); }} className="mt-1 h-9" />
            <span className="mt-1 block text-slate-400">{t("google.searchSplit.genericCostNow", { amount: t("google.searchSplit.perDay", { amount: vnd(plan.genericCostPerDay, intlLoc) }) })}</span>
          </label>
          {brandBudget && plan.sourceBudgetPerDay && brandBudget !== plan.sourceBudgetPerDay && (
            <p className="rounded-md bg-sky-50 px-2 py-1.5 text-sky-800">
              {plan.sourceBudgetShared
                ? t("google.searchSplit.sharedBudget")
                : t("google.searchSplit.keepTotal", { from: vnd(plan.sourceBudgetPerDay, intlLoc), to: vnd(brandBudget, intlLoc) })}
            </p>
          )}
          <div className="block">
            <span className="font-semibold text-slate-700">{t("google.searchSplit.targetCpa")}</span>
            <div className="mt-1 space-y-1">
              {([
                ["none", t("google.searchSplit.cpa.none")],
                ...(plan.sourceTargetCpa ? [["keep", t("google.searchSplit.cpa.keep", { cpa: vnd(plan.sourceTargetCpa, intlLoc) })]] : []),
                ["set", t("google.searchSplit.cpa.set")],
              ] as ["none" | "keep" | "set", string][]).map(([v, l]) => (
                <label key={v} className="flex items-center gap-1.5 text-slate-600">
                  <input type="radio" name={`cpa-${plan.sourceId}`} checked={cpaMode === v} onChange={() => { setCpaMode(v); setValidateOk(false); }} /> {l}
                </label>
              ))}
            </div>
            {cpaMode === "set" && <Input type="number" min={0} value={targetCpa} onChange={(e) => { setTargetCpa(e.target.value); setValidateOk(false); }} placeholder={t("google.searchSplit.cpaPlaceholder")} className="mt-1 h-9" />}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-slate-700">{t("google.searchSplit.groupsToMove", { n: plan.adGroups.length })}</p>
        <div className="space-y-1.5">{plan.adGroups.map((g) => <AdGroupPreview key={g.sourceId} g={g} />)}</div>
        {plan.adGroups.length === 0 && <p className="text-xs text-slate-400">{t("google.searchSplit.noGroups")}</p>}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
        <p className="font-semibold text-slate-700">{t("google.searchSplit.assetsToLink")}</p>
        {plan.assets ? (
          <>
            <p>{t("google.searchSplit.campaignLevel", { list: countsText(plan.assets.campaign, t) })}</p>
            {plan.assets.adGroup.length > 0 && <p>{t("google.searchSplit.adGroupLevel", { list: countsText(plan.assets.adGroup, t) })}</p>}
            <p className="text-slate-400">{t("google.searchSplit.accountAssets")}</p>
          </>
        ) : <p className="text-amber-700">{t("google.searchSplit.assetsUnreadable")}</p>}
      </div>

      {plan.brandNegatives.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-700">{t("google.searchSplit.brandNegatives", { n: plan.brandNegatives.length })}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {plan.brandNegatives.map((n) => <span key={n} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">{n}</span>)}
          </div>
        </div>
      )}

      {plan.skippedAdGroups.length > 0 && (
        <details className="text-[11px] text-amber-700">
          <summary className="cursor-pointer select-none font-semibold">{t("google.searchSplit.skippedGroups", { n: plan.skippedAdGroups.length })}</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{plan.skippedAdGroups.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </details>
      )}

      {budgetIncreaseNote && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">⚠️ {budgetIncreaseNote}</p>}
      {otherNotes.length > 0 && <div className="space-y-1 text-[11px] text-slate-500">{otherNotes.map((n, i) => <p key={i}>{n}</p>)}</div>}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={doValidate} disabled={validating || plan.adGroups.length === 0 || (cpaMode === "set" && !(Number(targetCpa) > 0))}>
          {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null} {t("google.searchSplit.validateBtn")}
        </Button>
        <Button type="button" size="sm" className="h-9" onClick={() => { setConfirmInput(""); setCreateErr(null); setCreateOpen(true); }} disabled={!canCreate}
          title={!canCreate ? t("google.searchSplit.createHint") : undefined}>
          <SplitIcon className="h-3.5 w-3.5" aria-hidden="true" /> {t("google.searchSplit.createPaused")}
        </Button>
      </div>
      {validateErrs.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-xs text-red-700">{validateErrs.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {validateOk && validateLog.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-xs text-emerald-700">{validateLog.map((l, i) => <li key={i} className={l.startsWith("Bỏ ") ? "text-amber-700" : undefined}>{l}</li>)}</ul>}

      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) setConfirmInput(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("google.searchSplit.createTitle", { name: plan.newName, company })}</DialogTitle>
            <DialogDescription>{t("google.searchSplit.createDesc")}</DialogDescription>
          </DialogHeader>
          <p className="text-xs text-slate-600">{t("google.searchSplit.createSummary", { kw: genericKeywords, groups: plan.adGroups.length, budget: t("google.searchSplit.perDay", { amount: vnd(Number(budget) || plan.budgetPerDay, intlLoc) }) })}</p>
          <div className="space-y-1.5">
            <label htmlFor={confirmId} className="text-xs font-medium text-slate-500">
              {t("google.searchSplit.typePrefix")}<code className="rounded bg-slate-100 px-1 py-0.5">{confirmText}</code>{t("google.searchSplit.typeSuffix")}
            </label>
            <Input id={confirmId} value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} placeholder={confirmText} autoComplete="off" className="h-10" />
          </div>
          {createErr && <p className="text-xs text-red-600">{createErr}</p>}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.searchSplit.cancel")}</DialogClose>
            <Button className="h-10" onClick={doCreate} disabled={creating || confirmInput.trim() !== confirmText}>
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.searchSplit.createLive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Một bản tách đã có ──

const countsText = (c: AssetCount[], t: ReturnType<typeof useT>) => (c.length ? c.map((x) => `${x.count} ${x.label}`).join(" · ") : t("google.searchSplit.none"));

/** Đợt 18c: bổ sung tài sản — Kiểm trước (không ghi) rồi gõ xác nhận mới gắn thật. */
function AssetPanel({ rec, company, confirmText, canEdit, onChanged }: { rec: SplitRecord; company: Company; confirmText: string; canEdit: boolean; onChanged: (rec: SplitRecord) => void }) {
  const t = useT();
  const confirmId = useId();
  const [preview, setPreview] = useState<AssetReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const last = [...(rec.assetReports ?? [])].reverse().find((a) => !a.validateOnly);
  async function check() {
    setBusy(true); setErr(null);
    try { const j = await postJson("/api/google/search/split", { company, op: "assets", id: rec.id, validateOnly: true }); setPreview(j.report as AssetReport); }
    catch (e) { setErr(e instanceof ApiError ? e.message : t("google.searchSplit.validateFailed")); } finally { setBusy(false); }
  }
  async function apply() {
    setBusy(true); setErr(null);
    try { const j = await postJson("/api/google/search/split", { company, op: "assets", id: rec.id, validateOnly: false, confirmText: input }); onChanged(j.record as SplitRecord); setPreview(null); setOpen(false); setInput(""); }
    catch (e) { setErr(e instanceof ApiError ? e.message : t("google.searchSplit.linkFailed")); } finally { setBusy(false); }
  }
  const nothing = preview && !preview.planned.length;
  return (
    <div className="space-y-1.5 border-t border-slate-100 pt-2">
      <p className="text-slate-500"><span className="font-semibold text-slate-700">{t("google.searchSplit.assetsLabel")}</span>
        {last ? <>{t("google.searchSplit.linked", { list: countsText(last.added, t) })}{last.after ? t("google.searchSplit.nowHas", { list: countsText(last.after, t) }) : ""}</> : t("google.searchSplit.notLinked")}</p>
      {last?.failed.map((x, i) => <p key={i} className="text-red-600">{t("google.searchSplit.linkFailedItem", { count: x.count, label: x.label, error: x.error })}</p>)}
      {last?.notes.map((n, i) => <p key={i} className={n.startsWith("Bỏ ") ? "text-amber-700" : "text-slate-400"}>{n}</p>)}
      {canEdit && (
        <Button type="button" variant="outline" size="sm" className="h-8 bg-white" onClick={check} disabled={busy}>
          {busy && !open ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null} {t("google.searchSplit.addAssets")}
        </Button>
      )}
      {preview && (
        <div className="space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
          <p>{t("google.searchSplit.previewCounts", { source: countsText(preview.source, t), before: countsText(preview.before, t) })}</p>
          {nothing ? <p className="text-emerald-700">{t("google.searchSplit.nothingToLink")}</p> : <p className="font-semibold text-slate-700">{t("google.searchSplit.willLink", { list: countsText(preview.planned, t) })}{preview.failed.length ? "" : t("google.searchSplit.googleValidated")}</p>}
          {preview.failed.map((x, i) => <p key={i} className="text-red-600">{t("google.searchSplit.googleRejectedItem", { count: x.count, label: x.label, error: x.error })}</p>)}
          {preview.notes.map((n, i) => <p key={i} className={n.startsWith("Bỏ ") ? "text-amber-700" : "text-slate-400"}>{n}</p>)}
          {!nothing && canEdit && <Button type="button" size="sm" className="h-8" onClick={() => { setInput(""); setOpen(true); }}>{t("google.searchSplit.linkLive")}</Button>}
        </div>
      )}
      {err && <p className="text-red-600">{err}</p>}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setInput(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("google.searchSplit.linkTitle", { name: rec.name })}</DialogTitle>
            <DialogDescription>{t("google.searchSplit.linkDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor={confirmId} className="text-xs font-medium text-slate-500">{t("google.searchSplit.typePrefix")}<code className="rounded bg-slate-100 px-1 py-0.5">{confirmText}</code>{t("google.searchSplit.typeSuffix")}</label>
            <Input id={confirmId} value={input} onChange={(e) => setInput(e.target.value)} placeholder={confirmText} autoComplete="off" className="h-10" />
          </div>
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.searchSplit.cancel")}</DialogClose>
            <Button className="h-10" onClick={apply} disabled={busy || input.trim() !== confirmText}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.searchSplit.link")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Đợt 18h: diễn biến theo ngày của 2 chiến dịch (chỉ đọc). */
const STRENGTH_VI: Record<string, { label: MessageKey; cls: string }> = {
  EXCELLENT: { label: "google.searchSplit.strength.excellent", cls: "text-emerald-700" }, GOOD: { label: "google.searchSplit.strength.good", cls: "text-emerald-700" },
  AVERAGE: { label: "google.searchSplit.strength.average", cls: "text-amber-700" }, POOR: { label: "google.searchSplit.strength.poor", cls: "text-red-600" },
  PENDING: { label: "google.searchSplit.strength.pending", cls: "text-slate-400" }, NO_ADS: { label: "google.searchSplit.strength.noAds", cls: "text-slate-400" },
};

/**
 * Đợt 19d (18e): quảng cáo bản "· Chung" chép từ chiến dịch thương hiệu → Ad strength thường "Kém" với lượt tìm chung.
 * Mở công cụ sửa RSA sẵn có (AI gợi ý theo từ khoá của bản tách → bạn duyệt → Kiểm trước + XAC NHAN). Tool KHÔNG tự sửa.
 */
function SplitAdsPanel({ rec, company, canEdit }: { rec: SplitRecord; company: Company; canEdit: boolean }) {
  const t = useT();
  const [groups, setGroups] = useState<SplitAdGroupAds[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<SplitAdGroupAds | null>(null);
  async function load() {
    setBusy(true); setErr(null);
    try { const j = await getJson(`/api/google/search/split?company=${company}&adsOf=${rec.id}`); setGroups(j.adGroups as SplitAdGroupAds[]); }
    catch (e) { setErr(e instanceof ApiError ? e.message : t("google.searchSplit.readFailed")); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-1.5 border-t border-slate-100 pt-2">
      <Button type="button" variant="outline" size="sm" className="h-8 bg-white" onClick={load} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null} {t("google.searchSplit.splitAds")}
      </Button>
      {err && <p className="text-red-600">{err}</p>}
      {groups && (groups.length === 0 ? <p className="text-slate-400">{t("google.searchSplit.noRsa")}</p> : (
        <div className="space-y-1.5 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
          <p className="text-slate-500">{t("google.searchSplit.adsHint")}</p>
          {groups.map((g) => (
            <div key={g.adGroupId} className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-700">{g.name}</span>
              <span className="text-slate-400">{t("google.searchSplit.kwCountDot", { n: g.keywords.length })}</span>
              {g.ads.map((a) => <span key={a.id} className={STRENGTH_VI[a.strength]?.cls ?? "text-slate-500"}>{STRENGTH_VI[a.strength] ? t(STRENGTH_VI[a.strength].label) : a.strength}</span>)}
              {canEdit && g.ads.length > 0 && (
                <Button type="button" size="sm" variant="outline" className="h-7 bg-white" onClick={() => setEditing(g)}>{t("google.searchSplit.editWithAi")}</Button>
              )}
            </div>
          ))}
        </div>
      ))}
      {editing && (
        <EditRsaModal isOpen={!!editing} onClose={() => { setEditing(null); void load(); }} company={company}
          adGroupId={editing.adGroupId} adGroupName={editing.name} campaignId={String(rec.newCampaign ?? "").split("/").pop() ?? ""}
          weakest="AD_RELEVANCE" keyword={editing.keywords[0] ?? ""} adGroupKeywords={editing.keywords} />
      )}
    </div>
  );
}

function SeriesPanel({ rec, company }: { rec: SplitRecord; company: Company }) {
  const intlLoc = useIntlLocale();
  const t = useT();
  const [data, setData] = useState<SplitSeries | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function load() {
    setBusy(true); setErr(null);
    try { const j = await getJson(`/api/google/search/split?company=${company}&series=${rec.id}`); setData(j.series as SplitSeries); }
    catch (e) { setErr(e instanceof ApiError ? e.message : t("google.searchSplit.readFailed")); } finally { setBusy(false); }
  }
  const cpa = (x: { cpa: number | null }) => (x.cpa ? vnd(x.cpa, intlLoc) : "—");
  return (
    <div className="space-y-1.5 border-t border-slate-100 pt-2">
      <Button type="button" variant="outline" size="sm" className="h-8 bg-white" onClick={load} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null} {t("google.searchSplit.daily")}
      </Button>
      {err && <p className="text-red-600">{err}</p>}
      {data && (
        <div className="space-y-1.5 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
          <p>{t("google.searchSplit.series.newCampaign", { status: data.newStatus ?? "—" })}{data.learning ? ` · ${data.learning}` : ""}{data.sourceLostBudget7d != null ? t("google.searchSplit.series.lostBudget", { pct: Math.round(data.sourceLostBudget7d * 100) }) : ""}</p>
          <p>{t("google.searchSplit.series.totals", { from: data.from.slice(5).split("-").reverse().join("/"), to: data.to.slice(5).split("-").reverse().join("/"), sCost: vnd(data.totals.source.cost, intlLoc), sConv: num(data.totals.source.conv, undefined, intlLoc), sCpa: cpa(data.totals.source), nCost: vnd(data.totals.split.cost, intlLoc), nConv: num(data.totals.split.conv, undefined, intlLoc), nCpa: cpa(data.totals.split) })}</p>
          <div className="max-h-48 overflow-auto">
            <table className="w-full text-[11px]">
              <thead className="text-slate-400"><tr><th className="text-left">{t("google.searchSplit.series.date")}</th><th className="text-right">{t("google.searchSplit.series.sCost")}</th><th className="text-right">{t("google.searchSplit.series.sConv")}</th><th className="text-right">{t("google.searchSplit.series.nCost")}</th><th className="text-right">{t("google.searchSplit.series.nConv")}</th></tr></thead>
              <tbody>{[...data.points].reverse().map((p) => (
                <tr key={p.date} className="border-t border-slate-100"><td>{p.date.slice(5).split("-").reverse().join("/")}</td><td className="text-right tabular-nums">{vnd(p.source.cost, intlLoc)}</td><td className="text-right tabular-nums">{num(p.source.conv, undefined, intlLoc)}</td><td className="text-right tabular-nums">{vnd(p.split.cost, intlLoc)}</td><td className="text-right tabular-nums">{num(p.split.conv, undefined, intlLoc)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="text-slate-400">{t("google.searchSplit.series.convNote")}</p>
        </div>
      )}
    </div>
  );
}

const STEP_BUTTONS: Record<string, { action: SplitAction; label: MessageKey; variant: "default" | "outline" | "destructive" }[]> = {
  created: [
    { action: "enable", label: "google.searchSplit.btn.enable", variant: "default" },
    { action: "pause", label: "google.searchSplit.btn.pause", variant: "outline" },
    { action: "move", label: "google.searchSplit.btn.move", variant: "default" },
    { action: "clear_tcpa", label: "google.searchSplit.btn.clearTcpa", variant: "outline" },
    { action: "source_budget", label: "google.searchSplit.btn.sourceBudget", variant: "outline" },
    { action: "remove", label: "google.searchSplit.btn.remove", variant: "destructive" },
  ],
  moved: [
    { action: "unmove", label: "google.searchSplit.btn.unmove", variant: "outline" },
    { action: "pause", label: "google.searchSplit.btn.pause", variant: "outline" },
    { action: "clear_tcpa", label: "google.searchSplit.btn.clearTcpa", variant: "outline" },
    { action: "source_budget", label: "google.searchSplit.btn.sourceBudget", variant: "outline" },
  ],
};

function SplitRecordCard({
  rec, company, confirmText, canEdit, onChanged,
}: {
  rec: SplitRecord; company: Company; confirmText: string; canEdit: boolean; onChanged: (rec: SplitRecord) => void;
}) {
  const t = useT();
  const intl = useIntlLocale();
  const confirmId = useId();
  const [logOpen, setLogOpen] = useState(false);
  const [pending, setPending] = useState<{ action: SplitAction; label: MessageKey } | null>(null);
  const [confirmInput, setConfirmInput] = useState("");
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState("");

  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [checkpointLoading, setCheckpointLoading] = useState(false);
  const [checkpointErr, setCheckpointErr] = useState<string | null>(null);
  const [checkpointData, setCheckpointData] = useState<CheckpointResponse | null>(null);

  const buttons = STEP_BUTTONS[rec.step] ?? [];

  async function run() {
    if (!pending) return;
    setRunning(true); setErr(null);
    try {
      const json = await postJson("/api/google/search/split", { company, op: "action", id: rec.id, action: pending.action, confirmText: confirmInput, ...(pending.action === "source_budget" ? { amount: Number(amount) } : {}) });
      onChanged(json.record as SplitRecord);
      setPending(null); setConfirmInput("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("google.searchSplit.actionFailed"));
    } finally { setRunning(false); }
  }

  async function doCheckpoint() {
    setCheckpointOpen(true); setCheckpointLoading(true); setCheckpointErr(null);
    try {
      const json = await getJson(`/api/google/search/split?company=${company}&checkpoint=${rec.id}`);
      setCheckpointData(json.checkpoint as CheckpointResponse);
    } catch (e) {
      setCheckpointErr(e instanceof ApiError ? e.message : t("google.searchSplit.measureFailed"));
    } finally { setCheckpointLoading(false); }
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate font-semibold text-slate-800" title={rec.name}>{rec.name}</p>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold", STEP_CLS[rec.step])}>{t(STEP_LABEL[rec.step])}</span>
      </div>
      <p className="text-slate-400">{t("google.searchSplit.recSummary", { source: rec.sourceName, kw: rec.keywordsCount, groups: rec.adGroupsCount, budget: t("google.searchSplit.perDay", { amount: vnd(rec.budgetPerDay, intl) }) })}</p>
      {rec.movedAt && <p className="text-slate-400">{t("google.searchSplit.movedAt", { time: new Date(rec.movedAt).toLocaleString(intl, { timeZone: "Asia/Ho_Chi_Minh" }) })}</p>}
      {rec.errors.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-red-700">{rec.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {rec.goalReport && <p className="text-slate-400">{rec.goalReport}</p>}
      {rec.log.length > 0 && (
        <div>
          <button type="button" onClick={() => setLogOpen((o) => !o)} className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700">
            {logOpen ? <ChevronUp className="h-3 w-3" aria-hidden="true" /> : <ChevronDown className="h-3 w-3" aria-hidden="true" />} {t("google.searchSplit.log", { n: rec.log.length })}
          </button>
          {logOpen && <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-500">{rec.log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
        </div>
      )}

      {(rec.checkpoints?.["7"] || rec.checkpoints?.["14"]) && (
        <div className="space-y-1 border-t border-slate-100 pt-2">
          {(["7", "14"] as const).filter((d) => rec.checkpoints?.[d]).map((d) => (
            <div key={d}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-500">{t("google.searchSplit.autoCheckpoint", { d, date: new Date(rec.checkpoints![d]!.at).toLocaleDateString(intl, { timeZone: "Asia/Ho_Chi_Minh" }) })}</span>
                <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold", VERDICT_CLS[rec.checkpoints![d]!.verdict])}>{t(VERDICT_LABEL[rec.checkpoints![d]!.verdict])}</span>
              </div>
              <ul className="list-disc space-y-0.5 pl-4 text-slate-600">{rec.checkpoints![d]!.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </div>
          ))}
        </div>
      )}

      {(rec.step === "created" || rec.step === "moved") && rec.newCampaign && (
        <>
          <AssetPanel rec={rec} company={company} confirmText={confirmText} canEdit={canEdit} onChanged={onChanged} />
          <SeriesPanel rec={rec} company={company} />
          <SplitAdsPanel rec={rec} company={company} canEdit={canEdit} />
        </>
      )}

      {rec.step === "moved" && (
        <div className="border-t border-slate-100 pt-2">
          <Button type="button" variant="outline" size="sm" className="h-8 bg-white" onClick={doCheckpoint} disabled={checkpointLoading}>
            {checkpointLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null} {t("google.searchSplit.remeasure")}
          </Button>
          {checkpointOpen && (
            <div className="mt-2 space-y-1.5 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
              {checkpointErr && <p className="text-red-600">{checkpointErr}</p>}
              {checkpointData?.result && (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-500">{t("google.searchSplit.measureDays", { n: checkpointData.days })}</span>
                    <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold", VERDICT_CLS[checkpointData.result.verdict])}>{t(VERDICT_LABEL[checkpointData.result.verdict])}</span>
                  </div>
                  <ul className="list-disc space-y-0.5 pl-4 text-slate-600">{checkpointData.result.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                </>
              )}
              {checkpointData?.note && <p className="text-slate-400">{checkpointData.note}</p>}
            </div>
          )}
        </div>
      )}
      {rec.sourceBudget && (
        <p className="border-t border-slate-100 pt-2 text-slate-600">
          <span className="font-semibold text-slate-700">{t("google.searchSplit.sourceBudgetLabel")}</span>
          {rec.sourceBudget.appliedAt
            ? <>{t("google.searchSplit.sbChanged", { range: `${rec.sourceBudget.before ? `${vnd(rec.sourceBudget.before, intl)} → ` : ""}${t("google.searchSplit.perDay", { amount: vnd(rec.sourceBudget.target, intl) })}` })}{rec.step === "moved" ? t("google.searchSplit.sbUndoNote") : ""}</>
            : <>{t("google.searchSplit.sbWillLower", { amount: t("google.searchSplit.perDay", { amount: vnd(rec.sourceBudget.target, intl) }) })}</>}
        </p>
      )}
      {rec.step === "created" && (
        <p className="border-t border-slate-100 pt-2 text-slate-400">{t("google.searchSplit.autoMeasureNote")}</p>
      )}

      {canEdit && buttons.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
          {buttons.map((b) => (
            <Button key={b.action} type="button" size="sm" variant={b.variant} className="h-8"
              onClick={() => { setPending(b); setConfirmInput(""); setErr(null); setAmount(rec.sourceBudget ? String(rec.sourceBudget.target) : ""); }}>
              {t(b.label)}
            </Button>
          ))}
        </div>
      )}

      <Dialog open={!!pending} onOpenChange={(o) => { if (!o) { setPending(null); setErr(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending ? t(pending.label) : ""} — &quot;{rec.name}&quot;?</DialogTitle>
            <DialogDescription>{t("google.searchSplit.writeLiveDesc", { company })}</DialogDescription>
          </DialogHeader>
          {pending?.action === "clear_tcpa" && (
            <p className="text-xs text-slate-600">{rich(t("google.searchSplit.clearTcpaDesc"))}</p>
          )}
          {pending?.action === "source_budget" && (
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-slate-600">{t("google.searchSplit.newBudgetFor", { name: rec.sourceName })}</span>
              <Input type="number" min={50000} value={amount} onChange={(e) => setAmount(e.target.value)} className="h-10" />
              <span className="block text-slate-400">{t("google.searchSplit.keepTotalHint", { amount: vnd(rec.budgetPerDay, intl) })}</span>
            </label>
          )}
          <div className="space-y-1.5">
            <label htmlFor={confirmId} className="text-xs font-medium text-slate-500">
              {t("google.searchSplit.typePrefix")}<code className="rounded bg-slate-100 px-1 py-0.5">{confirmText}</code>{t("google.searchSplit.typeSuffix")}
            </label>
            <Input id={confirmId} value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} placeholder={confirmText} autoComplete="off" className="h-10" />
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.searchSplit.cancel")}</DialogClose>
            <Button className="h-10" variant="destructive" onClick={run} disabled={running || confirmInput.trim() !== confirmText || (pending?.action === "source_budget" && !(Number(amount) >= 50000))}>
              {running && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.searchSplit.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Root ──

export function SearchSplitDialog({
  company, range, campaignId, open, onOpenChange, onChanged,
}: {
  company: Company; range: Range; campaignId: string | null; open: boolean;
  onOpenChange: (open: boolean) => void; onChanged: () => void;
}) {
  const t = useT();
  const [data, setData] = useState<SplitResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true); setError(null); setData(null);
    try {
      const json = await getJson(`/api/google/search/split?company=${company}&campaignId=${campaignId}&from=${range.from}&to=${range.to}`);
      setData(json as SplitResponse);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("google.searchSplit.connError"));
    } finally { setLoading(false); }
  }, [campaignId, company, range.from, range.to, t]);

  useEffect(() => { if (open && campaignId) load(); }, [open, campaignId, load]);

  function patchSplit(rec: SplitRecord) {
    setData((prev) => {
      if (!prev) return prev;
      const exists = prev.splits.some((s) => s.id === rec.id);
      const splits = exists ? prev.splits.map((s) => (s.id === rec.id ? rec : s)) : [rec, ...prev.splits];
      return { ...prev, splits };
    });
    onChanged();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5"><SplitIcon className="h-4 w-4" aria-hidden="true" /> {t("google.searchSplit.title")}</DialogTitle>
          <DialogDescription>{t("google.searchSplit.desc")}</DialogDescription>
        </DialogHeader>

        {loading && <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
        {error && <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /><span>{error}</span></div>}

        {data && (
          <div className="space-y-5">
            {!data.canEdit && (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">{t("google.searchSplit.readOnly")}</p>
            )}

            {data.splits.some((s) => s.sourceId === campaignId && (s.step === "created" || s.step === "moved")) ? (
              // Đã có bản tách đang dùng → không mời tạo bản thứ hai (user 01/10 bấm Kiểm trước lần nữa tưởng chưa làm). Máy chủ cũng chặn tạo trùng (409).
              <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                {rich(t("google.searchSplit.alreadySplit"))}
              </p>
            ) : data.plan ? (
              data.canEdit ? (
                <PlanView plan={data.plan} assessment={data.assessment} company={company} range={range} confirmText={data.confirmText} onCreated={patchSplit} />
              ) : (
                <p className="text-xs text-slate-500">{t("google.searchSplit.readOnlyPlan", { name: data.plan.newName, groups: data.plan.adGroups.length })}</p>
              )
            ) : (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">{t("google.searchSplit.noPlan")}</p>
            )}

            {data.splits.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <p className="text-xs font-bold text-slate-700">{t("google.searchSplit.existing", { n: data.splits.length })}</p>
                <div className="space-y-2">
                  {data.splits.map((s) => (
                    <SplitRecordCard key={s.id} rec={s} company={company} confirmText={data.confirmText} canEdit={data.canEdit} onChanged={patchSplit} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
