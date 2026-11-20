"use client";

import { useCallback, useEffect, useState } from "react";
import type { AutomationPolicy } from "@/lib/automation/policy";
import { useT } from "@/lib/i18n/client";

const fields = ["minBudget", "maxBudget", "maxIncreasePct", "maxDecreasePct", "cooldownHours", "minObservedDays", "minAttributionCoverage", "maxMutationsPerRun", "maxMutationsPerDay"] as const;
const limits: Record<typeof fields[number], { min: number; max: number; step: number }> = {
  minBudget: { min: 0, max: 1e12, step: 1 }, maxBudget: { min: 0, max: 1e12, step: 1 },
  maxIncreasePct: { min: 0, max: 100, step: 0.01 }, maxDecreasePct: { min: 0, max: 100, step: 0.01 },
  cooldownHours: { min: 0, max: 8760, step: 0.01 }, minObservedDays: { min: 3, max: 365, step: 1 },
  minAttributionCoverage: { min: 0, max: 1, step: 0.01 },
  maxMutationsPerRun: { min: 0, max: 1000, step: 1 }, maxMutationsPerDay: { min: 0, max: 10000, step: 1 },
};

export default function EvaluatorPolicyPanel() {
  const t = useT();
  const [policy, setPolicy] = useState<AutomationPolicy | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [protectedIds, setProtectedIds] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "saving" | "denied" | "error" | "conflict" | "saved">("loading");
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/automation/policy", { signal, cache: "no-store" });
      if (response.status === 403) { setState("denied"); return; }
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error("load");
      setPolicy(payload.policy);
      setValues(Object.fromEntries(fields.map(key => [key, String(payload.policy[key])])));
      setProtectedIds(payload.policy.protectedCampaignIds.join("\n"));
      setState("ready");
    } catch { if (!signal?.aborted) setState("error"); }
  }, []);
  useEffect(() => { const controller = new AbortController(); const timer = setTimeout(() => { void load(controller.signal); }, 0); return () => { clearTimeout(timer); controller.abort(); }; }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!policy) return;
    setState("saving");
    try {
      const response = await fetch("/api/automation/policy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: policy.version, policy: {
          ...policy, ...Object.fromEntries(fields.map(key => [key, values[key]?.trim() ? Number(values[key]) : null])),
          protectedCampaignIds: protectedIds.split("\n").map(id => id.trim()).filter(Boolean),
        } }),
      });
      const payload = await response.json();
      if (response.status === 409) { setState("conflict"); return; }
      if (response.status === 403) { setState("denied"); return; }
      if (!response.ok || !payload.success) throw new Error("save");
      setPolicy(payload.policy); setState("saved");
    } catch { setState("error"); }
  }

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4" aria-label={t("overview.policy.title")}>
    <div><h3 className="font-semibold text-slate-800">{t("overview.policy.title")}</h3><p className="mt-1 text-sm text-slate-500">{t("overview.policy.note")}</p></div>
    {state === "loading" && <p role="status">{t("overview.policy.loading")}</p>}
    {state === "denied" && <p>{t("overview.policy.denied")}</p>}
    {(state === "error" || state === "conflict") && <p role="alert" className="text-red-700">{t(state === "conflict" ? "overview.policy.conflict" : "overview.policy.error")}</p>}
    {state === "saved" && <p role="status" className="text-emerald-700">{t("overview.policy.saved")}</p>}
    {state !== "denied" && policy && <form onSubmit={save} className="space-y-4">
      <p className="text-xs text-slate-500">{t(policy.status === "draft" ? "overview.policy.draft" : "overview.policy.approved")} · {policy.version}</p>
      <fieldset disabled={state === "saving" || state === "conflict"} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 disabled:opacity-60">
        {fields.map(key => <label key={key} className="space-y-1 text-sm"><span>{t(`overview.policy.${key}`)}</span><input required type="number" step={limits[key].step} min={limits[key].min} max={limits[key].max} value={values[key] ?? ""} onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))} className="block w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-amber-500" /></label>)}
        <label className="space-y-1 text-sm sm:col-span-2"><span>{t("overview.policy.protected")}</span><textarea value={protectedIds} onChange={event => setProtectedIds(event.target.value)} rows={3} className="block w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-amber-500" /></label>
      </fieldset>
      <div className="flex gap-3"><button disabled={state === "saving" || state === "conflict"} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold disabled:opacity-50" type="submit">{t("overview.policy.save")}</button><button type="button" disabled={state === "saving"} onClick={() => void load()} className="rounded-lg border px-4 py-2 text-sm">{t("overview.policy.reload")}</button></div>
    </form>}
    {!policy && state === "error" && <button type="button" onClick={() => void load()}>{t("overview.policy.reload")}</button>}
  </section>;
}
