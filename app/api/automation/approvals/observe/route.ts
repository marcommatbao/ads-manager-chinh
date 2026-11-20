import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import { recordApprovalObservation } from "@/lib/automation/approval-store";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_REFERENCE" }, { status: 400 }); }
  if (!body || typeof body !== "object" || ["approvalId", "company", "registryId"].some(key => typeof body[key] !== "string" || !(body[key] as string).trim() || (body[key] as string).length > 100)) return NextResponse.json({ error: "INVALID_REFERENCE" }, { status: 400 });
  const { approvalId, company, registryId } = body as { approvalId: string; company: string; registryId: string };
  if (!getCompaniesForRole(user).includes(company)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const assessment = await recordApprovalObservation(approvalId, company, registryId, user.id);
    return NextResponse.json({ success: true, assessment, providerMutationPerformed: false });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const conflict = code.startsWith("OBSERVATION_") || code.startsWith("SNAPSHOT_") || code === "APPROVAL_NOT_RECONCILABLE" || code === "ACCOUNT_NOT_CONFIGURED";
    return NextResponse.json({ error: code === "APPROVAL_NOT_FOUND" ? code : conflict ? "OBSERVATION_REFRESH_OR_SCOPE_REQUIRED" : "OBSERVATION_UNAVAILABLE" }, { status: code === "APPROVAL_NOT_FOUND" ? 404 : conflict ? 409 : 503 });
  }
}
