"use client";

// ============================================================
// Tab "✍️ Quảng cáo RSA" của /google-search (Đợt 11e) — mirror
// components/pmax/AssetHealthPanel.tsx (draft bằng Gemini → radio 3 phương án
// + tự viết → Kiểm trước → gõ confirmText → Ghi thật → Hoàn tác).
// ------------------------------------------------------------
// Đọc/ghi qua lib/search/rsa.ts — module SERVER (kéo google-ads SDK + Gemini)
// nên ở đây CHỈ `import type`. Google đã bỏ nhãn hiệu suất theo dòng — dòng
// yếu được server tự chấm theo tỉ lệ bấm trong CÙNG quảng cáo.
// ============================================================

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2, Pin, RefreshCw, Sparkles, Undo2, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getJson, postJson, ApiError } from "@/components/case/api";
import { vnd, num, pct, datetimeVN } from "@/components/case/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import type { RsaAd, RsaLine, RsaEdit } from "@/lib/search/rsa";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

type Company = string;
type Range = { from: string; to: string };
type Field = "HEADLINE" | "DESCRIPTION";
interface PolicyFindingLite { severity: "block" | "warn"; rule: string; where: string; detail: string }
interface DraftItem { field: Field; oldText: string; options: { text: string; findings: PolicyFindingLite[] }[]; rejected: string[] }

interface RsaResponse {
  range: Range; ads: RsaAd[]; errors: string[]; history: RsaEdit[]; canEdit: boolean; confirmText: string;
}

