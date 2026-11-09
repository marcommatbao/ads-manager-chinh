// ============================================================
// GET /api/intelligence/bid-tracker
// ============================================================
// The Intelligence page's "Bid Strategy Health" panel has always
// called this URL — the directory existed with no route.ts, so the
// fetch always failed, the error was swallowed, and the panel
// defaulted to showing "Tất cả chiến dịch đang phân phối tốt" (all
// healthy) regardless of real account state — a false-positive, not
// just a missing feature. lib/bid-tracker-engine.ts now runs real
// GAQL queries (Target CPA vs actual CPA, budget vs Target CPA,
// learning-phase tiering) instead of returning mock data.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { bidTrackerEngine } from "@/lib/bid-tracker-engine";
import { GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client";
import { canAccessCompany } from "@/lib/permissions";
import { friendlyError } from "@/lib/not-configured";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const company = (searchParams.get("company") ?? "MBC") as string;
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }
  const customerId = GOOGLE_CUSTOMER_IDS[company];
  if (!customerId) {
    return NextResponse.json({ success: false, error: friendlyError("Google Ads customer ID not configured"), data: [] }, { status: 500 });
  }

  try {
    const data = await bidTrackerEngine.analyzeBiddingHealth(customerId);
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: friendlyError(message), data: [] }, { status: 500 });
  }
}
