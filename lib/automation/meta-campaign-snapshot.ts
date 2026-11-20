import crypto from "node:crypto";
import { snapshotCollectionWindow } from "./snapshot-window";
import { graphFetch } from "@/lib/meta-client";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";
import { allCompanyDefs } from "@/lib/companies/registry";

/** Read-only collector. Unknown/ambiguous company names fail closed (no MBC fallback). */
export async function collectMetaCampaignSnapshot(company: string, campaignId: string, from: string, to: string, now = new Date(), completedAt: () => Date = () => new Date()) {
  const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (!/^\d{1,25}$/.test(campaignId)) throw new Error("INVALID_CAMPAIGN_ID");
  if (!validDate(from) || !validDate(to) || from > to || Date.parse(to) - Date.parse(from) > 90 * 86400000 || to > now.toISOString().slice(0, 10)) throw new Error("INVALID_SNAPSHOT_RANGE");
  const accountId = (process.env.META_AD_ACCOUNT_ID ?? "").replace(/^act_/, "");
  const token = process.env.META_ACCESS_TOKEN;
  if (!/^\d+$/.test(accountId) || !token) throw new Error("ACCOUNT_NOT_CONFIGURED");
  const read = async (resource: string, params: Record<string, string>) => {
    const url = new URL(`${META_GRAPH_BASE}/${resource}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    // Keep the credential out of URLs and sanitized error responses.
    const response = await graphFetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json();
    if (!response.ok || !body || body.error) throw new Error("SNAPSHOT_UNAVAILABLE");
    return body;
  };
  const campaign = await read(campaignId, { fields: "id,name,account_id,status,daily_budget,lifetime_budget" });
  if (String(campaign.id) !== campaignId || String(campaign.account_id) !== accountId || typeof campaign.name !== "string") throw new Error("SNAPSHOT_SCOPE_MISMATCH");
  const name = campaign.name.toUpperCase();
  const matches = allCompanyDefs().filter(def => def.ads && (name.startsWith(`${def.id.toUpperCase()} -`) || name.startsWith(`${def.id.toUpperCase()}_`) || (def.match.campaignContains ?? []).some(term => name.includes(term.toUpperCase()))));
  if (matches.length !== 1 || matches[0].id !== company) throw new Error("SNAPSHOT_SCOPE_MISMATCH");
  const account = await read(`act_${accountId}`, { fields: "id,currency,timezone_name" });
  if (String(account.id).replace(/^act_/, "") !== accountId || typeof account.currency !== "string" || !account.currency || typeof account.timezone_name !== "string" || !account.timezone_name) throw new Error("INVALID_PROVIDER_SNAPSHOT");
  const numeric = (v: unknown) => {
    if ((typeof v !== "string" && typeof v !== "number") || v === "" || !Number.isFinite(Number(v)) || Number(v) < 0) throw new Error("INVALID_PROVIDER_SNAPSHOT");
    return Number(v);
  };
  const insights = await read(`${campaignId}/insights`, { fields: "campaign_id,spend,date_start,date_stop", time_range: JSON.stringify({ since: from, until: to }), time_increment: "1", limit: "100" });
  if (!Array.isArray(insights.data) || insights.paging?.next) throw new Error("INCOMPLETE_PROVIDER_SNAPSHOT");
  let spend = 0; const dates = new Set<string>();
  for (const row of insights.data) {
    if (String(row.campaign_id) !== campaignId || !validDate(row.date_start) || row.date_start !== row.date_stop || row.date_start < from || row.date_start > to || dates.has(row.date_start)) throw new Error("INVALID_PROVIDER_SNAPSHOT");
    dates.add(row.date_start); spend += numeric(row.spend);
  }
  const base = {
    provider: "meta", company, accountId, campaignId, name: campaign.name,
    currency: account.currency, timeZone: account.timezone_name, status: String(campaign.status),
    // Meta minor currency units vary by currency. Do not guess the divisor.
    budgetKind: campaign.daily_budget !== undefined ? "campaign_daily_budget_minor_units" : "adset_or_lifetime_budget",
    dailyBudgetMinorUnits: campaign.daily_budget !== undefined ? numeric(campaign.daily_budget) : null,
    spend: dates.size ? spend : null, observedDays: dates.size, from, to,
    ...snapshotCollectionWindow(now, completedAt()), approvable: false,
    missingSources: ["campaign_attributed_revenue", "approved_break_even_roas", "campaign_attribution_coverage", "verified_learning_status", "verified_budget_currency_unit"],
  };
  return { ...base, snapshotId: crypto.createHash("sha256").update(JSON.stringify(base)).digest("hex") };
}
