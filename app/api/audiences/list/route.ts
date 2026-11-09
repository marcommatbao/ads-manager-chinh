// GET /api/audiences/list — list real Custom Audiences from FB ad account
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";
import { friendlyError } from "@/lib/not-configured";

const BASE = META_GRAPH_BASE;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;

  if (!token || !adAccountId) {
    return NextResponse.json({ success: false, error: friendlyError("META credentials not configured") }, { status: 500 });
  }

  try {
    const params = new URLSearchParams({
      fields: "id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,time_created,delivery_status",
      limit: "50",
      access_token: token,
    });

    const res = await fetch(`${BASE}/act_${adAccountId}/customaudiences?${params}`);
    const data = await res.json() as {
      data?: Array<{
        id: string;
        name: string;
        subtype: string;
        approximate_count_lower_bound?: number;
        approximate_count_upper_bound?: number;
        time_created?: number;
        delivery_status?: { code: number; description: string };
      }>;
      error?: { message: string };
    };

    if (data.error) {
      return NextResponse.json({ success: false, error: data.error.message }, { status: 502 });
    }

    const audiences = (data.data ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      type: a.subtype,
      size: a.approximate_count_lower_bound ?? 0,
      sizeMax: a.approximate_count_upper_bound ?? 0,
      createdAt: a.time_created
        ? new Date(a.time_created * 1000).toISOString().slice(0, 10)
        : null,
      status: a.delivery_status?.description ?? "Unknown",
    }));

    return NextResponse.json({ success: true, data: audiences });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}
