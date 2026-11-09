// POST /api/audiences/create-lookalike
// 1. Create Custom Audience from hashed customer list
// 2. Add session rows (SHA256-hashed by client)
// 3. Create Lookalike audiences for each requested ratio
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, canAccessCompany, isSuperAdmin } from "@/lib/permissions";
import { buildAudiencePayload, generateAudienceName, type AudienceConfig, type AudienceResult, type CustomerRecord } from "@/lib/audience-builder";
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

  let body: { config: AudienceConfig; customers: CustomerRecord[] };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { config, customers } = body;

  if (!customers || customers.length === 0) {
    return NextResponse.json({ success: false, error: "Danh sách khách hàng trống" }, { status: 400 });
  }

  // This creates a real Custom + Lookalike Audience on the shared Meta ad
  // account — gate to the company the audience is actually for.
  const companyOk = config.company === "both" ? isSuperAdmin(user.role) : canAccessCompany(user, config.company);
  if (!companyOk) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }

  try {
    const audienceName = config.audienceName || generateAudienceName(config);

    // Step 1: Create Custom Audience
    const createRes = await fetch(`${BASE}/act_${adAccountId}/customaudiences`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: audienceName,
        subtype: "CUSTOM",
        description: `Created via AdsCommand — source: ${config.source}`,
        customer_file_source: "USER_PROVIDED_ONLY",
        access_token: token,
      }),
    });

    const createData = await createRes.json() as { id?: string; error?: { message: string } };
    if (createData.error || !createData.id) {
      return NextResponse.json(
        { success: false, error: createData.error?.message ?? "Failed to create audience" },
        { status: 502 }
      );
    }
    const audienceId = createData.id;

    // Step 2: Upload hashed customer data
    const { schema, data } = buildAudiencePayload(customers);

    if (data.length > 0) {
      const uploadRes = await fetch(`${BASE}/${audienceId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: { schema, data },
          access_token: token,
        }),
      });
      const uploadData = await uploadRes.json() as { error?: { message: string } };
      if (uploadData.error) {
        // A Custom Audience with no customer data uploaded is useless — fail
        // the whole request instead of reporting false success (the audience
        // shell was created on Meta as `audienceId`, but has zero members).
        return NextResponse.json(
          {
            success: false,
            error: `Tạo Custom Audience "${audienceName}" thành công nhưng upload danh sách khách hàng thất bại: ${uploadData.error.message}`,
            customAudienceId: audienceId,
          },
          { status: 502 }
        );
      }
    }

    // Step 3: Create Lookalike audiences
    // NOTE: no `estimatedSize` here — Meta computes real Lookalike size
    // (approximate_count_lower_bound/upper_bound) asynchronously and never
    // returns it on this creation response. This used to fabricate one as
    // `Math.round(ratio * 80000000)` (ratio × Vietnam's population) — a
    // number with no relationship to Meta's real audience size. Removed;
    // see AudienceResult.sizeStatus below for the honest replacement.
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
          lookalike_spec: JSON.stringify({
            ratio,
            country: "VN",
            type: "similarity",
          }),
          access_token: token,
        }),
      });

      const lalData = await lalRes.json() as { id?: string; error?: { message: string } };
      if (lalData.id) {
        lookalikes.push({ id: lalData.id, name: lalName, ratio });
      } else {
        console.warn("[audiences] Lookalike warning:", lalData.error?.message);
      }
    }

    const responseData: AudienceResult = {
      customAudienceId: audienceId,
      customAudienceName: audienceName,
      customerCount: data.length,
      // Real size is never available at creation time (see note above) —
      // "pending" is the only honest value; check Meta Ads Manager later.
      sizeStatus: "pending",
      lookalikes,
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json({ success: true, data: responseData });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}
