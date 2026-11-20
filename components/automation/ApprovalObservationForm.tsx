"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { ReconciliationAssessment } from "@/lib/automation/reconciliation";

export default function ApprovalObservationForm({ approvalId, company, campaignId, onRecorded }: {
  approvalId: string; company: string; campaignId: string;
  onRecorded: (assessment: ReconciliationAssessment) => void;
}) {
  const t = useT();
  const [registryId, setRegistryId] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"saved" | "conflict" | "error" | "denied" | null>(null);
  const [locked, setLocked] = useState(false);
  async function record() {
    if (busy || locked) return;
    setBusy(true);
    try {
      const response = await fetch("/api/automation/approvals/observe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, company, registryId: registryId.trim() }),
      });
      if (response.status === 401 || response.status === 403) { setNotice("denied"); setLocked(true); return; }
      if (response.status === 404 || response.status === 409) { setNotice("conflict"); setLocked(true); return; }
      const data = await response.json();
      const a = data.assessment;
      if (!response.ok || !data.success || !a || !["matches_proposed", "matches_before", "different_value", "unverified"].includes(a.state) || a.executionProven !== false || a.retryAllowed !== false || a.undoAllowed !== false || typeof a.readAt !== "string" || !Number.isFinite(Date.parse(a.readAt))) throw new Error("Invalid observation response");
      setNotice("saved"); setLocked(true); onRecorded(a);
    } catch { setNotice("error"); setLocked(true); }
    finally { setBusy(false); setConfirm(false); }
  }
  return <div className="space-y-2 border-t pt-3">
    <form onSubmit={event => { event.preventDefault(); if (!locked && registryId.trim()) { setNotice(null); setConfirm(true); } }} className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 text-sm">{t("overview.observation.registry")}<input required maxLength={100} value={registryId} disabled={busy || locked} onChange={event => setRegistryId(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
      <button type="submit" disabled={busy || locked || !registryId.trim()} className="rounded-lg border px-3 py-2 disabled:opacity-50">{t("overview.observation.record")}</button>
    </form>
    <p className="text-xs text-slate-500">{t("overview.observation.help")}</p>
    {notice && <p role={notice === "saved" ? "status" : "alert"}>{t(`overview.observation.${notice}`)}</p>}
    <Dialog open={confirm} onOpenChange={open => { if (!busy) setConfirm(open); }}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{t("overview.observation.confirm")}</DialogTitle><DialogDescription>{t("overview.observation.warning")}</DialogDescription></DialogHeader>
        <p className="break-all">{company} · {campaignId}<br />{approvalId}<br />{registryId.trim()}</p>
        <DialogFooter><button type="button" disabled={busy} onClick={() => setConfirm(false)} className="rounded-lg border px-3 py-2">{t("overview.approvals.cancel")}</button><button type="button" disabled={busy} onClick={() => void record()} className="rounded-lg border px-3 py-2 disabled:opacity-50">{t("overview.observation.record")}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
