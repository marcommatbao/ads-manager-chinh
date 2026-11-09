// ============================================================
// GET /api/automation/simulate/candidates
//
// Returns all safe_for_auto_apply candidates (and optionally
// manual_review_required items) aggregated across recent
// simulation runs. Useful for a "pending auto-apply" view
// or a pre-flight check before triggering the cron.
//
// Query params:
//   ?ruleId=<id>        filter by rule (optional)
//   ?status=safe        "safe" | "manual" | "blocked" | "all" (default: "safe")
//   ?limit=50           max items returned (1–200, default 50)
//   ?includeBlocked=1   also include blocked items in response (default false)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import { getRuns } from "@/lib/automation-sim/store";
import type { SimulationItem, SimulationStatus, SimCompany } from "@/lib/automation-sim/types";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_PARAM: Record<string, SimulationStatus[]> = {
  safe:    ["safe_for_auto_apply"],
  manual:  ["manual_review_required"],
  blocked: ["blocked"],
  all:     ["safe_for_auto_apply", "manual_review_required", "blocked", "simulate_only"],
};

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const url            = new URL(request.url);
  const ruleId         = url.searchParams.get("ruleId") ?? undefined;
  const statusParam    = url.searchParams.get("status") ?? "safe";
  const limit          = Math.min(Math.max(1, Number(url.searchParams.get("limit") ?? "50")), 200);
  const includeBlocked = url.searchParams.get("includeBlocked") === "1";

  const allowedStatuses: Set<SimulationStatus> = new Set(STATUS_PARAM[statusParam] ?? STATUS_PARAM.safe);
  if (includeBlocked) allowedStatuses.add("blocked");

  try {
    // Company-scope: only show items the current user can see
    const allowedCompanies = new Set(getCompaniesForRole(user) as SimCompany[]);

    let runs = getRuns(30);
    if (ruleId) runs = runs.filter(r => r.ruleId === ruleId);

    // Deduplicate by entityId — keep the most recent simulation result per entity
    const seen = new Set<string>();
    const items: SimulationItem[] = [];

    for (const run of runs) {
      for (const item of run.items) {
        if (!allowedStatuses.has(item.simulationStatus)) continue;
        if (item.company && !allowedCompanies.has(item.company)) continue;
        const key = `${item.ruleId}::${item.entityId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
        if (items.length >= limit) break;
      }
      if (items.length >= limit) break;
    }

    // Summary totals from the collected set
    const summary = {
      safeCount:         items.filter(i => i.simulationStatus === "safe_for_auto_apply").length,
      manualReviewCount: items.filter(i => i.simulationStatus === "manual_review_required").length,
      blockedCount:      items.filter(i => i.simulationStatus === "blocked").length,
      simulateOnlyCount: items.filter(i => i.simulationStatus === "simulate_only").length,
      estTotalImpactVnd: items.reduce((s, i) => s + i.estMonthlySavingsVnd, 0),
    };

    // Separate into typed buckets for caller convenience
    const candidates   = items.filter(i => i.simulationStatus === "safe_for_auto_apply");
    const blockedItems = items.filter(i => i.simulationStatus === "blocked");

    return NextResponse.json({
      success: true,
      data: {
        summary,
        candidates,
        blockedItems,
        items,
        generatedAt: new Date().toISOString(),
        filter: { ruleId, status: statusParam, limit },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /api/automation/simulate/candidates]", message);
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 500 });
  }
}
