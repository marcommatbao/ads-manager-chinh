"use client";

import { useState, useEffect, useCallback } from "react";
import { resolveCompanyScope } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Loader2, AlertTriangle, CheckCircle2, XCircle, PauseCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/components/SessionProvider";
import { useToast } from "@/components/Toast";
import { useGuardedWrite } from "@/components/ConfirmWriteDialog";
import { orderedCompanyIds } from "@/lib/companies/registry";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

const DAY_LABELS: MessageKey[] = ["google.dayparting.d1", "google.dayparting.d2", "google.dayparting.d3", "google.dayparting.d4", "google.dayparting.d5", "google.dayparting.d6", "google.dayparting.d7"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

type Grade = "S" | "A" | "B" | "C" | "F" | "THIN" | "EMPTY";

interface HourCell {
  hour: number;
  label: string;
  spend: number;
  conv: number;
  clicks: number;
  cpl: number | null;
  grade: Grade;
  shouldPause: boolean;
}

interface DayRow {
  day: string;
  dayKey: string;
  hours: HourCell[];
}

interface CampaignOption {
  id: string;
  name: string;
  resourceName: string;
}

interface DataQuality {
  convRate: number;
  minClicksForGrade: number | null;
  gradedCells: number;
  thinCells: number;
  maxClicksInOneCell: number;
  reliable: boolean;
  note: string | null;
}

interface ApiResponse {
  avgCPL: number;
  wastedSpend: number;
  /** Tài khoản có đủ dữ liệu để chia theo giờ không. Thiếu field này (bản cũ
   *  của API) thì coi như không biết — không hiện cảnh báo, không chặn gì. */
  dataQuality?: DataQuality;
  /** Bảng gộp theo THỨ. Chỉ có khi mức giờ quá mỏng. */
  dayLevel?: { rows: Array<{ day: string; label: string; spend: number; conv: number; clicks: number; cpl: number | null; grade: Grade }>; usable: number } | null;
  grid: DayRow[];
  recommendation: {
    pauseHours: number[];
    reduceBid: string[];
    summary: string;
  };
  campaigns: CampaignOption[];
}

function gradeToColor(grade: Grade): string {
  switch (grade) {
    case "S":     return "bg-emerald-500 text-white";
    case "A":     return "bg-emerald-300 text-emerald-900";
    case "B":     return "bg-blue-200 text-blue-800";
    case "C":     return "bg-amber-200 text-amber-800";
    case "F":     return "bg-red-400 text-white";
    // THIN = có số liệu nhưng CHƯA ĐỦ để kết luận. Cố ý dùng nét đứt và màu
    // nhạt, KHÔNG dùng màu của một hạng — người đọc không được hiểu nhầm là
    // tốt hay xấu.
    case "THIN":  return "bg-slate-50 text-slate-400 border border-dashed border-slate-300";
    case "EMPTY": return "bg-slate-100 text-slate-300";
  }
}

function formatVND(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M₫`;
  if (v >= 1_000)    return `${(v / 1_000).toFixed(0)}K₫`;
  return `${v}₫`;
}

export default function DaypartingPage() {
  const t = useT();
  const { toast } = useToast();
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

  const [campaignId, setCampaignId] = useState("ALL");
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [data, setData]         = useState<ApiResponse | null>(null);
  const [applying, setApplying] = useState(false);
  const guard = useGuardedWrite();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/google/toolkit/dayparting?company=${company}&campaignId=${campaignId}&range=LAST_30_DAYS`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e: any) {
      setError(e.message || t("google.dayparting.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [company, campaignId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const selectedCampaign = data?.campaigns.find(c => c.id === campaignId);

  const handleApplySchedule = async () => {
    if (!data || !selectedCampaign) return;
    const { pauseHours, reduceBid } = data.recommendation;
    setApplying(true);
    try {
      await guard.run(
        [{
          url: "/api/google/toolkit/dayparting",
          payload: {
            company,
            campaignResourceName: selectedCampaign.resourceName,
            pauseHours,
            reduceBidDays: reduceBid,
            reduceBidPct: 20,
          },
          label: t("google.dayparting.writeLabel", { name: selectedCampaign.name, hours: pauseHours.length }) + (reduceBid.length ? t("google.dayparting.writeLabelBid", { days: reduceBid.join(", ") }) : ""),
        }],
        { title: t("google.dayparting.applyTitle", { name: selectedCampaign.name }), company },
        {
          onValidateFail: (message) => toast({ title: t("google.dayparting.validateFail", { message }), variant: "error" }),
          onSuccess: (results) => {
            const json = results[0].raw;
            toast({
              title: t("google.dayparting.applied", { name: selectedCampaign.name, n: Number(json.schedulesApplied ?? 0) }),
              variant: "success",
              action: guard.undoAction(company, [results[0].writeId]),
            });
            fetchData();
          },
          onFailure: (results) => {
            toast({ title: t("google.dayparting.applyFailed", { error: results[0].error ?? "" }), variant: "error" });
          },
        }
      );
    } finally {
      setApplying(false);
    }
  };

  // Summary insights derived from real data
  const insights = data ? (() => {
    const allCells = data.grid.flatMap(d => d.hours);
    const bestHour = allCells
      .filter(h => h.grade === "S" || h.grade === "A")
      .sort((a, b) => (b.conv - a.conv))[0];
    const bestDay = data.grid
      .map(d => ({
        day: d.day,
        convRate: d.hours.reduce((s, h) => s + h.conv, 0),
      }))
      .sort((a, b) => b.convRate - a.convRate)[0];
    const worstHours = data.recommendation.pauseHours;
    return { bestHour, bestDay, worstHours };
  })() : null;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100">
            <Clock className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-800">Day-Parting Analysis</h1>
            <p className="text-sm text-slate-500">{t("google.dayparting.subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data?.campaigns && data.campaigns.length > 0 && (
            <select
              value={campaignId}
              onChange={e => setCampaignId(e.target.value)}
              className="rounded-lg border-2 border-slate-200 px-3 py-2 text-sm text-slate-600 max-w-[220px]"
            >
              <option value="ALL">{t("google.dayparting.allCampaigns")}</option>
              {data.campaigns.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          {allowedCompanies.map(c => (
            <button
              key={c}
              onClick={() => { setCompany(c); setCampaignId("ALL"); }}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-semibold transition-all border-2",
                company === c
                  ? "border-violet-500 bg-violet-50 text-violet-700"
                  : "border-slate-200 text-slate-500 hover:border-slate-300"
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-red-700">{error}</p>
        </div>
      ) : data ? (
        <>
          {/* Grade legend */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            {[
              { grade: "S" as Grade, label: t("google.dayparting.gradeS") },
              { grade: "A" as Grade, label: t("google.dayparting.gradeA") },
              { grade: "B" as Grade, label: t("google.dayparting.gradeB") },
              { grade: "C" as Grade, label: t("google.dayparting.gradeC") },
              { grade: "F" as Grade, label: t("google.dayparting.gradeF") },
              { grade: "THIN" as Grade, label: t("google.dayparting.gradeThin") },
              { grade: "EMPTY" as Grade, label: t("google.dayparting.gradeEmpty") },
            ].map(({ grade, label }) => (
              <div key={grade} className="flex items-center gap-1.5">
                <span className={cn("h-4 w-4 rounded text-[9px] flex items-center justify-center font-bold shrink-0", gradeToColor(grade))}>
                  {grade === "EMPTY" ? "" : grade}
                </span>
                <span>{label}</span>
              </div>
            ))}
          </div>

          {/* Heatmap */}
          <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-800">
                {t("google.dayparting.heatmapTitle", { company })}
              </CardTitle>
              <CardDescription className="text-sm text-slate-500">
                {t("google.dayparting.heatmapDesc", { avg: formatVND(data.avgCPL) })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <div className="min-w-[700px]">
                  <div className="flex items-center gap-1 mb-1 pl-10">
                    {HOURS.map(h => (
                      <div key={h} className="w-8 shrink-0 text-center text-[10px] text-slate-400 font-medium">{h}</div>
                    ))}
                  </div>
                  <div className="space-y-1">
                    {data.grid.map((dayRow, di) => (
                      <div key={dayRow.dayKey} className="flex items-center gap-1">
                        <div className="w-9 shrink-0 text-right text-xs font-medium text-slate-500 pr-1">{t(DAY_LABELS[di])}</div>
                        {dayRow.hours.map(cell => (
                          <div
                            key={cell.hour}
                            title={
                              cell.grade === "EMPTY"
                                ? `${t(DAY_LABELS[di])} ${cell.label} — ${t("google.dayparting.gradeEmpty")}`
                                : cell.grade === "THIN"
                                ? `${t(DAY_LABELS[di])} ${cell.label} — ${t("google.dayparting.cellThin")}\nClicks: ${cell.clicks} | Conv: ${cell.conv.toFixed(1)}\n${t("google.dayparting.cellSpend")} ${formatVND(cell.spend)}`
                                : `${t(DAY_LABELS[di])} ${cell.label}\nGrade: ${cell.grade}\nClicks: ${cell.clicks} | Conv: ${cell.conv}\nCPL: ${cell.cpl ? formatVND(cell.cpl) : "—"}\n${t("google.dayparting.cellSpend")} ${formatVND(cell.spend)}`
                            }
                            className={cn(
                              "w-8 h-7 shrink-0 rounded flex items-center justify-center text-[9px] font-bold transition-opacity cursor-help",
                              gradeToColor(cell.grade),
                              cell.shouldPause ? "ring-1 ring-red-500" : ""
                            )}
                          >
                            {cell.grade === "EMPTY" ? "" : cell.grade === "THIN" ? cell.clicks : cell.grade}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Insights */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <p className="text-xs font-medium text-slate-500">{t("google.dayparting.bestHour")}</p>
              </div>
              <p className="text-lg font-bold text-emerald-600">
                {insights?.bestHour ? `${insights.bestHour.hour}:00` : "—"}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {insights?.bestHour ? t("google.dayparting.convCount", { n: insights.bestHour.conv.toFixed(1) }) : t("google.dayparting.notEnoughData")}
              </p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="h-4 w-4 text-blue-600" />
                <p className="text-xs font-medium text-slate-500">{t("google.dayparting.bestDay")}</p>
              </div>
              <p className="text-lg font-bold text-blue-600">
                {insights?.bestDay?.day || "—"}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {insights?.bestDay ? t("google.dayparting.convCount", { n: insights.bestDay.convRate.toFixed(1) }) : ""}
              </p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="h-4 w-4 text-red-500" />
                <p className="text-xs font-medium text-slate-500">{t("google.dayparting.pauseHours")}</p>
              </div>
              <p className="text-lg font-bold text-red-600">
                {insights?.worstHours && insights.worstHours.length > 0
                  ? insights.worstHours.map(h => `${h}:00`).join(", ")
                  : t("google.dayparting.none")}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {data.wastedSpend > 0
                  ? t("google.dayparting.savePerMonth", { amount: formatVND(data.wastedSpend) })
                  : data.dataQuality && !data.dataQuality.reliable
                    // "Không lãng phí" là một KẾT LUẬN. Chưa đủ dữ liệu thì
                    // không được kết luận — nói đúng là chưa biết.
                    ? t("google.dayparting.noConclusion")
                    : t("google.dayparting.noWaste")}
              </p>
            </div>
          </div>

          {/* Recommendation */}
          {/* Cảnh báo đặt TRƯỚC mọi con số. Người đọc thấy lưới màu trước rồi
              mới thấy cảnh báo là đã kịp tin vào lưới. */}
          {data.dataQuality && !data.dataQuality.reliable && data.dataQuality.note && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="text-sm font-bold text-amber-900">{t("google.dayparting.untrustedGrid")}</p>
              <p className="mt-1 text-xs leading-relaxed text-amber-900">{data.dataQuality.note}</p>
              <p className="mt-1.5 text-[11px] text-amber-800/80">
                {t("google.dayparting.qualityLine", { graded: data.dataQuality.gradedCells, thin: data.dataQuality.thinCells, rate: data.dataQuality.convRate })}
              </p>

              {/* Gộp lên mức THỨ thì mỗi nhóm nhiều gấp 24 lần dữ liệu. Thay vì
                  để người dùng đối diện một lưới chết, đưa luôn mức còn đọc
                  được — đó mới là câu trả lời có ích. */}
              {data.dayLevel && data.dayLevel.usable >= 5 && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-white/70 p-3">
                  <p className="mb-2 text-xs font-bold text-slate-700">
                    {t("google.dayparting.dayLevelTitle", { n: data.dayLevel.usable })}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-slate-400">
                          <th className="py-1 pr-3">{t("google.dayparting.thDay")}</th>
                          <th className="py-1 pr-3 text-right">{t("google.dayparting.thClick")}</th>
                          <th className="py-1 pr-3 text-right">{t("google.dayparting.thConv")}</th>
                          <th className="py-1 pr-3 text-right">{t("google.dayparting.thSpend")}</th>
                          <th className="py-1 pr-3 text-right">CPL</th>
                          <th className="py-1 text-center">{t("google.dayparting.thGrade")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.dayLevel.rows.map(r => (
                          <tr key={r.day} className="border-t border-slate-100">
                            <td className="py-1.5 pr-3 font-medium text-slate-700">{r.label}</td>
                            <td className="py-1.5 pr-3 text-right text-slate-600">{r.clicks}</td>
                            <td className="py-1.5 pr-3 text-right text-slate-600">{r.conv.toFixed(1)}</td>
                            <td className="py-1.5 pr-3 text-right text-slate-600">{formatVND(r.spend)}</td>
                            <td className="py-1.5 pr-3 text-right text-slate-600">{r.cpl ? formatVND(r.cpl) : "—"}</td>
                            <td className="py-1.5 text-center">
                              <span className={cn("inline-flex h-5 w-8 items-center justify-center rounded text-[10px] font-bold", gradeToColor(r.grade))}>
                                {r.grade === "EMPTY" ? "" : r.grade === "THIN" ? r.clicks : r.grade}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Khi không đủ tin, `recommendation.summary` CHÍNH LÀ câu đã hiện ở
              dải cảnh báo vàng ngay trên — hiện lại là nói hai lần cùng một
              điều. Chỉ hiện ô này khi dữ liệu đủ tin. */}
          {data.recommendation.summary && (data.dataQuality?.reliable ?? true) && (
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-violet-800">{t("google.dayparting.suggestTitle")}</p>
                  <p className="text-xs text-violet-700 mt-1">{data.recommendation.summary}</p>
                  {data.recommendation.reduceBid.length > 0 && (
                    <p className="text-xs text-violet-600 mt-1">
                      {t("google.dayparting.reduceBid", { days: data.recommendation.reduceBid.join(", ") })}
                    </p>
                  )}
                </div>
                {data.recommendation.pauseHours.length > 0 && (
                  <button
                    onClick={handleApplySchedule}
                    disabled={applying || !selectedCampaign}
                    title={!selectedCampaign ? t("google.dayparting.pickCampaign") : undefined}
                    className="shrink-0 flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PauseCircle className="h-3.5 w-3.5" />}
                    {t("google.dayparting.applySchedule")}
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      ) : null}
      {guard.dialog}
    </div>
  );
}
