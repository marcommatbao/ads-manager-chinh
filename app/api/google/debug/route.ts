// GET /api/google/debug — scoped, live Google Ads read evidence (not OAuth-save status).
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { googleAdsClient } from "@/lib/google-client";
import { guardViewCredentials } from "@/lib/settings/guards";
import { canAccessCompany } from "@/lib/permissions";
import { companyIds } from "@/lib/companies";
import { envSatisfied } from "@/lib/connect/env-satisfied";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const guard = guardViewCredentials(user);
  if (guard) return guard;
  const companies = companyIds().filter(id => canAccessCompany(user, id));
  if (!companies.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const configured = {
    clientId: envSatisfied("GOOGLE_ADS_CLIENT_ID"),
    clientSecret: envSatisfied("GOOGLE_ADS_CLIENT_SECRET"),
    refreshToken: envSatisfied("GOOGLE_ADS_REFRESH_TOKEN"),
  };
  if (!configured.clientId || !configured.clientSecret || !configured.refreshToken) {
    return NextResponse.json({ ok: false, status: "missing_config", configured, reason: "missing_credentials", accounts: [] });
  }
  try {
    const to = new Date().toISOString().split("T")[0];
    const from = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    const result = await googleAdsClient.getAccountBreakdownResult({ from, to }, companies);
    const complete = result.attempted > 0 && result.accounts.length === result.attempted && !result.errors.length;
    const status = complete ? "account_readable" : result.accounts.length ? "partial" : result.errors.length ? "failed" : "unverified";
    return NextResponse.json({
      ok: complete, status, configured,
      reason: complete ? "read_succeeded" : status === "partial" ? "some_account_reads_failed" : status === "failed" ? "account_reads_failed" : "no_verified_accounts",
      accounts: result.accounts.map(a => ({ id: a.accountId, name: a.accountName })),
      // Never forward legacy provider messages: they can contain OAuth payloads.
      failures: result.errors.map(e => ({ id: e.accountId, reason: "account_read_failed" })),
    });
  } catch {
    return NextResponse.json({ ok: false, status: "failed", configured, reason: "provider_read_failed", accounts: [] }, { status: 502 });
  }
}
