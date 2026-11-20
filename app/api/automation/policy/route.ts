import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readAutomationPolicy, saveAutomationPolicyDraft } from "@/lib/automation/policy";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ success: true, policy: readAutomationPolicy(), canEdit: true });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: { policy?: unknown; expectedVersion?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_POLICY" }, { status: 400 }); }
  if (!body || typeof body !== "object" || typeof body.expectedVersion !== "string") return NextResponse.json({ error: "INVALID_POLICY" }, { status: 400 });
  try {
    const policy = await saveAutomationPolicyDraft(body.policy, user.id, body.expectedVersion);
    return NextResponse.json({ success: true, policy, mutationPerformed: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "POLICY_CONFLICT") return NextResponse.json({ error: "POLICY_CONFLICT" }, { status: 409 });
    if (message === "POLICY_AUDIT_UNAVAILABLE" || (error as NodeJS.ErrnoException).code) return NextResponse.json({ error: "POLICY_SAVE_FAILED" }, { status: 503 });
    return NextResponse.json({ error: "INVALID_POLICY" }, { status: 400 });
  }
}
