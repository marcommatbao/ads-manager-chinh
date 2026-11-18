import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import { evaluateBudgetDecision, type BudgetDecisionInput } from "@/lib/automation/profit-evaluator";
import { recordDecision } from "@/lib/automation/decision-audit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  let body: Partial<BudgetDecisionInput>;
  try { body = await request.json() as Partial<BudgetDecisionInput>; } catch { return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 }); }
  if (!body.company || !getCompaniesForRole(user).includes(body.company)) return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  if (!body.campaignId || !body.currentBudget || !body.dailySpend || !body.roas || !body.breakEvenRoas || !body.attributionCoverage) {
    return NextResponse.json({ success: false, error: "Thiếu snapshot/field bắt buộc cho dry-run" }, { status: 400 });
  }
  const input = body as BudgetDecisionInput;
  const decision = evaluateBudgetDecision(input);
  const audit = recordDecision(decision, "dry_run");
  return NextResponse.json({ success: true, mode: "dry_run", mutationPerformed: false, decision: audit });
}
