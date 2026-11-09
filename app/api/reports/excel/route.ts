// ============================================================
// POST /api/reports/excel
// ============================================================
// Same 404 history as /api/reports/pdf — directory existed with no
// route.ts. No prebuilt Excel component exists for Reports, so this
// follows the exceljs pattern from
// app/api/campaigns/ads-content/export/route.ts directly.

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { gatherReportData, addReportHistory, type ReportConfig } from "@/lib/report-generator";
import { friendlyError } from "@/lib/not-configured";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let config: ReportConfig;
  try {
    const body = await req.json();
    config = {
      type: "excel",
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

    const workbook = new ExcelJS.Workbook();

    const summarySheet = workbook.addWorksheet("Tổng quan");
    summarySheet.columns = [
      { header: "Chỉ số", key: "label", width: 28 },
      { header: "Giá trị", key: "value", width: 20 },
    ];
    summarySheet.getRow(1).font = { bold: true };
    summarySheet.addRows([
      { label: "Kỳ báo cáo", value: `${data.config.period.start} → ${data.config.period.end}` },
      { label: "Công ty", value: data.config.company },
      { label: "Tổng chi tiêu (Facebook)", value: Math.round(data.summary.total_spend) },
      { label: "Tổng leads", value: data.summary.total_leads },
      { label: "CPL trung bình", value: Math.round(data.summary.avg_cpl) },
      { label: "Impressions", value: data.summary.total_impressions },
      { label: "Clicks", value: data.summary.total_clicks },
      { label: "Chiến dịch đang chạy", value: data.summary.active_campaigns },
      { label: "MBC — Chi tiêu", value: Math.round(data.mbc_summary.spend) },
      { label: "MBC — Leads", value: data.mbc_summary.leads },
      { label: "MBI — Chi tiêu", value: Math.round(data.mbi_summary.spend) },
      { label: "MBI — Leads", value: data.mbi_summary.leads },
    ]);

    const campaignSheet = workbook.addWorksheet("Chiến dịch");
    campaignSheet.columns = [
      { header: "Campaign", key: "name", width: 32 },
      { header: "Company", key: "company", width: 10 },
      { header: "Status", key: "status", width: 12 },
      { header: "Spend", key: "spend", width: 14 },
      { header: "Impressions", key: "impressions", width: 14 },
      { header: "Clicks", key: "clicks", width: 10 },
      { header: "CTR (%)", key: "ctr", width: 10 },
      { header: "CPC", key: "cpc", width: 12 },
      { header: "Conversions", key: "conversions", width: 12 },
      { header: "CPL", key: "cpl", width: 12 },
    ];
    campaignSheet.getRow(1).font = { bold: true };
    for (const c of data.campaigns) {
      campaignSheet.addRow({
        name: c.name,
        company: c.company ?? "—",
        status: c.status,
        spend: Math.round(c.spend),
        impressions: c.impressions,
        clicks: c.clicks,
        ctr: Math.round(c.ctr * 100) / 100,
        cpc: Math.round(c.cpc),
        conversions: c.conversions,
        cpl: Math.round(c.cpl),
      });
    }
    campaignSheet.getColumn("spend").numFmt = "#,##0";
    campaignSheet.getColumn("cpc").numFmt = "#,##0";
    campaignSheet.getColumn("cpl").numFmt = "#,##0";

    const buffer = await workbook.xlsx.writeBuffer();

    await addReportHistory({
      id: `RPT_${Date.now()}`,
      name: `Báo cáo ${config.company} ${config.period.start} → ${config.period.end}`,
      company: config.company,
      format: "excel",
      period: `${config.period.start} → ${config.period.end}`,
      generated_by: user.email,
      generated_at: new Date().toISOString(),
    });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="BaoCao-${config.company}-${config.period.start}.xlsx"`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[reports/excel] error:", message);
    return NextResponse.json({ error: friendlyError(message) }, { status: 500 });
  }
}
