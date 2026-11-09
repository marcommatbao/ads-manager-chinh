// POST /api/creative/toggle-campaign
// Toggle a Facebook campaign ACTIVE/PAUSED
import { resolveMetaNodeOwner } from "@/lib/meta-campaign-company";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, canAccessCompany } from "@/lib/permissions";
import { detectCompany } from "@/lib/company-detect";
import { recordCampaignMutation } from "@/lib/mutation-guard";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";
import { friendlyError } from "@/lib/not-configured";

const META_BASE = META_GRAPH_BASE;

interface MetaListItem { id: string; status?: string }

async function setStatus(id: string, status: string, token: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${META_BASE}/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, access_token: token }),
  });
  const data = await res.json().catch(() => ({}));
  if (data?.error) return { ok: false, error: data.error.message };
  return { ok: true };
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền chỉnh sửa campaign" }, { status: 403 });
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ success: false, error: friendlyError("META_ACCESS_TOKEN not configured") }, { status: 401 });
  }

  let body: { campaignId?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { campaignId, status } = body;
  if (!campaignId || !status) {
    return NextResponse.json({ success: false, error: "campaignId and status are required" }, { status: 400 });
  }

  if (!["ACTIVE", "PAUSED"].includes(status)) {
    return NextResponse.json({ success: false, error: "status must be ACTIVE or PAUSED" }, { status: 400 });
  }

  try {
    // Meta has ONE shared ad account for both companies — derive which
    // company this campaign belongs to server-side before allowing the
    // mutation, same as the sibling meta/campaigns/[id]/status route.
    // Audit 30/09: chỉ nhận CHIẾN DỊCH (route này còn bật lan xuống nhóm + quảng cáo) — trước đây gửi id nhóm quảng
    // cáo của công ty kia (tên không có "MBI") là qua được phép kiểm.
    let owner;
    try { owner = await resolveMetaNodeOwner(String(campaignId), token); }
    catch (e) { return NextResponse.json({ success: false, error: `Không xác minh được công ty: ${e instanceof Error ? e.message : String(e)}` }, { status: 403 }); }
    if (owner.kind !== "campaign") {
      return NextResponse.json({ success: false, error: "Chỉ bật/tắt được cấp chiến dịch" }, { status: 400 });
    }
    const nameData = { name: owner.name };
    const campaignCompany = detectCompany(owner.campaignName);
    if (!canAccessCompany(user, campaignCompany)) {
      return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
    }

    const campaignResult = await setStatus(campaignId, status, token);
    if (!campaignResult.ok) {
      return NextResponse.json({ success: false, error: campaignResult.error }, { status: 502 });
    }
    // Đợt 15b: ghi dấu vết để đo lại 7/14 ngày.
    recordCampaignMutation({ source: { type: "human_manual", actor: user.email || user.name || user.id }, event: status === "PAUSED" ? "campaign.pause" : "campaign.resume", company: campaignCompany, campaignId, campaignName: nameData.name ?? campaignId, rationale: "Bật/tắt chiến dịch từ Creative", platform: "meta" });

    // ── Cascade xuống Ad Set + Ad khi BẬT ──
    //
    // Trước bản này route chỉ đổi đúng node Campaign. Meta yêu cầu CẢ 3 CẤP
    // (Campaign/AdSet/Ad) đều ACTIVE thì mới thật sự phát quảng cáo — đổi
    // mỗi Campaign trong khi AdSet/Ad bên dưới (mặc định PAUSED lúc tạo, xem
    // launch-campaign/route.ts) vẫn PAUSED thì Campaign trông như "đang
    // chạy" trên Ads Manager nhưng KHÔNG có quảng cáo nào thật sự hiển thị,
    // không tiêu một đồng nào — trong khi nút "Bật chạy ngay!" ở
    // app/(dashboard)/creative/page.tsx lại báo "🚀 Campaign đang chạy!" là
    // SAI. Phát hiện khi làm việc liên quan (2026-09-18).
    //
    // TẮT (PAUSED) thì KHÔNG cần cascade: Meta tự dừng phát mọi AdSet/Ad bên
    // dưới khi Campaign cha bị pause, bất kể trạng thái riêng của chúng —
    // đây là hành vi chuẩn của Meta, không phải giả định.
    let adSetsActivated = 0;
    let adsActivated = 0;
    const cascadeErrors: string[] = [];

    if (status === "ACTIVE") {
      const adSetsRes = await fetch(`${META_BASE}/${campaignId}/adsets?fields=id,status&limit=200&access_token=${token}`);
      const adSetsData = await adSetsRes.json() as { data?: MetaListItem[]; error?: { message: string } };
      if (adSetsData.error) {
        cascadeErrors.push(`Không lấy được danh sách Ad Set: ${adSetsData.error.message}`);
      } else {
        for (const adSet of adSetsData.data ?? []) {
          if (adSet.status !== "ACTIVE") {
            const r = await setStatus(adSet.id, "ACTIVE", token);
            if (r.ok) adSetsActivated++;
            else cascadeErrors.push(`Ad Set ${adSet.id}: ${r.error}`);
          }

          // Đọc Ad theo TỪNG Ad Set — /{adSetId}/ads là edge chắc chắn có
          // (đúng edge launch-campaign/route.ts dùng để TẠO ad), không dựa
          // vào một edge /{campaignId}/ads chưa xác nhận tồn tại ở mọi phiên
          // bản API.
          const adsRes = await fetch(`${META_BASE}/${adSet.id}/ads?fields=id,status&limit=200&access_token=${token}`);
          const adsData = await adsRes.json() as { data?: MetaListItem[]; error?: { message: string } };
          if (adsData.error) {
            cascadeErrors.push(`Ad Set ${adSet.id} — không lấy được danh sách Ad: ${adsData.error.message}`);
            continue;
          }
          for (const ad of adsData.data ?? []) {
            if (ad.status === "ACTIVE") continue;
            const r = await setStatus(ad.id, "ACTIVE", token);
            if (r.ok) adsActivated++;
            else cascadeErrors.push(`Ad ${ad.id}: ${r.error}`);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      campaignId,
      status,
      adSetsActivated,
      adsActivated,
      cascadeErrors: cascadeErrors.length ? cascadeErrors : undefined,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: `Toggle failed: ${message}` }, { status: 500 });
  }
}
