"use client";

// ============================================================
// PMax "✅ Việc nên làm" (Đợt 10b) — nội dung mới trong tab X-quang, đặt NGAY
// SAU banner cảnh báo (PmaxXrayView.tsx). Đây là phần nổi bật nhất của tab:
// không chỉ chẩn đoán mà nói rõ NÊN LÀM GÌ, cho áp dụng tại chỗ, và bật được
// tự động cho việc ít rủi ro.
// ------------------------------------------------------------
// Đọc/ghi qua lib/pmax/controls.ts + lib/pmax/recommend.ts — cả hai đều là
// module SERVER (kéo google-ads SDK) nên ở đây CHỈ `import type`, không bao
// giờ import giá trị/hàm từ chúng.
// Luồng ghi giống hệt Step6Execute (case Search/Meta): Kiểm trước (validate_
// only, không ghi) → gõ "XAC NHAN" (đọc từ server qua confirmText, không hard-
// code) → Áp dụng (ghi thật) → server tự đọc lại → có thể Hoàn tác. Server
// TÍNH LẠI đề xuất từ số liệu tươi mỗi lần — client chỉ gửi mã việc đã chọn.
// ============================================================

import { useCallback, useEffect, useId, useState } from "react";
import {
  AlertTriangle, Bot, CheckCircle2, ChevronDown, ChevronUp, Loader2,
  RefreshCw, Sparkles, Undo2, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { getJson, postJson, putJson, ApiError } from "@/components/case/api";
import { vnd, datetimeVN } from "@/components/case/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProposalList } from "@/components/case/ProposalList";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import type { ControlProposal, ControlExecution } from "@/lib/pmax/controls";
import type { Recommendation, AutoKind } from "@/lib/pmax/recommend";

type Company = string;
type Range = { from: string; to: string };

interface ControlsResponse {
  range: Range;
  recommendations: Recommendation[];
  proposals: ControlProposal[];
  history: ControlExecution[];
  auto: { kinds: AutoKind[]; labels: Record<AutoKind, string>; maxPerDay: number };
  canEdit: boolean;
  confirmText: string;
}

function Badge({ cls, symbol, children }: { cls: string; symbol: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", cls)}>
      {symbol} {children}
    </span>
  );
}

const PRIORITY_META: Record<1 | 2 | 3, { label: MessageKey; symbol: string; cls: string }> = {
  1: { label: "google.pmaxActions.p1", symbol: "P1", cls: "bg-red-50 text-red-700 border-red-200" },
  2: { label: "google.pmaxActions.p2", symbol: "P2", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  3: { label: "google.pmaxActions.p3", symbol: "P3", cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

// ── Kết quả một lần Kiểm trước / Ghi ──

function ExecResultCard({ exec }: { exec: ControlExecution }) {
  const t = useT();
  const ok = exec.status === "done";
  const validate = exec.mode === "validate";
  const title = validate
    ? ok ? t("google.pmaxActions.valOk") : t("google.pmaxActions.valFail")
    : ok ? t("google.pmaxActions.writeOk") : t("google.pmaxActions.writeFail");
  return (
    <div className={cn("rounded-lg border p-2.5 text-xs", !ok ? "border-red-200 bg-red-50" : validate ? "border-sky-200 bg-sky-50" : "border-emerald-200 bg-emerald-50")}>
      <div className={cn("flex items-center gap-1.5 font-semibold", !ok ? "text-red-700" : validate ? "text-sky-800" : "text-emerald-700")}>
        {ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        {title}
      </div>
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
                <th className="px-2 py-1 font-medium">{t("google.pmaxActions.readback")}</th>
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

// ── Kiểm trước → Áp dụng, dùng chung cho từng thẻ và cho thanh chọn tất cả ──

function ApplyControls({
  company, range, items, confirmText, onDone,
}: {
  company: Company;
  range: Range;
  items: ControlProposal[];
  confirmText: string;
  onDone: () => void;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const confirmId = useId();
  const ids = items.map((p) => p.id);
  const sig = ids.slice().sort().join("|");

  const [validating, setValidating] = useState(false);
  const [validateExec, setValidateExec] = useState<ControlExecution | null>(null);
  const [validateErr, setValidateErr] = useState<string | null>(null);
  const [validatedSig, setValidatedSig] = useState<string | null>(null);

  const [applyOpen, setApplyOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyErr, setApplyErr] = useState<string | null>(null);
  const [writeExec, setWriteExec] = useState<ControlExecution | null>(null);

  const canApply = sig !== "" && sig === validatedSig;

  async function doValidate() {
    if (!ids.length) return;
    setValidating(true); setValidateErr(null); setValidateExec(null); setWriteExec(null);
    try {
      const json = await postJson("/api/google/pmax/controls", { company, from: range.from, to: range.to, ids, validateOnly: true });
      setValidateExec(json.execution as ControlExecution);
      setValidatedSig(json.execution?.status === "done" ? sig : null);
    } catch (e) {
      setValidateErr(e instanceof ApiError ? e.message : t("google.pmaxActions.validateErr"));
      setValidatedSig(null);
    } finally {
      setValidating(false);
    }
  }

  async function doApply() {
    setApplying(true); setApplyErr(null);
    try {
      const json = await postJson("/api/google/pmax/controls", { company, from: range.from, to: range.to, ids, validateOnly: false, confirmText: confirmInput });
      const exec = json.execution as ControlExecution;
      setWriteExec(exec);
      if (exec.status === "done") {
        setApplyOpen(false); setConfirmInput(""); setValidatedSig(null); setValidateExec(null);
        onDone();
      } else {
        setApplyErr(t("google.pmaxActions.rejectedDialog"));
      }
    } catch (e) {
      setApplyErr(e instanceof ApiError ? e.message : t("google.pmaxActions.writeErr"));
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={doValidate} disabled={!ids.length || validating}>
          {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null} {t("google.pmaxActions.validateBtn")}
        </Button>
        <Button
          type="button" size="sm" className="h-9"
          onClick={() => { setConfirmInput(""); setApplyErr(null); setApplyOpen(true); }}
          disabled={!canApply}
          title={!canApply ? t("google.pmaxActions.validateFirst") : undefined}
        >
          {t("google.pmaxActions.apply")}{ids.length > 0 ? ` (${ids.length})` : ""}
        </Button>
        {!ids.length && <span className="text-[11px] text-slate-400">{t("google.pmaxActions.noneSelected")}</span>}
      </div>
      {validateErr && <p className="text-xs text-red-600">{validateErr}</p>}
      {validateExec && <ExecResultCard exec={validateExec} />}
      {writeExec && <ExecResultCard exec={writeExec} />}

      <Dialog open={applyOpen} onOpenChange={(o) => { setApplyOpen(o); if (!o) setConfirmInput(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("google.pmaxActions.dialogTitle", { n: items.length, company })}</DialogTitle>
            <DialogDescription>{t("google.pmaxActions.canUndo")}</DialogDescription>
          </DialogHeader>
          <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs">
            {items.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-2">
                <span className="text-slate-700">
                  {p.label}
                  {p.campaignName && <span className="text-slate-400"> · {p.campaignName}</span>}
                </span>
                {p.cost !== null && <span className="shrink-0 tabular-nums text-slate-500">{vnd(p.cost, intl)}</span>}
              </li>
            ))}
          </ul>
          <div className="space-y-1.5">
            <label htmlFor={confirmId} className="text-xs font-medium text-slate-500">
              {t("google.pmaxActions.typePre")} <code className="rounded bg-slate-100 px-1 py-0.5">{confirmText}</code> {t("google.pmaxActions.typePost")}
            </label>
            <Input id={confirmId} value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} placeholder={confirmText} autoComplete="off" className="h-10" />
          </div>
          {applyErr && <p className="text-xs text-red-600">{applyErr}</p>}
          {writeExec && writeExec.status !== "done" && <ExecResultCard exec={writeExec} />}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.pmaxActions.cancel")}</DialogClose>
            <Button className="h-10" onClick={doApply} disabled={applying || confirmInput.trim() !== confirmText}>
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.pmaxActions.writeReal")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Bật/tắt tự động cho một loại việc ──

function AutoToggle({
  kind, enabled, label, maxPerDay, canEdit, onToggle,
}: {
  kind: AutoKind; enabled: boolean; label: string; maxPerDay: number; canEdit: boolean;
  onToggle: (kind: AutoKind, enable: boolean) => void;
}) {
  const t = useT();
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-2.5">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-indigo-900">{t("google.pmaxActions.autoDaily")}</p>
        <p className="mt-0.5 text-[11px] text-indigo-700/80">{t("google.pmaxActions.autoDesc", { label, max: maxPerDay })}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={t("google.pmaxActions.autoDaily")}
        onClick={() => canEdit && onToggle(kind, !enabled)}
        disabled={!canEdit}
        title={enabled ? t("google.pmaxActions.autoOn") : t("google.pmaxActions.autoOff")}
        className={cn("relative h-[22px] w-10 shrink-0 rounded-full transition-colors", enabled ? "bg-indigo-500" : "bg-slate-300", !canEdit && "opacity-50")}
      >
        <span className={cn("absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform", enabled ? "left-[22px]" : "left-[3px]")} />
      </button>
    </div>
  );
}

// ── Một thẻ đề xuất ──

function RecommendationCard({
  rec, proposals, checked, onToggle, company, range, confirmText, canEdit,
  autoKinds, autoLabels, autoMaxPerDay, onAutoToggle, onApplied,
}: {
  rec: Recommendation;
  proposals: ControlProposal[];
  checked: Record<string, boolean>;
  onToggle: (id: string) => void;
  company: Company;
  range: Range;
  confirmText: string;
  canEdit: boolean;
  autoKinds: AutoKind[];
  autoLabels: Record<AutoKind, string>;
  autoMaxPerDay: number;
  onAutoToggle: (kind: AutoKind, enable: boolean) => void;
  onApplied: () => void;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const [open, setOpen] = useState(rec.priority === 1);
  const meta = PRIORITY_META[rec.priority];
  const checkedCount = proposals.filter((p) => checked[p.id]).length;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge cls={meta.cls} symbol={meta.symbol}>{t(meta.label)}</Badge>
          <h4 className="text-sm font-bold text-slate-800">{rec.title}</h4>
        </div>
        <p className="text-xs text-slate-500">{rec.why}</p>
        {rec.moneyAtStake !== null && (
          <p className="text-xs font-semibold text-red-600">{t("google.pmaxActions.atStake")}: {vnd(rec.moneyAtStake, intl)}</p>
        )}
      </div>

      {rec.manualSteps && rec.manualSteps.length > 0 && (
        <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
          <p className="text-xs font-semibold text-amber-800">{t("google.pmaxActions.manual")}</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs text-amber-800">
            {rec.manualSteps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>
      )}

      {proposals.length > 0 && (
        <div className="space-y-2">
          <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
            {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
            {t("google.pmaxActions.specific", { n: proposals.length })}{checkedCount > 0 ? t("google.pmaxActions.selectedN", { n: checkedCount }) : ""}
          </button>
          {open && <ProposalList proposals={proposals} checked={checked} onToggle={onToggle} canEdit={canEdit} />}
          {canEdit && (
            <ApplyControls
              company={company} range={range} confirmText={confirmText}
              items={proposals.filter((p) => checked[p.id])}
              onDone={onApplied}
            />
          )}
        </div>
      )}

      {rec.autoKind && (
        <AutoToggle
          kind={rec.autoKind}
          enabled={autoKinds.includes(rec.autoKind)}
          label={autoLabels[rec.autoKind]}
          maxPerDay={autoMaxPerDay}
          canEdit={canEdit}
          onToggle={onAutoToggle}
        />
      )}
    </div>
  );
}

// ── Thanh "chọn tất cả → kiểm trước → áp dụng" ──

function GlobalApplyBar({
  proposals, checked, onSelectAllDefault, company, range, confirmText, onApplied,
}: {
  proposals: ControlProposal[];
  checked: Record<string, boolean>;
  onSelectAllDefault: () => void;
  company: Company;
  range: Range;
  confirmText: string;
  onApplied: () => void;
}) {
  const t = useT();
  const selected = proposals.filter((p) => checked[p.id]);
  return (
    <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={onSelectAllDefault}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {t("google.pmaxActions.selectAll")}
        </Button>
        <span className="text-xs font-semibold text-indigo-400">→</span>
        <span className="text-xs text-indigo-700">{t("google.pmaxActions.selectedOf", { a: selected.length, b: proposals.length })}</span>
      </div>
      <ApplyControls company={company} range={range} confirmText={confirmText} items={selected} onDone={onApplied} />
    </div>
  );
}

// ── Lịch sử áp dụng ──

function HistoryRow({ h, onUndo }: { h: ControlExecution; onUndo: (id: string) => void }) {
  const intl = useIntlLocale();
  const t = useT();
  const ok = h.status === "done";
  const isAuto = h.by === "Tự động (PMax)";
  return (
    <div className={cn("rounded-lg border p-3 text-xs", ok ? "border-emerald-100 bg-emerald-50/30" : "border-red-100 bg-red-50/30")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn("flex items-center gap-1 font-semibold", ok ? "text-emerald-700" : "text-red-700")}>
          {ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {h.mode === "validate" ? t("google.pmaxActions.hValidate") : t("google.pmaxActions.hWritten")}
        </span>
        <span className="text-slate-400">{datetimeVN(h.at, intl)}</span>
        <span className="flex items-center gap-1 text-slate-500">
          {isAuto ? <><Bot className="h-3 w-3 shrink-0" aria-hidden="true" /> {t("google.pmaxActions.autoPmax")}</> : h.by}
        </span>
      </div>
      {h.applied.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-slate-600">
          {h.applied.map((a) => <li key={a.proposalId}>{a.label}</li>)}
        </ul>
      )}
      {h.errors.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-red-700">
          {h.errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      {h.mode === "write" && (
        h.undoneAt ? (
          <div className="mt-2 rounded-md border border-slate-200 bg-white p-2 text-slate-600">
            <p className="font-semibold">{t("google.pmaxActions.undoneAt", { time: datetimeVN(h.undoneAt, intl) })}</p>
            {h.undoReport && h.undoReport.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-4">{h.undoReport.map((l, i) => <li key={i}>{l}</li>)}</ul>
            )}
          </div>
        ) : ok ? (
          <div className="mt-2 flex justify-end">
            <Button variant="destructive" size="sm" className="h-8" onClick={() => onUndo(h.id)}>
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> {t("google.pmaxActions.undo")}
            </Button>
          </div>
        ) : null
      )}
    </div>
  );
}

function HistorySection({ history, company, onChanged }: { history: ControlExecution[]; company: Company; onChanged: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoErr, setUndoErr] = useState<string | null>(null);

  async function runUndo(id: string) {
    setUndoing(true); setUndoErr(null);
    try {
      await postJson("/api/google/pmax/controls/undo", { company, id });
      setUndoId(null);
      onChanged();
    } catch (e) {
      setUndoErr(e instanceof ApiError ? e.message : t("google.pmaxActions.undoErr"));
    } finally {
      setUndoing(false);
    }
  }

  if (history.length === 0) return null;

  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-800">
        {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
        {t("google.pmaxActions.history")} ({history.length})
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {history.map((h) => <HistoryRow key={h.id} h={h} onUndo={setUndoId} />)}
        </div>
      )}

      <Dialog open={!!undoId} onOpenChange={(o) => { if (!o) { setUndoId(null); setUndoErr(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">{t("google.pmaxActions.undoTitle")}</DialogTitle>
            <DialogDescription>{t("google.pmaxActions.undoDesc")}</DialogDescription>
          </DialogHeader>
          {undoErr && <p className="text-xs text-red-600">{undoErr}</p>}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.pmaxActions.keep")}</DialogClose>
            <Button className="h-10" variant="destructive" onClick={() => undoId && runUndo(undoId)} disabled={undoing}>
              {undoing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.pmaxActions.undo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Root ──

export function PmaxActionsPanel({ company, range }: { company: Company; range: Range }) {
  const t = useT();
  const [data, setData] = useState<ControlsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [autoErr, setAutoErr] = useState<string | null>(null);

  const load = useCallback(async (force?: boolean) => {
    if (force) setReloading(true); else setLoading(true);
    setError(null);
    try {
      const json = await getJson(`/api/google/pmax/controls?company=${company}&from=${range.from}&to=${range.to}${force ? "&force=1" : ""}`);
      setData(json as ControlsResponse);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("google.pmaxActions.connErr"));
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }, [company, range.from, range.to, t]);

  useEffect(() => { load(); }, [load]);

  // Giữ lựa chọn tay của người dùng qua các lần tải lại; việc mới xuất hiện thì lấy mặc định.
  useEffect(() => {
    if (!data) return;
    setChecked((prev) => {
      const next: Record<string, boolean> = {};
      for (const p of data.proposals) next[p.id] = p.id in prev ? prev[p.id] : p.defaultChecked;
      return next;
    });
  }, [data]);

  const toggle = useCallback((id: string) => setChecked((prev) => ({ ...prev, [id]: !prev[id] })), []);

  function selectAllDefault() {
    if (!data) return;
    const next: Record<string, boolean> = {};
    for (const p of data.proposals) next[p.id] = p.defaultChecked;
    setChecked(next);
  }

  async function handleAutoToggle(kind: AutoKind, enable: boolean) {
    if (!data) return;
    const before = data.auto.kinds;
    const next = enable ? [...new Set([...before, kind])] : before.filter((k) => k !== kind);
    setData((prev) => (prev ? { ...prev, auto: { ...prev.auto, kinds: next } } : prev));
    setAutoErr(null);
    try {
      const json = await putJson("/api/google/pmax/controls/auto", { company, kinds: next });
      setData((prev) => (prev ? { ...prev, auto: { ...prev.auto, kinds: json.kinds as AutoKind[] } } : prev));
    } catch (e) {
      setData((prev) => (prev ? { ...prev, auto: { ...prev.auto, kinds: before } } : prev));
      setAutoErr(e instanceof ApiError ? e.message : t("google.pmaxActions.autoSaveErr"));
    }
  }

  const refresh = useCallback(() => load(), [load]);

  return (
    <section className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-base font-extrabold text-slate-900">{t("google.pmaxActions.title")}</h3>
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => load(true)} disabled={loading || reloading}>
            {reloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.pmaxActions.reload")}
          </Button>
        </div>
        <p className="mt-1 text-[11px] italic text-slate-400">
          {t("google.pmaxActions.askAi", { company })}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}
        </div>
      ) : !data ? null : (
        <>
          {!data.canEdit && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              {t("google.pmaxActions.needEdit")}
            </p>
          )}

          {data.recommendations.length === 0 ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              {t("google.pmaxActions.none")}
            </p>
          ) : (
            <>
              {data.canEdit && data.proposals.length > 0 && (
                <GlobalApplyBar
                  proposals={data.proposals} checked={checked} onSelectAllDefault={selectAllDefault}
                  company={company} range={range} confirmText={data.confirmText} onApplied={refresh}
                />
              )}
              {autoErr && <p className="text-xs text-red-600">{autoErr}</p>}

              <div className="space-y-3">
                {data.recommendations.map((rec) => (
                  <RecommendationCard
                    key={rec.id}
                    rec={rec}
                    proposals={rec.proposalIds.map((id) => data.proposals.find((p) => p.id === id)).filter((p): p is ControlProposal => !!p)}
                    checked={checked}
                    onToggle={toggle}
                    company={company}
                    range={range}
                    confirmText={data.confirmText}
                    canEdit={data.canEdit}
                    autoKinds={data.auto.kinds}
                    autoLabels={data.auto.labels}
                    autoMaxPerDay={data.auto.maxPerDay}
                    onAutoToggle={handleAutoToggle}
                    onApplied={refresh}
                  />
                ))}
              </div>
            </>
          )}

          <HistorySection history={data.history} company={company} onChanged={refresh} />
        </>
      )}
    </section>
  );
}
