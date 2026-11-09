// ============================================================
// GET /api/automation/google/alerts
// Returns recent Google Ads monitor alerts from JSON storage
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import fs from "fs";
import path from "path";
import { friendlyError } from "@/lib/not-configured";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const parsed = parseInt(searchParams.get("limit") || "20", 10);
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 20;

    const filePath = path.join(process.cwd(), "data", "google-alerts.json");

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ success: true, data: [], total: 0 });
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = JSON.parse(raw);

    // Chỉ trả về công ty người này được xem — cảnh báo có kèm tên campaign và số
    // liệu chi tiêu, không phải thứ để lọt sang công ty kia.
    const allowed = getCompaniesForRole(user) as string[];
    const mine = all.filter(a => allowed.includes(a?.company));

    const sorted = mine
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);

    return NextResponse.json({
      success: true,
      data: sorted,
      total: mine.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: friendlyError(msg) }, { status: 500 });
  }
}
