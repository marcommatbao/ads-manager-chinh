"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search, Plus, Trash2, ExternalLink, RefreshCw,
  Eye, Bookmark, Brain, ChevronRight, Loader2,
  AlertTriangle, TrendingUp, TrendingDown, X,
  Globe, Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/Toast";
import type { CompetitorAd, GapInsight, AdAngle } from "@/lib/competitor-config";
import { AD_ANGLES } from "@/lib/competitor-config";
import { orderedCompanyIds } from "@/lib/companies/registry";
import { useT } from "@/lib/i18n/client";

// ─────────────────────────────────────────────
// Types for API responses
// ─────────────────────────────────────────────

interface CompetitorSummary {
  id: string;
  name: string;
  domain: string;
  fbPageId: string;
  category: string;
  isActive: boolean;
  addedAt: string;
  adCount: number;
  newAds7d: number;
}

interface InsightData {
  competitorId: string;
  totalActiveAds: number;
  newAdsThisWeek: number;
  topAngles: string[];
  gapAnalysis: GapInsight | null;
  createdAt: string;
}

// ─────────────────────────────────────────────
// Add Competitor Modal
// ─────────────────────────────────────────────

function AddCompetitorModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [fbPageUrl, setFbPageUrl] = useState("");
  const [category, setCategory] = useState("domain_hosting");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!name.trim() || !domain.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          domain: domain.trim(),
          fbPageUrl: fbPageUrl.trim(),
          category,
          trackingFor: orderedCompanyIds(["MBC", "MBI"]), // Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ)
        }),
      });
      if (res.ok) {
        onAdded();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Plus className="h-4 w-4 text-amber-600" />
            {t("meta.comp.add.title")}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5 block">
              {t("meta.comp.add.name")}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("meta.comp.add.namePh")}
              className="h-10"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5 block">
              {t("meta.comp.add.domain")}
            </label>
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder={t("meta.comp.add.domainPh")}
              className="h-10"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5 block">
              {t("meta.comp.add.fb")}
            </label>
            <Input
              value={fbPageUrl}
              onChange={(e) => setFbPageUrl(e.target.value)}
              placeholder={t("meta.comp.add.fbPh")}
              className="h-10"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              {t("meta.comp.add.fbHint1")}
              <a
                href="https://www.facebook.com/ads/library/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              >
                FB Ad Library
              </a>
              {t("meta.comp.add.fbHint2")}
            </p>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5 block">
              {t("meta.comp.add.industry")}
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 focus:border-amber-400 focus:ring-2 focus:ring-amber-100 outline-none"
            >
              <option value="domain_hosting">{t("meta.comp.cat.domain_hosting")}</option>
              <option value="email">{t("meta.comp.cat.email")}</option>
              <option value="cloud">{t("meta.comp.cat.cloud")}</option>
              <option value="design">{t("meta.comp.cat.design")}</option>
              <option value="saas">{t("meta.comp.cat.saas")}</option>
              <option value="general">{t("meta.comp.cat.general")}</option>
            </select>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("meta.comp.cancel")}
          </Button>
          <Button
            size="sm"
            className="gap-2 bg-amber-500 hover:bg-amber-600 text-amber-950"
            onClick={handleSubmit}
            disabled={saving || !name.trim() || !domain.trim()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t("meta.comp.add.submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Competitor Ad Card
// ─────────────────────────────────────────────

function CompetitorAdCard({ ad }: { ad: CompetitorAd }) {
  const t = useT();
  const scoreColor =
    (ad.aiScore ?? 0) >= 80
      ? "bg-emerald-500"
      : (ad.aiScore ?? 0) >= 60
      ? "bg-amber-500"
      : "bg-red-500";

  const angleColors: Record<string, string> = {
    FOMO: "bg-red-100 text-red-700",
    Price: "bg-green-100 text-green-700",
    Feature: "bg-blue-100 text-blue-700",
    "Social Proof": "bg-purple-100 text-purple-700",
    Authority: "bg-amber-100 text-amber-700",
    Urgency: "bg-orange-100 text-orange-700",
    ROI: "bg-emerald-100 text-emerald-700",
    "Problem-Solution": "bg-cyan-100 text-cyan-700",
    Story: "bg-pink-100 text-pink-700",
    Emotion: "bg-rose-100 text-rose-700",
  };

  // Chụp mốc thời gian MỘT LẦN lúc gắn component thay vì gọi Date.now() ngay
  // trong thân render: đọc đồng hồ lúc render làm hàm render không thuần, gây
  // lệch giữa lần dựng trên máy chủ và lần dựng lại ở trình duyệt. Số ngày
  // chạy không đổi trong một phiên xem nên chụp một lần là đủ.
  const [mountedAt] = useState(() => Date.now());
  const daysRunning = ad.startDate
    ? Math.floor((mountedAt - new Date(ad.startDate).getTime()) / 86400000)
    : null;

  return (
    <div className="group relative flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm hover:shadow-lg transition-all hover:border-slate-300">
      {/* Top bar */}
      <div className="relative bg-gradient-to-r from-slate-50 to-slate-100 px-4 py-3 flex items-center justify-between border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600">
            {ad.competitorName.charAt(0)}
          </div>
          <span className="text-xs font-semibold text-slate-600">{ad.competitorName}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {ad.aiAngle && (
            <span
              className={cn(
                "text-[10px] px-2 py-0.5 rounded-full font-bold",
                angleColors[ad.aiAngle] || "bg-slate-100 text-slate-600"
              )}
            >
              {ad.aiAngle}
            </span>
          )}
          {ad.aiScore != null && (
            <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-bold text-white", scoreColor)}>
              {ad.aiScore}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 space-y-3">
        {/* Hook */}
        {ad.aiHook && (
          <p className="text-xs font-semibold text-violet-700 italic bg-violet-50 rounded-lg px-3 py-2">
            &ldquo;{ad.aiHook}&rdquo;
          </p>
        )}

        {/* Primary text */}
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            Primary Text
          </p>
          <p className="text-xs text-slate-700 leading-relaxed line-clamp-4">
            {ad.primaryText || "—"}
          </p>
        </div>

        {/* Headline */}
        {ad.headline && (
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Headline
            </p>
            <p className="text-sm font-bold text-slate-800">{ad.headline}</p>
          </div>
        )}

        {/* Meta */}
        <div className="flex flex-wrap gap-2 text-[10px] text-slate-400">
          {daysRunning != null && (
            <span className="flex items-center gap-1">
              {t("meta.comp.card.days", { n: daysRunning })}
            </span>
          )}
          {ad.impressionsMin != null && (
            <span>
              👁 {(ad.impressionsMin / 1000).toFixed(0)}K-{((ad.impressionsMax || 0) / 1000).toFixed(0)}K
            </span>
          )}
          {ad.targetAges && <span>🎯 {ad.targetAges}</span>}
        </div>

        {/* AI insights */}
        {ad.aiInsight && (
          <div className="border-t border-slate-100 pt-3 space-y-2">
            <div className="flex flex-wrap gap-1">
              {ad.aiInsight.strengths?.slice(0, 2).map((s, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">
                  ✅ {s.length > 40 ? s.slice(0, 40) + "…" : s}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {ad.aiInsight.weaknesses?.slice(0, 1).map((w, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">
                  ⚠️ {w.length > 50 ? w.slice(0, 50) + "…" : w}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex border-t border-slate-100 divide-x divide-slate-100">
        {ad.snapshotUrl && (
          <a
            href={ad.snapshotUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors font-medium"
          >
            <Eye className="h-3.5 w-3.5" /> {t("meta.comp.card.view")}
          </a>
        )}
        <button className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-slate-500 hover:bg-amber-50 hover:text-amber-800 transition-colors font-medium">
          <Bookmark className="h-3.5 w-3.5" /> {t("meta.comp.card.save")}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Gap Analysis Panel
// ─────────────────────────────────────────────

function GapAnalysisPanel({ insight }: { insight: InsightData | null }) {
  const t = useT();
  if (!insight?.gapAnalysis) {
    return (
      <div className="p-5 text-center">
        <Brain className="h-8 w-8 text-slate-300 mx-auto mb-3" />
        <p className="text-xs text-slate-400 font-medium">{t("meta.comp.gap.none")}</p>
        <p className="text-[10px] text-slate-300 mt-1">{t("meta.comp.gap.noneHint")}</p>
      </div>
    );
  }

  const gap = insight.gapAnalysis;

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Brain className="h-4 w-4 text-violet-500" />
          {t("meta.comp.gap.title")}
        </p>
      </div>
      <div className="flex items-center gap-3 text-[10px] text-slate-400 font-medium">
        <span className="flex items-center gap-1">
          {t("meta.comp.gap.adsCount", { n: insight.totalActiveAds })}
        </span>
        <span className="flex items-center gap-1">
          {t("meta.comp.gap.newCount", { n: insight.newAdsThisWeek })}
        </span>
      </div>

      {/* Dominant angles */}
      <div>
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
          {t("meta.comp.gap.angles")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {insight.topAngles?.map((a) => (
            <span key={a} className="text-[10px] px-2 py-1 rounded-full bg-amber-50 text-amber-800 font-semibold">
              {a}
            </span>
          ))}
        </div>
      </div>

      {/* Gap opportunities */}
      <div>
        <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-2 flex items-center gap-1">
          <TrendingUp className="h-3 w-3" /> {t("meta.comp.gap.opps")}
        </p>
        {gap.gapOpportunities?.map((g, i) => (
          <div key={i} className="text-xs text-slate-600 mb-2.5 pl-3 border-l-2 border-emerald-300 leading-relaxed">
            {g}
          </div>
        ))}
      </div>

      {/* Avoid angles */}
      <div>
        <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-2 flex items-center gap-1">
          <TrendingDown className="h-3 w-3" /> {t("meta.comp.gap.avoid")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {gap.avoidAngles?.map((a) => (
            <span key={a} className="text-[10px] px-2 py-1 rounded-full bg-red-50 text-red-600 font-semibold">
              {a}
            </span>
          ))}
        </div>
      </div>

      {/* Recommendations */}
      <div>
        <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wider mb-2">
          {t("meta.comp.gap.recs")}
        </p>
        {gap.recommendations?.map((r, i) => (
          <div key={i} className="text-xs mb-2 p-3 rounded-lg bg-violet-50 text-violet-800 leading-relaxed font-medium">
            {i + 1}. {r}
          </div>
        ))}
      </div>

      {/* Urgent alert */}
      {gap.urgentAlert && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200">
          <p className="text-xs font-bold text-red-600 mb-1 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" /> {t("meta.comp.gap.urgent")}
          </p>
          <p className="text-xs text-red-700 leading-relaxed">{gap.urgentAlert}</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

export default function CompetitorSpyPage() {
  const t = useT();
  const { toast } = useToast();
  const [competitors, setCompetitors] = useState<CompetitorSummary[]>([]);
  const [ads, setAds] = useState<CompetitorAd[]>([]);
  const [insight, setInsight] = useState<InsightData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Filters
  const [selectedCompetitor, setSelectedCompetitor] = useState("all");
  const [angleFilter, setAngleFilter] = useState("all");
  const [dateRange, setDateRange] = useState("30d");
  const [activeOnly, setActiveOnly] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Modal
  const [showAddModal, setShowAddModal] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        dateRange,
        activeOnly: String(activeOnly),
      });
      if (selectedCompetitor !== "all") params.set("id", selectedCompetitor);
      if (angleFilter !== "all") params.set("angle", angleFilter);

      const res = await fetch(`/api/competitors?${params}`);
      const data = await res.json();
      setCompetitors(data.competitors || []);
      setAds(data.ads || []);
      setInsight(data.insight || null);
    } catch {
      console.error("Failed to fetch competitor data");
    } finally {
      setLoading(false);
    }
  }, [selectedCompetitor, angleFilter, dateRange, activeOnly]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/competitors/sync", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast({ title: t("meta.comp.sync.fail", { error: data?.error || `HTTP ${res.status}` }), variant: "error" });
      } else if (data.errors?.length > 0) {
        toast({ title: t("meta.comp.sync.partial", { n: data.totalSynced, errors: data.errors.length }), variant: "error" });
      } else {
        toast({ title: t("meta.comp.sync.ok", { n: data.totalSynced, competitors: data.competitorsChecked }) });
      }
      await fetchData();
    } catch {
      toast({ title: t("meta.comp.sync.connErr"), variant: "error" });
    } finally {
      setSyncing(false);
    }
  }

  async function handleDeleteCompetitor(id: string) {
    if (!confirm(t("meta.comp.deleteConfirm"))) return;
    await fetch(`/api/competitors?id=${id}`, { method: "DELETE" });
    if (selectedCompetitor === id) setSelectedCompetitor("all");
    fetchData();
  }

  // Filter ads by search text
  const filteredAds = searchQuery
    ? ads.filter(
        (a) =>
          (a.primaryText || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
          (a.headline || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
          (a.aiHook || "").toLowerCase().includes(searchQuery.toLowerCase())
      )
    : ads;

  const totalAllAds = competitors.reduce((s, c) => s + c.adCount, 0);

  return (
    <div className="flex h-[calc(100vh-60px)] overflow-hidden">
      {/* ── LEFT: Competitor List ── */}
      <div className="w-60 border-r border-slate-200 flex flex-col bg-white shrink-0">
        <div className="px-4 py-4 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Search className="h-4 w-4 text-violet-500" />
            {t("meta.comp.spy.title")}
          </h2>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {t("meta.comp.spy.sub")}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          {/* All */}
          <button
            onClick={() => setSelectedCompetitor("all")}
            className={cn(
              "w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
              selectedCompetitor === "all"
                ? "bg-violet-50 text-violet-700 shadow-sm"
                : "text-slate-600 hover:bg-slate-50"
            )}
          >
            <span className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              {t("meta.comp.all")}
            </span>
            <span className="text-[10px] font-bold bg-slate-100 rounded-full px-2 py-0.5 text-slate-500">
              {totalAllAds}
            </span>
          </button>

          {/* Each competitor */}
          {competitors.map((c) => (
            <div key={c.id} className="group relative">
              <button
                onClick={() => setSelectedCompetitor(c.id)}
                className={cn(
                  "w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  selectedCompetitor === c.id
                    ? "bg-violet-50 text-violet-700 shadow-sm"
                    : "text-slate-600 hover:bg-slate-50"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-6 w-6 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600 shrink-0">
                    {c.name.charAt(0)}
                  </div>
                  <div className="text-left min-w-0 flex items-center gap-1.5">
                    <div>
                      <p className="font-semibold text-xs truncate">{c.name}</p>
                      <p className="text-[10px] text-slate-400 truncate">{c.domain}</p>
                    </div>
                    {c.fbPageId && c.fbPageId !== "XXXXXXXXX" && (
                      <a
                        href={`https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=VN&view_all_page_id=${c.fbPageId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-slate-300 hover:text-blue-500 transition-colors"
                        title={t("meta.comp.fbLibrary")}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {c.newAds7d > 0 && (
                    <span className="text-[9px] font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5">
                      +{c.newAds7d}
                    </span>
                  )}
                  <span className="text-[10px] font-bold bg-slate-100 rounded-full px-2 py-0.5 text-slate-500">
                    {c.adCount}
                  </span>
                </div>
              </button>
              {/* Delete */}
              <button
                onClick={() => handleDeleteCompetitor(c.id)}
                className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-red-50 text-slate-300 hover:text-red-500"
                title={t("meta.comp.deleteTitle")}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>

        {/* Add competitor */}
        <div className="p-3 border-t border-slate-100">
          <button
            onClick={() => setShowAddModal(true)}
            className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 py-2.5 text-xs font-semibold text-slate-400 hover:border-amber-300 hover:text-amber-700 hover:bg-amber-50/50 transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("meta.comp.add.submit")}
          </button>
        </div>

        {/* Sync button */}
        <div className="p-3 border-t border-slate-100">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 text-xs"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {syncing ? t("meta.comp.syncing") : t("meta.comp.syncBtn")}
          </Button>
        </div>
      </div>

      {/* ── CENTER: Ad Feed ── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/50">
        {/* Filter bar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 bg-white shrink-0 flex-wrap">
          <div className="flex items-center gap-1.5 text-slate-500">
            <Filter className="h-4 w-4" />
          </div>

          <select
            value={angleFilter}
            onChange={(e) => setAngleFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:border-amber-400 outline-none"
          >
            <option value="all">{t("meta.comp.allAngles")}</option>
            {AD_ANGLES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:border-amber-400 outline-none"
          >
            <option value="7d">{t("meta.comp.range.7d")}</option>
            <option value="30d">{t("meta.comp.range.30d")}</option>
            <option value="all">{t("meta.comp.all")}</option>
          </select>

          <label className="flex items-center gap-2 text-sm cursor-pointer text-slate-600">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
              className="rounded border-slate-300"
            />
            {t("meta.comp.active")}
          </label>

          <div className="ml-auto flex items-center gap-3">
            <Input
              placeholder={t("meta.comp.searchPh")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-48 text-xs"
            />
            <span className="text-xs text-slate-400 font-medium whitespace-nowrap">
              {filteredAds.length} ads
            </span>
          </div>
        </div>

        {/* Ad cards grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : filteredAds.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Search className="h-8 w-8 text-slate-300 mb-3" />
              <p className="text-sm text-slate-500 font-medium">{t("meta.comp.empty")}</p>
              <p className="text-xs text-slate-400 mt-1 mb-4">{t("meta.comp.emptyHint")}</p>
              {selectedCompetitor !== "all" && (
                <a
                  href={`https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=VN&view_all_page_id=${competitors.find(c => c.id === selectedCompetitor)?.fbPageId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors"
                >
                  <ExternalLink className="h-4 w-4" />
                  {t("meta.comp.openLibrary")}
                </a>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredAds.map((ad) => (
                <CompetitorAdCard key={ad.id} ad={ad} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT: Gap Analysis ── */}
      <div className="w-72 border-l border-slate-200 bg-white flex flex-col overflow-y-auto shrink-0">
        <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-violet-50/50 to-white">
          <p className="text-xs font-bold text-violet-700 uppercase tracking-wider">
            {t("meta.comp.insights")}
          </p>
        </div>
        <GapAnalysisPanel insight={insight} />
      </div>

      {/* Add Competitor Modal */}
      {showAddModal && (
        <AddCompetitorModal
          onClose={() => setShowAddModal(false)}
          onAdded={fetchData}
        />
      )}
    </div>
  );
}
