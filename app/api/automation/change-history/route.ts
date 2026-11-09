// GET /api/automation/change-history
// Real automation change history — this route never existed; the History
// page's fetch() always 404'd, silently caught, and rendered "Chưa có lịch
// sử thay đổi" regardless of whether the automation engine had actually
// run. The real data has existed all along in automation-engine.ts's
// execution log (data/automation-data.json) — this route just serves it
// in the shape the page already expects.
import { NextResponse } from "next/server";
import { getExecutionLog, ACTION_LABELS } from "@/lib/automation-engine";
import { detectCompany } from "@/lib/company-detect";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const log = getExecutionLog();

  // Chỉ trả lịch sử của công ty người này được xem. Route này vốn đã TÍNH ra
  // company cho từng dòng rồi trả hết — tính đúng nhưng không dùng để lọc.
  const allowed = getCompaniesForRole(user) as string[];

  const data = log
    .filter((entry) => !entry.skipped)
    .filter((entry) => allowed.includes(detectCompany(entry.campaignName)))
    .map((entry) => ({
      campaignName: entry.campaignName,
      company: detectCompany(entry.campaignName),
      actionType: entry.action,
      actionLabel: `${ACTION_LABELS[entry.action]?.icon ?? ""} ${ACTION_LABELS[entry.action]?.label ?? entry.action} — "${entry.ruleName}"`.trim(),
      appliedAt: entry.triggeredAt,
    }))
    .reverse(); // most recent first

  return NextResponse.json({ data });
}
