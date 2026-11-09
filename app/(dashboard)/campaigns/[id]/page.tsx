"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Play, Pause, ExternalLink, RefreshCw, TrendingUp, MousePointerClick, DollarSign, Eye, Users, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton-loader";
import { useToast } from "@/components/Toast";
import { CampaignAnalysisPanel } from "@/components/CampaignAnalysisPanel";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface CampaignDetail {
  campaign: {
    id: string; name: string; status: string; objective: string;
    dailyBudget: number; lifetimeBudget: number;
    startTime: string; stopTime: string | null; createdTime: string;
  };
  metrics: {
    impressions: number; clicks: number; spend: number;
    ctr: number; cpc: number; cpm: number;
    reach: number; frequency: number; conversions: number; leads: number;
    // Doanh thu quy đổi + ROAS. Trước 23/09/2026 hai trường này không tồn tại:
    // API có xin `action_values`/`conversions_value` nhưng không trả về, nên
    // thẻ ROAS dưới kia đành gõ cứng "—". `roas: null` = chưa tiêu đồng nào,
    // khác hẳn với `roas: 0` = tiêu mà không thu được gì.
    revenue?: number; roas?: number | null;
  };
  adsets: Array<{
    id: string; name: string; status: string; dailyBudget: number;
    optimizationGoal: string; impressions: number; clicks: number;
    spend: number; ctr: number; cpc: number; conversions: number; leads: number;
    revenue?: number; roas?: number | null;
  }>;
  period: { from: string; to: string };
  daily: Array<{
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    ctr: number;
    leads: number;
    conversions?: number;
    revenue?: number;
  }>;
}

function fmtVNDWith(n: number, loc: string, t: TFunction): string {
  if (n >= 1_000_000_000) return `₫${(n / 1_000_000_000).toFixed(1)}${t("creative.campaignDetail.unitB")}`;
  if (n >= 1_000_000)     return `₫${(n / 1_000_000).toFixed(1)}${t("creative.campaignDetail.unitM")}`;
  if (n >= 1_000)         return `₫${(n / 1_000).toFixed(0)}${t("creative.campaignDetail.unitK")}`;
  return `₫${Math.round(n).toLocaleString(loc)}`;
}

function fmtWith(n: number, loc: string) {
  return n.toLocaleString(loc, { maximumFractionDigits: 0 });
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700 border-emerald-200",
  PAUSED: "bg-amber-100 text-amber-700 border-amber-200",
  ARCHIVED: "bg-slate-100 text-slate-500 border-slate-200",
};

function MetricCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex gap-3 items-start">
      <div className="mt-0.5 p-2 bg-slate-50 rounded-lg text-slate-500">{icon}</div>
      <div>
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-slate-800 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const platform = searchParams.get("platform") ?? "facebook";
  const isGoogle = platform === "google";
  const company = searchParams.get("company") as string | null;

  const [data, setData] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const { toast } = useToast();
  const t = useT();
  const loc = useIntlLocale();
  const fmtVND = (n: number) => fmtVNDWith(n, loc, t);
  const fmt = (n: number) => fmtWith(n, loc);
  const costName = t("creative.campaignDetail.cost");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isGoogle && !company) {
        throw new Error(t("creative.campaignDetail.missingCompany"));
      }
      const url = isGoogle
        ? `/api/google/campaigns/${id}?company=${company}`
        : `/api/meta/campaigns/${id}`;
      const res = await fetch(url);
      const json = await res.json() as CampaignDetail & { error?: string };
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("creative.campaignDetail.loadFailed"));
    }
    setLoading(false);
  }, [id, isGoogle, company, t]);

  useEffect(() => { load(); }, [load]);

  const toggleStatus = async () => {
    if (!data) return;
    const isActive = data.campaign.status === "ACTIVE";
    setToggling(true);
    try {
      const url = isGoogle ? `/api/google/campaigns/${id}/status` : `/api/meta/campaigns/${id}/status`;
      const body = isGoogle
        ? { action: isActive ? "PAUSE" : "ACTIVE", company }
        : { action: isActive ? "PAUSE" : "ACTIVATE", campaignId: id };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json().catch(() => ({})) as { success?: boolean; error?: string; message?: string };
      if (result.success) {
        setData((d) => d ? { ...d, campaign: { ...d.campaign, status: isActive ? "PAUSED" : "ACTIVE" } } : d);
        toast({ title: result.message ?? (isActive ? t("creative.campaignDetail.paused") : t("creative.campaignDetail.activated")), description: data.campaign.name });
      } else {
        // Pausing a live campaign that silently stayed live was the worst
        // case here: the old code discarded the response entirely, so a 403
        // (no can_edit / wrong company) or a Meta/Google API error left the
        // button looking merely unresponsive.
        toast({
          title: t("creative.campaignDetail.statusChangeFailed"),
          description: result.error ?? `HTTP ${res.status}`,
          variant: "error",
        });
      }
    } catch {
      toast({ title: t("creative.campaignDetail.statusConnError"), variant: "error" });
    }
    setToggling(false);
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 mt-6" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6">
          <ArrowLeft className="h-4 w-4" /> {t("creative.campaignDetail.back")}
        </button>
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">
          <p className="font-medium">{t("creative.campaignDetail.loadErrorTitle")}</p>
          <p className="text-sm mt-1 text-red-600">{error}</p>
          <Button variant="outline" size="sm" onClick={load} className="mt-3 gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> {t("creative.campaignDetail.retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { campaign, metrics, adsets } = data;
  const isActive = campaign.status === "ACTIVE";

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <button onClick={() => router.push("/campaigns")} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 mb-2 transition-colors">
            <ArrowLeft className="h-4 w-4" /> {t("creative.campaignDetail.campaigns")}
          </button>
          <h1 className="text-2xl font-bold text-slate-800 leading-tight">{campaign.name}</h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge variant="outline" className={STATUS_COLORS[campaign.status] ?? STATUS_COLORS.ARCHIVED}>
              {isActive ? "🟢" : "⏸"} {campaign.status}
            </Badge>
            <Badge variant="outline" className="text-xs text-slate-500 border-slate-200">
              {campaign.objective?.replace(/_/g, " ")}
            </Badge>
            <Badge variant="outline" className="text-xs text-blue-600 border-blue-200 bg-blue-50 capitalize">
              {platform}
            </Badge>
            <span className="text-xs text-slate-400 font-mono">{campaign.id}</span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5 border-slate-200">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            onClick={toggleStatus}
            disabled={toggling}
            className={isActive
              ? "gap-1.5 bg-amber-500 hover:bg-amber-600 text-white"
              : "gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white"}
          >
            {isActive ? <><Pause className="h-3.5 w-3.5" /> {t("creative.campaignDetail.pause")}</> : <><Play className="h-3.5 w-3.5" /> {t("creative.campaignDetail.activate")}</>}
          </Button>
          <a
            href={isGoogle
              ? `https://ads.google.com/aw/campaigns?campaignId=${campaign.id}`
              : `https://www.facebook.com/adsmanager/manage/campaigns?act=${process.env.NEXT_PUBLIC_AD_ACCOUNT_ID}&selected_campaign_ids=${campaign.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-7 rounded-lg px-2.5 text-[0.8rem] border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" /> {isGoogle ? "Google Ads" : "Meta"}
          </a>
        </div>
      </div>

      {/* Budget info */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 px-4 py-3 flex gap-6 text-sm text-slate-600 flex-wrap">
        {campaign.dailyBudget > 0 && <span>💰 {t("creative.campaignDetail.dailyBudget")} <strong className="text-slate-800">{fmtVND(campaign.dailyBudget)}</strong></span>}
        {campaign.lifetimeBudget > 0 && <span>💼 {t("creative.campaignDetail.lifetimeBudget")} <strong className="text-slate-800">{fmtVND(campaign.lifetimeBudget)}</strong></span>}
        {campaign.startTime && <span>📅 {t("creative.campaignDetail.start")} <strong className="text-slate-800">{new Date(campaign.startTime).toLocaleDateString(loc)}</strong></span>}
        {campaign.stopTime && <span>🏁 {t("creative.campaignDetail.end")} <strong className="text-slate-800">{new Date(campaign.stopTime).toLocaleDateString(loc)}</strong></span>}
        <span className="ml-auto text-slate-400 text-xs">{t("creative.campaignDetail.period", { from: data.period.from, to: data.period.to })}</span>
      </div>

      {/* Budget progress bar */}
      {campaign.dailyBudget > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
          <div className="flex justify-between text-xs text-slate-500 mb-1.5">
            <span>{t("creative.campaignDetail.budgetUsed")}</span>
            <span className="font-semibold text-slate-700">
              {Math.min(100, Math.round((metrics.spend / 30 / campaign.dailyBudget) * 100))}%
              {" · "}{fmtVND(metrics.spend / 30)} / {fmtVND(campaign.dailyBudget)}
            </span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all"
              style={{ width: `${Math.min(100, (metrics.spend / 30 / campaign.dailyBudget) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <MetricCard icon={<DollarSign className="h-4 w-4" />} label={t("creative.campaignDetail.cost")} value={fmtVND(metrics.spend)} />
        <MetricCard icon={<Eye className="h-4 w-4" />} label={t("creative.campaignDetail.impressions")} value={fmt(metrics.impressions)} sub={isGoogle ? undefined : `${t("creative.campaignDetail.reach")}: ${fmt(metrics.reach)}`} />
        <MetricCard icon={<MousePointerClick className="h-4 w-4" />} label="Clicks" value={fmt(metrics.clicks)} sub={`CTR: ${metrics.ctr.toFixed(2)}%`} />
        <MetricCard icon={<DollarSign className="h-4 w-4" />} label="CPC" value={fmtVND(metrics.cpc)} sub={`CPM: ${fmtVND(metrics.cpm)}`} />
        {!isGoogle && (
          <MetricCard icon={<Users className="h-4 w-4" />} label="Reach" value={fmt(metrics.reach)} sub={`Freq: ${metrics.frequency.toFixed(1)}x`} />
        )}
        <MetricCard icon={<Zap className="h-4 w-4" />} label="Conversions" value={fmt(metrics.conversions)} />
        {!isGoogle && (
          <MetricCard icon={<TrendingUp className="h-4 w-4" />} label="Leads" value={fmt(metrics.leads)} />
        )}
        <MetricCard
          icon={<DollarSign className="h-4 w-4" />}
          label={t("creative.campaignDetail.cplLabel")}
          value={metrics.leads > 0 ? fmtVND(metrics.spend / metrics.leads) : "—"}
        />
        <MetricCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="ROAS"
          // "—" chỉ còn nghĩa là THIẾU SỐ (chưa tiêu, hoặc chưa đo được doanh
          // thu), không còn là "tính năng chưa làm" như trước.
          //
          // CHỈ in số khi THẬT SỰ có doanh thu. Nếu để công thức chạy thẳng,
          // chiến dịch đã tiêu tiền mà Pixel không gửi giá trị đơn hàng sẽ ra
          // "0.00x" — đọc thành "tiêu bằng đó mà không thu được đồng nào",
          // trong khi sự thật là KHÔNG ĐO ĐƯỢC. Hai kết luận trái ngược nhau
          // về việc có nên tắt chiến dịch hay không.
          value={
            metrics.revenue !== undefined && metrics.revenue > 0 && metrics.roas
              ? `${metrics.roas.toFixed(2)}x`
              : "—"
          }
          sub={
            metrics.revenue !== undefined && metrics.revenue > 0
              ? `${t("creative.campaignDetail.revenue")}: ${fmtVND(metrics.revenue)}`
              : metrics.conversions > 0
              ? t("creative.campaignDetail.noOrderValue", { n: fmt(metrics.conversions) })
              : undefined
          }
        />
      </div>

      {/* Phân tích hiệu quả bằng AI — bấm mới chạy, xem ghi chú trong component */}
      <CampaignAnalysisPanel
        campaignId={String(id)}
        platform={isGoogle ? "google" : "facebook"}
        company={company}
        campaignName={campaign.name}
        onMutated={load}
      />

      {/* Trend Chart */}
      {data.daily && data.daily.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">{t("creative.campaignDetail.dailyTrend")}</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.daily} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                tickFormatter={(v: number) => `₫${(v / 1000).toFixed(0)}K`}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
              />
              <Tooltip
                formatter={(value, name) =>
                  name === costName ? fmtVND(Number(value)) : value
                }
                labelFormatter={(label) => t("creative.campaignDetail.dayLabel", { d: String(label) })}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="left" type="monotone" dataKey="spend" name={costName} stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="leads" name="Leads" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="right" type="monotone" dataKey="clicks" name="Clicks" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Daily Breakdown Table */}
      {data.daily && data.daily.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-slate-700 mb-3">{t("creative.campaignDetail.dailyBreakdown")}</h2>
          <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                    <th className="text-left px-4 py-3 font-semibold">{t("creative.campaignDetail.colDate")}</th>
                    <th className="text-right px-3 py-3 font-semibold">{t("creative.campaignDetail.cost")}</th>
                    <th className="text-right px-3 py-3 font-semibold">Impressions</th>
                    <th className="text-right px-3 py-3 font-semibold">Clicks</th>
                    <th className="text-right px-3 py-3 font-semibold">CTR</th>
                    <th className="text-right px-3 py-3 font-semibold">Leads</th>
                    <th className="text-right px-3 py-3 font-semibold">CPL</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((d, idx) => (
                    <tr
                      key={d.date}
                      className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/50 ${idx % 2 === 0 ? "" : "bg-slate-50/30"}`}
                    >
                      <td className="px-4 py-2.5 font-medium text-slate-700">{d.date}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-700">{fmtVND(d.spend)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-500">{fmt(d.impressions)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-600">{fmt(d.clicks)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-500">{d.ctr.toFixed(2)}%</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-emerald-700">{fmt(d.leads)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-600">{d.leads > 0 ? fmtVND(d.spend / d.leads) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Ad Sets / Ad Groups */}
      <div>
        <h2 className="text-base font-semibold text-slate-700 mb-3">
          {isGoogle ? "Ad Groups" : "Ad Sets"} ({adsets.length})
        </h2>
        {adsets.length === 0 ? (
          <div className="text-center py-10 text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
            {isGoogle ? t("creative.campaignDetail.noAdGroups") : t("creative.campaignDetail.noAdSets")}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                    <th className="text-left px-4 py-3 font-semibold">{isGoogle ? t("creative.campaignDetail.adGroupName") : t("creative.campaignDetail.adSetName")}</th>
                    <th className="text-center px-3 py-3 font-semibold">Status</th>
                    <th className="text-right px-3 py-3 font-semibold">{t("creative.campaignDetail.cost")}</th>
                    <th className="text-right px-3 py-3 font-semibold">Impressions</th>
                    <th className="text-right px-3 py-3 font-semibold">Clicks</th>
                    <th className="text-right px-3 py-3 font-semibold">CTR</th>
                    <th className="text-right px-3 py-3 font-semibold">CPC</th>
                    <th className="text-right px-3 py-3 font-semibold">{isGoogle ? "Conversions" : "Leads"}</th>
                  </tr>
                </thead>
                <tbody>
                  {adsets.map((as, idx) => (
                    <tr key={as.id} className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors ${idx % 2 === 0 ? "" : "bg-slate-50/30"}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800 truncate max-w-[220px]" title={as.name}>{as.name}</p>
                        {as.optimizationGoal && (
                          <p className="text-[11px] text-slate-400 mt-0.5">{as.optimizationGoal.replace(/_/g, " ")}</p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_COLORS[as.status] ?? STATUS_COLORS.ARCHIVED}`}>
                          {as.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-slate-700">{fmtVND(as.spend)}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{fmt(as.impressions)}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{fmt(as.clicks)}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{as.ctr.toFixed(2)}%</td>
                      <td className="px-3 py-3 text-right font-mono text-slate-600">{fmtVND(as.cpc)}</td>
                      <td className="px-3 py-3 text-right text-slate-700 font-semibold">{fmt(as.leads)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
