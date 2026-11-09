// ============================================================
// Ads Content — PDF Export Template
// Uses @react-pdf/renderer to generate an A4 PDF grouped by campaign.
// Mirrors lib/report-pdf.tsx conventions (own format helpers, no
// imports from client files/store).
// ============================================================

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { CampaignCreativeGroup, CreativeItem, CreativeSourcePlatform } from "@/types/creative-content.types";
import type { AdsContentFilters } from "@/lib/ads-content/filtering";

export interface AdsContentPDFProps {
  month: string;
  groups: CampaignCreativeGroup[];
  currency?: string;
  filters?: Partial<AdsContentFilters>;
}

// ─────────────────────────────────────────────
// Applied-filters summary (manager readability)
// ─────────────────────────────────────────────

function formatAppliedFilters(filters?: Partial<AdsContentFilters>): string | null {
  if (!filters) return null;
  const parts: string[] = [];
  if (filters.platform && filters.platform !== "all") parts.push(`Platform: ${filters.platform}`);
  if (filters.creativeType && filters.creativeType !== "all") parts.push(`Type: ${filters.creativeType}`);
  if (filters.company && filters.company !== "all") parts.push(`Company: ${filters.company}`);
  if (filters.status && filters.status !== "all") parts.push(`Status: ${filters.status}`);
  if (filters.objective && filters.objective !== "all") parts.push(`Objective: ${filters.objective}`);
  if (filters.product && filters.product !== "all") parts.push(`Product: ${filters.product}`);
  if (filters.search) parts.push(`Search: "${filters.search}"`);
  if (filters.sort && filters.sort !== "recent") parts.push(`Sort: ${filters.sort}`);
  return parts.length > 0 ? parts.join(" · ") : "Không filter — toàn bộ dữ liệu";
}

// ─────────────────────────────────────────────
// Format helpers (PDF-safe — no DOM, no store import)
// ─────────────────────────────────────────────

function fmtVND(v: number): string {
  return `₫${Math.round(v).toLocaleString("vi-VN")}`;
}

function fmtMoney(v: number, currency = "VND"): string {
  if (currency === "VND") return fmtVND(v);
  return `$${(v / 100).toFixed(2)}`;
}

const PLATFORM_LABEL: Record<CreativeSourcePlatform, string> = {
  facebook: "Facebook",
  google_search: "Google Search",
  google_pmax: "Google PMax",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  ARCHIVED: "Archived",
  UNKNOWN: "Unknown",
};

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────

const C = {
  blue: "#1877F2",
  amber: "#D97706",
  purple: "#7C3AED",
  dark: "#0F172A",
  mid: "#475569",
  light: "#94A3B8",
  bg: "#F8FAFC",
  border: "#E2E8F0",
  green: "#16A34A",
  white: "#FFFFFF",
};

