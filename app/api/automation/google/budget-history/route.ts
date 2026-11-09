// ============================================================
// GET /api/automation/google/budget-history
// Returns recent budget optimization actions from JSON storage
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import fs from "fs";
import path from "path";
import { friendlyError } from "@/lib/not-configured";

interface BudgetAction {
  company: string;
  campaignName: string;
  action: string;
  oldBudget: number;
  newBudget: number;
  cpl: number;
  conversions: number;
  budgetLost: number;
  reason: string;
  appliedAt: string;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const parsed = parseInt(searchParams.get("limit") || "20", 10);
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 20;

    const filePath = path.join(process.cwd(), "data", "google-budget-history.json");

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ success: true, data: [], total: 0 });
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const all: BudgetAction[] = JSON.parse(raw);

    // Chỉ trả về công ty người này được xem. Lọc TRƯỚC khi cắt, và total phải là
    // số sau lọc — nếu không thì riêng con số cũng đã lộ bên kia có bao nhiêu bản ghi.
    const allowed = getCompaniesForRole(user) as string[];
    const mine = all.filter(a => allowed.includes(a.company));

    const sorted = mine
      .sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime())
      .slice(0, limit);

    return NextResponse.json({
      success: true,
      data: sorted,
      total: mine.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[budget-history] Error:", msg);
    return NextResponse.json({ success: false, error: friendlyError(msg) }, { status: 500 });
  }
}
