import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { isCompany } from "@/lib/companies/registry";
import { collectGoogleCampaignSnapshot } from "@/lib/automation/campaign-snapshot";
import { collectMetaCampaignSnapshot } from "@/lib/automation/meta-campaign-snapshot";
import { readAutomationPolicy } from "@/lib/automation/policy";
import { persistCampaignSnapshot } from "@/lib/automation/snapshot-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const query = request.nextUrl.searchParams;
  const company = query.get("company");
  if (!company || !isCompany(company)) return NextResponse.json({ success: false, error: "INVALID_COMPANY" }, { status: 400 });
  if (!canAccessCompany(user, company)) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  const provider = query.get("provider");
  if (provider !== "google" && provider !== "meta") return NextResponse.json({ success: false, error: "PROVIDER_NOT_SUPPORTED" }, { status: 400 });
  try {
    const collect = provider === "google" ? collectGoogleCampaignSnapshot : collectMetaCampaignSnapshot;
    const policyRevision = readAutomationPolicy().version;
    const snapshot = await collect(company, query.get("campaignId") ?? "", query.get("from") ?? "", query.get("to") ?? "");
    if (readAutomationPolicy().version !== policyRevision) return NextResponse.json({ success: false, error: "POLICY_CHANGED_DURING_COLLECTION" }, { status: 409 });
    const stored = await persistCampaignSnapshot(snapshot, { provider, company, accountId: snapshot.accountId, campaignId: snapshot.campaignId, policyRevision });
    return NextResponse.json({ success: true, mode: "read_only", mutationPerformed: false, snapshot, registryId: stored.registryId, policyRevision }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = ["INVALID_CAMPAIGN_ID", "INVALID_SNAPSHOT_RANGE"].includes(code) ? 400 : code === "CAMPAIGN_NOT_FOUND" ? 404 : 502;
    return NextResponse.json({ success: false, error: status === 502 ? "SNAPSHOT_UNAVAILABLE" : code }, { status });
  }
}
