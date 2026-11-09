// POST /api/creative/launch-campaign — tạo chiến dịch Meta (Campaign → Ad Sets → Ads).
// Logic ở lib/meta/launch.ts (dùng chung với MCP cho Claude).
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import type { LaunchConfig } from "@/lib/creative-pipeline";
import { LaunchHttpError, launchMetaCampaign } from "@/lib/meta/launch";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  let config: LaunchConfig;
  try {
    config = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }
  try {
    return NextResponse.json(await launchMetaCampaign(user, config));
  } catch (e) {
    if (e instanceof LaunchHttpError) return NextResponse.json(e.body, { status: e.status });
    throw e;
  }
}
