// ============================================================
// Reports — ReportData -> ReportPDFProps adapter
// ============================================================
// lib/report-pdf.tsx (ReportPDF, a full @react-pdf/renderer component)
// existed fully built but was never wired to a route — its prop shape
// doesn't match lib/report-generator.ts's ReportData 1:1 (it wants a
// combined/facebook/google split with `connected` flags), so this
// adapter bridges the two instead of duplicating either.
//
// gatherReportData() only pulls Meta (Facebook) data — there is no
// Google Ads fetch in the report pipeline. Rather than fabricate a
// Google summary, this reports google as { connected: false, summary:
// null }, which ReportPDF already renders gracefully ("Chưa kết nối").
// Real Google Ads data in Reports is a real gap, not fixed here — this
// only makes the existing Facebook data reachable via a working export.

import type { ReportData } from "./report-generator";
import type { ReportPDFProps, PDFCampaign } from "./report-pdf";

export function toReportPDFProps(data: ReportData): ReportPDFProps {
  const avgCTR = data.summary.total_impressions > 0
    ? (data.summary.total_clicks / data.summary.total_impressions) * 100
    : 0;

  const topCampaigns: PDFCampaign[] = [...data.campaigns]
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10)
    .map((c) => ({
      id: c.id,
      name: c.name,
      platform: "facebook",
      status: c.status,
      metrics: {
        spend: c.spend,
        roas: c.roas,
        ctr: c.ctr,
        cpc: c.cpc,
        impressions: c.impressions,
        clicks: c.clicks,
      },
    }));

  return {
    period: { from: data.config.period.start, to: data.config.period.end },
    dataGaps: data.dataGaps,
    combined: {
      totalSpend: data.summary.total_spend,
      totalRevenue: 0, // not tracked anywhere in ReportData — honestly 0, not fabricated
      avgROAS: data.summary.avg_roas,  // null = chưa đo được, xem ReportData
      avgCTR,
      totalImpressions: data.summary.total_impressions,
      totalClicks: data.summary.total_clicks,
      platformSplit: {
        facebook: { spend: data.summary.total_spend, pct: 100 },
        google: { spend: 0, pct: 0 },
      },
    },
    facebook: {
      connected: true,
      summary: {
        totalSpend: data.summary.total_spend,
        totalRevenue: 0,
        avgROAS: data.summary.avg_roas,
        avgCTR,
        totalImpressions: data.summary.total_impressions,
        totalClicks: data.summary.total_clicks,
        activeCampaigns: data.summary.active_campaigns,
      },
    },
    google: { connected: false, summary: null },
    topCampaigns,
    aiInsights: null,
    currency: "VND",
  };
}
