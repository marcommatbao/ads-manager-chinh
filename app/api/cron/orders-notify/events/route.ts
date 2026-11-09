// GET /api/cron/orders-notify/events — recent per-order send/skip/error log
// Lets anyone with app access answer "why wasn't order X notified?" from the
// browser, without server/container log access. See lib/orders-notify.ts.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getRecentNotifyEvents } from "@/lib/orders-notify";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 200) || 200, 500);
  const orderName = searchParams.get("order")?.trim();

  let events = getRecentNotifyEvents(limit);
  if (orderName) {
    const needle = orderName.toLowerCase();
    events = events.filter(e => e.orderName.toLowerCase().includes(needle));
  }

  return NextResponse.json({ success: true, events });
}
