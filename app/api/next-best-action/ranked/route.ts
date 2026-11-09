// ============================================================
// GET /api/next-best-action/ranked
//
// Company-level ranked recommendation view with memory-enriched
// confidence scores and supporting evidence from decision history.
//
// Returns top N recommendations per company, sorted by memory-
// adjusted priority score, with:
//   - supportingMemories: past similar decisions and their outcomes
//   - memoryConfidence: confidence adjusted by learned signals
//   - memoryBlockNote: warning if similar actions failed recently
//
// Filters: ?company= (required) &platform= &limit= &executionMode=
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import { queryFor } from "@/lib/nba/store";
import { enrichWithMemory } from "@/lib/nba/memory-bridge";
import { checkAutoApplySafety } from "@/lib/decision-memory/query";
import type { NbaCompany } from "@/lib/nba/types";
import type { EnrichedRecommendation } from "@/lib/nba/memory-bridge";
import { isCompany } from "@/lib/companies"

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const company  = searchParams.get("company") as NbaCompany | null;
  const platform = searchParams.get("platform") ?? undefined;
  const limit    = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? "20")));
  const execMode = searchParams.get("executionMode") ?? undefined;

  if (!company || !isCompany(company)) {
    return NextResponse.json({ error: "Thiếu công ty" }, { status: 400 });
  }

  const allowed = getCompaniesForRole(user);
  if (!allowed.includes(company)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
  }

  // Pull active recommendations from NBA store
  const raw = queryFor([company]);

  // Filter by platform if requested
  const platFiltered = platform ? raw.filter(r => r.platform === platform) : raw;

  // Enrich with decision memory signals
  const enriched = enrichWithMemory(platFiltered, company);

  // Apply memory-based safety gate: flag recs where auto-apply is blocked
  const withSafety: (EnrichedRecommendation & { autoApplyBlocked?: boolean; autoApplyBlockNote?: string })[] =
    enriched.map(rec => {
      if (rec.actionMode !== "auto_apply_eligible") return rec;
      const safety = checkAutoApplySafety(
        rec.reasonCode === "SCALE_WINNER" ? "budget.increase"
        : rec.reasonCode === "CPL_CRITICAL" || rec.reasonCode === "CPL_WARNING" ? "budget.decrease"
        : "automation.rule_applied",
        rec.entityId,
        rec.entityType,
        company,
      );
      return {
        ...rec,
        autoApplyBlocked:   safety.blocked,
        autoApplyBlockNote: safety.blocked ? safety.reason : safety.warnNote,
      };
    });

  // Filter execution mode
  const filtered = execMode
    ? withSafety.filter(r => r.executionMode === execMode || r.actionMode === execMode)
    : withSafety;

  // Sort by memory-adjusted priority (highest first)
  const sorted = filtered.sort((a, b) => (b.scores.priority ?? 0) - (a.scores.priority ?? 0));

  const top = sorted.slice(0, limit);

  // Summary stats
  const summary = {
    total:          filtered.length,
    returned:       top.length,
    byType:         tally(top, r => r.recommendationType),
    blocked:        top.filter(r => r.autoApplyBlocked).length,
    memoryWarnings: top.filter(r => r.memoryBlockNote).length,
    avgConfidence:  top.length
      ? Math.round(top.reduce((s, r) => s + (r.memoryConfidence ?? r.confidenceScore), 0) / top.length)
      : 0,
  };

  return NextResponse.json({ success: true, data: { company, recommendations: top, summary } });
}

function tally(items: EnrichedRecommendation[], pick: (r: EnrichedRecommendation) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of items) { const k = pick(r); out[k] = (out[k] ?? 0) + 1; }
  return out;
}
