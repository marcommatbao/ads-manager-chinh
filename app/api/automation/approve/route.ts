import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import { persistApproval } from "@/lib/automation/approval-store";
import { recentDecisionAudits } from "@/lib/automation/decision-audit";
import { resolveCurrentSnapshot } from "@/lib/automation/snapshot-consumer";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (user.role !== "super_admin") return NextResponse.json({ success: false, error: "Approval role required" }, { status: 403 });
  let body: { decisionId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_DECISION_ID" }, { status: 400 }); }
  if (!body || typeof body.decisionId !== "string" || !body.decisionId || body.decisionId.length > 100) return NextResponse.json({ error: "INVALID_DECISION_ID" }, { status: 400 });
  try {
    const stored = recentDecisionAudits(2000).find(row => row.mode === "dry_run" && row.decisionId === body.decisionId);
    if (!stored?.binding || !stored.snapshotRegistryId || !stored.snapshotPayloadHash || !stored.expiresAt) return NextResponse.json({ error: "DECISION_REFRESH_REQUIRED" }, { status: 409 });
    if (!getCompaniesForRole(user).includes(stored.company)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { snapshot, policy } = resolveCurrentSnapshot({ registryId: stored.snapshotRegistryId, provider: stored.binding.provider, company: stored.company, campaignId: stored.campaignId });
    if (snapshot.payloadHash !== stored.snapshotPayloadHash || JSON.stringify(snapshot.binding) !== JSON.stringify(stored.binding) || !Number.isFinite(Date.parse(stored.expiresAt)) || Date.parse(stored.expiresAt) <= Date.now()) return NextResponse.json({ error: "DECISION_REFRESH_REQUIRED" }, { status: 409 });
    if (!snapshot.payload.approvable || stored.action === "blocked" || stored.action === "hold" || !policy.globalEnabled || policy.protectedCampaignIds.includes(stored.campaignId)) return NextResponse.json({ error: "DECISION_NOT_APPROVABLE" }, { status: 409 });
    const approval = await persistApproval(stored, user.id);
    return NextResponse.json({ success: true, mode: "approval_only", mutationPerformed: false, approval });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    const conflict = reason.startsWith("SNAPSHOT_") || reason === "ACCOUNT_NOT_CONFIGURED" || reason === "DECISION_ALREADY_APPROVED";
    return NextResponse.json({ error: conflict ? "DECISION_REFRESH_REQUIRED" : "APPROVAL_UNAVAILABLE" }, { status: conflict ? 409 : 503 });
  }
}
