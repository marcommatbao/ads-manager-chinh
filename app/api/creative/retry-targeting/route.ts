// POST /api/creative/retry-targeting
// Re-applies the ORIGINAL targeting (before the Advantage+ Audience
// fallback) to an already-created ad set — for the "Thử lại targeting gốc"
// button shown when launch-campaign reports a targetingDowngrade. Useful
// because the code:100 rejection is sometimes a transient Meta-side
// interest-ID sync lag (see mapSegmentToFBTargeting's own retry comment) —
// by the time the user clicks retry, the same IDs may now validate fine.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, canAccessCompany } from "@/lib/permissions";
import { fbApiCall } from "@/lib/creative-pipeline";
import { detectCompany } from "@/lib/company-detect";
import { resolveMetaNodeOwner } from "@/lib/meta-campaign-company";
import { friendlyError } from "@/lib/not-configured";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền chỉnh sửa ad set" }, { status: 403 });
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ success: false, error: friendlyError("META credentials not configured") }, { status: 401 });

  let body: { adSetId?: string; targeting?: Record<string, unknown>; company?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { adSetId, targeting, company } = body;
  if (!adSetId || !targeting) {
    return NextResponse.json({ success: false, error: "Missing adSetId or targeting" }, { status: 400 });
  }
  // Audit 30/09: trước đây chỉ kiểm khi client GỬI company → bỏ trống là ghi đè được targeting nhóm của công ty kia.
  // Nay công ty lấy từ chiến dịch cha của ad set (phía server), company client gửi chỉ còn để đối chiếu.
  let owner;
  try { owner = await resolveMetaNodeOwner(String(adSetId), token); }
  catch (e) { return NextResponse.json({ success: false, error: `Không xác minh được công ty: ${e instanceof Error ? e.message : String(e)}` }, { status: 403 }); }
  if (owner.kind !== "child") return NextResponse.json({ success: false, error: "adSetId phải là nhóm quảng cáo" }, { status: 400 });
  const ownerCompany = detectCompany(owner.campaignName) as string;
  if (!canAccessCompany(user, ownerCompany) || (company && company !== ownerCompany)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }

  try {
    await fbApiCall(`/${adSetId}`, { targeting }, `retry-original-targeting-${adSetId}`, token);
    return NextResponse.json({ success: true });
  } catch (err) {
    // Expected outcome if the interest IDs still haven't synced — not a
    // system error, just "not yet, try again later" for the caller to show.
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 200 });
  }
}
