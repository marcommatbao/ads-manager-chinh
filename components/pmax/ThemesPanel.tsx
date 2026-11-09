"use client";

// ============================================================
// PMax "🎨 Asset" — E1: Search theme theo lượt tìm thắng.
// ------------------------------------------------------------
// Dữ liệu (groups/maxThemes/history) do PmaxAssetsView tải MỘT LẦN qua
// GET /api/google/pmax/themes (route chung với NewAssetGroupPanel) và truyền
// xuống — panel này chỉ tự POST khi Kiểm trước/Áp dụng/Hoàn tác rồi gọi
// onChanged() để cha tải lại. Đọc/ghi qua lib/pmax/themes.ts — module SERVER
// (kéo google-ads SDK) nên ở đây CHỈ `import type`.
// Luồng ghi giống PmaxActionsPanel: Kiểm trước (validateOnly, không ghi) →
// gõ confirmText (đọc từ server) → Ghi thật → server tự đọc lại.
// ============================================================

import { useId, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2, Tags, Undo2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { postJson, ApiError } from "@/components/case/api";
import { datetimeVN } from "@/components/case/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import type { ThemeExecution, ThemeGroup } from "@/lib/pmax/themes";

type Company = string;

const SOURCE_LABEL: Record<string, MessageKey> = { pmax: "google.pmaxThemes.srcPmax", search: "google.pmaxThemes.srcSearch", playbook: "google.pmaxThemes.srcPlaybook" };
const SOURCE_CLS: Record<string, string> = {
  pmax: "bg-blue-50 text-blue-700 border-blue-200", search: "bg-emerald-50 text-emerald-700 border-emerald-200", playbook: "bg-violet-50 text-violet-700 border-violet-200",
};

// ── Kết quả Kiểm trước / Ghi ──

function ThemeResultCard({ exec }: { exec: ThemeExecution }) {
  const t = useT();
  const ok = exec.status === "done";
  return (
    <div className={cn("rounded-lg border p-2.5 text-xs", ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50")}>
      <div className={cn("flex items-center gap-1.5 font-semibold", ok ? "text-emerald-700" : "text-red-700")}>
        {ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        {ok ? t("google.pmaxThemes.resAccepted") : t("google.pmaxThemes.resRejected")}
      </div>
      {exec.added.length > 0 && <p className="mt-1 text-slate-600">{t("google.pmaxThemes.added")}: {exec.added.map((th) => `“${th.text}”`).join(", ")}</p>}
      {exec.removed.length > 0 && <p className="mt-1 text-slate-600">{t("google.pmaxThemes.removed")}: {exec.removed.map((th) => `“${th.text}”`).join(", ")}</p>}
      {exec.errors.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-red-700">{exec.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
      )}
    </div>
  );
}

// ── Một asset group ──

function ThemeGroupCard({
  group, maxThemes, company, canEdit, confirmText, onChanged,
}: {
  group: ThemeGroup; maxThemes: number; company: Company; canEdit: boolean; confirmText: string; onChanged: () => void;
}) {
  const t = useT();
  const confirmId = useId();
  const [open, setOpen] = useState(false);
  const [removeChecked, setRemoveChecked] = useState<Record<string, boolean>>({});
  const [addChecked, setAddChecked] = useState<Record<string, boolean>>({});

  const [validating, setValidating] = useState(false);
  const [validateExec, setValidateExec] = useState<ThemeExecution | null>(null);
  const [validateErr, setValidateErr] = useState<string | null>(null);
  const [validatedSig, setValidatedSig] = useState<string | null>(null);

  const [applyOpen, setApplyOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyErr, setApplyErr] = useState<string | null>(null);
  const [writeExec, setWriteExec] = useState<ThemeExecution | null>(null);

  const remove = useMemo(() => group.themes.filter((th) => removeChecked[th.resourceName]).map((th) => th.resourceName), [group.themes, removeChecked]);
  const add = useMemo(() => group.suggestions.filter((s) => addChecked[s.text]).map((s) => s.text), [group.suggestions, addChecked]);
  const sig = `${remove.slice().sort().join(",")}|${add.slice().sort().join(",")}`;

  const resultCount = group.themes.length - remove.length + add.length;
  const overLimit = resultCount > maxThemes;
  const canValidate = (remove.length > 0 || add.length > 0) && !overLimit;
  const canApply = canValidate && sig === validatedSig;

  async function doValidate() {
    if (!canValidate) return;
    setValidating(true); setValidateErr(null); setValidateExec(null); setWriteExec(null);
    try {
      const json = await postJson("/api/google/pmax/themes", { company, op: "apply", assetGroupId: group.assetGroupId, add, remove, validateOnly: true });
      const exec = json.execution as ThemeExecution;
      setValidateExec(exec);
      setValidatedSig(exec.status === "done" ? sig : null);
    } catch (e) {
      setValidateErr(e instanceof ApiError ? e.message : t("google.pmaxThemes.validateErr"));
      setValidatedSig(null);
    } finally { setValidating(false); }
  }

  async function doApply() {
    setApplying(true); setApplyErr(null);
    try {
      const json = await postJson("/api/google/pmax/themes", { company, op: "apply", assetGroupId: group.assetGroupId, add, remove, validateOnly: false, confirmText: confirmInput });
      const exec = json.execution as ThemeExecution;
      setWriteExec(exec);
      if (exec.status === "done") {
        setApplyOpen(false); setConfirmInput(""); setValidatedSig(null); setValidateExec(null);
        setRemoveChecked({}); setAddChecked({});
        onChanged();
      } else {
        setApplyErr(exec.errors.join(" · ") || t("google.pmaxThemes.rejectedNothing"));
      }
    } catch (e) {
      setApplyErr(e instanceof ApiError ? e.message : t("google.pmaxThemes.writeErr"));
    } finally { setApplying(false); }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-800" title={group.name}>{group.name}</p>
          <p className="truncate text-[11px] text-slate-400" title={group.campaignName}>{group.campaignName}</p>
        </div>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold", group.themes.length >= maxThemes ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-100 text-slate-600")}>
          {t("google.pmaxThemes.themeCount", { n: group.themes.length, max: maxThemes })}
        </span>
      </div>

      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700">
        {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
        {t("google.pmaxThemes.viewThemes", { n: group.themes.length, m: group.suggestions.length })}
      </button>

      {open && (
        <div className="space-y-3">
          {group.themes.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-slate-600">{t("google.pmaxThemes.existing")}</p>
              {group.themes.map((th) => (
                <label key={th.resourceName} className={cn("flex items-start gap-2 rounded-lg border p-2 text-[11px]", removeChecked[th.resourceName] ? "border-red-200 bg-red-50/50" : th.offTopic ? "border-amber-100 bg-amber-50/40" : "border-slate-100 bg-slate-50/40", !canEdit && "opacity-70")}>
                  <Checkbox checked={!!removeChecked[th.resourceName]} onCheckedChange={() => setRemoveChecked((p) => ({ ...p, [th.resourceName]: !p[th.resourceName] }))} disabled={!canEdit} className="mt-0.5" />
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block text-slate-800">{th.text}</span>
                    {th.offTopic && (
                      <span className="flex items-center gap-1 text-amber-700">
                        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" /> {t("google.pmaxThemes.offTopic")}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          {group.suggestions.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-slate-600">{t("google.pmaxThemes.suggested")}</p>
              {group.suggestions.map((s) => (
                <label key={s.text} className={cn("flex items-start gap-2 rounded-lg border p-2 text-[11px]", addChecked[s.text] ? "border-indigo-200 bg-indigo-50/40" : "border-slate-100 bg-slate-50/40", !canEdit && "opacity-70")}>
                  <Checkbox checked={!!addChecked[s.text]} onCheckedChange={() => setAddChecked((p) => ({ ...p, [s.text]: !p[s.text] }))} disabled={!canEdit} className="mt-0.5" />
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-slate-800">{s.text}</span>
                      <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-semibold", SOURCE_CLS[s.source] ?? "bg-slate-100 text-slate-500 border-slate-200")}>{SOURCE_LABEL[s.source] ? t(SOURCE_LABEL[s.source]) : s.source}</span>
                    </span>
                    <span className="block text-slate-500">{s.why}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {(remove.length > 0 || add.length > 0) && (
        <div className={cn("rounded-lg border px-3 py-2 text-[11px]", overLimit ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-600")}>
          {t("google.pmaxThemes.afterChange", { a: group.themes.length, b: remove.length, c: add.length })} <strong>{resultCount}</strong>/{maxThemes} {t("google.pmaxThemes.themeWord")}
          {overLimit && t("google.pmaxThemes.overLimit")}
        </div>
      )}

      {canEdit && (remove.length > 0 || add.length > 0) && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={doValidate} disabled={!canValidate || validating}>
              {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null} {t("google.pmaxThemes.validateBtn")}
            </Button>
            <Button type="button" size="sm" className="h-9" onClick={() => { setConfirmInput(""); setApplyErr(null); setApplyOpen(true); }} disabled={!canApply} title={!canApply ? t("google.pmaxThemes.validateFirst") : undefined}>
              {t("google.pmaxThemes.apply")}
            </Button>
          </div>
          {validateErr && <p className="text-xs text-red-600">{validateErr}</p>}
          {validateExec && <ThemeResultCard exec={validateExec} />}
          {writeExec && <ThemeResultCard exec={writeExec} />}
        </div>
      )}

      <Dialog open={applyOpen} onOpenChange={(o) => { setApplyOpen(o); if (!o) setConfirmInput(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("google.pmaxThemes.dialogTitle", { company })}</DialogTitle>
            <DialogDescription>{t("google.pmaxThemes.dialogDesc", { name: group.name, r: remove.length, a: add.length })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor={confirmId} className="text-xs font-medium text-slate-500">
              {t("google.pmaxThemes.typePre")} <code className="rounded bg-slate-100 px-1 py-0.5">{confirmText}</code> {t("google.pmaxThemes.typePost")}
            </label>
            <Input id={confirmId} value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} placeholder={confirmText} autoComplete="off" className="h-10" />
          </div>
          {applyErr && <p className="text-xs text-red-600">{applyErr}</p>}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.pmaxThemes.cancel")}</DialogClose>
            <Button className="h-10" onClick={doApply} disabled={applying || confirmInput.trim() !== confirmText}>
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.pmaxThemes.writeReal")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Lịch sử đổi theme ──

function ThemeHistoryRow({ h, onUndo, undoing }: { h: ThemeExecution; onUndo: (id: string) => void; undoing: boolean }) {
  const intl = useIntlLocale();
  const t = useT();
  const ok = h.status === "done";
  return (
    <div className={cn("rounded-lg border p-3 text-xs", ok ? "border-emerald-100 bg-emerald-50/30" : "border-red-100 bg-red-50/30")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn("flex items-center gap-1 font-semibold", ok ? "text-emerald-700" : "text-red-700")}>
          {ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {h.assetGroupName}
        </span>
        <span className="text-slate-400">{datetimeVN(h.at, intl)}</span>
        <span className="text-slate-500">{h.by}</span>
      </div>
      {h.added.length > 0 && <p className="mt-1 text-slate-600">{t("google.pmaxThemes.added")}: {h.added.map((th) => `“${th.text}”`).join(", ")}</p>}
      {h.removed.length > 0 && <p className="mt-1 text-slate-600">{t("google.pmaxThemes.removed")}: {h.removed.map((th) => `“${th.text}”`).join(", ")}</p>}
      {h.errors.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-red-700">{h.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {ok && (
        h.undoneAt ? (
          <p className="mt-1.5 text-slate-500">{t("google.pmaxThemes.undoneAt", { time: datetimeVN(h.undoneAt, intl) })}</p>
        ) : (
          <div className="mt-2 flex justify-end">
            <Button variant="destructive" size="sm" className="h-8" onClick={() => onUndo(h.id)} disabled={undoing}>
              {undoing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.pmaxThemes.undo")}
            </Button>
          </div>
        )
      )}
    </div>
  );
}

// ── Root ──

export function ThemesPanel({ company, groups, maxThemes, history, canEdit, confirmText, onChanged }: {
  company: Company; groups: ThemeGroup[]; maxThemes: number; history: ThemeExecution[]; canEdit: boolean; confirmText: string; onChanged: () => void;
}) {
  const t = useT();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [undoErr, setUndoErr] = useState<string | null>(null);

  async function undo(id: string) {
    setUndoingId(id); setUndoErr(null);
    try {
      await postJson("/api/google/pmax/themes", { company, op: "undo", id });
      onChanged();
    } catch (e) {
      setUndoErr(e instanceof ApiError ? e.message : t("google.pmaxThemes.undoErr"));
    } finally { setUndoingId(null); }
  }

  return (
    <section className="space-y-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-base font-extrabold text-slate-900">
          <Tags className="h-4 w-4" aria-hidden="true" /> {t("google.pmaxThemes.title")}
        </h3>
        <p className="mt-1 text-xs text-slate-500">{t("google.pmaxThemes.note")}</p>
      </div>

      {!canEdit && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">{t("google.pmaxThemes.needEdit")}</p>
      )}

      {groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">{t("google.pmaxThemes.empty")}</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <ThemeGroupCard key={g.assetGroupId} group={g} maxThemes={maxThemes} company={company} canEdit={canEdit} confirmText={confirmText} onChanged={onChanged} />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div>
          <button type="button" onClick={() => setHistoryOpen((o) => !o)} className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-800">
            {historyOpen ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.pmaxThemes.history")} ({history.length})
          </button>
          {undoErr && <p className="mt-1 text-xs text-red-600">{undoErr}</p>}
          {historyOpen && (
            <div className="mt-2 space-y-2">
              {history.map((h) => <ThemeHistoryRow key={h.id} h={h} onUndo={undo} undoing={undoingId === h.id} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
