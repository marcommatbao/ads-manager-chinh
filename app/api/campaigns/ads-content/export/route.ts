// ============================================================
// Ads Content — Excel Export
// ============================================================
// POST body: { items: CreativeItem[] }
// The client sends the already-filtered/selected item list it has
// in state (for both "export current view" and "export selected"),
// so the export always matches what's on screen — no server-side
// re-derivation of filter logic.
//
// CPL/Conversions are not tracked per-creative in this pipeline
// (Meta/Google Ads insight fetch doesn't request conversion actions
// here) — those columns are included for the operations template but
// always render "—" rather than a fabricated number.

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import type { CreativeItem } from "@/types/creative-content.types";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let items: CreativeItem[];
  try {
    const body = await req.json();
    items = Array.isArray(body.items) ? body.items : [];
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Ads Content");

  sheet.columns = [
    { header: "Campaign", key: "campaignName", width: 32 },
    { header: "Company", key: "company", width: 10 },
    { header: "Platform", key: "platform", width: 16 },
    { header: "Subtype", key: "subtype", width: 12 },
    { header: "Objective", key: "objective", width: 16 },
    { header: "Creative Name", key: "name", width: 32 },
    { header: "Headline", key: "headline", width: 32 },
    { header: "Primary Text", key: "primaryText", width: 40 },
    { header: "Descriptions", key: "descriptions", width: 40 },
    { header: "Status", key: "status", width: 12 },
    { header: "Badges", key: "badges", width: 24 },
    { header: "Spend", key: "spend", width: 14 },
    { header: "Clicks", key: "clicks", width: 10 },
    { header: "Impressions", key: "impressions", width: 14 },
    { header: "CTR (%)", key: "ctr", width: 10 },
    { header: "CPC", key: "cpc", width: 12 },
    { header: "CPL", key: "cpl", width: 12 },
    { header: "Conversions", key: "conversions", width: 12 },
    { header: "First Active", key: "firstActiveDate", width: 14 },
    { header: "Last Active", key: "lastActiveDate", width: 14 },
    { header: "Final URL", key: "finalUrl", width: 36 },
  ];
  sheet.getRow(1).font = { bold: true };

  const PLATFORM_LABEL: Record<CreativeItem["platform"], string> = {
    facebook: "Facebook",
    google_search: "Google Search",
    google_pmax: "Google PMax",
  };

  for (const item of items) {
    const hasMetrics = item.metrics.metricsAvailable;
    const clicks = hasMetrics ? item.metrics.clicks : null;
    const spend = hasMetrics ? item.metrics.spend : null;

    sheet.addRow({
      campaignName: item.campaignName,
      company: item.company,
      platform: PLATFORM_LABEL[item.platform] ?? item.platform,
      subtype: item.raw.subtype,
      objective: item.campaignObjective ?? "",
      name: item.name,
      headline: item.headline ?? "",
      primaryText: item.primaryText ?? "",
      descriptions: (item.descriptions ?? []).join(" | "),
      status: item.status,
      badges: item.badges.join(", "),
      spend,
      clicks,
      impressions: hasMetrics ? item.metrics.impressions ?? null : null,
      ctr: hasMetrics ? item.metrics.ctr ?? null : null,
      cpc: hasMetrics && clicks && clicks > 0 ? (spend ?? 0) / clicks : "—",
      cpl: "—", // conversions not tracked per-creative — see file header
      conversions: "—",
      firstActiveDate: item.firstActiveDate,
      lastActiveDate: item.lastActiveDate,
      finalUrl: item.finalUrl ?? "",
    });
  }

  sheet.getColumn("spend").numFmt = "#,##0";
  sheet.getColumn("cpc").numFmt = "#,##0";
  sheet.getColumn("ctr").numFmt = "0.00";

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ads-content-${new Date().toISOString().split("T")[0]}.xlsx"`,
    },
  });
}
