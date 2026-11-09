"use client";

// ============================================================
// P3 — Quét trang đích chết
// ============================================================
// ĐẶT Ở ĐÂU: roadmap đề xuất /campaigns hoặc /improvements. Đặt vào /toolkit
// vì ba lý do cụ thể, không phải tiện tay:
//   · báo cáo này CHỈ có với Google, còn /campaigns hiển thị cả hai nền tảng;
//   · /improvements là dòng khuyến nghị có hình dạng dữ liệu riêng, nhét một
//     bảng chẩn đoán vào đó sẽ phải bẻ hình dạng đó;
//   · bảy công cụ chẩn đoán Google cùng loại đã nằm sẵn ở /toolkit.
// Vẫn đúng tinh thần roadmap ("không cần dashboard riêng") — /toolkit là hub
// đã có, không phải màn hình mới dựng lên.
//
// BẤM MỚI QUÉT. Mỗi lượt là hàng trăm request THẬT tới trang đích của chính
// công ty; tự chạy khi mở trang là tự tạo tải bất thường lên máy chủ nhà.
// ============================================================

import { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link2Off, Loader2, AlertTriangle, RefreshCw, Info, CheckCircle2, HelpCircle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { companyIds, orderedCompanyIds } from "@/lib/companies/registry";
import { useIntlLocale, useT } from "@/lib/i18n/client";

interface SweepRow {
  url: string;
  verdict: "alive" | "dead" | "inconclusive";
  status: number | null;
  finalUrl?: string;
  problem?: string;
  impressions: number;
  clicks: number;
  spendVnd: number;
  conversions: number;
  refCount: number;
}

interface ApiResponse {
  success: boolean;
  company?: string;
  summary?: {
    urlsChecked: number;
    rowsBeforeMerge: number;
    alive: number;
    dead: number;
    inconclusive: number;
    deadSpendVnd: number;
  };
  dead?: SweepRow[];
  inconclusive?: SweepRow[];
  downgradeReason?: string;
  error?: string;
}

export default function LandingPageSweepPage() {
  const t = useT();
  const loc = useIntlLocale();
  const vnd = (n: number) => `₫${Math.round(n).toLocaleString(loc)}`;
  const num = (n: number) => Math.round(n).toLocaleString(loc);
  const [company, setCompany] = useState<string>(() => orderedCompanyIds(["MBC"])[0] ?? "MBC") // Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ);
  const [days, setDays] = useState<"7" | "14" | "30">("30");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true); setError(null); setData(null);
    try {
      const res = await fetch(`/api/google/toolkit/landing-page-sweep?company=${company}&days=${days}`);
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("google.lpSweep.scanFailed"));
    }
    setLoading(false);
  }, [company, days]);

  const s = data?.summary;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="rounded-lg bg-red-100 p-2.5 text-red-600"><Link2Off className="h-5 w-5" /></div>
        <div className="flex-1 min-w-[260px]">
          <h1 className="text-xl font-bold text-slate-800">{t("google.lpSweep.title")}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {t("google.lpSweep.subtitle")}
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 flex items-end gap-4 flex-wrap">
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">{t("google.lpSweep.company")}</label>
            <div className="flex gap-1.5">
              {companyIds().map(c => (
                <button key={c} onClick={() => setCompany(c)}
                  className={cn("rounded-lg border px-4 py-2 text-xs font-semibold",
                    company === c ? "border-blue-500 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500")}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">{t("google.lpSweep.range")}</label>
            <div className="flex gap-1.5">
              {(["7", "14", "30"] as const).map(d => (
                <button key={d} onClick={() => setDays(d)}
                  className={cn("rounded-lg border px-3 py-2 text-xs font-semibold",
                    days === d ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-500")}>
                  {t("google.lpSweep.days", { n: d })}
                </button>
              ))}
            </div>
          </div>
          <button onClick={run} disabled={loading}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("google.lpSweep.scanning")}</> : <><RefreshCw className="h-4 w-4" /> {t("google.lpSweep.scanNow")}</>}
          </button>
        </CardContent>
      </Card>

      {loading && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("google.lpSweep.scanningNote")}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-700">{t("google.lpSweep.scanFailed")}</p>
          <p className="text-xs text-red-600 mt-1">{error}</p>
        </div>
      )}

      {s && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: t("google.lpSweep.kpiChecked"), value: num(s.urlsChecked), sub: t("google.lpSweep.kpiMerged", { n: num(s.rowsBeforeMerge) }), tone: "text-slate-800" },
              { label: t("google.lpSweep.kpiDead"), value: num(s.dead), sub: s.dead > 0 ? t("google.lpSweep.kpiSpending", { amount: vnd(s.deadSpendVnd) }) : t("google.lpSweep.kpiNone"), tone: s.dead > 0 ? "text-red-600" : "text-emerald-600" },
              { label: t("google.lpSweep.kpiInconclusive"), value: num(s.inconclusive), sub: t("google.lpSweep.kpiNoResponse"), tone: "text-amber-600" },
              { label: t("google.lpSweep.kpiAlive"), value: num(s.alive), sub: t("google.lpSweep.kpiOpensFine"), tone: "text-emerald-600" },
            ].map(c => (
              <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">{c.label}</p>
                <p className={cn("text-2xl font-bold mt-0.5", c.tone)}>{c.value}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{c.sub}</p>
              </div>
            ))}
          </div>

          {data?.dead && data.dead.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" /> {t("google.lpSweep.deadTitle", { n: data.dead.length })}
                </CardTitle>
                <CardDescription>
                  {t("google.lpSweep.deadDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {data.dead.map(r => (
                  <div key={r.url} className="rounded-lg border border-red-200 bg-red-50/60 p-3">
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white shrink-0">
                        {r.status ?? "?"}
                      </span>
                      <a href={r.url} target="_blank" rel="noopener noreferrer"
                        className="text-sm font-medium text-slate-800 hover:underline break-all flex-1 min-w-[200px]">
                        {r.url} <ExternalLink className="inline h-3 w-3 text-slate-400" />
                      </a>
                      <span className="text-xs font-semibold text-red-700 shrink-0">{vnd(r.spendVnd)}</span>
                    </div>
                    {r.problem && <p className="text-xs text-red-700 mt-1.5 leading-relaxed">{r.problem}</p>}
                    <p className="text-[11px] text-slate-500 mt-1">
                      {t("google.lpSweep.rowStats", { impressions: num(r.impressions), clicks: num(r.clicks), conversions: num(r.conversions) })}
                      {r.refCount > 1 && t("google.lpSweep.rowRefs", { n: r.refCount })}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <p className="text-sm text-emerald-800">
                {t("google.lpSweep.noDead", { n: num(s.urlsChecked) })}
              </p>
            </div>
          )}

          {data?.inconclusive && data.inconclusive.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <HelpCircle className="h-4 w-4 text-amber-500" /> {t("google.lpSweep.inconclusiveTitle", { n: data.inconclusive.length })}
                </CardTitle>
                <CardDescription>
                  {t("google.lpSweep.inconclusivePre")} <strong>{t("google.lpSweep.inconclusiveNot")}</strong> {t("google.lpSweep.inconclusivePost")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {data.inconclusive.map(r => (
                  <div key={r.url} className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2">
                    <a href={r.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-slate-700 hover:underline break-all">{r.url}</a>
                    <span className="text-[11px] text-slate-500 ml-2">{vnd(r.spendVnd)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {data?.downgradeReason && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex gap-2">
              <Info className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {t("google.lpSweep.downgrade")} {data.downgradeReason}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
