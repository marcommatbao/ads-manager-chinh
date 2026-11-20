import { GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client";
import { readAutomationPolicy } from "./policy";
import { resolveCampaignSnapshot, type SnapshotBinding } from "./snapshot-store";

export interface SnapshotReference {
  registryId: string;
  provider: "google" | "meta";
  company: string;
  campaignId: string;
}

/** All account/revision values originate from current server configuration. */
export function resolveCurrentSnapshot(reference: SnapshotReference, now = new Date()) {
  const policy = readAutomationPolicy();
  const accountId = reference.provider === "google"
    ? GOOGLE_CUSTOMER_IDS[reference.company]?.replace(/-/g, "")
    : process.env.META_AD_ACCOUNT_ID?.replace(/^act_/, "");
  if (!accountId || !/^\d+$/.test(accountId)) throw new Error("ACCOUNT_NOT_CONFIGURED");
  const binding: SnapshotBinding = {
    provider: reference.provider, company: reference.company,
    campaignId: reference.campaignId, accountId, policyRevision: policy.version,
  };
  return { snapshot: resolveCampaignSnapshot(reference.registryId, binding, now), policy };
}
