"use client";

import { companyIds } from "@/lib/companies/registry";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw, Loader2, AlertTriangle, TrendingUp, TrendingDown,
  ExternalLink, ChevronDown, ChevronUp, Key, Plus, X, Trash2,
  Eye, Globe, BarChart3, Activity, Zap, Info, CheckCircle2,
  Target, Shield, Lightbulb, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  IntelCompetitor, FBKeywordAd,
  GoogleTransparencyData, TikTokAdData, ChannelAnalysis,
  IntelAlert, ChannelDef, MarketAnalysis,
} from "@/lib/intelligence-config";
import type { SimilarWebData } from "@/lib/similarweb";
import { CHANNELS } from "@/lib/intelligence-config";

// ─────────────────────────────────────────────
// Types for API response
// ─────────────────────────────────────────────

interface CompetitorIntel extends IntelCompetitor {
  similarWeb: SimilarWebData | null;
  fbAds: FBKeywordAd[];
  googleAds: GoogleTransparencyData | null;
  tiktokAds: TikTokAdData[];
  channelAnalysis: ChannelAnalysis | null;
}

interface SWKeyInfo {
  id: string;
  apiKey: string;
  gmail: string;
  addedAt: string;
  expiresAt: string;
  usageCount: number;
  isActive: boolean;
}

// ─────────────────────────────────────────────
// Score Cell — Heatmap Color
// ─────────────────────────────────────────────

function ScoreCell({ score }: { score: number }) {
  const bg =
    score >= 80
      ? "bg-red-500 text-white"
      : score >= 60
      ? "bg-orange-400 text-white"
      : score >= 40
      ? "bg-amber-300 text-amber-900"
      : score >= 20
      ? "bg-yellow-100 text-yellow-800"
      : "bg-slate-100 text-slate-400";

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center w-11 h-8 rounded-lg text-xs font-bold tabular-nums transition-all",
        bg
      )}
    >
      {score > 0 ? score : "—"}
    </div>
  );
}

// ─────────────────────────────────────────────
// Alert Bar
// ─────────────────────────────────────────────

