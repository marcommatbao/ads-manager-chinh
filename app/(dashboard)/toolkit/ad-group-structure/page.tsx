"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Layers, Loader2, XCircle, AlertTriangle, Info, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { isHiddenPage } from "@/lib/hidden-pages";
import { companyIds, orderedCompanyIds } from "@/lib/companies/registry";
import { useIntlLocale, useT } from "@/lib/i18n/client";

interface KeywordEntry {
  text: string; matchType: string; intent: string; matchedOn: string | null;
  cost: number; clicks: number; conversions: number; qualityScore: number | null;
}
interface Split {
  intent: string; label: string; rationale: string; count: number;
  cost: number; conversions: number; avgQualityScore: number | null;
  scoredCount: number; keywords: KeywordEntry[]; worthSplitting: boolean;
  costShare: number;
}
interface Oversized {
  adGroupId: string; adGroupName: string; campaignName: string;
  keywordCount: number; totalCost: number; totalConversions: number;
  splits: Split[]; viableSplits: number;
  verdict: "SPLIT" | "KEEP"; verdictReason: string;
  dominantShare: number; cpa: number | null;
  matchTypeMix: Record<string, number>;
}
interface DupPlace { adGroupName: string; campaignName: string; matchType: string; cost: number; conversions: number }
interface Duplicate { text: string; places: DupPlace[]; totalCost: number; crossCampaign: boolean; sameMatchType: boolean }

interface ApiResult {
  dateRange: string; brandTermsUsed: string[]; needsBrandTerms: boolean;
  duplicates: Duplicate[]; duplicateCrossCampaignCost: number;
  genericCost: number; genericShare: number; needsCompetitorTerms: boolean;
  totalAdGroups: number; oversized: Oversized[];
  undersized: { adGroupId: string; adGroupName: string; campaignName: string; keywordCount: number; cost: number }[];
  truncated: boolean; cap: number;
}

const INTENT_COLOR: Record<string, string> = {
  BRAND: "bg-emerald-100 text-emerald-800 border-emerald-200",
  COMPETITOR: "bg-rose-100 text-rose-800 border-rose-200",
  TRANSACTIONAL: "bg-blue-100 text-blue-800 border-blue-200",
  TOOL_FREE: "bg-amber-100 text-amber-800 border-amber-200",
  INFORMATIONAL: "bg-violet-100 text-violet-800 border-violet-200",
  GENERIC: "bg-slate-100 text-slate-700 border-slate-200",
};

