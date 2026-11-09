// POST /api/audiences/create-website-audience
//
// Real Meta WEBSITE Custom Audience (subtype=WEBSITE) for the "web_visitors"
// Audience Builder source. Deliberately a SEPARATE route from
// /api/audiences/create-lookalike: that route's contract (customers list →
// upload → Lookalikes) doesn't apply here — Meta computes WEBSITE audience
// membership server-side from live Pixel traffic, there is no customer list
// to send, and Meta exposes no pre-creation size estimate for it either.
//
// NEW, UNTESTED against a real ad account: this is a genuinely new live
// Meta mutation with no sandbox/ad-account credentials available in this
// environment to verify end-to-end. See lib/meta-client.ts's
// createWebsiteCustomAudience for exactly what's confirmed vs. unverified
// about the rule schema. Verify the first real creation manually in Meta
// Ads Manager before relying on it.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, canAccessCompany, isSuperAdmin } from "@/lib/permissions";
import { generateAudienceName, type AudienceConfig, type AudienceResult } from "@/lib/audience-builder";
import { createWebsiteCustomAudience, resolveCompanyPixelId } from "@/lib/meta-client";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";
import { friendlyError } from "@/lib/not-configured";

const BASE = META_GRAPH_BASE;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền tạo Audience" }, { status: 403 });
  }

  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !adAccountId) {
    return NextResponse.json({ success: false, error: friendlyError("META credentials not configured") }, { status: 500 });
  }

  let body: { config: AudienceConfig };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const { config } = body;

  if (!config || config.source !== "web_visitors") {
    return NextResponse.json({ success: false, error: "Route này chỉ dùng cho nguồn web_visitors" }, { status: 400 });
  }

  // This creates a real WEBSITE Custom + Lookalike Audience on the shared
  // Meta ad account — same RBAC/company gate as create-lookalike/route.ts.
  const companyOk = config.company === "both" ? isSuperAdmin(user.role) : canAccessCompany(user, config.company);
  if (!companyOk) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }
  if (config.company === "both") {
    // A Pixel belongs to exactly one company (lib/meta-client.ts's
    // FALLBACK_PIXELS) — there is no single "both" pixel to build a
    // WEBSITE audience rule from.
    return NextResponse.json(
      { success: false, error: "web_visitors yêu cầu chọn đúng 1 công ty để xác định Pixel" },
      { status: 400 }
    );
  }

  try {
    const pixel = await resolveCompanyPixelId(config.company);
    if (!pixel) {
      return NextResponse.json({ success: false, error: `Không tìm thấy Pixel ID cho ${config.company}` }, { status: 500 });
    }

    const audienceName = config.audienceName || generateAudienceName(config);
    const { id: audienceId } = await createWebsiteCustomAudience(adAccountId, token, {
      name: audienceName,
      pixelId: pixel.id,
      retentionDays: config.days,
      description: `Created via AdsCommand — source: web_visitors (pixel ${pixel.source})`,
    });

    // Lookalikes from the WEBSITE origin audience — same proven Graph API
    // contract as create-lookalike/route.ts's Lookalike step. Building a
    // Lookalike FROM a WEBSITE-type origin audience is a standard,
    // well-documented Meta feature (unlike the WEBSITE rule's page-count
    // precision noted above) — kept inline rather than shared with
    // create-lookalike/route.ts to avoid touching that already-live route's
    // tested loop for this unrelated source.
    const lookalikes: Array<{ id: string; name: string; ratio: number }> = [];
    for (const ratio of config.lookalikeRatios) {
      const lalName = `LAL-${Math.round(ratio * 100)}%-${audienceName}`;
      const lalRes = await fetch(`${BASE}/act_${adAccountId}/customaudiences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: lalName,
          subtype: "LOOKALIKE",
          origin_audience_id: audienceId,
          lookalike_spec: JSON.stringify({ ratio, country: "VN", type: "similarity" }),
          access_token: token,
        }),
      });
      const lalData = await lalRes.json() as { id?: string; error?: { message: string } };
      if (lalData.id) {
        lookalikes.push({ id: lalData.id, name: lalName, ratio });
      } else {
        console.warn("[audiences/create-website-audience] Lookalike warning:", lalData.error?.message);
      }
    }

    const data: AudienceResult = {
      customAudienceId: audienceId,
      customAudienceName: audienceName,
      // No customerCount — WEBSITE audiences have no uploaded list.
      sizeStatus: "pending", // Meta computes size from live Pixel traffic — never available at creation time
      lookalikes,
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}
