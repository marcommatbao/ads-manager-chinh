// ============================================================
// Bước 7 — "Nên làm gì tiếp": kết luận lần đo gần nhất + vì sao + việc nên làm.
// Số liệu lấy từ hàm thuần lib/case/next-steps.ts; ở đây chỉ hiển thị + gọi API.
// ============================================================
"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { vnd, ddmmyyyy } from "./format";
import { postJson, ApiError } from "./api";
import type { CampaignCase } from "@/lib/case/store";
import { nextSteps, type NextVerdict } from "@/lib/case/next-steps";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

const PILL: Record<NextVerdict | "none", { text: MessageKey; cls: string }> = {
  improved: { text: "overview.nextsteps.pill.improved", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  worse: { text: "overview.nextsteps.pill.worse", cls: "bg-red-50 text-red-700 border-red-200" },
  same: { text: "overview.nextsteps.pill.same", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  insufficient: { text: "overview.nextsteps.pill.insufficient", cls: "bg-slate-50 text-slate-600 border-slate-200" },
  none: { text: "overview.nextsteps.pill.none", cls: "bg-slate-50 text-slate-600 border-slate-200" },
};

type Busy = "check" | "reopen" | `undo:${string}`;
type Confirm = "reopen" | `undo:${string}` | null;

export function NextStepsPanel({ c, onRefresh }: { c: CampaignCase; onRefresh: (next: CampaignCase) => void }) {
  const intl = useIntlLocale();
  const t = useT();
  const v = useMemo(() => nextSteps(c), [c]);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [err, setErr] = useState<{ key: string; msg: string } | null>(null);

  if (v.verdict === null && !v.source && c.executions.length === 0) return null;

  async function run(key: Busy, path: string, body: unknown, fallback: string) {
    setBusy(key);
    setErr(null);
    try {
      const json = await postJson(`/api/cases/${c.id}/${path}`, body);
      setConfirm(null);
      onRefresh(json.case);
    } catch (e) {
      setErr({ key, msg: e instanceof ApiError ? e.message : fallback });
    } finally {
      setBusy(null);
    }
  }
  const check = () => run("check", "check", undefined, t("overview.nextsteps.checkFailed"));
  const reopen = () => run("reopen", "reopen", undefined, t("overview.nextsteps.reopenFailed"));
  const undo = (executionId: string) => run(`undo:${executionId}`, "undo", { executionId }, t("overview.nextsteps.undoFailed"));

  const pill = PILL[v.verdict ?? "none"];
  const idle = busy === null;
  const errFor = (key: string) =>
    err && err.key === key ? <p className="mt-1 text-sm text-red-700">{err.msg}</p> : null;
  const checkBtn = (primary: boolean) => (
    <Button type="button" size="sm" variant={primary ? "default" : "outline"} onClick={check} disabled={!v.canCheck || !idle}>
      {busy === "check" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("overview.nextsteps.checkNow")}
    </Button>
  );
  const compact = v.verdict === "improved";

  return (
    <section id="next-steps-panel" aria-labelledby="next-steps-title" className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h3 id="next-steps-title" className="text-sm font-semibold text-slate-800">{t("overview.nextsteps.title")}</h3>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${pill.cls}`}>{t(pill.text)}</span>
        </div>
        {v.canCheck && !v.todo.some((td) => td.kind === "check") && checkBtn(false)}
      </div>

      <div className="space-y-3 px-4 py-3 text-sm text-slate-700">
        <div>
          <p className="font-medium text-slate-900">{v.headline}</p>
          {v.source && (
            <p className="mt-0.5 text-xs text-slate-500">
              {t("overview.nextsteps.sourceAt", { date: ddmmyyyy(v.source.at, intl) })}
              {v.source.from && v.source.to ? ` (${ddmmyyyy(v.source.from, intl)} → ${ddmmyyyy(v.source.to, intl)})` : ""}
              {v.source.kind === "check" ? ` (${t("overview.nextsteps.checkNow")})` : ""}
            </p>
          )}
        </div>

        {v.why.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-500">{t("overview.nextsteps.why")}</div>
            <ul className="divide-y divide-slate-50 rounded-lg border border-slate-100">
              {v.why.map((w) => (
                <li key={w.label} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-1.5">
                  <span>{w.label}</span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {w.before} → {w.after}
                    {w.change && (
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${w.tone === "bad" ? "bg-red-50 text-red-700" : w.tone === "good" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        {w.change}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-slate-500">{t("overview.nextsteps.ratioNote")}</p>
          </div>
        )}

        {!compact && v.newCauses.length > 0 && <CauseList title={t("overview.nextsteps.newCauses")} items={v.newCauses} />}
        {!compact && v.persistingCauses.length > 0 && <CauseList title={t("overview.nextsteps.persisting")} items={v.persistingCauses} small />}

        {!compact && (v.todo.length > 0 || v.undoable.length > 0) && (
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-500">{t("overview.nextsteps.todo")}</div>
            <ul className="space-y-2">
              {v.todo.map((td, i) => (
                <li key={`${td.kind}-${i}`} className="flex flex-col gap-1.5">
                  <span className="flex gap-2"><span aria-hidden="true">•</span><span>{td.text}</span></span>
                  {td.kind === "settings" && td.href && (
                    <a href={td.href} className="ml-4 text-sm font-medium text-blue-600 underline">{t("overview.nextsteps.openGoalPage")}</a>
                  )}
                  {td.kind === "check" && <div className="ml-4">{checkBtn(false)}{errFor("check")}</div>}
                  {td.kind === "reopen" && (
                    <div className="ml-4">
                      {confirm === "reopen" ? (
                        <ConfirmRow
                          text={t("overview.nextsteps.reopenConfirm")}
                          yes={t("overview.nextsteps.reopenYes")}
                          busy={busy === "reopen"}
                          busyText={t("overview.nextsteps.reopenBusy")}
                          disabled={!idle}
                          onYes={reopen}
                          onNo={() => setConfirm(null)}
                        />
                      ) : (
                        <Button type="button" size="sm" onClick={() => { setErr(null); setConfirm("reopen"); }} disabled={!v.canReopen || !idle}>
                          {t("overview.nextsteps.reopenBtn")}
                        </Button>
                      )}
                      {errFor("reopen")}
                    </div>
                  )}
                  {td.kind === "undo" && v.undoable.length > 0 && (
                    <ul className="ml-4 space-y-2">
                      {v.undoable.map((u) => {
                        const key = `undo:${u.executionId}` as const;
                        return (
                          <li key={u.executionId}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span>{ddmmyyyy(u.at, intl)} · {u.summary}</span>
                              {confirm !== key && (
                                <Button type="button" size="sm" variant="outline" onClick={() => { setErr(null); setConfirm(key); }} disabled={!idle}>{t("overview.nextsteps.undo")}</Button>
                              )}
                            </div>
                            {confirm === key && (
                              <ConfirmRow
                                text={t("overview.nextsteps.undoConfirm")}
                                yes={t("overview.nextsteps.undo")}
                                busy={busy === key}
                                busyText={t("overview.nextsteps.undoBusy")}
                                disabled={!idle}
                                onYes={() => undo(u.executionId)}
                                onNo={() => setConfirm(null)}
                              />
                            )}
                            {errFor(key)}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div aria-live="polite" className="min-h-0 text-sm">
          {busy === "check" && <p className="text-slate-500">{t("overview.nextsteps.checkBusy")}</p>}
          {err && <p className="text-red-700">{err.msg}</p>}
        </div>
      </div>
    </section>
  );
}

function CauseList({ title, items, small }: { title: string; items: { id: string; title: string; money: number | null }[]; small?: boolean }) {
  const intl = useIntlLocale();
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-slate-500">{title}</div>
      <ul className={`space-y-0.5 ${small ? "text-xs text-slate-500" : ""}`}>
        {items.map((x) => (
          <li key={x.id} className="flex justify-between gap-3">
            <span>{x.title}</span>
            {x.money !== null && <span className="tabular-nums">{vnd(x.money, intl)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfirmRow(p: { text: string; yes: string; busy: boolean; busyText: string; disabled: boolean; onYes: () => void; onNo: () => void }) {
  const t = useT();
  return (
    <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <p className="text-xs text-slate-700">{p.busy ? p.busyText : p.text}</p>
      <div className="mt-1.5 flex gap-2">
        <Button type="button" size="sm" onClick={p.onYes} disabled={p.disabled}>
          {p.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {p.yes}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={p.onNo} disabled={p.disabled}>{t("overview.nextsteps.cancel")}</Button>
      </div>
    </div>
  );
}
