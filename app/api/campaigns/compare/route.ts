// ============================================================
// Campaigns Compare API
// GET  /api/campaigns/compare — list all A/B relationships
// POST /api/campaigns/compare — compare two campaigns via Meta API
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { metaClient } from "@/lib/meta-client";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { detectCompany } from "@/lib/company-detect";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";
import { friendlyError } from "@/lib/not-configured";

export const maxDuration = 60;

const RELATIONSHIPS_FILE = path.join(process.cwd(), "data", "campaign-relationships.json");

interface Relationship {
  original_campaign_id: string;
  clone_campaign_id: string;
  clone_reason: string;
  original_name?: string;
  clone_name?: string;
  created_at: string;
}

function readRelationships(): Relationship[] {
  try {
    const raw = fs.readFileSync(RELATIONSHIPS_FILE, "utf-8");
    return JSON.parse(raw) as Relationship[];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────
// GET — return all relationships
// ─────────────────────────────────────────────
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const relationships = readRelationships();
  return NextResponse.json({ success: true, data: relationships });
}

// ─────────────────────────────────────────────
// POST — compare two campaigns via Meta API
// ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { originalId: string; cloneId: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { originalId, cloneId } = body;
  if (!originalId || !cloneId) {
    return NextResponse.json({ success: false, error: "originalId and cloneId are required" }, { status: 400 });
  }

  try {
    const relationships = readRelationships();
    const rel = relationships.find(
      (r) => r.original_campaign_id === originalId && r.clone_campaign_id === cloneId
    );

    // Meta has ONE shared ad account for both companies — a viewer/admin
    // scoped to one company must not be able to pull spend/ROAS for the
    // other company's campaigns by supplying arbitrary IDs. Resolve each
    // campaign's name (from the stored relationship record if we have it,
    // else directly from Meta) and gate before fetching any insights.
    const token = process.env.META_ACCESS_TOKEN;
    async function resolveCampaignName(id: string, cached?: string): Promise<string> {
      if (cached) return cached;
      if (!token) return "";
      const res = await fetch(`${META_GRAPH_BASE}/${id}?fields=name&access_token=${token}`);
      const data = await res.json() as { name?: string };
      return data.name ?? "";
    }
    const [originalName, cloneName] = await Promise.all([
      resolveCampaignName(originalId, rel?.original_name),
      resolveCampaignName(cloneId, rel?.clone_name),
    ]);
    const originalCompany = detectCompany(originalName);
    const cloneCompany = detectCompany(cloneName);
    if (!canAccessCompany(user, originalCompany) || !canAccessCompany(user, cloneCompany)) {
      return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
    }

    const today = new Date().toISOString().split("T")[0];
    const from = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

    const insights = await metaClient.getCampaignInsights([originalId, cloneId], { from, to: today });

    function aggregate(campaignId: string) {
      const rows = insights.filter((i) => i.campaign_id === campaignId);

      const impressions = rows.reduce((s, r) => s + parseInt(r.impressions || "0", 10), 0);
      const clicks = rows.reduce((s, r) => s + parseInt(r.clicks || "0", 10), 0);
      const spend = rows.reduce((s, r) => s + parseFloat(r.spend || "0"), 0);
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      const cpc = clicks > 0 ? spend / clicks : 0;

      const conversions = rows.reduce((s, r) => {
        if (!r.actions) return s;
        const purchaseAction = r.actions.find((a) => a.action_type === "purchase");
        return s + (purchaseAction ? parseFloat(purchaseAction.value || "0") : 0);
      }, 0);

      const revenueFromPurchase = rows.reduce((s, r) => {
        if (!r.action_values) return s;
        const purchaseVal = r.action_values.find((a) => a.action_type === "purchase");
        return s + (purchaseVal ? parseFloat(purchaseVal.value || "0") : 0);
      }, 0);

      const roas = spend > 0 ? revenueFromPurchase / spend : 0;
      const status = spend > 0 && impressions > 0 ? "ACTIVE" : "PAUSED";

      // reach/frequency aren't additive across rows the way impressions/clicks
      // are — with no time_increment this call already returns one aggregate
      // row per campaign, so read real values from it directly (not summed).
      const reach = parseInt(rows[0]?.reach || "0", 10);
      const frequency = parseFloat(rows[0]?.frequency || "0");

      return { impressions, clicks, spend, ctr, cpc, conversions, roas, status, reach, frequency };
    }

    const v1Data = aggregate(originalId);
    const v2Data = aggregate(cloneId);

    const v1 = {
      id: originalId,
      name: rel?.original_name ?? originalId,
      status: v1Data.status,
      impressions: v1Data.impressions,
      reach: v1Data.reach,
      clicks: v1Data.clicks,
      ctr: v1Data.ctr,
      cpc: v1Data.cpc,
      spend: v1Data.spend,
      frequency: v1Data.frequency,
      roas: v1Data.roas,
      conversions: v1Data.conversions,
    };

    const v2 = {
      id: cloneId,
      name: rel?.clone_name ?? cloneId,
      status: v2Data.status,
      impressions: v2Data.impressions,
      reach: v2Data.reach,
      clicks: v2Data.clicks,
      ctr: v2Data.ctr,
      cpc: v2Data.cpc,
      spend: v2Data.spend,
      frequency: v2Data.frequency,
      roas: v2Data.roas,
      conversions: v2Data.conversions,
    };

    const deltaCtr = v1.ctr > 0 ? ((v2.ctr - v1.ctr) / v1.ctr) * 100 : 0;
    const deltaCpc = v1.cpc > 0 ? ((v2.cpc - v1.cpc) / v1.cpc) * 100 : 0;
    const deltaSpend = v1.spend > 0 ? ((v2.spend - v1.spend) / v1.spend) * 100 : 0;

    let verdict: string;
    if (v1.impressions === 0 && v2.impressions === 0) {
      verdict = "Chưa có đủ dữ liệu để so sánh.";
    } else if (v2.ctr > v1.ctr && v2.cpc < v1.cpc) {
      verdict = "Variant B vượt trội cả CTR lẫn CPC — đây là winner rõ ràng.";
    } else if (v2.ctr > v1.ctr) {
      verdict = `Variant B có CTR cao hơn ${deltaCtr.toFixed(1)}%. Xem xét scale up Variant B.`;
    } else if (v1.ctr > v2.ctr) {
      verdict = "Variant A đang thắng với CTR cao hơn. Giữ nguyên Variant A.";
    } else {
      verdict = "Hai biến thể có hiệu suất tương đương. Cần thêm dữ liệu.";
    }

    return NextResponse.json({
      success: true,
      data: {
        v1,
        v2,
        deltas: { ctr: deltaCtr, cpc: deltaCpc, spend: deltaSpend },
        verdict,
        comparedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[compare/route] Meta API error:", message);
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 500 });
  }
}
