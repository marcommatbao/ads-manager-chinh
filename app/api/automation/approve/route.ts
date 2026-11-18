import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import { createApproval } from "@/lib/automation/approval";
import { recordDecision } from "@/lib/automation/decision-audit";
import type { BudgetDecision } from "@/lib/automation/profit-evaluator";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!(["admin", "manager", "super_admin"] as string[]).includes(user.role)) return NextResponse.json({ success: false, error: "Approval role required" }, { status: 403 });
  let decision: BudgetDecision;
  try { decision = await request.json() as BudgetDecision; } catch { return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 }); }
  if (!decision.company || !getCompaniesForRole(user).includes(decision.company)) return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  if (decision.action === "blocked" || decision.action === "hold" || !decision.requiresApproval) return NextResponse.json({ success: false, error: "Decision is not approvable" }, { status: 400 });
  const approval = createApproval(decision, user.id);
  recordDecision({ ...decision, reason: `${decision.reason} | approved:${approval.approvalId}` }, "evaluate");
  return NextResponse.json({ success: true, mode: "approval_only", mutationPerformed: false, approval });
}