export default function AdGroupStructurePage() {
  const t = useT();
  const loc = useIntlLocale();
  const vnd = (n: number) => n.toLocaleString(loc) + "₫";
  const [company, setCompany] = useState<string>(() => orderedCompanyIds(["MBC"])[0] ?? "MBC") // Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ);
  const [brand, setBrand] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResult | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ company, brand, competitor });
      const res = await fetch(`/api/google/toolkit/ad-group-structure?${qs}`);
      const json = await res.json();
      if (json.success) setData(json);
      else { setData(null); setError(json.error || t("google.adGroup.loadFail")); }
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : t("google.adGroup.connFail"));
    } finally { setLoading(false); }
  }, [company, brand, competitor, t]);

  // CỐ Ý không tự chạy khi mở trang. Mỗi lần phân tích là một truy vấn
  // Google Ads thật; trang tự gọi lúc mở là đúng cái kiểu đốt hạn mức âm
  // thầm mà không ai chủ động bấm. Người dùng cũng cần nhập từ khoá thương
  // hiệu trước thì kết quả mới đúng.

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
          <div className="rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 p-2.5 shadow-lg shadow-blue-200">
            <Layers className="h-5 w-5 text-white" />
          </div>
          {t("google.adGroup.title")}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t("google.adGroup.intro")}
        </p>
        <p className="text-xs text-slate-400 mt-1">
          {t("google.adGroup.related")}{" "}
          {!isHiddenPage("/google-audit") && (
            <>
              <Link href="/google-audit" className="text-blue-500 hover:underline">Google Audit</Link>
              {" · "}
            </>
          )}
          <Link href="/toolkit/quality-score" className="text-blue-500 hover:underline">Quality Score</Link>
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-2">
            {companyIds().map(c => (
              <button key={c} onClick={() => setCompany(c)}
                className={cn("rounded-lg px-3 py-2 text-sm font-semibold border-2 transition-all",
                  company === c ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500")}>
                {c}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-slate-600 mb-1">{t("google.adGroup.brandLabel")}</label>
            <input value={brand} onChange={e => setBrand(e.target.value)}
              placeholder={t("google.adGroup.brandPh")}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-slate-600 mb-1">{t("google.adGroup.compLabel")}</label>
            <input value={competitor} onChange={e => setCompetitor(e.target.value)}
              placeholder={t("google.adGroup.compPh")}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <Button onClick={run} disabled={loading} className="h-10">
            {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> {t("google.adGroup.analyzing")}</> : t("google.adGroup.analyze")}
          </Button>
        </div>
        <p className="text-[11px] text-slate-400">
          {t("google.adGroup.ruleNote")}
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 space-y-2">
          <div className="flex items-center gap-2 text-red-800 font-bold"><XCircle className="h-5 w-5" /> {t("google.adGroup.errTitle")}</div>
          <p className="text-sm text-red-700 break-words">{error}</p>
          <p className="text-xs text-red-600">{t("google.adGroup.errNote")}</p>
        </div>
      )}

      {!data && !error && !loading && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <Layers className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-600 font-medium">{t("google.adGroup.emptyA")} <strong>{t("google.adGroup.analyze")}</strong>.</p>
          <p className="text-xs text-slate-400 mt-1">{t("google.adGroup.emptyNote")}</p>
        </div>
      )}

      {data && (
        <div className="space-y-4">
          {data.needsBrandTerms && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900">
                <strong>{t("google.adGroup.noBrandA")}</strong> {t("google.adGroup.noBrandB")}
              </div>
            </div>
          )}

          {data.truncated && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
              {t("google.adGroup.capped", { cap: data.cap.toLocaleString(loc) })}
            </div>
          )}

          {data.needsCompetitorTerms && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900">
                <strong>{t("google.adGroup.noCompA")}</strong>{t("google.adGroup.noCompB", { cost: vnd(data.genericCost), share: data.genericShare })}
              </div>
            </div>
          )}

          {data.duplicates.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-white overflow-hidden">
              <div className="bg-rose-50 border-b border-rose-200 p-4">
                <h3 className="font-bold text-rose-900 text-sm">
                  {t("google.adGroup.dupTitle", { n: data.duplicates.length })}
                </h3>
                <p className="text-xs text-rose-800 mt-1">
                  {t("google.adGroup.dupBody1")} <strong>{t("google.adGroup.dupSame")}</strong>{t("google.adGroup.dupBody2")}
                  {data.duplicateCrossCampaignCost > 0 && (
                    <> {t("google.adGroup.dupCross")} <strong>{vnd(data.duplicateCrossCampaignCost)}</strong>{t("google.adGroup.per30")}</>
                  )}
                </p>
              </div>
              <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
                {data.duplicates.map((d, i) => (
                  <div key={i} className="border-b border-slate-100 pb-2 last:border-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-slate-800">{d.text}</span>
                      {d.crossCampaign && d.sameMatchType && (
                        <span className="text-[10px] font-bold uppercase rounded px-1.5 py-0.5 bg-rose-100 text-rose-700 border border-rose-200">
                          {t("google.adGroup.dupReal")}
                        </span>
                      )}
                      {d.crossCampaign && !d.sameMatchType && (
                        <span className="text-[10px] font-bold uppercase rounded px-1.5 py-0.5 bg-slate-100 text-slate-600 border border-slate-200">
                          {t("google.adGroup.dupDiff")}
                        </span>
                      )}
                      <span className="text-xs text-slate-500">{vnd(d.totalCost)}</span>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {d.places.map((p, k) => (
                        <div key={k} className="text-[11px] text-slate-600 flex justify-between gap-3">
                          <span className="truncate">
                            <span className="font-semibold text-slate-700">{p.matchType}</span>{" "}
                            {p.adGroupName} <span className="text-slate-400">· {p.campaignName}</span>
                          </span>
                          <span className="shrink-0">{vnd(p.cost)} · {t("google.adGroup.convN", { n: Math.round(p.conversions * 100) / 100 })}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
            {t("google.adGroup.readN", { n: data.totalAdGroups })}{" "}
            <strong className="text-red-600">{data.oversized.length}</strong> {t("google.adGroup.tooMany")}{" "}
            <strong className="text-amber-600">{data.undersized.length}</strong> {t("google.adGroup.tooFew")}
          </div>

          {data.oversized.length === 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
              {t("google.adGroup.noneOver")}
            </div>
          ) : data.oversized.map(g => {
            const isOpen = open === g.adGroupId;
            return (
              <div key={g.adGroupId} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <button onClick={() => setOpen(isOpen ? null : g.adGroupId)}
                  className="w-full flex items-center justify-between p-4 hover:bg-slate-50 text-left">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
                      <span className="font-bold text-slate-800 truncate">{g.adGroupName}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 ml-6 truncate">{g.campaignName}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5 ml-6">
                      {t("google.adGroup.matchMix", { list: Object.entries(g.matchTypeMix).map(([m, n]) => `${m} ${n}`).join(" · ") })}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 text-right">
                    <div><p className="text-lg font-black text-red-600">{g.keywordCount}</p><p className="text-[10px] text-slate-500 uppercase">{t("google.adGroup.kwUnit")}</p></div>
                    <div><p className="text-sm font-bold text-slate-700">{vnd(g.totalCost)}</p><p className="text-[10px] text-slate-500 uppercase">{t("google.adGroup.d30")}</p></div>
                    <div><p className="text-sm font-bold text-slate-700">{g.totalConversions}</p><p className="text-[10px] text-slate-500 uppercase">{t("google.adGroup.convUnit")}</p></div>
                    <div><p className="text-sm font-bold text-slate-900">{g.cpa !== null ? vnd(g.cpa) : "—"}</p><p className="text-[10px] text-slate-500 uppercase">CPA</p></div>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-100 p-4 space-y-3 bg-slate-50/50">
                    <div className={cn("rounded-lg border p-3 text-sm flex gap-2",
                      g.verdict === "SPLIT" ? "bg-blue-50 border-blue-200 text-blue-900" : "bg-emerald-50 border-emerald-200 text-emerald-900")}>
                      <Info className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{g.verdictReason}</span>
                    </div>

                    {g.splits.map(s => (
                      <div key={s.intent} className={cn("rounded-lg border p-3 space-y-2", s.worthSplitting ? "bg-white border-slate-200" : "bg-slate-100/60 border-slate-200")}>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className={cn("text-[11px] font-bold uppercase rounded px-2 py-0.5 border", INTENT_COLOR[s.intent])}>{s.label}</span>
                            <span className="text-xs text-slate-600">{t("google.adGroup.splitStat", { n: s.count, pct: Math.round(s.costShare * 100) })}</span>
                            {!s.worthSplitting && <span className="text-[10px] text-slate-500">{t("google.adGroup.tooSmall")}</span>}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-600">
                            <span>{vnd(s.cost)}</span>
                            <span>{t("google.adGroup.convN", { n: s.conversions })}</span>
                            <span title={t("google.adGroup.scoredTip", { scored: s.scoredCount, n: s.count })}>
                              QS {s.avgQualityScore ?? t("google.adGroup.notScored")}
                            </span>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-snug">{s.rationale}</p>
                        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                          {s.keywords.map((k, i) => (
                            <span key={i} className="text-[11px] bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-700"
                              title={t("google.adGroup.kwTip", { type: k.matchType, cost: vnd(Math.round(k.cost)), conv: k.conversions }) + (k.matchedOn ? t("google.adGroup.kwTipMatched", { term: k.matchedOn }) : "")}>
                              {k.text}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {data.undersized.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-white p-4">
              <h3 className="font-bold text-slate-800 text-sm mb-2">{t("google.adGroup.underTitle")}</h3>
              <p className="text-xs text-slate-500 mb-3">{t("google.adGroup.underNote")}</p>
              <div className="space-y-1">
                {data.undersized.map(u => (
                  <div key={u.adGroupId} className="flex items-center justify-between text-sm border-b border-slate-100 py-1.5 last:border-0">
                    <div className="min-w-0"><span className="text-slate-700 truncate">{u.adGroupName}</span>
                      <span className="text-xs text-slate-400 ml-2 truncate">{u.campaignName}</span></div>
                    <div className="flex gap-4 shrink-0 text-xs text-slate-600">
                      <span>{t("google.adGroup.nKw", { n: u.keywordCount })}</span><span>{vnd(u.cost)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
