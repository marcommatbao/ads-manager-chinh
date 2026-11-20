import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import { evaluateBudgetDecision, type BudgetDecisionInput } from "@/lib/automation/profit-evaluator";
import { recordDecision } from "@/lib/automation/decision-audit";
import { readAutomationPolicy } from "@/lib/automation/policy";
import { validateSimulationInput } from "@/lib/automation/simulation-input";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  let body: ReturnType<typeof validateSimulationInput>;
  try { body = validateSimulationInput(await request.json()); } catch { return NextResponse.json({ success: false, error: "INVALID_SIMULATION" }, { status: 400 }); }
  if (!getCompaniesForRole(user).includes(body.company)) return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  const policy = readAutomationPolicy();
  const input: BudgetDecisionInput = {
    ...body,
    now: new Date(),
    policy,
    minBudget: policy.minBudget,
    maxBudget: policy.maxBudget,
    maxIncreasePct: policy.maxIncreasePct,
    maxDecreasePct: policy.maxDecreasePct,
    minAttributionCoverage: policy.minAttributionCoverage,
    cooldownHours: policy.cooldownHours,
  };
  const decision = evaluateBudgetDecision(input);
  const audit = recordDecision(decision, "simulation");
  return NextResponse.json({ success: true, mode: "dry_run", inputOrigin: "client_simulation", approvable: false, mutationPerformed: false, decision: audit });
}
