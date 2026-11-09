"use client";

// ============================================================
// PMax "🎨 Asset" — A5: sức khoẻ asset PMax + E2: thay asset chữ yếu.
// ------------------------------------------------------------
// Google đã bỏ nhãn chất lượng asset (performance_label) → server tự chấm từ
// số liệu THẬT theo asset (impressions/clicks/cost/conversions) + tổ hợp
// thắng + ad strength (xem lib/pmax/assets.ts). Đơn theo asset gồm cả đơn
// sau lượt xem (Google không cho tách) nên "yếu" được chấm theo tỉ lệ bấm.
// ------------------------------------------------------------
// Đọc/ghi qua lib/pmax/assets.ts — module SERVER (kéo google-ads SDK) nên ở
// đây CHỈ `import type`. Luồng ghi giống PmaxActionsPanel/ExperimentPanel:
// Kiểm trước (validateOnly, không ghi) → gõ confirmText (đọc từ server) →
// Ghi thật → server tự đọc lại → có thể Hoàn tác.
// ============================================================

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2, RefreshCw, Sparkles, Star, Undo2, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { getJson, postJson, ApiError } from "@/components/case/api";
import { vnd, num, pct, datetimeVN } from "@/components/case/format";
import { DateRangeControl, type DateRangeValue } from "@/components/DateRangeControl";
import { DEFAULT_VIEW_DAYS, MAX_RANGE_DAYS, lastDays } from "@/lib/case/dates";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import type { AssetRow, GroupHealth, Replacement, SwapExecution, TextType } from "@/lib/pmax/assets";

type Company = string;
type Range = { from: string; to: string };

interface AssetsResponse {
  range: Range;
  groups: GroupHealth[];
  errors: string[];
  history: SwapExecution[];
  fieldLabels: Record<string, string>;
  textLimits: Record<TextType, number>;
  canEdit: boolean;
  confirmText: string;
}

