"use client";
import { useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { resolveCompanyScope } from "@/lib/permissions";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import { evidenceMessageKey } from "@/lib/automation/evidence-labels";

type Snapshot = {
  registryId: string; policyRevision: string;
  snapshot: { provider: "google" | "meta"; company: string; campaignId: string; name: string; currency: string; dailyBudget?: number; dailyBudgetMinorUnits?: number | null; spend: number | null; observedDays: number; from: string; to: string; expiresAt: string; readAt?: string; collectedAt?: string; spendConsistency?: { status: "matched" | "mismatch" }; missingSources: string[] };
};
export default function CampaignSnapshotPanel({ onRecorded }: { onRecorded: () => void }) {
  const t = useT(); const locale = useIntlLocale(); const { user, loading } = useSession();
  const allowed = resolveCompanyScope(user?.companies, user?.role);
  const [result, setResult] = useState<Snapshot | null>(null);
  const [state, setState] = useState<"idle" | "reading" | "saving" | "error" | "expired" | "recorded" | "unit">("idle");
  const busy = state === "reading" || state === "saving";
  async function read(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const key of ["company", "provider", "campaignId", "from", "to"]) params.set(key, String(form.get(key) ?? ""));
    setResult(null); setState("reading");
    try {
      const response = await fetch(`/api/automation/snapshot?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success || !data.registryId) throw new Error("snapshot");
      setResult(data); setState("idle");
    } catch { setState("error"); }
  }
  async function record() {
    if (!result) return;
    if (Date.parse(result.snapshot.expiresAt) <= Date.now()) { setState("expired"); return; }
    setState("saving");
    try {
      const { provider, company, campaignId } = result.snapshot;
      const response = await fetch("/api/automation/decisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registryId: result.registryId, provider, company, campaignId }) });
      const payload = await response.json();
      if (!response.ok) { setState(payload.error === "BUDGET_UNIT_OR_VALUE_UNVERIFIED" ? "unit" : response.status === 409 ? "expired" : "error"); return; }
      if (!payload.success) throw new Error("decision");
      setState("recorded"); onRecorded();
    } catch { setState("error"); }
  }
  return <section className="space-y-3 rounded-xl border bg-white p-4" aria-label={t("overview.snapshot.title")}>
    <h2 className="font-semibold">{t("overview.snapshot.title")}</h2><p className="text-sm text-slate-500">{t("overview.snapshot.note")}</p>
    {loading ? <p role="status">{t("overview.decisions.loading")}</p> : !allowed.length ? <p>{t("overview.snapshot.scope")}</p> : <form onSubmit={read}>
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">{t("overview.snapshot.company")}<select name="company" className="mt-1 block w-full rounded border p-2">{allowed.map(id => <option key={id}>{id}</option>)}</select></label>
        <label className="text-sm">{t("overview.snapshot.provider")}<select name="provider" className="mt-1 block w-full rounded border p-2"><option value="google">Google Ads</option><option value="meta">Meta Ads</option></select></label>
        <label className="text-sm">{t("overview.snapshot.campaign")}<input name="campaignId" required pattern="[0-9]{1,25}" inputMode="numeric" className="mt-1 block w-full rounded border p-2" /></label>
        <label className="text-sm">{t("overview.snapshot.from")}<input name="from" type="date" required className="mt-1 block w-full rounded border p-2" /></label>
        <label className="text-sm">{t("overview.snapshot.to")}<input name="to" type="date" required className="mt-1 block w-full rounded border p-2" /></label>
        <button type="submit" className="self-end rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold disabled:opacity-50">{t(busy ? "overview.snapshot.busy" : "overview.snapshot.read")}</button>
      </fieldset>
    </form>}
    {["error", "expired", "unit"].includes(state) && <p role="alert" className="text-sm text-red-700">{t(state === "expired" ? "overview.snapshot.expired" : state === "unit" ? "overview.snapshot.unknownUnit" : "overview.snapshot.error")}</p>}
    {state === "recorded" && <p role="status" className="text-sm text-emerald-700">{t("overview.snapshot.created")}</p>}
    {result && <div className="space-y-2 border-t pt-3 text-sm">
      <h3 className="break-all font-semibold">{result.snapshot.company} · {result.snapshot.name}</h3>
      <p>{result.snapshot.from} → {result.snapshot.to} · {result.snapshot.currency}</p>
      <p>{t("overview.snapshot.spend")}: {result.snapshot.spend === null ? "—" : result.snapshot.spend.toLocaleString(locale)} {result.snapshot.currency}</p>
      <p>{t("overview.snapshot.budget")}: {result.snapshot.provider === "google" && result.snapshot.dailyBudget !== undefined ? `${result.snapshot.dailyBudget.toLocaleString(locale)} ${result.snapshot.currency}` : "—"}</p>
      <p>{t("overview.snapshot.observed")}: {result.snapshot.observedDays}</p>
      <p>{t("overview.snapshot.expires")}: {new Date(result.snapshot.expiresAt).toLocaleString(locale)}</p>
      <p className="break-all text-xs">{t("overview.observation.registry")}: <code>{result.registryId}</code></p>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <h4 className="font-medium">{t("overview.snapshot.missing")}</h4>
        <ul className="mt-2 list-inside list-disc space-y-2">{[...new Set(result.snapshot.missingSources)].map(source => <li key={source}>{t(evidenceMessageKey(source))}<details className="ml-4 text-xs text-slate-500"><summary className="cursor-pointer">{t("overview.evidence.code")}</summary><code className="break-all">{source}</code></details></li>)}</ul>
      </div>
      {result.snapshot.readAt && <p className="text-xs text-slate-500">{t("overview.evidence.readAt")}: {new Date(result.snapshot.readAt).toLocaleString(locale)}</p>}
      {result.snapshot.collectedAt && <p className="text-xs text-slate-500">{t("overview.evidence.collectedAt")}: {new Date(result.snapshot.collectedAt).toLocaleString(locale)}</p>}
      {result.snapshot.spendConsistency && <p className={result.snapshot.spendConsistency.status === "matched" ? "text-emerald-700" : "text-red-700"}>{t(result.snapshot.spendConsistency.status === "matched" ? "overview.evidence.consistencyMatched" : "overview.evidence.consistencyMismatch")}</p>}
      <button type="button" disabled={busy || state === "recorded" || result.snapshot.provider !== "google"} onClick={() => void record()} className="rounded-lg border px-3 py-2 disabled:opacity-50">{t("overview.snapshot.create")}</button>
    </div>}
  </section>;
}
