// PATCH /api/google/toolkit/rsa/[adId]
// Real write — pushes edited headlines/descriptions to an existing RSA on
// Google Ads. Validates char + count limits before calling Google, and
// always records the attempt (success or failure) for audit trail.
// See docs/mini-specs/RSA-EDIT-1.md.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, canAccessCompany } from "@/lib/permissions";
import { googleSearchAdsClient } from "@/lib/google-search-ads-client";
import { checkRsaCharLimits, checkRsaCountLimits } from "@/lib/creative-limits";
import { appendRsaEditRecord } from "@/lib/rsa-edit-history";
import { getGoogleAdsCustomer, GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client";
import { guardedMutate, WriteGuardError } from "@/lib/write-guard";
import { friendlyError } from "@/lib/not-configured";

interface PatchBody {
  company?: string;
  headlines?: string[];
  descriptions?: string[];
  previousHeadlines?: string[];
  previousDescriptions?: string[];
  adGroupId?: string;
  campaignId?: string;
  source?: "manual" | "ai_suggested";
  /** Đợt 11d: true = chỉ Kiểm trước. Ghi thật cần confirmText "XAC NHAN" (thiếu → 428). */
  validateOnly?: boolean;
  confirmText?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ adId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền chỉnh sửa quảng cáo" }, { status: 403 });
  }

  const { adId } = await params;
  if (!adId || !/^\d+$/.test(adId)) {
    return NextResponse.json({ success: false, error: "adId không hợp lệ" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const company = body.company;
  if (!company) {
    return NextResponse.json({ success: false, error: "Thiếu công ty" }, { status: 400 });
  }
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }

  const headlines = Array.isArray(body.headlines) ? body.headlines.map((h) => h.trim()).filter(Boolean) : [];
  const descriptions = Array.isArray(body.descriptions) ? body.descriptions.map((d) => d.trim()).filter(Boolean) : [];

  const countViolations = checkRsaCountLimits(headlines, descriptions);
  if (countViolations.length > 0) {
    return NextResponse.json({
      success: false,
      error: `Số lượng không hợp lệ: ${countViolations.map((v) => `${v.field} cần ${v.min}-${v.max}, hiện có ${v.count}`).join("; ")}`,
    }, { status: 400 });
  }

  const charViolations = checkRsaCharLimits(headlines, descriptions);
  if (charViolations.length > 0) {
    return NextResponse.json({
      success: false,
      error: `Vượt giới hạn ký tự: ${charViolations.map((v) => `${v.field} ${v.length}/${v.limit}`).join("; ")}`,
    }, { status: 400 });
  }

  const before = {
    headlines: Array.isArray(body.previousHeadlines) ? body.previousHeadlines : [],
    descriptions: Array.isArray(body.previousDescriptions) ? body.previousDescriptions : [],
  };

  let writeId: string | undefined;
  try {
    // Đợt 11d: đọc bản ĐANG CHẠY (kèm ghim) → giữ ghim theo vị trí (bản cũ gửi chỉ chữ nên MẤT ghim mỗi lần sửa) → ghi qua
    // lớp an toàn (Kiểm trước → XAC NHAN → lệnh ngược = bản đang chạy đầy đủ ghim, hoàn tác ở /api/write-log).
    const rn = `customers/${GOOGLE_CUSTOMER_IDS[company]}/ads/${adId}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [live0] = (await getGoogleAdsCustomer(company).query(`SELECT ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions FROM ad_group_ad WHERE ad_group_ad.ad.resource_name = '${rn}'`)) as any[];
    if (!live0) return NextResponse.json({ success: false, error: "Không thấy quảng cáo trên Google Ads" }, { status: 404 });
    type TA = { text: string; pinned_field?: number };
    const cur = (xs: { text?: string; pinned_field?: number }[] = []): TA[] => xs.map((x) => ({ text: String(x.text ?? ""), ...(x.pinned_field ? { pinned_field: Number(x.pinned_field) } : {}) }));
    const liveH = cur(live0.ad_group_ad.ad.responsive_search_ad?.headlines), liveD = cur(live0.ad_group_ad.ad.responsive_search_ad?.descriptions);
    const keepPins = (next: string[], live: TA[]): TA[] => next.map((text, i) => { const same = live.find((l) => l.text === text); const pin = same?.pinned_field ?? (next.length === live.length ? live[i]?.pinned_field : undefined); return { text, ...(pin ? { pinned_field: pin } : {}) }; });
    try {
      const g = await guardedMutate({
        company, source: "toolkit/rsa", label: `Sửa RSA #${adId}`,
        ops: [{ entity: "ad", operation: "update", resource: { resource_name: rn, responsive_search_ad: { headlines: keepPins(headlines, liveH), descriptions: keepPins(descriptions, liveD) } } }],
        inverseOf: () => [{ entity: "ad", operation: "update", resource: { resource_name: rn, responsive_search_ad: { headlines: liveH, descriptions: liveD } } }],
        validateOnly: body.validateOnly, confirmText: body.confirmText, actor: user.email,
      });
      if (!g.entry) return NextResponse.json({ success: true, validated: true });
      writeId = g.entry.id;
    } catch (e) {
      if (e instanceof WriteGuardError) return NextResponse.json({ success: false, error: friendlyError(e.message), needsConfirm: e.status === 428, validated: e.validated }, { status: e.status });
      throw e;
    }

    // ── Đọc lại từ Google để xác minh ──
    //
    // Google trả 200 nghĩa là "đã nhận lệnh", chưa chắc nghĩa là "chữ trên tài khoản
    // giờ đúng như bạn gõ". Đọc lại rồi đối chiếu thì "đã cập nhật" mới là kết luận
    // rút ra từ bằng chứng, không phải suy ra từ mã trạng thái.
    //
    // Phân biệt ba tình huống vì chúng đòi ba hành động khác nhau của người dùng:
    //   match     → xong
    //   mismatch  → Google nhận lệnh nhưng nội dung không như gõ, phải xem lại
    //   unchecked → đã ghi rồi, chỉ là chưa đọc lại được. ĐỪNG báo thất bại: báo
    //               thất bại sẽ khiến người ta bấm lại một việc đã xong.
    let verified: "match" | "mismatch" | "unchecked" = "unchecked";
    let verifyNote: string | null = null;
    try {
      const fresh = await googleSearchAdsClient.getRsaContentForAdGroup(company, body.adGroupId ?? "");
      const live = fresh.find((a) => a.adId === adId);
      if (!live) {
        verifyNote = "Đã gửi lệnh nhưng đọc lại không thấy quảng cáo này trong ad group — kiểm tra lại trên Google Ads.";
      } else {
        // Google có thể cắt khoảng trắng thừa, và tiếng Việt phải chuẩn hoá NFC
        // trước khi so — cùng một chữ hai cách mã hoá sẽ báo lệch oan.
        const norm = (arr: string[]) => arr.map((t) => t.normalize("NFC").trim());
        const wantH = norm(headlines), gotH = norm(live.headlines);
        const wantD = norm(descriptions), gotD = norm(live.descriptions);
        const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
        if (same(wantH, gotH) && same(wantD, gotD)) {
          verified = "match";
        } else {
          verified = "mismatch";
          const diffs: string[] = [];
          wantH.forEach((v, i) => { if (gotH[i] !== v) diffs.push(`Tiêu đề ${i + 1}: gõ "${v}" — trên Google "${gotH[i] ?? "(trống)"}"`); });
          wantD.forEach((v, i) => { if (gotD[i] !== v) diffs.push(`Mô tả ${i + 1}: gõ "${v}" — trên Google "${gotD[i] ?? "(trống)"}"`); });
          verifyNote = diffs.slice(0, 4).join("; ");
        }
      }
    } catch (verifyErr) {
      // Đọc lại hỏng KHÁC ghi hỏng — lệnh ghi ở trên đã thành công.
      verifyNote = `Đã gửi lệnh thành công nhưng chưa đọc lại để xác minh được: ${verifyErr instanceof Error ? verifyErr.message : "lỗi không xác định"}`;
    }

    if (verified === "mismatch") {
      return NextResponse.json({
        success: false,
        verified,
        error: `Google nhận lệnh nhưng nội dung trên tài khoản không khớp với thứ bạn gõ. ${verifyNote}`,
      }, { status: 502 });
    }

    await appendRsaEditRecord({
      company,
      adId,
      adGroupId: body.adGroupId ?? "",
      campaignId: body.campaignId ?? "",
      before,
      after: { headlines, descriptions },
      editedBy: user.email,
      editedAt: new Date().toISOString(),
      source: body.source === "ai_suggested" ? "ai_suggested" : "manual",
      success: true,
    }).catch((auditErr) => {
      // The Google Ads write already succeeded — a failure to persist the audit
      // record must not make it look like the edit failed. Reporting 502 here
      // would send the user to retry an edit that is already live, and the
      // catch below would file a success:false record for a successful push.
      console.error("[rsa PATCH] audit log write failed after successful Google Ads update", auditErr);
    });

    return NextResponse.json({ success: true, verified, verifyNote, writeId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";

    await appendRsaEditRecord({
      company,
      adId,
      adGroupId: body.adGroupId ?? "",
      campaignId: body.campaignId ?? "",
      before,
      after: { headlines, descriptions },
      editedBy: user.email,
      editedAt: new Date().toISOString(),
      source: body.source === "ai_suggested" ? "ai_suggested" : "manual",
      success: false,
      error: friendlyError(message),
    }).catch(() => { /* audit log failure must not mask the real Google error below */ });

    console.error("[rsa PATCH]", err);
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 502 });
  }
}
