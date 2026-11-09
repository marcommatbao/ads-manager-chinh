// ============================================================
// AdsCommand — PDF Report Template
// Uses @react-pdf/renderer to generate an A4 PDF
// ============================================================

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

// ─────────────────────────────────────────────
// Types (minimal copy — avoids importing from client files)
// ─────────────────────────────────────────────

export interface PDFPlatformSummary {
  totalSpend: number;
  totalRevenue: number;
  /** null = chưa đo được doanh thu. Hiện "—", không hiện 0.00x. */
  avgROAS: number | null;
  avgCTR: number;
  totalImpressions: number;
  totalClicks: number;
  activeCampaigns: number;
}

export interface PDFCampaign {
  id: string;
  name: string;
  platform: string;
  status: string;
  metrics: {
    spend: number;
    /** null = chưa đo được doanh thu. Phải hiện "—", KHÔNG hiện 0.0x đỏ. */
    roas: number | null;
    ctr: number;
    cpc: number;
    impressions: number;
    clicks: number;
  };
}

export interface ReportPDFProps {
  period: { from: string; to: string };
  /** Nguồn dữ liệu lấy hụt — in ngay đầu báo cáo để người nhận không đọc
   *  bảng trống thành "không chạy quảng cáo". */
  dataGaps?: string[];
  combined: {
    totalSpend: number;
    totalRevenue: number;
    avgROAS: number | null;
    avgCTR: number;
    totalImpressions: number;
    totalClicks: number;
    platformSplit: {
      facebook: { spend: number; pct: number };
      google: { spend: number; pct: number };
    };
  };
  facebook: {
    connected: boolean;
    summary: PDFPlatformSummary | null;
  };
  google: {
    connected: boolean;
    summary: PDFPlatformSummary | null;
  };
  topCampaigns: PDFCampaign[];
  aiInsights?: {
    overview: string;
    increaseBudget: string[];
    pauseOrOptimize: string[];
    nextMonthStrategy: string;
  } | null;
  currency?: string;
}

// ─────────────────────────────────────────────
// Format helpers (PDF-safe — no DOM)
// ─────────────────────────────────────────────

function fmtVND(v: number): string {
  if (v >= 1_000_000_000) return `₫${(v / 1_000_000_000).toFixed(1)}T`;
  if (v >= 1_000_000) return `₫${(v / 1_000_000).toFixed(1)}Tr`;
  if (v >= 1_000) return `₫${(v / 1_000).toFixed(0)}K`;
  return `₫${Math.round(v)}`;
}

