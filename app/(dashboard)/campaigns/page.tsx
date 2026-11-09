"use client";

import { companyIds, orderedCompanyIds, companyLabel } from "@/lib/companies/registry";
import { useState, useEffect, useMemo } from "react";
import CampaignTable from "@/components/CampaignTable";
import { useAdsStore, detectCompany, type CompanyFilter } from "@/store/useAdsStore";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, Download, ChevronDown, X, Loader2,
  ArrowRight, ExternalLink, BarChart3, Copy,
  GraduationCap, FileText, FileSpreadsheet, Plus, ChevronRight, AlertTriangle } from "lucide-react";
import { useToast } from "@/components/Toast";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import { cn, formatCurrency } from "@/lib/utils";
import { DateRangePicker } from "@/components/DateRangePicker";
import { getLearningPhaseStatus } from "@/lib/campaign-utils";
import { getGA4ConfigForCampaign, COMPANY_CONFIG } from "@/lib/company-config";
import { MobileCampaignCard } from "@/components/ui/mobile-campaign-card";
import { useRouter } from "next/navigation";
import { EditBudgetModal } from "@/components/EditBudgetModal";
import type { Campaign } from "@/types/ads.types";
import { ObjectiveStatsWidget, computeObjectiveStats } from "@/components/ObjectiveStatsWidget";
import { GA4CampaignPanel, GA4InlineCells, ConversionDiscrepancyBadge } from "@/components/GA4CampaignPanel";
import { matchGA4ToCampaign, formatGA4Duration, type GA4CampaignData } from "@/lib/ga4-client";



interface Relationship {
  original_campaign_id: string;
  clone_campaign_id: string;
  clone_reason: string;
  original_name?: string;
  clone_name?: string;
  created_at: string;
}

interface CompareMetrics {
  id: string;
  name: string;
  status: string;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  spend: number;
  frequency: number;
  roas: number;
  conversions: number;
}

interface CompareResult {
  v1: CompareMetrics;
  v2: CompareMetrics;
  deltas: { ctr: number; cpc: number; spend: number };
  verdict: string;
  comparedAt: string;
}



