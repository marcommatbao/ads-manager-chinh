import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;

  if (!token || !adAccountId) {
    return NextResponse.json({ users_lower_bound: null, users_upper_bound: null });
  }

  const targetingParam = request.nextUrl.searchParams.get("targeting");
  if (!targetingParam) {
    return NextResponse.json({ users_lower_bound: null, users_upper_bound: null });
  }

  let targeting: unknown;
  try {
    targeting = JSON.parse(targetingParam);
  } catch {
    return NextResponse.json({ users_lower_bound: null, users_upper_bound: null });
  }

  try {
    const params = new URLSearchParams({
      targeting_spec: JSON.stringify(targeting),
      optimization_goal: "LEAD_GENERATION",
      access_token: token,
    });
    const res = await fetch(`${META_GRAPH_BASE}/act_${adAccountId}/reachestimate?${params}`);
    const data = await res.json();
    if (data.error || !data.data) {
      return NextResponse.json({ users_lower_bound: null, users_upper_bound: null });
    }
    return NextResponse.json({
      users_lower_bound: data.data.users_lower_bound ?? null,
      users_upper_bound: data.data.users_upper_bound ?? null,
    });
  } catch {
    return NextResponse.json({ users_lower_bound: null, users_upper_bound: null });
  }
}
