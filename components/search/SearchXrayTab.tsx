"use client";

// ============================================================
// Tab "🩻 X-quang & việc nên làm" của /google-search (Đợt 11e).
// ------------------------------------------------------------
// Đọc/ghi qua lib/search/xray.ts, lib/search/controls.ts, lib/search/recommend.ts
// — cả ba đều là module SERVER (kéo google-ads SDK) nên ở đây CHỈ `import type`,
// không bao giờ import giá trị/hàm từ chúng. Luồng ghi mirror ĐÚNG
// components/pmax/PmaxActionsPanel.tsx: Kiểm trước (validateOnly, không ghi) →
// gõ confirmText (đọc từ server, không hardcode) → Áp dụng (ghi thật) → server
// tự đọc lại → có thể Hoàn tác. Server TÍNH LẠI đề xuất từ số liệu tươi mỗi
// lần — client chỉ gửi mã việc đã chọn.
// ============================================================

import { useCallback, useEffect, useId, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2, RefreshCw, Sparkles, Split, Undo2, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getJson, postJson, ApiError } from "@/components/case/api";
import { vnd, num, pct, datetimeVN } from "@/components/case/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProposalList } from "@/components/case/ProposalList";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { SearchSplitDialog } from "./SearchSplitDialog";
import type { SearchCampaign, SearchWarning, IntentCell } from "@/lib/search/xray";
import type { SearchProposal, SearchExecution } from "@/lib/search/controls";
import type { SearchRecommendation } from "@/lib/search/recommend";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

type Company = string;
type Range = { from: string; to: string };

interface XrayResponse {
  range: Range; collectedAt: string;
  campaigns: SearchCampaign[];
  account: { cost: number; purchases: number; cpa: number | null; intents: IntentCell[] };
  matchTypes: { match: string; cost: number; purchases: number }[];
  qs: { qs: string; cost: number; purchases: number; keywords: number }[];
  devices: { device: string; cost: number; purchases: number }[];
  warnings: SearchWarning[];
  notes: string[];
  errors: string[];
}
interface ControlsResponse {
  range: Range;
  recommendations: SearchRecommendation[];
  proposals: SearchProposal[];
  history: SearchExecution[];
  canEdit: boolean;
  confirmText: string;
}

const STATUS_LABEL: Record<string, MessageKey> = { ENABLED: "google.searchXray.status.enabled", PAUSED: "google.searchXray.status.paused", REMOVED: "google.searchXray.status.removed" };
const MATCH_LABEL: Record<string, MessageKey> = { EXACT: "google.searchXray.match.exact", PHRASE: "google.searchXray.match.phrase", BROAD: "google.searchXray.match.broad" };
const DEVICE_LABEL: Record<string, MessageKey> = { DESKTOP: "google.searchXray.device.desktop", MOBILE: "google.searchXray.device.mobile", TABLET: "google.searchXray.device.tablet", CONNECTED_TV: "google.searchXray.device.tv", OTHER: "google.searchXray.device.other" };

function Badge({ cls, symbol, children }: { cls: string; symbol?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", cls)}>
      {symbol} {children}
    </span>
  );
}

