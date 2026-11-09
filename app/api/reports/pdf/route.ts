// ============================================================
// POST /api/reports/pdf
// ============================================================
// app/(dashboard)/reports/page.tsx has always POSTed here for export
// — the directory existed with no route.ts, so this 404'd. Reuses the
// already-built (but previously unwired) lib/report-pdf.tsx component,
// same @react-pdf/renderer pattern as lib/ads-content-pdf.tsx.

import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getCurrentUser } from "@/lib/auth";
import { gatherReportData, addReportHistory, type ReportConfig } from "@/lib/report-generator";
import { toReportPDFProps } from "@/lib/report-pdf-adapter";
import { ReportPDF } from "@/lib/report-pdf";
import { friendlyError } from "@/lib/not-configured";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let config: ReportConfig;
  try {
    const body = await req.json();
    config = {
      type: "pdf",
      period: body.period,
      company: body.company ?? "ALL",
      sections: body.sections ?? { summary: true, campaigns: true, cpl: true, budget_history: false, ai_insights: false },
      generated_by: user.email,
    };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const data = await gatherReportData(config);
    const buffer = await renderToBuffer(ReportPDF(toReportPDFProps(data)));

    await addReportHistory({
      id: `RPT_${Date.now()}`,
      name: `Báo cáo ${config.company} ${config.period.start} → ${config.period.end}`,
      company: config.company,
      format: "pdf",
      period: `${config.period.start} → ${config.period.end}`,
      generated_by: user.email,
      generated_at: new Date().toISOString(),
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="BaoCao-${config.company}-${config.period.start}.pdf"`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[reports/pdf] error:", message);
    return NextResponse.json({ error: friendlyError(message) }, { status: 500 });
  }
}
