"use client";

import { useState, useEffect, useCallback } from "react";
import { resolveCompanyScope } from "@/lib/permissions";
import { Award, RefreshCw, TrendingUp, TrendingDown, Minus, Loader2, AlertTriangle, Info, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSession } from "@/components/SessionProvider";
import { EditRsaModal } from "@/components/EditRsaModal";
import { orderedCompanyIds } from "@/lib/companies/registry";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

interface KWComponent {
  expectedCTR: string;
  adRelevance: string;
  landingPage: string;
}

interface Keyword {
  criterionId: string;
  keyword: string;
  matchType: string;
  campaign: string;
  campaignId: string;
  adGroup: string;
  adGroupId: string;
  qs: number;
  prevQS: number | null;
  prevDate: string | null;
  trend: "UP" | "DOWN" | "FLAT" | "NEW";
  grade: "EXCELLENT" | "GOOD" | "AVERAGE" | "POOR";
  components: KWComponent;
  weakest: string | null;
  suggestion: string;
  spend: number;
  conversions: number;
  clicks: number;
  avgCpc: number;
}

interface AdGroupRollupRow {
  adGroup: string;
  adGroupResource: string;
  campaign: string;
  campaignId: string;
  keywordCount: number;
  poorCount: number;
  totalImpressions: number;
  totalSpend: number;
  weightedQS: number | null;
  primaryRootCause: { type: string; count: number; label: string } | null;
  recommendedAction: string;
}

interface LandingPageRow {
  url: string;
  keywordCount: number;
  poorLpCount: number;
  totalImpressions: number;
  totalClicks: number;
  totalSpend: number;
  totalConversions: number;
  weightedQs: number | null;
  adGroups: string[];
}

interface ApiResponse {
  total: number;
  poor: number;
  declining: number;
  avgQS: number;
  keywords: Keyword[];
  adGroupRollup: AdGroupRollupRow[];
  landingPageRollup: LandingPageRow[];
  landingPageError: string | null;
  landingPageMode: "with_adgroup" | "url_only" | null;
  history: { firstSnapshot: string | null; lastSnapshot: string | null; snapshotDays: number };
  performanceWindow: string;
  error?: string;
}

const MATCH_BADGE: Record<string, { label: MessageKey; color: string }> = {
  EXACT:  { label: "google.qualityScore.matchExact", color: "bg-blue-100 text-blue-700 border-blue-200" },
  PHRASE: { label: "google.qualityScore.matchPhrase", color: "bg-violet-100 text-violet-700 border-violet-200" },
  BROAD:  { label: "google.qualityScore.matchBroad", color: "bg-amber-100 text-amber-700 border-amber-200" },
};

function MatchBadge({ type }: { type: string }) {
  const t = useT();
  const known = MATCH_BADGE[type];
  const meta = known ? { label: t(known.label), color: known.color } : { label: type, color: "bg-slate-100 text-slate-600 border-slate-200" };
  return (
    <span className={cn("inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded border", meta.color)}>
      {meta.label}
    </span>
  );
}

function QSBadge({ score }: { score: number }) {
  const color =
    score >= 8 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    score >= 6 ? "bg-amber-50 text-amber-700 border-amber-200" :
                 "bg-red-50 text-red-600 border-red-200";
  return (
    <span className={cn("inline-flex items-center justify-center w-9 h-9 rounded-full border-2 text-sm font-bold", color)}>
      {score}
    </span>
  );
}

// Nhãn thành phần do API trả (tiếng Việt) — so khớp trên giá trị gốc, chỉ dịch phần hiển thị.
const COMPONENT_LABEL_KEY: Record<string, MessageKey> = {
  "Trên TB": "google.qualityScore.compAbove",
  "Trung bình": "google.qualityScore.compAverage",
  "Dưới TB": "google.qualityScore.compBelow",
};