const STRENGTH_META: Record<string, { label: MessageKey; cls: string }> = {
  EXCELLENT: { label: "google.pmaxAssetHealth.strength.excellent", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  GOOD: { label: "google.pmaxAssetHealth.strength.good", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  AVERAGE: { label: "google.pmaxAssetHealth.strength.average", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  POOR: { label: "google.pmaxAssetHealth.strength.poor", cls: "bg-red-50 text-red-700 border-red-200" },
};
const STRENGTH_FALLBACK = { label: "google.pmaxAssetHealth.strength.unknown" as MessageKey, cls: "bg-slate-100 text-slate-500 border-slate-200" };

const FIELD_ORDER = [
  "HEADLINE", "LONG_HEADLINE", "DESCRIPTION", "BUSINESS_NAME",
  "LOGO", "LANDSCAPE_LOGO", "MARKETING_IMAGE", "SQUARE_MARKETING_IMAGE",
  "PORTRAIT_MARKETING_IMAGE", "TALL_PORTRAIT_MARKETING_IMAGE", "YOUTUBE_VIDEO",
];
const fieldRank = (f: string) => { const i = FIELD_ORDER.indexOf(f); return i === -1 ? FIELD_ORDER.length : i; };

function Badge({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", cls)}>{children}</span>;
}

// ── Kết quả Kiểm trước / Ghi một lần thay asset ──

function SwapResultCard({ exec }: { exec: SwapExecution }) {
  const t = useT();
  const ok = exec.status === "done";
  const validate = exec.mode === "validate";
  const title = validate
    ? ok ? t("google.pmaxAssetHealth.resValidateOk") : t("google.pmaxAssetHealth.resValidateFail")
    : ok ? t("google.pmaxAssetHealth.resWriteOk") : t("google.pmaxAssetHealth.resWriteFail");
  return (
    <div className={cn("rounded-lg border p-2.5 text-xs", !ok ? "border-red-200 bg-red-50" : validate ? "border-sky-200 bg-sky-50" : "border-emerald-200 bg-emerald-50")}>
      <div className={cn("flex items-center gap-1.5 font-semibold", !ok ? "text-red-700" : validate ? "text-sky-800" : "text-emerald-700")}>
        {ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        {title}
      </div>
      {exec.items.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-slate-600">
          {exec.items.map((it, i) => <li key={i}>&ldquo;{it.oldText}&rdquo; → &ldquo;{it.newText}&rdquo;</li>)}
        </ul>
      )}
      {exec.errors.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-red-700">
          {exec.errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      {exec.readback.length > 0 && (
        <div className="mt-2 overflow-x-auto rounded-md border border-white/70 bg-white/70">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-500">
                <th className="px-2 py-1 font-medium">{t("google.pmaxAssetHealth.readback")}</th>
                <th className="px-2 py-1 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {exec.readback.map((r, i) => (
                <tr key={i} className="border-b border-slate-50 last:border-0">
                  <td className="px-2 py-1 text-slate-700">{r.label}</td>
                  <td className="px-2 py-1">
                    {r.ok ? <CheckCircle2 className="h-3 w-3 text-emerald-600" aria-hidden="true" /> : <XCircle className="h-3 w-3 text-red-600" aria-hidden="true" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Một bản thay (radio 3 phương án + tự viết) ──

function ReplacementItemCard({
  item, limit, choice, onChoice, custom, onCustom, canEdit,
}: {
  item: Replacement; limit: number; choice: string; onChoice: (v: string) => void; custom: string; onCustom: (v: string) => void; canEdit: boolean;
}) {
  const t = useT();
  const customLen = [...custom].length;
  const customOver = customLen > limit;
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-xs">
      <p className="text-slate-500">{t("google.pmaxAssetHealth.current")} <span className="text-slate-700 line-through">{item.oldText}</span></p>
      {item.options.length === 0 && (
        <p className="text-amber-700">{t("google.pmaxAssetHealth.noOptions")}</p>
      )}
      <div className="space-y-1.5">
        {item.options.map((o, i) => {
          const len = [...o.text].length;
          return (
            <label key={i} className={cn("flex items-start gap-2 rounded-lg border p-2 cursor-pointer", choice === o.text ? "border-indigo-300 bg-indigo-50/50" : "border-slate-100 bg-white", !canEdit && "cursor-default opacity-70")}>
              <input type="radio" className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-indigo-600" checked={choice === o.text} onChange={() => onChoice(o.text)} disabled={!canEdit} />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block text-slate-800">{o.text}</span>
                <span className={cn("text-[10px]", len > limit ? "font-semibold text-red-600" : "text-slate-400")}>{t("google.pmaxAssetHealth.chars", { len, limit })}</span>
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
            <span className="block font-medium text-slate-600">{t("google.pmaxAssetHealth.custom")}</span>
            <Input
              value={custom}
              onChange={(e) => { onCustom(e.target.value); if (choice !== "custom") onChoice("custom"); }}
              disabled={!canEdit}
              className="h-8"
              placeholder={t("google.pmaxAssetHealth.maxChars", { limit })}
            />
            <span className={cn("text-[10px]", customOver ? "font-semibold text-red-600" : "text-slate-400")}>{t("google.pmaxAssetHealth.chars", { len: customLen, limit })}</span>
          </span>
        </label>
      </div>
      {item.rejected.length > 0 && (
        <details className="text-[11px] text-slate-400">
          <summary className="cursor-pointer select-none">{t("google.pmaxAssetHealth.rejected", { n: item.rejected.length })}</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{item.rejected.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

// ── Một dòng trong bảng asset chỉ đọc ──

function AssetTableRow({ a }: { a: AssetRow }) {
  const intl = useIntlLocale();
  return (
    <tr className="border-b border-slate-50 last:border-0">
      <td className="max-w-[220px] truncate px-2 py-1 text-slate-700" title={a.label}>
        {a.inTop && <Star className="mr-1 inline h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" />}
        {a.label}
      </td>
      <td className="px-2 py-1 text-right text-slate-500">{num(a.impressions, undefined, intl)}</td>
      <td className="px-2 py-1 text-right text-slate-500">{num(a.clicks, undefined, intl)}</td>
      <td className="px-2 py-1 text-right text-slate-500">{a.ctr === null ? "—" : pct(a.ctr, 2, intl)}</td>
      <td className="px-2 py-1 text-right text-slate-500">{vnd(a.cost, intl)}</td>
      <td className="px-2 py-1 text-right text-slate-500">{num(a.conversions, { maximumFractionDigits: 1 }, intl)}</td>
    </tr>
  );
}

// ── Một asset group ──

function AssetGroupCard({
  group, fieldLabels, textLimits, range, company, canEdit, confirmText, onApplied,
}: {
  group: GroupHealth; fieldLabels: Record<string, string>; textLimits: Record<TextType, number>;
  range: Range; company: Company; canEdit: boolean; confirmText: string; onApplied: () => void;
}) {
  const t = useT();
  const confirmId = useId();
  const strength = STRENGTH_META[group.adStrength] ?? STRENGTH_FALLBACK;

  const [tableOpen, setTableOpen] = useState(false);
  const [checkedWeak, setCheckedWeak] = useState<Record<string, boolean>>({});

  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [draftItems, setDraftItems] = useState<Replacement[] | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});

  const [validating, setValidating] = useState(false);
  const [validateExec, setValidateExec] = useState<SwapExecution | null>(null);
  const [validateErr, setValidateErr] = useState<string | null>(null);
  const [validatedSig, setValidatedSig] = useState<string | null>(null);

  const [applyOpen, setApplyOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyErr, setApplyErr] = useState<string | null>(null);
  const [writeExec, setWriteExec] = useState<SwapExecution | null>(null);

  const toggleWeak = (link: string) => setCheckedWeak((p) => ({ ...p, [link]: !p[link] }));

  const swaps = useMemo(() => {
    if (!draftItems) return [] as { link: string; newText: string }[];
    return draftItems.flatMap((it) => {
      const c = choice[it.link];
      const text = (c === "custom" ? custom[it.link] ?? "" : c ?? "").trim();
      const limit = textLimits[it.field] ?? 90;
      if (!text || [...text].length > limit) return [];
      return [{ link: it.link, newText: text }];
    });
  }, [draftItems, choice, custom, textLimits]);
  const sig = swaps.map((s) => `${s.link}=${s.newText}`).sort().join("|");
  const canApply = swaps.length > 0 && sig === validatedSig;

  const fields = useMemo(() => {
    const s = new Set(group.assets.map((a) => a.field));
    return [...s].sort((a, b) => fieldRank(a) - fieldRank(b));
  }, [group.assets]);

  async function doDraft() {
    const links = group.weak.filter((w) => checkedWeak[w.link]).map((w) => w.link);
    if (!links.length) return;
    setDrafting(true); setDraftErr(null);
    try {
      const json = await postJson("/api/google/pmax/assets", { company, op: "draft", groupId: group.id, links, from: range.from, to: range.to });
      const items = json.items as Replacement[];
      setDraftItems(items);
      const nextChoice: Record<string, string> = {};
      for (const it of items) nextChoice[it.link] = it.options[0]?.text ?? "custom";
      setChoice(nextChoice);
      setCustom({});
      setValidatedSig(null); setValidateExec(null); setWriteExec(null);
    } catch (e) {
      setDraftErr(e instanceof ApiError ? e.message : t("google.pmaxAssetHealth.draftError"));
    } finally { setDrafting(false); }
  }

  async function doValidate() {
    if (!swaps.length) return;
    setValidating(true); setValidateErr(null); setValidateExec(null); setWriteExec(null);
    try {
      const json = await postJson("/api/google/pmax/assets", { company, op: "apply", swaps, validateOnly: true });
      const exec = json.execution as SwapExecution;
      setValidateExec(exec);
      setValidatedSig(exec.status === "done" ? sig : null);
    } catch (e) {
      setValidateErr(e instanceof ApiError ? e.message : t("google.pmaxAssetHealth.validateError"));
      setValidatedSig(null);
    } finally { setValidating(false); }
  }

  async function doApply() {
    setApplying(true); setApplyErr(null);
    try {
      const json = await postJson("/api/google/pmax/assets", { company, op: "apply", swaps, validateOnly: false, confirmText: confirmInput });
      const exec = json.execution as SwapExecution;
      setWriteExec(exec);
      if (exec.status === "done") {
        setApplyOpen(false); setConfirmInput(""); setValidatedSig(null); setValidateExec(null);
        setDraftItems(null); setCheckedWeak({});
        onApplied();
      } else {
        setApplyErr(t("google.pmaxAssetHealth.applyRejected"));
      }
    } catch (e) {
      setApplyErr(e instanceof ApiError ? e.message : t("google.pmaxAssetHealth.applyError"));
    } finally { setApplying(false); }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-800" title={group.name}>{group.name}</p>
          <p className="truncate text-[11px] text-slate-400" title={group.campaignName}>{group.campaignName}</p>
        </div>
        <Badge cls={strength.cls}>{t(strength.label)}</Badge>
      </div>

      <div className="text-[11px] text-slate-500">
        <span className="font-semibold text-slate-600">{group.status}</span>
        {group.statusReasons.length > 0 && <span> — {group.statusReasons.join(", ")}</span>}
      </div>

      {group.missing.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {group.missing.map((m) => (
            <Badge key={m.field} cls={m.required ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}>
              {t("google.pmaxAssetHealth.missing", { label: m.label, have: m.have, need: m.need })}
            </Badge>
          ))}
        </div>
      )}

      {group.disapproved.length > 0 && (
        <div className="space-y-1 rounded-lg border border-red-100 bg-red-50/50 p-2.5">
          <p className="text-[11px] font-semibold text-red-700">{t("google.pmaxAssetHealth.disapproved", { n: group.disapproved.length })}</p>
          <ul className="space-y-0.5 text-[11px] text-red-700">
            {group.disapproved.map((a) => <li key={a.link}>{fieldLabels[a.field] ?? a.field}: {a.label}</li>)}
          </ul>
        </div>
      )}

      {group.weak.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-slate-600">{t("google.pmaxAssetHealth.weakAssets", { n: group.weak.length })}</p>
          <div className="space-y-1">
            {group.weak.map((w) => (
              <label key={w.link} className={cn("flex items-start gap-2 rounded-lg border p-2 text-[11px]", checkedWeak[w.link] ? "border-indigo-200 bg-indigo-50/40" : "border-slate-100 bg-slate-50/40", !canEdit && "opacity-70")}>
                <Checkbox checked={!!checkedWeak[w.link]} onCheckedChange={() => toggleWeak(w.link)} disabled={!canEdit} className="mt-0.5" />
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block font-medium text-slate-800">{fieldLabels[w.field] ?? w.field}: {w.label}</span>
                  <span className="block text-slate-500">{w.why}</span>
                </span>
              </label>
            ))}
          </div>
          {canEdit && (
            <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={doDraft} disabled={drafting || !Object.values(checkedWeak).some(Boolean)}>
              {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.pmaxAssetHealth.draftBtn")}
            </Button>
          )}
          {draftErr && <p className="text-xs text-red-600">{draftErr}</p>}
        </div>
      )}

      {draftItems && draftItems.length > 0 && (
        <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/30 p-3">
          <p className="text-xs font-semibold text-indigo-900">{t("google.pmaxAssetHealth.draftCount", { n: draftItems.length })}</p>
          <div className="space-y-2">
            {draftItems.map((it) => (
              <ReplacementItemCard
                key={it.link}
                item={it}
                limit={textLimits[it.field] ?? 90}
                choice={choice[it.link] ?? "custom"}
                onChoice={(v) => setChoice((p) => ({ ...p, [it.link]: v }))}
                custom={custom[it.link] ?? ""}
                onCustom={(v) => setCustom((p) => ({ ...p, [it.link]: v }))}
                canEdit={canEdit}
              />
            ))}
          </div>
          {canEdit && (
            <div className="space-y-2 border-t border-indigo-100 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={doValidate} disabled={!swaps.length || validating}>
                  {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null} {t("google.pmaxAssetHealth.validate")}
                </Button>
                <Button
                  type="button" size="sm" className="h-9"
                  onClick={() => { setConfirmInput(""); setApplyErr(null); setApplyOpen(true); }}
                  disabled={!canApply}
                  title={!canApply ? t("google.pmaxAssetHealth.validateFirst") : undefined}
                >
                  {t("google.pmaxAssetHealth.apply")}{swaps.length > 0 ? ` (${swaps.length})` : ""}
                </Button>
              </div>
              {validateErr && <p className="text-xs text-red-600">{validateErr}</p>}
              {validateExec && <SwapResultCard exec={validateExec} />}
              {writeExec && <SwapResultCard exec={writeExec} />}
            </div>
          )}
        </div>
      )}

      <div>
        <button type="button" onClick={() => setTableOpen((o) => !o)} className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700">
          {tableOpen ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
          {t("google.pmaxAssetHealth.assetsInGroup", { n: group.assets.length })}
        </button>
        {tableOpen && (
          <div className="mt-2 space-y-3">
            {fields.map((f) => (
              <div key={f} className="overflow-x-auto rounded-lg border border-slate-100">
                <table className="w-full min-w-[480px] text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-500">
                      <th className="px-2 py-1.5 font-medium" colSpan={6}>{fieldLabels[f] ?? f}</th>
                    </tr>
                    <tr className="border-b border-slate-100 text-left text-slate-400">
                      <th className="px-2 py-1 font-medium">{t("google.pmaxAssetHealth.col.content")}</th>
                      <th className="px-2 py-1 font-medium text-right">{t("google.pmaxAssetHealth.col.impressions")}</th>
                      <th className="px-2 py-1 font-medium text-right">{t("google.pmaxAssetHealth.col.clicks")}</th>
                      <th className="px-2 py-1 font-medium text-right">CTR</th>
                      <th className="px-2 py-1 font-medium text-right">{t("google.pmaxAssetHealth.col.cost")}</th>
                      <th className="px-2 py-1 font-medium text-right">{t("google.pmaxAssetHealth.col.conversions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.assets.filter((a) => a.field === f).map((a) => <AssetTableRow key={a.link} a={a} />)}
                  </tbody>
                </table>
              </div>
            ))}
            <p className="text-[10px] italic text-slate-400">{t("google.pmaxAssetHealth.assetNote")}</p>
          </div>
        )}
      </div>

      <Dialog open={applyOpen} onOpenChange={(o) => { setApplyOpen(o); if (!o) setConfirmInput(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("google.pmaxAssetHealth.dlgTitle", { n: swaps.length, company })}</DialogTitle>
            <DialogDescription>{t("google.pmaxAssetHealth.dlgDesc")}</DialogDescription>
          </DialogHeader>
          <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs">
            {swaps.map((s) => <li key={s.link} className="text-slate-700">&ldquo;{s.newText}&rdquo;</li>)}
          </ul>
          <div className="space-y-1.5">
            <label htmlFor={confirmId} className="text-xs font-medium text-slate-500">
              {t("google.pmaxAssetHealth.typeA")} <code className="rounded bg-slate-100 px-1 py-0.5">{confirmText}</code> {t("google.pmaxAssetHealth.typeB")}
            </label>
            <Input id={confirmId} value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} placeholder={confirmText} autoComplete="off" className="h-10" />
          </div>
          {applyErr && <p className="text-xs text-red-600">{applyErr}</p>}
          {writeExec && writeExec.status !== "done" && <SwapResultCard exec={writeExec} />}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.pmaxAssetHealth.cancel")}</DialogClose>
            <Button className="h-10" onClick={doApply} disabled={applying || confirmInput.trim() !== confirmText}>
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.pmaxAssetHealth.writeReal")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Lịch sử thay asset ──

function SwapHistoryRow({ h, onUndo }: { h: SwapExecution; onUndo: (id: string) => void }) {
  const intl = useIntlLocale();
  const t = useT();
  const ok = h.status === "done";
  return (
    <div className={cn("rounded-lg border p-3 text-xs", ok ? "border-emerald-100 bg-emerald-50/30" : "border-red-100 bg-red-50/30")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn("flex items-center gap-1 font-semibold", ok ? "text-emerald-700" : "text-red-700")}>
          {ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {h.mode === "validate" ? t("google.pmaxAssetHealth.histValidate") : t("google.pmaxAssetHealth.histWritten")}
        </span>
        <span className="text-slate-400">{datetimeVN(h.at, intl)}</span>
        <span className="text-slate-500">{h.by}</span>
      </div>
      {h.items.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-slate-600">
          {h.items.map((it, i) => <li key={i}>&ldquo;{it.oldText}&rdquo; → &ldquo;{it.newText}&rdquo;</li>)}
        </ul>
      )}
      {h.errors.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-red-700">{h.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
      )}
      {h.mode === "write" && (
        h.undoneAt ? (
          <div className="mt-2 rounded-md border border-slate-200 bg-white p-2 text-slate-600">
            <p className="font-semibold">{t("google.pmaxAssetHealth.undoneAt", { time: datetimeVN(h.undoneAt, intl) })}</p>
            {h.undoReport && h.undoReport.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-4">{h.undoReport.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          </div>
        ) : ok ? (
          <div className="mt-2 flex justify-end">
            <Button variant="destructive" size="sm" className="h-8" onClick={() => onUndo(h.id)}>
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> {t("google.pmaxAssetHealth.undo")}
            </Button>
          </div>
        ) : null
      )}
    </div>
  );
}

function SwapHistorySection({ history, company, onChanged }: { history: SwapExecution[]; company: Company; onChanged: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoErr, setUndoErr] = useState<string | null>(null);

  async function runUndo(id: string) {
    setUndoing(true); setUndoErr(null);
    try {
      await postJson("/api/google/pmax/assets", { company, op: "undo", id });
      setUndoId(null);
      onChanged();
    } catch (e) {
      setUndoErr(e instanceof ApiError ? e.message : t("google.pmaxAssetHealth.undoError"));
    } finally { setUndoing(false); }
  }

  if (history.length === 0) return null;

  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-800">
        {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
        {t("google.pmaxAssetHealth.history", { n: history.length })}
      </button>
      {undoErr && <p className="mt-1 text-xs text-red-600">{undoErr}</p>}
      {open && (
        <div className="mt-2 space-y-2">
          {history.map((h) => <SwapHistoryRow key={h.id} h={h} onUndo={setUndoId} />)}
        </div>
      )}
      <Dialog open={!!undoId} onOpenChange={(o) => { if (!o) { setUndoId(null); setUndoErr(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">{t("google.pmaxAssetHealth.undoTitle")}</DialogTitle>
            <DialogDescription>{t("google.pmaxAssetHealth.undoDesc")}</DialogDescription>
          </DialogHeader>
          {undoErr && <p className="text-xs text-red-600">{undoErr}</p>}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.pmaxAssetHealth.keep")}</DialogClose>
            <Button className="h-10" variant="destructive" onClick={() => undoId && runUndo(undoId)} disabled={undoing}>
              {undoing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.pmaxAssetHealth.undo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Root ──

export function AssetHealthPanel({ company }: { company: Company }) {
  const t = useT();
  const [range, setRange] = useState<DateRangeValue>(() => lastDays(DEFAULT_VIEW_DAYS));
  const [data, setData] = useState<AssetsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force?: boolean) => {
    if (force) setReloading(true); else setLoading(true);
    setError(null);
    try {
      const json = await getJson(`/api/google/pmax/assets?company=${company}&from=${range.from}&to=${range.to}`);
      setData(json as AssetsResponse);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("google.pmaxAssetHealth.connError"));
    } finally {
      setLoading(false); setReloading(false);
    }
  }, [company, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-extrabold text-slate-900">{t("google.pmaxAssetHealth.title")}</h3>
          <p className="mt-1 text-xs text-slate-500">{t("google.pmaxAssetHealth.intro")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeControl value={range} onChange={setRange} maxDays={MAX_RANGE_DAYS} />
          <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={refresh} disabled={loading || reloading}>
            {reloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.pmaxAssetHealth.reload")}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> <span>{error}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-slate-100" />)}
        </div>
      ) : !data ? null : (
        <>
          {!data.canEdit && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              {t("google.pmaxAssetHealth.readOnly")}
            </p>
          )}

          {data.errors.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t("google.pmaxAssetHealth.partialData", { errors: data.errors.join(" · ") })}
            </div>
          )}

          {data.groups.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">{t("google.pmaxAssetHealth.empty")}</p>
          ) : (
            <div className="space-y-3">
              {data.groups.map((g) => (
                <AssetGroupCard
                  key={g.id}
                  group={g}
                  fieldLabels={data.fieldLabels}
                  textLimits={data.textLimits}
                  range={data.range}
                  company={company}
                  canEdit={data.canEdit}
                  confirmText={data.confirmText}
                  onApplied={refresh}
                />
              ))}
            </div>
          )}

          <SwapHistorySection history={data.history} company={company} onChanged={refresh} />
        </>
      )}
    </section>
  );
}
