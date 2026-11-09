"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import { defaultPixelId, pagePixelMap, pageIdsByCompany, pixelOptions } from "@/lib/meta-accounts";
import { isHiddenPage } from "@/lib/hidden-pages";
import {
  Sparkles, Copy, Heart, RefreshCw, Trash2,
  ChevronDown, ChevronUp, Loader2, CheckCircle,
  ArrowRight, ArrowLeft, Check, Download, ClipboardList,
  Target, Users, Zap, Clock, DollarSign, BarChart3,
  Globe, Cloud, Briefcase, Bot, Edit3,
  Shield, FileText, GraduationCap, Mail, Eye,
  BookOpen, Link2, Library, Rocket, Settings, FolderTree,
  Calendar, Building2, Package,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import Link from "next/link";
import { scoreCreative, SCORE_DIMENSIONS, getScoreColor, getGradeEmoji, type CreativeScore } from "@/lib/creative-scorer";
import { runPreflightMeta, type PreflightResult } from "@/lib/launch-preflight";
import { PreflightPanel } from "@/components/creative/PreflightPanel";
import { useAdsStore } from "@/store/useAdsStore";
import { useSession } from "@/components/SessionProvider";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { AdCreative, Platform } from "@/types/ads.types";
import { downloadBriefAsMarkdown, buildEmailLink, type BriefData } from "@/lib/export-brief";
import { useCreativeAIDraft } from "@/lib/creative-ai-draft";
import type { DraftMeta } from "@/lib/creative-ai-draft";
import { type CreativeResult, type PagePost, type LaunchConfig, type LaunchSegment, generateCampaignName, fmtVND as fmtVNDPipeline, parseAgeRange, FB_OBJECTIVES, OBJECTIVE_MAP, CTA_OPTIONS } from "@/lib/creative-pipeline";
import GoogleCreativePanel from "@/components/GoogleCreativePanel";
import FBAdPreview from "@/components/FBAdPreview";
import ConversionEventPicker, { type ConversionEventSelection } from "@/components/creative/ConversionEventPicker";
import PlaybookSuggestPanel, { type PlaybookLaunchState } from "@/components/playbook/PlaybookSuggestPanel";
import { labelForStandardEvent, normalizeStandardEvent } from "@/lib/meta-pixel-events";

// ─────────────────────────────────────────────
// Imports from extracted modules
// ─────────────────────────────────────────────

import {
  ALL_PRODUCTS_LIST,
  OBJECTIVES,
  PLATFORMS,
  TONES,
  MAX_TONES,
  STORAGE_KEY,
  PRODUCT_PREFILLS,
  fbObjectiveOptions,
  legacyProducts,
  companyActiveClass,
  CUSTOM_PRODUCT_OPTION,
} from "./_constants";
import type { AudienceInsightData, AudienceSegment, MetaAudience, BrandData } from "./_types";
import type { WinningAudience } from "@/lib/meta/winning-audiences";
import { fmtVND, formatReach, customProductName } from "./_utils";
import { DraftNameEditor } from "./components/DraftNameEditor";
import { DraftPicker } from "./components/DraftPicker";
import { StepIndicator } from "./components/StepIndicator";
import { ScoreBadge, CreativePlatformBadge } from "./components/ScoreBadge";
import { CreativeCard } from "./components/CreativeCard";
import { companyIds, companyLabel, companyDef, fallbackCompany, isCompany, orderedCompanyIds } from "@/lib/companies/registry";


// ─────────────────────────────────────────────

function CreativeAIPageInner() {
  const t = useT();
  const intlLocale = useIntlLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Wizard step
  const [step, setStep] = useState(1);
  const [fatigueRef, setFatigueRef] = useState<string | null>(null);

  // Step 1 state
  const [selectedProduct, setSelectedProduct] = useState("");
  const [customProduct, setCustomProduct] = useState("");
  const [objective, setObjective] = useState("OUTCOME_SALES");
  const [objectiveKey, setObjectiveKey] = useState("OUTCOME_SALES");
  // Mục tiêu chuyển đổi giờ có 3 dạng (sự kiện tiêu chuẩn / chuyển đổi tùy
  // chỉnh / sự kiện tùy chỉnh trên Pixel) nên không còn nhét vừa một chuỗi.
  // Bản nháp cũ chỉ lưu chuỗi pixelEvent — chỗ khôi phục nháp bên dưới tự
  // chuyển đổi sang dạng mới.
  //
  // null = NGƯỜI DÙNG CHƯA CHỌN, khác hẳn "đã chọn Lượt mua". Phân biệt hai
  // trạng thái này là bắt buộc: nếu để mặc định cứng là PURCHASE thì chiến
  // dịch Khách hàng tiềm năng sẽ bị gửi lên Meta với sự kiện Lượt mua — trước
  // bản này giao diện không gửi gì cho LEADS nên backend tự điền LEAD, và một
  // mặc định cứng ở đây sẽ âm thầm phá đúng chỗ đó.
  const [conversionEvent, setConversionEvent] = useState<ConversionEventSelection | null>(null);
  const [platform, setPlatform] = useState("facebook");
  const [usp, setUsp] = useState("");
  const [socialProof, setSocialProof] = useState("");
  // Mặc định MBC nếu bản cài có MBC; không thì công ty đầu tiên của bản cài (khách không có MBC).
  const [company, setCompany] = useState<string>(() => (companyIds().includes("MBC") ? "MBC" : fallbackCompany()));
  // Hồ sơ thương hiệu theo công ty (GET /api/creative/brand) — cache theo công ty.
  const [brandByCompany, setBrandByCompany] = useState<Record<string, BrandData>>({});
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);
  const brand: BrandData | null = brandByCompany[company] ?? null;
  // legacy = backend nói vậy (data.legacy). Chưa tải xong → tạm coi công ty có hằng số riêng là legacy để vẽ y như cũ.
  const isLegacy = brand ? brand.legacy : legacyProducts(company).length > 0;
  const brandProducts = isLegacy ? [] : (brand?.products ?? []);
  /** Nhãn sản phẩm: bảng cố định (legacy) → sản phẩm trong hồ sơ → `custom_<tên>` → id. */
  const productLabel = useCallback((id: string): string =>
    ALL_PRODUCTS_LIST.find(p => p.id === id)?.label
    ?? brand?.products.find(p => p.id === id)?.label
    ?? customProductName(id), [brand]);
  /** Công ty ngoài bản Mắt Bão: gửi thêm `company` để backend nạp đúng hồ sơ. Legacy: không thêm gì. */
  const companyBody = useMemo(() => (isLegacy ? {} : { company }), [isLegacy, company]);
  // Ô chọn sản phẩm: legacy = bảng cố định; ngoài bản Mắt Bão = sản phẩm trong hồ sơ + ô "Tuỳ chỉnh".
  const pickerProducts: Array<{ id: string; label: string; icon: typeof Globe; badge: string | null; url?: string }> = isLegacy
    ? legacyProducts(company)
    : [...brandProducts.map(bp => ({ id: bp.id, label: bp.label, icon: Package, badge: null, url: bp.url })), CUSTOM_PRODUCT_OPTION];
  // Tracks which product triggered smart pre-fill (null = no pre-fill applied)
  const [prefillSource, setPrefillSource] = useState<string | null>(null);

  // Step 2 state
  const [audienceData, setAudienceData] = useState<AudienceInsightData | null>(null);
  /** A1 — truy vết căn cứ: mỗi khẳng định của AI được dán nhãn truy về đâu.
   *  null = server chưa trả (bản cũ) hoặc chưa phân tích lần nào. */
  const [grounding, setGrounding] = useState<{
    kbAvailable: boolean;
    globalWarnings: string[];
    hasWarnings: boolean;
    segments: Array<{
      segmentName: string;
      kbGroundedCount: number;
      warnings: string[];
      evidence: Array<{ claim: string; sourceType: string; matchedSource: string }>;
    }>;
  } | null>(null);
  const [groundingError, setGroundingError] = useState<string | null>(null);
  /** Góc nhìn phân khúc mà backend bốc ngẫu nhiên cho mẻ này. Hiện ra để kết quả
   *  giải thích được — bốc trúng "vùng địa lý" thì ra toàn phân khúc theo tỉnh. */
  const [lens, setLens] = useState<string | null>(null);
  const [postsError, setPostsError] = useState<string | null>(null);
  /** A3 — hiệu quả đã đo được của từng sở thích, tra theo id. Chỉ ĐỌC bản đã
   *  lưu; mở màn hình không gọi Meta. Rỗng = chưa từng dựng báo cáo. */
  const [interestPerf, setInterestPerf] = useState<Map<string, { spend: number; conversions: number; cpl: number | null; adSetCount: number; coOccurringWith?: number }>>(new Map());
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [audienceError, setAudienceError] = useState<string | null>(null);
  const [selectedSegments, setSelectedSegments] = useState<number[]>([]);
  const [expandedSampleAds, setExpandedSampleAds] = useState<Set<number>>(new Set());
  const [savedSegmentIds, setSavedSegmentIds] = useState<Set<number>>(new Set());
  const [savingSegment, setSavingSegment] = useState<number | null>(null);
  // Step 2 — Meta saved audiences source
  const [step2Tab, setStep2Tab] = useState<"ai" | "meta">("ai");
  const [metaAudienceList, setMetaAudienceList] = useState<MetaAudience[]>([]);
  const [metaAudienceLoading, setMetaAudienceLoading] = useState(false);
  const [metaAudienceError, setMetaAudienceError] = useState<string | null>(null);
  const [selectedMetaAudienceIds, setSelectedMetaAudienceIds] = useState<Set<string>>(new Set());
  // Đợt 26c — "Tệp thắng đã lưu" từ trang So sánh tệp đối tượng: chọn thì tạo Ad Set bằng ĐÚNG cấu hình nhắm chọn đã lưu.
  const [winningList, setWinningList] = useState<WinningAudience[]>([]);
  const [winningLoaded, setWinningLoaded] = useState(false);
  const [selectedWinningIds, setSelectedWinningIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    setWinningList([]); setWinningLoaded(false); setSelectedWinningIds(new Set());
  }, [company]);
  useEffect(() => {
    if (step2Tab !== "meta" || winningLoaded) return;
    let alive = true;
    fetch(`/api/meta/winning-audiences?company=${encodeURIComponent(company)}`)
      .then(r => r.json())
      .then(j => { if (alive) { setWinningList(Array.isArray(j?.rows) ? j.rows : []); setWinningLoaded(true); } })
      .catch(() => { if (alive) { setWinningList([]); setWinningLoaded(true); } });
    return () => { alive = false; };
  }, [step2Tab, winningLoaded, company]);
  // Tệp LOẠI TRỪ — vd tệp khách đã mua, để chiến dịch chỉ đuổi theo khách mới.
  // Tách hẳn khỏi selectedMetaAudienceIds (tệp để NHẮM): một tệp có thể vừa
  // không được nhắm vừa phải bị loại trừ, và gộp hai việc vào một danh sách
  // là cách chắc chắn để có ngày loại trừ nhầm tệp đang muốn nhắm.
  const [excludeAudienceIds, setExcludeAudienceIds] = useState<Set<string>>(new Set());

  // Step 3 state
  const [selectedTones, setSelectedTones] = useState<string[]>(["professional"]);
  const [offer, setOffer] = useState("");

  // Step 1 — Customer & Competitor intelligence
  const [currentCustomerDesc, setCurrentCustomerDesc] = useState("");
  const [currentCustomerPainPoints, setCurrentCustomerPainPoints] = useState("");
  const [currentCustomerMotivation, setCurrentCustomerMotivation] = useState("");
  const [currentCustomerLanguage, setCurrentCustomerLanguage] = useState("Thân thiện, dùng từ đơn giản");
  const [competitorNames, setCompetitorNames] = useState("");
  const [competitorDifferentiate, setCompetitorDifferentiate] = useState("");
  const [funnelStages, setFunnelStages] = useState<Array<"TOFU" | "MOFU" | "BOFU">>(["TOFU"]);
  const [includeInstagram, setIncludeInstagram] = useState(false);
  const [useAdvantageAudience, setUseAdvantageAudience] = useState(false);
  const [autoUTM, setAutoUTM] = useState(true);
  const [showLaunchPreview, setShowLaunchPreview] = useState(false);
  const [bidStrategy, setBidStrategy] = useState<"LOWEST_COST_WITHOUT_CAP" | "COST_CAP" | "BID_CAP">("LOWEST_COST_WITHOUT_CAP");
  const [bidAmount, setBidAmount] = useState<number>(50000);
  const [enableDCO, setEnableDCO] = useState(false);
  const [abTestMode, setAbTestMode] = useState(false);
  // abTestVariants[creativeIndex] = "A" | "B" — which variant this creative belongs to
  const [abTestVariants, setAbTestVariants] = useState<Record<number, "A" | "B">>({});
  const [reachEstimates, setReachEstimates] = useState<Map<number, { lower: number | null; upper: number | null }>>(new Map());
  const [googleCampaignType, setGoogleCampaignType] = useState<"SEARCH" | "PMAX" | "BOTH">("SEARCH");
  const [googleSeedKeywords, setGoogleSeedKeywords] = useState("");
  const [googleNegativeKws, setGoogleNegativeKws] = useState("");
  const [googleMatchType, setGoogleMatchType] = useState<"EXACT" | "PHRASE" | "BROAD">("PHRASE");
  const [googleAudienceSignals, setGoogleAudienceSignals] = useState("");
  const [totalDays, setTotalDays] = useState(30);
  const [adSetCount, setAdSetCount] = useState(1);
  const [showCompetitors, setShowCompetitors] = useState(false);
  const [showPromptPreview, setShowPromptPreview] = useState(false);

  const [count, setCount] = useState(5);
  const [creativeTab, setCreativeTab] = useState<"generate" | "existing" | "google">("generate");
  /** Người dùng đã tự bấm đổi tab chưa. Có rồi thì đừng tự nhảy tab dưới chân họ. */
  const [creativeTabTouched, setCreativeTabTouched] = useState(false);
  /** Tab ĐANG hiển thị ở Bước 3.
   *
   *  Trước đây luôn mở "Tạo nội dung mới" (đường Facebook) kể cả khi người dùng
   *  đã chọn Nền tảng = Google ở Bước 1 — nên toàn bộ phần Google Ads, gồm cả nút
   *  "Kiểm trước (không tạo gì)", nằm sau một cái tab không ai biết phải bấm.
   *
   *  SUY RA thay vì đặt state trong lúc render: đặt state lúc render là nguồn của
   *  vòng render lặp, mà ở đây chỉ cần một phép chọn thuần. */
  /* Nền tảng là RÀNG BUỘC CỨNG, không chỉ là giá trị mặc định.
   *
   * Bản trước chỉ dùng platform để CHỌN SẴN tab khi người dùng chưa đụng vào
   * (`creativeTabTouched`). Từ lúc thanh tab được ẩn theo nền tảng, cách đó
   * sinh ra một màn hình cụt: bấm tab "Tạo nội dung mới" (đánh dấu là đã
   * đụng), quay lại Bước 1 đổi sang Google, sang Bước 3 thì tab vẫn giữ
   * "generate" — hiện đúng giao diện Meta, mà thanh tab thì đã ẩn nên không
   * còn đường bấm ra. Ép về đúng nhánh của nền tảng trước, lựa chọn của
   * người dùng chỉ có hiệu lực TRONG những nhánh hợp lệ. */
  const activeCreativeTab: "generate" | "existing" | "google" =
    platform === "google" ? "google"
      : platform === "facebook" ? (creativeTabTouched && creativeTab !== "google" ? creativeTab : "generate")
      : creativeTabTouched ? creativeTab : "generate";

  // Existing post tab state
  const [pagePosts, setPagePosts] = useState<PagePost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [selectedPosts, setSelectedPosts] = useState<PagePost[]>([]);
  const [existingPostCta, setExistingPostCta] = useState("LEARN_MORE");
  const [searchPostText, setSearchPostText] = useState("");
  const [filterMediaOnly, setFilterMediaOnly] = useState(false);
  const [dayRange, setDayRange] = useState(30);

  // BUG 2 FIX: resolved interests per segment index
  // Map<segmentIndex, Array<{originalName, id, name}>>
  const [resolvedInterestsMap, setResolvedInterestsMap] = useState<
    Map<number, Array<{ originalName: string; id: string; name: string; ambiguous?: boolean }>>
  >(new Map());
  // Editable copy of resolvedInterestsMap (user can add/remove chips in Step 4)
  const [editedInterestsMap, setEditedInterestsMap] = useState<
    Map<number, Array<{ originalName: string; id: string; name: string; ambiguous?: boolean }>>
  >(new Map());
  // Interest names Meta's own adinterestvalid flagged as invalid — shown
  // as a warning in Step 4 so the user knows BEFORE launch that these
  // won't be sent (previously they were silently kept and only failed at
  // ad set creation, triggering a silent downgrade to Advantage+ Audience).
  const [invalidInterestsMap, setInvalidInterestsMap] = useState<Map<number, string[]>>(new Map());
  // Editable demographics (age, location) per segment in Step 4
  const [editedDemographicsMap, setEditedDemographicsMap] = useState<
    Map<number, { ageMin: number; ageMax: number; locations: string[] }>
  >(new Map());
  const [editingDemographicsFor, setEditingDemographicsFor] = useState<number | null>(null);
  const [draftAgeMin, setDraftAgeMin] = useState(18);
  const [draftAgeMax, setDraftAgeMax] = useState(65);
  const [draftLocations, setDraftLocations] = useState<string[]>([]);
  const [resolvingInterests, setResolvingInterests] = useState(false);
  const [addingInterestIdx, setAddingInterestIdx] = useState<number | null>(null);
  const [newInterestInput, setNewInterestInput] = useState<Record<number, string>>({});
  const [interestSuggestions, setInterestSuggestions] = useState<Array<{ id: string; name: string; path?: string[] }>>([]);
  const [showSuggestionsFor, setShowSuggestionsFor] = useState<number | null>(null);
  const interestSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Đợt 7b — trạng thái panel "Từ Sổ kinh nghiệm" cần khi build LaunchConfig
  // (chỉ đọc lúc bấm launch nên dùng ref, không cần re-render theo nó).
  const playbookStateRef = useRef<PlaybookLaunchState>({ keptEntryIds: [], excludePlacements: [], overriddenAvoidIds: [] });

  // Results — now with segment/tone metadata
  const [creatives, setCreatives] = useState<AdCreative[]>([]);
  const [creativeResults, setCreativeResults] = useState<CreativeResult[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [creativeFilterSegment, setCreativeFilterSegment] = useState<string>("all");
  const [improvingIndex, setImprovingIndex] = useState<number | null>(null);
  const [previewOpenIndex, setPreviewOpenIndex] = useState<number | null>(null);

  // Step 4 state
  const [campaignName, setCampaignName] = useState("");

  // ── Pre-fill from URL params (fatigue badge) ──
  useEffect(() => {
    const ref = searchParams.get('ref');
    const paramCompany = searchParams.get('company') as string | null;
    const paramProduct = searchParams.get('product');
    const paramObjective = searchParams.get('objective');

    if (ref === 'fatigue') {
      setFatigueRef(paramProduct || 'campaign');
    }
    if (isCompany(paramCompany)) {
      setCompany(paramCompany);
    }
    if (paramProduct) {
      setCustomProduct(paramProduct);
      setSelectedProduct('custom');
    }
    if (paramObjective && ['OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_TRAFFIC'].includes(paramObjective)) {
      setObjective(paramObjective);
      setObjectiveKey(paramObjective);
    }

    // ── Clone mode: pre-fill name + jump to Step 4 ──
    const cloneName = searchParams.get('cloneName');
    const cloneObj  = searchParams.get('cloneObj');
    if (cloneName) {
      setCampaignName(`[Clone] ${cloneName}`);
      setStep(4);
    }
    if (cloneObj && ['OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_TRAFFIC'].includes(cloneObj)) {
      setObjective(cloneObj);
      setObjectiveKey(cloneObj);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist wizard state in sessionStorage ──
  const SESSION_KEY = "adscommand_creative_wizard";

  // Restore on mount: check for pending drafts, then init draft
  useEffect(() => {
    async function load() {
      // Hand-off from Creative Brief Builder — sessionStorage already has the
      // generated creatives; skip the pending-drafts picker so it doesn't get
      // silently discarded behind the "resume draft?" modal.
      const fromBrief = new URLSearchParams(window.location.search).has('fromBrief');

      // Check for pending drafts first
      if (!fromBrief) {
        try {
          const res = await fetch(`/api/creative-ai/drafts?company=${company}`);
          if (res.ok) {
            const data = await res.json() as { drafts: DraftMeta[] };
            if (data.drafts?.length > 0) {
              setPendingDrafts(data.drafts);
              setShowDraftPicker(true);
              return; // Don't init draft yet — wait for user to choose
            }
          }
        } catch { /* ignore */ }
      }

      // No pending drafts — init new draft + restore sessionStorage
      await initDraft();
      try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return;
        const state = JSON.parse(raw) as Record<string, unknown>;
        const isCloneMode = new URLSearchParams(window.location.search).has('cloneName');
        // Don't restore step 4 — after a launch, always start fresh from step 1
        if (state.step && (state.step as number) > 1 && (state.step as number) < 4 && !isCloneMode) setStep(state.step as number);
        if ((state.creativeResults as unknown[])?.length) setCreativeResults(state.creativeResults as typeof creativeResults);
        if ((state.creatives as unknown[])?.length) setCreatives(state.creatives as typeof creatives);
        if (state.audienceData) setAudienceData(state.audienceData as typeof audienceData);
        if (state.selectedProduct) setSelectedProduct(state.selectedProduct as string);
        if (state.customProduct) setCustomProduct(state.customProduct as string);
        if (state.objective) { setObjective(state.objective as string); setObjectiveKey(state.objective as string); }
        if (state.platform) setPlatform(state.platform as string);
        if (state.company) setCompany(state.company as string);
      } catch { /* ignore */ }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save on change (sessionStorage + auto-save draft)
  useEffect(() => {
    if (step < 2) return;
    try {
      const state = {
        step,
        creativeResults,
        creatives,
        audienceData,
        selectedProduct,
        customProduct,
        objective,
        platform,
        company,
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch { /* ignore if storage full */ }
  }, [step, creativeResults, creatives, audienceData, selectedProduct, customProduct, objective, platform, company]);

  const [budgetType, setBudgetType] = useState<"cbo" | "adset">("cbo");
  const [dailyBudget, setDailyBudget] = useState(500000);
  const [adsetBudget, setAdsetBudget] = useState(200000);
  const [continuous, setContinuous] = useState(true);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("https://www.matbao.net");
  // Công ty ngoài bản Mắt Bão: bỏ URL mặc định của Mắt Bão, dùng tên miền trong hồ sơ.
  useEffect(() => {
    if (!brand || brand.legacy) return;
    setDestinationUrl(cur => (cur === "https://www.matbao.net" ? (brand.domain ? `https://${brand.domain}` : "") : cur));
  }, [brand]);
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchLog, setLaunchLog] = useState<string[]>([]);
  const [launchSuccess, setLaunchSuccess] = useState<{ campaignId: string; adSetCount: number; adCount: number; launchActive: boolean } | null>(null);
  // Segments whose targeting had to fall back to Advantage+ Audience
  // (interests/age dropped) because Meta rejected the original config —
  // shown as a warning on the success screen instead of silently hiding it.
  const [targetingDowngrades, setTargetingDowngrades] = useState<Array<{
    segmentName: string; adSetId: string; originalTargeting: Record<string, unknown>; reason: string;
  }>>([]);
  const [retryingAdSet, setRetryingAdSet] = useState<string | null>(null);
  const [retryResults, setRetryResults] = useState<Map<string, "ok" | "failed">>(new Map());

  const retryOriginalTargeting = async (d: { adSetId: string; originalTargeting: Record<string, unknown> }) => {
    setRetryingAdSet(d.adSetId);
    try {
      const res = await fetch("/api/creative/retry-targeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adSetId: d.adSetId, targeting: d.originalTargeting, company }),
      });
      const json = await res.json();
      setRetryResults(prev => new Map(prev).set(d.adSetId, json.success ? "ok" : "failed"));
    } catch {
      setRetryResults(prev => new Map(prev).set(d.adSetId, "failed"));
    } finally {
      setRetryingAdSet(null);
    }
  };
  const [fbPages, setFbPages] = useState<Array<{ id: string; name: string; pictureUrl?: string | null }>>([]);
  const [selectedPageId, setSelectedPageId] = useState("");
  const [optimizationGoal, setOptimizationGoal] = useState("LEAD_GENERATION");
  const [fbPixels, setFbPixels] = useState<Array<{ id: string; name: string; lastFired?: string | null }>>([]);
  const [selectedPixelId, setSelectedPixelId] = useState("");
  // Pixel THẬT SỰ sẽ được gửi lên Meta. Biểu thức này trước đây bị chép lại ở
  // 3 chỗ (ô chọn Pixel + 2 payload khởi chạy); gom lại một mối để sửa một
  // nơi là cả ba nơi cùng đổi, và để bộ chọn sự kiện nạp đúng Pixel đó.
  const effectivePixelId =
    selectedPixelId || defaultPixelId(company);

  // Mặc định theo mục tiêu, khớp đúng mặc định mà backend vẫn dùng
  // (app/api/creative/launch-campaign/route.ts) để hai bên không nói hai kiểu.
  const defaultConversionEnum = objectiveKey === "OUTCOME_LEADS" ? "LEAD" : "PURCHASE";
  const effectiveConversionEvent: ConversionEventSelection = conversionEvent ?? {
    pixelEvent: defaultConversionEnum,
    label: labelForStandardEvent(defaultConversionEnum),
    key: `standard:${defaultConversionEnum}`,
  };

  // Ba trường mô tả mục tiêu chuyển đổi gửi kèm khi khởi chạy. Chỉ có nghĩa
  // với mục tiêu chạy OFFSITE_CONVERSIONS — SALES *và* LEADS, chứ không chỉ
  // SALES như trước: chiến dịch LEADS cũng bắt buộc có promoted_object, và
  // trước đây nó luôn phải dùng sự kiện mặc định do backend tự đoán vì giao
  // diện chưa bao giờ gửi lựa chọn của người dùng lên.
  // Danh sách tệp loại trừ, dạng mảng — gắn vào MỌI segment khi khởi chạy.
  const excludeAudienceIdList = Array.from(excludeAudienceIds);

  const conversionPayload =
    objectiveKey === "OUTCOME_SALES" || objectiveKey === "OUTCOME_LEADS"
      ? {
          pixelEvent: effectiveConversionEvent.pixelEvent,
          customConversionId: effectiveConversionEvent.customConversionId,
          pixelCustomEventName: effectiveConversionEvent.pixelCustomEventName,
        }
      : {};

  // Auto-select correct pixel when Fanpage changes
  // Đọc từ biến môi trường — xem lib/meta-accounts.ts.
  const PAGE_PIXEL_MAP: Record<string, string> = pagePixelMap();

  // Targeting
  const [targetingType, setTargetingType] = useState<"standard" | "lookalike">("standard");
  const [audiences, setAudiences] = useState<Array<{ id: string; fb_audience_id: string; name: string; type: string; size: number; company: string }>>([]);
  const [selectedAudienceId, setSelectedAudienceId] = useState("");

  // Token check
  const [tokenStatus, setTokenStatus] = useState<{ valid: boolean; expiresIn: number; warning: boolean } | null>(null);

  // ── Draft / Auto-save ──
  const {
    draftName, draftReady, saveStatus,
    initDraft, adoptDraft, startNewDraft, autoSave, renameDraft, markLaunched,
  } = useCreativeAIDraft(company);
  const [showDraftPicker, setShowDraftPicker] = useState(false);
  const [pendingDrafts, setPendingDrafts] = useState<DraftMeta[]>([]);

  const { user } = useSession();
  const isSuperAdmin = user?.role === "super_admin";

  // adSetCount = max(budget-implied suggestion, number of funnel stages
  // selected) — recomputed fresh from CURRENT budget + stage count, not
  // ratcheted off the previous value. The old version only ever
  // Math.max'd against `prev`, so removing a funnel stage (or lowering
  // budget) could never bring the count back down — confirmed live: a
  // user who briefly had 3 stages selected at a higher budget, then
  // dropped to 2 stages at ₫150,000, still saw "Nên tạo 3 Ad Set" and
  // Step 2 kept generating for the stale higher count.
  useEffect(() => {
    const byBudget = dailyBudget >= 1_000_000 ? 3 : dailyBudget >= 500_000 ? 2 : 1;
    setAdSetCount(Math.max(byBudget, funnelStages.length));
  }, [funnelStages, dailyBudget]);

  // Auto-select pixel when Fanpage changes
  useEffect(() => {
    if (selectedPageId && PAGE_PIXEL_MAP[selectedPageId]) {
      setSelectedPixelId(PAGE_PIXEL_MAP[selectedPageId]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPageId]);

  // Auto-save step 1 data
  useEffect(() => {
    if (!draftReady || !selectedProduct) return;
    autoSave(1, "step1Data", {
      selectedProduct, customProduct, objective, objectiveKey, platform, company,
      usp, socialProof, offer,
      currentCustomerDesc, currentCustomerPainPoints, currentCustomerMotivation, currentCustomerLanguage,
      competitorNames, competitorDifferentiate,
      funnelStages, totalDays, adSetCount,
      googleCampaignType, googleSeedKeywords, googleNegativeKws, googleMatchType, googleAudienceSignals,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct, customProduct, objective, objectiveKey, platform, company, usp, socialProof, offer,
      currentCustomerDesc, currentCustomerPainPoints, currentCustomerMotivation, currentCustomerLanguage,
      competitorNames, competitorDifferentiate, funnelStages, totalDays, adSetCount,
      googleCampaignType, googleSeedKeywords, googleNegativeKws, googleMatchType, googleAudienceSignals, draftReady]);

  // Auto-save step 2 data (audience insights + selected segments)
  useEffect(() => {
    if (!draftReady || !audienceData) return;
    autoSave(2, "step2Data", { audienceData, selectedSegments });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceData, selectedSegments, draftReady]);

  // Auto-save step 3 data (generated creatives)
  useEffect(() => {
    if (!draftReady || creativeResults.length === 0) return;
    autoSave(3, "step3Data", { creativeResults, selectedTones, creativeTab });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creativeResults, selectedTones, draftReady]);

  // Auto-save step 4 data (launch config)
  useEffect(() => {
    if (!draftReady || !campaignName) return;
    autoSave(4, "step4Data", {
      campaignName, budgetType, dailyBudget, adsetBudget, continuous,
      startDate, endDate, destinationUrl, selectedPageId, selectedPixelId,
      // pixelEvent giữ nguyên tên khoá cũ để bản nháp lưu bằng phiên bản này
      // vẫn mở được ở phiên bản trước; conversionEvent mới mang đủ 3 dạng.
      pixelEvent: conversionEvent?.pixelEvent, conversionEvent, objectiveKey,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignName, budgetType, dailyBudget, adsetBudget, continuous, startDate, endDate, destinationUrl, selectedPageId, selectedPixelId, conversionEvent, draftReady]);

  // Fetch FB pages + pixels when entering Step 4
  useEffect(() => {
    if (step === 4 && fbPages.length === 0) {
      fetch("/api/creative/get-pages")
        .then(r => r.json())
        .then(data => {
          if (data.pages?.length > 0) {
            setFbPages(data.pages);
            setSelectedPageId(data.pages[0].id);
          }
        })
        .catch(err => console.error("Failed to fetch FB pages:", err));

      // Fetch pixels
      fetch("/api/creative/get-pixels")
        .then(r => r.json())
        .then(data => {
          if (data.pixels?.length > 0) {
            setFbPixels(data.pixels);
            setSelectedPixelId(data.pixels[0].id);
          }
        })
        .catch(err => console.error("Failed to fetch FB pixels:", err));

      // Fetch audiences for Lookalike targeting
      fetch(`/api/audiences/list?company=${company}`)
        .then(r => r.json())
        .then(data => {
          if (data.audiences?.length > 0) {
            setAudiences(data.audiences);
          }
        })
        .catch(err => console.error("Failed to fetch audiences:", err));

      // Check FB token validity
      fetch('/api/meta/check-token')
        .then(r => r.json())
        .then(data => setTokenStatus({
          valid: data.valid ?? false,
          expiresIn: data.expiresIn ?? 0,
          warning: data.warning ?? false,
        }))
        .catch(() => setTokenStatus({ valid: false, expiresIn: 0, warning: false }));
    }

    // BUG 2 FIX: pre-resolve interests for selected segments when entering Step 4
    // Nạp hiệu quả sở thích một lần khi tới bước Launch — GET thuần đọc file,
    // không gọi Meta. Hỏng thì im lặng bỏ qua: đây là thông tin BỔ SUNG, không
    // được phép chặn luồng launch.
    if (step === 4 && interestPerf.size === 0) {
      fetch("/api/audience/interest-performance")
        .then(r => r.json())
        .then((d: { report?: { interests?: Array<{ interestId: string; spend: number; conversions: number; cpl: number | null; adSetCount: number; coOccurringWith?: number }> } }) => {
          const m = new Map<string, { spend: number; conversions: number; cpl: number | null; adSetCount: number; coOccurringWith?: number }>();
          for (const i of d.report?.interests ?? []) {
            m.set(i.interestId, { spend: i.spend, conversions: i.conversions, cpl: i.cpl, adSetCount: i.adSetCount, coOccurringWith: i.coOccurringWith });
          }
          if (m.size > 0) setInterestPerf(m);
        })
        .catch(() => { /* thông tin bổ sung — không chặn gì */ });
    }

    if (step === 4 && audienceData && selectedSegments.length > 0 && resolvedInterestsMap.size === 0) {
      const segmentsWithInterests = audienceData.audienceSegments
        .map((seg, i) => ({ seg, i }))
        .filter(({ i }) => selectedSegments.includes(i))
        .filter(({ seg }) => {
          const interests = seg.facebookTargeting?.interests ?? seg.psychographics?.interests ?? [];
          return interests.length > 0;
        });

      if (segmentsWithInterests.length > 0) {
        setResolvingInterests(true);
        Promise.all(
          segmentsWithInterests.map(({ seg, i }) => {
            const interests = seg.facebookTargeting?.interests ?? seg.psychographics?.interests ?? [];
            return fetch("/api/creative/resolve-interests", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ interests }),
            })
              .then(r => r.json())
              .then((data: { resolved?: Array<{ originalName: string; id: string; name: string; ambiguous?: boolean }>; invalid?: string[] }) => ({ i, resolved: data.resolved ?? [], invalid: data.invalid ?? [] }))
              .catch(() => ({ i, resolved: [] as Array<{ originalName: string; id: string; name: string; ambiguous?: boolean }>, invalid: [] as string[] }));
          })
        ).then(async results => {
          const newMap = new Map<number, Array<{ originalName: string; id: string; name: string }>>();
          const newInvalidMap = new Map<number, string[]>();
          results.forEach(({ i, resolved, invalid }) => { newMap.set(i, resolved); if (invalid.length > 0) newInvalidMap.set(i, invalid); });
          setResolvedInterestsMap(newMap);
          setInvalidInterestsMap(newInvalidMap);
          // Seed editedInterestsMap from resolved (user can then edit)
          setEditedInterestsMap(new Map(newMap));
          setResolvingInterests(false);
          // Fetch reach estimates per segment
          const estimatesMap = new Map<number, { lower: number | null; upper: number | null }>();
          await Promise.allSettled(
            results.map(async ({ i, resolved }) => {
              const targeting = {
                geo_locations: { countries: ["VN"] },
                age_min: 18, age_max: 65,
                ...(resolved.length > 0 ? { flexible_spec: [{ interests: resolved.map(r => ({ id: r.id, name: r.name })) }] } : {}),
              };
              try {
                const er = await fetch(`/api/creative/estimate-reach?targeting=${encodeURIComponent(JSON.stringify(targeting))}`);
                const ed = await er.json() as { users_lower_bound?: number | null; users_upper_bound?: number | null };
                estimatesMap.set(i, { lower: ed.users_lower_bound ?? null, upper: ed.users_upper_bound ?? null });
              } catch { estimatesMap.set(i, { lower: null, upper: null }); }
            })
          );
          setReachEstimates(estimatesMap);
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, fbPages.length]);

  // Saved
  const [saved, setSaved] = useState<AdCreative[]>([]);
  const [showSaved, setShowSaved] = useState(false);

  // Load saved from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSaved(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  function persistSaved(items: AdCreative[]) {
    setSaved(items);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  // ── Hồ sơ thương hiệu: tải mỗi khi đổi công ty (cache theo công ty) ──
  useEffect(() => {
    if (brandByCompany[company]) { setBrandError(null); return; }
    let cancelled = false;
    setBrandLoading(true);
    setBrandError(null);
    (async () => {
      try {
        const res = await fetch(`/api/creative/brand?company=${encodeURIComponent(company)}`);
        const json = await res.json() as { success?: boolean; data?: BrandData; error?: string };
        if (cancelled) return;
        if (!res.ok || !json.success || !json.data) throw new Error(json.error || `HTTP ${res.status}`);
        const data = json.data;
        setBrandByCompany(prev => ({ ...prev, [company]: data }));
      } catch (e) {
        if (!cancelled) setBrandError(e instanceof Error ? e.message : t("creative.main.err.brandLoad"));
      } finally {
        if (!cancelled) setBrandLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  // ── Step 2: Auto-fetch audience insight ──
  const fetchAudienceInsight = useCallback(async () => {
    let productId: string | null = selectedProduct;
    if (selectedProduct === "custom") {
      productId = customProduct.trim() ? `custom_${customProduct.trim()}` : null;
    }
    if (!productId) {
      setAudienceData(null);
      return;
    }

    setAudienceLoading(true);
    setAudienceError(null);
    setAudienceData(null);
    setSelectedSegments([]);
    setGrounding(null);
    setGroundingError(null);
    setLens(null);

    try {
      const res = await fetch("/api/ai/audience-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          ...companyBody,
          // Nền tảng quyết định Bước 2 sinh bộ nhắm mục tiêu NÀO. Chọn Google mà
          // vẫn sinh interests/behaviors của Meta là vừa vô dụng vừa dạy sai.
          platform,
          campaignObjective: OBJECTIVES.find(o => o.value === objective)?.label ?? objective,
          funnelStage: funnelStages.join("+"),
          adSetCount,
          currentCustomer: currentCustomerDesc ? {
            description: currentCustomerDesc,
            painPoints: currentCustomerPainPoints,
            motivation: currentCustomerMotivation,
            language: currentCustomerLanguage,
          } : undefined,
          competitors: competitorNames ? {
            names: competitorNames,
            differentiate: competitorDifferentiate,
          } : undefined,
          budget: {
            dailyBudget,
            totalDays,
            adSetCount,
          },
          google: (platform === "google" || platform === "both") ? {
            campaignType: googleCampaignType,
            seedKeywords: googleSeedKeywords,
            negativeKws: googleNegativeKws,
            matchType: googleMatchType,
            audienceSignals: googleAudienceSignals,
          } : undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? t("creative.main.err.analyzeAudience"));
      setAudienceData(json.data);
      // A1: báo cáo truy vết căn cứ — dán nhãn từng khẳng định của AI là truy
      // được về kiến thức sản phẩm, về input người dùng, hay chỉ là suy luận.
      setGrounding(json.grounding ?? null);
      setLens(json.lens ?? null);
      // Chấm căn cứ hỏng thì nói ra, không để trống — trống đọc thành "không có
      // cảnh báo nào", một câu hoàn toàn khác.
      setGroundingError(json.groundingError ?? null);
      // Auto-select first segment
      if (json.data?.audienceSegments?.length > 0) {
        setSelectedSegments([0]);
      }
    } catch (err: unknown) {
      setAudienceError(err instanceof Error ? err.message : t("creative.main.err.unknown"));
    } finally {
      setAudienceLoading(false);
    }
  }, [
    companyBody,
    selectedProduct, customProduct, objective,
    funnelStages, adSetCount, dailyBudget, totalDays,
    currentCustomerDesc, currentCustomerPainPoints, currentCustomerMotivation, currentCustomerLanguage,
    competitorNames, competitorDifferentiate,
    platform, googleCampaignType, googleSeedKeywords, googleNegativeKws, googleMatchType, googleAudienceSignals, t,
  ]);

  const fetchMetaAudiences = useCallback(async () => {
    setMetaAudienceLoading(true);
    setMetaAudienceError(null);
    try {
      const res = await fetch("/api/audiences/list");
      const json = await res.json();
      if (json.success) setMetaAudienceList(json.data ?? []);
      else setMetaAudienceError(json.error ?? t("creative.main.err.audienceListLoad"));
    } catch {
      setMetaAudienceError(t("creative.main.err.connection"));
    } finally {
      setMetaAudienceLoading(false);
    }
  }, [t]);

  // Trigger when entering step 2 — now that fetchAudienceInsight's own
  // deps are complete (see above), this correctly re-fetches whenever the
  // user goes back to Step 1, changes budget/funnel-stage/etc., and
  // returns to Step 2, instead of silently reusing a stale first-render
  // snapshot (adSetCount=1, funnelStages=["TOFU"]) for the rest of the
  // session regardless of what was actually configured.
  useEffect(() => {
    if (step === 2 && selectedProduct) {
      fetchAudienceInsight();
    }
  }, [step, selectedProduct, fetchAudienceInsight]);

  // ── Step 3: Generate Creatives (multi-tone × multi-segment) ──
  const totalSegmentCount = selectedSegments.length + selectedMetaAudienceIds.size + selectedWinningIds.size;
  const totalCreativeCount = totalSegmentCount * selectedTones.length * (platform === "both" ? 2 : 1);

  const generate = useCallback(async () => {
    setIsGenerating(true);
    setGenerateError(null);
    setCreatives([]);
    setCreativeResults([]);

    const productName = selectedProduct === "custom"
      ? customProduct
      : productLabel(selectedProduct);

    const aiSegments = audienceData?.audienceSegments
      .filter((_, i) => selectedSegments.includes(i)) ?? [];
    const metaSegmentsForGenerate: AudienceSegment[] = metaAudienceList
      .filter(a => selectedMetaAudienceIds.has(a.id))
      .map(a => ({
        segmentName: a.name,
        size: a.size > 0 ? `${Math.round(a.size / 1000)}K–${Math.round(a.sizeMax / 1000)}K` : "N/A",
        priority: 2,
        funnelStage: "MOFU" as const,
        demographics: { age: "18-65", gender: "Tất cả", location: ["Toàn quốc"], income: "" },
        psychographics: { interests: [], behaviors: [], jobTitles: [] },
        facebookTargeting: { interests: [], behaviors: [], jobTitles: [], excludeAudiences: [] },
        painPoints: [],
        estimatedCTR: "", // tệp có sẵn/tệp thắng — không có dự đoán CTR (trước 07/10 gõ cứng "1.5-2.5%")
      }));
    const winningSegmentsForGenerate: AudienceSegment[] = winningList
      .filter(w => selectedWinningIds.has(w.id))
      .map(w => {
        const t = w.targeting as { age_min?: number; age_max?: number; genders?: number[] };
        const g = t.genders ?? [];
        return {
          segmentName: w.name,
          size: "N/A",
          priority: 1,
          funnelStage: "MOFU" as const,
          demographics: { age: `${t.age_min ?? 18}-${t.age_max ?? 65}`, gender: g.length === 1 ? (g[0] === 1 ? "Nam" : "Nữ") : "Tất cả", location: ["Toàn quốc"], income: "" },
          psychographics: { interests: [], behaviors: [], jobTitles: [] },
          facebookTargeting: { interests: [], behaviors: [], jobTitles: [], excludeAudiences: [] },
          painPoints: [],
          estimatedCTR: "", // tệp có sẵn/tệp thắng — không có dự đoán CTR (trước 07/10 gõ cứng "1.5-2.5%")
        };
      });
    const segments = [...aiSegments, ...metaSegmentsForGenerate, ...winningSegmentsForGenerate];

    const platformsToGenerate = platform === "both" ? ["facebook", "google"] : [platform];

    // Helper: single API call with retry
    async function generateOne(
      seg: typeof segments[0],
      toneId: string,
      plat: string,
      retries = 2
    ): Promise<CreativeResult | null> {
      const interests = seg.facebookTargeting?.interests ?? seg.psychographics?.interests ?? [];
      const segDesc = `${seg.segmentName}: ${seg.demographics.age}, ${seg.demographics.gender}, interests: ${interests.join(", ")}`;
      const tone = TONES.find(t => t.id === toneId);

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await fetch("/api/creative/generate-text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              product: productName,
              segment: segDesc,
              segmentName: seg.segmentName,
              funnelStage: seg.funnelStage ?? "TOFU",
              tone: toneId,
              toneLabel: tone?.label ?? toneId,
              usp,
              socialProof,
              offer,
              platform: plat,
              objective: OBJECTIVES.find(o => o.value === objective)?.label ?? objective,
              ...companyBody,
            }),
          });

          // Handle rate limiting specifically
          if (res.status === 429) {
            console.warn(`[Generate] Rate limited (attempt ${attempt + 1}), waiting 15s...`);
            await new Promise(r => setTimeout(r, 15000));
            continue;
          }

          const json = await res.json();
          if (json.success && json.data) {
            return { ...json.data, selected: true } as CreativeResult;
          }
          console.warn(`[Generate] Failed (attempt ${attempt + 1}):`, json.error);
          if (attempt === retries && json.error) {
             setGenerateError(t("creative.main.gen.errorAt", { name: seg.segmentName, error: json.error }));
          }
        } catch (err) {
          console.warn(`[Generate] Error (attempt ${attempt + 1}):`, err);
        }
        // Wait before retry
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 5000));
        }
      }
      return null;
    }

    try {
      // Build job list: segment × tone × platform
      const jobList: Array<{ seg: typeof segments[0]; toneId: string; plat: string }> = [];
      for (const seg of segments) {
        for (const toneId of selectedTones) {
          for (const plat of platformsToGenerate) {
            jobList.push({ seg, toneId, plat });
          }
        }
      }

      // Process sequentially with small delay between calls
      // — prevents Gemini rate limiting that causes silent failures
      const allResults: CreativeResult[] = [];
      let failCount = 0;

      for (let i = 0; i < jobList.length; i++) {
        const { seg, toneId, plat } = jobList[i];

        // Delay between calls: 3s (Gemini rate limit is generous enough)
        if (i > 0) {
          await new Promise(r => setTimeout(r, 3000));
        }

        setGenerationProgress(t("creative.main.gen.progress", { done: i + 1, total: jobList.length, name: seg.segmentName }));
        const result = await generateOne(seg, toneId, plat);
        if (result) {
          allResults.push(result);

          // Progressive UI update — show each creative as it completes
          setCreativeResults([...allResults]);
          setCreatives(allResults.map(r => ({
            id: r.id,
            platform: r.platform as Platform,
            format: r.platform === "facebook" ? "feed" : "search",
            headline: r.headline,
            primaryText: r.primaryText,
            description: r.description,
            cta: r.cta,
            score: r.score,
            reason: r.reason,
          })));
        } else {
          failCount++;
        }
      }

      if (allResults.length === 0) {
        setGenerateError(t("creative.main.gen.none"));
      } else if (failCount > 0) {
        setGenerateError(t("creative.main.gen.partial", { ok: allResults.length, total: jobList.length, failed: failCount }));
      }
    } catch (err: unknown) {
      setGenerateError(err instanceof Error ? err.message : t("creative.main.err.unknown"));
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
    }
    // metaAudienceList + selectedMetaAudienceIds phải có mặt: hàm này đọc cả
    // hai ở trên (lọc tệp đối tượng Meta đã tích) và thiếu chúng trong danh
    // sách phụ thuộc thì nó giữ bản CŨ — tệp Meta vừa chọn bị bỏ im lặng,
    // creative vẫn sinh ra bình thường nên không có gì báo. Cùng loại với lỗi
    // stale closure vừa làm Preflight báo thiếu logo dù logo đã tải lên.
  }, [audienceData, selectedSegments, selectedProduct, customProduct, platform, objective, offer, selectedTones, usp, socialProof, metaAudienceList, selectedMetaAudienceIds, winningList, selectedWinningIds, companyBody, productLabel, t]);

  // ── Toggle creative selection for Step 4 ──
  function toggleCreativeSelection(index: number) {
    setCreativeResults(prev => prev.map((c, i) => i === index ? { ...c, selected: !c.selected } : c));
  }

  const selectedCreativeCount = creativeResults.filter(c => c.selected).length;

  // ── Regenerate single ──
  async function regenerateOne(index: number) {
    const cr = creativeResults[index];
    if (!cr) return;
    setIsGenerating(true);
    try {
      const productName = selectedProduct === "custom"
        ? customProduct
        : productLabel(selectedProduct);
      const res = await fetch("/api/creative/generate-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: productName,
          segment: cr.segmentName,
          segmentName: cr.segmentName,
          funnelStage: cr.funnelStage,
          tone: cr.tone,
          toneLabel: cr.toneLabel,
          usp, socialProof, offer,
          platform: cr.platform,
          objective: OBJECTIVES.find(o => o.value === objective)?.label ?? objective,
          ...companyBody,
        }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        const newCr = { ...json.data, selected: cr.selected } as CreativeResult;
        setCreativeResults(prev => { const copy = [...prev]; copy[index] = newCr; return copy; });
        // Update legacy array too
        setCreatives(prev => {
          const copy = [...prev];
          copy[index] = {
            id: newCr.id, platform: newCr.platform as Platform, format: newCr.platform === "facebook" ? "feed" : "search",
            headline: newCr.headline, primaryText: newCr.primaryText, description: newCr.description, cta: newCr.cta,
            score: newCr.score, reason: newCr.reason,
          };
          return copy;
        });
      }
    } catch { /* ignore */ }
    finally { setIsGenerating(false); }
  }

  // ── AI Auto-Improve Creative ──
  async function improveCreative(index: number, scores: Record<string, number>, suggestions: string[]) {
    const cr = creativeResults[index];
    if (!cr || improvingIndex !== null) return;
    setImprovingIndex(index);
    try {
      const productName = selectedProduct === "custom"
        ? customProduct
        : productLabel(selectedProduct);
      const res = await fetch("/api/creative/improve-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline: cr.headline,
          primaryText: cr.primaryText,
          description: cr.description,
          cta: cr.cta,
          platform: cr.platform,
          scores,
          suggestions,
          product: productName,
          segmentName: cr.segmentName,
          funnelStage: cr.funnelStage,
          tone: cr.tone,
          toneLabel: cr.toneLabel,
          usp, socialProof, offer,
          ...companyBody,
        }),
      });
      const json = await res.json();
      console.log("[improveCreative] API response:", json);
      if (json.success && json.data) {
        setCreativeResults(prev => prev.map((c, idx) =>
          idx === index ? { ...c, ...json.data } as CreativeResult : c
        ));
        setCreatives(prev => prev.map((c, idx) =>
          idx === index ? { ...c, ...json.data } : c
        ));
      } else {
        console.error("[improveCreative] API error:", json.error);
        setGenerateError(t("creative.main.improve.failed", { error: json.error || t("creative.main.err.unknown") }));
      }
    } catch (err) {
      console.error("[improveCreative] Fetch error:", err);
      setGenerateError(t("creative.main.improve.connect"));
    } finally {
      setImprovingIndex(null);
    }
  }

  // ── Copy / Save ──
  function copyCreative(c: AdCreative) {
    const isFb = c.platform === "facebook";
    const text = isFb
      ? `${c.primaryText}\n\nHeadline: ${c.headline}\nDescription: ${c.description}\nCTA: ${c.cta}`
      : `Headline: ${c.headline}\n${c.primaryText ? `Headlines: ${c.primaryText}\n` : ""}Description: ${c.description}`;
    navigator.clipboard.writeText(text);
  }

  function copyAllCreatives() {
    const text = creatives.map((c, i) => {
      const isFb = c.platform === "facebook";
      return `--- Creative ${i + 1} (${c.platform}) ---\n${isFb ? `Primary: ${c.primaryText}\nHeadline: ${c.headline}\nDesc: ${c.description}\nCTA: ${c.cta}` : `Headline: ${c.headline}\nDesc: ${c.description}`}\nScore: ${c.score ?? "N/A"}/10`;
    }).join("\n\n");
    navigator.clipboard.writeText(text);
  }

  function saveCreative(c: AdCreative) {
    if (saved.some(s => s.id === c.id)) return;
    persistSaved([...saved, c]);
  }

  function removeCreative(id: string) {
    persistSaved(saved.filter(s => s.id !== id));
  }

  function toggleSegment(index: number) {
    setSelectedSegments(prev =>
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  }

  const canProceedStep1 = selectedProduct && (selectedProduct !== "custom" || customProduct.trim());

  // Smart pre-fill: when selecting a product, auto-fill empty fields with product-specific defaults
  // Legacy: bảng PRODUCT_PREFILLS như cũ. Ngoài bản Mắt Bão: chỉ lấy từ hồ sơ doanh nghiệp (không bịa gì thêm).
  function prefillFor(productId: string): (typeof PRODUCT_PREFILLS)[string] | null {
    if (isLegacy) return PRODUCT_PREFILLS[productId] ?? null;
    if (!brand || productId === "custom") return null;
    const usp = brand.strengths.join("; ");
    if (!usp && !brand.persona) return null;
    return { usp, socialProof: "", customerDesc: brand.persona, painPoints: "", motivation: "", competitors: "" };
  }

  function applyPrefill(productId: string) {
    const fill = prefillFor(productId);
    if (!fill) return;
    if (!usp.trim())                    setUsp(fill.usp);
    if (!socialProof.trim())            setSocialProof(fill.socialProof);
    if (!currentCustomerDesc.trim())    setCurrentCustomerDesc(fill.customerDesc);
    if (!currentCustomerPainPoints.trim()) setCurrentCustomerPainPoints(fill.painPoints);
    if (!currentCustomerMotivation.trim()) setCurrentCustomerMotivation(fill.motivation);
    if (!competitorNames.trim())        setCompetitorNames(fill.competitors);
    setPrefillSource(productId);
  }

  function clearPrefill() {
    const fill = prefillSource ? prefillFor(prefillSource) : null;
    if (!fill) { setPrefillSource(null); return; }
    if (usp === fill.usp)                           setUsp("");
    if (socialProof === fill.socialProof)           setSocialProof("");
    if (currentCustomerDesc === fill.customerDesc)  setCurrentCustomerDesc("");
    if (currentCustomerPainPoints === fill.painPoints) setCurrentCustomerPainPoints("");
    if (currentCustomerMotivation === fill.motivation) setCurrentCustomerMotivation("");
    if (competitorNames === fill.competitors)       setCompetitorNames("");
    setPrefillSource(null);
  }
  const canProceedStep2 = selectedProduct === "custom" || selectedSegments.length > 0 || selectedMetaAudienceIds.size > 0 || selectedWinningIds.size > 0;

  // ── Save Segment to Library ──
  async function saveSegmentToLibrary(seg: AudienceSegment, index: number) {
    setSavingSegment(index);
    try {
      const productName = selectedProduct === "custom"
        ? customProduct
        : productLabel(selectedProduct);

      const res = await fetch("/api/audience-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...seg,
          company,
          product: productName,
          objective,
        }),
      });
      if (res.ok) {
        setSavedSegmentIds(prev => new Set(prev).add(index));
      }
    } catch { /* ignore */ }
    setSavingSegment(null);
  }

  async function saveAllSegmentsToLibrary() {
    if (!audienceData) return;
    for (let i = 0; i < audienceData.audienceSegments.length; i++) {
      if (!savedSegmentIds.has(i)) {
        await saveSegmentToLibrary(audienceData.audienceSegments[i], i);
      }
    }
  }

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────

  return (
    <div className="space-y-6 pb-10 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-amber-700" />
            Creative AI Studio
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t("creative.main.header.subtitle")}
          </p>
          <Link
            href="/creative/brief"
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
          >
            <FileText className="h-3.5 w-3.5" /> {t("creative.main.header.briefBuilder")}
          </Link>
        </div>
        <div className="flex items-center gap-3">
          {/* Draft name editor */}
          {draftName && (
            <DraftNameEditor name={draftName} onRename={renameDraft} />
          )}
          {/* Save status */}
          <div className="flex items-center gap-1.5 text-xs">
            {saveStatus === "saving" && (
              <span className="text-gray-400 flex items-center gap-1">
                <span className="inline-block animate-spin">⏳</span> {t("creative.main.save.saving")}
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="text-gray-400 flex items-center gap-1">
                <span>✓</span> {t("creative.main.save.saved")}
              </span>
            )}
            {saveStatus === "unsaved" && (
              <span className="text-amber-500 flex items-center gap-1">
                <span>●</span> {t("creative.main.save.unsaved")}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Draft Picker Modal */}
      {showDraftPicker && pendingDrafts.length > 0 && (
        <DraftPicker
          drafts={pendingDrafts}
          onSelect={async (draft) => {
            setShowDraftPicker(false);
            // Set draft id in hook by re-initializing with existing id
            // Restore state from draft
            if (draft.currentStep > 1) setStep(draft.currentStep);
            if (draft.step1Data) {
              try {
                const s1 = JSON.parse(draft.step1Data) as Record<string, unknown>;
                if (s1.selectedProduct) setSelectedProduct(s1.selectedProduct as string);
                if (s1.customProduct) setCustomProduct(s1.customProduct as string);
                if (s1.objective) { setObjective(s1.objective as string); setObjectiveKey((s1.objectiveKey ?? s1.objective) as string); }
                if (s1.platform) setPlatform(s1.platform as string);
                if (s1.company) setCompany(s1.company as string);
                if (s1.usp) setUsp(s1.usp as string);
                if (s1.socialProof) setSocialProof(s1.socialProof as string);
                if (s1.offer) setOffer(s1.offer as string);
                if (s1.currentCustomerDesc) setCurrentCustomerDesc(s1.currentCustomerDesc as string);
                if (s1.currentCustomerPainPoints) setCurrentCustomerPainPoints(s1.currentCustomerPainPoints as string);
                if (s1.currentCustomerMotivation) setCurrentCustomerMotivation(s1.currentCustomerMotivation as string);
                if (s1.currentCustomerLanguage) setCurrentCustomerLanguage(s1.currentCustomerLanguage as string);
                if (s1.competitorNames) setCompetitorNames(s1.competitorNames as string);
                if (s1.competitorDifferentiate) setCompetitorDifferentiate(s1.competitorDifferentiate as string);
                if (s1.funnelStages) setFunnelStages(s1.funnelStages as Array<"TOFU" | "MOFU" | "BOFU">);
                else if (s1.funnelStage) setFunnelStages([s1.funnelStage as "TOFU" | "MOFU" | "BOFU"]);
                if (s1.totalDays) setTotalDays(s1.totalDays as number);
                if (s1.adSetCount) setAdSetCount(s1.adSetCount as number);
                if (s1.googleCampaignType) setGoogleCampaignType(s1.googleCampaignType as "SEARCH" | "PMAX" | "BOTH");
                if (s1.googleSeedKeywords) setGoogleSeedKeywords(s1.googleSeedKeywords as string);
                if (s1.googleNegativeKws) setGoogleNegativeKws(s1.googleNegativeKws as string);
                if (s1.googleMatchType) setGoogleMatchType(s1.googleMatchType as "EXACT" | "PHRASE" | "BROAD");
                if (s1.googleAudienceSignals) setGoogleAudienceSignals(s1.googleAudienceSignals as string);
              } catch { /* ignore */ }
            }
            if (draft.step2Data) {
              try {
                const s2 = JSON.parse(draft.step2Data) as Record<string, unknown>;
                if (s2.audienceData) setAudienceData(s2.audienceData as typeof audienceData);
                if (s2.selectedSegments) setSelectedSegments(s2.selectedSegments as number[]);
              } catch { /* ignore */ }
            }
            if (draft.step3Data) {
              try {
                const s3 = JSON.parse(draft.step3Data) as Record<string, unknown>;
                if (s3.creativeResults) setCreativeResults(s3.creativeResults as typeof creativeResults);
                if (s3.selectedTones) setSelectedTones(s3.selectedTones as string[]);
              } catch { /* ignore */ }
            }
            if (draft.step4Data) {
              try {
                const s4 = JSON.parse(draft.step4Data) as Record<string, unknown>;
                if (s4.campaignName) setCampaignName(s4.campaignName as string);
                if (s4.budgetType) setBudgetType(s4.budgetType as "cbo" | "adset");
                if (s4.dailyBudget) setDailyBudget(s4.dailyBudget as number);
                if (s4.adsetBudget) setAdsetBudget(s4.adsetBudget as number);
                if (s4.continuous !== undefined) setContinuous(s4.continuous as boolean);
                if (s4.startDate) setStartDate(s4.startDate as string);
                if (s4.endDate) setEndDate(s4.endDate as string);
                if (s4.destinationUrl) setDestinationUrl(s4.destinationUrl as string);
                // Nháp mới lưu cả đối tượng; nháp cũ chỉ có chuỗi pixelEvent
                // (có thể là biến thể sai như "VIEW_CONTENT") — dịch về enum
                // đúng thay vì bỏ qua, để mở lại nháp không đổi mục tiêu.
                if (s4.conversionEvent) {
                  setConversionEvent(s4.conversionEvent as ConversionEventSelection);
                } else if (s4.pixelEvent) {
                  const normalized = normalizeStandardEvent(s4.pixelEvent as string) ?? "PURCHASE";
                  setConversionEvent({
                    pixelEvent: normalized,
                    label: labelForStandardEvent(normalized),
                    key: `standard:${normalized}`,
                  });
                }
              } catch { /* ignore */ }
            }
            // Nhận nháp này vào hook (trước đây chỉ ghi sessionStorage → tự lưu sau đó không vào nháp đã chọn).
            adoptDraft(draft);
          }}
          onNew={() => {
            setShowDraftPicker(false);
            startNewDraft();
          }}
        />
      )}

      {/* Step Indicator */}
      <StepIndicator currentStep={step} platform={platform} />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* STEP 1: CHỌN SẢN PHẨM & MỤC TIÊU     */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {step === 1 && (
        <div className="space-y-6">
          {/* Fatigue replacement banner */}
          {fatigueRef && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-center justify-between">
              <p className="text-sm text-amber-800 font-medium">
                {t("creative.main.fatigue.before")}<strong>{fatigueRef}</strong>{t("creative.main.fatigue.after")}
              </p>
              <button onClick={() => setFatigueRef(null)} className="text-xs text-amber-500 hover:text-amber-700">✕</button>
            </div>
          )}
          {searchParams.get('clone') && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-center gap-3">
              <span className="text-lg">📋</span>
              <p className="text-sm text-amber-900 font-medium flex-1">
                {t("creative.main.clone.before")}<strong>{searchParams.get('cloneName')}</strong>{t("creative.main.clone.after")}
              </p>
            </div>
          )}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            {/* Company selector — at top so product list updates immediately */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-700">{t("creative.main.step1.pickProduct")}</h3>
              <div className="flex gap-1.5">
                {companyIds().map(c => (
                  <button key={c} onClick={() => {
                    setCompany(c);
                    setSelectedProduct("");
                    setPrefillSource(null);
                    const available = fbObjectiveOptions(c, brandByCompany[c]?.legacy).map(o => o.key);
                    if (!available.includes(objectiveKey)) {
                      setObjectiveKey(available[0]);
                      setObjective(available[0]);
                    }
                  }}
                    className={cn(
                      "rounded-lg border px-4 py-1.5 text-xs font-semibold transition-all",
                      company === c
                        ? `${companyActiveClass(c, companyDef(c)?.color)} shadow-sm`
                        : "border-slate-200 text-slate-500 hover:border-slate-400 bg-white"
                    )}
                  >{c}</button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {pickerProducts.map(p => {
                const Icon = p.icon;
                const isSelected = selectedProduct === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedProduct(p.id);
                      applyPrefill(p.id);
                      if (p.url) setDestinationUrl(p.url);
                    }}
                    className={cn(
                      "relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all hover:shadow-md",
                      isSelected
                        ? "border-amber-500 bg-amber-50/50 shadow-md"
                        : "border-slate-200 hover:border-slate-300 bg-white"
                    )}
                  >
                    {/* Badge */}
                    {p.badge && (
                      <span className="absolute -top-2 -right-1 rounded-full bg-amber-400 px-2 py-0.5 text-[9px] font-bold text-white shadow-sm">
                        {p.badge}
                      </span>
                    )}
                    {/* Checkmark */}
                    {isSelected && (
                      <span className="absolute top-2 right-2">
                        <Check className="h-4 w-4 text-amber-700" />
                      </span>
                    )}
                    {/* Pre-fill dot indicator */}
                    {prefillSource === p.id && !isSelected && (
                      <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-green-400" />
                    )}
                    <Icon className={cn("h-7 w-7", isSelected ? "text-amber-700" : "text-slate-400")} />
                    <span className={cn("text-xs font-semibold", isSelected ? "text-amber-800" : "text-slate-600")}>
                      {p.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Hồ sơ doanh nghiệp: đang tải / lỗi / chưa có sản phẩm (chỉ công ty ngoài bản Mắt Bão) */}
            {brandLoading && !brand && !isLegacy && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("creative.main.step1.brandLoading")}</p>
            )}
            {brandError && !isLegacy && (
              <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{t("creative.main.step1.brandError", { error: brandError })}</p>
            )}
            {!isLegacy && brand && brandProducts.length === 0 && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {t("creative.main.step1.noProducts")}{" "}
                <Link href={`/settings/brand-profile?company=${encodeURIComponent(company)}`} className="font-semibold underline">{t("creative.main.step1.openBrand")}</Link>
              </p>
            )}

            {/* Custom product input */}
            {selectedProduct === "custom" && (
              <div className="mt-4 rounded-xl border-2 border-amber-200 bg-amber-50/40 p-4 space-y-1.5">
                <label className="block text-xs font-semibold text-amber-800 uppercase tracking-wide">
                  {t("creative.main.step1.customName")}<span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  value={customProduct}
                  onChange={e => setCustomProduct(e.target.value)}
                  placeholder={t("creative.main.step1.customPh")}
                  className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                />
                <p className="text-[11px] text-amber-700">{t("creative.main.step1.customHint")}</p>
              </div>
            )}
          </div>

          {/* Platform + Objective */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
            {/* ── Nền tảng — HỎI TRƯỚC TIÊN ──────────────────────────────
                Trước đây ô này nằm CUỐI card, sau cả mục tiêu và sự kiện
                chuyển đổi. Nghĩa là người dùng bị bắt chọn mục tiêu Meta và
                Pixel Meta xong rồi mới được nói "thật ra tôi chạy Google".
                Nền tảng quyết định phần còn lại của cả wizard hiện cái gì,
                nên nó phải là câu hỏi đầu tiên. */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">{t("creative.main.step1.platformQ")} <span className="text-[10px] text-slate-400 font-normal">{t("creative.main.step1.platformHint")}</span></h3>
              <div className="flex gap-2">
                {PLATFORMS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setPlatform(p.value)}
                    className={cn(
                      "rounded-lg border px-5 py-2.5 text-xs font-semibold transition-all",
                      platform === p.value
                        ? p.value === "facebook" ? "border-blue-500 bg-blue-600 text-white" :
                          p.value === "google" ? "border-red-500 bg-red-500 text-white" :
                          "border-blue-500 bg-blue-600 text-white"
                        : "border-slate-200 text-slate-500 hover:border-slate-400 bg-white"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {platform === "google" && (
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                  {t("creative.main.step1.googleFlow1")}<b>{t("creative.main.step1.googleFlowBold")}</b>{t("creative.main.step1.googleFlow2")}
                </p>
              )}
            </div>

            {/* Objective radio cards — filtered by company */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3">{t("creative.main.step1.mainObjective")} <span className="text-[10px] text-slate-400 font-normal">{t("creative.main.step1.pickOne")}</span></h3>
              <div className="space-y-2">
                {fbObjectiveOptions(company, brand?.legacy).map(o => {
                  const Icon = o.icon;
                  const isSelected = objectiveKey === o.key;
                  return (
                    <button
                      key={o.key}
                      onClick={() => { setObjectiveKey(o.key); setObjective(o.key); }}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all",
                        isSelected ? "border-amber-500 bg-amber-50/50 shadow-sm" : "border-slate-200 hover:border-slate-300"
                      )}
                    >
                      <div className={cn("h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0",
                        isSelected ? "border-amber-500" : "border-slate-300"
                      )}>
                        {isSelected && <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />}
                      </div>
                      <Icon className={cn("h-5 w-5 shrink-0", isSelected ? "text-amber-700" : "text-slate-400")} />
                      <div>
                        <p className={cn("text-xs font-bold", isSelected ? "text-amber-800" : "text-slate-700")}>{o.label}</p>
                        <p className="text-[10px] text-slate-400">{o.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sự kiện chuyển đổi — hiện với cả SALES và LEADS, vì cả hai đều
                chạy optimization_goal OFFSITE_CONVERSIONS và đều cần
                promoted_object. Trước đây chỉ hiện cho SALES nên chiến dịch
                LEADS luôn dùng sự kiện mặc định do backend tự chọn. */}
            {/* Sự kiện chuyển đổi gắn cứng vào FACEBOOK PIXEL — ẩn hẳn với
                Google. Trước đây khối này hiện kể cả khi chạy Google, tức là
                bắt người dùng chọn một sự kiện Pixel Meta cho một chiến dịch
                Google không hề dùng Pixel. Google theo dõi chuyển đổi bằng
                thẻ chuyển đổi riêng, đặt trong tài khoản Google Ads. */}
            {platform !== "google" && (objectiveKey === "OUTCOME_SALES" || objectiveKey === "OUTCOME_LEADS") && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">{t("creative.main.step1.conversionEvent")}</h3>
                <ConversionEventPicker
                  pixelId={effectivePixelId}
                  value={effectiveConversionEvent}
                  onChange={setConversionEvent}
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  {t("creative.main.step1.conversionHint", { pixel: effectivePixelId || t("creative.main.step1.notSelected") })}
                </p>
              </div>
            )}
            {platform === "google" && (objectiveKey === "OUTCOME_SALES" || objectiveKey === "OUTCOME_LEADS") && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  📊 <b>{t("creative.main.step1.googleConvBold")}</b>{t("creative.main.step1.googleConv")}
                </p>
              </div>
            )}

            {/* Destination URL — shown for SALES + TRAFFIC, hidden for LEADS */}
            {objectiveKey !== "OUTCOME_LEADS" && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">{t("creative.main.step1.destUrl")}</h3>
                <input
                  type="url"
                  value={destinationUrl}
                  onChange={e => setDestinationUrl(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                  placeholder={isLegacy ? "https://matbao.net/ten-mien-vn" : t("creative.main.step1.destUrlPh")}
                />
              </div>
            )}

            {/* Ô chọn nền tảng ĐÃ CHUYỂN LÊN ĐẦU card này — xem ghi chú ở trên. */}
          </div>

          {/* USP + Social Proof + Offer */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            {/* Pre-fill indicator */}
            {prefillSource && prefillSource !== "custom" && (
              <div className="flex items-center justify-between rounded-lg bg-green-50 border border-green-200 px-3 py-2">
                <p className="text-xs text-green-700 font-medium">
                  {t("creative.main.step1.prefill1")}<strong>{productLabel(prefillSource)}</strong>{t("creative.main.step1.prefill2")}
                </p>
                <button
                  type="button"
                  onClick={clearPrefill}
                  className="text-[11px] text-green-500 hover:text-green-700 ml-3 shrink-0"
                >
                  {t("creative.main.step1.clearAll")}
                </button>
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">{t("creative.main.step1.usp")}</h3>
              <textarea
                rows={2}
                maxLength={200}
                value={usp}
                onChange={e => setUsp(e.target.value)}
                placeholder={t("creative.main.step1.uspPh")}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
              />
              <p className="text-right text-[10px] text-slate-400 mt-0.5">{usp.length}/200</p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">{t("creative.main.step1.socialProof")}</h3>
              <textarea
                rows={2}
                maxLength={150}
                value={socialProof}
                onChange={e => setSocialProof(e.target.value)}
                placeholder={t("creative.main.step1.socialProofPh")}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
              />
              <p className="text-right text-[10px] text-slate-400 mt-0.5">{socialProof.length}/150</p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">{t("creative.main.step1.offer")}</h3>
              <textarea
                rows={2}
                maxLength={150}
                value={offer}
                onChange={e => setOffer(e.target.value)}
                placeholder={t("creative.main.step1.offerPh")}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
              />
              <p className="text-right text-[10px] text-slate-400 mt-0.5">{offer.length}/150</p>
            </div>
          </div>

          {/* ── Section: Khách hàng thực tế ── */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 mb-0.5">
                {t("creative.main.step1.realCustomer")}
              </h3>
              <p className="text-xs text-slate-400 mb-4">{t("creative.main.step1.realCustomerHint")}</p>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-slate-600 mb-1.5">{t("creative.main.step1.custDesc")}</h4>
              <textarea
                rows={3}
                maxLength={300}
                value={currentCustomerDesc}
                onChange={e => setCurrentCustomerDesc(e.target.value)}
                placeholder={t("creative.main.step1.custDescPh")}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
              />
              <p className="text-right text-[10px] text-slate-400 mt-0.5">{currentCustomerDesc.length}/300</p>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-slate-600 mb-1.5">{t("creative.main.step1.pain")}</h4>
              <textarea
                rows={2}
                maxLength={200}
                value={currentCustomerPainPoints}
                onChange={e => setCurrentCustomerPainPoints(e.target.value)}
                placeholder={t("creative.main.step1.painPh")}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
              />
              <p className="text-right text-[10px] text-slate-400 mt-0.5">{currentCustomerPainPoints.length}/200</p>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-slate-600 mb-1.5">{t("creative.main.step1.motivation")}</h4>
              <textarea
                rows={2}
                maxLength={200}
                value={currentCustomerMotivation}
                onChange={e => setCurrentCustomerMotivation(e.target.value)}
                placeholder={t("creative.main.step1.motivationPh")}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
              />
              <p className="text-right text-[10px] text-slate-400 mt-0.5">{currentCustomerMotivation.length}/200</p>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-slate-600 mb-1.5">{t("creative.main.step1.language")}</h4>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {([
                  ["Thân thiện, dùng từ đơn giản", "creative.main.step1.langFriendly"],
                  ["Chuyên nghiệp, B2B", "creative.main.step1.langPro"],
                  ["Khẩn cấp, tạo áp lực", "creative.main.step1.langUrgent"],
                  ["Cảm xúc, kể chuyện", "creative.main.step1.langEmotional"],
                  ["Hài hước, gần gũi", "creative.main.step1.langFunny"],
                  ["Uy tín, authority", "creative.main.step1.langAuthority"],
                ] as const).map(([preset, presetKey]) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setCurrentCustomerLanguage(preset)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-[11px] transition-all",
                      currentCustomerLanguage === preset
                        ? "border-amber-400 bg-amber-50 text-amber-800 font-medium"
                        : "border-slate-200 bg-white text-slate-500 hover:border-amber-300 hover:text-amber-700"
                    )}
                  >
                    {t(presetKey)}
                  </button>
                ))}
              </div>
              <input
                type="text"
                maxLength={100}
                value={currentCustomerLanguage}
                onChange={e => setCurrentCustomerLanguage(e.target.value)}
                placeholder={t("creative.main.step1.langPh")}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>
          </div>

          {/* ── Section: Đối thủ (collapsible) ── */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setShowCompetitors(v => !v)}
              className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">⚔️</span>
                <div className="text-left">
                  <p className="text-sm font-semibold text-slate-700">{t("creative.main.step1.competitors")}</p>
                  <p className="text-xs text-slate-400">{t("creative.main.step1.competitorsHint")}</p>
                </div>
              </div>
              <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", showCompetitors && "rotate-180")} />
            </button>
            {showCompetitors && (
              <div className="px-6 pb-5 space-y-4 border-t border-slate-100">
                <div className="pt-4">
                  <h4 className="text-xs font-semibold text-slate-600 mb-1.5">{t("creative.main.step1.mainCompetitor")}</h4>
                  <input
                    type="text"
                    maxLength={150}
                    value={competitorNames}
                    onChange={e => setCompetitorNames(e.target.value)}
                    placeholder={isLegacy ? t("creative.main.step1.competitorsPhLegacy") : t("creative.main.step1.competitorsPh")}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-600 mb-1.5">{t("creative.main.step1.differentiate")}</h4>
                  <textarea
                    rows={2}
                    maxLength={200}
                    value={competitorDifferentiate}
                    onChange={e => setCompetitorDifferentiate(e.target.value)}
                    placeholder={t("creative.main.step1.differentiatePh")}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Section: Ngân sách, Thời gian & Giai đoạn Funnel ── */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-0.5">{t("creative.main.step1.budgetStrategy")}</h3>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">{t("creative.main.step1.dailyBudget")}</label>
                <input
                  type="number"
                  min={50000}
                  step={50000}
                  value={dailyBudget}
                  onChange={e => {
                    const val = parseInt(e.target.value) || 0;
                    setDailyBudget(val);
                    // adSetCount recomputed by the useEffect above (single
                    // source of truth for budget+funnel-stage → count).
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">{t("creative.main.step1.runDays")}</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={totalDays}
                  onChange={e => setTotalDays(parseInt(e.target.value) || 30)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>
            </div>

            {dailyBudget > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-sm space-y-1">
                <p>
                  {t("creative.main.step1.hintPre")}
                  <strong>{dailyBudget.toLocaleString(intlLocale)}₫</strong>{t("creative.main.step1.hintPerDay")}
                  <strong>{t("creative.main.step1.hintAdSets", { n: adSetCount })}</strong>
                  {adSetCount > 1
                    ? t("creative.main.step1.hintEach", { amount: Math.round(dailyBudget / adSetCount).toLocaleString(intlLocale) })
                    : t("creative.main.step1.hintOne")}
                </p>
                {totalDays > 0 && (
                  <p className="text-slate-500 text-xs">
                    {t("creative.main.step1.totalBudget")}{" "}
                    <strong className="text-slate-700">
                      {(dailyBudget * totalDays).toLocaleString(intlLocale)}₫
                    </strong>
                  </p>
                )}
              </div>
            )}

            {/* Funnel stages — merged into this card */}
            <div className="border-t border-slate-100 pt-4">
              <h4 className="text-xs font-semibold text-slate-700 mb-1">{t("creative.main.step1.stage")}</h4>
              <p className="text-xs text-slate-400 mb-3">{t("creative.main.step1.stageHint")}</p>
              <div className="grid grid-cols-3 gap-3">
                {([
                  { key: "TOFU", label: "TOFU", descKey: "creative.main.step1.tofu", icon: "🌱", border: "border-sky-500", bg: "bg-sky-50", check: "text-sky-700" },
                  { key: "MOFU", label: "MOFU", descKey: "creative.main.step1.mofu", icon: "🔍", border: "border-yellow-500", bg: "bg-yellow-50", check: "text-yellow-600" },
                  { key: "BOFU", label: "BOFU", descKey: "creative.main.step1.bofu", icon: "🎯", border: "border-emerald-500", bg: "bg-emerald-50", check: "text-emerald-600" },
                ] as const).map(stage => {
                  const isSelected = funnelStages.includes(stage.key);
                  return (
                    <button
                      key={stage.key}
                      type="button"
                      onClick={() => {
                        if (isSelected && funnelStages.length === 1) return;
                        setFunnelStages(prev =>
                          isSelected ? prev.filter(s => s !== stage.key) : [...prev, stage.key]
                        );
                      }}
                      className={cn(
                        "rounded-xl border-2 p-4 text-left transition-all relative",
                        isSelected
                          ? `${stage.border} ${stage.bg} shadow-sm`
                          : "border-slate-200 hover:border-slate-300"
                      )}
                    >
                      {isSelected && (
                        <span className={cn("absolute top-2 right-2 text-xs font-bold", stage.check)}>✓</span>
                      )}
                      <p className="text-xl mb-1">{stage.icon}</p>
                      <p className="font-bold text-sm">{stage.label}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{t(stage.descKey)}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Section: Google Ads (conditional) ── */}
          {(platform === "google" || platform === "both") && (
            <div className="rounded-xl border border-amber-100 bg-amber-50/30 p-6 shadow-sm space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 mb-0.5">
                  {t("creative.main.step1.googleSetup")}
                </h3>
                <p className="text-xs text-slate-400 mb-4">{t("creative.main.step1.googleSetupHint")}</p>
              </div>

              {/* Campaign type selector */}
              <div className="flex gap-2">
                {(["SEARCH", "PMAX", "BOTH"] as const).map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setGoogleCampaignType(type)}
                    className={cn(
                      "flex-1 rounded-xl border-2 py-2.5 text-sm transition-all",
                      googleCampaignType === type
                        ? "border-amber-500 bg-amber-50 font-semibold text-amber-800"
                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                    )}
                  >
                    {type === "SEARCH" && "🔎 Search"}
                    {type === "PMAX" && "⚡ Perf Max"}
                    {type === "BOTH" && t("creative.main.step1.both")}
                  </button>
                ))}
              </div>

              {/* Search fields */}
              {(googleCampaignType === "SEARCH" || googleCampaignType === "BOTH") && (
                <>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-600 mb-1.5">{t("creative.main.step1.seedKw")}</h4>
                    <textarea
                      rows={3}
                      value={googleSeedKeywords}
                      onChange={e => setGoogleSeedKeywords(e.target.value)}
                      placeholder={t("creative.main.step1.seedKwPh")}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">{t("creative.main.step1.seedKwHint")}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-600 mb-1.5">{t("creative.main.step1.negKw")}</h4>
                    <input
                      type="text"
                      value={googleNegativeKws}
                      onChange={e => setGoogleNegativeKws(e.target.value)}
                      placeholder={t("creative.main.step1.negKwPh")}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">{t("creative.main.step1.negKwHint")}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-600 mb-2">{t("creative.main.step1.matchDefault")}</h4>
                    <div className="flex gap-2">
                      {([
                        { key: "EXACT", label: "[Exact]", descKey: "creative.main.step1.matchExact" },
                        { key: "PHRASE", label: '"Phrase"', descKey: "creative.main.step1.matchPhrase" },
                        { key: "BROAD", label: "Broad", descKey: "creative.main.step1.matchBroad" },
                      ] as const).map(m => (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => setGoogleMatchType(m.key)}
                          className={cn(
                            "flex-1 rounded-xl border p-3 text-center transition-all",
                            googleMatchType === m.key
                              ? "border-amber-500 bg-amber-50"
                              : "border-slate-200 hover:border-slate-300"
                          )}
                        >
                          <p className="font-mono text-sm font-bold">{m.label}</p>
                          <p className="text-xs text-slate-500 mt-1">{t(m.descKey)}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* PMax fields */}
              {(googleCampaignType === "PMAX" || googleCampaignType === "BOTH") && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-600 mb-1.5">📡 Audience Signals (PMax)</h4>
                  <textarea
                    rows={2}
                    value={googleAudienceSignals}
                    onChange={e => setGoogleAudienceSignals(e.target.value)}
                    placeholder={t("creative.main.step1.signalsPh")}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Debug: Prompt Preview (Super Admin only) ── */}
          {isSuperAdmin && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <button
                type="button"
                onClick={() => setShowPromptPreview(v => !v)}
                className="w-full flex items-center gap-2 px-4 py-3 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <span>🔍</span>
                <span>{showPromptPreview ? t("creative.main.step1.hidePrompt") : t("creative.main.step1.showPrompt")}</span>
                <ChevronDown className={cn("h-3 w-3 ml-auto transition-transform", showPromptPreview && "rotate-180")} />
              </button>
              {showPromptPreview && (
                <pre className="rounded-b-xl bg-gray-900 text-green-400 text-xs p-4 overflow-auto max-h-96 leading-relaxed">
                  {`Sản phẩm: ${selectedProduct === "custom" ? customProduct : selectedProduct}
Công ty: ${company}
Mục tiêu: ${objective}
Giai đoạn: ${funnelStages.join("+")}
Nền tảng: ${platform}
USP: ${usp || "(chưa có)"}
Bằng chứng XH: ${socialProof || "(chưa có)"}
Offer: ${offer || "(chưa có)"}

━━━ KHÁCH HÀNG ━━━
Mô tả: ${currentCustomerDesc || "(chưa có)"}
Nỗi đau: ${currentCustomerPainPoints || "(chưa có)"}
Động lực: ${currentCustomerMotivation || "(chưa có)"}
Ngôn ngữ: ${currentCustomerLanguage}

━━━ ĐỐI THỦ ━━━
Đối thủ: ${competitorNames || "(chưa có)"}
Khác biệt: ${competitorDifferentiate || "(chưa có)"}

━━━ NGÂN SÁCH ━━━
${dailyBudget.toLocaleString(intlLocale)}₫/ngày × ${totalDays} ngày = ${(dailyBudget * totalDays).toLocaleString(intlLocale)}₫
→ ${adSetCount} Ad Set(s)${platform === "google" || platform === "both" ? `

━━━ GOOGLE ADS ━━━
Loại: ${googleCampaignType}
Keywords: ${googleSeedKeywords || "(chưa có)"}
Negative: ${googleNegativeKws || "(chưa có)"}
Match type: ${googleMatchType}
Audience signals: ${googleAudienceSignals || "(chưa có)"}` : ""}`}
                </pre>
              )}
            </div>
          )}

          {/* Next Button */}
          <Button
            onClick={() => setStep(2)}
            disabled={!canProceedStep1}
            className="w-full gap-2 bg-amber-500 py-5 text-sm font-semibold text-amber-950 hover:bg-amber-600 disabled:opacity-40"
          >
            {t("creative.main.step1.next")}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* STEP 2: AUDIENCE INTELLIGENCE           */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {step === 2 && (
        <div className="space-y-6">
          {/* Source Tab Selector */}
          <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit">
            <button
              onClick={() => setStep2Tab("ai")}
              className={cn("px-4 py-1.5 rounded-md text-xs font-semibold transition-all", step2Tab === "ai" ? "bg-white shadow-sm text-amber-700" : "text-slate-500 hover:text-slate-700")}
            >
              {t("creative.main.step2.tabAi")}
            </button>
            <button
              onClick={() => { setStep2Tab("meta"); if (!metaAudienceList.length && !metaAudienceLoading) fetchMetaAudiences(); }}
              className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-all", step2Tab === "meta" ? "bg-white shadow-sm text-amber-700" : "text-slate-500 hover:text-slate-700")}
            >
              {t("creative.main.step2.tabMeta")}
              {selectedMetaAudienceIds.size > 0 && (
                <span className="rounded-full bg-amber-500 text-amber-950 text-[10px] w-4 h-4 flex items-center justify-center">{selectedMetaAudienceIds.size}</span>
              )}
            </button>
          </div>

          {/* Loading State */}
          {step2Tab === "ai" && audienceLoading && (
            <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-16 shadow-sm">
              <div className="relative mb-6">
                <div className="h-16 w-16 rounded-full bg-amber-100 animate-pulse" />
                <Loader2 className="absolute inset-0 m-auto h-8 w-8 text-amber-700 animate-spin" />
              </div>
              <p className="text-sm font-semibold text-slate-700">{t("creative.main.step2.analyzing")}</p>
              <p className="mt-1 text-xs text-slate-400">{t("creative.main.step2.analyzingHint")}</p>
            </div>
          )}

          {/* Error State */}
          {step2Tab === "ai" && audienceError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5">
              <p className="text-sm text-red-600 font-medium">❌ {audienceError}</p>
              <Button size="sm" variant="outline" className="mt-3 text-xs" onClick={fetchAudienceInsight}>
                <RefreshCw className="h-3 w-3 mr-1" /> {t("creative.main.common.retry")}
              </Button>
            </div>
          )}

          {/* Custom product prompt if missing */}
          {step2Tab === "ai" && selectedProduct === "custom" && !customProduct.trim() && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <p className="text-sm text-amber-700 font-medium">
                {t("creative.main.step2.customMissing")}
              </p>
            </div>
          )}

          {/* Meta Saved Audiences Tab */}
          {step2Tab === "meta" && (
            <div className="space-y-4">
              {/* Đợt 26c — Tệp thắng đã lưu (từ trang "So sánh tệp đối tượng") */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-emerald-800">{t("creative.main.step2.winUse")}</p>
                </div>
                {winningLoaded && winningList.length === 0 && (
                  <p className="text-xs text-slate-500">{t("creative.main.step2.winNone")}</p>
                )}
                {winningList.map(w => {
                  const on = selectedWinningIds.has(w.id);
                  return (
                    <button
                      key={w.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setSelectedWinningIds(prev => {
                        const next = new Set(prev);
                        if (next.has(w.id)) next.delete(w.id); else next.add(w.id);
                        return next;
                      })}
                      className={cn(
                        "w-full text-left rounded-lg border-2 bg-white px-3 py-2 transition-all",
                        on ? "border-emerald-500 ring-2 ring-emerald-100" : "border-slate-200 hover:border-slate-300"
                      )}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                        {on ? "✓" : "＋"} {w.name}
                        <span className="rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5">{t("creative.main.step2.winBadge")}</span>
                      </span>
                      <span className="block text-xs text-slate-500 mt-0.5">{w.summary}</span>
                    </button>
                  );
                })}
                {selectedWinningIds.size > 0 && (
                  <p className="text-xs font-medium text-emerald-800">{t("creative.main.step2.winSelected", { n: selectedWinningIds.size })}</p>
                )}
              </div>
              {metaAudienceLoading && (
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-6">
                  <Loader2 className="h-5 w-5 animate-spin text-amber-700" />
                  <span className="text-sm text-slate-600">{t("creative.main.step2.metaLoading")}</span>
                </div>
              )}
              {metaAudienceError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-5">
                  <p className="text-sm text-red-600 font-medium">❌ {metaAudienceError}</p>
                  <Button size="sm" variant="outline" className="mt-3 text-xs" onClick={fetchMetaAudiences}>
                    <RefreshCw className="h-3 w-3 mr-1" /> {t("creative.main.common.retry")}
                  </Button>
                </div>
              )}
              {!metaAudienceLoading && !metaAudienceError && metaAudienceList.length === 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
                  <p className="text-sm text-slate-500">{t("creative.main.step2.metaNone")}</p>
                </div>
              )}
              {metaAudienceList.length > 0 && (
                <>
                  <p className="text-xs text-slate-500">
                    {t("creative.main.step2.metaPick")}
                  </p>
                  <div className="space-y-2">
                    {metaAudienceList.map((aud) => {
                      const isSelected = selectedMetaAudienceIds.has(aud.id);
                      return (
                        <div
                          key={aud.id}
                          onClick={() => setSelectedMetaAudienceIds(prev => {
                            const next = new Set(prev);
                            if (next.has(aud.id)) next.delete(aud.id); else next.add(aud.id);
                            return next;
                          })}
                          className={cn(
                            "flex items-center justify-between px-4 py-3 rounded-xl border-2 bg-white cursor-pointer transition-all hover:shadow-sm",
                            isSelected ? "border-amber-500 ring-2 ring-amber-100" : "border-slate-200 hover:border-slate-300"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <div className={cn("h-5 w-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors", isSelected ? "border-amber-500 bg-amber-500" : "border-slate-300")}>
                              {isSelected && <span className="text-white text-[9px] font-bold">✓</span>}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-800">{aud.name}</p>
                              <p className="text-xs text-slate-400 mt-0.5">
                                {aud.type === "LOOKALIKE" ? "Lookalike" : aud.type === "CUSTOM" ? "Custom" : aud.type}
                                {aud.size > 0 && t("creative.main.step2.audSize", { min: (aud.size / 1000).toFixed(0), max: (aud.sizeMax / 1000).toFixed(0) })}
                                {aud.createdAt && t("creative.main.step2.audCreated", { date: aud.createdAt })}
                              </p>
                            </div>
                          </div>
                          <span className={cn("text-[10px] font-semibold rounded-full px-2 py-0.5 capitalize", aud.status.toLowerCase().includes("ready") ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                            {aud.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {selectedMetaAudienceIds.size > 0 && (
                    <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center justify-between">
                      <span className="text-amber-800 text-sm font-medium">
                        {t("creative.main.step2.metaSelected", { n: selectedMetaAudienceIds.size, ads: selectedMetaAudienceIds.size * selectedTones.length })}
                      </span>
                      <button
                        onClick={() => setSelectedMetaAudienceIds(new Set())}
                        className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {t("creative.main.step2.deselectAll")}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Audience Segments */}
          {step2Tab === "ai" && audienceData && (
            <>
              <h3 className="text-sm font-semibold text-slate-700">
                {t("creative.main.step2.segments", { n: audienceData.audienceSegments.length })}
              </h3>

              {/* A1 — cảnh báo ở mức toàn mẻ: không có kiến thức sản phẩm cho
                  sản phẩm này, hoặc AI đang chép nguyên văn ví dụ trong prompt.
                  Hai chuyện đó làm hỏng cả mẻ, không riêng phân khúc nào. */}
              {groundingError && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-xs text-amber-800">⚠️ {groundingError}</p>
                </div>
              )}

              {grounding && grounding.globalWarnings.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-1">
                  {grounding.globalWarnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-800">⚠️ {w}</p>
                  ))}
                </div>
              )}
              {/* Góc nhìn của mẻ này + chốt "có bỏ quên thị trường lớn không".
                  Góc nhìn được bốc NGẪU NHIÊN mỗi lần bấm (7 góc) để tránh lối
                  mòn. Khi bốc trúng "vùng địa lý", AI chia theo tỉnh và TP.HCM /
                  Hà Nội biến mất — kết quả đúng logic nhưng người đọc không biết
                  vì sao. Nói ra góc nhìn, và nếu CẢ MẺ không phân khúc nào chạm
                  tới hai thị trường lớn nhất thì nhắc — kèm nút thêm 1 chạm. */}
              {lens && (() => {
                const BIG = ["Hồ Chí Minh", "TP.HCM", "HCM", "Hà Nội", "Ha Noi"];
                const covered = audienceData.audienceSegments.some(sg =>
                  (sg.demographics?.location ?? []).some(l =>
                    BIG.some(b => l.toLowerCase().includes(b.toLowerCase())) ||
                    l.toLowerCase().includes("toàn quốc")));
                return (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 space-y-1.5">
                    <p className="text-xs text-slate-600">
                      {t("creative.main.step2.lens")}<b>{lens}</b>
                      <span className="text-slate-400">{t("creative.main.step2.lensHint")}</span>
                    </p>
                    {!covered && (
                      <div className="flex items-start gap-2 flex-wrap">
                        <p className="text-xs text-amber-800 flex-1 min-w-[240px]">
                          {t("creative.main.step2.bigMkt1")}<b>{t("creative.main.step2.hcm")}</b>{t("creative.main.step2.bigMkt2")}<b>{t("creative.main.step2.hanoi")}</b>{t("creative.main.step2.bigMkt3")}
                        </p>
                        <button
                          onClick={() => {
                            setAudienceData(prev => {
                              if (!prev) return prev;
                              const segs = prev.audienceSegments.map((sg, idx) => {
                                if (idx !== 0) return sg;
                                const cur = sg.demographics?.location ?? [];
                                const add = ["Hồ Chí Minh", "Hà Nội"].filter(c => !cur.includes(c));
                                return { ...sg, demographics: { ...sg.demographics, location: [...cur, ...add] } };
                              });
                              return { ...prev, audienceSegments: segs };
                            });
                          }}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-800 hover:bg-amber-50"
                        >
                          {t("creative.main.step2.addBig")}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {grounding && !grounding.kbAvailable && grounding.globalWarnings.length === 0 && (
                <p className="text-xs text-slate-500">
                  {t("creative.main.step2.noKb")}
                </p>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {audienceData.audienceSegments.map((seg, i) => {
                  const isSelected = selectedSegments.includes(i);
                  return (
                    <div
                      key={i}
                      className={cn(
                        "relative rounded-xl border-2 bg-white shadow-sm transition-all cursor-pointer hover:shadow-md",
                        isSelected ? "border-amber-500 ring-2 ring-amber-100" : "border-slate-200"
                      )}
                      onClick={() => toggleSegment(i)}
                    >
                      {/* Selection order number — top left */}
                      {isSelected && (
                        <span className="absolute top-3 left-3 z-10 rounded-full bg-amber-500 text-amber-950 text-[10px] font-bold w-5 h-5 flex items-center justify-center shadow-sm">
                          {selectedSegments.indexOf(i) + 1}
                        </span>
                      )}
                      {/* Segment Header */}
                      <div className="flex items-center justify-between px-5 pt-4 pb-2">
                        <div className="flex items-center gap-2">
                          <Target className="h-4 w-4 text-amber-700" />
                          <span className="text-sm font-bold text-slate-800">{seg.segmentName}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {seg.funnelStage && (
                            <span className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-bold",
                              seg.funnelStage === "TOFU" ? "bg-sky-100 text-sky-700" :
                              seg.funnelStage === "MOFU" ? "bg-amber-100 text-amber-700" :
                              "bg-emerald-100 text-emerald-700"
                            )}>
                              {seg.funnelStage === "TOFU" ? t("creative.main.step2.stageTofu") :
                               seg.funnelStage === "MOFU" ? t("creative.main.step2.stageMofu") :
                               seg.funnelStage === "BOFU" ? t("creative.main.step2.stageBofu") : seg.funnelStage}
                            </span>
                          )}
                          {seg.priority === 1 && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                              {t("creative.main.step2.highPriority")}
                            </span>
                          )}
                          {/* Save to Library */}
                          {savedSegmentIds.has(i) ? (
                            <span className="text-[10px] text-green-600 font-semibold">{t("creative.main.step2.savedBadge")}</span>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                saveSegmentToLibrary(seg, i);
                              }}
                              disabled={savingSegment === i}
                              className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold bg-violet-50 text-violet-600 border border-violet-200 hover:bg-violet-100 transition-colors disabled:opacity-50"
                            >
                              {savingSegment === i ? "⏳" : "🔖"} {t("creative.main.common.save")}
                            </button>
                          )}
                          <div className={cn(
                            "h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors",
                            isSelected ? "border-amber-500 bg-amber-500" : "border-slate-300"
                          )}>
                            {isSelected && <Check className="h-3 w-3 text-white" />}
                          </div>
                        </div>
                      </div>

                      {/* Estimated Audience Size */}
                      {seg.estimatedAudienceSize && (
                        <div className="px-5 py-1">
                          <span className="text-[10px] text-slate-400">{t("creative.main.step2.size")}<b className="text-slate-600">{seg.estimatedAudienceSize}</b></span>
                        </div>
                      )}

                      {/* Demographics */}
                      <div className="px-5 py-2 border-t border-slate-100">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{t("creative.main.step2.demographics")}</p>
                        <div className="grid grid-cols-2 gap-1 text-xs text-slate-600">
                          <span>{t("creative.main.step2.age")}<b>{seg.demographics.age}</b></span>
                          <span>{seg.demographics.gender}</span>
                          <span className="col-span-2">📍 {seg.demographics.location.join(", ")}</span>
                          {/* Thu nhập KHÔNG target được ở Việt Nam — Meta chỉ mở
                              tiêu chí thu nhập cho vài thị trường, VN không có
                              trong đó, và đường launch cũng không hề gửi trường
                              này lên. Trước đây nó hiện chung hàng với Tuổi và
                              Vị trí (hai thứ target được thật) nên đọc như một
                              tiêu chí nhắm mục tiêu. Tách hẳn ra và nói rõ. */}
                          {seg.demographics.income && (
                            <span className="col-span-2 text-slate-400">
                              💰 {seg.demographics.income}
                              <span className="ml-1 text-[10px] italic">{t("creative.main.step2.incomeNote")}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* ── Bộ nhắm mục tiêu GOOGLE ──
                          Google Ads không có interest/behavior như Meta: Search
                          nhắm bằng TỪ KHOÁ, PMax bằng audience signal. Chọn Nền
                          tảng = Google ở Bước 1 thì hiện đúng bộ này, và ẩn hẳn
                          bộ Meta bên dưới. */}
                      {platform !== "facebook" && seg.googleTargeting && (
                        <div className="px-5 py-2 border-t border-slate-100 space-y-2 bg-red-50/30">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-red-700">🔍 Google Ads</p>
                          {(seg.googleTargeting.searchIntents ?? []).length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold text-slate-500 mb-1">{t("creative.main.step2.gKeywords")}</p>
                              <div className="flex flex-wrap gap-1">
                                {(seg.googleTargeting.searchIntents ?? []).map((k, j) => (
                                  <span key={j} className="rounded-full bg-white border border-red-200 px-2 py-0.5 text-[10px] font-medium text-red-700">{k}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {(seg.googleTargeting.negativeKeywords ?? []).length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold text-slate-500 mb-1">{t("creative.main.step2.gNegative")}</p>
                              <div className="flex flex-wrap gap-1">
                                {(seg.googleTargeting.negativeKeywords ?? []).map((k, j) => (
                                  <span key={j} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 line-through">{k}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {(seg.googleTargeting.audienceSignals ?? []).length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold text-slate-500 mb-1">{t("creative.main.step2.gSignals")}</p>
                              <div className="flex flex-wrap gap-1">
                                {(seg.googleTargeting.audienceSignals ?? []).map((k, j) => (
                                  <span key={j} className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700">{k}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Interests — CHỈ Meta */}
                      {platform !== "google" && (
                      <div className="px-5 py-2 border-t border-slate-100">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{t("creative.main.step2.interests")}{platform === "both" && <span className="text-slate-300">(Meta)</span>}</p>
                        <div className="flex flex-wrap gap-1">
                          {(seg.facebookTargeting?.interests ?? seg.psychographics?.interests ?? []).map((interest, j) => (
                            <span key={j} className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                              {interest}
                            </span>
                          ))}
                        </div>
                      </div>
                      )}

                      {/* Behaviors — CHỈ Meta */}
                      {platform !== "google" && (seg.facebookTargeting?.behaviors ?? seg.psychographics?.behaviors ?? []).length > 0 && (
                        <div className="px-5 py-2 border-t border-slate-100">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{t("creative.main.step2.behaviors")}</p>
                          <div className="flex flex-wrap gap-1">
                            {(seg.facebookTargeting?.behaviors ?? seg.psychographics?.behaviors ?? []).map((behavior, j) => (
                              <span key={j} className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-600">
                                {behavior}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Job Titles */}
                      {(seg.facebookTargeting?.jobTitles ?? seg.demographics.jobTitles ?? []).length > 0 && (
                        <div className="px-5 py-2 border-t border-slate-100">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{t("creative.main.step2.jobTitles")}</p>
                          <div className="flex flex-wrap gap-1">
                            {(seg.facebookTargeting?.jobTitles ?? seg.demographics.jobTitles ?? []).map((job, j) => (
                              <span key={j} className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-medium text-cyan-700">
                                {job}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Exclusion Targeting */}
                      {(seg.facebookTargeting?.excludeAudiences ?? []).length > 0 && (
                        <div className="px-5 py-2 border-t border-slate-100">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400 mb-1.5">{t("creative.main.step2.exclusion")}</p>
                          <div className="flex flex-wrap gap-1">
                            {(seg.facebookTargeting?.excludeAudiences ?? []).map((ex, j) => (
                              <span key={j} className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-500 border border-red-100">
                                {ex}
                              </span>
                            ))}
                          </div>
                          {/* Meta bỏ loại trừ theo sở thích/hành vi (v22, mọi phiên bản từ 21/04/2025) — các mục này KHÔNG được gửi khi tạo chiến dịch. */}
                          <p className="mt-1 text-[10px] text-slate-400">{t("creative.main.step2.exclusionNote")}</p>
                        </div>
                      )}

                      {/* Custom Audience Suggestions */}
                      {(seg.customAudienceSuggestions ?? []).length > 0 && (
                        <div className="px-5 py-2 border-t border-slate-100">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-purple-400 mb-1.5">{t("creative.main.step2.customAud")}</p>
                          <ul className="space-y-0.5">
                            {(seg.customAudienceSuggestions ?? []).map((ca, j) => (
                              <li key={j} className="text-xs text-purple-700 bg-purple-50 rounded px-2 py-0.5">• {ca}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Pain Points */}
                      <div className="px-5 py-2 border-t border-slate-100">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{t("creative.main.step2.painPoints")}</p>
                        <ul className="space-y-0.5">
                          {seg.painPoints.slice(0, 3).map((p, j) => (
                            <li key={j} className="text-xs text-slate-600">• {p}</li>
                          ))}
                        </ul>
                      </div>

                      {/* Triggers */}
                      {seg.buyingTriggers && seg.buyingTriggers.length > 0 && (
                      <div className="px-5 py-2 border-t border-slate-100">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{t("creative.main.step2.triggers")}</p>
                        <ul className="space-y-0.5">
                          {seg.buyingTriggers.slice(0, 2).map((t, j) => (
                            <li key={j} className="text-xs text-slate-600">• {t}</li>
                          ))}
                        </ul>
                      </div>
                      )}

                      {/* V2: Trigger Moment */}
                      {seg.triggerMoment && (
                        <div className="px-5 py-2 border-t border-slate-100">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{t("creative.main.step2.triggerMoment")}</p>
                          <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-2.5 py-1.5 italic">
                            &ldquo;{seg.triggerMoment}&rdquo;
                          </p>
                        </div>
                      )}

                      {/* V2: Message Hook */}
                      {seg.messageHook && (
                        <div className="px-5 py-2 border-t border-slate-100">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{t("creative.main.step2.messageHook")}</p>
                          <div className="flex items-start gap-2">
                            <p className="flex-1 text-xs font-semibold text-slate-800 bg-amber-50 rounded-lg px-2.5 py-1.5">
                              {seg.messageHook}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* V2: Why This Segment */}
                      {seg.whyThisSegment && (
                        <div className="px-5 py-2 border-t border-slate-100">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{t("creative.main.step2.why")}</p>
                          <p className="text-xs text-slate-600">{seg.whyThisSegment}</p>
                        </div>
                      )}

                      {/* A1 — Căn cứ đề xuất.
                          Không có khối này thì mọi câu AI viết đều trông ngang
                          nhau: câu trích từ kiến thức sản phẩm thật và câu AI
                          tự nghĩ ra đọc y hệt nhau. Đó đúng là cách "Bất động
                          sản (ngành)" từng lọt qua. */}
                      {(() => {
                        const g = grounding?.segments?.find(x => x.segmentName === seg.segmentName);
                        if (!g) return null;
                        const LABEL: Record<string, { text: string; cls: string }> = {
                          performance_proven:{ text: t("creative.main.step2.evProven"), cls: "bg-indigo-50 text-indigo-700 border-indigo-300 font-bold" },
                          performance_expensive:{ text: t("creative.main.step2.evExpensive"), cls: "bg-orange-50 text-orange-700 border-orange-300 font-bold" },
                          kb_grounded:       { text: t("creative.main.step2.evKb"), cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                          manual_input:      { text: t("creative.main.step2.evManual"),        cls: "bg-blue-50 text-blue-700 border-blue-200" },
                          derived_inference: { text: t("creative.main.step2.evInferred"),          cls: "bg-slate-100 text-slate-600 border-slate-200" },
                          unverified:        { text: t("creative.main.step2.evUnverified"), cls: "bg-red-50 text-red-700 border-red-200" },
                        };
                        return (
                          <div className="px-5 py-2 border-t border-slate-100">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                              {t("creative.main.step2.evidence")}
                              <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">
                                {t("creative.main.step2.evidenceCount", { n: g.kbGroundedCount })}
                              </span>
                            </p>
                            <div className="space-y-1">
                              {g.evidence.slice(0, 9).map((e, ei) => {
                                const l = LABEL[e.sourceType] ?? LABEL.derived_inference;
                                return (
                                  <div key={ei} className="flex items-start gap-1.5">
                                    <span className={cn("shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded border", l.cls)}>
                                      {l.text}
                                    </span>
                                    <span className="text-[11px] text-slate-600 leading-snug">
                                      {e.claim}
                                      {e.matchedSource && (
                                        <span className="text-slate-400">{t("creative.main.step2.evidenceSource", { source: e.matchedSource.slice(0, 90) })}</span>
                                      )}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            {g.warnings.length > 0 && (
                              <ul className="mt-1.5 space-y-0.5">
                                {g.warnings.map((w, wi) => (
                                  <li key={wi} className="text-[11px] text-amber-700">⚠️ {w}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })()}

                      {/* Footer metrics */}
                      <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                        <span>{seg.estimatedCTR ? <>{t("creative.main.step2.estCtr")}<b className="text-slate-700">{seg.estimatedCTR}</b></> : null}</span>
                        <div className="flex items-center gap-1.5">
                          {seg.competitionLevel && (
                            <span className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                              seg.competitionLevel === "low" ? "bg-green-50 text-green-600" :
                              seg.competitionLevel === "high" ? "bg-red-50 text-red-600" :
                              "bg-amber-50 text-amber-600"
                            )}>
                              {seg.competitionLevel === "low" ? t("creative.main.step2.compLow") : seg.competitionLevel === "high" ? t("creative.main.step2.compHigh") : t("creative.main.step2.compMid")}
                            </span>
                          )}
                          {seg.difficulty && (
                          <span className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            seg.difficulty === "Dễ" ? "bg-green-50 text-green-600" :
                            seg.difficulty === "Khó" ? "bg-red-50 text-red-600" :
                            "bg-amber-50 text-amber-600"
                          )}>
                            {seg.difficulty}
                          </span>
                          )}
                        </div>
                      </div>

                      {/* V3: Sample Ad Collapsible */}
                      {seg.sampleAd && (
                        <div className="border-t border-slate-100">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedSampleAds(prev => {
                                const next = new Set(prev);
                                if (next.has(i)) next.delete(i); else next.add(i);
                                return next;
                              });
                            }}
                            className="w-full flex items-center justify-center gap-1.5 px-5 py-2.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            {expandedSampleAds.has(i) ? t("creative.main.step2.hideSample") : t("creative.main.step2.showSample")}
                            {expandedSampleAds.has(i) ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </button>

                          {expandedSampleAds.has(i) && (
                            <div className="px-5 pb-4 space-y-3 animate-fade-in" onClick={(e) => e.stopPropagation()}>
                              <div className="rounded-lg border border-indigo-200 bg-gradient-to-br from-indigo-50/80 to-white p-4 space-y-3">
                                <p className="text-xs font-bold text-indigo-700 flex items-center gap-1.5">
                                  {t("creative.main.step2.sampleFor", { name: seg.segmentName })}
                                </p>

                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{t("creative.main.common.primaryText")}</p>
                                  <p className="text-xs text-slate-700 leading-relaxed bg-white rounded-lg px-3 py-2 border border-slate-100">
                                    {seg.sampleAd.primaryText}
                                  </p>
                                </div>

                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{t("creative.main.common.headline")}</p>
                                  <p className="text-sm font-bold text-slate-800">
                                    {seg.sampleAd.headline}
                                  </p>
                                </div>

                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">CTA</span>
                                  <span className="rounded-md bg-blue-600 px-3 py-0.5 text-xs font-semibold text-white">
                                    {seg.sampleAd.cta}
                                  </span>
                                </div>

                                <div className="flex items-center gap-2 pt-2 border-t border-indigo-100">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const text = `${seg.sampleAd!.primaryText}\n\nHeadline: ${seg.sampleAd!.headline}\nCTA: ${seg.sampleAd!.cta}`;
                                      navigator.clipboard.writeText(text);
                                    }}
                                    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                                  >
                                    <Copy className="h-3 w-3" /> {t("creative.main.step2.copyNow")}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOffer(`[${seg.segmentName}] ${seg.sampleAd!.primaryText}`);
                                      if (seg.recommendedTones?.length) {
                                        setSelectedTones(seg.recommendedTones.slice(0, MAX_TONES));
                                      }
                                      setStep(3);
                                    }}
                                    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm"
                                  >
                                    <Sparkles className="h-3 w-3" /> {t("creative.main.step2.useStep3")}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Selection summary bar */}
              {selectedSegments.length > 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center justify-between">
                  <span className="text-amber-800 text-sm font-medium">
                    {t("creative.main.step2.insightSelected", { n: selectedSegments.length, ads: selectedSegments.length * selectedTones.length })}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedSegments([]); }}
                    className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {t("creative.main.step2.deselectAll")}
                  </button>
                </div>
              )}

              {/* Khối "Chiến lược cạnh tranh" ĐÃ GỠ HẲN ngày 16/09/2026 theo
                  quyết định của chủ sản phẩm. Trước đó nó bị khoá bằng hằng
                  `(false as boolean)` — không toggle nào bật lại được — trong khi
                  backend VẪN gọi Gemini sinh nguyên khối phân tích đối thủ mỗi lần
                  người dùng khai tên đối thủ: tốn token rồi vứt. Phần sinh ở
                  app/api/ai/audience-insight/route.ts cũng đã gỡ cùng lượt. */}

              {/* Best Time + Budget — uses campaignStrategy or top-level fallback */}
              {(() => {
                const bestTime = audienceData.campaignStrategy?.bestTimeToRun ?? audienceData.bestTimeToRun;
                const budget = audienceData.campaignStrategy?.budgetRecommendation ?? audienceData.budgetRecommendation;
                const adFormats = audienceData.campaignStrategy?.adFormats;
                const campaignStructure = audienceData.campaignStrategy?.campaignStructure;
                return (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-4">
                      {bestTime && (
                        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                          <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                            <Clock className="h-4 w-4 text-amber-700" /> {t("creative.main.step2.bestTime")}
                          </h4>
                          <p className="text-xs text-slate-600">
                            📅 {bestTime.daysOfWeek.join(", ")} | {bestTime.timeOfDay}
                          </p>
                          <p className="text-xs text-slate-400 mt-1">💡 {bestTime.reasoning}</p>
                        </div>
                      )}
                      {budget && (
                        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                          <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                            <DollarSign className="h-4 w-4 text-green-500" /> {t("creative.main.step2.budgetRec")} <span className="text-[10px] font-normal text-slate-400">{t("creative.main.step2.budgetRecNote")}</span>
                          </h4>
                          <div className="flex items-center gap-4 text-xs text-slate-600">
                            <span>{t("creative.main.step2.minimum")}<b className="text-slate-800">{fmtVND(budget.minimumDaily)}</b>{t("creative.main.common.perDay")}</span>
                            <span>{t("creative.main.step2.optimal")}<b className="text-green-700">{fmtVND(budget.optimalDaily)}</b>{t("creative.main.common.perDay")}</span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">💡 {budget.reasoning}</p>
                        </div>
                      )}
                    </div>
                    <div className="space-y-4">
                      {adFormats && adFormats.length > 0 && (
                        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                          <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                            <BarChart3 className="h-4 w-4 text-purple-500" /> {t("creative.main.step2.adFormats")}
                          </h4>
                          <div className="flex flex-wrap gap-1.5">
                            {adFormats.map((fmt, idx) => (
                              <span key={idx} className="rounded-full bg-purple-50 px-2.5 py-0.5 text-[10px] font-semibold text-purple-600">
                                {fmt}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {campaignStructure && (
                        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                          <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                            <Target className="h-4 w-4 text-amber-700" /> {t("creative.main.step2.campStructure")}
                          </h4>
                          <p className="text-xs text-slate-600 leading-relaxed">{campaignStructure}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </>
          )}

          {/* Nav buttons */}
          <div className="flex items-center justify-between">
            <Button variant="outline" className="gap-1.5 text-xs" onClick={() => setStep(1)}>
              <ArrowLeft className="h-3.5 w-3.5" /> {t("creative.main.common.back")}
            </Button>
            <div className="flex items-center gap-2">
              {step2Tab === "ai" && audienceData && audienceData.audienceSegments.length > 0 && (
                <Button
                  variant="outline"
                  onClick={saveAllSegmentsToLibrary}
                  disabled={savedSegmentIds.size === audienceData?.audienceSegments?.length}
                  className="gap-1.5 text-xs border-violet-200 text-violet-600 hover:bg-violet-50 disabled:opacity-40"
                >
                  🔖 {savedSegmentIds.size === audienceData?.audienceSegments?.length ? t("creative.main.step2.savedAll") : t("creative.main.step2.saveAll")}
                </Button>
              )}
              <Button
                onClick={() => setStep(3)}
                disabled={!canProceedStep2 && !audienceLoading}
                className="gap-1.5 bg-amber-500 text-sm text-amber-950 hover:bg-amber-600 disabled:opacity-40"
              >
                {t("creative.main.step2.next")} <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* STEP 3: GENERATE CREATIVES              */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {step === 3 && (
        <div className="space-y-6">
          {/* ── Tab Switcher ──
              Chỉ hiện những tab thuộc về nền tảng đang chọn. Trước đây luôn
              in đủ 3 tab: chạy Google vẫn thấy "Tạo nội dung mới" và "Dùng
              bài đã đăng" — cả hai đều là đường của Meta (sinh creative
              Facebook, lấy bài từ Fanpage), bấm vào là đi lạc hẳn sang nhánh
              không dùng được. Chọn riêng một nền tảng thì chỉ còn một tab,
              lúc đó thanh tab không còn tác dụng gì nên ẩn luôn. */}
          {(platform === "both" || platform === "facebook") && (
          <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
            <button
              onClick={() => { setCreativeTab("generate"); setCreativeTabTouched(true); }}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all",
                activeCreativeTab === "generate"
                  ? "bg-white text-amber-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Sparkles className="h-4 w-4" /> {t("creative.main.step3.tabGenerate")}
            </button>
            <button
              onClick={() => { setCreativeTab("existing"); setCreativeTabTouched(true); }}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all",
                activeCreativeTab === "existing"
                  ? "bg-white text-amber-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <ClipboardList className="h-4 w-4" /> {t("creative.main.step3.tabExisting")}
            </button>
            {/* Tab Google chỉ có nghĩa khi chiến dịch thật sự chạy Google. */}
            {platform === "both" && (
            <button
              onClick={() => { setCreativeTab("google"); setCreativeTabTouched(true); }}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all",
                activeCreativeTab === "google"
                  ? "bg-white text-red-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Target className="h-4 w-4" /> {t("creative.main.step3.tabGoogle")}
            </button>
            )}
          </div>
          )}

          {/* ── Tab 1: Tạo nội dung mới ── */}
          {activeCreativeTab === "generate" && (
          <>
          {/* Config */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
            {/* Tone of Voice — 10-tone multi-select */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-700">{t("creative.main.step3.tone")}</h3>
                <span className={cn(
                  "text-xs font-semibold rounded-full px-2.5 py-0.5",
                  selectedTones.length >= MAX_TONES
                    ? "bg-amber-100 text-amber-800"
                    : "bg-slate-100 text-slate-400"
                )}>
                  {t("creative.main.step3.toneSelected", { n: selectedTones.length, max: MAX_TONES })}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {TONES.map(tn => {
                  const isSelected = selectedTones.includes(tn.id);
                  const isRecommended = isLegacy && tn.bestFor.includes(selectedProduct);
                  const isDisabled = !isSelected && selectedTones.length >= MAX_TONES;
                  return (
                    <button
                      key={tn.id}
                      disabled={isDisabled}
                      onClick={() => {
                        setSelectedTones(prev =>
                          prev.includes(tn.id)
                            ? prev.filter(id => id !== tn.id)
                            : prev.length < MAX_TONES ? [...prev, tn.id] : prev
                        );
                      }}
                      className={cn(
                        "group/tone relative flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-all",
                        isSelected
                          ? "border-amber-500 bg-amber-50/60 shadow-sm"
                          : isRecommended
                          ? "border-amber-300 bg-amber-50/30 hover:border-amber-400"
                          : "border-slate-200 hover:border-slate-300 bg-white",
                        isDisabled && "opacity-40 cursor-not-allowed"
                      )}
                    >
                      {/* Recommended badge */}
                      {isRecommended && !isSelected && (
                        <span className="absolute -top-2 -right-1 rounded-full bg-amber-400 px-1.5 py-0.5 text-[8px] font-bold text-white shadow-sm">
                          {t("creative.main.step3.suggested")}
                        </span>
                      )}
                      {/* Selected checkmark */}
                      {isSelected && (
                        <span className="absolute top-1.5 right-1.5">
                          <Check className="h-3.5 w-3.5 text-amber-700" />
                        </span>
                      )}
                      <div className="flex items-center gap-1.5">
                        <span className="text-base leading-none">{tn.icon}</span>
                        <span className={cn("text-xs font-semibold", isSelected ? "text-amber-800" : "text-slate-700")}>
                          {tn.label}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 leading-tight">{tn.description}</span>
                      {/* Sample hook — shown on hover or when selected (câu mẫu là nội dung Mắt Bão → chỉ legacy) */}
                      {isLegacy && <span className={cn(
                        "text-[10px] italic leading-tight mt-0.5 transition-all",
                        isSelected
                          ? "text-amber-700 opacity-100"
                          : "text-slate-300 opacity-0 group-hover/tone:opacity-100"
                      )}>
                        &ldquo;{tn.sampleHook}&rdquo;
                      </span>}
                    </button>
                  );
                })}
              </div>

              {/* Combo label */}
              {selectedTones.length > 1 && (
                <div className="mt-3 rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 px-4 py-2.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-amber-800">{t("creative.main.step3.combo")}</span>
                    {selectedTones.map((id, idx) => {
                      const tone = TONES.find(t => t.id === id);
                      return (
                        <span key={id} className="inline-flex items-center">
                          {idx > 0 && <span className="text-amber-600 font-bold mx-1">+</span>}
                          <span className="rounded-full bg-white border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-800 shadow-sm">
                            {tone?.icon} {tone?.label}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-amber-700 mt-1">
                    {t("creative.main.step3.comboHint", { n: selectedTones.length })}
                  </p>
                </div>
              )}
            </div>

            {/* Creative Count Preview */}
            {selectedSegments.length > 0 && selectedTones.length > 0 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-xs font-semibold text-emerald-700">
                  {t("creative.main.step3.willCreate")}<b>{totalCreativeCount}</b>{t("creative.main.step3.willCreateEq", { segs: selectedSegments.length, tones: selectedTones.length })}{platform === "both" ? t("creative.main.step3.times2") : ""}
                </p>
              </div>
            )}

            {/* Generate Button */}
            <Button
              onClick={generate}
              disabled={isGenerating || selectedSegments.length === 0 || selectedTones.length === 0}
              className="w-full gap-2 bg-amber-500 py-6 text-base font-bold text-amber-950 hover:bg-amber-600 disabled:opacity-50 shadow-lg shadow-amber-200"
            >
              {isGenerating ? (
                <><Loader2 className="h-5 w-5 animate-spin" /> {generationProgress || t("creative.main.step3.writing", { n: totalCreativeCount })}</>
              ) : (
                <><Sparkles className="h-5 w-5" /> {t("creative.main.step3.generate", { n: totalCreativeCount })}</>
              )}
            </Button>
          </div>
          </>)}

          {/* ── Tab 2: Dùng bài đã đăng ── */}
          {activeCreativeTab === "existing" && (() => {
            // Load posts function
            const loadPagePosts = async () => {
              setLoadingPosts(true);
              try {
                const params = new URLSearchParams({
                  company: company || (orderedCompanyIds(["MBC"])[0] ?? "MBC"), // Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ)
                  days: String(dayRange),
                  search: searchPostText,
                  mediaOnly: String(filterMediaOnly),
                });
                const res = await fetch(`/api/creative/page-posts?${params}`);
                const data = await res.json();
                // Trước đây lỗi chỉ đi vào console: token Page hết hạn hay
                // Fanpage sai quyền đều hiện ra y như "không có bài nào" — người
                // dùng ngồi đợi một danh sách không bao giờ tới mà không biết vì sao.
                if (data.error) {
                  setPostsError(typeof data.error === "string" ? data.error : t("creative.main.step3.postsLoadErr"));
                  setPagePosts([]);
                } else {
                  setPostsError(null);
                  setPagePosts(data.posts || []);
                }
              } catch (err) {
                setPostsError(err instanceof Error ? err.message : t("creative.main.step3.postsApiErr"));
                setPagePosts([]);
              } finally {
                setLoadingPosts(false);
              }
            };

            const togglePost = (post: PagePost) => {
              setSelectedPosts(prev =>
                prev.find(p => p.id === post.id)
                  ? prev.filter(p => p.id !== post.id)
                  : [...prev, post]
              );
            };

            return (
            <div className="space-y-4">
              {/* Filters */}
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  {t("creative.main.step3.pickPosts", { company })}
                </h3>
                {postsError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                    <p className="text-xs text-red-700">❌ {postsError}</p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  {/* Search */}
                  <div className="flex-1 min-w-[200px]">
                    <Input
                      placeholder={t("creative.main.step3.searchPh")}
                      value={searchPostText}
                      onChange={e => setSearchPostText(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && loadPagePosts()}
                      className="h-9 text-sm"
                    />
                  </div>

                  {/* Day range */}
                  <select
                    value={dayRange}
                    onChange={e => setDayRange(Number(e.target.value))}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 focus:border-amber-400 focus:outline-none"
                  >
                    <option value={30}>{t("creative.main.step3.last30")}</option>
                    <option value={60}>{t("creative.main.step3.last60")}</option>
                    <option value={90}>{t("creative.main.step3.last90")}</option>
                  </select>

                  {/* Media only */}
                  <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={filterMediaOnly}
                      onChange={e => setFilterMediaOnly(e.target.checked)}
                      className="accent-amber-500 h-3.5 w-3.5"
                    />
                    {t("creative.main.step3.mediaOnly")}
                  </label>

                  {/* Search button */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs"
                    disabled={loadingPosts}
                    onClick={loadPagePosts}
                  >
                    {loadingPosts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {loadingPosts ? t("creative.main.common.loading") : t("creative.main.step3.search")}
                  </Button>
                </div>
              </div>

              {/* Selected count banner */}
              {selectedPosts.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 flex items-center justify-between">
                  <p className="text-xs font-semibold text-amber-800">
                    {t("creative.main.step3.postsSelected", { n: selectedPosts.length })}
                  </p>
                  <button
                    onClick={() => setSelectedPosts([])}
                    className="text-xs text-amber-700 hover:text-amber-800 font-medium"
                  >
                    {t("creative.main.step3.deselectAllPosts")}
                  </button>
                </div>
              )}

              {/* Skeleton loading */}
              {loadingPosts && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="rounded-xl border border-slate-200 bg-white overflow-hidden animate-pulse">
                      <div className="h-36 bg-slate-200" />
                      <div className="p-3 space-y-2">
                        <div className="h-3 bg-slate-200 rounded w-full" />
                        <div className="h-3 bg-slate-200 rounded w-3/4" />
                        <div className="h-3 bg-slate-100 rounded w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Posts grid */}
              {!loadingPosts && pagePosts.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {pagePosts.map(post => {
                    const isSelected = selectedPosts.some(p => p.id === post.id);
                    return (
                      <button
                        key={post.id}
                        onClick={() => togglePost(post)}
                        className={cn(
                          "relative flex flex-col rounded-xl border-2 bg-white text-left shadow-sm transition-all hover:shadow-md overflow-hidden",
                          isSelected
                            ? "border-amber-500 ring-2 ring-amber-100"
                            : "border-slate-200 hover:border-slate-300"
                        )}
                      >
                        {/* Thumbnail */}
                        {post.thumbnail ? (
                          <div className="relative h-36 w-full bg-slate-100">
                            <img src={post.thumbnail} alt="" className="h-full w-full object-cover" />
                            <span className={cn(
                              "absolute top-2 left-2 rounded-full px-2 py-0.5 text-[10px] font-bold shadow-sm",
                              post.mediaType === "photo" ? "bg-blue-500 text-white" :
                              post.mediaType === "video" ? "bg-red-500 text-white" :
                              post.mediaType === "link" ? "bg-amber-500 text-white" :
                              "bg-slate-500 text-white"
                            )}>
                              {post.mediaType === "photo" ? t("creative.main.step3.mtPhoto") :
                               post.mediaType === "video" ? t("creative.main.step3.mtVideo") :
                               post.mediaType === "link" ? t("creative.main.step3.mtLink") : t("creative.main.step3.mtText")}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-20 bg-slate-50 text-slate-300">
                            <span className="text-2xl">{post.mediaType === "link" ? "🔗" : "📝"}</span>
                          </div>
                        )}

                        {/* Content */}
                        <div className="p-3 space-y-2 flex-1">
                          <p className="text-xs text-slate-700 leading-relaxed line-clamp-3">
                            {post.message || t("creative.main.step3.noText")}
                          </p>
                          <div className="post-meta flex items-center justify-between text-[10px] text-slate-400">
                            <span>{new Date(post.createdTime).toLocaleDateString(intlLocale)}</span>
                            <div className="flex items-center gap-2">
                              <span>👍 {post.engagement.likes}</span>
                              <span>💬 {post.engagement.comments}</span>
                              <span>↗️ {post.engagement.shares}</span>
                            </div>
                          </div>
                        </div>

                        {/* Selection indicator */}
                        <div className={cn(
                          "absolute top-2 right-2 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors",
                          isSelected ? "border-amber-500 bg-amber-500" : "border-white/80 bg-white/80"
                        )}>
                          {isSelected && <Check className="h-3 w-3 text-white" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Empty state */}
              {!loadingPosts && pagePosts.length === 0 && (
                <div className="rounded-xl border border-slate-200 bg-white py-12 text-center">
                  <p className="text-sm text-slate-400">{t("creative.main.step3.emptyPosts")}</p>
                  <p className="text-xs text-slate-300 mt-1">{t("creative.main.step3.emptyPostsHint")}</p>
                </div>
              )}

              {/* Confirm selection */}
              {selectedPosts.length > 0 && (
                <div className="rounded-xl border-2 border-amber-200 bg-amber-50/50 p-4 space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {selectedPosts.map(post => (
                      <span key={post.id} className="inline-flex items-center gap-1 rounded-full bg-white border border-amber-200 px-2.5 py-0.5 text-[10px] font-medium text-amber-800">
                        {post.message.slice(0, 30)}{post.message.length > 30 ? "..." : ""}
                        <button
                          onClick={() => setSelectedPosts(prev => prev.filter(p => p.id !== post.id))}
                          className="text-amber-600 hover:text-amber-700 ml-0.5"
                        >✕</button>
                      </span>
                    ))}
                  </div>

                  {/* Nút CTA + URL đích — trước đây bài đã đăng lên Ad không
                      gắn nút/URL gì cả vì object_story_id không mang theo 2
                      trường này. Launch route sẽ thử gắn overlay CTA+link lên
                      trên bài gốc bằng URL đích của cả campaign. */}
                  <div className="rounded-lg border border-amber-200 bg-white p-3 space-y-2">
                    <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      {t("creative.main.step3.ctaLabel")}
                    </label>
                    <select
                      value={existingPostCta}
                      onChange={e => setExistingPostCta(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 focus:border-amber-400 focus:outline-none"
                    >
                      {CTA_OPTIONS.map(o => (
                        <option key={o.metaValue} value={o.metaValue}>{o.labelVi}</option>
                      ))}
                    </select>
                    {destinationUrl.trim() ? (
                      <p className="text-[11px] text-slate-500">
                        {t("creative.main.step3.ctaPoints")} <span className="font-medium text-slate-700 break-all">{destinationUrl}</span>
                      </p>
                    ) : (
                      <p className="text-[11px] text-red-600">
                        {t("creative.main.step3.ctaNoUrl")}
                      </p>
                    )}
                  </div>

                  <Button
                    onClick={() => {
                      // Ensure objectStoryId is always in "pageId_postId" format.
                      // FB page posts come back as "{pageId}_{postId}" from the API,
                      // but guard against bare numeric IDs just in case.
                      const PAGE_IDS: Record<string, string> = pageIdsByCompany();
                      function resolveObjectStoryId(post: PagePost): string {
                        const id = post.objectStoryId || post.id;
                        // Already composite format → use as-is
                        if (/^\d+_\d+$/.test(id)) return id;
                        // Bare numeric post ID → prepend page ID
                        const pageId = PAGE_IDS[company] ?? "";
                        console.warn(`[PostPicker] Bare post ID "${id}", building objectStoryId: ${pageId}_${id}`);
                        return pageId ? `${pageId}_${id}` : id;
                      }

                      const postCreatives: CreativeResult[] = selectedPosts.map(post => {
                        const resolvedObjectStoryId = resolveObjectStoryId(post);
                        console.log("[PostPicker] Confirmed post:", {
                          postId: post.id,
                          objectStoryId: resolvedObjectStoryId,
                          message: post.message?.slice(0, 50),
                        });
                        return {
                          id: `existing-${post.id}`,
                          segmentName: t("creative.main.step3.publishedSeg"),
                          segmentIndex: 0,
                          funnelStage: "BOFU",
                          tone: "existing",
                          toneLabel: t("creative.main.step3.publishedTone", { date: post.createdTime.slice(0, 10) }),
                          platform: "facebook" as const,
                          headline: post.message.slice(0, 60),
                          primaryText: post.message,
                          description: "",
                          cta: existingPostCta,
                          selected: true,
                          objectStoryId: resolvedObjectStoryId,
                          isExistingPost: true,
                          postThumbnail: post.thumbnail || undefined,
                          postEngagement: post.engagement,
                        };
                      });
                      // Merge: remove old existing, add new
                      setCreativeResults(prev => [
                        ...prev.filter(c => !c.isExistingPost),
                        ...postCreatives,
                      ]);
                      setCreatives(prev => [
                        ...prev.filter(c => !c.id.startsWith("existing-")),
                        ...postCreatives.map(cr => ({
                          id: cr.id,
                          platform: cr.platform as Platform,
                          format: "feed" as const,
                          headline: cr.headline,
                          primaryText: cr.primaryText,
                          description: cr.description,
                          cta: cr.cta,
                          score: undefined,
                          reason: undefined,
                        })),
                      ]);
                      setCreativeTab("generate");
                    }}
                    className="w-full gap-2 bg-amber-500 py-3 text-sm font-bold text-amber-950 hover:bg-amber-600 shadow-md"
                  >
                    <Check className="h-4 w-4" /> {t("creative.main.step3.usePosts", { n: selectedPosts.length })}
                  </Button>
                </div>
              )}
            </div>
            );
          })()}

          {/* Error */}
          {generateError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {generateError}
            </div>
          )}

          {/* Results */}
          {creativeResults.length > 0 && (
            <div className="space-y-4">
              {/* Header bar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-800">
                  {t("creative.main.step3.resultsCount", { n: creativeResults.length })}
                  <span className="ml-2 text-xs text-slate-400 font-normal">
                    {t("creative.main.step3.resultsSelected", { n: selectedCreativeCount })}
                  </span>
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={copyAllCreatives}>
                    <ClipboardList className="h-3.5 w-3.5" /> {t("creative.main.step3.copyAll")}
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={generate}>
                    <RefreshCw className="h-3.5 w-3.5" /> {t("creative.main.step3.regenerate")}
                  </Button>
                  <Button
                    variant="outline" size="sm" className="gap-1.5 text-xs border-violet-200 text-violet-600 hover:bg-violet-50"
                    onClick={async () => {
                      const res = await fetch("/api/creatives/sync-performance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
                      const data = await res.json();
                      if (data.success) alert(t("creative.main.step3.syncOk", { synced: data.synced, total: data.total ?? data.synced }));
                      else alert("❌ " + (data.error ?? t("creative.main.step3.syncFail")));
                    }}
                  >
                    <BarChart3 className="h-3.5 w-3.5" /> {t("creative.main.step3.syncPerf")}
                  </Button>
                  <Button
                    variant="outline" size="sm" className="gap-1.5 text-xs border-amber-200 text-amber-700 hover:bg-amber-50"
                    onClick={() => {
                      const briefData: BriefData = {
                        productName: selectedProduct === "custom" ? customProduct : (productLabel(selectedProduct)),
                        objective: OBJECTIVES.find(o => o.value === objective)?.label ?? objective,
                        platform: platform === "both" ? "Facebook + Google" : platform === "facebook" ? "Facebook" : "Google",
                        bestTimeToRun: audienceData?.bestTimeToRun,
                        budgetRecommendation: audienceData?.budgetRecommendation,
                        audienceSegments: audienceData?.audienceSegments?.filter((_, i) => selectedSegments.includes(i)),
                        competitorInsights: audienceData?.competitorInsights,
                        creatives,
                      };
                      downloadBriefAsMarkdown(briefData);
                    }}
                  >
                    <Download className="h-3.5 w-3.5" /> {t("creative.main.step3.exportBrief")}
                  </Button>
                  <Button
                    variant="outline" size="sm" className="gap-1.5 text-xs border-green-200 text-green-600 hover:bg-green-50"
                    onClick={() => {
                      const briefData: BriefData = {
                        productName: selectedProduct === "custom" ? customProduct : (productLabel(selectedProduct)),
                        objective: OBJECTIVES.find(o => o.value === objective)?.label ?? objective,
                        platform: platform === "both" ? "Facebook + Google" : platform === "facebook" ? "Facebook" : "Google",
                        bestTimeToRun: audienceData?.bestTimeToRun,
                        budgetRecommendation: audienceData?.budgetRecommendation,
                        audienceSegments: audienceData?.audienceSegments?.filter((_, i) => selectedSegments.includes(i)),
                        competitorInsights: audienceData?.competitorInsights,
                        creatives,
                      };
                      window.open(buildEmailLink(briefData), "_blank");
                    }}
                  >
                    <Mail className="h-3.5 w-3.5" /> {t("creative.main.step3.sendEmail")}
                  </Button>
                </div>
              </div>

              {/* Segment filter tabs */}
              {selectedSegments.length > 1 && (
                <div className="flex gap-2 mb-4 flex-wrap">
                  <button
                    onClick={() => setCreativeFilterSegment("all")}
                    className={cn(
                      "rounded-xl px-4 py-2 text-xs font-medium transition-all",
                      creativeFilterSegment === "all"
                        ? "bg-amber-500 text-amber-950 shadow-sm"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    )}
                  >
                    {t("creative.main.step3.filterAll", { n: creativeResults.length })}
                  </button>
                  {audienceData?.audienceSegments
                    .filter((_, i) => selectedSegments.includes(i))
                    .map((seg, idx) => {
                      const count = creativeResults.filter(c => c.segmentName === seg.segmentName).length;
                      const hasCreatives = count > 0;
                      return (
                        <button
                          key={seg.segmentName}
                          onClick={() => setCreativeFilterSegment(seg.segmentName)}
                          className={cn(
                            "rounded-xl px-4 py-2 text-xs font-medium transition-all",
                            creativeFilterSegment === seg.segmentName
                              ? "bg-amber-500 text-amber-950 shadow-sm"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          )}
                        >
                          {t("creative.main.step3.adSetN", { n: idx + 1 })}{seg.segmentName.length > 20 ? seg.segmentName.slice(0, 20) + '…' : seg.segmentName}
                          {hasCreatives && <span className="ml-1.5 text-green-300">✓</span>}
                          <span className="ml-1 opacity-60">({count})</span>
                        </button>
                      );
                    })}
                </div>
              )}

              {/* Cards grid with segment/tone badges */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {creativeResults
                  .map((cr, i) => ({ cr, originalIndex: i }))
                  .filter(({ cr }) => creativeFilterSegment === "all" || cr.segmentName === creativeFilterSegment)
                  .map(({ cr, originalIndex: i }) => {
                  // Score this creative
                  const creativeScore: CreativeScore = scoreCreative({
                    headline: cr.headline || "",
                    primaryText: cr.primaryText || "",
                    description: cr.description || "",
                    hasImage: !!(cr.imageUrl || cr.isExistingPost),
                    usp: usp || "",
                    socialProof: socialProof || "",
                    offer: offer || "",
                    cta: cr.cta || "",
                  });
                  const scoreClr = getScoreColor(creativeScore.total);
                  const isLowScore = creativeScore.total < 50;

                  return (
                  <div key={cr.id} className={cn(
                    "relative rounded-xl border-2 transition-all",
                    cr.selected
                      ? "border-amber-500 ring-2 ring-amber-100 shadow-md"
                      : isLowScore
                        ? "border-red-200 opacity-80"
                        : "border-slate-200 opacity-60"
                  )}>
                    {/* Segment + Tone badge */}
                    <div className="flex items-center gap-1.5 px-4 pt-3 pb-1 flex-wrap">
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-bold",
                        cr.funnelStage === "TOFU" ? "bg-sky-100 text-sky-700" :
                        cr.funnelStage === "MOFU" ? "bg-amber-100 text-amber-700" :
                        "bg-emerald-100 text-emerald-700"
                      )}>
                        🎯 {cr.funnelStage === "TOFU" ? t("creative.main.step2.stageTofu") :
                           cr.funnelStage === "MOFU" ? t("creative.main.step2.stageMofu") :
                           cr.funnelStage === "BOFU" ? t("creative.main.step2.stageBofu") : cr.funnelStage}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 truncate max-w-[140px]">
                        {cr.segmentName}
                      </span>
                      <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                        {TONES.find(t => t.id === cr.tone)?.icon} {cr.toneLabel}
                      </span>
                    </div>

                    {/* Selection checkbox — disabled when score < 50 */}
                    <button
                      onClick={() => (cr.selected || !isLowScore) && toggleCreativeSelection(i)}
                      className={cn("absolute top-2 right-2 z-10", !cr.selected && isLowScore && "cursor-not-allowed")}
                      title={!cr.selected && isLowScore ? t("creative.main.step3.lowScoreTitle") : undefined}
                    >
                      <div className={cn(
                        "h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors",
                        isLowScore ? "border-red-300 bg-red-50" :
                        cr.selected ? "border-amber-500 bg-amber-500" : "border-slate-300 bg-white"
                      )}>
                        {cr.selected && !isLowScore && <Check className="h-3 w-3 text-white" />}
                      </div>
                    </button>

                    {cr.withinLimits === false && (
                      <div className="mx-3 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {t("creative.main.step3.limitBefore")}{" "}
                        {(cr.limitViolations ?? []).map(v => `${v.field} (${v.length}/${v.limit})`).join(", ")}{t("creative.main.step3.limitAfter")}
                      </div>
                    )}

                    {(cr.complianceNotes ?? []).length > 0 && (
                      <div className={cn(
                        "mx-3 mb-2 rounded-lg border px-3 py-2 text-xs space-y-1",
                        cr.complianceNotes!.some(n => n.severity === "block")
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      )}>
                        {cr.complianceNotes!.map((n, ni) => (
                          <div key={ni}>
                            {n.severity === "block" ? "🚫" : "⚠️"} <span className="font-semibold">[{n.rule}]</span> {n.suggestion}
                          </div>
                        ))}
                      </div>
                    )}

                    <CreativeCard
                      creative={creatives[i] || {
                        id: cr.id, platform: cr.platform as Platform, format: "feed",
                        headline: cr.headline, primaryText: cr.primaryText,
                        description: cr.description, cta: cr.cta,
                        score: cr.score, reason: cr.reason,
                      }}
                      onCopy={() => copyCreative(creatives[i] || {
                        id: cr.id, platform: cr.platform as Platform, format: "feed",
                        headline: cr.headline, primaryText: cr.primaryText,
                        description: cr.description, cta: cr.cta,
                      })}
                      onSave={() => creatives[i] && saveCreative(creatives[i])}
                      onRegenerate={() => regenerateOne(i)}
                      onUpdate={(updated) => {
                        setCreativeResults(prev => prev.map((c, idx) => idx === i ? { ...c, ...updated } as CreativeResult : c));
                        setCreatives(prev => prev.map((c, idx) => idx === i ? { ...c, ...updated } : c));
                      }}
                      product={selectedProduct === "custom" ? customProduct : (productLabel(selectedProduct))}
                      selectedTones={selectedTones}
                      segment={cr.segmentName}
                    />

                    {/* ── FB Ad Preview toggle ── */}
                    <div className="mx-3 mb-2">
                      <button
                        onClick={() => setPreviewOpenIndex(previewOpenIndex === i ? null : i)}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        {previewOpenIndex === i ? t("creative.main.step3.hidePreview") : t("creative.main.step3.showPreview")}
                      </button>
                      {previewOpenIndex === i && (
                        <div className="mt-2 flex justify-center">
                          <FBAdPreview
                            pageName={isLegacy ? (company === "MBC" ? "MBC Vietnam" : company === "MBI" ? "MBI Vietnam" : companyLabel(company)) : (brand?.brandName || companyLabel(company))}
                            primaryText={cr.primaryText}
                            imageUrl={cr.imageUrl}
                            headline={cr.headline}
                            description={cr.description}
                            cta={cr.cta}
                            destinationUrl={destinationUrl}
                          />
                        </div>
                      )}
                    </div>

                    {/* ── Image Upload Zone — skip for existing posts ── */}
                    {!cr.isExistingPost && (
                      <div className="mx-3 mb-3">
                        {cr.imageUrl ? (
                          // Preview uploaded image
                          <div className="relative rounded-lg overflow-hidden border border-amber-200">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={cr.imageUrl}
                              alt={t("creative.main.step3.creativeImageAlt")}
                              className="w-full h-36 object-cover"
                            />
                            <div className="absolute top-1 right-1 flex gap-1">
                              {cr.imageHash && (
                                <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[9px] font-bold text-white shadow">
                                  {t("creative.main.step3.uploadedFb")}
                                </span>
                              )}
                              <button
                                onClick={() => setCreativeResults(prev => prev.map((c, idx) =>
                                  idx === i ? { ...c, imageUrl: undefined, imageHash: undefined } : c
                                ))}
                                className="rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white hover:bg-black/80"
                              >
                                {t("creative.main.step3.removeImage")}
                              </button>
                            </div>
                          </div>
                        ) : (
                          // Drop zone
                          <label
                            className="flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 py-4 cursor-pointer hover:border-amber-300 hover:bg-amber-50/50 transition-all group"
                            onDragOver={e => { e.preventDefault(); }}
                            onDrop={async (e) => {
                              e.preventDefault();
                              const file = e.dataTransfer.files?.[0];
                              if (!file) return;
                              const localUrl = URL.createObjectURL(file);
                              setCreativeResults(prev => prev.map((c, idx) => idx === i ? { ...c, imageUrl: localUrl } : c));
                              // Upload to FB
                              try {
                                const fd = new FormData();
                                fd.append("image", file);
                                const res = await fetch("/api/creative/upload-image", { method: "POST", body: fd });
                                const data = await res.json() as { success: boolean; imageHash?: string; error?: string };
                                if (data.success && data.imageHash) {
                                  setCreativeResults(prev => prev.map((c, idx) => idx === i ? { ...c, imageHash: data.imageHash } : c));
                                } else {
                                  alert(t("creative.main.upload.failed", { error: data.error ?? t("creative.main.upload.unknown") }));
                                }
                              } catch { alert(t("creative.main.upload.retry")); }
                            }}
                          >
                            <input
                              type="file"
                              accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const localUrl = URL.createObjectURL(file);
                                setCreativeResults(prev => prev.map((c, idx) => idx === i ? { ...c, imageUrl: localUrl } : c));
                                // Upload to FB
                                try {
                                  const fd = new FormData();
                                  fd.append("image", file);
                                  const res = await fetch("/api/creative/upload-image", { method: "POST", body: fd });
                                  const data = await res.json() as { success: boolean; imageHash?: string; error?: string };
                                  if (data.success && data.imageHash) {
                                    setCreativeResults(prev => prev.map((c, idx) => idx === i ? { ...c, imageHash: data.imageHash } : c));
                                  } else {
                                    alert(t("creative.main.upload.failed", { error: data.error ?? t("creative.main.upload.unknown") }));
                                  }
                                } catch { alert(t("creative.main.upload.retry")); }
                                e.target.value = ""; // reset input
                              }}
                            />
                            <span className="text-xl group-hover:scale-110 transition-transform">🖼️</span>
                            <span className="text-xs font-medium text-slate-500 group-hover:text-amber-700">{t("creative.main.step3.dropImage")}</span>
                            <span className="text-[10px] text-slate-400">{t("creative.main.step3.imageLimits")}</span>
                          </label>
                        )}
                      </div>
                    )}

                    {/* ── Creative Score Panel ── */}

                    <div className={cn("mx-3 mb-3 rounded-lg border p-3 space-y-2", scoreClr.border, scoreClr.bg)}>
                      {/* Score header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={cn("text-xs font-bold", scoreClr.text)}>
                            {getGradeEmoji(creativeScore.grade)} {t("creative.main.step3.creativeScore")}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {t("creative.main.step3.estCtr", { ctr: creativeScore.ctrEstimate })}
                          </span>
                        </div>
                        <div className={cn(
                          "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold",
                          scoreClr.bg, scoreClr.text
                        )}>
                          {creativeScore.total}/100
                        </div>
                      </div>

                      {/* Total progress bar */}
                      <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className={cn("h-full rounded-full bg-gradient-to-r transition-all", scoreClr.gradient)}
                          style={{ width: `${creativeScore.total}%` }}
                        />
                      </div>

                      {/* Per-dimension bars */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        {SCORE_DIMENSIONS.map(dim => (
                          <div key={dim.key} className="flex items-center gap-1.5">
                            <span className="text-[9px] text-slate-500 w-16 truncate">{dim.label}</span>
                            <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                              <div
                                className={cn("h-full rounded-full transition-all", dim.color)}
                                style={{ width: `${(creativeScore.scores[dim.key] / dim.max) * 100}%` }}
                              />
                            </div>
                            <span className="text-[9px] text-slate-400 w-6 text-right">
                              {creativeScore.scores[dim.key]}/{dim.max}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Suggestions + AI Improve button */}
                      {creativeScore.suggestions.length > 0 && (
                        <div className="space-y-1.5 pt-1.5 border-t border-slate-200">
                          {creativeScore.suggestions.slice(0, 3).map((s, idx) => (
                            <p key={idx} className="text-[10px] text-slate-500">{s}</p>
                          ))}

                          {/* AI Auto-Improve Button */}
                          {creativeScore.total < 70 && (
                            <button
                              onClick={() => improveCreative(i, creativeScore.scores as unknown as Record<string, number>, creativeScore.suggestions)}
                              disabled={improvingIndex !== null}
                              className={cn(
                                "w-full mt-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-all",
                                improvingIndex === i
                                  ? "bg-gradient-to-r from-violet-100 to-purple-100 text-violet-600 animate-pulse"
                                  : "bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:from-violet-600 hover:to-purple-700 shadow-sm hover:shadow-md",
                                improvingIndex !== null && improvingIndex !== i && "opacity-40 cursor-not-allowed"
                              )}
                            >
                              {improvingIndex === i ? (
                                <><Loader2 className="h-3 w-3 animate-spin" /> {t("creative.main.step3.improving")}</>
                              ) : (
                                <>{t("creative.main.step3.improve")}</>  
                              )}
                            </button>
                          )}
                        </div>
                      )}

                      {/* Low score warning */}
                      {isLowScore && (
                        <p className="text-[10px] font-bold text-red-600 flex items-center gap-1">
                          {t("creative.main.step3.lowScoreWarn")}
                        </p>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>

              {/* Proceed to Step 4 */}
              {creativeResults.length > 0 && (
                <Button
                  onClick={() => {
                    const productName = selectedProduct === "custom" ? customProduct
                      : productLabel(selectedProduct);
                    setCampaignName(generateCampaignName(company, productName));
                    setStep(4);
                  }}
                  disabled={selectedCreativeCount === 0}
                  className="w-full gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 py-5 text-sm font-bold text-white hover:from-emerald-700 hover:to-teal-700 disabled:opacity-40 shadow-lg"
                >
                  <Rocket className="h-4 w-4" />
                  {t("creative.main.step3.nextLaunch", { n: selectedCreativeCount })}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}

          {/* ── Tab 3: Google Ads Creative ── */}
          {activeCreativeTab === "google" && (
            <GoogleCreativePanel
              // key={company}: đổi công ty là đổi TÀI KHOẢN Google Ads. Ảnh và
              // sitelink đã chọn mang mã tài nguyên gắn cứng customer id của
              // tài khoản cũ (customers/2190685994/assets/...) — giữ lại rồi
              // launch sang tài khoản kia là gửi tài sản của người khác.
              // Cho React dựng lại panel từ đầu để state không đi xuyên tài khoản.
              key={company}
              company={company}
              // Gộp TẤT CẢ phân khúc đã chọn, không chỉ cái đầu tiên.
              //
              // Hai lỗi được sửa cùng lúc ở đây:
              //  1. Trước đây chỉ truyền `selectedSegments[0]` — chọn 3 phân khúc
              //     thì hai cái sau rơi im lặng.
              //  2. Trường tên là `segmentName`, nhưng panel và API đọc
              //     `segment.name` → LUÔN undefined. Nghĩa là prompt sinh creative
              //     Google trước giờ nhận ĐÚNG SỐ KHÔNG ngữ cảnh đối tượng, chỉ
              //     dựa vào catalog sản phẩm. Ánh xạ đúng tên ở đây.
              segment={(() => {
                const segs = selectedSegments
                  .map(i => audienceData?.audienceSegments?.[i])
                  .filter(Boolean) as AudienceSegment[];
                if (segs.length === 0) return { name: "Unknown" };
                const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));
                return {
                  ...segs[0],
                  name: segs.map(x => x.segmentName).join(" + "),
                  // `keywords` là trường generate-creative đã đọc sẵn từ trước
                  // nhưng chưa bao giờ được nuôi — nay nối từ searchIntents.
                  keywords: uniq(segs.flatMap(x => x.googleTargeting?.searchIntents ?? [])),
                  negativeKeywords: uniq(segs.flatMap(x => x.googleTargeting?.negativeKeywords ?? [])),
                  audienceSignals: uniq(segs.flatMap(x => x.googleTargeting?.audienceSignals ?? [])),
                  painPoints: uniq(segs.flatMap(x => x.painPoints ?? [])),
                };
              })()}
              onBack={() => setStep(2)}
              initialProductId={selectedProduct || undefined}
              initialProductName={selectedProduct === "custom" ? customProduct : undefined}
              initialCampaignType={googleCampaignType}
            />
          )}

          {/* Nav back */}
          {activeCreativeTab !== "google" && (
          <Button variant="outline" className="gap-1.5 text-xs" onClick={() => setStep(2)}>
            <ArrowLeft className="h-3.5 w-3.5" /> {t("creative.main.step3.backToStep2")}
          </Button>
          )}
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* STEP 4: LAUNCH CAMPAIGN                  */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* Bước 4 là đường khởi chạy CỦA RIÊNG META — Fanpage, Pixel, vị trí
          Instagram, Advantage+ Audience, Lookalike. Chiến dịch Google không
          có đường nào tới đây trong luồng bình thường, NHƯNG bản nháp được tự
          lưu kèm `currentStep` và khôi phục lại khi mở trang: một bản nháp
          Meta dừng ở Bước 4, sau đó đổi nền tảng sang Google, sẽ dựng lại
          nguyên màn hình Meta cho một chiến dịch Google. Chặn ở đây và đưa
          về đúng chỗ, thay vì để người dùng điền một biểu mẫu không dùng được. */}
      {step === 4 && platform === "google" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 space-y-3">
          <h3 className="text-sm font-bold text-amber-900">{t("creative.main.step4.googleSkip")}</h3>
          <p className="text-xs text-amber-800 leading-relaxed">
            {t("creative.main.step4.googleSkipBody")}
          </p>
          <Button onClick={() => setStep(3)} className="gap-1.5 bg-amber-500 text-amber-950 hover:bg-amber-600 text-sm">
            <ArrowLeft className="h-3.5 w-3.5" /> {t("creative.main.step4.backToStep3")}
          </Button>
        </div>
      )}

      {step === 4 && platform !== "google" && (
        <div className="space-y-6">
          {/* Success Modal */}
          {launchSuccess && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
              <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 p-8 text-center space-y-4">
                <div className="text-5xl">🎉</div>
                <h3 className="text-lg font-bold text-slate-800">{t("creative.main.step4.created")}</h3>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-1">
                  <p className="text-sm font-bold text-emerald-800">{campaignName}</p>
                  <p className="text-xs text-emerald-600">
                    {t("creative.main.step4.counts", { sets: launchSuccess.adSetCount, ads: launchSuccess.adCount })}<b>{launchSuccess.launchActive ? t("creative.main.step4.running") : t("creative.main.step4.draft")}</b>
                  </p>
                </div>
                <p className="text-xs text-slate-500">
                  {launchSuccess.launchActive
                    ? t("creative.main.step4.liveMsg")
                    : t("creative.main.step4.draftMsg")}
                </p>
                {targetingDowngrades.length > 0 && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-left space-y-2">
                    <p className="text-xs font-bold text-red-700">
                      {t("creative.main.step4.downgrades", { n: targetingDowngrades.length })}
                    </p>
                    {targetingDowngrades.map((d) => (
                      <div key={d.adSetId} className="text-[11px] text-red-600 flex items-center justify-between gap-2">
                        <span className="truncate">{d.segmentName}</span>
                        {retryResults.get(d.adSetId) === "ok" ? (
                          <span className="text-emerald-600 font-semibold shrink-0">{t("creative.main.step4.restored")}</span>
                        ) : (
                          <button
                            onClick={() => retryOriginalTargeting(d)}
                            disabled={retryingAdSet === d.adSetId}
                            className="shrink-0 font-semibold text-red-700 hover:text-red-800 underline disabled:opacity-50"
                          >
                            {retryingAdSet === d.adSetId ? t("creative.main.step4.retrying") : t("creative.main.step4.retryOriginal")}
                          </button>
                        )}
                      </div>
                    ))}
                    {Array.from(retryResults.values()).includes("failed") && (
                      <p className="text-[10px] text-red-500">{t("creative.main.step4.retryFailed")}</p>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2 justify-center pt-2">
                  <Link href="/campaigns">
                    <Button className="gap-1.5 bg-amber-500 text-amber-950 hover:bg-amber-600 text-sm">
                      {t("creative.main.step4.viewCampaigns")}
                    </Button>
                  </Link>
                  <Button variant="outline" className="gap-1.5 text-sm" onClick={() => {
                    setStep(1);
                    setLaunchSuccess(null);
                    setTargetingDowngrades([]);
                    setRetryResults(new Map());
                    setCreativeResults([]);
                    setCreatives([]);
                  }}>
                    {t("creative.main.step4.newCreative")}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Section A: Campaign Info */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
              <Settings className="h-4 w-4 text-amber-700" /> {t("creative.main.step4.secA")}
            </h3>

            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">{t("creative.main.step4.campaignName")}</label>
              <input
                type="text"
                value={campaignName}
                onChange={e => setCampaignName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-1 block">{t("creative.main.step4.fbObjective")}</label>
                <select
                  value={objective}
                  onChange={e => setObjective(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 focus:border-amber-400 focus:outline-none"
                >
                  {OBJECTIVES.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-1 block">{t("creative.main.step4.company")}</label>
                <div className="flex gap-2">
                  {companyIds().map(c => (
                    <button key={c} onClick={() => setCompany(c)}
                      className={cn(
                        "flex-1 rounded-lg border px-4 py-2.5 text-xs font-semibold transition-all",
                        company === c
                          ? companyActiveClass(c, companyDef(c)?.color)
                          : "border-slate-200 text-slate-500 bg-white"
                      )}
                    >{c}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Fanpage Selector */}
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">{t("creative.main.step4.fanpage")}</label>
              {fbPages.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("creative.main.step4.pagesLoading")}
                </div>
              ) : (
                <div className="space-y-2">
                  {fbPages.map(page => (
                    <button
                      key={page.id}
                      onClick={() => setSelectedPageId(page.id)}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-left transition-all",
                        selectedPageId === page.id
                          ? "border-amber-500 bg-amber-50/50 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      )}
                    >
                      {page.pictureUrl && (
                        <img src={page.pictureUrl} alt="" className="h-8 w-8 rounded-full border border-slate-200" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-700 truncate">{page.name}</p>
                        <p className="text-[10px] text-slate-400">ID: {page.id}</p>
                      </div>
                      {selectedPageId === page.id && (
                        <Check className="h-4 w-4 text-amber-700 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Pixel Picker — hardcoded per company */}
            {(objectiveKey === "OUTCOME_SALES" || objectiveKey === "OUTCOME_LEADS") && (
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-1 block">📊 Facebook Pixel</label>
                <select
                  value={effectivePixelId}
                  onChange={e => setSelectedPixelId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 focus:border-amber-400 focus:outline-none"
                >
                  {pixelOptions().length === 0 && (
                    <option value="">{t("creative.main.step4.pixelNone")}</option>
                  )}
                  {pixelOptions().map(o => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-0.5">{t("creative.main.step4.pixelHint")}</p>
              </div>
            )}

            {/* Loại trừ tệp khách cũ — thứ gần nhất với "Chiến lược vòng đời
                khách hàng" của Ads Manager mà API Meta cho phép. */}
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">{t("creative.main.step4.excludeLabel")}</label>
              {metaAudienceLoading && <p className="text-[11px] text-slate-400">{t("creative.main.step4.audListLoading")}</p>}
              {!metaAudienceLoading && metaAudienceList.length === 0 && (
                <button
                  type="button"
                  onClick={() => fetchMetaAudiences()}
                  className="text-[11px] text-amber-700 underline"
                >
                  {t("creative.main.step4.loadAudList")}
                </button>
              )}
              {metaAudienceList.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {metaAudienceList.map(a => {
                    const on = excludeAudienceIds.has(a.id);
                    const alsoTargeted = selectedMetaAudienceIds.has(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setExcludeAudienceIds(prev => {
                          const next = new Set(prev);
                          if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                          return next;
                        })}
                        className={cn("flex w-full items-center gap-2 px-2.5 py-1.5 text-left", on ? "bg-red-50" : "hover:bg-slate-50")}
                      >
                        <span className={cn("flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                          on ? "border-red-500 bg-red-500" : "border-slate-300")}>
                          {on && <Check className="h-2.5 w-2.5 text-white" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn("block truncate text-xs", on ? "text-red-800 font-medium" : "text-slate-700")}>{a.name}</span>
                          {alsoTargeted && on && (
                            <span className="block text-[10px] text-red-600">{t("creative.main.step4.bothTargetExclude")}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                {t("creative.main.step4.excludeHint")}
              </p>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                {t("creative.main.step4.lifecycle1")}<strong>{t("creative.main.step4.lifecycleNot")}</strong>{t("creative.main.step4.lifecycle2")}
              </p>
            </div>

            {/* Instagram placement toggle */}
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-700">{t("creative.main.step4.igPlacement")}</p>
                <p className="text-[11px] text-slate-400">{t("creative.main.step4.igHint")}</p>
              </div>
              <button
                type="button"
                onClick={() => setIncludeInstagram(v => !v)}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                  includeInstagram ? "bg-amber-500" : "bg-slate-200"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                    includeInstagram ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>

            {/* Advantage+ vs Detailed Targeting toggle */}
            <div className="flex items-center justify-between rounded-lg border border-violet-100 bg-violet-50/40 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-700">🤖 Advantage+ Audience</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {useAdvantageAudience
                    ? t("creative.main.step4.advOn")
                    : t("creative.main.step4.advOff")
                  }
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUseAdvantageAudience(v => !v)}
                className={cn(
                  "ml-3 relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                  useAdvantageAudience ? "bg-violet-600" : "bg-slate-200"
                )}
              >
                <span className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                  useAdvantageAudience ? "translate-x-5" : "translate-x-0"
                )} />
              </button>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">{t("creative.main.step4.destUrl")}</label>
              <div className="space-y-1.5">
                <input
                  type="url"
                  value={destinationUrl}
                  onChange={e => setDestinationUrl(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                  placeholder={isLegacy ? "https://www.matbao.net" : t("creative.main.step4.destUrlPh")}
                />
                {/* UTM Auto-builder toggle */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoUTM}
                    onChange={e => setAutoUTM(e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-amber-500"
                  />
                  <span className="text-[11px] text-slate-500">
                    {t("creative.main.step4.utm")}({autoUTM
                      ? <span className="text-amber-700 font-mono">?utm_source=facebook_ads&utm_medium=cpc_fb&utm_campaign=…&utm_content={"{{ad.id}}"}</span>
                      : <span className="text-slate-400">{t("creative.main.step4.utmOff")}</span>
                    })
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Section A2: Targeting */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
              <Target className="h-4 w-4 text-violet-500" /> {t("creative.main.step4.targeting")}
            </h3>

            <div className="space-y-2">
              {(["standard", "lookalike"] as const).map(tt => (
                <button key={tt} onClick={() => setTargetingType(tt)}
                  className={cn(
                    "w-full flex items-start gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all",
                    targetingType === tt ? "border-violet-400 bg-violet-50/50" : "border-slate-200 bg-white hover:border-slate-300"
                  )}>
                  <div className={cn("mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0",
                    targetingType === tt ? "border-violet-500" : "border-slate-300")}>
                    {targetingType === tt && <div className="h-2 w-2 rounded-full bg-violet-500" />}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-700">
                      {tt === "standard" ? t("creative.main.step4.tgStd") : t("creative.main.step4.tgLal")}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {tt === "standard" ? t("creative.main.step4.tgStdHint") : t("creative.main.step4.tgLalHint")}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            {targetingType === "lookalike" && (
              <div className="ml-7 space-y-2">
                {audiences.length > 0 ? (
                  <select
                    value={selectedAudienceId}
                    onChange={e => setSelectedAudienceId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 focus:border-violet-400 focus:outline-none"
                  >
                    <option value="">{t("creative.main.step4.pickAudience")}</option>
                    {audiences.map(a => (
                      <option key={a.id} value={a.fb_audience_id}>
                        ✨ {a.name} ({a.size >= 1000000 ? `≈${(a.size / 1000000).toFixed(1)}M` : a.size >= 1000 ? `≈${(a.size / 1000).toFixed(0)}K` : a.size} {t("creative.main.step4.people")})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
                    <p className="text-xs text-amber-700">{t("creative.main.step4.noLal")}</p>
                    {/* Trang Audiences đang tạm ẩn thì bỏ luôn lối tắt này —
                        một cái nút bấm vào bị đá về Dashboard còn khó hiểu hơn
                        là không có nút. */}
                    {!isHiddenPage("/audiences") && (
                      <a href="/audiences" className="text-xs text-amber-700 font-semibold hover:underline mt-1 inline-block">
                        {t("creative.main.step4.createNow")}
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section B: Budget & Schedule */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-500" /> {t("creative.main.step4.secB")}
            </h3>

            {/* Budget Type: CBO / ABO */}
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-2 block">{t("creative.main.step4.budgetType")}</label>
              <div className="flex gap-3">
                <button onClick={() => setBudgetType("cbo")}
                  className={cn("flex-1 rounded-xl border-2 p-4 text-left transition-all",
                    budgetType === "cbo" ? "border-amber-500 bg-amber-50/50" : "border-slate-200"
                  )}
                >
                  <p className="text-xs font-bold text-slate-700">{t("creative.main.step4.cbo")}</p>
                  <p className="text-[10px] text-slate-400">{t("creative.main.step4.cboHint")}</p>
                  {budgetType === "cbo" && (
                    <div className="mt-3">
                      <label className="text-[10px] text-slate-500">{t("creative.main.step4.cboTotal")}</label>
                      <input type="number" value={dailyBudget} onChange={e => setDailyBudget(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mt-1" step={50000} min={40000}
                      />
                    </div>
                  )}
                </button>
                <button onClick={() => setBudgetType("adset")}
                  className={cn("flex-1 rounded-xl border-2 p-4 text-left transition-all",
                    budgetType === "adset" ? "border-amber-500 bg-amber-50/50" : "border-slate-200"
                  )}
                >
                  <p className="text-xs font-bold text-slate-700">{t("creative.main.step4.abo")}</p>
                  <p className="text-[10px] text-slate-400">{t("creative.main.step4.aboHint")}</p>
                  {budgetType === "adset" && (
                    <div className="mt-3">
                      <label className="text-[10px] text-slate-500">{t("creative.main.step4.aboEach")}</label>
                      <input type="number" value={adsetBudget} onChange={e => setAdsetBudget(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mt-1" step={50000} min={40000}
                      />
                    </div>
                  )}
                </button>
              </div>
            </div>


            {/* Bid Strategy */}
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-2 block">{t("creative.main.step4.bidStrategy")}</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { key: "LOWEST_COST_WITHOUT_CAP", labelKey: "creative.main.step4.bidAuto", descKey: "creative.main.step4.bidAutoDesc", icon: "⚡" },
                  { key: "COST_CAP", labelKey: "creative.main.step4.bidCostCap", descKey: "creative.main.step4.bidCostCapDesc", icon: "🎯" },
                  { key: "BID_CAP", labelKey: "creative.main.step4.bidCap", descKey: "creative.main.step4.bidCapDesc", icon: "🔒" },
                ] as const).map(s => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setBidStrategy(s.key)}
                    className={cn("rounded-xl border-2 p-3 text-left transition-all",
                      bidStrategy === s.key ? "border-green-500 bg-green-50/50" : "border-slate-200 hover:border-slate-300"
                    )}
                  >
                    <p className="text-xs font-semibold text-slate-700">{s.icon} {t(s.labelKey)}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{t(s.descKey)}</p>
                  </button>
                ))}
              </div>
              {bidStrategy !== "LOWEST_COST_WITHOUT_CAP" && (
                <div className="mt-3">
                  <label className="text-[10px] font-semibold text-slate-500">
                    {bidStrategy === "COST_CAP" ? t("creative.main.step4.maxCpr") : t("creative.main.step4.maxBid")}
                  </label>
                  <input
                    type="number"
                    value={bidAmount}
                    onChange={e => setBidAmount(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mt-1 focus:border-green-400 focus:outline-none"
                    step={10000} min={10000}
                    placeholder={bidStrategy === "COST_CAP" ? t("creative.main.step4.cprPh") : t("creative.main.step4.bidPh")}
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {bidStrategy === "COST_CAP"
                      ? t("creative.main.step4.cprNote")
                      : t("creative.main.step4.bidNote")
                    }
                  </p>
                </div>
              )}
            </div>

            {/* Schedule */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-1 block">{t("creative.main.step4.startDate")}</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-1 block">{t("creative.main.step4.runTime")}</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input type="radio" checked={continuous} onChange={() => { setContinuous(true); setEndDate(""); }} className="accent-amber-500" />
                    {t("creative.main.step4.continuous")}
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input type="radio" checked={!continuous} onChange={() => setContinuous(false)} className="accent-amber-500" />
                    {t("creative.main.step4.hasEnd")}
                  </label>
                  {!continuous && (
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Section C: Campaign Structure Preview */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <FolderTree className="h-4 w-4 text-violet-500" /> {t("creative.main.step4.secC")}
              </h3>
              <div className="flex items-center gap-2">
                {/* DCO Toggle */}
                <button
                  type="button"
                  onClick={() => { setEnableDCO(v => !v); if (!enableDCO) setAbTestMode(false); }}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-all",
                    enableDCO
                      ? "border-orange-300 bg-orange-50 text-orange-700"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                  )}
                  title={t("creative.main.step4.dcoTitle")}
                >
                  <span className={cn(
                    "relative inline-flex h-4 w-7 shrink-0 rounded-full border border-transparent transition-colors",
                    enableDCO ? "bg-orange-500" : "bg-slate-300"
                  )}>
                    <span className={cn(
                      "inline-block h-3.5 w-3.5 translate-y-0 transform rounded-full bg-white shadow transition",
                      enableDCO ? "translate-x-3" : "translate-x-0"
                    )} />
                  </span>
                  {t("creative.main.step4.dco")}
                </button>
                {/* A/B Test Toggle */}
                <button
                  type="button"
                  onClick={() => { setAbTestMode(v => !v); if (!abTestMode) setEnableDCO(false); }}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-all",
                    abTestMode
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                  )}
                  title={t("creative.main.step4.abTitle")}
                >
                  <span className={cn(
                    "relative inline-flex h-4 w-7 shrink-0 rounded-full border border-transparent transition-colors",
                    abTestMode ? "bg-indigo-500" : "bg-slate-300"
                  )}>
                    <span className={cn(
                      "inline-block h-3.5 w-3.5 translate-y-0 transform rounded-full bg-white shadow transition",
                      abTestMode ? "translate-x-3" : "translate-x-0"
                    )} />
                  </span>
                  {t("creative.main.step4.abTest")}
                </button>
              </div>
            </div>
            {enableDCO && (
              <p className="text-[11px] text-orange-600 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
                💡 <b>{t("creative.main.step4.dcoOnBold")}</b>{t("creative.main.step4.dcoOn")}
              </p>
            )}
            {abTestMode && (
              <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 space-y-3">
                <p className="text-[11px] text-indigo-700 font-semibold">
                  🧪 <b>{t("creative.main.step4.abModeBold")}</b>{t("creative.main.step4.abMode1")}<b>[Variant A]</b>{t("creative.main.step4.abMode2")}<b>[Variant B]</b>{t("creative.main.step4.abMode3")}
                </p>
                {creativeResults.filter(c => c.selected).length === 0 ? (
                  <p className="text-[11px] text-slate-500">{t("creative.main.step4.noCreativeSelected")}</p>
                ) : (
                  <div className="space-y-2">
                    {creativeResults.map((cr, idx) => {
                      if (!cr.selected) return null;
                      const variant = abTestVariants[idx] ?? "A";
                      return (
                        <div key={idx} className="flex items-center justify-between gap-2 rounded-lg bg-white border border-indigo-100 px-3 py-2">
                          <span className="text-[11px] text-slate-700 truncate flex-1">{cr.headline || cr.toneLabel || cr.segmentName}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => setAbTestVariants(prev => ({ ...prev, [idx]: "A" }))}
                              className={cn("rounded px-2 py-0.5 text-[10px] font-bold transition-colors",
                                variant === "A" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-indigo-100")}
                            >A</button>
                            <button
                              onClick={() => setAbTestVariants(prev => ({ ...prev, [idx]: "B" }))}
                              className={cn("rounded px-2 py-0.5 text-[10px] font-bold transition-colors",
                                variant === "B" ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-violet-100")}
                            >B</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <PlaybookSuggestPanel
              company={company}
              product={selectedProduct}
              segmentIndices={selectedSegments}
              getSegmentAge={(idx) => {
                const e = editedDemographicsMap.get(idx);
                return e ? { ageMin: e.ageMin, ageMax: e.ageMax } : null;
              }}
              applyAge={(idx, ageMin, ageMax) => {
                const seg = audienceData?.audienceSegments[idx];
                setEditedDemographicsMap(prev => {
                  const next = new Map(prev);
                  next.set(idx, { ageMin, ageMax, locations: prev.get(idx)?.locations ?? seg?.demographics.location ?? [] });
                  return next;
                });
              }}
              undoAge={(idx) => setEditedDemographicsMap(prev => { const next = new Map(prev); next.delete(idx); return next; })}
              getSegmentInterestIds={(idx) => (editedInterestsMap.get(idx) ?? resolvedInterestsMap.get(idx) ?? []).map(r => r.id)}
              appendInterests={(idx, interests) => {
                setEditedInterestsMap(prev => {
                  const next = new Map(prev);
                  const current = next.get(idx) ?? resolvedInterestsMap.get(idx) ?? [];
                  next.set(idx, [...current, ...interests.map(i => ({ originalName: i.name, id: i.id, name: i.name }))]);
                  return next;
                });
              }}
              removeInterests={(idx, ids) => {
                setEditedInterestsMap(prev => {
                  const next = new Map(prev);
                  const current = next.get(idx) ?? resolvedInterestsMap.get(idx) ?? [];
                  next.set(idx, current.filter(r => !ids.includes(r.id)));
                  return next;
                });
              }}
              pixelId={effectivePixelId}
              conversionEvent={conversionEvent}
              onSetConversionEvent={setConversionEvent}
              onStateChange={(s) => { playbookStateRef.current = s; }}
              interestsReady={!resolvingInterests}
              resetKey={resolvedInterestsMap}
            />

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-slate-700 space-y-2">
              <div className="flex items-center gap-1.5">
                <span className="text-amber-700">📁</span>
                <b>{campaignName}</b>
                {budgetType === "cbo" && <span className="text-amber-700 ml-2">{t("creative.main.step4.cboTag", { amount: dailyBudget.toLocaleString(intlLocale) })}</span>}
              </div>
              {audienceData?.audienceSegments
                .filter((_, i) => selectedSegments.includes(i))
                .map((seg, si) => {
                  const segCreatives = creativeResults.filter(c => c.segmentName === seg.segmentName && c.selected);
                  const isLast = si === selectedSegments.length - 1;
                  const perAdSetBudget = budgetType === "cbo"
                    ? Math.floor(dailyBudget / selectedSegments.length)
                    : adsetBudget;
                  return (
                    <div key={si} className="ml-4 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span>{isLast ? "└──" : "├──"}</span>
                        <span className="text-violet-500">📂</span>
                        <span>AdSet: <b>{
                          (seg.funnelStage ?? "TOFU") === "TOFU" ? t("creative.main.step2.stageTofu") :
                          seg.funnelStage === "MOFU" ? t("creative.main.step2.stageMofu") :
                          seg.funnelStage === "BOFU" ? t("creative.main.step2.stageBofu") : seg.funnelStage
                        }</b> - {seg.segmentName}</span>
                        <span className="text-emerald-600 ml-1">[₫{perAdSetBudget.toLocaleString(intlLocale)}{t("creative.main.common.perDay")}]</span>
                      </div>
                      <div className="ml-6 text-[11px] text-slate-500 space-y-0.5">
                        {(() => {
                          const demoSegIdx = audienceData?.audienceSegments.indexOf(seg) ?? -1;
                          const editedDemo = editedDemographicsMap.get(demoSegIdx);
                          const effLocs = editedDemo?.locations?.length ? editedDemo.locations : seg.demographics.location;
                          const effAge = editedDemo ? `${editedDemo.ageMin}-${editedDemo.ageMax}` : seg.demographics.age;
                          const VN_CITIES = ["Hà Nội", "TP.HCM", "Đà Nẵng", "Hải Phòng", "Cần Thơ", "Bình Dương", "Đồng Nai", "Nha Trang", "Vũng Tàu", "Toàn quốc"];
                          if (editingDemographicsFor === demoSegIdx) {
                            return (
                              <div className="border border-amber-200 rounded-lg p-2 bg-amber-50/40 space-y-1.5 mt-0.5 font-sans">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] text-slate-500 w-10">{t("creative.main.step4.ageColon")}</span>
                                  <input type="number" min={13} max={65} value={draftAgeMin}
                                    onChange={e => setDraftAgeMin(+e.target.value)}
                                    className="w-12 text-[10px] border border-slate-200 rounded px-1 py-0.5 text-center bg-white" />
                                  <span className="text-[10px] text-slate-400">–</span>
                                  <input type="number" min={13} max={65} value={draftAgeMax}
                                    onChange={e => setDraftAgeMax(+e.target.value)}
                                    className="w-12 text-[10px] border border-slate-200 rounded px-1 py-0.5 text-center bg-white" />
                                </div>
                                <div className="space-y-0.5">
                                  <span className="text-[10px] text-slate-500">{t("creative.main.step4.locColon")}</span>
                                  <div className="flex flex-wrap gap-1">
                                    {VN_CITIES.map(city => (
                                      <button key={city} type="button"
                                        onClick={() => setDraftLocations(prev =>
                                          prev.includes(city) ? prev.filter(c => c !== city) : [...prev, city]
                                        )}
                                        className={cn("text-[9px] px-1.5 py-0.5 rounded-full border transition-colors",
                                          draftLocations.includes(city)
                                            ? "bg-amber-500 text-amber-950 border-amber-500"
                                            : "bg-white text-slate-600 border-slate-200 hover:border-amber-300"
                                        )}>
                                        {city}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <button type="button"
                                    onClick={() => {
                                      setEditedDemographicsMap(prev => {
                                        const next = new Map(prev);
                                        next.set(demoSegIdx, {
                                          ageMin: draftAgeMin, ageMax: draftAgeMax,
                                          locations: draftLocations.length > 0 ? draftLocations : seg.demographics.location,
                                        });
                                        return next;
                                      });
                                      setEditingDemographicsFor(null);
                                    }}
                                    className="text-[10px] bg-amber-500 text-amber-950 px-2 py-0.5 rounded hover:bg-amber-500">
                                    {t("creative.main.common.save")}
                                  </button>
                                  <button type="button" onClick={() => setEditingDemographicsFor(null)}
                                    className="text-[10px] text-slate-400 hover:text-slate-600 px-1 py-0.5">
                                    {t("creative.main.common.cancel")}
                                  </button>
                                  {editedDemo && (
                                    <button type="button"
                                      onClick={() => {
                                        setEditedDemographicsMap(prev => { const next = new Map(prev); next.delete(demoSegIdx); return next; });
                                        setEditingDemographicsFor(null);
                                      }}
                                      className="text-[10px] text-red-400 hover:text-red-600 px-1 py-0.5 ml-auto">
                                      {t("creative.main.step4.reset")}
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div className="flex items-center gap-1 flex-wrap">
                              <span>📍 {effLocs.join(", ")} · 👥 {effAge} · {seg.demographics.gender}</span>
                              {editedDemo && <span className="text-[9px] text-amber-700">{t("creative.main.step4.edited")}</span>}
                              <button type="button"
                                onClick={() => {
                                  const ageRange = editedDemo
                                    ? { min: editedDemo.ageMin, max: editedDemo.ageMax }
                                    : parseAgeRange(seg.demographics.age);
                                  setDraftAgeMin(ageRange.min);
                                  setDraftAgeMax(ageRange.max);
                                  setDraftLocations(editedDemo?.locations ?? seg.demographics.location);
                                  setEditingDemographicsFor(demoSegIdx);
                                }}
                                className="text-[9px] text-amber-600 hover:text-amber-700 border border-amber-200 rounded px-1 py-0.5 hover:border-amber-400 ml-0.5">
                                ✏️
                              </button>
                            </div>
                          );
                        })()}
                        {/* Reach estimate */}
                        {(() => {
                          const segIdx2 = audienceData?.audienceSegments.indexOf(seg) ?? -1;
                          const est = reachEstimates.get(segIdx2);
                          if (!est) return null;
                          if (est.lower === null) return null;
                          return (
                            <div className="text-[10px] text-amber-700 font-medium">
                              {t("creative.main.step4.reach", { from: formatReach(est.lower), to: formatReach(est.upper ?? undefined) })}
                            </div>
                          );
                        })()}
                        {/* Editable interests targeting */}
                        {(() => {
                          const segIdx = audienceData?.audienceSegments.indexOf(seg) ?? -1;
                          const rawInterests = seg.facebookTargeting?.interests ?? seg.psychographics?.interests ?? [];
                          const edited = editedInterestsMap.get(segIdx);

                          if (resolvingInterests && rawInterests.length > 0) {
                            return (
                              <div className="flex items-center gap-1 text-slate-400">
                                <span className="inline-block animate-spin text-[10px]">⏳</span>
                                <span>{t("creative.main.step4.checkingInterests", { n: rawInterests.length })}</span>
                              </div>
                            );
                          }

                          return (
                            <div className="space-y-1 mt-1">
                              <div className="text-[10px] font-semibold text-slate-500">{t("creative.main.step4.detailedTargeting")}</div>
                              {/* Chips for resolved interests */}
                              <div className="flex flex-wrap gap-1">
                                {(edited ?? []).map(r => (
                                  <span
                                    key={r.id}
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]",
                                      r.ambiguous
                                        ? "bg-amber-50 border-amber-300 text-amber-800"
                                        : "bg-emerald-50 border-emerald-200 text-emerald-700",
                                    )}
                                    title={[
                                      r.originalName && r.originalName !== r.name
                                        ? t("creative.main.step4.chipMatched", { original: r.originalName, name: r.name })
                                        : t("creative.main.step4.chipMeta", { name: r.name }),
                                      r.ambiguous
                                        ? t("creative.main.step4.chipAmbiguous")
                                        : "",
                                    ].filter(Boolean).join(" · ")}
                                  >
                                    {/* Hiện CẢ tên AI đề xuất lẫn tên Meta khớp về khi hai tên khác
                                        nhau. Trước đây chip chỉ hiện tên Meta, nên một đề xuất bị
                                        bộ resolve kéo sang hạng mục khác trông y như đề xuất gốc —
                                        không ai phát hiện được lệch trước khi launch. */}
                                    {r.originalName && r.originalName !== r.name && (
                                      <span className="text-emerald-400 line-through decoration-emerald-300">
                                        {r.originalName}
                                      </span>
                                    )}
                                    {r.name}
                                    {r.ambiguous && <span title={t("creative.main.step4.chipAmbiguousShort")}>⚠</span>}
                                    {/* A3 — số ĐÃ ĐO ĐƯỢC của chính tài khoản này.
                                        Chỉ hiện khi có báo cáo; không có thì không
                                        hiện gì, KHÔNG hiện "0đ" (0đ đọc thành "rẻ",
                                        trong khi sự thật là "chưa từng chạy"). */}
                                    {(() => {
                                      const perf = interestPerf.get(r.id);
                                      if (!perf) return null;
                                      return (
                                        <span
                                          className="text-[9px] text-slate-500 border-l border-slate-300 pl-1 ml-0.5"
                                          title={[
                                            t("creative.main.step4.perfUsed", { n: perf.adSetCount, spend: perf.spend.toLocaleString(intlLocale), conv: perf.conversions }),
                                            t("creative.main.step4.perfSplit"),
                                            (perf.coOccurringWith ?? 0) > 0
                                              ? t("creative.main.step4.perfCo", { n: perf.coOccurringWith ?? 0 })
                                              : "",
                                          ].filter(Boolean).join(" ")}
                                        >
                                          {perf.cpl !== null
                                            ? `CPL ~${Math.round(perf.cpl / 1000)}k`
                                            : t("creative.main.step4.perfNoResult", { spend: (perf.spend / 1000).toFixed(0) })}
                                          {(perf.coOccurringWith ?? 0) > 0 && "*"}
                                        </span>
                                      );
                                    })()}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditedInterestsMap(prev => {
                                          const next = new Map(prev);
                                          next.set(segIdx, (prev.get(segIdx) ?? []).filter(x => x.id !== r.id));
                                          return next;
                                        });
                                      }}
                                      className="text-emerald-400 hover:text-red-500 font-bold leading-none"
                                    >×</button>
                                  </span>
                                ))}
                                {(!edited || edited.length === 0) && (
                                  <span className="text-[10px] text-amber-500">{t("creative.main.step4.noInterest")}</span>
                                )}
                              </div>
                              {(invalidInterestsMap.get(segIdx)?.length ?? 0) > 0 && (
                                <p className="text-[10px] text-red-500">
                                  {t("creative.main.step4.invalidInterests", { n: invalidInterestsMap.get(segIdx)!.length, list: invalidInterestsMap.get(segIdx)!.join(", ") })}
                                </p>
                              )}
                              {/* Autocomplete interest input */}
                              <div className="relative mt-1">
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={newInterestInput[segIdx] ?? ""}
                                    onChange={e => {
                                      const val = e.target.value;
                                      setNewInterestInput(prev => ({ ...prev, [segIdx]: val }));
                                      // Debounced autocomplete search
                                      if (interestSearchTimer.current) clearTimeout(interestSearchTimer.current);
                                      if (val.trim().length >= 2) {
                                        interestSearchTimer.current = setTimeout(async () => {
                                          try {
                                            const res = await fetch(`/api/creative/search-interests?q=${encodeURIComponent(val.trim())}`);
                                            const data = await res.json() as { results?: Array<{ id: string; name: string; path?: string[] }> };
                                            setInterestSuggestions(data.results ?? []);
                                            setShowSuggestionsFor(segIdx);
                                          } catch { /* ignore */ }
                                        }, 400);
                                      } else {
                                        setInterestSuggestions([]);
                                        setShowSuggestionsFor(null);
                                      }
                                    }}
                                    onKeyDown={e => {
                                      if (e.key === "Escape") {
                                        setShowSuggestionsFor(null);
                                        setInterestSuggestions([]);
                                      }
                                    }}
                                    onBlur={() => setTimeout(() => setShowSuggestionsFor(null), 200)}
                                    placeholder={t("creative.main.step4.searchInterestPh")}
                                    className="flex-1 rounded border border-dashed border-amber-200 bg-white px-2 py-1 text-[10px] placeholder:text-slate-300 focus:border-amber-400 focus:outline-none"
                                  />
                                  {addingInterestIdx === segIdx && (
                                    <span className="text-[10px] text-slate-400">⏳</span>
                                  )}
                                </div>
                                {/* Suggestions dropdown */}
                                {showSuggestionsFor === segIdx && interestSuggestions.length === 0 && (newInterestInput[segIdx]?.trim().length ?? 0) >= 2 && (
                                  <div className="absolute z-50 left-0 right-0 top-full mt-0.5 rounded-lg border border-slate-200 bg-white shadow-lg px-2 py-1.5 text-[10px] text-slate-400">
                                    {t("creative.main.step4.noMetaResult")}
                                  </div>
                                )}
                                {showSuggestionsFor === segIdx && interestSuggestions.length > 0 && (
                                  <div className="absolute z-50 left-0 right-0 top-full mt-0.5 rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
                                    {interestSuggestions.map(s => (
                                      <button
                                        key={s.id}
                                        type="button"
                                        onMouseDown={e => {
                                          e.preventDefault();
                                          // Add to edited map
                                          setEditedInterestsMap(prev => {
                                            const next = new Map(prev);
                                            const existing = prev.get(segIdx) ?? [];
                                            if (!existing.some(x => x.id === s.id)) {
                                              next.set(segIdx, [...existing, { originalName: s.name, id: s.id, name: s.name }]);
                                            }
                                            return next;
                                          });
                                          setNewInterestInput(prev => ({ ...prev, [segIdx]: "" }));
                                          setInterestSuggestions([]);
                                          setShowSuggestionsFor(null);
                                        }}
                                        className="w-full text-left px-3 py-2 text-[11px] hover:bg-amber-50 flex flex-col border-b border-slate-50 last:border-0"
                                      >
                                        <span className="font-medium text-slate-800">{s.name}</span>
                                        {s.path && s.path.length > 0 && (
                                          <span className="text-[9px] text-slate-400">{s.path.join(" › ")}</span>
                                        )}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {showSuggestionsFor === segIdx && (newInterestInput[segIdx] ?? "").trim().length >= 2 && interestSuggestions.length === 0 && (
                                  <div className="absolute z-50 left-0 right-0 top-full mt-0.5 rounded-lg border border-slate-200 bg-white shadow-sm px-3 py-2 text-[10px] text-slate-400">
                                    {t("creative.main.step4.noInterestFound")}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                        {(seg.facebookTargeting?.behaviors ?? seg.psychographics?.behaviors ?? []).length > 0 && (
                          <div className="text-slate-400 text-[10px] mt-0.5">🎯 {(seg.facebookTargeting?.behaviors ?? seg.psychographics?.behaviors ?? []).slice(0, 3).join(", ")}</div>
                        )}
                      </div>
                      {segCreatives.map((c, ci) => (
                        <div key={ci} className="ml-6 flex items-center gap-1.5">
                          <span>{ci < segCreatives.length - 1 ? "├──" : "└──"}</span>
                          <span className="text-green-500">📄</span>
                          <span>{t("creative.main.step4.adVersion", { label: c.toneLabel })}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              <div className="mt-3 pt-3 border-t border-slate-200 text-slate-600">
                {t("creative.main.step4.total", { sets: selectedSegments.length, ads: selectedCreativeCount })}
                {budgetType === "cbo"
                  ? t("creative.main.step4.totalCbo", { amount: dailyBudget.toLocaleString(intlLocale) })
                  : t("creative.main.step4.totalAbo", { amount: adsetBudget.toLocaleString(intlLocale) })}
                {` · ${startDate}`}{continuous ? t("creative.main.step4.arrowContinuous") : ` → ${endDate || "?"}`}
              </div>
            </div>
          </div>

          {/* Section D: Review & Confirm — OR — Post-Launch Approve */}
          {launchSuccess ? (
            <div className="rounded-xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50/60 to-white p-6 shadow-sm space-y-5">
              <div className="text-center space-y-2">
                <CheckCircle className="h-10 w-10 text-emerald-500 mx-auto" />
                <h3 className="text-lg font-bold text-slate-800">{t("creative.main.step4.createdOk")}</h3>
                <p className="text-sm text-slate-600">{campaignName}</p>
                <p className="text-xs text-slate-500">
                  {t("creative.main.step4.statusLine", { sets: launchSuccess.adSetCount, ads: launchSuccess.adCount })}{" "}
                  <b>{launchSuccess.launchActive ? t("creative.main.step4.liveReal") : t("creative.main.step4.paused")}</b>
                </p>
              </div>

              {launchSuccess.launchActive ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                  <p className="text-xs text-red-700">
                    🔴 {t("creative.main.step4.liveNote1")}<b>{t("creative.main.step4.liveReal")}</b>{t("creative.main.step4.liveNote2")}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-xs text-amber-700">
                    ⚠️ {t("creative.main.step4.pausedNote1")}<b>{t("creative.main.step4.paused")}</b>{t("creative.main.step4.pausedNote2")}
                  </p>
                </div>
              )}

              {targetingDowngrades.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left space-y-2">
                  <p className="text-xs font-bold text-red-700">
                    {t("creative.main.step4.downgrades", { n: targetingDowngrades.length })}{t("creative.main.step4.downgradesCheck")}
                  </p>
                  {targetingDowngrades.map((d) => (
                    <div key={d.adSetId} className="text-[11px] text-red-600 flex items-center justify-between gap-2">
                      <span className="truncate">{d.segmentName} — {d.reason}</span>
                      {retryResults.get(d.adSetId) === "ok" ? (
                        <span className="text-emerald-600 font-semibold shrink-0">{t("creative.main.step4.restored")}</span>
                      ) : (
                        <button
                          onClick={() => retryOriginalTargeting(d)}
                          disabled={retryingAdSet === d.adSetId}
                          className="shrink-0 font-semibold text-red-700 hover:text-red-800 underline disabled:opacity-50"
                        >
                          {retryingAdSet === d.adSetId ? t("creative.main.step4.retrying") : t("creative.main.step4.retryOriginal")}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-center gap-3 pt-2 flex-wrap">
                <Button
                  variant="outline"
                  className="gap-1.5 text-xs px-4"
                  onClick={() => window.location.href = "/creative"}
                >
                  <Sparkles className="h-3.5 w-3.5" /> {t("creative.main.step4.newCampaign")}
                </Button>
                <Button
                  variant="outline"
                  className="gap-1.5 text-xs px-4"
                  onClick={() => router.push("/campaigns")}
                >
                  {launchSuccess.launchActive ? t("creative.main.step4.toCampaigns") : t("creative.main.step4.keepDraft")}
                </Button>
                {!launchSuccess.launchActive && (
                  <Button
                    onClick={async () => {
                      try {
                        const res = await fetch("/api/creative/toggle-campaign", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ campaignId: launchSuccess.campaignId, status: "ACTIVE" }),
                        });
                        const data = await res.json();
                        if (data.success) {
                          // toggle-campaign giờ tự bật cả Ad Set + Ad bên dưới (không
                          // chỉ Campaign) — báo đúng số đã bật, và nói rõ nếu có phần
                          // lỗi thay vì khẳng định "đang chạy" trong khi có thể chưa.
                          const parts = [t("creative.main.step4.nAdSet", { n: data.adSetsActivated ?? 0 }), t("creative.main.step4.nAd", { n: data.adsActivated ?? 0 })];
                          if (data.cascadeErrors?.length) {
                            alert(`${t("creative.main.step4.cascadeErr", { parts: parts.join(", "), n: data.cascadeErrors.length })}\n${data.cascadeErrors.join("\n")}\n\n${t("creative.main.step4.cascadeErrCheck")}`);
                          } else {
                            alert(t("creative.main.step4.activated", { parts: parts.join(", ") }));
                          }
                          router.push("/campaigns");
                        } else {
                          alert(t("creative.main.step4.activateErr", { error: data.error }));
                        }
                      } catch (err) {
                        alert(t("creative.main.step4.connErr", { error: err instanceof Error ? err.message : t("creative.main.err.unknownShort") }));
                      }
                    }}
                    className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-2.5 text-sm font-bold text-white hover:from-emerald-700 hover:to-teal-700 shadow-lg"
                  >
                    <Rocket className="h-4 w-4" /> {t("creative.main.step4.activateNow")}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border-2 border-amber-200 bg-gradient-to-br from-amber-50/60 to-white p-6 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-amber-700" /> {t("creative.main.step4.secD")}
              </h3>

              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">{t("creative.main.step4.lblCampaign")}</span>
                  <span className="font-bold text-slate-800">{campaignName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">{t("creative.main.step4.lblObjective")}</span>
                  <span className="font-semibold text-slate-700">{objectiveKey}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">{t("creative.main.step4.lblAdSets")}</span>
                  <span className="font-semibold text-slate-700">{selectedSegments.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">{t("creative.main.step4.lblAds")}</span>
                  <span className="font-semibold text-slate-700">{selectedCreativeCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">{t("creative.main.step4.lblBudget")}</span>
                  <span className="font-semibold text-slate-700">
                    {budgetType === "cbo"
                      ? t("creative.main.step4.budgetCbo", { amount: dailyBudget.toLocaleString(intlLocale) })
                      : t("creative.main.step4.budgetAbo", { amount: adsetBudget.toLocaleString(intlLocale) })}
                  </span>
                </div>
                {selectedSegments.length > 1 && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t("creative.main.step4.lblBudgetPerSet")}</span>
                    <span className="font-semibold text-slate-700">
                      ≈ ₫{Math.round(
                        budgetType === "cbo"
                          ? dailyBudget / selectedSegments.length
                          : adsetBudget
                      ).toLocaleString(intlLocale)}{t("creative.main.common.perDay")}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">{t("creative.main.step4.lblTime")}</span>
                  <span className="font-semibold text-slate-700">
                    {startDate}{continuous ? t("creative.main.step4.arrowContinuous") : ` → ${endDate || "?"}`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">{t("creative.main.step4.lblStatus")}</span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">DRAFT ⏸</span>
                </div>

                {/* Per-segment ad breakdown */}
                {selectedSegments.length > 1 && audienceData && (
                  <div className="pt-2 mt-2 border-t border-slate-100 space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("creative.main.step4.perAdSet")}</p>
                    {audienceData.audienceSegments
                      .filter((_, i) => selectedSegments.includes(i))
                      .map((seg, idx) => {
                         const existingPostCount = creativeResults.filter(c => c.selected && (c.isExistingPost || c.segmentName === "Bài đã đăng")).length;
                        const segAds = creativeResults.filter(c => c.segmentName === seg.segmentName && c.selected).length + existingPostCount;
                        return (
                          <div key={idx} className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-1.5">
                            <span className="flex items-center gap-1.5">
                              <span className="rounded-full bg-amber-500 text-amber-950 text-[9px] font-bold w-4 h-4 flex items-center justify-center">{idx + 1}</span>
                              {seg.segmentName}
                            </span>
                            <span className="text-slate-400">{segAds !== 1 ? t("creative.main.step4.adsPlural", { n: segAds }) : t("creative.main.step4.adSingular", { n: segAds })}</span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* ── Campaign Health Score ── */}
              {(() => {
                const selCreatives = creativeResults.filter(c => c.selected);
                const avgCreativeScore = selCreatives.length > 0
                  ? selCreatives.reduce((sum, c) => sum + (c.score ?? 50), 0) / selCreatives.length
                  : 0;
                const creativeComponent = Math.round((avgCreativeScore / 100) * 40);
                const audienceComponent = selectedSegments.length > 0 ? 20 : 0;
                const budgetVal = budgetType === "cbo" ? dailyBudget : adsetBudget;
                const budgetComponent = budgetVal >= 500000 ? 20 : budgetVal >= 200000 ? 14 : budgetVal >= 100000 ? 8 : 4;
                const hasInterests = Array.from(editedInterestsMap.values()).some(a => a.length > 0) ||
                  Array.from(resolvedInterestsMap.values()).some(a => a.length > 0);
                const targetingComponent = useAdvantageAudience ? 20 : hasInterests ? 20 : selectedSegments.length > 0 ? 10 : 0;
                const healthScore = creativeComponent + audienceComponent + budgetComponent + targetingComponent;
                const healthLabel = healthScore >= 85 ? { text: t("creative.main.step4.hExcellent"), color: "text-emerald-700", bar: "bg-emerald-500", bg: "bg-emerald-50 border-emerald-200" }
                  : healthScore >= 65 ? { text: t("creative.main.step4.hGood"), color: "text-amber-800", bar: "bg-amber-500", bg: "bg-amber-50 border-amber-200" }
                  : healthScore >= 40 ? { text: t("creative.main.step4.hNeeds"), color: "text-amber-700", bar: "bg-amber-400", bg: "bg-amber-50 border-amber-200" }
                  : { text: t("creative.main.step4.hNotReady"), color: "text-red-700", bar: "bg-red-400", bg: "bg-red-50 border-red-200" };
                const checks = [
                  { label: t("creative.main.step4.chkCreatives"), ok: selCreatives.length > 0, detail: selCreatives.length > 0 ? t("creative.main.step4.chkCreativesDetail", { n: selCreatives.length, score: Math.round(avgCreativeScore) }) : t("creative.main.step4.chkCreativesNone") },
                  { label: t("creative.main.step4.chkSegments"), ok: selectedSegments.length > 0, detail: selectedSegments.length > 0 ? t("creative.main.step4.chkSegmentsDetail", { n: selectedSegments.length }) : t("creative.main.step4.chkSegmentsNone") },
                  { label: t("creative.main.step4.chkBudget"), ok: budgetVal >= 200000, detail: budgetVal >= 200000 ? `₫${budgetVal.toLocaleString(intlLocale)}${t("creative.main.common.perDay")}` : t("creative.main.step4.chkBudgetLow") },
                  { label: t("creative.main.step4.chkTargeting"), ok: useAdvantageAudience || hasInterests, detail: useAdvantageAudience ? "Advantage+ AI" : hasInterests ? t("creative.main.step4.chkTargetingInterests") : t("creative.main.step4.chkTargetingNone") },
                  { label: t("creative.main.step4.chkPage"), ok: !!selectedPageId, detail: selectedPageId ? (fbPages.find(p => p.id === selectedPageId)?.name ?? selectedPageId) : t("creative.main.step4.chkPageNone") },
                ];
                return (
                  <div className={`rounded-lg border p-4 space-y-3 ${healthLabel.bg}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-bold ${healthLabel.color}`}>{t("creative.main.step4.readiness")}</span>
                      <span className={`text-lg font-black ${healthLabel.color}`}>{healthScore}/100 · {healthLabel.text}</span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-white/60 overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-700 ${healthLabel.bar}`} style={{ width: `${healthScore}%` }} />
                    </div>
                    <div className="grid grid-cols-1 gap-1">
                      {checks.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-[11px]">
                          <span>{c.ok ? "✅" : "❌"}</span>
                          <span className={c.ok ? "text-slate-600" : "text-red-600 font-semibold"}>{c.label}</span>
                          <span className="text-slate-400 truncate">— {c.detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs text-amber-700">
                  ⚠️ {t("creative.main.step4.draftNote1")}<b>{t("creative.main.step4.draftPaused")}</b>{t("creative.main.step4.draftNote2")}
                </p>
              </div>

              {/* Token status */}
              {tokenStatus && (
                <div className={cn(
                  "rounded-lg border px-4 py-3 flex items-center justify-between",
                  tokenStatus.valid
                    ? tokenStatus.warning
                      ? "border-amber-200 bg-amber-50"
                      : "border-emerald-200 bg-emerald-50"
                    : "border-red-200 bg-red-50"
                )}>
                  {tokenStatus.valid ? (
                    tokenStatus.warning ? (
                      <p className="text-xs font-medium text-amber-700">
                        {t("creative.main.step4.tokenExpiring", { min: Math.round(tokenStatus.expiresIn / 60) })}
                      </p>
                    ) : (
                      <p className="text-xs font-medium text-emerald-700">
                        {t("creative.main.step4.tokenOk")}{tokenStatus.expiresIn > 86400 ? t("creative.main.step4.tokenDays", { n: Math.round(tokenStatus.expiresIn / 86400) }) : tokenStatus.expiresIn > 3600 ? t("creative.main.step4.tokenHours", { n: Math.round(tokenStatus.expiresIn / 3600) }) : ''}
                      </p>
                    )
                  ) : (
                    <div className="flex items-center justify-between w-full">
                      <p className="text-xs font-medium text-red-700">{t("creative.main.step4.tokenExpired")}</p>
                      <button onClick={() => window.location.href = '/settings'}
                        className="text-xs font-semibold text-amber-700 hover:underline">
                        {t("creative.main.step4.reconnect")}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Launch Preview Modal ── */}
              {/* Preflight validation panel */}
              {preflightResult && (
                <PreflightPanel
                  result={preflightResult}
                  onProceed={() => { setPreflightResult(null); setShowLaunchPreview(true); }}
                  onClose={() => setPreflightResult(null)}
                />
              )}

              {showLaunchPreview && (() => {
                const previewSegments = audienceData?.audienceSegments
                  .map((seg, originalIdx) => ({ seg, originalIdx }))
                  .filter(({ originalIdx }) => selectedSegments.includes(originalIdx)) ?? [];
                const selectedCreatives = creativeResults.filter(c => c.selected);
                const perAdSetBudget = budgetType === "cbo"
                  ? Math.floor(dailyBudget / Math.max(previewSegments.length, 1))
                  : adsetBudget;

                // Dùng chung cho cả 2 nút bên dưới (tạo tắt sẵn / tạo & chạy
                // ngay) — chỉ khác đúng 1 tham số launchActive, mọi logic dựng
                // config và xử lý kết quả giữ nguyên y hệt bản gốc.
                const doLaunch = async (launchActive: boolean) => {
                  setShowLaunchPreview(false);
                  setIsLaunching(true);
                  setLaunchLog([launchActive
                    ? t("creative.main.launch.startLive")
                    : t("creative.main.launch.start")]);
                  try {
                    const aiLaunchSegments: LaunchSegment[] = audienceData?.audienceSegments
                      .map((seg, originalIdx) => ({ seg, originalIdx }))
                      .filter(({ originalIdx }) => selectedSegments.includes(originalIdx))
                      .map(({ seg, originalIdx }) => {
                        const editedDemo = editedDemographicsMap.get(originalIdx);
                        const ageRange = editedDemo
                          ? { min: editedDemo.ageMin, max: editedDemo.ageMax }
                          : parseAgeRange(seg.demographics.age);
                        const effLocations = editedDemo?.locations?.length ? editedDemo.locations : seg.demographics.location;
                        const preResolved = editedInterestsMap.get(originalIdx) ?? resolvedInterestsMap.get(originalIdx);
                        const gRaw = seg.demographics.gender ?? "";
                        const gender: "all" | "male" | "female" =
                          (gRaw.includes("Nam") && !gRaw.includes("Nữ")) ? "male"
                          : (gRaw.includes("Nữ") && !gRaw.includes("Nam")) ? "female"
                          : "all";
                        return {
                          segmentName: seg.segmentName,
                          funnelStage: seg.funnelStage ?? "TOFU",
                          demographics: {
                            ageMin: ageRange.min,
                            ageMax: ageRange.max,
                            gender,
                            locations: effLocations,
                          },
                          interests: seg.facebookTargeting?.interests ?? seg.psychographics?.interests ?? [],
                          behaviors: seg.facebookTargeting?.behaviors ?? seg.psychographics?.behaviors ?? [],
                          jobTitles: seg.facebookTargeting?.jobTitles ?? seg.demographics.jobTitles,
                          excludeAudiences: seg.facebookTargeting?.excludeAudiences,
                          excludeCustomAudienceIds: excludeAudienceIdList.length > 0 ? excludeAudienceIdList : undefined,
                          resolvedInterestIds: preResolved?.map(r => ({ id: r.id, name: r.name })),
                        };
                      }) ?? [];
                    const metaLaunchSegments: LaunchSegment[] = metaAudienceList
                      .filter(a => selectedMetaAudienceIds.has(a.id))
                      .map(a => ({
                        segmentName: a.name,
                        funnelStage: "MOFU" as const,
                        demographics: { ageMin: 18, ageMax: 65, gender: "all" as const, locations: [] },
                        interests: [],
                        behaviors: [],
                        customAudienceIds: [a.id],
                        excludeCustomAudienceIds: excludeAudienceIdList.length > 0 ? excludeAudienceIdList : undefined,
                      }));
                    const winningLaunchSegments: LaunchSegment[] = winningList
                      .filter(w => selectedWinningIds.has(w.id))
                      .map(w => {
                        const t = w.targeting as { age_min?: number; age_max?: number; genders?: number[] };
                        const g = t.genders ?? [];
                        return {
                          segmentName: w.name,
                          funnelStage: "MOFU" as const,
                          demographics: {
                            ageMin: t.age_min ?? 18,
                            ageMax: t.age_max ?? 65,
                            gender: (g.length === 1 ? (g[0] === 1 ? "male" : "female") : "all") as "all" | "male" | "female",
                            locations: [],
                          },
                          interests: [],
                          behaviors: [],
                          winningAudienceId: w.id,
                          excludeCustomAudienceIds: excludeAudienceIdList.length > 0 ? excludeAudienceIdList : undefined,
                        };
                      });
                    const segments: LaunchSegment[] = [...aiLaunchSegments, ...metaLaunchSegments, ...winningLaunchSegments];
                    const objConf = OBJECTIVE_MAP[objectiveKey] || OBJECTIVE_MAP.OUTCOME_LEADS;
                    const config: LaunchConfig = {
                      campaignName, objectiveKey, objective: objectiveKey, company,
                      budgetType, dailyBudget, adsetBudget, adSetDailyBudget: adsetBudget,
                      bidStrategy,
                      bidAmount: bidStrategy !== "LOWEST_COST_WITHOUT_CAP" ? bidAmount : undefined,
                      optimizationGoal: objConf.optimization_goal,
                      useAdvantageAudience, autoUTM, enableDCO,
                      ...conversionPayload,
                      pixelId: effectivePixelId || undefined,
                      startDate, endDate: continuous ? undefined : endDate, continuous,
                      destinationUrl,
                      pageId: selectedPageId,
                      pageName: fbPages.find(p => p.id === selectedPageId)?.name || "",
                      includeInstagram, segments,
                      creatives: creativeResults.filter(c => c.selected),
                      launchActive,
                      // Đợt 7b — Sổ kinh nghiệm: chỉ để ghi sổ + loại vị trí, không đổi logic launch.
                      productKey: selectedProduct,
                      excludePlacements: playbookStateRef.current.excludePlacements,
                      playbookEntryIds: playbookStateRef.current.keptEntryIds,
                      playbookOverriddenAvoidIds: playbookStateRef.current.overriddenAvoidIds,
                    };
                    const res = await fetch("/api/creative/launch-campaign", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(config),
                    });
                    const result = await res.json();
                    if (result.log) setLaunchLog(result.log);
                    if (result.success) {
                      setLaunchSuccess({
                        campaignId: result.campaignId, adSetCount: result.adSetCount,
                        adCount: result.adCount, launchActive: result.launchActive ?? false,
                      });
                      setTargetingDowngrades(result.targetingDowngrades ?? []);
                      setRetryResults(new Map());
                      markLaunched().catch(() => {});
                      // Clear session so next visit starts fresh from step 1
                      try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
                    } else {
                      setLaunchLog(prev => [...(result.log || prev), t("creative.main.launch.error", { error: result.error })]);
                    }
                  } catch (err) {
                    const errMsg = err instanceof Error ? err.message : t("creative.main.err.unknownShort");
                    setLaunchLog(prev => [...prev, t("creative.main.step4.connErr", { error: errMsg })]);
                  } finally {
                    setIsLaunching(false);
                  }
                };

                return (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
                      {/* Header */}
                      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-4">
                        <h2 className="text-base font-bold text-white">{t("creative.main.launch.previewTitle")}</h2>
                        <p className="text-xs text-emerald-100 mt-0.5">{t("creative.main.launch.previewSub")}</p>
                      </div>

                      <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                        {/* Campaign name */}
                        <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3">
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{t("creative.main.launch.campaignCaption")}</p>
                          <p className="text-sm font-bold text-slate-800">{campaignName}</p>
                          <div className="flex flex-wrap gap-2 mt-1.5">
                            <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-100">
                              {objectiveKey.replace("OUTCOME_", "")}
                            </span>
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                              {budgetType === "cbo" ? t("creative.main.launch.tagCbo", { amount: dailyBudget.toLocaleString(intlLocale) }) : t("creative.main.launch.tagAbo", { amount: adsetBudget.toLocaleString(intlLocale) })}
                            </span>
                            {useAdvantageAudience && (
                              <span className="text-[10px] bg-violet-50 text-violet-600 px-2 py-0.5 rounded-full border border-violet-100">🤖 Advantage+</span>
                            )}
                            {includeInstagram && (
                              <span className="text-[10px] bg-pink-50 text-pink-600 px-2 py-0.5 rounded-full border border-pink-100">📸 + Instagram</span>
                            )}
                            {autoUTM && (
                              <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full border border-emerald-100">{t("creative.main.launch.utmAuto")}</span>
                            )}
                          </div>
                        </div>

                        {/* Ad sets */}
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                            {previewSegments.length > 1 ? t("creative.main.launch.adSetsPlural", { n: previewSegments.length }) : t("creative.main.launch.adSetSingular", { n: previewSegments.length })}
                          </p>
                          <div className="space-y-2">
                            {previewSegments.map(({ seg, originalIdx }, si) => {
                              const resolved = editedInterestsMap.get(originalIdx) ?? resolvedInterestsMap.get(originalIdx) ?? [];
                              const segCreatives = selectedCreatives.filter(c => c.segmentName === seg.segmentName || c.isExistingPost);
                              return (
                                <div key={si} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded",
                                      seg.funnelStage === "TOFU" ? "bg-sky-100 text-sky-700" :
                                      seg.funnelStage === "MOFU" ? "bg-amber-100 text-amber-700" :
                                      "bg-emerald-100 text-emerald-700"
                                    )}>{seg.funnelStage ?? "TOFU"}</span>
                                    <span className="text-xs font-semibold text-slate-700 truncate">{seg.segmentName}</span>
                                    <span className="ml-auto text-[10px] text-emerald-600 shrink-0">₫{perAdSetBudget.toLocaleString(intlLocale)}{t("creative.main.common.perDay")}</span>
                                  </div>
                                  {(() => {
                                    const editedD = editedDemographicsMap.get(originalIdx);
                                    const pLocs = editedD?.locations?.length ? editedD.locations : seg.demographics.location;
                                    const pAge = editedD ? `${editedD.ageMin}-${editedD.ageMax}` : seg.demographics.age;
                                    return (
                                      <p className="text-[10px] text-slate-500">
                                        📍 {pLocs.slice(0, 2).join(", ")}{pLocs.length > 2 ? ` +${pLocs.length - 2}` : ""} · 👥 {pAge}
                                        {editedD && <span className="text-amber-600 ml-1">{t("creative.main.step4.edited")}</span>}
                                      </p>
                                    );
                                  })()}
                                  {!useAdvantageAudience && resolved.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {resolved.slice(0, 4).map(r => (
                                        <span key={r.id} className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded-full">{r.name}</span>
                                      ))}
                                      {resolved.length > 4 && <span className="text-[9px] text-slate-400">{t("creative.main.launch.moreInterests", { n: resolved.length - 4 })}</span>}
                                    </div>
                                  )}
                                  {useAdvantageAudience && (
                                    <p className="text-[10px] text-violet-500 mt-0.5">🤖 Advantage+ AI targeting</p>
                                  )}
                                  <p className="text-[10px] text-slate-400 mt-1">{segCreatives.length !== 1 ? t("creative.main.launch.creativesPlural", { n: segCreatives.length }) : t("creative.main.launch.creativeSingular", { n: segCreatives.length })}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Creatives summary - FB Ad Preview */}
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                            {selectedCreatives.length > 1 ? t("creative.main.launch.selectedPlural", { n: selectedCreatives.length }) : t("creative.main.launch.selectedSingular", { n: selectedCreatives.length })}
                          </p>
                          <div className="flex gap-3 overflow-x-auto pb-2">
                            {selectedCreatives.slice(0, 2).map((c, ci) => {
                              const pageName = fbPages.find(p => p.id === selectedPageId)?.name || campaignName;
                              return (
                                <FBAdPreview
                                  key={ci}
                                  pageName={pageName}
                                  primaryText={c.primaryText}
                                  headline={c.headline}
                                  description={c.description}
                                  cta={c.cta}
                                  destinationUrl={destinationUrl}
                                  imageUrl={c.imageUrl}
                                  className="shrink-0 w-72"
                                />
                              );
                            })}
                          </div>
                          {selectedCreatives.length > 2 && (
                            <p className="text-[10px] text-slate-400 pl-2">{t("creative.main.launch.moreCreatives", { n: selectedCreatives.length - 2 })}</p>
                          )}
                        </div>

                        {/* URL preview */}
                        {destinationUrl && (
                          <div className="rounded-lg bg-amber-50/50 border border-amber-100 px-3 py-2">
                            <p className="text-[10px] font-semibold text-amber-700 mb-0.5">{t("creative.main.launch.landingUrl")}</p>
                            <p className="text-[10px] text-slate-600 break-all">{destinationUrl}{autoUTM ? `?utm_source=facebook&utm_medium=paid&utm_campaign=${encodeURIComponent(campaignName.slice(0, 30))}...` : ""}</p>
                          </div>
                        )}
                      </div>

                      {/* Footer buttons */}
                      <div className="border-t border-slate-100 px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
                        <Button variant="outline" className="text-xs" onClick={() => setShowLaunchPreview(false)}>
                          {t("creative.main.launch.backToEdit")}
                        </Button>
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          <Button
                            onClick={() => doLaunch(false)}
                            className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-bold text-white hover:from-emerald-700 hover:to-teal-700 shadow-md"
                          >
                            <Rocket className="h-4 w-4" /> {t("creative.main.launch.confirmCreate")}
                          </Button>
                          <Button
                            onClick={() => {
                              if (!window.confirm(
                                `${t("creative.main.launch.liveConfirm1")}\n\n${t("creative.main.launch.liveConfirm2")}`
                              )) return;
                              doLaunch(true);
                            }}
                            className="gap-2 bg-gradient-to-r from-orange-600 to-red-600 px-4 py-2 text-sm font-bold text-white hover:from-orange-700 hover:to-red-700 shadow-md"
                          >
                            <Rocket className="h-4 w-4" /> {t("creative.main.launch.createRun")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex items-center justify-between pt-2">
                <Button variant="outline" className="gap-1.5 text-xs" onClick={() => setStep(3)}>
                  <ArrowLeft className="h-3.5 w-3.5" /> {t("creative.main.common.back")}
                </Button>
                <Button
                  onClick={() => {
                    const unmatchedSegments = selectedSegments.filter(idx => {
                      const seg = audienceData?.audienceSegments[idx];
                      if (!seg) return false;
                      return !creativeResults.some(c => c.selected && (
                        c.segmentName === seg.segmentName ||
                        !!(c as any).isExistingPost ||
                        !!(c as any).objectStoryId
                      ));
                    });
                    if (unmatchedSegments.length > 0) {
                      const names = unmatchedSegments.map(idx => audienceData?.audienceSegments[idx]?.segmentName ?? t("creative.main.launch.segmentN", { n: idx + 1 })).join(", ");
                      if (!window.confirm(`${t("creative.main.launch.unmatched1", { n: unmatchedSegments.length })}\n${names}\n\n${t("creative.main.launch.unmatched2")}\n\n${t("creative.main.launch.unmatched3")}`)) return;
                    }
                    // Client-side preflight before showing launch preview
                    const pfCfg: LaunchConfig = {
                      campaignName, objectiveKey, objective: objectiveKey, company,
                      budgetType, dailyBudget, adSetDailyBudget: adsetBudget,
                      adsetBudget,
                      bidStrategy,
                      bidAmount: bidStrategy !== "LOWEST_COST_WITHOUT_CAP" ? bidAmount : undefined,
                      optimizationGoal: (OBJECTIVE_MAP[objectiveKey] ?? OBJECTIVE_MAP.OUTCOME_LEADS).optimization_goal,
                      destinationUrl, pageId: selectedPageId,
                      startDate, endDate: continuous ? undefined : endDate, continuous,
                      pixelId: effectivePixelId || undefined,
                      ...conversionPayload,
                      segments: selectedSegments
                        .map(idx => audienceData?.audienceSegments[idx])
                        .filter((s): s is NonNullable<typeof s> => s != null)
                        .map(seg => ({
                          segmentName: seg.segmentName ?? "",
                          funnelStage: seg.funnelStage ?? "TOFU",
                          demographics: { ageMin: 18, ageMax: 65, gender: "all" as const, locations: [] },
                          interests: (seg.facebookTargeting?.interests ?? seg.psychographics?.interests ?? []) as string[],
                          behaviors: (seg.facebookTargeting?.behaviors ?? seg.psychographics?.behaviors ?? []) as string[],
                          excludeCustomAudienceIds: excludeAudienceIdList.length > 0 ? excludeAudienceIdList : undefined,
                        })),
                      creatives: creativeResults.filter(c => c.selected),
                      useAdvantageAudience,
                      productKey: selectedProduct,
                      excludePlacements: playbookStateRef.current.excludePlacements,
                      playbookEntryIds: playbookStateRef.current.keptEntryIds,
                      playbookOverriddenAvoidIds: playbookStateRef.current.overriddenAvoidIds,
                    };
                    const pf = runPreflightMeta(pfCfg, company);
                    if (pf.status !== "ready_to_launch") {
                      setPreflightResult(pf);
                      return;
                    }
                    setShowLaunchPreview(true);
                  }}
                  disabled={isLaunching || selectedCreativeCount === 0 || !selectedPageId || (tokenStatus !== null && !tokenStatus.valid)}
                  className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 px-8 py-3 text-sm font-bold text-white hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50 shadow-lg"
                >
                  {isLaunching ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> {t("creative.main.launch.creating")}</>
                  ) : tokenStatus !== null && !tokenStatus.valid ? (
                    <>{t("creative.main.launch.needReconnect")}</>
                  ) : (
                    <><Eye className="h-4 w-4" /> {t("creative.main.launch.previewCreate")}</>
                  )}
                </Button>
              </div>

              {/* FIX 5: Launch Progress Log */}
              {launchLog.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1 mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold text-slate-600">{t("creative.main.launch.log")}</h4>
                    <button
                      onClick={() => navigator.clipboard.writeText(launchLog.join('\n'))}
                      className="text-xs text-slate-400 hover:text-slate-600 px-2 py-0.5 rounded border border-slate-200 hover:border-slate-400 transition-colors"
                    >
                      {t("creative.main.launch.copyLog")}
                    </button>
                  </div>
                  <div className="max-h-96 overflow-y-auto space-y-0.5 font-mono text-xs" ref={(el) => { if (el && !isLaunching) el.scrollTop = el.scrollHeight; }}>
                    {launchLog.map((line, i) => (
                      <div key={i} className={
                        line.startsWith('✅') ? 'text-emerald-600' :
                        line.startsWith('❌') ? 'text-red-600 font-semibold' :
                        line.startsWith('🔄') ? 'text-amber-700' :
                        'text-slate-500'
                      }>
                        {line}
                      </div>
                    ))}
                    {isLaunching && (
                      <div className="flex items-center gap-1.5 text-amber-700 animate-pulse">
                        <span>{t("creative.main.launch.processing")}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* SAVED CREATIVES (always visible)         */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {saved.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <button
            onClick={() => setShowSaved(!showSaved)}
            className="flex w-full items-center justify-between px-5 py-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <span>
              {t("creative.main.saved.title")}
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                {saved.length}
              </span>
            </span>
            {showSaved ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </button>

          {showSaved && (
            <div className="border-t border-slate-100 p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {saved.map(c => (
                  <CreativeCard
                    key={c.id}
                    creative={c}
                    isSaved
                    onCopy={() => copyCreative(c)}
                    onRemove={() => removeCreative(c.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CreativeAIPage() {
  return (
    <Suspense>
      <CreativeAIPageInner />
    </Suspense>
  );
}
