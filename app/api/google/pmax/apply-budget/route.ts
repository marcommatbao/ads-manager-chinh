// POST /api/google/pmax/apply-budget — áp dụng mức ngân sách mà LUẬT đã tính
// cho một đề xuất PMax, ghi thật lên Google Ads.
//
// Ba điều quyết định thiết kế của route này:
//
// 1. KHÔNG tin con số client gửi lên. Client chỉ gửi `recommendationId`; server
//    tự dựng lại dữ liệu tươi rồi tự tính lại mức ngân sách. Nếu nhận số từ
//    client thì bất kỳ ai gọi được API cũng đặt được ngân sách tùy ý.
// 2. Ghi xong mới đổi trạng thái. Google từ chối thì trả lỗi thật và KHÔNG
//    chuyển đề xuất sang "đã áp dụng", KHÔNG ghi lưu vết. Repo này từng có
//    `executeFunction` in "đã được thực thi trên server" mà không gọi API nào
//    (gỡ ở a49589c) — đây là lằn ranh không lặp lại.
// 3. Tái dùng đúng cách ghi của app/api/google/campaigns/[id]/budget (resolve
//    campaign_budget.resource_name rồi campaignBudgets.update) thay vì dựng
//    đường ghi thứ hai sẽ lệch dần với đường kia.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, canAccessCompany } from "@/lib/permissions";
import { getGoogleAdsCustomer } from "@/lib/google-ads-client";
import { parsePMaxDateRange } from "@/lib/google-pmax-client";
import { buildCampaignOverviews } from "@/lib/pmax-insights/build-overview";
import { computeBudgetProposal, MAX_DAILY_BUDGET_VND } from "@/lib/pmax-insights/budget-rule";
import { getRecommendationById, updateRecommendationState } from "@/lib/pmax-insights/store";
import { checkRecentCampaignMutation, recordCampaignMutation } from "@/lib/mutation-guard";
import { recordBudgetApply, lastApplyFor, APPLY_COOLDOWN_DAYS } from "@/lib/pmax-insights/budget-apply-log";