function ComponentLabel({ label }: { label: string }) {
  const t = useT();
  if (label === "—") return <span className="text-slate-300 text-xs">—</span>;
  const color =
    label === "Trên TB"    ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
    label === "Trung bình" ? "text-amber-700 bg-amber-50 border-amber-200" :
    label === "Dưới TB"    ? "text-red-600 bg-red-50 border-red-200" :
                             "text-slate-500 bg-slate-50 border-slate-200";
  return (
    <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border inline-block", color)}>
      {COMPONENT_LABEL_KEY[label] ? t(COMPONENT_LABEL_KEY[label]) : label}
    </span>
  );
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// Mũi tên một mình không nói được "so với khi nào" — mà đó chính là thứ quyết
// định có nên tin nó hay không. prevDate là ngày của mốc so sánh (luôn là một
// ngày khác hôm nay; nếu keyword chỉ mới xuất hiện hôm nay thì trend là "MỚI",
// không phải "không đổi").
// QS là ảnh chụp hiện tại của Google, còn chi phí/click/impression là số của
// 7 ngày — hai loại số khác bản chất đứng cạnh nhau nên phải chú thích.
const WINDOW_LABEL: MessageKey = "google.qualityScore.window";

function TrendIcon({ trend, prevQS, prevDate }: { trend: string; prevQS?: number | null; prevDate?: string | null }) {
  const t = useT();
  const since = prevDate ? t("google.qualityScore.since", { date: prevDate.split("-").reverse().slice(0, 2).join("/") }) + (prevQS != null ? ` (QS ${prevQS})` : "") : undefined;
  if (trend === "UP")   return <span title={since}><TrendingUp className="h-4 w-4 text-emerald-500" aria-label={since} /></span>;
  if (trend === "DOWN") return <span title={since}><TrendingDown className="h-4 w-4 text-red-500" aria-label={since} /></span>;
  if (trend === "NEW")  return <span title={t("google.qualityScore.noBaseline")} className="text-[9px] font-bold text-blue-600 px-1 py-0.5 rounded bg-blue-50 border border-blue-200">{t("google.qualityScore.new")}</span>;
  return <Minus className="h-4 w-4 text-slate-300" />;
}

type FilterType = "ALL" | "POOR" | "DECLINING" | "GOOD";

export default function QualityScorePage() {
  const t = useT();
  const loc = useIntlLocale();
  const [company, setCompany] = useState<string>(() => orderedCompanyIds(["MBC"])[0] ?? "MBC") // Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ);
  // Chỉ hiện công ty người này được xem. Trước đây nút bấm cứng cả MBC lẫn MBI,
  // nên người chỉ có quyền một bên vẫn thấy nút bên kia và bấm vào là nhận 403.
  const { user } = useSession();
  // resolveCompanyScope, KHÔNG lọc thẳng trên user.companies: trường đó là
  // PHẠM VI và đang mang giá trị ["ALL"] cho mọi tài khoản → lọc thẳng ra rỗng,
  // rồi trang báo "Tài khoản của bạn chưa được gán công ty nào".
  const allowedCompanies = resolveCompanyScope(user?.companies, user?.role);
  // Mặc định "MBC" sai với người chỉ có MBI. Chỉnh state về công ty hợp lệ đầu
  // tiên thay vì dựng biến dẫn xuất — để mọi chỗ đang đọc `company` vẫn đúng.
  useEffect(() => {
    if (allowedCompanies.length > 0 && !allowedCompanies.includes(company)) {
      setCompany(allowedCompanies[0]);
    }
  }, [allowedCompanies, company]);

  const [filter, setFilter]   = useState<FilterType>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [data, setData]       = useState<ApiResponse | null>(null);
  const [editingRow, setEditingRow] = useState<Keyword | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/google/toolkit/quality-score?company=${company}&filter=${filter}`);
      const json = await res.json() as ApiResponse;
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e: any) {
      setError(e.message || t("google.qualityScore.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [company, filter, t]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const keywords  = data?.keywords ?? [];
  const highCount = keywords.filter(k => k.qs >= 8).length;
  const lowCount  = keywords.filter(k => k.qs <= 5).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-800">
            <Award className="h-5 w-5 text-amber-500" />
            Quality Score Tracker
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">{t("google.qualityScore.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {allowedCompanies.map(c => (
            <button key={c} onClick={() => setCompany(c)} className={cn("rounded-lg px-3 py-1.5 text-sm font-semibold transition-all border-2", company === c ? "border-amber-400 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-500 hover:border-slate-300")}>
              {c}
            </button>
          ))}
          <Button variant="outline" size="sm" className="gap-2 border-slate-200 text-slate-600" onClick={fetchData} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            {t("google.qualityScore.refresh")}
          </Button>
        </div>
      </div>

      {/* Info note about "—" */}
      <div className="flex items-start gap-2.5 rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3">
        <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700">
          <span className="font-semibold">{t("google.qualityScore.noteLead")}</span> {t("google.qualityScore.noteBody")} <span className="font-semibold">{t("google.qualityScore.noteTrend")}</span> {t("google.qualityScore.noteEnd")}
        </p>
      </div>

      {/* Summary stats */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: t("google.qualityScore.statTotal"),   value: data.total,   color: "text-slate-700" },
            { label: t("google.qualityScore.statAvg"),  value: data.avgQS,   color: "text-blue-600" },
            { label: t("google.qualityScore.statHigh"),  value: highCount,     color: "text-emerald-600" },
            { label: t("google.qualityScore.statLow"),  value: lowCount,      color: "text-red-600" },
          ].map(s => (
            <Card key={s.label} className="border border-slate-200 bg-white shadow-sm">
              <CardContent className="py-4 text-center">
                <p className={cn("text-3xl font-bold", s.color)}>{s.value}</p>
                <p className="text-xs text-slate-500 mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Nói rõ mỗi loại số lấy từ đâu: QS là ảnh chụp hiện tại, chi phí là 7
          ngày, và cột xu hướng so với mốc lưu gần nhất (không phải mốc hôm nay). */}
      {data && (
        <p className="text-[11px] text-slate-400">
          {t("google.qualityScore.sources", { window: t(WINDOW_LABEL) })} ·{" "}
          {data.history.lastSnapshot
            ? t("google.qualityScore.trendBasis", { days: data.history.snapshotDays, last: data.history.lastSnapshot })
            : t("google.qualityScore.noHistory")}
        </p>
      )}

      {/* Landing pages đang bị quy trách nhiệm — nguyên nhân LANDING_PAGE
          trước đây là ngõ cụt ("ngoài phạm vi app") vì không nói được trang nào */}
      {data && (data.landingPageRollup.length > 0 || data.landingPageError) && (
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-200 pb-3">
            <CardTitle className="text-sm font-semibold text-slate-800">
              {t("google.qualityScore.lpTitle")}
              <span className="ml-2 text-[10px] font-normal text-slate-400">
                {t("google.qualityScore.lpSub", { window: t(WINDOW_LABEL) })}
              </span>
              {/* Google có thể từ chối nối ad_group vào landing_page_view. Khi đó
                  vẫn có chi phí theo URL nhưng không quy được số từ khóa lỗi
                  trang — phải nói ra thay vì hiện cột 0/0 như thể đo được. */}
              {data.landingPageMode === "url_only" && (
                <span className="ml-2 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-normal text-amber-700">
                  {t("google.qualityScore.lpUrlOnly")}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.landingPageError ? (
              <p className="px-4 py-4 text-xs text-amber-700">
                {t("google.qualityScore.lpError", { error: data.landingPageError })}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/50">
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 min-w-[240px]">{t("google.qualityScore.thLandingPage")}</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("google.qualityScore.thKwBlamed")}</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("google.qualityScore.thWeightedQs")}</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("google.qualityScore.thCost")}</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Clicks</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Conv</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.landingPageRollup.slice(0, 10).map((lp) => (
                      <tr key={lp.url} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                        <td className="px-3 py-3">
                          <a
                            href={lp.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700 break-all"
                          >
                            {lp.url}
                          </a>
                          {lp.adGroups.length > 0 && (
                            <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[320px]" title={lp.adGroups.join(", ")}>
                              {lp.adGroups.slice(0, 3).join(" · ")}{lp.adGroups.length > 3 ? ` +${lp.adGroups.length - 3}` : ""}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {data.landingPageMode === "url_only" ? (
                            <span className="text-xs text-slate-400" title={t("google.qualityScore.notMeasurable")}>—</span>
                          ) : lp.poorLpCount > 0 ? (
                            <span className="text-xs font-semibold text-amber-700">{lp.poorLpCount}/{lp.keywordCount}</span>
                          ) : (
                            <span className="text-xs text-slate-400">0/{lp.keywordCount}</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs font-medium text-slate-700">{lp.weightedQs ?? "—"}</td>
                        <td className="px-3 py-3 text-xs text-slate-600">{t("google.qualityScore.spendFmt", { n: lp.totalSpend.toLocaleString(loc) })}</td>
                        <td className="px-3 py-3 text-xs text-slate-600">{lp.totalClicks.toLocaleString(loc)}</td>
                        <td className="px-3 py-3 text-xs font-medium text-emerald-600">{lp.totalConversions > 0 ? Math.round(lp.totalConversions) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Ad-group priority worklist — impression-weighted QS + root cause */}
      {data && data.adGroupRollup.length > 0 && (
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-200 pb-3">
            <CardTitle className="text-sm font-semibold text-slate-800">
              {t("google.qualityScore.agTitle")}
              <span className="ml-2 text-[10px] font-normal text-slate-400">
                {t("google.qualityScore.agSub")}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50">
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 min-w-[160px]">Ad Group</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("google.qualityScore.thWeightedQs")}</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Impressions</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("google.qualityScore.thLowQs")}</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 min-w-[200px]">{t("google.qualityScore.thRootCause")}</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 min-w-[260px]">{t("google.qualityScore.thAction")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.adGroupRollup.slice(0, 10).map(row => (
                    <tr key={row.adGroupResource || `${row.campaignId}-${row.adGroup}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-slate-700">{row.adGroup}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[180px]" title={row.campaign}>{row.campaign} · {t("google.qualityScore.kwCount", { n: row.keywordCount })}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        {row.weightedQS !== null ? <QSBadge score={Math.round(row.weightedQS)} /> : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-medium text-slate-600">{formatCompact(row.totalImpressions)}</td>
                      <td className="px-3 py-2.5 text-xs font-medium">
                        {row.poorCount > 0
                          ? <span className="text-red-600">{row.poorCount}/{row.keywordCount}</span>
                          : <span className="text-slate-300">0</span>}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-slate-500">
                        {row.primaryRootCause ? (
                          <span className="text-amber-700">{row.primaryRootCause.label} ({t("google.qualityScore.kwCount", { n: row.primaryRootCause.count })})</span>
                        ) : (
                          <span className="text-slate-400">{t("google.qualityScore.noRootCause")}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-slate-600">{row.recommendedAction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter */}
      <div className="flex flex-wrap gap-2">
        {(["ALL", "POOR", "DECLINING", "GOOD"] as FilterType[]).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={cn("rounded-full px-3 py-1 text-xs font-semibold border transition-all", filter === f ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400")}>
            {f === "ALL" ? t("google.qualityScore.filterAll") : f === "POOR" ? t("google.qualityScore.filterPoor") : f === "DECLINING" ? t("google.qualityScore.filterDeclining") : t("google.qualityScore.filterGood")}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[30vh]">
          <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-red-700">{error}</p>
          <p className="text-xs text-red-500 mt-1">{t("google.qualityScore.checkConn")}</p>
        </div>
      ) : keywords.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-10 text-center">
          <Award className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-500">{t("google.qualityScore.noKeywords")}</p>
          <p className="text-xs text-slate-400 mt-1">
            {filter !== "ALL" ? t("google.qualityScore.tryFilter") : t("google.qualityScore.noActiveKeywords", { company })}
          </p>
        </div>
      ) : (
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-200 pb-3">
            <CardTitle className="text-sm font-semibold text-slate-800">
              {t("google.qualityScore.listTitle", { n: keywords.length })}
              <span className="ml-2 text-[10px] font-normal text-slate-400">
                {t("google.qualityScore.listSub")}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50">
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 min-w-[180px]">{t("google.qualityScore.thKeyword")}</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 min-w-[160px]">{t("google.qualityScore.thTypeCampaign")}</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">QS</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("google.qualityScore.thExpectedCtr")}</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("google.qualityScore.thAdRelevance")}</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("google.qualityScore.thLpExperience")}</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Clicks</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Conv</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("google.qualityScore.thTrend")}</th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 min-w-[160px]">{t("google.qualityScore.thSuggestion")}</th>
                  </tr>
                </thead>
                <tbody>
                  {keywords.map(row => (
                    <tr key={row.criterionId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                      <td className="px-3 py-3">
                        <div className="font-medium text-slate-700">{row.keyword}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{row.adGroup}</div>
                      </td>
                      <td className="px-3 py-3">
                        <MatchBadge type={row.matchType} />
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[140px]" title={row.campaign}>{row.campaign}</div>
                      </td>
                      <td className="px-3 py-3"><QSBadge score={row.qs} /></td>
                      <td className="px-3 py-3"><ComponentLabel label={row.components.expectedCTR} /></td>
                      <td className="px-3 py-3"><ComponentLabel label={row.components.adRelevance} /></td>
                      <td className="px-3 py-3"><ComponentLabel label={row.components.landingPage} /></td>
                      <td className="px-3 py-3 text-xs text-slate-600 font-medium">{row.clicks.toLocaleString(loc)}</td>
                      <td className="px-3 py-3 text-xs font-medium text-emerald-600">{row.conversions > 0 ? Math.round(row.conversions) : "—"}</td>
                      <td className="px-3 py-3"><TrendIcon trend={row.trend} prevQS={row.prevQS} prevDate={row.prevDate} /></td>
                      <td className="px-3 py-3 text-[11px] text-slate-500 max-w-[200px]">
                        {row.weakest ? (
                          <div className="space-y-1">
                            <span className="text-amber-700">{row.suggestion}</span>
                            {(row.weakest === "AD_RELEVANCE" || row.weakest === "EXPECTED_CTR") && row.adGroupId && (
                              <button
                                type="button"
                                onClick={() => setEditingRow(row)}
                                className="flex items-center gap-1 text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 w-fit"
                              >
                                <Sparkles className="h-3 w-3" /> {t("google.qualityScore.editRsa")}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">{row.suggestion}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {editingRow && (
        <EditRsaModal
          isOpen={!!editingRow}
          onClose={() => setEditingRow(null)}
          company={company}
          adGroupId={editingRow.adGroupId}
          adGroupName={editingRow.adGroup}
          campaignId={editingRow.campaignId}
          weakest={editingRow.weakest as "AD_RELEVANCE" | "EXPECTED_CTR"}
          keyword={editingRow.keyword}
          // Cả ad group, QS thấp lên trước — đó là những từ đang cần cứu, và cũng
          // để prompt không phình khi ad group có hàng trăm từ khoá.
          adGroupKeywords={keywords
            .filter(k => k.adGroupId === editingRow.adGroupId)
            .sort((a, b) => a.qs - b.qs)
            .map(k => k.keyword)}
        />
      )}
    </div>
  );
}
