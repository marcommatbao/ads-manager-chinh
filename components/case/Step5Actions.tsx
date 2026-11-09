// ============================================================
// Bước 5 — Hướng xử lý: chỉ dựng nút cho việc tool GHI ĐƯỢC (đã mô phỏng
// trước). Việc ngoài khả năng → "Việc cần người làm", không có nút "Áp ngay".
// ============================================================
"use client";

import { useState } from "react";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { vnd, num } from "./format";
import { patchJson, ApiError } from "./api";
import type { CampaignCase } from "@/lib/case/store";
import { useT, useIntlLocale } from "@/lib/i18n/client";

export function Step5Actions({
  c,
  onRefresh,
  onBack,
  onNext,
  busy,
}: {
  c: CampaignCase;
  onRefresh: (next: CampaignCase) => void;
  onBack: () => void;
  onNext: () => void;
  busy?: boolean;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dialogFor, setDialogFor] = useState<string | null>(null);

  async function toggleAction(id: string, checked: boolean) {
    setSavingId(id);
    setErr(null);
    try {
      const json = await patchJson(`/api/cases/${c.id}/actions`, { selected: { [id]: checked } });
      onRefresh(json.case);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("overview.step5.err.saveChoice"));
    } finally {
      setSavingId(null);
    }
  }

  /** Đổi sự kiện tối ưu của việc "Tạo nhóm mới" — chỉ trong danh sách `alternatives`, giữ nguyên lựa chọn selected hiện tại. */
  async function changeEvent(id: string, currentSelected: boolean, event: string) {
    setSavingId(id);
    setErr(null);
    try {
      const json = await patchJson(`/api/cases/${c.id}/actions`, { selected: { [id]: currentSelected }, options: { [id]: { event } } });
      onRefresh(json.case);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("overview.step5.err.event"));
    } finally {
      setSavingId(null);
    }
  }

  /** "Tạm dừng nhóm cũ cùng lúc" của việc "Bật nhóm mới". */
  async function togglePauseSource(id: string, currentSelected: boolean, pauseSource: boolean) {
    setSavingId(id);
    setErr(null);
    try {
      const json = await patchJson(`/api/cases/${c.id}/actions`, { selected: { [id]: currentSelected }, options: { [id]: { pauseSource } } });
      onRefresh(json.case);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("overview.step5.err.saveChoice"));
    } finally {
      setSavingId(null);
    }
  }

  /** Xác nhận hiểu rủi ro khi không sự kiện chuẩn nào đủ ngưỡng — server chặn CREATE nếu lowSignal && !lowSignalAck. */
  async function toggleLowSignalAck(id: string, currentSelected: boolean, lowSignalAck: boolean) {
    setSavingId(id);
    setErr(null);
    try {
      const json = await patchJson(`/api/cases/${c.id}/actions`, { selected: { [id]: currentSelected }, options: { [id]: { lowSignalAck } } });
      onRefresh(json.case);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("overview.step5.err.saveChoice"));
    } finally {
      setSavingId(null);
    }
  }

  const anySelected = c.actions.some((a) => a.selected);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-900">{t("overview.step5.title")}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{c.platform === "facebook"
          ? t("overview.step5.subtitle.meta")
          : t("overview.step5.subtitle.google")}</p>
      </div>

      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {c.actions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-400">{t("overview.step5.noActions")}</p>
      ) : (
        <div className="space-y-3">
          {c.actions.map((a) => (
            <div key={a.id} className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={a.selected}
                  onCheckedChange={(v) => toggleAction(a.id, v)}
                  disabled={savingId === a.id}
                  aria-label={a.label}
                  className="mt-0.5"
                />
                <label className="min-w-0 flex-1 cursor-pointer text-sm font-semibold text-slate-900">{a.label}</label>
              </div>

              {a.type === "SET_CAMPAIGN_BUDGET" && (
                <div className="mt-3 pl-7 text-sm text-slate-600">
                  <div>
                    {t("overview.step5.beforeAfter")}: <span className="tabular-nums">{vnd(a.before, intl)}</span> → <span className="tabular-nums font-semibold text-slate-900">{vnd(a.after, intl)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{a.reason}</p>
                </div>
              )}

              {a.type === "PAUSE_ADSET" && (
                <div className="mt-3 pl-7 text-xs text-slate-500">{a.reason}</div>
              )}

              {a.type === "EXCLUDE_PLACEMENT" && (
                <div className="mt-3 space-y-2 pl-7 text-sm">
                  <div className="text-slate-600">
                    {t("overview.step5.placementCost")}: <b className="tabular-nums">{vnd(a.cost, intl)}</b> · <span className="tabular-nums">{num(a.results, undefined, intl)}</span> {a.resultLabel}
                  </div>
                  {a.automatic && (
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {t("overview.step5.autoToManual")}
                    </span>
                  )}
                  {a.warnings.length > 0 && (
                    <ul className="space-y-0.5 text-xs text-amber-700">
                      {a.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
                    </ul>
                  )}
                </div>
              )}

              {a.type === "CREATE_ADSET_WITH_EVENT" && (
                <div className="mt-3 space-y-3 pl-7 text-sm">
                  <div className="text-slate-600">
                    {t("overview.step5.sourceAdset")}: <b className="text-slate-900">{a.sourceAdsetName}</b>
                  </div>

                  <div className="rounded-lg bg-slate-50 p-2.5">
                    <div className="mb-1.5 text-xs font-semibold text-slate-700">{t("overview.step5.suggestedEvent")}</div>
                    <div className="text-slate-800">
                      <b>{a.eventLabel}</b> — <span className="tabular-nums">{a.perWeek === null ? "—" : num(a.perWeek, undefined, intl)}</span> {t("overview.step5.perWeekRecent")}
                    </div>
                    <label className="mt-2.5 block text-xs text-slate-500" htmlFor={`event-select-${a.id}`}>{t("overview.step5.otherEvent")}</label>
                    <Select
                      value={a.event}
                      onValueChange={(v) => { if (v) changeEvent(a.id, a.selected, v); }}
                      disabled={savingId === a.id}
                    >
                      <SelectTrigger id={`event-select-${a.id}`} aria-label={t("overview.step5.otherEvent.aria")} className="mt-1 w-full"><SelectValue>{(v: string) => { const alt = a.alternatives.find((x) => x.event === v); return alt ? `${alt.label} — ${num(alt.perWeek, undefined, intl)} ${t("overview.step5.perWeek")}` : a.eventLabel; }}</SelectValue></SelectTrigger>
                      <SelectContent>
                        {a.alternatives.map((alt) => (
                          <SelectItem key={alt.event} value={alt.event}>{alt.label} — {num(alt.perWeek, undefined, intl)} {t("overview.step5.perWeek")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {a.warnings.length > 0 && (
                    <ul className="space-y-0.5 text-xs text-amber-700">
                      {a.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
                    </ul>
                  )}

                  {a.lowSignal && (
                    <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
                      <div>
                        <b>{t("overview.step5.lowSignal.bold")}</b> — {t("overview.step5.lowSignal.rest")}
                      </div>
                      <div className="flex min-h-8 items-start gap-2">
                        <Checkbox
                          checked={!!a.lowSignalAck}
                          onCheckedChange={(v) => toggleLowSignalAck(a.id, a.selected, !!v)}
                          disabled={savingId === a.id}
                          aria-label={t("overview.step5.lowSignal.ack")}
                          className="mt-0.5"
                        />
                        <span>{t("overview.step5.lowSignal.ack")}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {a.type === "ACTIVATE_NEW_ADSET" && (
                <div className="mt-3 space-y-1.5 pl-7 text-sm">
                  <label className="flex min-h-8 cursor-pointer items-center gap-2 text-slate-700">
                    <Checkbox
                      checked={a.pauseSource}
                      onCheckedChange={(v) => togglePauseSource(a.id, a.selected, !!v)}
                      disabled={savingId === a.id}
                    />
                    {t("overview.step5.pauseOld")}
                  </label>
                  <p className="text-xs text-slate-500">{t("overview.step5.pauseOldHint")}</p>
                </div>
              )}

              {a.type === "REMOVE_FROM_SHARED_LIST" && (
                <div className="mt-3 pl-7">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                    <div className="mb-1 font-semibold">{t("overview.step5.whyRemove")}</div>
                    <ul className="space-y-0.5">{a.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                    <div className="mt-1 text-amber-800/80">{t("overview.step5.undoNote")}</div>
                  </div>
                </div>
              )}
              {"simulation" in a && (
                <div className="mt-3 space-y-3 pl-7">
                  {a.type === "ATTACH_SHARED_LIST" && a.flagged && a.flagged.length > 0
                    && c.actions.some((x) => x.type === "REMOVE_FROM_SHARED_LIST" && x.selected) && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
                      {t("overview.step5.flaggedRemoved", { n: a.flagged.length, list: a.sharedSetName })}
                    </div>
                  )}
                  {a.type === "ATTACH_SHARED_LIST" && a.flagged && a.flagged.length > 0
                    && !c.actions.some((x) => x.type === "REMOVE_FROM_SHARED_LIST" && x.selected) && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
                      <div className="mb-1 font-semibold">
                        {t("overview.step5.flaggedWarn", { n: a.flagged.length, list: a.sharedSetName })}
                      </div>
                      <ul className="space-y-0.5">
                        {a.flagged.map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    </div>
                  )}
                  {a.simulation && (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <SimTile label={t("overview.step5.sim.blockedTerms")} value={num(a.simulation.blockedTerms, undefined, intl)} />
                      <SimTile label={t("overview.step5.sim.blockedCost")} value={vnd(a.simulation.blockedCost, intl)} />
                      <SimTile label={t("overview.step5.sim.lostOrders")} value={num(a.simulation.blockedConversions, undefined, intl)} tone={a.simulation.blockedConversions === 0 ? "good" : "bad"} />
                      <SimTile label={t("overview.step5.sim.lostSecondary")} value={num(a.simulation.blockedAllConversions, { maximumFractionDigits: 1 }, intl)} tone={a.simulation.blockedAllConversions === 0 ? "good" : "warn"} />
                    </div>
                  )}

                  {a.simulation?.moved && a.simulation.moved.terms > 0 && (
                    <div className="rounded-lg border border-sky-200 bg-sky-50 p-2.5 text-xs text-sky-800">
                      <div className="font-semibold">
                        {t("overview.step5.moved.title", { to: a.simulation.moved.to, terms: num(a.simulation.moved.terms, undefined, intl), cost: vnd(a.simulation.moved.cost, intl), orders: num(a.simulation.moved.conversions, { maximumFractionDigits: 1 }, intl), secondary: num(a.simulation.moved.allConversions, { maximumFractionDigits: 1 }, intl) })}
                      </div>
                      <div className="mt-0.5">
                        {a.simulation.moved.live
                          ? t("overview.step5.moved.live")
                          : t("overview.step5.moved.notLive")}
                      </div>
                    </div>
                  )}

                  {a.simulation && a.simulation.withConversions.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                      <div className="mb-1 font-semibold">{t("overview.step5.withConv")}</div>
                      <ul className="space-y-0.5">
                        {a.simulation.withConversions.map((w, i) => (
                          <li key={i}>
                            “{w.term}” · {vnd(w.cost, intl)} · {t("overview.step5.termConv", { orders: num(w.conversions, { maximumFractionDigits: 1 }, intl), secondary: num(w.allConversions, { maximumFractionDigits: 1 }, intl) })}
                            {w.movedTo && <span className="text-sky-700"> → {t("overview.step5.movedTo", { to: w.movedTo })}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {a.simulation && a.simulation.ownKeywordsBlocked.length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
                      <div className="mb-1 font-semibold">{t("overview.step5.ownKw")}</div>
                      <ul className="space-y-0.5">
                        {a.simulation.ownKeywordsBlocked.map((k, i) => (
                          <li key={i}>
                            “{k.text}” ({k.match}) · {vnd(k.cost, intl)} · {t("overview.step5.ownKwRow", { n: k.impressions, by: k.by })}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {a.type === "ADD_NEGATIVES" && a.dropped && a.dropped.length > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
                      <div className="mb-1 font-semibold">{t("overview.step5.dropped", { n: a.dropped.length })}</div>
                      <ul className="space-y-0.5">
                        {a.dropped.map((d, i) => <li key={i}>“{d.text}” — {d.why}</li>)}
                      </ul>
                    </div>
                  )}

                  {"negatives" in a && (<>
                  <Button className="h-10" variant="ghost" size="sm" onClick={() => setDialogFor(a.id)}>{t("overview.step5.viewAll", { n: a.negatives.length })}</Button>

                  <Dialog open={dialogFor === a.id} onOpenChange={(o) => setDialogFor(o ? a.id : null)}>
                    <DialogContent className="sm:max-w-lg">
                      <DialogHeader>
                        <DialogTitle>{t("overview.step5.negTitle", { n: a.negatives.length })}</DialogTitle>
                      </DialogHeader>
                      <div className="flex max-h-80 flex-wrap gap-1.5 overflow-y-auto text-sm">
                        {a.negatives.map((n, i) => (
                          <span key={i} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{n.text}</span>
                        ))}
                      </div>
                      <DialogFooter>
                        <DialogClose render={<Button className="h-10" variant="outline" />}>{t("overview.step5.close")}</DialogClose>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  </>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-800">
          {t("overview.step5.manual.title")} <span className="font-normal text-slate-400">({t("overview.step5.manual.hint")})</span>
        </h3>
        {c.manualTasks.length === 0 ? (
          <p className="text-sm text-slate-400">{t("overview.step5.manual.none")}</p>
        ) : (
          <div className="space-y-2">
            {c.manualTasks.map((mt) => (
              <ManualTaskCard key={mt.id} caseId={c.id} task={mt} onRefresh={onRefresh} />
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <Button className="h-10" variant="outline" onClick={onBack} disabled={busy}>{t("overview.step5.back")}</Button>
        <Button className="h-10" onClick={onNext} disabled={busy || !anySelected} title={!anySelected ? t("overview.step5.pickOne") : undefined}>
          {t("overview.step5.next")}
        </Button>
      </div>
    </div>
  );
}

function SimTile({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" | "warn" }) {
  const cls = tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

function ManualTaskCard({
  caseId,
  task,
  onRefresh,
}: {
  caseId: string;
  task: CampaignCase["manualTasks"][number];
  onRefresh: (next: CampaignCase) => void;
}) {
  const t = useT();
  const [assignee, setAssignee] = useState(task.assignee ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function patch(body: { status?: "open" | "done"; assignee?: string | null }) {
    setSaving(true);
    setErr(null);
    try {
      const json = await patchJson(`/api/cases/${caseId}/tasks/${task.id}`, body);
      onRefresh(json.case);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("overview.step5.manual.err"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="flex items-start gap-3">
        <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-900">{task.title}</div>
          <p className="mt-0.5 text-sm text-slate-500">{task.detail}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label htmlFor={`assignee-${task.id}`} className="text-xs text-slate-400">{t("overview.step5.manual.assignTo")}</label>
            <Input
              id={`assignee-${task.id}`}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              onBlur={() => { if (assignee !== (task.assignee ?? "")) patch({ assignee: assignee.trim() || null }); }}
              placeholder={t("overview.step5.manual.assigneePh")}
              className="h-7 w-48"
              disabled={saving}
            />
            <label className="ml-2 flex min-h-8 cursor-pointer items-center gap-1.5 text-xs text-slate-600">
              <Checkbox
                checked={task.status === "done"}
                onCheckedChange={(v) => patch({ status: v ? "done" : "open" })}
                disabled={saving}
              />
              {t("overview.step5.manual.done")}
            </label>
          </div>
          {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
        </div>
      </div>
    </div>
  );
}
