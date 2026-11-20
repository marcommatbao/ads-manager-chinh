import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import { listApprovalSummaries, revokeApproval } from "@/lib/automation/approval-store";

export const dynamic = "force-dynamic";
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ success: true, approvals: listApprovalSummaries(getCompaniesForRole(user)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "APPROVAL_STORE_UNAVAILABLE" }, { status: 503 }); }
}
export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = request.nextUrl.searchParams.get("approvalId");
  const company = request.nextUrl.searchParams.get("company");
  if (!id || id.length > 100 || !company) return NextResponse.json({ error: "INVALID_REFERENCE" }, { status: 400 });
  if (!getCompaniesForRole(user).includes(company)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const result = await revokeApproval(id, company, user.id);
    return NextResponse.json({ success: true, approval: result, mutationPerformed: false });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    const status = reason === "APPROVAL_NOT_FOUND" ? 404 : reason === "APPROVAL_NOT_REVOCABLE" ? 409 : 503;
    return NextResponse.json({ error: status === 503 ? "APPROVAL_STORE_UNAVAILABLE" : reason }, { status });
  }
}