const TEXT_LIMIT: Record<Field, number> = { HEADLINE: 30, DESCRIPTION: 90 };
const FIELD_LABEL: Record<Field, MessageKey> = { HEADLINE: "google.searchRsa.field.headline", DESCRIPTION: "google.searchRsa.field.description" };
const STRENGTH_META: Record<string, { label: MessageKey; cls: string }> = {
  EXCELLENT: { label: "google.searchRsa.strength.excellent", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  GOOD: { label: "google.searchRsa.strength.good", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  AVERAGE: { label: "google.searchRsa.strength.average", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  POOR: { label: "google.searchRsa.strength.poor", cls: "bg-red-50 text-red-700 border-red-200" },
};
const STRENGTH_FALLBACK: { label: MessageKey; cls: string } = { label: "google.searchRsa.unknown", cls: "bg-slate-100 text-slate-500 border-slate-200" };
const APPROVAL_META: Record<string, { label: MessageKey; cls: string }> = {
  APPROVED: { label: "google.searchRsa.approval.approved", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  APPROVED_LIMITED: { label: "google.searchRsa.approval.limited", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  DISAPPROVED: { label: "google.searchRsa.approval.disapproved", cls: "bg-red-50 text-red-700 border-red-200" },
  UNDER_REVIEW: { label: "google.searchRsa.approval.underReview", cls: "bg-slate-100 text-slate-500 border-slate-200" },
  PENDING_REVIEW: { label: "google.searchRsa.approval.pending", cls: "bg-slate-100 text-slate-500 border-slate-200" },
};
const lineKey = (l: { field: string; text: string }) => `${l.field}|${l.text}`;

function Badge({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", cls)}>{children}</span>;
}

// ── Kết quả một lần Kiểm trước / Ghi ──

function EditResultCard({ edit, phase }: { edit: RsaEdit; phase: "validate" | "write" }) {
  const t = useT();
  const ok = edit.status === "done";
  const title = phase === "validate"
    ? ok ? t("google.searchRsa.result.validateOk") : t("google.searchRsa.result.validateFail")
    : ok ? t("google.searchRsa.result.writeOk") : t("google.searchRsa.result.writeFail");
  return (
    <div className={cn("rounded-lg border p-2.5 text-xs", !ok ? "border-red-200 bg-red-50" : phase === "validate" ? "border-sky-200 bg-sky-50" : "border-emerald-200 bg-emerald-50")}>
      <div className={cn("flex items-center gap-1.5 font-semibold", !ok ? "text-red-700" : phase === "validate" ? "text-sky-800" : "text-emerald-700")}>
        {ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        {title}
      </div>
      {edit.changes.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-slate-600">
          {edit.changes.map((c, i) => <li key={i}>&ldquo;{c.oldText}&rdquo; → &ldquo;{c.newText}&rdquo;</li>)}
        </ul>
      )}
      {edit.errors.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-red-700">{edit.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
    </div>
  );
}

// ── Một dòng trong bảng lines ──

function LinesTable({ lines, weakKeys }: { lines: RsaLine[]; weakKeys: Set<string> }) {
  const intl = useIntlLocale();
  const t = useT();
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-100">
      <table className="w-full min-w-[520px] text-[11px]">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-400">
            <th className="px-2 py-1.5 font-medium">{t("google.searchRsa.col.field")}</th>
            <th className="px-2 py-1.5 font-medium">{t("google.searchRsa.col.content")}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t("google.searchRsa.col.impressions")}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t("google.searchRsa.col.clicks")}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t("google.searchRsa.col.ctr")}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t("google.searchRsa.col.conversions")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={cn("border-b border-slate-50 last:border-0", weakKeys.has(lineKey(l)) && "bg-amber-50/50")}>
              <td className="px-2 py-1 text-slate-500">{t(FIELD_LABEL[l.field])}</td>
              <td className="px-2 py-1 text-slate-700">
                {l.text}
                {l.pinned && <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-bold text-slate-500"><Pin className="h-2.5 w-2.5" aria-hidden="true" />{t("google.searchRsa.pinned", { pos: l.pinned })}</span>}
              </td>
              <td className="px-2 py-1 text-right text-slate-500">{num(l.impressions, undefined, intl)}</td>
              <td className="px-2 py-1 text-right text-slate-500">{num(l.clicks, undefined, intl)}</td>
              <td className="px-2 py-1 text-right text-slate-500">{l.ctr === null ? "—" : pct(l.ctr, 2, intl)}</td>
              <td className="px-2 py-1 text-right text-slate-500">{num(l.conversions, { maximumFractionDigits: 1 }, intl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Một bản thay (radio 3 phương án + tự viết) ──

function ReplacementItemCard({
  item, choice, onChoice, custom, onCustom, canEdit,
}: {
  item: DraftItem; choice: string; onChoice: (v: string) => void; custom: string; onCustom: (v: string) => void; canEdit: boolean;
}) {
  const t = useT();
  const limit = TEXT_LIMIT[item.field];
  const customLen = [...custom].length;
  const customOver = customLen > limit;
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-xs">
      <p className="text-slate-500">{t("google.searchRsa.current", { field: t(FIELD_LABEL[item.field]) })}<span className="text-slate-700 line-through">{item.oldText}</span></p>
      {item.options.length === 0 && <p className="text-amber-700">{t("google.searchRsa.noOptions")}</p>}
      <div className="space-y-1.5">
        {item.options.map((o, i) => {
          const len = [...o.text].length;
          return (
            <label key={i} className={cn("flex items-start gap-2 rounded-lg border p-2 cursor-pointer", choice === o.text ? "border-indigo-300 bg-indigo-50/50" : "border-slate-100 bg-white", !canEdit && "cursor-default opacity-70")}>
              <input type="radio" className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-indigo-600" checked={choice === o.text} onChange={() => onChoice(o.text)} disabled={!canEdit} />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block text-slate-800">{o.text}</span>
                <span className={cn("text-[10px]", len > limit ? "font-semibold text-red-600" : "text-slate-400")}>{t("google.searchRsa.charCount", { len, limit })}</span>
                {o.findings.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {o.findings.map((f, fi) => (
                      <span key={fi} className={cn("inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px]", f.severity === "block" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700")}>
                        <AlertTriangle className="h-2.5 w-2.5 shrink-0" aria-hidden="true" /> {f.rule}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </label>
          );
        })}
        <label className={cn("flex items-start gap-2 rounded-lg border p-2 cursor-pointer", choice === "custom" ? "border-indigo-300 bg-indigo-50/50" : "border-slate-100 bg-white", !canEdit && "cursor-default opacity-70")}>
          <input type="radio" className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-indigo-600" checked={choice === "custom"} onChange={() => onChoice("custom")} disabled={!canEdit} />
          <span className="min-w-0 flex-1 space-y-1">
            <span className="block font-medium text-slate-600">{t("google.searchRsa.custom")}</span>
            <Input value={custom} onChange={(e) => { onCustom(e.target.value); if (choice !== "custom") onChoice("custom"); }} disabled={!canEdit} className="h-8" placeholder={t("google.searchRsa.maxChars", { limit })} />
            <span className={cn("text-[10px]", customOver ? "font-semibold text-red-600" : "text-slate-400")}>{t("google.searchRsa.charCount", { len: customLen, limit })}</span>
          </span>
        </label>
      </div>
      {item.rejected.length > 0 && (
        <details className="text-[11px] text-slate-400">
          <summary className="cursor-pointer select-none">{t("google.searchRsa.rejected", { n: item.rejected.length })}</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{item.rejected.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

// ── Một quảng cáo ──

function AdCard({
  ad, company, range, canEdit, confirmText, onApplied,
}: {
  ad: RsaAd; company: Company; range: Range; canEdit: boolean; confirmText: string; onApplied: () => void;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const confirmId = useId();
  const strength = STRENGTH_META[ad.adStrength] ?? STRENGTH_FALLBACK;
  const approvalMeta = APPROVAL_META[ad.approval];
  const approval: { label: MessageKey | null; raw: string; cls: string } = approvalMeta
    ? { ...approvalMeta, raw: "" }
    : { label: ad.approval ? null : "google.searchRsa.unknown", raw: ad.approval, cls: "bg-slate-100 text-slate-500 border-slate-200" };
  const weakKeys = useMemo(() => new Set(ad.weak.map(lineKey)), [ad.weak]);

  const [linesOpen, setLinesOpen] = useState(false);
  const [checkedWeak, setCheckedWeak] = useState<Record<string, boolean>>({});

  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [draftItems, setDraftItems] = useState<DraftItem[] | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});

  const [validating, setValidating] = useState(false);
  const [validateEdit, setValidateEdit] = useState<RsaEdit | null>(null);
  const [validateErr, setValidateErr] = useState<string | null>(null);
  const [validatedSig, setValidatedSig] = useState<string | null>(null);

  const [applyOpen, setApplyOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyErr, setApplyErr] = useState<string | null>(null);
  const [writeEdit, setWriteEdit] = useState<RsaEdit | null>(null);

  const toggleWeak = (key: string) => setCheckedWeak((p) => ({ ...p, [key]: !p[key] }));

  const changes = useMemo(() => {
    if (!draftItems) return [] as { field: Field; oldText: string; newText: string }[];
    return draftItems.flatMap((it) => {
      const c = choice[it.oldText];
      const text = (c === "custom" ? custom[it.oldText] ?? "" : c ?? "").trim();
      const limit = TEXT_LIMIT[it.field];
      if (!text || [...text].length > limit || text === it.oldText) return [];
      return [{ field: it.field, oldText: it.oldText, newText: text.replace(/\s+/g, " ") }];
    });
  }, [draftItems, choice, custom]);
  const sig = changes.map((c) => `${c.field}|${c.oldText}=${c.newText}`).sort().join("|");
  const canApply = changes.length > 0 && sig === validatedSig;

  async function doDraft() {
    const lines = ad.weak.filter((w) => checkedWeak[lineKey(w)]).map((w) => ({ field: w.field, text: w.text }));
    if (!lines.length) return;
    setDrafting(true); setDraftErr(null);
    try {
      const json = await postJson("/api/google/search/rsa", { company, op: "draft", ad: ad.ad, lines, from: range.from, to: range.to });
      const items = json.items as DraftItem[];
      setDraftItems(items);
      const nextChoice: Record<string, string> = {};
      for (const it of items) nextChoice[it.oldText] = it.options[0]?.text ?? "custom";
      setChoice(nextChoice); setCustom({});
      setValidatedSig(null); setValidateEdit(null); setWriteEdit(null);
    } catch (e) {
      setDraftErr(e instanceof ApiError ? e.message : t("google.searchRsa.draftFailed"));
    } finally { setDrafting(false); }
  }

  async function doValidate() {
    if (!changes.length) return;
    setValidating(true); setValidateErr(null); setValidateEdit(null); setWriteEdit(null);
    try {
      const json = await postJson("/api/google/search/rsa", { company, op: "edit", ad: ad.ad, changes, validateOnly: true });
      const edit = json.edit as RsaEdit;
      setValidateEdit(edit);
      setValidatedSig(edit.status === "done" ? sig : null);
    } catch (e) {
      setValidateErr(e instanceof ApiError ? e.message : t("google.searchRsa.validateFailed"));
      setValidatedSig(null);
    } finally { setValidating(false); }
  }

  async function doApply() {
    setApplying(true); setApplyErr(null);
    try {
      const json = await postJson("/api/google/search/rsa", { company, op: "edit", ad: ad.ad, changes, validateOnly: false, confirmText: confirmInput });
      const edit = json.edit as RsaEdit;
      setWriteEdit(edit);
      if (edit.status === "done") {
        setApplyOpen(false); setConfirmInput(""); setValidatedSig(null); setValidateEdit(null);
        setDraftItems(null); setCheckedWeak({});
        onApplied();
      } else {
        setApplyErr(t("google.searchRsa.applyRejected"));
      }
    } catch (e) {
      setApplyErr(e instanceof ApiError ? e.message : t("google.searchRsa.applyFailed"));
    } finally { setApplying(false); }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-800" title={ad.campaignName}>{ad.campaignName}</p>
          <p className="truncate text-[11px] text-slate-400" title={ad.adGroup}>{ad.adGroup}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Badge cls={strength.cls}>{t(strength.label)}</Badge>
          <Badge cls={approval.cls}>{approval.label ? t(approval.label) : approval.raw}</Badge>
        </div>
      </div>
      <p className="text-[11px] text-slate-500">{t("google.searchRsa.costInRange")}<b className="text-slate-700">{vnd(ad.cost, intl)}</b>{t("google.searchRsa.impressionsSuffix", { n: num(ad.impressions, undefined, intl) })}</p>

      {ad.weak.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-slate-600">{t("google.searchRsa.weakLines", { n: ad.weak.length })}</p>
          <div className="space-y-1">
            {ad.weak.map((w) => (
              <label key={lineKey(w)} className={cn("flex items-start gap-2 rounded-lg border p-2 text-[11px]", checkedWeak[lineKey(w)] ? "border-indigo-200 bg-indigo-50/40" : "border-slate-100 bg-slate-50/40", !canEdit && "opacity-70")}>
                <Checkbox checked={!!checkedWeak[lineKey(w)]} onCheckedChange={() => toggleWeak(lineKey(w))} disabled={!canEdit} className="mt-0.5" />
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block font-medium text-slate-800">{t(FIELD_LABEL[w.field])}: {w.text}</span>
                  <span className="block text-slate-500">{w.why}</span>
                </span>
              </label>
            ))}
          </div>
          {canEdit && (
            <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={doDraft} disabled={drafting || !Object.values(checkedWeak).some(Boolean)}>
              {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.searchRsa.draftBtn")}
            </Button>
          )}
          {draftErr && <p className="text-xs text-red-600">{draftErr}</p>}
        </div>
      )}

      {draftItems && draftItems.length > 0 && (
        <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/30 p-3">
          <p className="text-xs font-semibold text-indigo-900">{t("google.searchRsa.draftCount", { n: draftItems.length })}</p>
          <div className="space-y-2">
            {draftItems.map((it) => (
              <ReplacementItemCard key={it.oldText} item={it}
                choice={choice[it.oldText] ?? "custom"} onChoice={(v) => setChoice((p) => ({ ...p, [it.oldText]: v }))}
                custom={custom[it.oldText] ?? ""} onCustom={(v) => setCustom((p) => ({ ...p, [it.oldText]: v }))}
                canEdit={canEdit} />
            ))}
          </div>
          {canEdit && (
            <div className="space-y-2 border-t border-indigo-100 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={doValidate} disabled={!changes.length || validating}>
                  {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null} {t("google.searchRsa.validateBtn")}
                </Button>
                <Button type="button" size="sm" className="h-9" onClick={() => { setConfirmInput(""); setApplyErr(null); setApplyOpen(true); }}
                  disabled={!canApply} title={!canApply ? t("google.searchRsa.applyHint") : undefined}>
                  {t("google.searchRsa.apply")}{changes.length > 0 ? ` (${changes.length})` : ""}
                </Button>
              </div>
              {validateErr && <p className="text-xs text-red-600">{validateErr}</p>}
              {validateEdit && <EditResultCard edit={validateEdit} phase="validate" />}
              {writeEdit && <EditResultCard edit={writeEdit} phase="write" />}
            </div>
          )}
        </div>
      )}

      <div>
        <button type="button" onClick={() => setLinesOpen((o) => !o)} className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700">
          {linesOpen ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
          {t("google.searchRsa.linesInAd", { n: ad.lines.length })}
        </button>
        {linesOpen && <div className="mt-2"><LinesTable lines={ad.lines} weakKeys={weakKeys} /></div>}
      </div>

      <Dialog open={applyOpen} onOpenChange={(o) => { setApplyOpen(o); if (!o) setConfirmInput(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("google.searchRsa.applyTitle", { n: changes.length, company })}</DialogTitle>
            <DialogDescription>{t("google.searchRsa.applyDesc")}</DialogDescription>
          </DialogHeader>
          <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs">
            {changes.map((c, i) => <li key={i} className="text-slate-700">&ldquo;{c.oldText}&rdquo; → &ldquo;{c.newText}&rdquo;</li>)}
          </ul>
          <div className="space-y-1.5">
            <label htmlFor={confirmId} className="text-xs font-medium text-slate-500">
              {t("google.searchRsa.typePrefix")}<code className="rounded bg-slate-100 px-1 py-0.5">{confirmText}</code>{t("google.searchRsa.typeSuffix")}
            </label>
            <Input id={confirmId} value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} placeholder={confirmText} autoComplete="off" className="h-10" />
          </div>
          {applyErr && <p className="text-xs text-red-600">{applyErr}</p>}
          {writeEdit && writeEdit.status !== "done" && <EditResultCard edit={writeEdit} phase="write" />}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.searchRsa.cancel")}</DialogClose>
            <Button className="h-10" onClick={doApply} disabled={applying || confirmInput.trim() !== confirmText}>
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.searchRsa.writeLive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Lịch sử sửa RSA ──

function RsaHistoryRow({ h, onUndo }: { h: RsaEdit; onUndo: (id: string) => void }) {
  const intl = useIntlLocale();
  const t = useT();
  const ok = h.status === "done";
  return (
    <div className={cn("rounded-lg border p-3 text-xs", ok ? "border-emerald-100 bg-emerald-50/30" : "border-red-100 bg-red-50/30")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn("flex items-center gap-1 font-semibold", ok ? "text-emerald-700" : "text-red-700")}>
          {ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />} {t("google.searchRsa.written")}
        </span>
        <span className="text-slate-400">{datetimeVN(h.at, intl)}</span>
        <span className="text-slate-500">{h.by}</span>
        <span className="text-slate-400">· {h.label}</span>
      </div>
      {h.changes.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-slate-600">{h.changes.map((c, i) => <li key={i}>&ldquo;{c.oldText}&rdquo; → &ldquo;{c.newText}&rdquo;</li>)}</ul>}
      {h.errors.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-red-700">{h.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {h.undoneAt ? (
        <p className="mt-2 rounded-md border border-slate-200 bg-white p-2 font-semibold text-slate-600">{t("google.searchRsa.undoneAt", { time: datetimeVN(h.undoneAt, intl) })}</p>
      ) : ok ? (
        <div className="mt-2 flex justify-end">
          <Button variant="destructive" size="sm" className="h-8" onClick={() => onUndo(h.id)}><Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> {t("google.searchRsa.undo")}</Button>
        </div>
      ) : null}
    </div>
  );
}

function RsaHistorySection({ history, company, onChanged }: { history: RsaEdit[]; company: Company; onChanged: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoErr, setUndoErr] = useState<string | null>(null);

  async function runUndo(id: string) {
    setUndoing(true); setUndoErr(null);
    try {
      await postJson("/api/google/search/rsa", { company, op: "undo", id });
      setUndoId(null); onChanged();
    } catch (e) {
      setUndoErr(e instanceof ApiError ? e.message : t("google.searchRsa.undoFailed"));
    } finally { setUndoing(false); }
  }

  if (history.length === 0) return null;

  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-800">
        {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.searchRsa.history", { n: history.length })}
      </button>
      {undoErr && <p className="mt-1 text-xs text-red-600">{undoErr}</p>}
      {open && <div className="mt-2 space-y-2">{history.map((h) => <RsaHistoryRow key={h.id} h={h} onUndo={setUndoId} />)}</div>}
      <Dialog open={!!undoId} onOpenChange={(o) => { if (!o) { setUndoId(null); setUndoErr(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">{t("google.searchRsa.undoTitle")}</DialogTitle>
            <DialogDescription>{t("google.searchRsa.undoDesc")}</DialogDescription>
          </DialogHeader>
          {undoErr && <p className="text-xs text-red-600">{undoErr}</p>}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.searchRsa.keep")}</DialogClose>
            <Button className="h-10" variant="destructive" onClick={() => undoId && runUndo(undoId)} disabled={undoing}>
              {undoing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.searchRsa.undo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Root ──

export function SearchRsaTab({ company, range }: { company: Company; range: Range }) {
  const t = useT();
  const [data, setData] = useState<RsaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force?: boolean) => {
    if (force) setReloading(true); else setLoading(true);
    setError(null);
    try {
      const json = await getJson(`/api/google/search/rsa?company=${company}&from=${range.from}&to=${range.to}`);
      setData(json as RsaResponse);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("google.searchRsa.connError"));
    } finally { setLoading(false); setReloading(false); }
  }, [company, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">{t("google.searchRsa.intro")}</p>
        <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={refresh} disabled={loading || reloading}>
          {reloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.searchRsa.reload")}
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> <span>{error}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-slate-100" />)}</div>
      ) : !data ? null : (
        <>
          {!data.canEdit && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">{t("google.searchRsa.readOnly")}</p>
          )}
          {data.errors.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{t("google.searchRsa.partialData", { errors: data.errors.join(" · ") })}</div>
          )}

          {data.ads.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">{t("google.searchRsa.noAds")}</p>
          ) : (
            <div className="space-y-3">
              {data.ads.map((a) => (
                <AdCard key={a.ad} ad={a} company={company} range={range} canEdit={data.canEdit} confirmText={data.confirmText} onApplied={refresh} />
              ))}
            </div>
          )}

          <RsaHistorySection history={data.history} company={company} onChanged={refresh} />
        </>
      )}
    </section>
  );
}
