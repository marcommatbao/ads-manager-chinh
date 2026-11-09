// GET  /api/policy-radar/items — list items, filterable via query params
// POST /api/policy-radar/items — add a policy item manually (admin only)
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { addItem, filterItems, getAllItems } from "@/lib/policy-radar/store";
import type {
  PolicyAffectedArea,
  PolicyCategory,
  PolicyChangeType,
  PolicyPlatform,
  PolicyReviewStatus,
  PolicySeverity,
  PolicySourceType,
} from "@/lib/policy-radar/types";
import { friendlyError } from "@/lib/not-configured";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  try {
    const items = await getAllItems();
    const filtered = filterItems(items, {
      platform: (params.get("platform") as PolicyPlatform | "all" | null) ?? undefined,
      severity: (params.get("severity") as PolicySeverity | null) ?? undefined,
      category: (params.get("category") as PolicyCategory | null) ?? undefined,
      affectedArea: (params.get("affectedArea") as PolicyAffectedArea | null) ?? undefined,
      officialOnly: params.get("officialOnly") === "true",
      status: (params.get("status") as PolicyReviewStatus | null) ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    });
    return NextResponse.json({ success: true, data: filtered });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_manage_policy_radar")) {
    return NextResponse.json({ success: false, error: "Không có quyền thêm mục Policy Radar" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  if (!title || !sourceUrl) {
    return NextResponse.json({ success: false, error: "Thiếu title hoặc sourceUrl" }, { status: 400 });
  }

  try {
    const item = await addItem({
      platform: body.platform as PolicyPlatform,
      category: body.category as PolicyCategory,
      changeType: body.changeType as PolicyChangeType,
      title,
      sourceUrl,
      sourceLabel: typeof body.sourceLabel === "string" ? body.sourceLabel : sourceUrl,
      sourceType: (body.sourceType as PolicySourceType) ?? "supplementary_news",
      official: Boolean(body.official),
      publishedAt: typeof body.publishedAt === "string" && body.publishedAt ? body.publishedAt : null,
      summaryShort: typeof body.summaryShort === "string" ? body.summaryShort : "",
      whyItMatters: typeof body.whyItMatters === "string" ? body.whyItMatters : "",
      tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
      addedBy: user.email,
    });
    return NextResponse.json({ success: true, data: item });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}