const PLATFORM_COLOR: Record<CreativeSourcePlatform, string> = {
  facebook: C.blue,
  google_search: C.amber,
  google_pmax: C.purple,
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
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: C.blue,
  },
  headerLeft: { flexDirection: "column", gap: 3 },
  headerBrand: { fontSize: 18, fontFamily: "Helvetica-Bold", color: C.blue },
  headerSubtitle: { fontSize: 10, color: C.mid, marginTop: 2 },
  headerPeriod: { fontSize: 9, color: C.light, marginTop: 1 },
  headerRight: { flexDirection: "column", alignItems: "flex-end", gap: 3 },
  headerDate: { fontSize: 8, color: C.light },

  metricGrid: { flexDirection: "row", gap: 8, marginBottom: 16 },
  metricBox: {
    flex: 1,
    backgroundColor: C.bg,
    borderRadius: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  metricLabel: { fontSize: 7, color: C.light, marginBottom: 3 },
  metricValue: { fontSize: 13, fontFamily: "Helvetica-Bold", color: C.dark },

  campaignSection: { marginBottom: 14 },
  campaignHeader: {
    backgroundColor: C.bg,
    borderRadius: 4,
    padding: 8,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 4,
  },
  campaignTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  campaignName: { fontSize: 10, fontFamily: "Helvetica-Bold", color: C.dark },
  campaignMeta: { fontSize: 7.5, color: C.mid, marginTop: 2 },
  campaignStatsRow: { flexDirection: "row", gap: 12, marginTop: 4 },
  campaignStat: { fontSize: 7.5, color: C.mid },
  campaignStatValue: { fontFamily: "Helvetica-Bold", color: C.dark },

  table: { borderWidth: 1, borderColor: C.border, borderRadius: 4, overflow: "hidden" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border },
  tableHead: { backgroundColor: C.bg },
  tableCell: { padding: "4 5", fontSize: 7 },
  tableCellBold: { fontFamily: "Helvetica-Bold", color: C.dark },
  tableCellMid: { color: C.mid },
  tableCellRight: { textAlign: "right" },
  tableRowLast: { borderBottomWidth: 0 },

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

const COL = { name: 2.4, platform: 1, status: 0.8, spend: 1, clicks: 0.7, lastActive: 0.9 };

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function CreativeTableHeader() {
  const headers = [
    { key: "name", label: "Creative", flex: COL.name },
    { key: "platform", label: "Platform", flex: COL.platform },
    { key: "status", label: "Status", flex: COL.status },
    { key: "spend", label: "Chi tiêu", flex: COL.spend },
    { key: "clicks", label: "Clicks", flex: COL.clicks },
    { key: "lastActive", label: "Hoạt động cuối", flex: COL.lastActive },
  ];
  return (
    <View style={[styles.tableRow, styles.tableHead]} fixed>
      {headers.map((h) => (
        <View key={h.key} style={[styles.tableCell, { flex: h.flex }]}>
          <Text style={[styles.tableCellBold, { fontSize: 6.5 }]}>{h.label.toUpperCase()}</Text>
        </View>
      ))}
    </View>
  );
}

function CreativeTableRow({ item, isLast, currency }: { item: CreativeItem; isLast: boolean; currency: string }) {
  return (
    <View style={[styles.tableRow, isLast ? styles.tableRowLast : {}]} wrap={false}>
      <View style={[styles.tableCell, { flex: COL.name }]}>
        <Text style={styles.tableCellBold}>{item.name}</Text>
        {item.headline && <Text style={[styles.tableCellMid, { fontSize: 6.5, marginTop: 1 }]}>{item.headline}</Text>}
      </View>
      <View style={[styles.tableCell, { flex: COL.platform }]}>
        <Text style={[styles.tableCellMid, { color: PLATFORM_COLOR[item.platform] }]}>{PLATFORM_LABEL[item.platform]}</Text>
      </View>
      <View style={[styles.tableCell, { flex: COL.status }]}>
        <Text style={[styles.tableCellMid, { color: item.status === "ACTIVE" ? C.green : C.amber }]}>
          {STATUS_LABEL[item.status] ?? item.status}
        </Text>
      </View>
      <View style={[styles.tableCell, { flex: COL.spend, ...(styles.tableCellRight as object) }]}>
        <Text style={styles.tableCellBold}>
          {item.metrics.metricsAvailable ? fmtMoney(item.metrics.spend, currency) : "—"}
        </Text>
      </View>
      <View style={[styles.tableCell, { flex: COL.clicks, ...(styles.tableCellRight as object) }]}>
        <Text style={styles.tableCellMid}>{item.metrics.metricsAvailable ? item.metrics.clicks.toLocaleString() : "—"}</Text>
      </View>
      <View style={[styles.tableCell, { flex: COL.lastActive, ...(styles.tableCellRight as object) }]}>
        <Text style={styles.tableCellMid}>{item.lastActiveDate}</Text>
      </View>
    </View>
  );
}

function CampaignSection({ group, currency }: { group: CampaignCreativeGroup; currency: string }) {
  return (
    <View style={styles.campaignSection} wrap={false}>
      <View style={[styles.campaignHeader, { borderLeftWidth: 3, borderLeftColor: PLATFORM_COLOR[group.platform] }]}>
        <View style={styles.campaignTitleRow}>
          <Text style={styles.campaignName}>{group.campaignName}</Text>
          <Text style={[styles.campaignMeta, { color: group.campaignStatus === "ACTIVE" ? C.green : C.amber }]}>
            {STATUS_LABEL[group.campaignStatus] ?? group.campaignStatus}
          </Text>
        </View>
        <Text style={styles.campaignMeta}>
          {group.company} · {PLATFORM_LABEL[group.platform]}{group.campaignObjective ? ` · ${group.campaignObjective}` : ""}
        </Text>
        <View style={styles.campaignStatsRow}>
          <Text style={styles.campaignStat}>Creatives: <Text style={styles.campaignStatValue}>{group.creativeCount}</Text></Text>
          <Text style={styles.campaignStat}>Chi tiêu: <Text style={styles.campaignStatValue}>{fmtMoney(group.totalSpend, currency)}</Text></Text>
          <Text style={styles.campaignStat}>Clicks: <Text style={styles.campaignStatValue}>{group.totalClicks.toLocaleString()}</Text></Text>
          <Text style={styles.campaignStat}>Hoạt động gần nhất: <Text style={styles.campaignStatValue}>{group.latestActiveDate}</Text></Text>
        </View>
      </View>
      <View style={styles.table}>
        <CreativeTableHeader />
        {group.items.map((item, i) => (
          <CreativeTableRow key={item.id} item={item} isLast={i === group.items.length - 1} currency={currency} />
        ))}
      </View>
    </View>
  );
}

export function AdsContentPDF({ month, groups, currency = "VND", filters }: AdsContentPDFProps) {
  const generatedAt = new Date().toLocaleString("vi-VN");
  const allItems = groups.flatMap((g) => g.items);
  const facebookCount = allItems.filter((i) => i.platform === "facebook").length;
  const googleCount = allItems.length - facebookCount;
  const mbcCount = allItems.filter((i) => i.company === "MBC").length;
  const mbiCount = allItems.filter((i) => i.company === "MBI").length;
  const appliedFilters = formatAppliedFilters(filters);

  return (
    <Document title={`AdsCommand — Ads Content ${month}`} author="AdsCommand">
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <View style={styles.headerLeft}>
            <Text style={styles.headerBrand}>⚡ AdsCommand</Text>
            <Text style={styles.headerSubtitle}>Ads Content — Creative-level monitoring</Text>
            <Text style={styles.headerPeriod}>Tháng {month}</Text>
            {appliedFilters && <Text style={styles.headerPeriod}>Filters: {appliedFilters}</Text>}
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerDate}>Xuất lúc: {generatedAt}</Text>
          </View>
        </View>

        <View style={styles.metricGrid}>
          <MetricBox label="Campaigns" value={String(groups.length)} />
          <MetricBox label="Creatives" value={String(allItems.length)} />
          <MetricBox label="Facebook" value={String(facebookCount)} />
          <MetricBox label="Google" value={String(googleCount)} />
          <MetricBox label="MBC" value={String(mbcCount)} />
          <MetricBox label="MBI" value={String(mbiCount)} />
        </View>

        {groups.map((group) => (
          <CampaignSection key={group.campaignId} group={group} currency={currency} />
        ))}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>AdsCommand — Ads Content</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Trang ${pageNumber}/${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