function fmtMoney(v: number, currency = "USD"): string {
  if (currency === "VND") return fmtVND(v);
  return `$${v.toFixed(2)}`;
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────

const C = {
  blue: "#1877F2",
  red: "#EA4335",
  dark: "#0F172A",
  mid: "#475569",
  light: "#94A3B8",
  bg: "#F8FAFC",
  border: "#E2E8F0",
  green: "#16A34A",
  amber: "#D97706",
  purple: "#7C3AED",
  white: "#FFFFFF",
};

const styles = StyleSheet.create({
  page: {
    backgroundColor: C.white,
    fontFamily: "Helvetica",
    fontSize: 9,
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 40,
    color: C.dark,
  },
  // ── Header ──
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: C.blue,
  },
  headerLeft: { flexDirection: "column", gap: 3 },
  headerBrand: { fontSize: 18, fontFamily: "Helvetica-Bold", color: C.blue },
  headerSubtitle: { fontSize: 10, color: C.mid, marginTop: 2 },
  headerPeriod: { fontSize: 9, color: C.light, marginTop: 1 },
  headerRight: { flexDirection: "column", alignItems: "flex-end", gap: 3 },
  headerDate: { fontSize: 8, color: C.light },

  // ── Sections ──
  section: { marginBottom: 18 },
  sectionTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: C.light,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },

  // ── Metric grid ──
  metricGrid: { flexDirection: "row", gap: 8, marginBottom: 4 },
  metricBox: {
    flex: 1,
    backgroundColor: C.bg,
    borderRadius: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  metricLabel: { fontSize: 7.5, color: C.light, marginBottom: 3 },
  metricValue: { fontSize: 14, fontFamily: "Helvetica-Bold", color: C.dark },
  metricSub: { fontSize: 7.5, color: C.mid, marginTop: 2 },

  // ── Platform row ──
  platformRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 4,
  },
  platformCard: {
    flex: 1,
    backgroundColor: C.bg,
    borderRadius: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  platformHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  platformDot: { width: 8, height: 8, borderRadius: 4 },
  platformName: { fontSize: 9, fontFamily: "Helvetica-Bold", color: C.dark },
  platformMetric: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  platformMetricLabel: { fontSize: 8, color: C.mid },
  platformMetricValue: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.dark },

  // ── Table ──
  table: { borderWidth: 1, borderColor: C.border, borderRadius: 4, overflow: "hidden" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border },
  tableHead: { backgroundColor: C.bg },
  tableCell: { flex: 1, padding: "5 6", fontSize: 7.5 },
  tableCellBold: { fontFamily: "Helvetica-Bold", color: C.dark },
  tableCellMid: { color: C.mid },
  tableCellRight: { textAlign: "right" },
  tableRowLast: { borderBottomWidth: 0 },

  // ── Split bar ──
  splitBarContainer: { marginTop: 8 },
  splitBarRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  splitBarLabel: { fontSize: 8 },
  splitBarBg: { height: 6, backgroundColor: C.border, borderRadius: 3, overflow: "hidden" },
  splitBarFill: { height: 6, borderRadius: 3, backgroundColor: C.blue },

  // ── AI ──
  aiBlock: {
    backgroundColor: C.bg,
    borderRadius: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 8,
  },
  aiBlockTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.mid, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 },
  aiText: { fontSize: 8.5, color: C.dark, lineHeight: 1.6 },
  aiListItem: { flexDirection: "row", gap: 5, marginBottom: 3 },
  aiListBullet: { fontSize: 8.5, color: C.mid, width: 10 },
  aiListText: { fontSize: 8.5, color: C.dark, flex: 1 },

  // ── Footer ──
  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontSize: 7, color: C.light },
});

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function MetricBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      {sub && <Text style={styles.metricSub}>{sub}</Text>}
    </View>
  );
}

function PlatformMetricRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.platformMetric}>
      <Text style={styles.platformMetricLabel}>{label}</Text>
      <Text style={styles.platformMetricValue}>{value}</Text>
    </View>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

// ─────────────────────────────────────────────
// Table header / row helpers
// ─────────────────────────────────────────────

const COL_WIDTHS = {
  name: 2.2,
  platform: 0.8,
  status: 0.7,
  spend: 1,
  roas: 0.7,
  ctr: 0.7,
  cpc: 0.9,
  impressions: 1,
};

function TableHeaderRow() {
  const headers = [
    { key: "name", label: "Tên chiến dịch", flex: COL_WIDTHS.name },
    { key: "platform", label: "Platform", flex: COL_WIDTHS.platform },
    { key: "status", label: "Status", flex: COL_WIDTHS.status },
    { key: "spend", label: "Chi tiêu", flex: COL_WIDTHS.spend },
    { key: "roas", label: "ROAS", flex: COL_WIDTHS.roas },
    { key: "ctr", label: "CTR", flex: COL_WIDTHS.ctr },
    { key: "cpc", label: "CPC", flex: COL_WIDTHS.cpc },
    { key: "imp", label: "Impressions", flex: COL_WIDTHS.impressions },
  ];
  return (
    <View style={[styles.tableRow, styles.tableHead]}>
      {headers.map(h => (
        <View key={h.key} style={[styles.tableCell, { flex: h.flex }]}>
          <Text style={[styles.tableCellBold, { fontSize: 7 }]}>{h.label.toUpperCase()}</Text>
        </View>
      ))}
    </View>
  );
}

