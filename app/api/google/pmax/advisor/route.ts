// GET   /api/google/pmax/advisor?company=MBC|MBI — list recommendations
//       (regenerates content from live scores, preserves review state)
// PATCH /api/google/pmax/advisor — update a recommendation's review state
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { buildCampaignOverviews } from "@/lib/pmax-insights/build-overview";
import {
  generateRecommendation,
  fingerprintCampaign,
  needsRedraft,
} from "@/lib/pmax-insights/advisor";
import { getRecommendations } from "@/lib/pmax-insights/store";
import { computeBudgetProposal } from "@/lib/pmax-insights/budget-rule";
import { upsertRecommendations, updateRecommendationState, getRecommendationById } from "@/lib/pmax-insights/store";
import { parsePMaxDateRange } from "@/lib/google-pmax-client";
import type { RecommendationReviewState } from "@/lib/pmax-insights/types";
import { pickCompany } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

export const maxDuration = 45;

const VALID_STATES: RecommendationReviewState[] = ["unread", "reviewed", "drafted", "dismissed", "watching"];

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const company = pickCompany(req.nextUrl.searchParams.get("company"));
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }
  const range = parsePMaxDateRange(req.nextUrl.searchParams.get("from"), req.nextUrl.searchParams.get("to"));

  try {
    const campaigns = await buildCampaignOverviews(company, range);
    if (campaigns.length === 0) return NextResponse.json({ success: true, data: [] });

    // Chỉ gọi Gemini cho campaign có số liệu ĐÃ ĐỔI (hoặc bản nháp quá 24h).
    // Trước đây mỗi lần mở tab là 1 lượt gọi cho MỖI campaign — 6 campaign là 6
    // lượt, đổi khoảng ngày lại 6 lượt nữa, không có cache. Cùng gốc với hai sự
    // cố vượt hạn mức API hôm nay: không ai đang đo lưu lượng gọi ra ngoài.
    const previous = await getRecommendations(company);
    const existing = new Map(previous.map((r) => [r.campaignId, r]));

    let redrawn = 0;
    const fresh = await Promise.all(campaigns.map(async (c) => {
      const fp = fingerprintCampaign(c);
      const prev = existing.get(c.campaignId);

      if (!needsRedraft(prev, fp)) {
        // Dùng lại câu chữ cũ, nhưng con số ngân sách thì TÍNH LẠI — số do luật
        // sinh, không tốn gì, và phải luôn khớp dữ liệu mới nhất.
        const budget = prev!.type === "scale_carefully"
          ? computeBudgetProposal({
              recommendationStatus: c.recommendationStatus,
              confidence: c.scores.confidence,
              roasTotal: c.metrics.roasTotal,
              avgRoasTotal: c.accountAvgRoas,
              trendPct: c.metrics.trendPct,
              trendLowBaseline: c.metrics.trendLowBaseline,
              dailyBudgetVnd: c.metrics.dailyBudgetVnd,
              totalDays: c.metrics.totalDays,
            })
          : { eligible: false, proposal: null, reason: null };

        const { id, reviewState, createdAt, reviewedAt, reviewedBy, ...rest } = prev!;
        void id; void reviewState; void createdAt; void reviewedAt; void reviewedBy;
        return {
          ...rest,
          budgetProposal: budget.proposal,
          budgetBlockedReason: budget.eligible ? null : budget.reason,
        };
      }

      redrawn++;
      return generateRecommendation(c, company);
    }));

    if (redrawn > 0) {
      console.log(`[pmax/advisor] soạn lại ${redrawn}/${campaigns.length} thẻ (số còn lại dùng lại bản cũ)`);
    }
    const saved = await upsertRecommendations(company, fresh);
    const sorted = [...saved].sort((a, b) => {
      const order = { now: 0, test: 1, watch: 2 };
      return order[a.priority] - order[b.priority];
    });
    return NextResponse.json({ success: true, data: sorted });
  } catch (err) {
    console.error("[pmax/advisor GET]", err);
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const id = typeof body.id === "string" ? body.id : null;
  const reviewState = body.reviewState as RecommendationReviewState;
  if (!id || !VALID_STATES.includes(reviewState)) {
    return NextResponse.json({ success: false, error: "Missing id or invalid reviewState" }, { status: 400 });
  }

  const existing = await getRecommendationById(id);
  if (!existing) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  if (!canAccessCompany(user, existing.company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }

  const updated = await updateRecommendationState(id, reviewState, user.email);
  return NextResponse.json({ success: true, data: updated });
}