const PRIORITY_META: Record<1 | 2 | 3, { label: MessageKey; symbol: string; cls: string }> = {
  1: { label: "google.searchXray.priority.1", symbol: "P1", cls: "bg-red-50 text-red-700 border-red-200" },
  2: { label: "google.searchXray.priority.2", symbol: "P2", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  3: { label: "google.searchXray.priority.3", symbol: "P3", cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

// ── Cảnh báo ──

function WarningBanner({ warnings }: { warnings: SearchWarning[] }) {
  const t = useT();
  const bad = warnings.filter((w) => w.level === "bad");
  const warn = warnings.filter((w) => w.level === "warn");
  if (bad.length === 0 && warn.length === 0) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
        {t("google.searchXray.noWarnings")}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {bad.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="flex items-center gap-1.5 text-sm font-bold text-red-700">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {t("google.searchXray.warnings")}
          </p>
          <ul className="mt-2 space-y-1.5 text-xs text-red-700">
            {bad.map((w) => <li key={w.id} className="flex gap-1.5"><span className="shrink-0 font-bold">✕</span><span>{w.text}</span></li>)}
          </ul>
        </div>
      )}
      {warn.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <ul className="space-y-1.5 text-xs text-amber-700">
            {warn.map((w) => <li key={w.id} className="flex gap-1.5"><span className="shrink-0 font-bold">⚠</span><span>{w.text}</span></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Kết quả một lần Kiểm trước / Ghi ──

function ExecResultCard({ exec }: { exec: SearchExecution }) {
  const t = useT();
  const ok = exec.status === "done";
  const validate = exec.mode === "validate";
  const title = validate
    ? ok ? t("google.searchXray.result.validateOk") : t("google.searchXray.result.validateFail")
    : ok ? t("google.searchXray.result.writeOk") : t("google.searchXray.result.writeFail");
  return (
    <div className={cn("rounded-lg border p-2.5 text-xs", !ok ? "border-red-200 bg-red-50" : validate ? "border-sky-200 bg-sky-50" : "border-emerald-200 bg-emerald-50")}>
      <div className={cn("flex items-center gap-1.5 font-semibold", !ok ? "text-red-700" : validate ? "text-sky-800" : "text-emerald-700")}>
        {ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        {title}
      </div>
      {exec.errors.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-red-700">{exec.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
      )}
      {exec.readback.length > 0 && (
        <div className="mt-2 overflow-x-auto rounded-md border border-white/70 bg-white/70">
          <table className="w-full text-[11px]">
            <thead><tr className="border-b border-slate-100 text-left text-slate-500"><th className="px-2 py-1 font-medium">{t("google.searchXray.readback")}</th><th className="px-2 py-1 font-medium"></th></tr></thead>
            <tbody>
              {exec.readback.map((r, i) => (
                <tr key={i} className="border-b border-slate-50 last:border-0">
                  <td className="px-2 py-1 text-slate-700">{r.label}</td>
                  <td className="px-2 py-1">{r.ok ? <CheckCircle2 className="h-3 w-3 text-emerald-600" aria-hidden="true" /> : <XCircle className="h-3 w-3 text-red-600" aria-hidden="true" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Kiểm trước → Áp dụng, dùng chung cho từng thẻ và thanh chọn tất cả ──

function ApplyControls({
  company, range, items, confirmText, onDone,
}: {
  company: Company; range: Range; items: SearchProposal[]; confirmText: string; onDone: () => void;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const confirmId = useId();
  const ids = items.map((p) => p.id);
  const sig = ids.slice().sort().join("|");

  const [validating, setValidating] = useState(false);
  const [validateExec, setValidateExec] = useState<SearchExecution | null>(null);
  const [validateErr, setValidateErr] = useState<string | null>(null);
  const [validatedSig, setValidatedSig] = useState<string | null>(null);

  const [applyOpen, setApplyOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyErr, setApplyErr] = useState<string | null>(null);
  const [writeExec, setWriteExec] = useState<SearchExecution | null>(null);

  const canApply = sig !== "" && sig === validatedSig;

  async function doValidate() {
    if (!ids.length) return;
    setValidating(true); setValidateErr(null); setValidateExec(null); setWriteExec(null);
    try {
      const json = await postJson("/api/google/search/controls", { company, from: range.from, to: range.to, ids, validateOnly: true });
      setValidateExec(json.execution as SearchExecution);
      setValidatedSig(json.execution?.status === "done" ? sig : null);
    } catch (e) {
      setValidateErr(e instanceof ApiError ? e.message : t("google.searchXray.validateFailed"));
      setValidatedSig(null);
    } finally { setValidating(false); }
  }

  async function doApply() {
    setApplying(true); setApplyErr(null);
    try {
      const json = await postJson("/api/google/search/controls", { company, from: range.from, to: range.to, ids, validateOnly: false, confirmText: confirmInput });
      const exec = json.execution as SearchExecution;
      setWriteExec(exec);
      if (exec.status === "done") {
        setApplyOpen(false); setConfirmInput(""); setValidatedSig(null); setValidateExec(null);
        onDone();
      } else {
        setApplyErr(t("google.searchXray.applyRejected"));
      }
    } catch (e) {
      setApplyErr(e instanceof ApiError ? e.message : t("google.searchXray.applyFailed"));
    } finally { setApplying(false); }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={doValidate} disabled={!ids.length || validating}>
          {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null} {t("google.searchXray.validateBtn")}
        </Button>
        <Button type="button" size="sm" className="h-9" onClick={() => { setConfirmInput(""); setApplyErr(null); setApplyOpen(true); }}
          disabled={!canApply} title={!canApply ? t("google.searchXray.applyHint") : undefined}>
          {t("google.searchXray.apply")}{ids.length > 0 ? ` (${ids.length})` : ""}
        </Button>
        {!ids.length && <span className="text-[11px] text-slate-400">{t("google.searchXray.nothingSelected")}</span>}
      </div>
      {validateErr && <p className="text-xs text-red-600">{validateErr}</p>}
      {validateExec && <ExecResultCard exec={validateExec} />}
      {writeExec && <ExecResultCard exec={writeExec} />}

      <Dialog open={applyOpen} onOpenChange={(o) => { setApplyOpen(o); if (!o) setConfirmInput(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("google.searchXray.applyTitle", { n: items.length, company })}</DialogTitle>
            <DialogDescription>{t("google.searchXray.applyDesc")}</DialogDescription>
          </DialogHeader>
          <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs">
            {items.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-2">
                <span className="text-slate-700">{p.label}{p.campaignName && <span className="text-slate-400"> · {p.campaignName}</span>}</span>
                {p.cost !== null && <span className="shrink-0 tabular-nums text-slate-500">{vnd(p.cost, intl)}</span>}
              </li>
            ))}
          </ul>
          <div className="space-y-1.5">
            <label htmlFor={confirmId} className="text-xs font-medium text-slate-500">
              {t("google.searchXray.typePrefix")}<code className="rounded bg-slate-100 px-1 py-0.5">{confirmText}</code>{t("google.searchXray.typeSuffix")}
            </label>
            <Input id={confirmId} value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} placeholder={confirmText} autoComplete="off" className="h-10" />
          </div>
          {applyErr && <p className="text-xs text-red-600">{applyErr}</p>}
          {writeExec && writeExec.status !== "done" && <ExecResultCard exec={writeExec} />}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.searchXray.cancel")}</DialogClose>
            <Button className="h-10" onClick={doApply} disabled={applying || confirmInput.trim() !== confirmText}>
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.searchXray.writeLive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Một thẻ đề xuất ──

function RecommendationCard({
  rec, proposals, checked, onToggle, company, range, confirmText, canEdit, onApplied, onOpenSplit,
}: {
  rec: SearchRecommendation;
  proposals: SearchProposal[];
  checked: Record<string, boolean>;
  onToggle: (id: string) => void;
  company: Company; range: Range; confirmText: string; canEdit: boolean;
  onApplied: () => void;
  onOpenSplit: (campaignId: string) => void;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const [open, setOpen] = useState(rec.priority === 1);
  const meta = PRIORITY_META[rec.priority];
  const checkedCount = proposals.filter((p) => checked[p.id]).length;
  // `const` local — narrowing bên trong closure (onClick) chỉ giữ được khi
  // gán ra biến local; truy cập trực tiếp `rec.action.campaignId` trong một
  // arrow function lồng bên trong bị TS reset kiểu về hợp union gốc.
  const action = rec.action;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge cls={meta.cls} symbol={meta.symbol}>{t(meta.label)}</Badge>
          <h4 className="text-sm font-bold text-slate-800">{rec.title}</h4>
        </div>
        <p className="text-xs text-slate-500">{rec.why}</p>
        {rec.moneyAtStake !== null && <p className="text-xs font-semibold text-red-600">{t("google.searchXray.moneyAtStake", { amount: vnd(rec.moneyAtStake, intl) })}</p>}
      </div>

      {action.type === "manual" && (
        <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
          <p className="text-xs font-semibold text-amber-800">{t("google.searchXray.howTo")}</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs text-amber-800">
            {action.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>
      )}

      {action.type === "split" && (
        action.split ? (
          <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => onOpenSplit(action.campaignId)}>
            <Split className="h-3.5 w-3.5" aria-hidden="true" /> {action.split.step === "created" ? t("google.searchXray.openSplit") : t("google.searchXray.viewSplit")}
          </Button>
        ) : (
          <Button type="button" size="sm" className="h-9" onClick={() => onOpenSplit(action.campaignId)} disabled={!canEdit}>
            <Split className="h-3.5 w-3.5" aria-hidden="true" /> {t("google.searchXray.splitGeneric")}
          </Button>
        )
      )}

      {rec.action.type === "proposals" && proposals.length > 0 && (
        <div className="space-y-2">
          <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
            {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
            {t("google.searchXray.specificActions", { n: proposals.length })}{checkedCount > 0 ? t("google.searchXray.selectedSuffix", { n: checkedCount }) : ""}
          </button>
          {open && <ProposalList proposals={proposals} checked={checked} onToggle={onToggle} canEdit={canEdit} />}
          {canEdit && (
            <ApplyControls company={company} range={range} confirmText={confirmText} items={proposals.filter((p) => checked[p.id])} onDone={onApplied} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Thanh "chọn tất cả → kiểm trước → áp dụng" ──

function GlobalApplyBar({
  proposals, checked, onSelectAllDefault, company, range, confirmText, onApplied,
}: {
  proposals: SearchProposal[]; checked: Record<string, boolean>; onSelectAllDefault: () => void;
  company: Company; range: Range; confirmText: string; onApplied: () => void;
}) {
  const t = useT();
  const selected = proposals.filter((p) => checked[p.id]);
  return (
    <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={onSelectAllDefault}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {t("google.searchXray.selectAllDefault")}
        </Button>
        <span className="text-xs font-semibold text-indigo-400">→</span>
        <span className="text-xs text-indigo-700">{t("google.searchXray.selectedAll", { sel: selected.length, total: proposals.length })}</span>
      </div>
      <ApplyControls company={company} range={range} confirmText={confirmText} items={selected} onDone={onApplied} />
    </div>
  );
}

// ── Lịch sử áp dụng ──

function HistoryRow({ h, onUndo }: { h: SearchExecution; onUndo: (id: string) => void }) {
  const intl = useIntlLocale();
  const t = useT();
  const ok = h.status === "done";
  return (
    <div className={cn("rounded-lg border p-3 text-xs", ok ? "border-emerald-100 bg-emerald-50/30" : "border-red-100 bg-red-50/30")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn("flex items-center gap-1 font-semibold", ok ? "text-emerald-700" : "text-red-700")}>
          {ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {h.mode === "validate" ? t("google.searchXray.modeValidate") : t("google.searchXray.modeWrite")}
        </span>
        <span className="text-slate-400">{datetimeVN(h.at, intl)}</span>
        <span className="text-slate-500">{h.by}</span>
      </div>
      {h.applied.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-slate-600">{h.applied.map((a) => <li key={a.proposalId}>{a.label}</li>)}</ul>}
      {h.errors.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-red-700">{h.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {h.mode === "write" && (
        h.undoneAt ? (
          <div className="mt-2 rounded-md border border-slate-200 bg-white p-2 text-slate-600">
            <p className="font-semibold">{t("google.searchXray.undoneAt", { time: datetimeVN(h.undoneAt, intl) })}</p>
            {h.undoReport && h.undoReport.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-4">{h.undoReport.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          </div>
        ) : ok ? (
          <div className="mt-2 flex justify-end">
            <Button variant="destructive" size="sm" className="h-8" onClick={() => onUndo(h.id)}><Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> {t("google.searchXray.undo")}</Button>
          </div>
        ) : null
      )}
    </div>
  );
}

function HistorySection({ history, company, onChanged, confirmText }: { history: SearchExecution[]; company: Company; onChanged: () => void; confirmText: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [undoId, setUndoId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoErr, setUndoErr] = useState<string | null>(null);

  async function runUndo(id: string) {
    setUndoing(true); setUndoErr(null);
    try {
      await postJson("/api/google/search/controls", { company, op: "undo", id, confirmText: typed.trim() });
      setUndoId(null);
      onChanged();
    } catch (e) {
      setUndoErr(e instanceof ApiError ? e.message : t("google.searchXray.undoFailed"));
    } finally { setUndoing(false); }
  }

  if (history.length === 0) return null;

  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-800">
        {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
        {t("google.searchXray.history", { n: history.length })}
      </button>
      {open && <div className="mt-2 space-y-2">{history.map((h) => <HistoryRow key={h.id} h={h} onUndo={(id) => { setTyped(""); setUndoId(id); }} />)}</div>}
      <Dialog open={!!undoId} onOpenChange={(o) => { if (!o) { setUndoId(null); setUndoErr(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">{t("google.searchXray.undoTitle")}</DialogTitle>
            <DialogDescription>{t("google.searchXray.undoDesc")}</DialogDescription>
          </DialogHeader>
          <label className="space-y-1 text-xs">
            <span className="text-slate-500">{t("google.searchXray.typePrefix")}<code className="rounded bg-slate-100 px-1">{confirmText}</code>{t("google.searchXray.typeSuffix")}</span>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={confirmText} autoComplete="off" className="h-10" />
          </label>
          {undoErr && <p className="text-xs text-red-600">{undoErr}</p>}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.searchXray.keep")}</DialogClose>
            <Button className="h-10" variant="destructive" onClick={() => undoId && runUndo(undoId)} disabled={undoing || typed.trim() !== confirmText}>
              {undoing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.searchXray.undo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Bảng chiến dịch (chi phí, đơn, CPA, IS, % thương hiệu) + tách theo ý định ──

function IntentBars({ intents, campaignCost }: { intents: IntentCell[]; campaignCost: number }) {
  const intl = useIntlLocale();
  const t = useT();
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-100 bg-white">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-slate-100 text-left text-slate-400">
            <th className="px-2 py-1.5 font-medium">{t("google.searchXray.col.intent")}</th>
            <th className="px-2 py-1.5 font-medium">{t("google.searchXray.col.cost")}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t("google.searchXray.col.orders")}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t("google.searchXray.col.cpa")}</th>
          </tr>
        </thead>
        <tbody>
          {intents.map((it) => (
            <tr key={it.intent} className="border-b border-slate-50 last:border-0">
              <td className="px-2 py-1.5 font-medium text-slate-700">{it.label}</td>
              <td className="px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 whitespace-nowrap tabular-nums text-slate-700">{vnd(it.cost, intl)}</span>
                  <div className="h-1.5 max-w-[100px] min-w-[24px] flex-1 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${campaignCost > 0 ? Math.round((it.cost / campaignCost) * 100) : 0}%` }} />
                  </div>
                </div>
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{num(it.purchases, { maximumFractionDigits: 1 }, intl)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{vnd(it.cpa, intl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CampaignRow({ c }: { c: SearchCampaign }) {
  const intl = useIntlLocale();
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="cursor-pointer border-b border-slate-50 align-top last:border-0 hover:bg-slate-50" onClick={() => setOpen((o) => !o)}>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            {open ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />}
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", c.status === "ENABLED" ? "bg-emerald-500" : "bg-slate-300")} />
            <span className="max-w-[260px] truncate font-medium text-slate-800" title={c.name}>{c.name}</span>
          </div>
        </td>
        <td className="px-3 py-2.5 text-slate-500">{STATUS_LABEL[c.status] ? t(STATUS_LABEL[c.status]) : c.status}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{vnd(c.cost, intl)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{num(c.purchases, { maximumFractionDigits: 1 }, intl)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{vnd(c.cpa, intl)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{c.impressionShare === null ? "—" : pct(c.impressionShare, 0, intl)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{c.lostBudget === null ? "—" : pct(c.lostBudget, 0, intl)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{c.lostRank === null ? "—" : pct(c.lostRank, 0, intl)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{pct(c.brandShareOfCost, 0, intl)}</td>
      </tr>
      {open && (
        <tr className="border-b border-slate-50 bg-slate-50/50 last:border-0">
          <td colSpan={9} className="p-3">
            {c.warnings.length > 0 && (
              <ul className="mb-2 space-y-1 text-xs text-red-700">
                {c.warnings.map((w) => <li key={w.id} className="flex gap-1.5"><span className="shrink-0 font-bold">{w.level === "bad" ? "✕" : "⚠"}</span><span>{w.text}</span></li>)}
              </ul>
            )}
            {c.intents.length > 0 ? <IntentBars intents={c.intents} campaignCost={c.cost} /> : <p className="text-xs text-slate-400">{t("google.searchXray.noSearches")}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

function CampaignTable({ campaigns }: { campaigns: SearchCampaign[] }) {
  const t = useT();
  if (campaigns.length === 0) return <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">{t("google.searchXray.noCampaigns")}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[820px] text-xs">
        <thead>
          <tr className="border-b border-slate-100 text-left text-[11px] text-slate-500">
            <th className="px-3 py-2 font-medium">{t("google.searchXray.col.campaign")}</th>
            <th className="px-3 py-2 font-medium">{t("google.searchXray.col.status")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("google.searchXray.col.cost")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("google.searchXray.col.purchases")}</th>
            <th className="px-3 py-2 text-right font-medium">CPA</th>
            <th className="px-3 py-2 text-right font-medium">{t("google.searchXray.col.is")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("google.searchXray.col.lostBudget")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("google.searchXray.col.lostRank")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("google.searchXray.col.brandShare")}</th>
          </tr>
        </thead>
        <tbody>{campaigns.map((c) => <CampaignRow key={c.id} c={c} />)}</tbody>
      </table>
    </div>
  );
}

// ── Thẻ nhỏ: loại khớp · QS · thiết bị ──

function SmallCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="mb-2 text-xs font-bold text-slate-700">{title}</p>
      {children}
    </div>
  );
}

function MiniTable({ rows }: { rows: { key: string; label: string; cost: number; purchases: number; extra?: string }[] }) {
  const intl = useIntlLocale();
  const t = useT();
  if (rows.length === 0) return <p className="text-[11px] text-slate-400">{t("google.searchXray.noData")}</p>;
  return (
    <table className="w-full text-[11px]">
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b border-slate-50 last:border-0">
            <td className="py-1 pr-2 text-slate-600">{r.label}{r.extra && <span className="ml-1 text-slate-400">{r.extra}</span>}</td>
            <td className="py-1 text-right tabular-nums text-slate-700">{vnd(r.cost, intl)}</td>
            <td className="py-1 pl-2 text-right tabular-nums text-slate-500">{num(r.purchases, { maximumFractionDigits: 1 }, intl)} {t("google.searchXray.ordersWord")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Root ──

export function SearchXrayTab({ company, range }: { company: Company; range: Range }) {
  const t = useT();
  const [xray, setXray] = useState<XrayResponse | null>(null);
  const [ctl, setCtl] = useState<ControlsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [splitCampaignId, setSplitCampaignId] = useState<string | null>(null);

  const load = useCallback(async (force?: boolean) => {
    if (force) setReloading(true); else setLoading(true);
    setError(null);
    try {
      const [x, c] = await Promise.all([
        getJson(`/api/google/search/xray?company=${company}&from=${range.from}&to=${range.to}${force ? "&force=1" : ""}`),
        getJson(`/api/google/search/controls?company=${company}&from=${range.from}&to=${range.to}`),
      ]);
      setXray(x as XrayResponse);
      setCtl(c as ControlsResponse);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("google.searchXray.connError"));
    } finally { setLoading(false); setReloading(false); }
  }, [company, range.from, range.to, t]);

  useEffect(() => { load(); }, [load]);

  // Giữ lựa chọn tay của người dùng qua các lần tải lại; việc mới xuất hiện thì lấy mặc định.
  useEffect(() => {
    if (!ctl) return;
    setChecked((prev) => {
      const next: Record<string, boolean> = {};
      for (const p of ctl.proposals) next[p.id] = p.id in prev ? prev[p.id] : p.defaultChecked;
      return next;
    });
  }, [ctl]);

  const toggle = useCallback((id: string) => setChecked((prev) => ({ ...prev, [id]: !prev[id] })), []);

  function selectAllDefault() {
    if (!ctl) return;
    const next: Record<string, boolean> = {};
    for (const p of ctl.proposals) next[p.id] = p.defaultChecked;
    setChecked(next);
  }

  const refresh = useCallback(() => load(true), [load]);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">{t("google.searchXray.intro")}</p>
        <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={refresh} disabled={loading || reloading}>
          {reloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.searchXray.reload")}
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> <span>{error}</span>
        </div>
      )}

      {loading && !xray ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div>
      ) : !xray || !ctl ? null : (
        <>
          {xray.errors.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t("google.searchXray.partialData", { errors: xray.errors.join(" · ") })}
            </div>
          )}

          <WarningBanner warnings={xray.warnings} />

          {/* ── Việc nên làm ── */}
          <div>
            <h3 className="flex items-center gap-1.5 text-base font-extrabold text-slate-900">{t("google.searchXray.actionsHeading")}</h3>
            {!ctl.canEdit && (
              <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                {t("google.searchXray.readOnly")}
              </p>
            )}
          </div>

          {ctl.recommendations.length === 0 ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{t("google.searchXray.noActions")}</p>
          ) : (
            <>
              {ctl.canEdit && ctl.proposals.length > 0 && (
                <GlobalApplyBar proposals={ctl.proposals} checked={checked} onSelectAllDefault={selectAllDefault} company={company} range={range} confirmText={ctl.confirmText} onApplied={refresh} />
              )}
              <div className="space-y-3">
                {ctl.recommendations.map((rec) => (
                  <RecommendationCard
                    key={rec.id}
                    rec={rec}
                    proposals={rec.action.type === "proposals" ? rec.action.ids.map((id) => ctl.proposals.find((p) => p.id === id)).filter((p): p is SearchProposal => !!p) : []}
                    checked={checked}
                    onToggle={toggle}
                    company={company}
                    range={range}
                    confirmText={ctl.confirmText}
                    canEdit={ctl.canEdit}
                    onApplied={refresh}
                    onOpenSplit={setSplitCampaignId}
                  />
                ))}
              </div>
            </>
          )}

          <HistorySection history={ctl.history} company={company} onChanged={refresh} confirmText={ctl.confirmText} />

          {/* ── Bảng chiến dịch ── */}
          <div>
            <h3 className="text-sm font-bold text-slate-800">{t("google.searchXray.byIntentHeading")}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{t("google.searchXray.byIntentHint")}</p>
          </div>
          <CampaignTable campaigns={xray.campaigns} />

          {/* ── Loại khớp · QS · thiết bị ── */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SmallCard title={t("google.searchXray.cardMatch")}>
              <MiniTable rows={xray.matchTypes.map((m) => ({ key: m.match, label: MATCH_LABEL[m.match] ? t(MATCH_LABEL[m.match]) : m.match, cost: m.cost, purchases: m.purchases }))} />
            </SmallCard>
            <SmallCard title={t("google.searchXray.cardQs")}>
              <MiniTable rows={xray.qs.map((q) => ({ key: q.qs, label: q.qs === "?" ? t("google.searchXray.qsNone") : `QS ${q.qs}`, cost: q.cost, purchases: q.purchases, extra: t("google.searchXray.qsKeywords", { n: q.keywords }) }))} />
            </SmallCard>
            <SmallCard title={t("google.searchXray.cardDevices")}>
              <MiniTable rows={xray.devices.map((d) => ({ key: d.device, label: DEVICE_LABEL[d.device] ? t(DEVICE_LABEL[d.device]) : d.device, cost: d.cost, purchases: d.purchases }))} />
            </SmallCard>
          </div>

          {xray.notes.length > 0 && (
            <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
              {xray.notes.map((n, i) => <p key={i}>{n}</p>)}
            </div>
          )}
        </>
      )}

      <SearchSplitDialog
        company={company}
        range={range}
        campaignId={splitCampaignId}
        open={!!splitCampaignId}
        onOpenChange={(o) => { if (!o) setSplitCampaignId(null); }}
        onChanged={refresh}
      />
    </section>
  );
}
