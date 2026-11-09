// ============================================================
// POST /api/google/keywords/add
// Add keywords to existing ad groups via Google Ads API
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany, hasPermission } from "@/lib/permissions";

import { googleAdsErrorMessage } from "@/lib/google-ads-error";
import { createdNames, guardedMutate, WriteGuardError } from "@/lib/write-guard";
import { GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client"
import { isCompany } from "@/lib/companies/registry";
import { friendlyError } from "@/lib/not-configured";
interface KeywordToAdd {
  keyword: string;
  matchType: "EXACT" | "PHRASE" | "BROAD";
  campaignId: string;
  adGroupId: string;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { company, keywords, validateOnly, confirmText } = (await req.json()) as {
      company: string;
      keywords: KeywordToAdd[];
      /** Đợt 11d: true = chỉ Kiểm trước. Ghi thật cần confirmText "XAC NHAN" (thiếu → 428). */
      validateOnly?: boolean;
      confirmText?: string;
    };

    // Authentication alone was the only gate here: `company` came from the
    // request body and went straight to getGoogleAdsCustomer(), so any
    // logged-in account — including read-only viewers — could write to
    // EITHER company's live Google Ads account. Both checks are required:
    // can_edit for the write, canAccessCompany for the tenant.
    if (!hasPermission(user.role, "can_edit")) {
      return NextResponse.json({ success: false, error: "Không có quyền chỉnh sửa từ khóa" }, { status: 403 });
    }
    if (!isCompany(company)) {
      return NextResponse.json({ success: false, error: "Công ty không có ở bản cài này" }, { status: 400 });
    }
    if (!canAccessCompany(user, company)) {
      return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
    }

    if (!keywords?.length) {
      return NextResponse.json(
        { success: false, error: "No keywords provided" },
        { status: 400 }
      );
    }

    const customerId = GOOGLE_CUSTOMER_IDS[company] || "";
    if (keywords.some((kw) => !/^\d+$/.test(String(kw.adGroupId)) || !String(kw.keyword ?? "").trim())) {
      return NextResponse.json({ success: false, error: "adGroupId / keyword không hợp lệ" }, { status: 400 });
    }

    // Đợt 11d: MỘT lệnh nguyên khối qua lớp ghi an toàn (Kiểm trước → XAC NHAN → ghi → lưu lệnh ngược để hoàn tác).
    const ops = keywords.map((kw) => ({
      entity: "ad_group_criterion",
      operation: "create" as const,
      resource: {
        ad_group: `customers/${customerId}/adGroups/${kw.adGroupId}`,
        status: "ENABLED",
        keyword: { text: kw.keyword.trim(), match_type: kw.matchType },
      },
    }));
    try {
      const r = await guardedMutate({
        company, source: "google-search/add-keyword", label: `Thêm ${keywords.length} từ khoá: ${keywords.slice(0, 3).map((k) => k.keyword).join(", ")}${keywords.length > 3 ? "…" : ""}`,
        ops, inverseOf: (resp) => createdNames(resp).filter((n): n is string => !!n).map((n) => ({ entity: "ad_group_criterion", operation: "remove" as const, resource: n })),
        validateOnly, confirmText, actor: user.email,
      });
      if (!r.entry) return NextResponse.json({ success: true, validated: true, added: 0, failed: 0, count: ops.length });
      return NextResponse.json({ success: true, added: ops.length, failed: 0, writeId: r.entry.id, results: keywords.map((kw) => ({ keyword: kw.keyword, success: true })) });
    } catch (e) {
      if (e instanceof WriteGuardError) return NextResponse.json({ success: false, error: friendlyError(e.message), needsConfirm: e.status === 428, validated: e.validated }, { status: e.status });
      throw e;
    }
  } catch (err) {
    const msg = googleAdsErrorMessage(err);
    console.error("[keywords/add] Error:", msg);
    return NextResponse.json({ success: false, error: friendlyError(msg) }, { status: 500 });
  }
}
