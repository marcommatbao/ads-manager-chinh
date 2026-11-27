"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/client";
import type { BriefDraft } from "@/lib/creative-brief/types";
import { BriefPreview } from "./BriefPreview";

export function BriefReviewPanel({ draft, canEdit, onChange }: { draft: BriefDraft; canEdit: boolean; onChange: (draft: BriefDraft) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usp, setUsp] = useState(draft.output?.usp ?? "");
  const [value, setValue] = useState(draft.output?.valueProposition ?? "");
  const dirty = usp !== draft.output?.usp || value !== draft.output?.valueProposition;
  async function act(action: "review" | "edit") {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/creative/brief/${encodeURIComponent(draft.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, company: draft.input.company, expectedRevision: draft.revision, contentHash: draft.contentHash, usp, valueProposition: value }),
      });
      const json = await res.json();
      if (!res.ok || !json.success || !json.data?.draft) throw new Error(String(res.status));
      onChange(json.data.draft); setOpen(false); setChecked(false);
    } catch { setError(t("creative.briefReview.error")); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
    <p role="status" className="text-sm font-semibold">{t("creative.briefReview.revision", { n: draft.revision ?? 0 })} · {t(draft.review ? "creative.briefReview.reviewed" : "creative.briefReview.unreviewed")}</p>
    <p className="break-all text-xs text-slate-500">{draft.id} / {draft.contentHash}</p>
    {draft.review && <p className="text-xs">{draft.review.actorId} · {draft.review.reviewedAt}</p>}
    <p className="text-xs text-slate-500">{t("creative.briefReview.caveat")}</p>
    {canEdit && draft.output && <>
      <label className="block text-xs">{t("creative.briefReview.usp")}<Input maxLength={4000} value={usp} disabled={busy} onChange={e => setUsp(e.target.value)} /></label>
      <label className="block text-xs">{t("creative.briefReview.value")}<Input maxLength={4000} value={value} disabled={busy} onChange={e => setValue(e.target.value)} /></label>
      {dirty && <p className="text-xs" role="status">{t("creative.briefReview.unsaved")}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !dirty || !usp.trim() || !value.trim()} onClick={() => void act("edit")}>{t("creative.briefReview.save")}</Button>
        <Button variant="outline" disabled={busy || dirty || !!draft.review} onClick={() => { setChecked(false); setOpen(true); }}>{t("creative.briefReview.review")}</Button>
      </div>
    </>}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    <details><summary className="cursor-pointer text-xs">{t("creative.briefReview.history")}</summary>
      {draft.history?.map(r => <details key={r.revision} className="mt-2 border-t pt-2">
        <summary className="cursor-pointer text-xs">{t("creative.briefReview.revision", { n: r.revision })} · {t(r.review ? "creative.briefReview.reviewed" : "creative.briefReview.unreviewed")}</summary>
        <p className="break-all text-xs">{r.contentHash}</p>
        {r.review && <p className="text-xs">{r.review.actorId} · {r.review.reviewedAt}</p>}
        {r.output && <BriefPreview brief={r.output} />}
      </details>)}
    </details>
    <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
      <DialogContent><DialogHeader>
        <DialogTitle>{t("creative.briefReview.review")}</DialogTitle>
        <DialogDescription>{t("creative.briefReview.confirm")}</DialogDescription>
      </DialogHeader>
        <p className="break-all text-xs">{t("creative.briefReview.revision", { n: draft.revision ?? 0 })} / {draft.contentHash}</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} disabled={busy} onChange={e => setChecked(e.target.checked)} />{t("creative.briefReview.check")}</label>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{t("creative.briefReview.cancel")}</Button><Button disabled={!checked || busy || dirty} onClick={() => void act("review")}>{t("creative.briefReview.review")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
