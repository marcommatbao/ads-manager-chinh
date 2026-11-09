// ============================================================
// POST /api/creatives/sync-performance
//
// The "Sync hiệu suất" button in Creative AI Studio has always posted
// here; the route was never implemented, so the button always alerted
// "Sync thất bại".
//
// Pulls real ad-level insights from Meta for two adjacent 7-day windows
// and writes them onto every Creative Library entry that is linked to a
// real ad (`ad_id`). Creatives with no `ad_id` are reported as skipped —
// they have no live ad to measure, and inventing numbers for them is
// exactly what this endpoint must not do.
//
// fatigue_score is derived from lib/ad-fatigue-engine's real severity
// verdict on the two windows (see SEVERITY_SCORE) — it is a mapping of a
// rule outcome, not a separate model.
// ============================================================
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole, hasPermission } from "@/lib/permissions";
import { metaClient, initMetaClient, type MetaAdInsightRaw } from "@/lib/meta-client";
import {
  getAllCreatives,
  updateCreativePerformance,
  type CreativePerformance,
} from "@/lib/creative-tracker";
import { checkAdFatigue, type FatigueSeverity } from "@/lib/ad-fatigue-engine";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SEVERITY_SCORE: Record<FatigueSeverity, number> = { ok: 0, warning: 50, critical: 90 };

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().split("T")[0];
}

const num = (v: string | number | undefined): number => {
  const n = typeof v === "number" ? v : parseFloat(v ?? "0");
  return Number.isFinite(n) ? n : 0;
};

function leadsFrom(actions: MetaAdInsightRaw["actions"]): number {
  if (!actions) return 0;
  const types = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];
  return actions.filter((a) => types.includes(a.action_type)).reduce((s, a) => s + num(a.value), 0);
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền đồng bộ hiệu suất" }, { status: 403 });
  }

  const allowed = getCompaniesForRole(user);

  try {
    await initMetaClient();

    const current = { from: isoDaysAgo(7), to: isoDaysAgo(0) };
    const previous = { from: isoDaysAgo(14), to: isoDaysAgo(8) };

    const [currentRows, previousRows] = await Promise.all([
      metaClient.getAdInsightsWindowAggregate(current),
      metaClient.getAdInsightsWindowAggregate(previous),
    ]);

    const byAdCurrent = new Map(currentRows.map((r) => [r.ad_id, r]));
    const byAdPrevious = new Map(previousRows.map((r) => [r.ad_id, r]));

    const creatives = getAllCreatives().filter(
      (c) => c.company === null || allowed.includes(c.company),
    );

    let synced = 0;
    const skippedNoAdId: string[] = [];
    const skippedNoInsights: string[] = [];

    for (const c of creatives) {
      if (!c.ad_id) {
        skippedNoAdId.push(c.id);
        continue;
      }
      const now = byAdCurrent.get(c.ad_id);
      if (!now) {
        // Linked to an ad Meta reported no data for in this window.
        skippedNoInsights.push(c.id);
        continue;
      }
      const before = byAdPrevious.get(c.ad_id);

      const impressions = num(now.impressions);
      const clicks = num(now.clicks);
      const spend = num(now.spend);
      const ctr = num(now.ctr);
      const frequency = num(now.frequency);

      const leadsNow = leadsFrom(now.actions);
      const leadsPrev = leadsFrom(before?.actions);
      const spendPrev = num(before?.spend);

      const fatigue = checkAdFatigue({
        frequency,
        ctrCurrent: ctr,
        ctrPrevious: num(before?.ctr),
        cplCurrent: leadsNow > 0 ? spend / leadsNow : 0,
        cplPrevious: leadsPrev > 0 ? spendPrev / leadsPrev : 0,
        spend,
        company: c.company ?? "MBC",
      });

      const performance: CreativePerformance = {
        impressions,
        clicks,
        ctr,
        cpc: clicks > 0 ? spend / clicks : 0,
        spend,
        frequency,
        fatigue_score: SEVERITY_SCORE[fatigue.severity],
        date_start: now.date_start ?? current.from,
        date_stop: now.date_stop ?? current.to,
      };

      const updated = await updateCreativePerformance(c.id, performance);
      if (updated) synced++;
    }

    return NextResponse.json({
      success: true,
      synced,
      total: creatives.length,
      // Report the gaps explicitly so "synced 3/40" is explainable rather
      // than looking like a partial failure.
      skipped: {
        noAdId: skippedNoAdId.length,
        noInsights: skippedNoInsights.length,
      },
      windows: { current, previous },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync thất bại";
    console.error("[creatives/sync-performance]", err);
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 502 });
  }
}