function CampaignRow({ campaign, isLast, currency }: { campaign: PDFCampaign; isLast: boolean; currency: string }) {
  const m = campaign.metrics;
  return (
    <View style={[styles.tableRow, isLast ? styles.tableRowLast : {}]}>
      <View style={[styles.tableCell, { flex: COL_WIDTHS.name }]}>
        <Text style={styles.tableCellBold}>{campaign.name}</Text>
      </View>
      <View style={[styles.tableCell, { flex: COL_WIDTHS.platform }]}>
        <Text style={[styles.tableCellMid, { color: campaign.platform === "facebook" ? C.blue : C.red }]}>
          {campaign.platform === "facebook" ? "FB" : "GG"}
        </Text>
      </View>
      <View style={[styles.tableCell, { flex: COL_WIDTHS.status }]}>
        <Text style={[styles.tableCellMid, { color: campaign.status === "ACTIVE" ? C.green : C.amber }]}>
          {campaign.status === "ACTIVE" ? "Active" : "Paused"}
        </Text>
      </View>
      <View style={[styles.tableCell, { flex: COL_WIDTHS.spend, ...styles.tableCellRight as object }]}>
        <Text style={styles.tableCellBold}>{fmtMoney(m.spend, currency)}</Text>
      </View>
      <View style={[styles.tableCell, { flex: COL_WIDTHS.roas, ...styles.tableCellRight as object }]}>
        <Text style={[styles.tableCellMid, {
          color: m.roas === null ? C.mid : m.roas >= 3 ? C.green : m.roas < 1 ? C.red : C.mid,
        }]}>
          {/* Chưa đo được doanh thu thì nói thẳng là chưa đo được. Bản cũ
              hardcode roas = 0 nên mọi dòng đều đỏ "0.0x" — vu oan cho
              campaign đang lãi trước mặt quản lý và khách hàng. */}
          {m.roas === null ? "—" : `${m.roas.toFixed(1)}x`}
        </Text>
      </View>
      <View style={[styles.tableCell, { flex: COL_WIDTHS.ctr, ...styles.tableCellRight as object }]}>
        <Text style={styles.tableCellMid}>{m.ctr.toFixed(2)}%</Text>
      </View>
      <View style={[styles.tableCell, { flex: COL_WIDTHS.cpc, ...styles.tableCellRight as object }]}>
        <Text style={styles.tableCellMid}>{fmtMoney(m.cpc, currency)}</Text>
      </View>
      <View style={[styles.tableCell, { flex: COL_WIDTHS.impressions, ...styles.tableCellRight as object }]}>
        <Text style={styles.tableCellMid}>{m.impressions.toLocaleString()}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────
// Main PDF Document
// ─────────────────────────────────────────────

export function ReportPDF({
  period,
  dataGaps,
  combined,
  facebook,
  google,
  topCampaigns,
  aiInsights,
  currency = "VND",
}: ReportPDFProps) {
  const generatedAt = new Date().toLocaleString("vi-VN");
  const gaps = dataGaps ?? [];

  return (
    <Document
      title={`AdsCommand Report ${period.from} → ${period.to}`}
      author="AdsCommand"
    >
      <Page size="A4" style={styles.page}>

        {/* Cảnh báo thiếu dữ liệu — in TRƯỚC mọi bảng số. Người nhận file
            không có cách nào biết bảng trống là do lỗi hay do không chạy. */}
        {gaps.length > 0 && (
          <View style={{ backgroundColor: "#FEF3C7", borderRadius: 4, padding: 8, marginBottom: 10 }}>
            <Text style={{ fontSize: 9, color: "#92400E" }}>
              CẢNH BÁO: báo cáo này THIẾU {gaps.length} nguồn dữ liệu — số bên dưới chưa đầy đủ.
            </Text>
            {gaps.slice(0, 3).map((g, i) => (
              <Text key={i} style={{ fontSize: 7, color: "#92400E" }}>• {g}</Text>
            ))}
          </View>
        )}

        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerBrand}>⚡ AdsCommand</Text>
            <Text style={styles.headerSubtitle}>Báo cáo hiệu suất quảng cáo</Text>
            <Text style={styles.headerPeriod}>{period.from} → {period.to}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerDate}>Xuất lúc: {generatedAt}</Text>
          </View>
        </View>

        {/* ── Section 1: Tổng quan ── */}
        <View style={styles.section}>
          <SectionTitle>Tổng quan</SectionTitle>

          <View style={styles.metricGrid}>
            <MetricBox
              label="Tổng chi tiêu"
              value={fmtMoney(combined.totalSpend, currency)}
              sub={`FB ${combined.platformSplit.facebook.pct.toFixed(0)}% · GG ${combined.platformSplit.google.pct.toFixed(0)}%`}
            />
            <MetricBox
              label="Doanh thu"
              value={fmtMoney(combined.totalRevenue, currency)}
            />
            <MetricBox
              label="ROAS"
              value={combined.avgROAS === null ? "—" : `${combined.avgROAS.toFixed(2)}x`}
            />
          </View>

          <View style={styles.metricGrid}>
            <MetricBox
              label="Lượt hiển thị"
              value={combined.totalImpressions.toLocaleString()}
            />
            <MetricBox
              label="Lượt nhấp"
              value={combined.totalClicks.toLocaleString()}
            />
            <MetricBox
              label="CTR"
              value={`${combined.avgCTR.toFixed(2)}%`}
            />
          </View>

          {/* Split bar */}
          <View style={styles.splitBarContainer}>
            <View style={styles.splitBarRow}>
              <Text style={[styles.splitBarLabel, { color: C.blue }]}>
                Facebook {combined.platformSplit.facebook.pct.toFixed(0)}% — {fmtMoney(combined.platformSplit.facebook.spend, currency)}
              </Text>
              <Text style={[styles.splitBarLabel, { color: C.red }]}>
                Google {combined.platformSplit.google.pct.toFixed(0)}% — {fmtMoney(combined.platformSplit.google.spend, currency)}
              </Text>
            </View>
            <View style={styles.splitBarBg}>
              <View style={[styles.splitBarFill, { width: `${combined.platformSplit.facebook.pct}%` }]} />
            </View>
          </View>
        </View>

        {/* ── Section 2: Facebook + Google side-by-side ── */}
        <View style={styles.section}>
          <SectionTitle>Theo nền tảng</SectionTitle>
          <View style={styles.platformRow}>

            {/* Facebook */}
            <View style={[styles.platformCard, { borderLeftWidth: 3, borderLeftColor: C.blue }]}>
              <View style={styles.platformHeader}>
                <View style={[styles.platformDot, { backgroundColor: C.blue }]} />
                <Text style={styles.platformName}>Facebook Ads</Text>
                {!facebook.connected && (
                  <Text style={{ fontSize: 7, color: C.amber, marginLeft: "auto" }}>Chưa kết nối</Text>
                )}
              </View>
              {facebook.connected && facebook.summary ? (
                <>
                  <PlatformMetricRow label="Chi tiêu" value={fmtMoney(facebook.summary.totalSpend, currency)} />
                  <PlatformMetricRow label="Doanh thu" value={fmtMoney(facebook.summary.totalRevenue, currency)} />
                  <PlatformMetricRow label="ROAS" value={facebook.summary.avgROAS === null ? "—" : `${facebook.summary.avgROAS.toFixed(2)}x`} />
                  <PlatformMetricRow label="CTR" value={`${facebook.summary.avgCTR.toFixed(2)}%`} />
                  <PlatformMetricRow label="Lượt hiển thị" value={facebook.summary.totalImpressions.toLocaleString()} />
                  <PlatformMetricRow label="Lượt nhấp" value={facebook.summary.totalClicks.toLocaleString()} />
                  <PlatformMetricRow label="Chiến dịch active" value={String(facebook.summary.activeCampaigns)} />
                </>
              ) : (
                <Text style={{ fontSize: 8, color: C.light }}>Không có dữ liệu</Text>
              )}
            </View>

            {/* Google */}
            <View style={[styles.platformCard, { borderLeftWidth: 3, borderLeftColor: C.red }]}>
              <View style={styles.platformHeader}>
                <View style={[styles.platformDot, { backgroundColor: C.red }]} />
                <Text style={styles.platformName}>Google Ads</Text>
                {!google.connected && (
                  <Text style={{ fontSize: 7, color: C.amber, marginLeft: "auto" }}>Chưa kết nối</Text>
                )}
              </View>
              {google.connected && google.summary ? (
                <>
                  <PlatformMetricRow label="Chi tiêu" value={fmtMoney(google.summary.totalSpend, currency)} />
                  <PlatformMetricRow label="Doanh thu" value={fmtMoney(google.summary.totalRevenue, currency)} />
                  <PlatformMetricRow label="ROAS" value={google.summary.avgROAS === null ? "—" : `${google.summary.avgROAS.toFixed(2)}x`} />
                  <PlatformMetricRow label="CTR" value={`${google.summary.avgCTR.toFixed(2)}%`} />
                  <PlatformMetricRow label="Lượt hiển thị" value={google.summary.totalImpressions.toLocaleString()} />
                  <PlatformMetricRow label="Lượt nhấp" value={google.summary.totalClicks.toLocaleString()} />
                </>
              ) : (
                <Text style={{ fontSize: 8, color: C.light }}>Không có dữ liệu hoặc chưa kết nối</Text>
              )}
            </View>
          </View>
        </View>

        {/* ── Section 3: Top campaigns ── */}
        {topCampaigns.length > 0 && (
          <View style={styles.section}>
            <SectionTitle>Top {Math.min(topCampaigns.length, 10)} chiến dịch theo chi tiêu</SectionTitle>
            <View style={styles.table}>
              <TableHeaderRow />
              {topCampaigns.slice(0, 10).map((c, i) => (
                <CampaignRow
                  key={c.id}
                  campaign={c}
                  isLast={i === Math.min(topCampaigns.length, 10) - 1}
                  currency={currency}
                />
              ))}
            </View>
          </View>
        )}

        {/* ── Section 4: AI Insights ── */}
        {aiInsights && (
          <View style={styles.section}>
            <SectionTitle>Đánh giá & đề xuất (AI)</SectionTitle>

            <View style={styles.aiBlock}>
              <Text style={styles.aiBlockTitle}>Nhận xét tổng quan</Text>
              <Text style={styles.aiText}>{aiInsights.overview}</Text>
            </View>

            <View style={styles.platformRow}>
              <View style={[styles.aiBlock, { flex: 1, marginBottom: 0 }]}>
                <Text style={[styles.aiBlockTitle, { color: C.green }]}>Nên tăng ngân sách</Text>
                {aiInsights.increaseBudget.map((name, i) => (
                  <View key={i} style={styles.aiListItem}>
                    <Text style={styles.aiListBullet}>{i + 1}.</Text>
                    <Text style={styles.aiListText}>{name}</Text>
                  </View>
                ))}
              </View>
              <View style={[styles.aiBlock, { flex: 1, marginBottom: 0 }]}>
                <Text style={[styles.aiBlockTitle, { color: C.amber }]}>Nên tạm dừng / tối ưu</Text>
                {aiInsights.pauseOrOptimize.map((name, i) => (
                  <View key={i} style={styles.aiListItem}>
                    <Text style={styles.aiListBullet}>{i + 1}.</Text>
                    <Text style={styles.aiListText}>{name}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={[styles.aiBlock, { marginTop: 8 }]}>
              <Text style={[styles.aiBlockTitle, { color: C.purple }]}>Chiến lược tháng tới</Text>
              <Text style={styles.aiText}>{aiInsights.nextMonthStrategy}</Text>
            </View>
          </View>
        )}

        {/* ── Footer ── */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>AdsCommand — Báo cáo hiệu suất quảng cáo</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Trang ${pageNumber}/${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
