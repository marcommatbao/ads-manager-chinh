// ============================================================
// Notifications API
// GET  — list alerts (filtered by user company)
// POST — trigger alert engine scan + mark all read
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAlerts, markAllAlertsRead, getUnreadCount, runAlertEngine } from "@/lib/alert-engine";
import type { AlertMetrics } from "@/lib/alert-rules";
import { friendlyError } from "@/lib/not-configured";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const severity = searchParams.get("severity") || undefined;
    const is_resolved = searchParams.get("resolved");
    const limit = searchParams.get("limit");

    // Filter by user's companies
    const companies = user.companies as string[];

    let alerts = await getAlerts({
      severity,
      is_resolved: is_resolved === "true" ? true : is_resolved === "false" ? false : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    // Filter by user's accessible companies
    if (!companies.includes("MBC") || !companies.includes("MBI")) {
      alerts = alerts.filter((a) => companies.includes(a.company));
    }

    const unreadCount = await getUnreadCount(companies);

    return NextResponse.json({
      success: true,
      data: alerts,
      unread_count: unreadCount,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: friendlyError(msg) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const action = body.action;

    // Mark all as read
    if (action === "mark_all_read") {
      const companies = user.companies as string[];
      const count = await markAllAlertsRead(companies);
      return NextResponse.json({
        success: true,
        message: `Đã đánh dấu ${count} thông báo đã đọc`,
      });
    }

    // Trigger alert engine scan with provided metrics
    if (action === "scan" && body.metrics) {
      const metrics = body.metrics as AlertMetrics[];
      const newAlerts = await runAlertEngine(metrics);
      return NextResponse.json({
        success: true,
        new_alerts: newAlerts.length,
        data: newAlerts,
      });
    }

    // Default: run empty scan (metrics should come from caller)
    return NextResponse.json({
      success: true,
      message: "Use action: 'scan' with metrics or 'mark_all_read'",
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: friendlyError(msg) }, { status: 500 });
  }
}