function AlertBar({ alerts }: { alerts: IntelAlert[] }) {
  const unread = alerts.filter((a) => !a.isRead);
  if (unread.length === 0) return null;

  const levelColor: Record<string, string> = {
    high: "border-red-300 bg-red-50 text-red-800",
    medium: "border-amber-300 bg-amber-50 text-amber-800",
    low: "border-blue-300 bg-blue-50 text-blue-800",
  };

  return (
    <div className="space-y-2">
      {unread.slice(0, 3).map((alert) => (
        <div
          key={alert.id}
          className={cn(
            "flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm font-medium animate-in fade-in slide-in-from-top-2 duration-300",
            levelColor[alert.level] || levelColor.low
          )}
        >
          {alert.level === "high" ? (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          ) : (
            <TrendingUp className="h-4 w-4 shrink-0" />
          )}
          <span className="flex-1">{alert.message}</span>
          {alert.changePercent > 0 && (
            <span className="font-bold text-xs px-2 py-0.5 rounded-full bg-white/60">
              +{alert.changePercent}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// SimilarWeb Key Status + Add Modal
// ─────────────────────────────────────────────

function SimilarWebKeyManager() {
  const t = useT();
  const [keys, setKeys] = useState<SWKeyInfo[]>([]);
  const [activeKeyId, setActiveKeyId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [newGmail, setNewGmail] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/intelligence/keys");
      const data = await res.json();
      setKeys(data.keys || []);
      setActiveKeyId(data.activeKeyId);
    } catch {}
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const addKey = async () => {
    if (!newApiKey.trim() || !newGmail.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/intelligence/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: newApiKey.trim(), gmail: newGmail.trim() }),
      });
      setNewApiKey("");
      setNewGmail("");
      setShowModal(false);
      fetchKeys();
    } finally {
      setSaving(false);
    }
  };

  const deleteKey = async (id: string) => {
    await fetch(`/api/intelligence/keys?id=${id}`, { method: "DELETE" });
    fetchKeys();
  };

  const validKeys = keys.filter(
    (k) => k.isActive && new Date(k.expiresAt).getTime() > Date.now()
  );

  const activeKey = keys.find((k) => k.id === activeKeyId);
  const daysLeft = activeKey
    ? Math.ceil(
        (new Date(activeKey.expiresAt).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24)
      )
    : 0;

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs border font-medium cursor-pointer transition-colors",
          activeKey
            ? daysLeft <= 2
              ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
              : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            : "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
        )}
        onClick={() => setShowModal(true)}
      >
        <Key className="h-3 w-3" />
        {activeKey ? (
          <>
            {t("meta.intel.sw.left", { n: daysLeft, keys: validKeys.length })}
          </>
        ) : (
          <>{t("meta.intel.sw.need")}</>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Key className="h-4 w-4 text-emerald-600" />
                {t("meta.intel.sw.manage")}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Instructions */}
              <div className="text-xs text-slate-500 bg-blue-50 rounded-xl p-3 border border-blue-100">
                <p className="font-bold text-blue-700 mb-1 flex items-center gap-1">
                  <Info className="h-3 w-3" /> {t("meta.intel.sw.how")}
                </p>
                <ol className="list-decimal pl-4 space-y-0.5 text-blue-600">
                  <li>{t("meta.intel.sw.step1")}</li>
                  <li>{t("meta.intel.sw.step2")}</li>
                  <li>{t("meta.intel.sw.step3")}</li>
                </ol>
              </div>

              {/* Existing keys */}
              {keys.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    {t("meta.intel.sw.current", { n: keys.length })}
                  </p>
                  {keys.map((k) => {
                    const expired = new Date(k.expiresAt).getTime() < Date.now();
                    return (
                      <div
                        key={k.id}
                        className={cn(
                          "flex items-center justify-between px-3 py-2 rounded-lg border text-xs",
                          expired
                            ? "border-red-200 bg-red-50"
                            : "border-slate-200 bg-white"
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {expired ? (
                            <span className="text-red-400 text-[10px]">⏰</span>
                          ) : (
                            <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                          )}
                          <span className="truncate text-slate-600 font-mono">
                            {k.apiKey}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-400 truncate">{k.gmail}</span>
                        </div>
                        <button
                          onClick={() => deleteKey(k.id)}
                          className="text-slate-300 hover:text-red-500 transition-colors ml-2"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add new key */}
              <div className="border-t border-slate-100 pt-4 space-y-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {t("meta.intel.sw.addNew")}
                </p>
                <Input
                  value={newGmail}
                  onChange={(e) => setNewGmail(e.target.value)}
                  placeholder="gmail@gmail.com"
                  className="h-9 text-sm"
                />
                <Input
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder="similarweb-api-key-xxxxxxxx"
                  className="h-9 text-sm font-mono"
                />
                <Button
                  size="sm"
                  className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={addKey}
                  disabled={saving || !newApiKey.trim() || !newGmail.trim()}
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  {t("meta.intel.sw.add")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────
// Competitor Detail Panel
// ─────────────────────────────────────────────

function CompetitorDetailPanel({
  competitor,
}: {
  competitor: CompetitorIntel;
}) {
  const t = useT();
  const intl = useIntlLocale();
  const sw = competitor.similarWeb;
  const analysis = competitor.channelAnalysis;
  const fbTotal = competitor.fbAds.reduce((s, a) => s + a.adCount, 0);
  const ggTotal = competitor.googleAds?.totalAds || 0;
  const ttTotal = competitor.tiktokAds.length;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden animate-in fade-in slide-in-from-bottom-3 duration-300">
      {/* Header */}
      <div className="px-5 py-4 bg-gradient-to-r from-violet-50 to-blue-50 border-b border-slate-100">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Globe className="h-4 w-4 text-violet-500" />
              {competitor.name}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">{competitor.domain}</p>
          </div>
          {analysis && (
            <div className="text-right">
              <p className="text-[10px] font-bold text-slate-400 uppercase">{t("meta.intel.det.strongest")}</p>
              <p className="text-sm font-bold text-violet-700">{analysis.dominantChannel}</p>
            </div>
          )}
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Col 1: SimilarWeb Stats ── */}
        <div className="space-y-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Globe className="h-3 w-3" /> SimilarWeb
          </p>
          {sw ? (
            <div className="space-y-3">
              {sw.isEstimated && (
                <div className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 flex items-center gap-1.5">
                  {t("meta.intel.det.swMissing")}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <StatCard label="Global Rank" value={sw.globalRank ? `#${sw.globalRank.toLocaleString(intl)}` : "N/A"} />
                <StatCard label="VN Rank" value={sw.countryRank ? `#${sw.countryRank.toLocaleString(intl)}` : "N/A"} />
                <StatCard
                  label="Monthly Visits"
                  value={
                    sw.monthlyVisits && Object.keys(sw.monthlyVisits).length > 0
                      ? `${(Object.values(sw.monthlyVisits).pop()! / 1000).toFixed(0)}K`
                      : "N/A"
                  }
                />
                <StatCard
                  label="Bounce Rate"
                  value={sw.bounceRate != null && !(sw.isEstimated && !sw.bounceRate) ? `${(sw.bounceRate * 100).toFixed(1)}%` : "N/A"}
                />
              </div>

              {/* Traffic Sources Bar Chart */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-slate-500">Traffic Sources</p>
                {Object.values(sw.trafficSources).every((v) => !v) && (
                  <p className="text-[10px] text-slate-400">{t("meta.intel.det.noSources")}</p>
                )}
                {Object.values(sw.trafficSources).some((v) => v > 0) && Object.entries(sw.trafficSources).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-2 text-[10px]">
                    <span className="w-14 text-slate-400 capitalize font-medium">{key}</span>
                    <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-400 to-violet-500 transition-all duration-500"
                        style={{ width: `${Math.min(val * 100, 100)}%` }}
                      />
                    </div>
                    <span className="w-10 text-right font-bold text-slate-600">
                      {(val * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>

              {/* Top Social */}
              {sw.topSocialNetworks && sw.topSocialNetworks.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 mb-1">Top Social</p>
                  <div className="flex flex-wrap gap-1">
                    {sw.topSocialNetworks.map((sn) => (
                      <span
                        key={sn.name}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold"
                      >
                        {sn.name} {(sn.value * 100).toFixed(0)}%
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400">{t("meta.intel.det.noData")}</p>
          )}
        </div>

        {/* ── Col 2: Ads Summary ── */}
        <div className="space-y-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <BarChart3 className="h-3 w-3" /> Active Ads
          </p>

          {/* Ad counts */}
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-3 rounded-xl bg-blue-50 border border-blue-100">
              <p className="text-lg font-bold text-blue-700">{fbTotal}</p>
              <p className="text-[10px] text-blue-500 font-semibold">FB Ads</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-red-50 border border-red-100">
              <p className="text-lg font-bold text-red-600">{ggTotal}</p>
              <p className="text-[10px] text-red-500 font-semibold">Google</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-lg font-bold text-slate-700">{ttTotal}</p>
              <p className="text-[10px] text-slate-500 font-semibold">TikTok</p>
            </div>
          </div>

          {/* FB Ad preview */}
          {competitor.fbAds.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-slate-500">Latest FB Ads</p>
              {competitor.fbAds.slice(0, 2).map((ad, i) => (
                <div
                  key={i}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-600 leading-relaxed"
                >
                  <p className="font-semibold text-slate-700 mb-1">{ad.pageName}</p>
                  <p className="line-clamp-2">
                    {ad.latestAdText || t("meta.intel.det.noText")}
                  </p>
                  {ad.snapshotUrl && (
                    <a
                      href={ad.snapshotUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-1.5 text-[10px] text-blue-500 hover:text-blue-700 font-semibold"
                    >
                      <ExternalLink className="h-3 w-3" /> {t("meta.intel.det.viewFb")}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Google Ad formats */}
          {competitor.googleAds && competitor.googleAds.adFormats.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 mb-1">Google Ad Formats</p>
              <div className="flex flex-wrap gap-1">
                {competitor.googleAds.adFormats.map((fmt) => (
                  <span
                    key={fmt}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-semibold"
                  >
                    {fmt}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Col 3: AI Summary ── */}
        <div className="space-y-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Zap className="h-3 w-3 text-violet-500" /> AI Analysis
          </p>

          {analysis ? (
            <div className="space-y-3">
              {analysis.isEstimated && (
                <div className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 flex items-center gap-1.5">
                  {t("meta.intel.det.aiMissing")}
                </div>
              )}
              <div className="p-3 rounded-xl bg-violet-50 border border-violet-100">
                <p className="text-xs text-violet-800 leading-relaxed font-medium">
                  {analysis.channelSummary}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-100 text-center">
                  <p className="text-[9px] font-bold text-amber-500 uppercase">Dominant</p>
                  <p className="text-xs font-bold text-amber-700 mt-0.5">{analysis.dominantChannel}</p>
                </div>
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-100 text-center">
                  <p className="text-[9px] font-bold text-emerald-500 uppercase">Growing</p>
                  <p className="text-xs font-bold text-emerald-700 mt-0.5">{analysis.growingChannel}</p>
                </div>
                <div className="p-2.5 rounded-xl bg-red-50 border border-red-100 text-center">
                  <p className="text-[9px] font-bold text-red-400 uppercase">Weak</p>
                  <p className="text-xs font-bold text-red-600 mt-0.5">{analysis.weakChannel}</p>
                </div>
                <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-100 text-center">
                  <p className="text-[9px] font-bold text-blue-400 uppercase">Opportunity</p>
                  <p className="text-xs font-bold text-blue-700 mt-0.5">{analysis.opportunityFor}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400">{t("meta.intel.det.noAi")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-center">
      <p className="text-[9px] font-bold text-slate-400 uppercase">{label}</p>
      <p className="text-sm font-bold text-slate-700 mt-0.5">{value}</p>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Intelligence Dashboard Page
// ─────────────────────────────────────────────

const SCORE_KEYS: { key: string; label: string; icon: string }[] = [
  { key: "facebook", label: "Facebook", icon: "📘" },
  { key: "google",   label: "Google",   icon: "🔍" },
  { key: "tiktok",   label: "TikTok",   icon: "🎵" },
  { key: "seo",      label: "SEO",      icon: "📈" },
  { key: "email",    label: "Email",    icon: "📧" },
  { key: "direct",   label: "Direct",   icon: "🏠" },
];

// ─────────────────────────────────────────────
// Market Analysis Overview Panel (Gemini batch)
// ─────────────────────────────────────────────

function MarketAnalysisPanel({ analysis }: { analysis: MarketAnalysis }) {
  const t = useT();
  const intl = useIntlLocale();
  const threatColor: Record<string, string> = {
    high: "bg-red-100 text-red-700 border-red-200",
    medium: "bg-amber-100 text-amber-700 border-amber-200",
    low: "bg-slate-100 text-slate-600 border-slate-200",
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-3 duration-300">
      <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-violet-50 to-indigo-50">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Zap className="h-4 w-4 text-violet-500" /> AI Market Analysis
        </p>
        <p className="text-xs text-slate-400 mt-0.5">
          {t("meta.intel.mkt.sub")}
          {analysis.analyzedAt && (
            <span className="ml-1 text-[10px] text-slate-300">
              · {new Date(analysis.analyzedAt).toLocaleString(intl, {
                hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
              })}
            </span>
          )}
        </p>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Col 1: Market Overview + Dominant */}
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-gradient-to-br from-violet-50 to-blue-50 border border-violet-100">
            <p className="text-[10px] font-bold text-violet-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Globe className="h-3 w-3" /> {t("meta.intel.mkt.overview")}
            </p>
            <p className="text-sm text-slate-700 leading-relaxed font-medium">
              {analysis.marketOverview}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-amber-50 border border-amber-100">
            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Target className="h-3 w-3" /> {t("meta.intel.mkt.dominant")}
            </p>
            <p className="text-sm font-bold text-amber-800">
              {analysis.dominantChannels.channel.toUpperCase()}
            </p>
            <p className="text-xs text-amber-600 mt-1 leading-relaxed">
              {analysis.dominantChannels.reason}
            </p>
            {analysis.estimatedDomains && analysis.estimatedDomains.length > 0 && (
              <div className="mt-2 text-[10px] font-semibold text-amber-700 bg-amber-100/70 border border-amber-200 rounded-lg px-2 py-1.5 flex items-center gap-1.5">
                {t("meta.intel.mkt.swMissing", { list: analysis.estimatedDomains.join(", ") })}
              </div>
            )}
          </div>

          {analysis.underinvestedChannels && analysis.underinvestedChannels.length > 0 && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100">
              <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-2 flex items-center gap-1">
                <TrendingDown className="h-3 w-3" /> {t("meta.intel.mkt.under")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {analysis.underinvestedChannels.map((ch) => (
                  <span
                    key={ch}
                    className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-bold"
                  >
                    {ch}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Col 2: Competitor Highlights */}
        <div className="space-y-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Shield className="h-3 w-3" /> {t("meta.intel.mkt.each")}
          </p>
          {analysis.competitorHighlights?.map((h) => (
            <div
              key={h.domain}
              className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  {h.domain}
                  {analysis.estimatedDomains?.includes(h.domain) && (
                    <span
                      title={t("meta.intel.mkt.missingTitle")}
                      className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5 shrink-0"
                    >
                      {t("meta.intel.mkt.missing")}
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  {h.strategy}
                </p>
              </div>
              <span
                className={cn(
                  "text-[9px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0",
                  threatColor[h.threat] || threatColor.low
                )}
              >
                {h.threat === "high" ? t("meta.intel.threat.high") : h.threat === "medium" ? t("meta.intel.threat.medium") : t("meta.intel.threat.low")}
              </span>
            </div>
          ))}
        </div>

        {/* Col 3: Opportunity for MBC */}
        <div className="space-y-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Lightbulb className="h-3 w-3 text-amber-500" /> {t("meta.intel.mkt.opp")}
          </p>

          <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">🎯</span>
              <div>
                <p className="text-[10px] font-bold text-blue-500 uppercase">{t("meta.intel.mkt.best")}</p>
                <p className="text-sm font-bold text-blue-800">
                  {analysis.opportunityForMBC.bestChannel}
                </p>
              </div>
            </div>
            <p className="text-xs text-blue-700 leading-relaxed mb-3">
              {analysis.opportunityForMBC.reasoning}
            </p>
            <div className="p-3 rounded-lg bg-white/80 border border-blue-100">
              <p className="text-[10px] font-bold text-blue-500 uppercase mb-1 flex items-center gap-1">
                <ArrowRight className="h-3 w-3" /> {t("meta.intel.mkt.quickWin")}
              </p>
              <p className="text-xs text-blue-800 font-medium leading-relaxed">
                {analysis.opportunityForMBC.quickWin}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Intelligence Dashboard Page
// ─────────────────────────────────────────────

export default function IntelligencePage() {
  const t = useT();
  const intl = useIntlLocale();
  const [competitors, setCompetitors] = useState<CompetitorIntel[]>([]);
  const [marketAnalysis, setMarketAnalysisState] = useState<MarketAnalysis | null>(null);
  const [alerts, setAlerts] = useState<IntelAlert[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  // Bid Tracker State
  const [bidIssues, setBidIssues] = useState<any[]>([]);
  const [loadingBid, setLoadingBid] = useState(true);

  // Fetch Bid Issues separately
  useEffect(() => {
     // Đợt 21: trước đây ghim MBC → bản cài khách 403, bảng luôn trống. Bản Mắt Bão: vẫn MBC.
     const bidCo = companyIds().includes("MBC") ? "MBC" : companyIds()[0];
     fetch(`/api/intelligence/bid-tracker?company=${encodeURIComponent(bidCo ?? "")}`)
     .then(res => res.json())
     .then(data => { if(data.success) setBidIssues(data.data); })
     .finally(() => setLoadingBid(false));
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/intelligence");
      const data = await res.json();
      setCompetitors(data.competitors || []);
      setMarketAnalysisState(data.marketAnalysis || null);
      setAlerts(data.alerts || []);
      setLastSyncAt(data.lastSyncAt);
    } catch {
      console.error("Failed to fetch intelligence data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncProgress(t("meta.intel.sync.starting"));
    try {
      setSyncProgress(t("meta.intel.sync.collecting"));
      const res = await fetch("/api/intelligence", { method: "POST" });
      const data = await res.json();
      setSyncProgress(
        data.success
          ? `✅ ${data.message}`
          : `❌ ${data.error || t("meta.intel.sync.unknown")}`
      );
      await fetchData();
    } catch {
      setSyncProgress(t("meta.intel.sync.failed"));
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncProgress(""), 5000);
    }
  };

  const selectedComp = competitors.find((c) => c.id === selected);
  const hasData = competitors.some((c) => c.channelAnalysis);

  return (
    <div className="flex flex-col gap-5 p-6 max-w-[1400px] mx-auto">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            {t("meta.intel.title")}
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {t("meta.intel.sub", { n: competitors.length })}
            {lastSyncAt && (
              <span className="ml-2 text-[10px] text-slate-300">
                {t("meta.intel.lastSync")}
                {new Date(lastSyncAt).toLocaleString(intl, {
                  hour: "2-digit",
                  minute: "2-digit",
                  day: "2-digit",
                  month: "2-digit",
                })}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* SimilarWebKeyManager hidden: its backend (/api/intelligence/keys)
              was never built — this pass fixed the bid-tracker 404 but
              deliberately deferred building a new key-management CRUD
              feature (scope decision, not a bug fix). Re-enable once that
              backend exists — see lib/team.ts for the JSON-store pattern
              to follow. */}

          <Button
            size="sm"
            className="gap-2 bg-amber-500 hover:bg-amber-600 text-amber-950 font-semibold"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {syncing ? t("meta.intel.syncing") : t("meta.intel.syncNow")}
          </Button>
        </div>
      </div>

      {/* Sync progress */}
      {syncProgress && (
        <div className={cn(
          "px-4 py-2.5 rounded-xl text-sm font-medium animate-in fade-in duration-200",
          syncProgress.startsWith("✅")
            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
            : syncProgress.startsWith("❌")
            ? "bg-red-50 text-red-700 border border-red-200"
            : "bg-blue-50 text-blue-700 border border-blue-200"
        )}>
          {syncing && <Loader2 className="h-3.5 w-3.5 inline-block animate-spin mr-2" />}
          {syncProgress}
        </div>
      )}

      {/* ── Bid Strategy Tracker (MBC Account Health) ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-teal-50 to-emerald-50 flex items-center justify-between">
              <div>
                  <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
                     <Target className="h-4 w-4 text-teal-600" />
                     {t("meta.intel.bid.title")}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {t("meta.intel.bid.desc")}
                  </p>
              </div>
          </div>
          <div className="p-5">
              {loadingBid ? (
                  <div className="flex items-center justify-center p-4"><Loader2 className="h-6 w-6 animate-spin text-teal-500"/></div>
              ) : bidIssues.length === 0 ? (
                  <p className="text-sm text-slate-500 italic text-center py-4">{t("meta.intel.bid.ok")}</p>
              ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                     {bidIssues.map((issue, idx) => (
                         <div key={idx} className={cn("p-4 rounded-xl border-l-[4px] shadow-sm bg-slate-50", 
                            issue.severity === "CRITICAL" ? "border-l-red-500 border-red-100" : "border-l-amber-400 border-amber-100"
                         )}>
                             <div className="flex items-center justify-between mb-2">
                                 <h4 className="text-xs font-bold text-slate-700 truncate">{issue.campaignName}</h4>
                                 <span className={cn("text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded",
                                     issue.severity === "CRITICAL" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                                 )}>{issue.type.replace(/_/g, " ")}</span>
                             </div>
                             <p className="text-xs text-slate-600 font-medium leading-relaxed mb-3">{issue.description}</p>
                             <div className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-slate-100 shadow-sm">
                                 <span className="text-[10px] uppercase font-bold text-slate-400">{issue.metricLabel}</span>
                                 <span className="text-[11px] font-black text-slate-800">{issue.metricValue}</span>
                             </div>
                         </div>
                     ))}
                  </div>
              )}
          </div>
      </div>

      {/* ── Alert Bar ── */}
      <AlertBar alerts={alerts} />

      {/* ── MAIN: Channel Heatmap ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
            {t("meta.intel.map.title")}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {t("meta.intel.map.sub")}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : !hasData ? (
          <div className="flex flex-col items-center justify-center h-48 text-center p-5">
            <Activity className="h-8 w-8 text-slate-300 mb-3" />
            <p className="text-sm text-slate-500 font-medium">
              {t("meta.intel.map.empty")}
            </p>
            <p className="text-xs text-slate-400 mt-1 mb-4">
              {t("meta.intel.map.emptyHint")}
            </p>
            <Button
              size="sm"
              className="gap-2 bg-amber-500 hover:bg-amber-600 text-amber-950"
              onClick={handleSync}
              disabled={syncing}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("meta.intel.syncNowPlain")}
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-3 pt-4 px-5 w-36">
                    {t("meta.intel.map.competitor")}
                  </th>
                  {SCORE_KEYS.map((sk) => (
                    <th
                      key={sk.key}
                      className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-3 pt-4 px-2"
                    >
                      <span className="block text-sm mb-0.5">{sk.icon}</span>
                      {sk.label}
                    </th>
                  ))}
                  <th className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-3 pt-4 px-3">
                    Dominant
                  </th>
                  <th className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-3 pt-4 px-3">
                    Opportunity
                  </th>
                </tr>
              </thead>
              <tbody>
                {competitors.map((c) => {
                  const analysis = c.channelAnalysis;
                  const isSelected = selected === c.id;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => setSelected(isSelected ? null : c.id)}
                      className={cn(
                        "cursor-pointer transition-all duration-150 border-b border-slate-50",
                        isSelected
                          ? "bg-violet-50/70 ring-1 ring-violet-200"
                          : "hover:bg-slate-50/70"
                      )}
                    >
                      {/* Competitor name */}
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="h-7 w-7 rounded-lg flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                            style={{ backgroundColor: c.color || "#6366f1" }}
                          >
                            {c.shortName || c.name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                              {c.name}
                              {analysis?.isEstimated && (
                                <span
                                  title={t("meta.intel.map.swMissingTitle")}
                                  className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5 shrink-0"
                                >
                                  {t("meta.intel.mkt.missing")}
                                </span>
                              )}
                            </p>
                            <p className="text-[10px] text-slate-400">{c.domain}</p>
                          </div>
                        </div>
                      </td>

                      {/* Score cells */}
                      {SCORE_KEYS.map((sk) => (
                        <td key={sk.key} className="py-3.5 px-2 text-center">
                          <ScoreCell
                            score={
                              analysis?.channelScores?.[sk.key as keyof typeof analysis.channelScores] || 0
                            }
                          />
                        </td>
                      ))}

                      {/* Dominant */}
                      <td className="py-3.5 px-3 text-center">
                        <span className="text-[10px] px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-bold whitespace-nowrap">
                          {analysis?.dominantChannel || "..."}
                        </span>
                      </td>

                      {/* Opportunity */}
                      <td className="py-3.5 px-3 text-center">
                        <span className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-bold whitespace-nowrap">
                          {analysis?.opportunityFor || "..."}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Competitor Detail Panel ── */}
      {selectedComp && <CompetitorDetailPanel competitor={selectedComp} />}

      {/* ── Market Analysis (Gemini Batch) ── */}
      {marketAnalysis && <MarketAnalysisPanel analysis={marketAnalysis} />}

      {/* ── Heatmap Legend ── */}
      {hasData && (
        <div className="flex items-center gap-3 justify-center text-[10px] text-slate-400 font-medium">
          <span>{t("meta.intel.legend")}</span>
          <div className="flex items-center gap-1">
            <div className="w-4 h-3 rounded bg-slate-100" />
            <span>0–19</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-3 rounded bg-yellow-100" />
            <span>20–39</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-3 rounded bg-amber-300" />
            <span>40–59</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-3 rounded bg-orange-400" />
            <span>60–79</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-3 rounded bg-red-500" />
            <span>80–100</span>
          </div>
        </div>
      )}
    </div>
  );
}
