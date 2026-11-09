"use client";

// ============================================================
// Tab "🧾 Nhật ký ghi" của /google-search (Đợt 11e) — mọi lần ghi qua lớp an
// toàn dùng chung (lib/write-guard.ts: negative/add keyword cũ + đề xuất X-quang,
// tách chiến dịch, sửa RSA đều tự lưu vào cùng nhật ký này) với Hoàn tác một chạm.
// ------------------------------------------------------------
// GET  /api/write-log?company=       — 100 lần ghi gần nhất
// POST /api/write-log {company, id}  — hoàn tác (một lệnh nguyên khối)
// Chỉ `import type` từ lib/write-guard.ts.
// ============================================================

import { useCallback, useEffect, useId, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Undo2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getJson, postJson, ApiError } from "@/components/case/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import { WRITE_CONFIRM_TEXT } from "@/components/ConfirmWriteDialog";
import type { GuardedWrite } from "@/lib/write-guard";
import type { MessageKey } from "@/lib/i18n/messages";

type Company = string;
type WriteRow = Omit<GuardedWrite, "inverse"> & { canUndo: boolean };

interface LogResponse { writes: WriteRow[]; canEdit: boolean }

const SOURCE_LABEL: Record<string, MessageKey> = {
  "google-search/negative": "google.searchLog.src.negative",
  "google-search/add-keyword": "google.searchLog.src.addKeyword",
  "toolkit/ngram": "google.searchLog.src.ngram",
  "toolkit/rsa": "google.searchLog.src.rsa",
  "toolkit/dayparting": "google.searchLog.src.dayparting",
};

function datetimeVN(iso: string, intl: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(intl, { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "medium" });
}

export function SearchLogTab({ company }: { company: Company }) {
  const t = useT();
  const intl = useIntlLocale();
  const confirmId = useId();
  const [data, setData] = useState<LogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [undoId, setUndoId] = useState<string | null>(null);
  const [confirmInput, setConfirmInput] = useState("");
  const [undoing, setUndoing] = useState(false);
  const [undoErr, setUndoErr] = useState<string | null>(null);

  const load = useCallback(async (force?: boolean) => {
    if (force) setReloading(true); else setLoading(true);
    setError(null);
    try {
      const json = await getJson(`/api/write-log?company=${company}`);
      setData(json as LogResponse);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("google.searchLog.connError"));
    } finally { setLoading(false); setReloading(false); }
  }, [company]);

  useEffect(() => { load(); }, [load]);

  async function runUndo() {
    if (!undoId) return;
    setUndoing(true); setUndoErr(null);
    try {
      await postJson("/api/write-log", { company, id: undoId });
      setUndoId(null); setConfirmInput("");
      await load(true);
    } catch (e) {
      setUndoErr(e instanceof ApiError ? e.message : t("google.searchLog.undoFailed"));
    } finally { setUndoing(false); }
  }

  const refresh = () => load(true);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">{t("google.searchLog.intro", { company })}</p>
        <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={refresh} disabled={loading || reloading}>
          {reloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.searchLog.reload")}
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> <span>{error}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />)}</div>
      ) : !data ? null : (
        <>
          {!data.canEdit && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">{t("google.searchLog.readOnly")}</p>
          )}

          {data.writes.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">{t("google.searchLog.empty", { company })}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full min-w-[720px] text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] text-slate-500">
                    <th className="px-3 py-2 font-medium">{t("google.searchLog.col.time")}</th>
                    <th className="px-3 py-2 font-medium">{t("google.searchLog.col.by")}</th>
                    <th className="px-3 py-2 font-medium">{t("google.searchLog.col.source")}</th>
                    <th className="px-3 py-2 font-medium">{t("google.searchLog.col.content")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("google.searchLog.col.ops")}</th>
                    <th className="px-3 py-2 font-medium">{t("google.searchLog.col.status")}</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.writes.map((w) => (
                    <tr key={w.id} className="border-b border-slate-50 align-top last:border-0">
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-500">{datetimeVN(w.at, intl)}</td>
                      <td className="px-3 py-2.5 text-slate-600">{w.by}</td>
                      <td className="px-3 py-2.5 text-slate-500">{SOURCE_LABEL[w.source] ? t(SOURCE_LABEL[w.source]) : w.source}</td>
                      <td className="px-3 py-2.5 max-w-[360px] text-slate-700">{w.label}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{w.ops}</td>
                      <td className="px-3 py-2.5">
                        {w.status === "done" ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {t("google.searchLog.statusDone")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                            <XCircle className="h-3 w-3" aria-hidden="true" /> {t("google.searchLog.statusError")}
                          </span>
                        )}
                        {w.error && <p className="mt-1 max-w-[220px] text-[10px] text-red-600">{w.error}</p>}
                        {w.undoneAt && (
                          <p className="mt-1 text-[10px] text-slate-400">{t("google.searchLog.undone", { time: datetimeVN(w.undoneAt, intl) })}{w.undoneBy ? t("google.searchLog.undoneBy", { user: w.undoneBy }) : ""}</p>
                        )}
                        {w.undoError && <p className="mt-1 max-w-[220px] text-[10px] text-red-600">{t("google.searchLog.undoError", { error: w.undoError })}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {w.canUndo && data.canEdit && (
                          <Button variant="destructive" size="sm" className="h-8" onClick={() => { setUndoId(w.id); setConfirmInput(""); setUndoErr(null); }}>
                            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> {t("google.searchLog.undo")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Dialog open={!!undoId} onOpenChange={(o) => { if (!o) { setUndoId(null); setConfirmInput(""); setUndoErr(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">{t("google.searchLog.undoTitle")}</DialogTitle>
            <DialogDescription>{t("google.searchLog.undoDesc", { company })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor={confirmId} className="text-xs font-medium text-slate-500">
              {t("google.searchLog.typePrefix")}<code className="rounded bg-slate-100 px-1 py-0.5">{WRITE_CONFIRM_TEXT}</code>{t("google.searchLog.typeSuffix")}
            </label>
            <Input id={confirmId} value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} placeholder={WRITE_CONFIRM_TEXT} autoComplete="off" className="h-10" />
          </div>
          {undoErr && <p className="text-xs text-red-600">{undoErr}</p>}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.searchLog.cancel")}</DialogClose>
            <Button className={cn("h-10")} variant="destructive" onClick={runUndo} disabled={undoing || confirmInput.trim() !== WRITE_CONFIRM_TEXT}>
              {undoing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.searchLog.undo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
