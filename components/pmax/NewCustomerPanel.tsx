"use client";

// ============================================================
// PMax "🧪 Thí nghiệm" — C2: mục tiêu khách mới (campaign lifecycle goal).
// Đổi chế độ = Kiểm trước (validateOnly, không ghi) → gõ confirmText (đọc từ
// server) → Ghi thật → server tự đọc lại. Chỉ cho đổi giữa 2 chế độ an toàn
// (tool chặn "Chỉ nhắm khách mới" ở server vì bỏ hẳn khách gia hạn).
// ------------------------------------------------------------
// Đọc/ghi qua lib/pmax/signals.ts — module SERVER, ở đây CHỈ `import type`.
// Dữ liệu chính (newCustomer + history) do PmaxExperimentView tải chung
// (GET /signals) và truyền xuống; panel này tự POST khi đổi chế độ/hoàn tác.
// ============================================================

import { useId, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, Undo2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import { postJson, ApiError } from "@/components/case/api";
import { num, pct, datetimeVN } from "@/components/case/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import type { NewCustomerView, NewCustomerRow, NewCustomerChange } from "@/lib/pmax/signals";

type Company = string;

/** Tool chỉ cho chọn 2 chế độ an toàn — "Chỉ nhắm khách mới" bị server chặn (bỏ hẳn khách gia hạn). */
const EDITABLE_MODES = ["TARGET_ALL_EQUALLY", "BID_HIGHER_FOR_NEW_CUSTOMER"] as const;

function CampaignRow({ row, company, modeLabels, canEdit, confirmText, onChanged }: {
  row: NewCustomerRow; company: Company; modeLabels: Record<string, string>; canEdit: boolean; confirmText: string; onChanged: () => void;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const confirmId = useId();
  const [mode, setMode] = useState<string>(row.mode);
  const [validating, setValidating] = useState(false);
  const [validateErr, setValidateErr] = useState<string | null>(null);
  const [validateChange, setValidateChange] = useState<NewCustomerChange | null>(null);
  const [validatedMode, setValidatedMode] = useState<string | null>(null);

  const [applyOpen, setApplyOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyErr, setApplyErr] = useState<string | null>(null);

  const dirty = mode !== row.mode;
  const canApply = dirty && validatedMode === mode;

  async function doValidate() {
    if (!dirty) return;
    setValidating(true); setValidateErr(null); setValidateChange(null);
    try {
      const json = await postJson("/api/google/pmax/signals/new-customer", { company, campaignId: row.id, mode, validateOnly: true });
      const change = json.change as NewCustomerChange;
      setValidateChange(change);
      setValidatedMode(change.status === "done" ? mode : null);
    } catch (e) {
      setValidateErr(e instanceof ApiError ? e.message : t("google.pmaxNewCustomer.validateErr"));
      setValidatedMode(null);
    } finally { setValidating(false); }
  }

  async function doApply() {
    setApplying(true); setApplyErr(null);
    try {
      const json = await postJson("/api/google/pmax/signals/new-customer", { company, campaignId: row.id, mode, validateOnly: false, confirmText: confirmInput });
      const change = json.change as NewCustomerChange;
      if (change.status === "done") {
        setApplyOpen(false); setConfirmInput(""); setValidatedMode(null); setValidateChange(null);
        onChanged();
      } else {
        setApplyErr(change.error ?? t("google.pmaxNewCustomer.rejected"));
      }
    } catch (e) {
      setApplyErr(e instanceof ApiError ? e.message : t("google.pmaxNewCustomer.changeErr"));
    } finally { setApplying(false); }
  }

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3.5">
      <p className="truncate text-sm font-bold text-slate-800" title={row.name}>{row.name}</p>
      <p className="text-[11px] text-slate-500">{t("google.pmaxNewCustomer.current")}: <strong className="text-slate-700">{modeLabels[row.mode] ?? row.mode}</strong></p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
        <span>{t("google.pmaxNewCustomer.newCust")}: <strong className="text-slate-800">{num(row.newConv, { maximumFractionDigits: 1 }, intl)}</strong></span>
        <span>{t("google.pmaxNewCustomer.returning")}: <strong className="text-slate-800">{num(row.returningConv, { maximumFractionDigits: 1 }, intl)}</strong></span>
        <span>{t("google.pmaxNewCustomer.unknown")}: <strong className="text-slate-800">{num(row.unknownConv, { maximumFractionDigits: 1 }, intl)}</strong></span>
      </div>
      {row.newShare != null && (
        <div>
          <div className="h-1.5 rounded-full bg-slate-100">
            <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${Math.round(row.newShare * 100)}%` }} />
          </div>
          <p className="mt-0.5 text-[10px] text-slate-400">{t("google.pmaxNewCustomer.newShare", { pct: pct(row.newShare, 0, intl) })}</p>
        </div>
      )}
      {row.suggest && <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">{row.suggest}</p>}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
          <select
            value={mode}
            onChange={(e) => { setMode(e.target.value); setValidatedMode(null); setValidateChange(null); }}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
          >
            {EDITABLE_MODES.map((m) => <option key={m} value={m}>{modeLabels[m] ?? m}</option>)}
          </select>
          <Button type="button" variant="outline" size="sm" className="h-8 bg-white" onClick={doValidate} disabled={!dirty || validating}>
            {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null} {t("google.pmaxNewCustomer.validate")}
          </Button>
          <Button type="button" size="sm" className="h-8" onClick={() => { setConfirmInput(""); setApplyErr(null); setApplyOpen(true); }} disabled={!canApply}>
            {t("google.pmaxNewCustomer.changeMode")}
          </Button>
        </div>
      )}
      {validateErr && <p className="text-xs text-red-600">{validateErr}</p>}
      {validateChange && (
        <div className={cn("rounded-lg border p-2 text-xs", validateChange.status === "done" ? "border-sky-200 bg-sky-50 text-sky-800" : "border-red-200 bg-red-50 text-red-700")}>
          {validateChange.status === "done" ? (
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {t("google.pmaxNewCustomer.accepted")}</span>
          ) : (validateChange.error ?? t("google.pmaxNewCustomer.rejectedShort"))}
        </div>
      )}

      <Dialog open={applyOpen} onOpenChange={(o) => { setApplyOpen(o); if (!o) setConfirmInput(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("google.pmaxNewCustomer.dialogTitle")}</DialogTitle>
          </DialogHeader>
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {row.name}: {modeLabels[row.mode] ?? row.mode} → {modeLabels[mode] ?? mode}. {t("google.pmaxNewCustomer.relearn")}
          </p>
          <div className="space-y-1.5">
            <label htmlFor={confirmId} className="text-xs font-medium text-slate-500">
              {t("google.pmaxNewCustomer.typePre")} <code className="rounded bg-slate-100 px-1 py-0.5">{confirmText}</code> {t("google.pmaxNewCustomer.typePost")}
            </label>
            <Input id={confirmId} value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} placeholder={confirmText} autoComplete="off" className="h-10" />
          </div>
          {applyErr && <p className="text-xs text-red-600">{applyErr}</p>}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.pmaxNewCustomer.cancel")}</DialogClose>
            <Button className="h-10" onClick={doApply} disabled={applying || confirmInput.trim() !== confirmText}>
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.pmaxNewCustomer.writeReal")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HistoryRow({ ch, modeLabels, onUndo, undoing }: { ch: NewCustomerChange; modeLabels: Record<string, string>; onUndo: () => void; undoing: boolean }) {
  const intl = useIntlLocale();
  const t = useT();
  const ok = ch.status === "done";
  return (
    <div className={cn("rounded-lg border p-2.5 text-xs", ok ? "border-emerald-100 bg-emerald-50/30" : "border-red-100 bg-red-50/30")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn("flex items-center gap-1 font-semibold", ok ? "text-emerald-700" : "text-red-700")}>
          {ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {ch.campaignName}: {modeLabels[ch.from] ?? ch.from} → {modeLabels[ch.to] ?? ch.to}
        </span>
        <span className="text-slate-400">{datetimeVN(ch.at, intl)}</span>
        <span className="text-slate-500">{ch.by}</span>
      </div>
      {ch.error && <p className="mt-1 text-red-700">{ch.error}</p>}
      {ok && (
        ch.undoneAt ? (
          <p className="mt-1.5 text-slate-500">{t("google.pmaxNewCustomer.undoneAt", { time: datetimeVN(ch.undoneAt, intl) })}</p>
        ) : (
          <div className="mt-1.5 flex justify-end">
            <Button variant="destructive" size="sm" className="h-7" onClick={onUndo} disabled={undoing}>
              {undoing ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Undo2 className="h-3 w-3" aria-hidden="true" />} {t("google.pmaxNewCustomer.undo")}
            </Button>
          </div>
        )
      )}
    </div>
  );
}

export function NewCustomerPanel({ company, data, modeLabels, history, canEdit, confirmText, onChanged }: {
  company: Company; data: NewCustomerView; modeLabels: Record<string, string>; history: NewCustomerChange[]; canEdit: boolean; confirmText: string; onChanged: () => void;
}) {
  const t = useT();
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [undoErr, setUndoErr] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  async function undo(id: string) {
    setUndoingId(id); setUndoErr(null);
    try {
      await postJson("/api/google/pmax/signals/new-customer", { company, undoId: id });
      onChanged();
    } catch (e) {
      setUndoErr(e instanceof ApiError ? e.message : t("google.pmaxNewCustomer.undoErr"));
    } finally { setUndoingId(null); }
  }

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-extrabold text-slate-900">{t("google.pmaxNewCustomer.title")}</h3>
        <p className="mt-1 text-xs text-slate-500">{data.note}</p>
      </div>

      {!canEdit && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">{t("google.pmaxNewCustomer.needEdit")}</p>
      )}

      {data.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">{t("google.pmaxNewCustomer.empty")}</p>
      ) : (
        <div className="space-y-2">
          {data.rows.map((row) => (
            <CampaignRow key={row.id} row={row} company={company} modeLabels={modeLabels} canEdit={canEdit} confirmText={confirmText} onChanged={onChanged} />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div>
          <button type="button" onClick={() => setHistoryOpen((o) => !o)} className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-800">
            {historyOpen ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.pmaxNewCustomer.history")} ({history.length})
          </button>
          {undoErr && <p className="mt-1 text-xs text-red-600">{undoErr}</p>}
          {historyOpen && (
            <div className="mt-2 space-y-2">
              {history.map((ch) => (
                <HistoryRow key={ch.id} ch={ch} modeLabels={modeLabels} onUndo={() => undo(ch.id)} undoing={undoingId === ch.id} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
