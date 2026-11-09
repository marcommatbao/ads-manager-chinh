"use client";

import { useState, useCallback } from "react";
import {
  Users, Search, ChevronDown, Copy, Check,
  Loader2, Tag, Briefcase, ShoppingBag, Cpu,
  Rocket, AlertCircle, CheckCircle2, X, Eye } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  name: string;
  status: string;
  objective?: string;
}

interface InterestItem {
  name: string;
  category: string;
  reason: string;
  /** "ai" = do AI đề xuất dựa trên sản phẩm + targeting; "meta" = Meta gợi ý sẵn. */
  source?: "ai" | "meta";
  /** AI dựa vào đâu để đề xuất mục này. */
  basis?: string;
  /** Ô đích: interests | behaviors | work_positions… Thiếu = interests. */
  targetingType?: string;
  metaId?: string;
  metaName?: string;
  audienceSize?: number;
  path?: string[];
  resolved?: boolean;
}

interface TargetingSummary {
  ageRanges: string[];
  genders: string[];
  locations: { countries: string[]; cities: string[] };
  interests: { id: string; name: string }[];
  behaviors: { id: string; name: string }[];
  isBroadTargeting: boolean;
  placements: { platforms: string[]; facebookPositions: string[]; instagramPositions: string[] };
  devices: string[];
  adsetCount: number;
  activeCount: number;
}

interface AnalyzeResult {
  targeting: TargetingSummary;
  interestSuggestions: InterestItem[];
  /** Số gợi ý AI bị loại vì Facebook không có interest tương ứng. */
  aiDropped?: number;
  adsets: { id: string; name: string; status: string }[];
}

interface ApplyResult {
  success: boolean;
  label: string;
  detail?: string;
  error?: string;
  /** Chỉ có ở chế độ Xem trước: targeting SẼ ghi, chưa gọi Meta lần nào. */
  preview?: Array<{
    adsetId: string;
    adsetName: string;
    added: Array<{ bucket: string; bucketLabel: string; items: string[] }>;
    skipped: Array<{ name: string; reason: string }>;
    flexibleSpecAfter: unknown[];
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAudience(n?: number) {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** Nhãn tiếng Việt cho ô đích trong flexible_spec (khớp lib/audience-targeting-merge). */
const BUCKET_LABEL_KEY: Record<string, MessageKey> = {
  interests: "creative.audience.bucket.interests", behaviors: "creative.audience.bucket.behaviors", life_events: "creative.audience.bucket.lifeEvents",
  industries: "creative.audience.bucket.industries", income: "creative.audience.bucket.income", family_statuses: "creative.audience.bucket.familyStatuses",
  work_positions: "creative.audience.bucket.workPositions", work_employers: "creative.audience.bucket.workEmployers",
  education_majors: "creative.audience.bucket.educationMajors", education_schools: "creative.audience.bucket.educationSchools",
};

// Nhãn hiển thị cho nhóm gợi ý (giá trị category từ API vẫn là khoá logic).
const CATEGORY_LABEL_KEY: Record<string, MessageKey> = {
  "Nghề nghiệp": "creative.audience.cat.job",
  "Hành vi": "creative.audience.cat.behavior",
  "Công nghệ": "creative.audience.cat.tech",
  "Meta Suggestion": "creative.audience.cat.metaSuggestion",
};

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  "Nghề nghiệp": <Briefcase className="h-3.5 w-3.5" />,
  "Hành vi": <ShoppingBag className="h-3.5 w-3.5" />,
  "Công nghệ": <Cpu className="h-3.5 w-3.5" />,
  "Meta Suggestion": <Rocket className="h-3.5 w-3.5" />,
};

const CATEGORY_COLOR: Record<string, string> = {
  "Nghề nghiệp": "bg-blue-50 text-blue-700 border-blue-200",
  "Hành vi": "bg-amber-50 text-amber-700 border-amber-200",
  "Công nghệ": "bg-violet-50 text-violet-700 border-violet-200",
  "Meta Suggestion": "bg-emerald-50 text-emerald-700 border-emerald-200",
};

// ─── Copy Button ──────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      onClick={copy}
      title={t("creative.audience.copyTitle", { v: label ?? text })}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {label ?? text}
    </button>
  );
}

// ─── Interest Card ────────────────────────────────────────────────────────────

