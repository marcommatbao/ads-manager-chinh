"use client";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

type Approval = { approvalId: string; company: string; campaignId: string; status: "approved" | "expired" | "consumed" | "revoked"; expiresAt: string; revokedAt: string | null; outcome: string | null; canRevoke: boolean };
export default function ApprovalLifecyclePanel() {
  const { user, loading } = useSession();
  const t = useT(); const locale = useIntlLocale();
  const [rows, setRows] = useState<Approval[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error" | "denied">("loading");
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<Approval | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"done" | "conflict" | "saveError" | null>(null);
  const [stale, setStale] = useState(false);
  const load = useCallback((signal: AbortSignal) => fetch("/api/automation/approvals", { signal, cache: "no-store" }).then(async response => {
    if (signal.aborted) return;
    if (response.status === 401 || response.status === 403) { setRows([]); setState("denied"); return; }
    const data = await response.json();
    if (!response.ok || !data.success || !Array.isArray(data.approvals)) throw new Error("load");
    if (!signal.aborted) { setRows(data.approvals); setState("ready"); setStale(false); }
  }).catch(() => { if (!signal.aborted) { setState("error"); setStale(true); } }), []);
  useEffect(() => {
    if (loading || user?.role !== "super_admin") return;
    const controller = new AbortController(); void load(controller.signal); return () => controller.abort();
  }, [user?.id, user?.role, loading, load, refresh]);
  const reload = () => { setState("loading"); setStale(true); setSelected(null); setNotice(null); setRefresh(x => x + 1); };
  async function revoke() {
    if (!selected || busy || stale) return;
    const approval = selected;
    setBusy(true);
    try {
      const query = new URLSearchParams({ approvalId: approval.approvalId, company: approval.company });
      const response = await fetch(`/api/automation/approvals?${query}`, { method: "DELETE" });
      if (response.status === 401 || response.status === 403) { setRows([]); setState("denied"); setStale(true); return; }
      if (response.status === 409 || response.status === 404) { setNotice("conflict"); setStale(true); return; }
      const data = await response.json();
      if (!response.ok || !data.success || data.approval?.approvalId !== approval.approvalId || data.approval.status !== "revoked") throw new Error("revoke");
      setRows(current => current.map(row => row.approvalId === approval.approvalId ? { ...row, status: "revoked", canRevoke: false, revokedAt: data.approval.revokedAt } : row));
      setNotice("done");
    } catch { setNotice("saveError"); setStale(true); }
    finally { setBusy(false); setSelected(null); }
  }
  if (!loading && user?.role !== "super_admin") return null;
  return <section aria-label={t("overview.approvals.title")} className="space-y-3 rounded-xl border bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{t("overview.approvals.title")}</h2><p className="text-sm text-slate-500">{t("overview.approvals.note")}</p></div><button type="button" disabled={busy} onClick={reload} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{t("overview.approvals.reload")}</button></div>
    {(loading || state === "loading") && <p role="status">{t("overview.approvals.loading")}</p>}
    {state === "error" && <p role="alert" className="text-red-700">{t("overview.approvals.error")}</p>}
    {state === "denied" && <p role="alert">{t("overview.approvals.denied")}</p>}
    {notice && <p role={notice === "done" ? "status" : "alert"} className={notice === "done" ? "text-emerald-700" : "text-red-700"}>{t(`overview.approvals.${notice}`)}</p>}
    {state === "ready" && !rows.length && <p className="text-sm text-slate-500">{t("overview.approvals.empty")}</p>}
    {state === "ready" && rows.map(row => <article key={row.approvalId} className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold break-all">{row.company} · {row.campaignId}</h3><span>{t(`overview.approvals.${row.status}`)}</span></div>
      <p className="break-all text-xs text-slate-500">{row.approvalId}</p>
      <p>{t("overview.approvals.expires")}: {new Date(row.expiresAt).toLocaleString(locale)}</p>
      {row.outcome && <p>{t("overview.approvals.outcome")}: {row.outcome === "needs_reconciliation" ? t("overview.approvals.reconcile") : row.outcome}</p>}
      {row.canRevoke && row.status === "approved" && <button type="button" disabled={busy || stale} onClick={() => { setNotice(null); setSelected(row); }} className="rounded-lg border border-red-300 px-3 py-2 text-red-700 disabled:opacity-50">{t("overview.approvals.revoke")}</button>}
    </article>)}
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open && !busy) setSelected(null); }}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{t("overview.approvals.question")}</DialogTitle><DialogDescription>{t("overview.approvals.warning")}</DialogDescription></DialogHeader>
        <p className="break-all text-sm">{selected?.company} · {selected?.campaignId}<br />{selected?.approvalId}</p>
        <DialogFooter><button type="button" disabled={busy} onClick={() => setSelected(null)} className="rounded-lg border px-3 py-2">{t("overview.approvals.cancel")}</button><button type="button" disabled={busy} onClick={() => void revoke()} className="rounded-lg bg-red-700 px-3 py-2 text-white disabled:opacity-50">{t("overview.approvals.confirm")}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
