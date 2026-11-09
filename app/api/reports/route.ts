// ============================================================
// Report Aggregator — Cross-Platform Data + History
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { getReportHistory } from "@/lib/report-generator";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");

    // Report history
    if (action === "history") {
      const history = await getReportHistory();
      return NextResponse.json({ success: true, data: history });
    }

    const from =
      searchParams.get("from") ??
      new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
    const to =
      searchParams.get("to") ?? new Date().toISOString().split("T")[0];

    const baseUrl = request.nextUrl.origin;

    // Fetch data from both platform endpoints in parallel
    const [metaResult, googleResult] = await Promise.allSettled([
      axios
        .get(`${baseUrl}/api/meta`, {
          params: { type: "insights", from, to },
        })
        .then((r) => r.data),
      axios
        .get(`${baseUrl}/api/google`, {
          params: { type: "metrics", from, to },
        })
        .then((r) => r.data),
    ]);

    // null vì "nền tảng hỏng" và null vì "đúng là không có dữ liệu" nhìn y hệt
    // nhau ở phía người gọi. Ghi lỗi ra một trường riêng để phân biệt được.
    const sourceErrors: string[] = [];
    const metaData =
      metaResult.status === "fulfilled" ? metaResult.value : null;
    if (metaResult.status === "rejected") {
      const msg = metaResult.reason instanceof Error ? metaResult.reason.message : String(metaResult.reason);
      console.error("[reports] nguồn Meta lỗi:", msg);
      sourceErrors.push(`Meta: ${msg}`);
    }
    const googleData =
      googleResult.status === "fulfilled" ? googleResult.value : null;
    if (googleResult.status === "rejected") {
      const msg = googleResult.reason instanceof Error ? googleResult.reason.message : String(googleResult.reason);
      console.error("[reports] nguồn Google lỗi:", msg);
      sourceErrors.push(`Google: ${msg}`);
    }

    return NextResponse.json({
      meta: metaData,
      google: googleData,
      // Rỗng = cả hai nguồn đều lấy được. Có phần tử = nguồn đó null vì HỎNG,
      // không phải vì "không có dữ liệu".
      sourceErrors,
      dateRange: { from, to },
      generatedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Report aggregation failed: ${message}` },
      { status: 500 }
    );
  }
}