export default function CampaignsPage() {
  const { campaigns, isLoading, setLoading, currency, setCampaigns, dateRange, selectedPlatform, selectedCompany, setSelectedCompany, ga4Data } = useAdsStore();
  const { toast } = useToast();
  const t = useT();
  const intl = useIntlLocale();
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  /** Vì sao cột "Người dùng" (Google) trống — lấy từ /api/google/campaigns. */
  const [uniqueUsersError, setUniqueUsersError] = useState<string | null>(null);
  /** true = Meta không trả được mục tiêu chuyển đổi → cột "Kết quả"/CPL đáng ngờ. */
  const [goalsUnavailable, setGoalsUnavailable] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [showLearningOnly, setShowLearningOnly] = useState(false);
  const [activeFilter, setActiveFilter] = useState<{ platform: string | null; objective: string | null }>({
    platform: null,
    objective: null,
  });
  const [showGA4, setShowGA4] = useState(false);
  const [ga4PanelCampaign, setGA4PanelCampaign] = useState<{ ga4: GA4CampaignData; name: string; platform: string; conv: number } | null>(null);

  // Relationship & Compare state
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [selectedRelIdx, setSelectedRelIdx] = useState<number | null>(null);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  // Pagination
  const PAGE_SIZE = 20;
  const [currentPage, setCurrentPage] = useState(1);

  // Mobile specific state
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);

  const handleQuickExport = async (format: "pdf" | "excel") => {
    const setter = format === "pdf" ? setExportingPDF : setExportingExcel;
    setter(true);
    try {
      const period = { start: dateRange.from, end: dateRange.to };
      const res = await fetch(`/api/reports/${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, company: selectedCompany === "all" ? "ALL" : selectedCompany, sections: { summary: true, campaigns: true, cpl: true, budget_history: false, ai_insights: false } }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Campaigns-${format === "pdf" ? "Report" : "Data"}.${format === "pdf" ? "pdf" : "xlsx"}`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: t("campaigns.page.toast.exportOk", { format: format.toUpperCase() }) });
    } catch {
      toast({ title: t("campaigns.page.toast.exportFail") });
    } finally {
      setter(false);
    }
  };



  // Load relationships
  useEffect(() => {
    fetch("/api/campaigns/compare")
      .then(res => res.json())
      .then(data => {
        if (data.success) setRelationships(data.data ?? []);
      })
      .catch(() => {});
  }, []);

  const fetchCampaigns = async (isManualSync = false) => {
    setIsSyncing(true);
    if (!isManualSync) setLoading(true);

    try {
      const q = `from=${dateRange.from}&to=${dateRange.to}`;

      // Fetch Facebook (active + paused) and Google (mỗi công ty của bản cài) in parallel.
      // Đợt 21 A3b: trước đây ghim MBC + MBI → bản cài khách KHÔNG BAO GIỜ thấy chiến dịch Google của mình.
      // Bản Mắt Bão: companyIds() = ["MBC","MBI"] cùng thứ tự → yêu cầu + nhãn lỗi y nguyên.
      const googleCos = companyIds();
      const [metaActiveRes, metaPausedRes, ...googleRes] = await Promise.all([
        fetch(`/api/meta/campaigns?status=ACTIVE&${q}`, { cache: 'no-store' }),
        fetch(`/api/meta/campaigns?status=PAUSED&${q}`, { cache: 'no-store' }),
        ...googleCos.map((co) => fetch(`/api/google/campaigns?company=${encodeURIComponent(co)}&${q}`, { cache: 'no-store' }).catch(() => null)),
      ]);
      
      const metaActiveData = await metaActiveRes.json();
      const metaPausedData = await metaPausedRes.json();
      const googleDatas = await Promise.all(googleRes.map((r) => (r ? r.json().catch(() => ({ success: false, campaigns: [] })) : { success: false, campaigns: [] })));

      // API /api/google/campaigns already returns fully normalized Campaign objects
      // (status: "ACTIVE"|"PAUSED"|"ARCHIVED", metrics with correct field names)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const normalizeGoogleCampaigns = (data: any): Campaign[] => {
        if (!data.success || !data.data) return [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return data.data.map((gc: any) => ({
          ...gc,
          id: String(gc.id),
          metrics: {
            impressions: gc.metrics?.impressions ?? 0,
            clicks: gc.metrics?.clicks ?? 0,
            spend: gc.metrics?.spend ?? 0,
            ctr: typeof gc.metrics?.ctr === "string" ? parseFloat(gc.metrics.ctr) : (gc.metrics?.ctr ?? 0),
            cpc: gc.metrics?.cpc ?? 0,
            cpm: gc.metrics?.cpm ?? 0,
            roas: gc.metrics?.roas ?? 0,
            conversions: gc.metrics?.conversions ?? 0,
            revenue: gc.metrics?.revenue ?? 0,
            // ?? null chứ KHÔNG ?? 0: khối này dựng lại metrics từ đầu nên
            // trường nào quên là rơi mất im lặng, và hạ về 0 sẽ biến "Google
            // không đo được" thành "0 người dùng" — hai chuyện khác hẳn nhau.
            uniqueUsers: gc.metrics?.uniqueUsers ?? null,
          },
        }));
      };

      const googleCampaigns = [
        ...googleDatas.flatMap((d) => normalizeGoogleCampaigns(d)),
      ];

      // Lý do cột "Người dùng" trống, để bảng nói thật thay vì im lặng.
      // Meta không trả được mục tiêu chuyển đổi thì cột "Kết quả"/CPL rơi về
      // mặc định purchase cho mọi campaign — phải nói ra, không để người dùng
      // tin một con số sai mà không có dấu hiệu gì.
      setGoalsUnavailable(
        metaActiveData?.conversionGoalsUnavailable === true ||
        metaPausedData?.conversionGoalsUnavailable === true,
      );

      const uuErr = googleDatas.map((d) => d?.uniqueUsersError)
        .filter((e: unknown): e is string => typeof e === "string" && e.length > 0);
      setUniqueUsersError(uuErr.length > 0 ? Array.from(new Set(uuErr)).join(" | ") : null);

      const allCampaigns = [
         ...(metaActiveData.success ? metaActiveData.data : []),
         ...(metaPausedData.success ? metaPausedData.data : []),
         ...googleCampaigns,
      ];

      setCampaigns(allCampaigns);

      const now = new Date();
      setLastSynced(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);

      // Distinguish a real API failure (rate-limit, expired token, etc. —
      // response carries `error`) from the "not configured" case (response
      // is just `{ success: false, data: [] }` with no `error`, meaning the
      // integration simply isn't set up — see app/api/meta/campaigns/route.ts
      // and app/api/google/campaigns/route.ts). Only the former should ever
      // surface as an error; the latter stays silent as before.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const asRealError = (data: any, label: string): string | null =>
        data && data.success === false && data.error ? `${label}: ${data.error}` : null;

      const syncErrors = [
        asRealError(metaActiveData, "Meta (Active)"),
        asRealError(metaPausedData, "Meta (Paused)"),
        ...googleDatas.map((d, i) => asRealError(d, `Google ${googleCos[i]}`)),
      ].filter((e): e is string => !!e);

      if (syncErrors.length > 0) {
        console.error("[fetchCampaigns] API error(s):", syncErrors);
        setSyncError(syncErrors.join(" · "));
      } else {
        setSyncError(null);
      }

      // Enrich relationships with campaign names
      if (relationships.length > 0) {
        const enriched = relationships.map(rel => ({
          ...rel,
          original_name: rel.original_name || allCampaigns.find((c: { id: string; name: string }) => c.id === rel.original_campaign_id)?.name || rel.original_campaign_id,
          clone_name: rel.clone_name || allCampaigns.find((c: { id: string; name: string }) => c.id === rel.clone_campaign_id)?.name || rel.clone_campaign_id,
        }));
        setRelationships(enriched);
      }

      if (isManualSync) {
        if (syncErrors.length > 0) {
          toast({
            title: t("campaigns.page.toast.syncErrors"),
            description: syncErrors.join(" · "),
            variant: "error",
          });
        } else {
          const metaCount = (metaActiveData.success ? metaActiveData.data.length : 0) + (metaPausedData.success ? metaPausedData.data.length : 0);
          const googleCount = googleCampaigns.length;
          toast({
            title: t("campaigns.page.toast.syncOk"),
            description: t("campaigns.page.toast.syncCounts", { meta: metaCount, google: googleCount })
          });
        }
      }
    } catch {
      if (isManualSync) toast({ title: t("campaigns.page.toast.syncFail"), variant: "error" });
    } finally {
      setIsSyncing(false);
      if (!isManualSync) setLoading(false);
    }
  };

  const handleExport = () => {
    if (!filteredCampaigns.length) {
      toast({ title: t("campaigns.page.toast.noData"), variant: "error" });
      return;
    }

    const headers = [
      t("campaigns.csv.campaign"), t("campaigns.csv.platform"), t("campaigns.csv.account"), t("campaigns.csv.status"),
      t("campaigns.csv.dailyBudget"), t("campaigns.csv.impressions"), "CTR", "CPC", "ROAS", t("campaigns.csv.spend"),
      t("campaigns.csv.results"), t("campaigns.csv.resultRoas"), t("campaigns.csv.resultValue"), t("campaigns.csv.startDate")
    ];

    const statusMap: Record<string, string> = {
      ACTIVE: t("campaigns.csv.statusActive"), PAUSED: t("campaigns.csv.statusPaused"), ARCHIVED: t("campaigns.csv.statusArchived")
    };

    const rows = filteredCampaigns.map(c => {
      const m = c.metrics;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acctName = (c as any).accountName ?? c.platform;
      return [
        `"${c.name.replace(/"/g, '""')}"`, c.platform, `"${acctName}"`,
        statusMap[c.status] || c.status,
        `"${formatCurrency(c.dailyBudget, currency, true, intl)}"`,
        m.impressions, `"${m.ctr.toFixed(2)}%"`,
        `"${formatCurrency(m.cpc, currency, false, intl)}"`,
        `"${m.roas.toFixed(1)}x"`,
        `"${formatCurrency(m.spend, currency, false, intl)}"`,
        // Cột Meta: để trống (không ghi 0) khi Meta không có giá trị cho loại kết quả — như Ads Manager.
        c.platform === "facebook" ? m.conversions : "",
        m.resultRoas != null ? m.resultRoas.toFixed(2) : "",
        m.resultValue != null ? Math.round(m.resultValue) : "",
        c.startDate || ""
      ].join(",");
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `AdsCommand-Campaigns-${dateRange.from}-${dateRange.to}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast({ title: t("campaigns.page.toast.csvOk", { n: filteredCampaigns.length }) });
  };

  // Compare handler
  const openCompare = async (relIdx: number) => {
    const rel = relationships[relIdx];
    if (!rel) return;
    setSelectedRelIdx(relIdx);
    setShowCompare(true);
    setCompareLoading(true);
    setCompareResult(null);
    setCompareError(null);

    try {
      const res = await fetch("/api/campaigns/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalId: rel.original_campaign_id,
          cloneId: rel.clone_campaign_id,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setCompareResult(json.data);
      } else {
        setCompareError(json.error ?? t("campaigns.compare.failed"));
      }
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : t("campaigns.compare.connError"));
    } finally {
      setCompareLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange]);

  const filteredCampaigns = useMemo(() => {
    // 1. Base Filter
    const filtered = campaigns.filter(c => {
      // Platform filter from global header (All / Facebook / Google)
      let passPlatform = true;
      if (selectedPlatform === "facebook") passPlatform = c.platform === "facebook";
      else if (selectedPlatform === "google") passPlatform = c.platform === "google";
      // "all" → pass everything

      let passCompany = true;
      const company = c.company ?? detectCompany(c.name, c.accountName);
      if (selectedCompany !== "all") {
        passCompany = company === selectedCompany;
      }
      let passLearning = true;
      if (showLearningOnly) {
        const lp = getLearningPhaseStatus(c);
        passLearning = lp.phase === "new" || lp.phase === "learning" || lp.phase === "learning_limited";
      }
      let passObjective = true;
      if (activeFilter.objective) {
        if (activeFilter.platform === "FACEBOOK" && c.platform === "facebook") {
          passObjective = c.objective === activeFilter.objective;
        } else if (activeFilter.platform === "GOOGLE" && c.platform === "google") {
          const rawType = (c as any).channelType || c.objective || "UNKNOWN";
          passObjective = String(rawType).toUpperCase() === activeFilter.objective;
        } else {
          passObjective = false; // Filter out if platform mismatch
        }
      }
      
      return passPlatform && passCompany && passLearning && passObjective;
    });

    // 2. Map GA4 Data to Campaigns
    // Helper function using COMPANY_CONFIG
    function getGA4PropertyForCampaignLocal(cmp: Campaign) {
      const resolved = cmp.company
        ? cmp
        : { ...cmp, company: detectCompany(cmp.name, cmp.accountName) };
      return getGA4ConfigForCampaign(resolved);
    }

    return filtered.map(c => {
      const property = getGA4PropertyForCampaignLocal(c);
      if (!property) return { ...c, ga4: undefined, ga4Source: undefined };

      const specificGA4Data = ga4Data.filter(d => d.propertyId === property.propertyId);
      const configValues = Object.values(COMPANY_CONFIG) as Array<{ label: string; ga4: { propertyId: string } }>;
      return {
        ...c,
        ga4: matchGA4ToCampaign(c.name, c.id, specificGA4Data) || undefined,
        ga4Source: configValues.find(cfg => cfg.ga4.propertyId === property.propertyId)?.label || "GA4",
      };
    });
  }, [campaigns, selectedPlatform, selectedCompany, showLearningOnly, activeFilter, ga4Data]);

  // Reset page when filters change
  useEffect(() => { setCurrentPage(1); }, [selectedPlatform, selectedCompany, showLearningOnly, activeFilter]);

  // Thống kê theo mục tiêu phải bám bộ lọc công ty/nền tảng đang chọn.
  //
  // Trước đây nó tính trên TOÀN BỘ campaign đã tải: chọn MBC rồi đọc ô "Traffic"
  // vẫn ra tổng chi của cả MBC lẫn MBI — số sai cho đúng câu hỏi mà widget này
  // sinh ra để trả lời ("mục tiêu Xem Trang Đích của MBC tốn bao nhiêu").
  // Không lọc theo activeFilter.objective: bấm vào một mục tiêu mà các ô khác
  // tụt về 0 thì không còn so sánh được nữa.
  const stats = useMemo(() => {
    const scoped = campaigns.filter((c) => {
      if (selectedPlatform !== "all" && c.platform !== selectedPlatform) return false;
      if (selectedCompany !== "all") {
        const company = c.company ?? detectCompany(c.name, c.accountName);
        if (company !== selectedCompany) return false;
      }
      return true;
    });
    return computeObjectiveStats(scoped);
  }, [campaigns, selectedPlatform, selectedCompany]);

  // Paginated slice
  const totalPages = Math.ceil(filteredCampaigns.length / PAGE_SIZE);
  const paginatedCampaigns = filteredCampaigns.slice(0, currentPage * PAGE_SIZE);
  const hasMore = currentPage * PAGE_SIZE < filteredCampaigns.length;

  const learningCount = campaigns.filter(c => {
    const lp = getLearningPhaseStatus(c);
    return (lp.phase === "new" || lp.phase === "learning" || lp.phase === "learning_limited") && c.status === "ACTIVE";
  }).length;



  const fmtK = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}${intl === "vi-VN" ? "Tr" : "M"}`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return `${Math.round(v)}`;
  };

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t("campaigns.page.title")}</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {t("campaigns.page.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastSynced && (
            <span className="text-xs text-slate-400">{t("campaigns.page.updatedAt", { time: lastSynced })}</span>
          )}
          <DateRangePicker />
          <Button
            variant="outline" size="sm"
            className="gap-1.5 rounded-lg border-slate-200"
            onClick={() => fetchCampaigns(true)} disabled={isSyncing}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} />
            {isSyncing ? t("campaigns.page.syncing") : t("campaigns.page.sync")}
          </Button>
          <Button
            variant="outline" size="sm"
            className="gap-1.5 rounded-lg border-slate-200"
            onClick={handleExport} disabled={filteredCampaigns.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
          <Button
            variant="outline" size="sm"
            className="gap-1.5 rounded-lg border-red-200 text-red-600 hover:bg-red-50"
            onClick={() => handleQuickExport("pdf")} disabled={exportingPDF}
          >
            {exportingPDF ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
            PDF
          </Button>
          <Button
            variant="outline" size="sm"
            className="gap-1.5 rounded-lg border-emerald-200 text-emerald-600 hover:bg-emerald-50"
            onClick={() => handleQuickExport("excel")} disabled={exportingExcel}
          >
            {exportingExcel ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
            Excel
          </Button>
        </div>
      </div>

      {/* Sync Error Banner — a real API failure (rate-limit, expired token, etc.),
          not the silent "not configured" case */}
      {syncError && (
        <div className="flex items-start gap-2 rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="flex-1">{t("campaigns.page.syncBanner", { error: syncError })}</span>
          <button
            onClick={() => setSyncError(null)}
            className="text-red-400 hover:text-red-600"
            aria-label={t("campaigns.page.closeError")}
          >
            ✕
          </button>
        </div>
      )}

      {/* Company Filter */}
      <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-0.5 shadow-sm w-fit max-w-full overflow-x-auto flex-nowrap scrollbar-hide">
        {(["all", ...orderedCompanyIds(["MBC", "MBI"])] as CompanyFilter[]).map(c => ( // Đợt 25: công ty theo bản cài
          <button key={c} onClick={() => setSelectedCompany(c)}
            className={cn("rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
              selectedCompany === c
                ? c === "MBC" ? "bg-blue-600 text-white shadow-sm"
                  : c === "MBI" ? "bg-violet-600 text-white shadow-sm"
                  : "bg-slate-700 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700")}
          >
            {c === "all" ? t("campaigns.filter.all") : `🏢 ${c === "MBC" || c === "MBI" ? c : companyLabel(c)}`}
          </button>
        ))}
      </div>

      {/* Learning Phase Filter */}
      {learningCount > 0 && (
        <button
          onClick={() => setShowLearningOnly(!showLearningOnly)}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all border shadow-sm",
            showLearningOnly
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600"
          )}
          title={t("campaigns.page.learningTip")}
        >
          <GraduationCap className="h-3.5 w-3.5" />
          {t("campaigns.page.learning", { n: learningCount })}
        </button>
      )}

      {/* Nút bật/tắt GA4 TẠM ẨN 22/09/2026 theo yêu cầu người dùng.

          Chỉ gỡ lối bấm. Toàn bộ phần GA4 còn nguyên: state showGA4/ga4Data,
          hàm fetchGA4, các cột GA4InlineCells trong bảng và GA4CampaignPanel.
          showGA4 khởi tạo false nên không có gì tự chạy — bỏ ẩn chỉ cần trả
          lại khối <button> này (xem git history commit trước) VÀ lấy lại
          `ga4Connections, ga4Status, fetchGA4` trong dòng destructure useAdsStore
          ở đầu component — đã bỏ ra để không để lại biến không dùng.

          KHÔNG đụng /api/ga4/* và /settings/ga4. */}
      
      {/* ── Active Filter UI ── */}
      {activeFilter.objective && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-slate-500">{t("campaigns.page.filteringByObjective")}</span>
          <span className="flex items-center gap-1.5 text-xs font-medium bg-amber-100 text-amber-800 px-3 py-1 rounded-full border border-amber-200 shadow-sm">
            {activeFilter.platform === "FACEBOOK" ? "FB" : "GG"} — {activeFilter.objective}
            <button
              onClick={() => setActiveFilter({ platform: null, objective: null })}
              className="ml-1 opacity-60 hover:opacity-100 text-amber-900"
            >
              ✕
            </button>
          </span>
          <span className="text-xs text-slate-500">
            {t("campaigns.page.filteredCount", { n: filteredCampaigns.length })}
          </span>
        </div>
      )}

      {/* ── Objective Stats Widget ── */}
      <ObjectiveStatsWidget 
        stats={stats} 
        activeFilter={activeFilter} 
        onFilterChange={(platform, objective) => setActiveFilter({ platform, objective })} 
      />

      {/* ── GA4 Summary Banner ── */}
      {(() => {
        let matched = 0, sessions = 0, conversions = 0, bounceSum = 0, platformConv = 0;
        campaigns.forEach(c => {
          if (c.ga4) {
            matched++;
            sessions += c.ga4.sessions;
            conversions += c.ga4.conversions;
            bounceSum += c.ga4.bounceRate;
            platformConv += c.metrics.conversions;
          }
        });
        const overReportPct = platformConv > 0 ? ((platformConv - conversions) / platformConv) * 100 : 0;
        const avgBounce = matched > 0 ? bounceSum / matched : 0;

        // Either not empty data, or we want to show it disabled
        if (ga4Data.length === 0 && !showGA4) return null;

        return (
          <div className={cn(
            "rounded-xl border px-5 py-3 mb-4 transition-all mt-4",
            showGA4
              ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800"
              : "bg-slate-50 border-slate-200 opacity-60"
          )}>
            <div className="flex items-center justify-between gap-4">
              {/* Left: icon + title */}
              <div className="flex items-center gap-3">
                <BarChart3 className={showGA4 ? "w-5 h-5 text-amber-600" : "w-5 h-5 text-slate-400"} />
                <div>
                  <p className={cn("text-sm font-semibold", showGA4 ? "text-amber-900" : "text-slate-700")}>
                    Google Analytics 4
                  </p>
                  <p className="text-xs text-slate-500">
                    {matched} campaigns matched
                  </p>
                </div>
              </div>

              {/* Middle: stats */}
              {showGA4 && matched > 0 && (
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Sessions</p>
                    <p className="text-sm font-bold tabular-nums text-slate-800">
                      {sessions.toLocaleString()}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Conversions <span className="font-normal normal-case">{t("campaigns.ga4.real")}</span></p>
                    <p className="text-sm font-bold tabular-nums text-emerald-600">
                      {conversions.toLocaleString()}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Avg. Bounce</p>
                    <p className={cn(
                      "text-sm font-bold tabular-nums",
                      avgBounce > 0.70 ? "text-red-600" : "text-emerald-600"
                    )}>
                      {(avgBounce * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Platform vs GA4</p>
                    <p className={cn(
                      "text-sm font-bold tabular-nums",
                      overReportPct > 0 ? "text-amber-600" : "text-blue-600"
                    )}>
                      {overReportPct > 0 ? "+" : ""}{overReportPct.toFixed(0)}%
                    </p>
                  </div>
                </div>
              )}

              {/* Right: toggle */}
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Connected
                </span>
                <button
                  onClick={() => setShowGA4(!showGA4)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-1.5 rounded-full",
                    "text-xs font-semibold border transition-all",
                    showGA4
                      ? "bg-amber-500 border-amber-500 text-white hover:bg-amber-600 shadow-sm"
                      : "bg-white border-slate-200 text-slate-500 hover:text-slate-800"
                  )}
                >
                  <span className={cn(
                    "w-2 h-2 rounded-full",
                    showGA4 ? "bg-white shadow-sm ring-2 ring-white/20 animate-pulse" : "bg-slate-300",
                  )} />
                  {showGA4 ? t("campaigns.ga4.on") : t("campaigns.ga4.turnOn")}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Clone Relationships ── */}
      {relationships.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50/50 to-white p-4 shadow-sm">
          <h3 className="text-xs font-bold text-blue-700 flex items-center gap-1.5 mb-3">
            <Copy className="h-3.5 w-3.5" /> Campaign Clones — A/B Testing
          </h3>
          <div className="space-y-2">
            {relationships.map((rel, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-blue-100 bg-white px-4 py-2.5">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="inline-flex items-center rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-500">v1</span>
                  <span className="text-xs text-slate-700 truncate font-medium">
                    {rel.original_name || rel.original_campaign_id}
                  </span>
                </div>
                <ArrowRight className="h-3 w-3 text-blue-400 shrink-0" />
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="inline-flex items-center rounded-full bg-blue-100 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-700">v2</span>
                  <span className="text-xs text-blue-700 truncate font-medium">
                    {rel.clone_name || rel.clone_campaign_id}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 shrink-0">
                  {new Date(rel.created_at).toLocaleDateString(intl)}
                </span>
                <Button size="sm"
                  className="gap-1 text-[10px] bg-blue-600 text-white hover:bg-blue-700 h-7 px-3 shrink-0"
                  onClick={() => openCompare(i)}
                >
                  <BarChart3 className="h-3 w-3" /> {t("campaigns.compare.button")}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {goalsUnavailable && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            {t("campaigns.goals.a")}<strong>{t("campaigns.goals.goalBold")}</strong>{t("campaigns.goals.b")}<strong>{t("campaigns.goals.resultsBold")}</strong>{t("campaigns.goals.c")}<strong>{t("campaigns.goals.cplBold")}</strong>{t("campaigns.goals.d")}
          </span>
        </div>
      )}

      {/* Table (Desktop) */}
      <div className="hidden md:block">
        <CampaignTable campaigns={filteredCampaigns} isLoading={isLoading} currency={currency} showGA4={showGA4} platformFilter={selectedPlatform} uniqueUsersError={uniqueUsersError} />
      </div>

      {/* Cards (Mobile) */}
      <div className="md:hidden block space-y-3">
        {paginatedCampaigns.map(c => (
          <MobileCampaignCard 
            key={c.id} 
            campaign={c} 
            currency={currency} 
            onViewDetails={(id, platform) => router.push(`/campaigns/${id}?platform=${platform}`)}
            onEditBudget={(campaign) => setEditCampaign(campaign)}
          />
        ))}
        {filteredCampaigns.length === 0 && !isLoading && (
          <div className="p-8 text-center text-slate-500 bg-white rounded-xl border border-slate-200">
            {t("campaigns.page.noCampaigns")}
          </div>
        )}
      </div>

      {/* Pagination Bar */}
      {filteredCampaigns.length > PAGE_SIZE && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3">
          <p className="text-xs text-slate-500">
            {t("campaigns.page.showing")} <b className="text-slate-800">{Math.min(currentPage * PAGE_SIZE, filteredCampaigns.length)}</b> / <b className="text-slate-800">{filteredCampaigns.length}</b> {t("campaigns.page.campaignsWord")}
          </p>
          <div className="flex items-center gap-2">
            {hasMore && (
              <Button
                variant="outline" size="sm"
                className="gap-1.5 rounded-lg border-blue-200 text-blue-600 hover:bg-blue-50"
                onClick={() => setCurrentPage(p => p + 1)}
              >
                {t("campaigns.page.loadMore", { n: PAGE_SIZE })} <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            )}
            {currentPage > 1 && (
              <Button
                variant="outline" size="sm"
                className="gap-1.5 rounded-lg border-slate-200 text-slate-600 hover:bg-slate-50"
                onClick={() => setCurrentPage(1)}
              >
                {t("campaigns.page.collapse")}
              </Button>
            )}
          </div>
        </div>
      )}

      <EditBudgetModal
        campaign={editCampaign}
        isOpen={!!editCampaign}
        onClose={() => setEditCampaign(null)}
        onSuccess={() => fetchCampaigns(true)}
        currency={currency}
      />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* A/B COMPARE MODAL                        */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {showCompare && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-white shrink-0">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-blue-100 p-1.5">
                  <BarChart3 className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">{t("campaigns.compare.title")}</h3>
                  <p className="text-[10px] text-slate-400">{t("campaigns.compare.subtitle")}</p>
                </div>
              </div>
              <button onClick={() => setShowCompare(false)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              {compareLoading && (
                <div className="text-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-400 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-blue-700">{t("campaigns.compare.loading")}</p>
                  <p className="text-[10px] text-slate-400 mt-1">{t("campaigns.compare.loadingSub")}</p>
                </div>
              )}

              {compareError && (
                <div className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-center">
                  <p className="text-sm font-bold text-red-700">❌ {compareError}</p>
                </div>
              )}

              {compareResult && (() => {
                const { v1, v2, deltas, verdict } = compareResult;
                return (
                  <>
                    {/* Campaign names */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5">
                        <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600 mb-1">{t("campaigns.compare.v1Original")}</span>
                        <p className="text-sm font-bold text-slate-700 truncate">{v1.name}</p>
                        <p className="text-[10px] text-slate-400">{v1.status}</p>
                      </div>
                      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5">
                        <span className="inline-flex items-center rounded-full bg-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-700 mb-1">{t("campaigns.compare.v2Optimized")}</span>
                        <p className="text-sm font-bold text-blue-700 truncate">{v2.name}</p>
                        <p className="text-[10px] text-blue-400">{v2.status}</p>
                      </div>
                    </div>

                    {/* Metrics table */}
                    <div className="rounded-lg border border-slate-200 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="px-3 py-2 text-left text-[10px] font-bold text-slate-400 uppercase w-24">Metric</th>
                            <th className="px-3 py-2 text-right text-[10px] font-bold text-slate-400 uppercase">{t("campaigns.compare.v1Col")}</th>
                            <th className="px-3 py-2 text-right text-[10px] font-bold text-blue-500 uppercase">v2 (Opt)</th>
                            <th className="px-3 py-2 text-right text-[10px] font-bold text-slate-400 uppercase w-20">Delta</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {[
                            { label: "CTR", v1Val: `${v1.ctr.toFixed(2)}%`, v2Val: `${v2.ctr.toFixed(2)}%`, delta: deltas.ctr, good: deltas.ctr > 0 },
                            { label: "CPC", v1Val: `₫${fmtK(v1.cpc)}`, v2Val: `₫${fmtK(v2.cpc)}`, delta: deltas.cpc, good: deltas.cpc < 0 },
                            { label: "Spend", v1Val: `₫${fmtK(v1.spend)}`, v2Val: `₫${fmtK(v2.spend)}`, delta: null as number | null, good: null as boolean | null },
                            { label: "Impressions", v1Val: fmtK(v1.impressions), v2Val: fmtK(v2.impressions), delta: null as number | null, good: null as boolean | null },
                            { label: "Frequency", v1Val: `${v1.frequency.toFixed(2)}x`, v2Val: `${v2.frequency.toFixed(2)}x`, delta: null as number | null, good: null as boolean | null },
                            { label: "Conversions", v1Val: `${v1.conversions}`, v2Val: `${v2.conversions}`, delta: null as number | null, good: null as boolean | null },
                          ].map((row, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2 font-semibold text-slate-500">{row.label}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{row.v1Val}</td>
                              <td className="px-3 py-2 text-right font-semibold text-blue-700">{row.v2Val}</td>
                              <td className="px-3 py-2 text-right">
                                {row.delta !== null ? (
                                  <span className={cn(
                                    "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                                    row.good ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                                  )}>
                                    {row.delta > 0 ? "+" : ""}{row.delta.toFixed(1)}%
                                  </span>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* AI Verdict */}
                    <div className="rounded-lg border-2 border-violet-200 bg-gradient-to-br from-violet-50 to-white px-4 py-3">
                      <p className="text-[10px] font-bold text-violet-400 uppercase mb-1.5 flex items-center gap-1">
                        🤖 AI Verdict
                      </p>
                      <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">
                        {verdict}
                      </p>
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-end shrink-0">
              <Button onClick={() => setShowCompare(false)} className="gap-2 bg-slate-700 text-white hover:bg-slate-800 text-sm h-9">
                {t("common.close")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* GA4 Detail Panel */}
      {ga4PanelCampaign && (
        <GA4CampaignPanel
          ga4={ga4PanelCampaign.ga4}
          campaignName={ga4PanelCampaign.name}
          platform={ga4PanelCampaign.platform}
          platformConversions={ga4PanelCampaign.conv}
          onClose={() => setGA4PanelCampaign(null)}
        />
      )}

      {/* Mobile FAB */}
      <button 
        className="md:hidden fixed bottom-24 right-4 z-40 bg-amber-500 text-amber-950 rounded-full p-4 shadow-lg hover:bg-amber-600 transition-colors"
        onClick={() => toast({ title: t("campaigns.page.fabTitle"), description: t("campaigns.page.fabDesc") })}
      >
        <Plus className="w-6 h-6" />
      </button>
    </div>
  );
}
