import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany, getCompaniesForRole } from "@/lib/permissions";
import { isCompany } from "@/lib/companies/registry";
import { resolveCurrentSnapshot } from "@/lib/automation/snapshot-consumer";
import { recordDecision, recentDecisionAudits } from "@/lib/automation/decision-audit";
import type { BudgetDecision } from "@/lib/automation/profit-evaluator";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_REFERENCE" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.registryId !== "string" || body.registryId.length > 100 || !body.registryId || typeof body.campaignId !== "string" || !/^\d{1,25}$/.test(body.campaignId) || (body.provider !== "google" && body.provider !== "meta") || typeof body.company !== "string" || !isCompany(body.company)) return NextResponse.json({ error: "INVALID_REFERENCE" }, { status: 400 });
  if (!canAccessCompany(user, body.company)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { snapshot } = resolveCurrentSnapshot({ registryId: body.registryId, campaignId: body.campaignId, company: body.company, provider: body.provider });
    // Current collectors do not yet provide approved profit/attribution/learning
    // evidence. Persist an honest blocked decision, never use request metrics.
    const payload = snapshot.payload as unknown as { dailyBudget?: unknown; currency?: unknown; budgetKind?: unknown };
    if (typeof payload.currency !== "string" || !/^[A-Z]{3}$/.test(payload.currency) || payload.budgetKind !== "campaign_daily_budget" || snapshot.binding.provider !== "google" || typeof payload.dailyBudget !== "number" || !Number.isFinite(payload.dailyBudget) || payload.dailyBudget <= 0) return NextResponse.json({ error: "BUDGET_UNIT_OR_VALUE_UNVERIFIED", approvable: false }, { status: 409 });
    const decision: BudgetDecision = {
      idempotencyKey: `snapshot:${snapshot.registryId}`, company: snapshot.binding.company,
      campaignId: snapshot.binding.campaignId, campaignName: snapshot.binding.campaignId,
      currentBudget: payload.dailyBudget, proposedBudget: null, delta: null, action: "blocked",
      confidence: "insufficient", reasonCode: "snapshot_not_approvable",
      reason: "Snapshot chưa đủ nguồn nghiệp vụ để tạo đề xuất có thể duyệt.",
      requiresApproval: true, sourceRefs: [snapshot.registryId, snapshot.payloadHash],
    };
    const audit = recordDecision(decision, "dry_run", {
      snapshotRegistryId: snapshot.registryId, snapshotPayloadHash: snapshot.payloadHash,
      binding: snapshot.binding, expiresAt: snapshot.payload.expiresAt,
      currency: payload.currency, budgetKind: payload.budgetKind,
    });
    return NextResponse.json({ success: true, mutationPerformed: false, approvable: false, decision: audit }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const conflict = ["SNAPSHOT_NOT_FOUND", "SNAPSHOT_BINDING_MISMATCH", "SNAPSHOT_EXPIRED_OR_INVALID", "SNAPSHOT_INTEGRITY_FAILED", "ACCOUNT_NOT_CONFIGURED"].includes(code);
    return NextResponse.json({ error: conflict ? "SNAPSHOT_REFRESH_REQUIRED" : "DECISION_UNAVAILABLE" }, { status: conflict ? 409 : 503 });
  }
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const company = request.nextUrl.searchParams.get("company");
  const allowed = getCompaniesForRole(user);
  if (company && (!isCompany(company) || !allowed.includes(company))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const decisions = recentDecisionAudits(2000)
      .filter(row => allowed.includes(row.company) && (!company || row.company === company))
      .slice(0, 100)
      .map(row => ({
        decisionId: row.decisionId ?? null, company: row.company, campaignId: row.campaignId,
        campaignName: row.campaignName, action: row.action, mode: row.mode,
        currentBudget: row.currentBudget, proposedBudget: row.proposedBudget,
        confidence: row.confidence, reasonCode: row.reasonCode,
        createdAt: row.createdAt, expiresAt: row.expiresAt ?? null,
        provider: row.binding?.provider ?? null, policyRevision: row.binding?.policyRevision ?? null,
        // No approval button is offered by this read-only endpoint.
        mutationEnabled: false,
      }));
    return NextResponse.json({ success: true, decisions, limit: 100 }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "DECISION_HISTORY_UNAVAILABLE" }, { status: 503 });
  }
}
