// ============================================================
// GET  /api/automation/auto-apply?company=MBC — preview what would run
// POST /api/automation/auto-apply              — run it (dryRun or real)
//
// Both share lib/auto-apply-runner with the nightly cron, so the preview
// count is literally the set the cron would act on — not a separate
// estimate that can drift from it.
// ============================================================
import { getT } from "@/lib/i18n/server";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany, hasPermission } from "@/lib/permissions";
import {
  fetchAutoApplyCandidates,
  applyCandidates,
  sumImpact,
  splitByEnabledRules,
} from "@/lib/auto-apply-runner";
import { effectiveMode, type Company } from "@/lib/auto-apply-settings";
import { isCompany } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseCompany(value: string | null): Company | null {
  return isCompany(value) ? value : null;
}

export async function GET(request: NextRequest) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const company = parseCompany(request.nextUrl.searchParams.get("company"));
  if (!company) return NextResponse.json({ error: t("libcase.r.aa.1") }, { status: 400 });
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
  }

  try {
    // Report every auto-appliable candidate, then show how many the current
    // rule toggles would actually let run — a candidate held back by a
    // disabled toggle stays visible instead of vanishing from the count.
    const all = await fetchAutoApplyCandidates(company, false);
    const { eligible, blocked } = splitByEnabledRules(company, all);

    return NextResponse.json({
      success: true,
      company,
      mode: effectiveMode(company),
      pendingCount: all.length,
      eligibleCount: eligible.length,
      blockedCount: blocked.length,
      totalSavings: sumImpact(eligible),
      potentialSavings: sumImpact(all),
      candidates: all.map((c) => ({
        id: c.id,
        type: c.type,
        title: c.title,
        priority: c.priority,
        action: c.applyPayload?.action,
        impactValue: c.impactValue ?? 0,
        impactRough: c.impactRough === true,
        ruleEnabled: eligible.includes(c),
      })),
    });
  } catch (err) {
    // Surface the real reason instead of rendering an empty "0 pending"
    // state that looks like "nothing to do".
    const message = err instanceof Error ? err.message : String(err);
    console.error("[automation/auto-apply GET]", err);
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ error: t("libcase.r.aa.2") }, { status: 403 });
  }

  let body: { company?: string; dryRun?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const company = parseCompany(body.company ?? null);
  if (!company) return NextResponse.json({ error: t("libcase.r.aa.1") }, { status: 400 });
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
  }

  // Default to the safe path: only mutate when the caller explicitly says so.
  const dryRun = body.dryRun !== false;

  try {
    const all = await fetchAutoApplyCandidates(company, false);
    const { eligible, blocked } = splitByEnabledRules(company, all);

    if (dryRun) {
      return NextResponse.json({
        success: true,
        company,
        dryRun: true,
        applied: eligible.length,     // count that WOULD be applied
        savings: sumImpact(eligible),
        failed: 0,
        blocked: blocked.length,
      });
    }

    const result = await applyCandidates(company, eligible);
    return NextResponse.json({
      success: true,
      company,
      dryRun: false,
      applied: result.applied.length,
      savings: result.savings,
      failed: result.failed.length,
      failures: result.failed,
      blocked: blocked.length,
      triggeredBy: user.email,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[automation/auto-apply POST]", err);
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 502 });
  }
}