function InterestCard({
  item,
  selected,
  onToggle,
}: {
  item: InterestItem;
  selected: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const colorClass = CATEGORY_COLOR[item.category] ?? "bg-slate-50 text-slate-700 border-slate-200";
  const icon = CATEGORY_ICON[item.category] ?? <Tag className="h-3.5 w-3.5" />;
  const audience = fmtAudience(item.audienceSize);
  const canApply = item.resolved && !!item.metaId;

  return (
    <div
      onClick={canApply ? onToggle : undefined}
      className={`rounded-xl border p-4 shadow-sm transition-all ${
        canApply ? "cursor-pointer" : "opacity-60"
      } ${
        selected
          ? "border-amber-400 bg-amber-50 shadow-amber-100 ring-1 ring-amber-300"
          : "border-slate-200 bg-white hover:border-amber-300 hover:shadow-md"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        {/* Category badge */}
        <div className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${colorClass}`}>
          {icon}
          {CATEGORY_LABEL_KEY[item.category] ? t(CATEGORY_LABEL_KEY[item.category]) : item.category}
        </div>

        {/* Checkbox */}
        {canApply && (
          <div className={`shrink-0 h-4 w-4 rounded border-2 flex items-center justify-center transition-colors ${
            selected ? "bg-amber-500 border-amber-500" : "border-slate-300"
          }`}>
            {selected && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
          </div>
        )}
      </div>

      {/* Name */}
      <p className="text-sm font-semibold text-slate-800 mb-0.5">{item.name}</p>
      {item.resolved && item.metaName && item.metaName !== item.name && (
        <p className="text-xs text-slate-400 mb-1">→ <span className="font-medium text-slate-600">{item.metaName}</span></p>
      )}

      {/* Reason */}
      <p className="text-xs text-slate-500 leading-relaxed mb-1">{item.reason}</p>

      {/* Loại mục nhắm — Sở thích và Hành vi vào hai ô khác nhau của adset,
          nên phải nhìn ra được chứ không chỉ hệ thống biết. */}
      {item.targetingType && item.targetingType !== "interests" && (
        <p className="text-[11px] text-slate-500 mb-1">
          {t("creative.audience.typeLabel")} <span className="font-medium">{BUCKET_LABEL_KEY[item.targetingType] ? t(BUCKET_LABEL_KEY[item.targetingType]) : item.targetingType}</span>
        </p>
      )}

      {/* Căn cứ — để người đọc biết gợi ý này dựa trên cái gì, thay vì phải tin suông */}
      {item.basis && (
        <p className="text-[11px] text-slate-400 mb-3">
          {t("creative.audience.basedOn")} <span className="font-medium text-slate-500">{item.basis}</span>
        </p>
      )}
      {!item.basis && <div className="mb-3" />}

      {/* Meta ID + audience */}
      {canApply ? (
        <div className="space-y-1.5" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-400">ID:</span>
            <CopyButton text={item.metaId!} label={item.metaId!} />
          </div>
          {audience && (
            <p className="text-xs text-slate-400">
              {t("creative.audience.reach")} <span className="font-semibold text-slate-600">{audience}+</span>
            </p>
          )}
          {item.path && item.path.length > 0 && (
            <p className="text-xs text-slate-400 truncate" title={item.path.join(" › ")}>
              {item.path.join(" › ")}
            </p>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1 text-xs text-amber-600">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
          {t("creative.audience.noInterestId")}
        </div>
      )}
    </div>
  );
}

// ─── Apply Toast ──────────────────────────────────────────────────────────────

function ApplyToast({
  results,
  onClose,
}: {
  results: ApplyResult[];
  onClose: () => void;
}) {
  const t = useT();
  const allOk = results.every(r => r.success);
  return (
    <div className={`rounded-xl border p-4 flex gap-3 ${
      allOk ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
    }`}>
      {allOk
        ? <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
        : <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
      }
      <div className="flex-1 space-y-1">
        {results.map((r, i) => (
          <div key={i}>
            <p className={`text-sm font-semibold ${allOk ? "text-emerald-800" : "text-red-700"}`}>{r.label}</p>
            {r.detail && <p className="text-xs text-emerald-700">{r.detail}</p>}
            {r.error && <p className="text-xs text-red-600">{r.error}</p>}

            {/* Xem trước: nói rõ từng adset sẽ nhận gì, vào ô nào. Kèm JSON
                thật sẽ gửi — để soi được chứ không phải tin lời tóm tắt. */}
            {r.preview?.map(pv => (
              <div key={pv.adsetId} className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-700">{pv.adsetName}</p>
                {pv.added.length === 0 && (
                  <p className="text-xs text-slate-500 mt-1">{t("creative.audience.nothingToAdd")}</p>
                )}
                {pv.added.map(a => (
                  <p key={a.bucket} className="text-xs text-slate-600 mt-1">
                    {t("creative.audience.toBucket")} <span className="font-medium">{a.bucketLabel}</span>: {a.items.join(", ")}
                  </p>
                ))}
                {pv.skipped.length > 0 && (
                  <p className="text-xs text-amber-700 mt-1">
                    {t("creative.audience.skipped")} {pv.skipped.map(sk => `${sk.name} (${sk.reason})`).join("; ")}
                  </p>
                )}
                <details className="mt-1">
                  <summary className="text-[11px] text-slate-400 cursor-pointer">{t("creative.audience.viewJson")}</summary>
                  <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-50 p-2 text-[10px] text-slate-600">
{JSON.stringify(pv.flexibleSpecAfter, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
          </div>
        ))}
      </div>
      <button onClick={onClose} className="shrink-0 text-slate-400 hover:text-slate-600">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AudiencePage() {
  const t = useT();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [topSegment, setTopSegment] = useState("");
  const [topSegmentReason, setTopSegmentReason] = useState("");
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [applyResults, setApplyResults] = useState<ApplyResult[] | null>(null);

  // Fetch campaign list on dropdown open
  const loadCampaigns = useCallback(async () => {
    if (campaigns.length > 0) return;
    setLoadingCampaigns(true);
    try {
      const res = await fetch("/api/meta/campaigns");
      const json = await res.json();
      const raw = json?.data ?? json?.campaigns ?? [];
      setCampaigns(
        Array.isArray(raw)
          ? raw.map((c: { id: string; name: string; status: string; objective?: string }) => ({
              id: c.id,
              name: c.name,
              status: c.status,
              objective: c.objective,
            }))
          : []
      );
    } catch {
      setCampaigns([]);
    } finally {
      setLoadingCampaigns(false);
    }
  }, [campaigns.length]);

  // Run analysis
  const analyze = async () => {
    if (!selectedCampaign) return;
    setAnalyzing(true);
    setResult(null);
    setError(null);
    setSelectedIds(new Set());
    setApplyResults(null);
    try {
      const res = await fetch("/api/automation/audience/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: selectedCampaign.id,
          campaignName: selectedCampaign.name,
          objective: selectedCampaign.objective,
          topSegment: topSegment || undefined,
          topSegmentReason: topSegmentReason || undefined,
          suggestInterests: true,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? t("creative.audience.analyzeFailed"));
      } else {
        setResult(json.data as AnalyzeResult);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("creative.audience.connectionError"));
    } finally {
      setAnalyzing(false);
    }
  };

  // Áp dụng mục nhắm đã chọn. dryRun=true chỉ dựng targeting rồi trả về xem,
  // KHÔNG ghi gì lên Meta — dùng để soi trước khi cho đụng tài khoản thật.
  const applyInterests = async (dryRun = false) => {
    if (!selectedCampaign || selectedIds.size === 0 || !result) return;
    setApplying(true);
    setApplyResults(null);
    try {
      const interests = result.interestSuggestions
        .filter(i => i.metaId && selectedIds.has(i.metaId))
        // targetingType quyết định mục này vào ô nào (Sở thích/Hành vi/Chức
        // danh). Quên gửi là tất cả rơi hết vào Sở thích → nhắm sai tệp.
        .map(i => ({ id: i.metaId!, name: i.metaName ?? i.name, targetingType: i.targetingType }));

      const res = await fetch("/api/automation/audience/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: selectedCampaign.id,
          campaignName: selectedCampaign.name,
          dryRun,
          actions: [{
            type: "add_interests",
            label: t(dryRun ? "creative.audience.actionLabelPreview" : "creative.audience.actionLabelAdd", { n: interests.length }),
            params: { interests },
          }],
        }),
      });
      const json = await res.json();
      if (json.success) {
        setApplyResults(json.data.results as ApplyResult[]);
        setSelectedIds(new Set()); // clear selection after apply
      } else {
        setError(json.error ?? t("creative.audience.applyFailed"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("creative.audience.connectionError"));
    } finally {
      setApplying(false);
    }
  };

  const toggleInterest = (metaId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(metaId)) next.delete(metaId);
      else next.add(metaId);
      return next;
    });
  };


  // Xếp theo nhóm để đọc vẫn có mạch, nhưng trả về MỘT danh sách phẳng để lưới
  // 3 cột lấp đầy từng hàng.
  const CATEGORY_ORDER = ["Nghề nghiệp", "Công nghệ", "Hành vi", "Meta Suggestion"];
  const sortedSuggestions = [...(result?.interestSuggestions ?? [])].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a.category);
    const ib = CATEGORY_ORDER.indexOf(b.category);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const resolvableItems = result?.interestSuggestions.filter(i => i.resolved && i.metaId) ?? [];
  const aiCount = result?.interestSuggestions.filter(i => i.source === "ai").length ?? 0;
  const metaCount = result?.interestSuggestions.filter(i => i.source === "meta").length ?? 0;
  const resolvedCount = resolvableItems.length;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
          <div className="rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 p-2.5 shadow-lg shadow-blue-200">
            <Users className="h-5 w-5 text-white" />
          </div>
          {t("creative.audience.title")}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t("creative.audience.subtitle")}
        </p>
      </div>

      {/* Step 1 + 2: Campaign & Segment */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">{t("creative.audience.step1")}</p>
          <div className="relative">
            <button
              onClick={() => { setShowDropdown(!showDropdown); loadCampaigns(); }}
              className="w-full flex items-center justify-between rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-700 hover:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200 transition"
            >
              <span className={selectedCampaign ? "text-slate-800 font-medium" : "text-slate-400"}>
                {selectedCampaign ? selectedCampaign.name : t("creative.audience.pickCampaign")}
              </span>
              {loadingCampaigns
                ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                : <ChevronDown className="h-4 w-4 text-slate-400" />
              }
            </button>

            {showDropdown && campaigns.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-56 overflow-y-auto">
                {campaigns.map(c => (
                  <button
                    key={c.id}
                    onClick={() => { setSelectedCampaign(c); setShowDropdown(false); setResult(null); setApplyResults(null); }}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 text-sm hover:bg-amber-50 transition-colors text-left"
                  >
                    <span className="text-slate-800 font-medium truncate">{c.name}</span>
                    <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      c.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}>{c.status}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            {t("creative.audience.step2")} <span className="normal-case font-normal">{t("creative.audience.optional")}</span>
          </p>
          <div className="space-y-2">
            <input
              type="text"
              value={topSegment}
              onChange={e => setTopSegment(e.target.value)}
              placeholder={t("creative.audience.segmentPlaceholder")}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
            />
            <input
              type="text"
              value={topSegmentReason}
              onChange={e => setTopSegmentReason(e.target.value)}
              placeholder={t("creative.audience.reasonPlaceholder")}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
            />
          </div>
        </div>

        <button
          onClick={analyze}
          disabled={!selectedCampaign || analyzing}
          className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-amber-950 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {analyzing ? t("creative.audience.analyzing") : t("creative.audience.analyzeBtn")}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Apply feedback */}
      {applyResults && (
        <ApplyToast results={applyResults} onClose={() => setApplyResults(null)} />
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Targeting summary */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
              {t("creative.audience.currentTargeting", { n: result.adsets.length, m: result.targeting.activeCount })}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <div>
                <p className="text-xs text-slate-400 mb-1">{t("creative.audience.age")}</p>
                <p className="text-sm font-medium text-slate-700">{result.targeting.ageRanges.join(", ") || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">{t("creative.audience.gender")}</p>
                <p className="text-sm font-medium text-slate-700">{result.targeting.genders.join(", ") || t("creative.audience.all")}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">{t("creative.audience.location")}</p>
                <p className="text-sm font-medium text-slate-700">{result.targeting.locations.countries.join(", ") || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">{t("creative.audience.placements")}</p>
                <p className="text-sm font-medium text-slate-700">{result.targeting.placements.platforms.join(", ") || "—"}</p>
              </div>
            </div>

            {result.targeting.interests.length > 0 && (
              <div>
                <p className="text-xs text-slate-400 mb-2">{t("creative.audience.existingInterests", { n: result.targeting.interests.length })}</p>
                <div className="flex flex-wrap gap-1.5">
                  {result.targeting.interests.map(i => (
                    <span key={i.id} className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 font-medium">
                      {i.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {result.targeting.isBroadTargeting && (
              <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                <strong>{t("creative.audience.broadStrong")}</strong> {t("creative.audience.broadRest")}
              </div>
            )}
          </div>

          {/* Interest suggestions */}
          {result.interestSuggestions.length > 0 && (
            <div>
              {/* Header + Apply bar */}
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-sm font-semibold text-slate-700">
                    {t("creative.audience.suggestTitle")}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {/* Nói rõ mỗi nguồn bao nhiêu mục. Trước đây cả khối đều
                        mang tiêu đề "từ AI" trong khi phần lớn là danh sách
                        chung của Meta — không có cách nào nhìn ra. */}
                    {aiCount > 0 && t("creative.audience.fromAi", { n: aiCount })}
                    {aiCount > 0 && metaCount > 0 && " · "}
                    {metaCount > 0 && t("creative.audience.fromMeta", { n: metaCount })}
                    {(aiCount > 0 || metaCount > 0) && " — "}
                    {t("creative.audience.validIds", { n: resolvedCount, total: result.interestSuggestions.length })}
                    {resolvedCount > 0 && ` — ${t("creative.audience.tickHint")}`}
                    {/* Nói ra số bị loại: im lặng bỏ thì người dùng tưởng AI
                        chỉ nghĩ được bấy nhiêu, còn hiện thẻ không áp dụng được
                        thì tốn chỗ. Nói số là đủ. */}
                    {!!result.aiDropped && result.aiDropped > 0 &&
                      ` · ${t("creative.audience.dropped", { n: result.aiDropped })}`}
                  </p>
                </div>

                {selectedIds.size > 0 && (
                  <div className="shrink-0 flex items-center gap-2">
                    {/* Xem trước đứng TRƯỚC và nhạt màu hơn: đây là nút an toàn,
                        nút xanh bên cạnh mới là nút đụng tài khoản thật. */}
                    <button
                      onClick={() => applyInterests(true)}
                      disabled={applying}
                      className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                      title={t("creative.audience.previewTitle")}
                    >
                      {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                      {t("creative.audience.previewBtn")}
                    </button>
                    <button
                      onClick={() => applyInterests(false)}
                      disabled={applying}
                      className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
                    >
                      {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                      {applying
                        ? t("creative.audience.applying")
                        : t("creative.audience.applyN", { n: selectedIds.size })
                      }
                    </button>
                  </div>
                )}
              </div>

              {/* Select all / clear */}
              {resolvedCount > 0 && (
                <div className="flex gap-3 mb-4">
                  <button
                    onClick={() => setSelectedIds(new Set(resolvableItems.map(i => i.metaId!)))}
                    className="text-xs text-amber-700 hover:underline"
                  >
                    {t("creative.audience.selectAll", { n: resolvedCount })}
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      onClick={() => setSelectedIds(new Set())}
                      className="text-xs text-slate-400 hover:text-slate-600 hover:underline"
                    >
                      {t("creative.audience.clearSel")}
                    </button>
                  )}
                </div>
              )}

              {/* Một lưới 3 cột cho TẤT CẢ thẻ.
                  Trước đây mỗi nhóm (Nghề nghiệp / Công nghệ / Hành vi) là một
                  lưới riêng; 6 thẻ chia 3 nhóm thành ra mỗi hàng chỉ 2 thẻ và
                  cột thứ ba luôn trống — nhìn như bảng 2 cột. Gộp lại thì hàng
                  nào cũng đầy 3, mà vẫn biết loại nào vì mỗi thẻ đã đeo sẵn
                  nhãn nhóm. Thứ tự vẫn gom theo nhóm cho dễ đọc. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {sortedSuggestions.map((item, idx) => (
                  <InterestCard
                    key={`${item.metaId ?? item.name}-${idx}`}
                    item={item}
                    selected={!!item.metaId && selectedIds.has(item.metaId)}
                    onToggle={() => item.metaId && toggleInterest(item.metaId)}
                  />
                ))}
              </div>

              {/* Note about what happens when applied */}
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-xs font-semibold text-blue-800 mb-1.5">{t("creative.audience.noteTitle")}</p>
                <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
                  <li>{t("creative.audience.note1a")} <code className="bg-blue-100 px-1 rounded">flexible_spec[0]</code> {t("creative.audience.note1b")}</li>
                  <li>{t("creative.audience.note2a")} <strong>{t("creative.audience.previewBtn")}</strong> {t("creative.audience.note2b")}</li>
                  <li>{t("creative.audience.note3")}</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