import { googleAdsErrorMessage } from "@/lib/google-ads-error";
import { friendlyError } from "@/lib/not-configured";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_manage_budget")) {
    return NextResponse.json({ success: false, error: "Không có quyền chỉnh ngân sách" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { recommendationId?: string };
  const recommendationId = String(body.recommendationId ?? "");
  if (!recommendationId) {
    return NextResponse.json({ success: false, error: "Thiếu recommendationId" }, { status: 400 });
  }

  const rec = await getRecommendationById(recommendationId);
  if (!rec) return NextResponse.json({ success: false, error: "Không tìm thấy đề xuất" }, { status: 404 });
  if (!canAccessCompany(user, rec.company)) {
    return NextResponse.json({ success: false, error: "Không có quyền với công ty này" }, { status: 403 });
  }
  if (rec.type !== "scale_carefully") {
    return NextResponse.json({ success: false, error: "Đề xuất này không phải loại tăng ngân sách" }, { status: 400 });
  }
  if (rec.reviewState === "applied") {
    return NextResponse.json({ success: false, error: "Đề xuất này đã được áp dụng" }, { status: 409 });
  }

  // Cooldown: đã đổi rồi thì phải có thời gian đo, đúng như guardrail mà chính
  // thẻ đề xuất đang dặn (theo dõi ROAS 7-14 ngày sau khi đổi).
  const last = await lastApplyFor(rec.campaignId, rec.company);
  if (last) {
    const days = (Date.now() - Date.parse(last.appliedAt)) / 86400000;
    if (days < APPLY_COOLDOWN_DAYS) {
      return NextResponse.json({
        success: false,
        error: `Campaign này vừa được đổi ngân sách ${Math.floor(days)} ngày trước (${last.beforeVnd.toLocaleString("vi-VN")}đ → ${last.afterVnd.toLocaleString("vi-VN")}đ). Chờ đủ ${APPLY_COOLDOWN_DAYS} ngày để đo kết quả rồi hãy đổi tiếp.`,
      }, { status: 409 });
    }
  }

  // Hệ thống tự động khác vừa sửa campaign này thì dừng — tránh hai bên cùng
  // đẩy ngân sách mà không biết nhau.
  const conflict = checkRecentCampaignMutation(rec.campaignId, rec.company, "human_manual");
  if (conflict.hasConflict) {
    return NextResponse.json({ success: false, error: conflict.note ?? "Campaign vừa được hệ thống khác sửa" }, { status: 409 });
  }

  try {
    // Tính lại từ dữ liệu TƯƠI, không dùng con số đã lưu trong đề xuất (đề xuất
    // có thể được sinh từ hôm trước, ngân sách/ROAS đã khác).
    const range = parsePMaxDateRange(null, null);
    const campaigns = await buildCampaignOverviews(rec.company, range);
    const campaign = campaigns.find((c) => c.campaignId === rec.campaignId);
    if (!campaign) {
      return NextResponse.json({ success: false, error: "Không tìm thấy campaign trên Google Ads" }, { status: 404 });
    }

    const fresh = computeBudgetProposal({
      recommendationStatus: campaign.recommendationStatus,
      confidence: campaign.scores.confidence,
      roasTotal: campaign.metrics.roasTotal,
      avgRoasTotal: campaign.accountAvgRoas,
      trendPct: campaign.metrics.trendPct,
      trendLowBaseline: campaign.metrics.trendLowBaseline,
      dailyBudgetVnd: campaign.metrics.dailyBudgetVnd,
      totalDays: campaign.metrics.totalDays,
    });

    if (!fresh.eligible || !fresh.proposal) {
      return NextResponse.json({
        success: false,
        error: `Số liệu hiện tại không còn đủ điều kiện tăng ngân sách: ${fresh.reason ?? "không rõ"}`,
      }, { status: 409 });
    }

    const { currentVnd, proposedVnd } = fresh.proposal;
    if (proposedVnd > MAX_DAILY_BUDGET_VND || proposedVnd < 10_000) {
      return NextResponse.json({ success: false, error: "Mức ngân sách tính ra nằm ngoài ngưỡng cho phép" }, { status: 400 });
    }

    // ── Ghi thật ──
    const customer = getGoogleAdsCustomer(rec.company);
    const rows = await customer.query(`
      SELECT campaign_budget.resource_name FROM campaign WHERE campaign.id = ${Number(rec.campaignId)}
    `);
    const budgetResourceName = rows[0]?.campaign_budget?.resource_name as string | undefined;
    if (!budgetResourceName) {
      return NextResponse.json({ success: false, error: "Không tìm thấy ngân sách của campaign này" }, { status: 404 });
    }

    await customer.campaignBudgets.update([{
      resource_name: budgetResourceName,
      amount_micros: proposedVnd * 1_000_000,
    }]);

    // Chỉ tới đây — sau khi Google đã nhận — mới ghi vết và đổi trạng thái.
    await recordBudgetApply({
      recommendationId,
      campaignId: rec.campaignId,
      campaignName: rec.campaignName,
      company: rec.company,
      beforeVnd: currentVnd,
      afterVnd: proposedVnd,
      basis: fresh.proposal.basis,
      appliedBy: user.email,
    });
    recordCampaignMutation({
      campaignId: rec.campaignId,
      campaignName: rec.campaignName,
      company: rec.company,
      source: { type: "human_manual", actor: user.email },
      event: "budget.increase",
      rationale: `PMax Advisor: ${fresh.proposal.basis.join("; ")}`,
      notes: `₫${currentVnd.toLocaleString("vi-VN")}/ngày → ₫${proposedVnd.toLocaleString("vi-VN")}/ngày`,
    });
    await updateRecommendationState(recommendationId, "applied", user.email);

    return NextResponse.json({ success: true, beforeVnd: currentVnd, afterVnd: proposedVnd, deltaPct: fresh.proposal.deltaPct });
  } catch (err) {
    const message = googleAdsErrorMessage(err);
    console.error("[pmax/apply-budget]", message);
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 500 });
  }
}
