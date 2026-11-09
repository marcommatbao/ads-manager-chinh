// ============================================================
// GET /api/improvements/keywords
// ============================================================
// Real, GAQL-backed per-keyword intent + cost analysis — surfaced as a
// read-only "Từ khóa" view inside Improvements (not a new /toolkit page,
// not mock data — see /home/coder/.claude/plans/flickering-wandering-robin.md
// for why). Reuses the keyword_view/campaign GAQL shapes already proven
// in app/api/improvements/route.ts; the new pieces are the search-term→
// keyword join, deterministic intent-match classification, and the
// suggestedMaxCpc/budgetImpact formulas.

import { NextRequest, NextResponse } from "next/server";
import { googleAdsErrorMessage } from "@/lib/google-ads-error";
import { canAccessCompany } from "@/lib/permissions";
import { getGoogleAdsCustomer } from "@/lib/google-ads-client";
import { getCurrentUser } from "@/lib/auth";
import { resolveMatchType } from "@/lib/google-ads-helpers";
import { getCPLTarget } from "@/lib/cpl-targets";
import { enums } from "google-ads-api";
import { enumName } from "@/lib/google-ads-enums";
import { promises as fs } from "fs";
import { writeFileAtomic } from "@/lib/fs-atomic";
import path from "path";
import type {
  KeywordInsight,
  KeywordInsightsResponse,
  SearchTermSample,
  IntentMatch,
  BudgetImpact,
  KwMatchType,
} from "@/types/keyword-insight";
import { daysBackVN } from "@/lib/case/dates";
import { pickCompany } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// ─────────────────────────────────────────────
// JSON cache — same TTL pattern as app/api/improvements/route.ts's
// readCache/writeCache, so repeat "Từ khóa" tab loads don't re-hit the
// Google Ads API every time. Keyed by company+days+campaignId (the
// dimensions that actually change the GAQL fetch) — intentMatch/
// matchType are query-string post-filters applied AFTER reading from
// cache, not part of the key, so they never cause a cache miss.
// ─────────────────────────────────────────────
const DATA_DIR = path.join(process.cwd(), "data");
const KEYWORDS_CACHE_FILE = path.join(DATA_DIR, "keyword-insights-cache.json");
const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes, matching app/api/improvements/route.ts

interface KeywordsCacheEntry {
  updatedAt: string;
  response: KeywordInsightsResponse;
}
type KeywordsCacheFile = Record<string, KeywordsCacheEntry>;

async function readKeywordsCache(): Promise<KeywordsCacheFile> {
  try {
    const raw = await fs.readFile(KEYWORDS_CACHE_FILE, "utf-8");
    return JSON.parse(raw) as KeywordsCacheFile;
  } catch {
    return {};
  }
}

async function writeKeywordsCacheEntry(key: string, response: KeywordInsightsResponse): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const all = await readKeywordsCache();
    all[key] = { updatedAt: new Date().toISOString(), response };
    await writeFileAtomic(KEYWORDS_CACHE_FILE, JSON.stringify(all, null, 2));
  } catch (err) {
    console.error("[improvements/keywords] Cache write failed:", err);
  }
}

function applyQueryFilters(
  response: KeywordInsightsResponse,
  intentMatchFilter: string | null,
  matchTypeFilter: string | null
): KeywordInsightsResponse {
  if (!intentMatchFilter && !matchTypeFilter) return response;
  const keywords = response.keywords.filter(k => {
    if (intentMatchFilter && k.intentMatch !== intentMatchFilter) return false;
    if (matchTypeFilter && k.matchType !== matchTypeFilter) return false;
    return true;
  });
  return { ...response, keywords, meta: { ...response.meta, totalKeywords: keywords.length } };
}

// Ngày theo giờ VN — bản cũ dùng toISOString() (UTC) nên 0h–7h sáng lùi mất một ngày.
function gaqlDates(daysBack: number): { from: string; to: string } {
  return daysBackVN(daysBack)
}

// Same B2B VN CPL benchmarks as app/api/improvements/route.ts — duplicated
// (not imported) since route.ts is a Next.js route handler file, not a
// lib module; re-exporting internals from a sibling route isn't a clean
// Next.js pattern. Keep these two lists in sync if either changes.
// CPL_TARGETS / detectProductGroup / getCPLTarget đã chuyển sang
// lib/cpl-targets.ts — bảng này từng được gõ tay ở đây VÀ ở
// app/api/improvements/route.ts; lệch một con số là hai màn hình khuyên hai
// mức giá khác nhau cho cùng một từ khoá mà không có gì báo.

function toKwMatchType(raw: unknown): KwMatchType {
  const m = resolveMatchType(raw as number | string | null | undefined);
  return m === "EXACT" || m === "PHRASE" || m === "BROAD" ? m : "UNKNOWN";
}

// ── Deterministic intent-match classification (no AI call) ──
const STOPWORDS = new Set([
  "và", "của", "cho", "là", "có", "tại", "với", "các", "một", "này", "những", "cần", "muốn",
  "the", "a", "an", "for", "to", "of", "in", "on", "is", "are",
]);

// Strip Vietnamese diacritics (NFD-decompose, drop combining marks, fold
// đ/Đ) before comparing words — verified live: without this, the keyword
// "mat bão" (a common no-diacritics way people actually type "mắt bão")
// scored 0.25 overlap against its own real search terms and was
// misclassified off_intent, with "add to negative" as the suggested
// action — actively wrong advice for a legitimate brand variant.
function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function normalizeWords(text: string): Set<string> {
  return new Set(
    stripDiacritics(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOPWORDS.has(w))
  );
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

// Fraction of the KEYWORD's own words present in the search term — not
// the reverse, so a longer/more specific real query isn't penalized for
// containing extra words beyond the keyword.
//
// Plus a per-word fuzzy fallback: pure whitespace-token overlap misses
// compound-word typos of multi-word brand names — confirmed live on
// "mat bao id": real search terms "mabao"/"macbao"/"matbai"/"matboa" are
// obvious typos of "mắt bão" squished into one word, but share zero
// exact tokens with {mat, bao, id}, scoring 0 overlap and getting
// suggested for negative — which would have silently blocked real
// brand-typo traffic. For each keyword word that has no exact token
// match, check whether it appears as a substring of some term word, or
// is a close edit-distance match to it — "macbao".includes("bao") and
// "matboa" is a 1-edit transposition of "...bao" — and award half credit
// per word on a hit, since it's a weaker signal than an exact token.
function overlapScore(keywordWords: Set<string>, termWords: Set<string>): number {
  if (keywordWords.size === 0) return 0;
  let hit = 0;
  for (const w of keywordWords) {
    if (termWords.has(w)) {
      hit += 1;
      continue;
    }
    if (w.length < 3) continue; // too short for substring/edit-distance to be meaningful
    for (const tw of termWords) {
      if (tw.length < 3) continue;
      const fuzzy = tw.includes(w) || w.includes(tw) || levenshtein(w, tw) <= 1;
      if (fuzzy) {
        hit += 0.5;
        break;
      }
    }
  }
  return Math.min(hit / keywordWords.size, 1);
}

function classifySample(overlap: number): Exclude<IntentMatch, "unknown"> {
  if (overlap >= 0.7) return "relevant";
  if (overlap >= 0.3) return "borderline";
  return "off_intent";
}

function classifyKeyword(
  keywordText: string,
  samples: Array<{ term: string; clicks: number }>
): { intentMatch: IntentMatch; avgOverlap: number | null } {
  if (samples.length === 0) return { intentMatch: "unknown", avgOverlap: null };
  const kwWords = normalizeWords(keywordText);
  if (kwWords.size === 0) return { intentMatch: "unknown", avgOverlap: null };

  let weightedSum = 0;
  let totalWeight = 0;
  for (const s of samples) {
    const overlap = overlapScore(kwWords, normalizeWords(s.term));
    const weight = Math.max(s.clicks, 1); // never zero-weight a sample
    weightedSum += overlap * weight;
    totalWeight += weight;
  }
  const avgOverlap = weightedSum / totalWeight;
  const intentMatch: IntentMatch = avgOverlap >= 0.6 ? "relevant" : avgOverlap >= 0.3 ? "borderline" : "off_intent";
  return { intentMatch, avgOverlap };
}

// suggestedMaxCpc = targetCPA × expected conversion rate (the standard
// eCPC-from-target-CPA identity) — same target-CPA/CPL fallback chain
// already used by PAUSE_KEYWORD/SCALE_KW in the main improvements route.
function computeSuggestedMaxCpc(
  campaignName: string,
  targetCpaMicros: number,
  kwClicks: number,
  kwConv: number,
  campClicks: number,
  campConv: number
): { value: number; basis: "target_cpa" | "cpl_benchmark" } {
  const targetCpa = targetCpaMicros > 0 ? targetCpaMicros / 1_000_000 : getCPLTarget(campaignName);
  const basis: "target_cpa" | "cpl_benchmark" = targetCpaMicros > 0 ? "target_cpa" : "cpl_benchmark";

  let convRate = kwClicks >= 5 ? kwConv / kwClicks : 0;
  if (convRate === 0) {
    // Soát dữ liệu 07/10: chưa đủ số đo thì KHÔNG giả định 2% — trả 0 → "chưa đủ dữ liệu" (budgetImpact "unknown").
    convRate = campClicks >= 20 ? campConv / campClicks : 0;
  }
  convRate = Math.min(convRate, 0.5); // clamp outliers (e.g. 1 click/1 conv keywords)

  return { value: targetCpa * convRate, basis };
}

// ±15% band — matches the tolerance already used by the real cpl-calculator.ts
// threshold system elsewhere in this codebase (verified: MBC good/warning/
// critical bands sit at comparable relative spacing), rather than the
// previous ±20% which wasn't tied to any existing convention.
function computeBudgetImpact(currentCpc: number, suggestedMaxCpc: number, clicks: number): BudgetImpact {
  if (suggestedMaxCpc <= 0 || clicks < 3) return "unknown"; // not enough signal to flag either way
  const ratio = currentCpc / suggestedMaxCpc;
  if (ratio > 1.15) return "over_budget"; // paying >15% above the CPA-implied ceiling
  if (ratio < 0.85) return "under_budget"; // bidding >15% below ceiling — room to capture more volume
  return "on_track";
}

function suggestAction(
  intentMatch: IntentMatch,
  budgetImpact: BudgetImpact,
  qualityScore: number | null,
  spend: number,
  suggestedMaxCpc: number
): string {
  const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n));
  if (intentMatch === "off_intent" && spend > 200_000) return "Thêm search term vào negative";
  if (budgetImpact === "over_budget") return `Giảm CPC về khoảng ₫${fmt(suggestedMaxCpc)}`;
  if (budgetImpact === "under_budget" && (qualityScore ?? 0) >= 6) return "Có thể tăng CPC để lấy thêm volume";
  if (qualityScore !== null && qualityScore > 0 && qualityScore <= 4) return "Cải thiện Quality Score trước khi tăng bid";
  return "Theo dõi thêm";
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const companyRaw = (searchParams.get("company") || "MBC").toUpperCase();
  const company = pickCompany(companyRaw);

  // canAccessCompany(role, …) chấm theo VAI TRÒ. Bản cũ chấm theo
  // user.companies — trường đó là PHẠM VI và đang mang ["ALL"] cho MỌI tài
  // khoản (kiểm data/team-members.json 16/09/2026, kể cả viewer_mbc), nên
  // mọi phép kiểm quyền công ty ở đây LUÔN ĐÚNG cho tất cả mọi người.
  if (!canAccessCompany(user, company as string)) {
    return NextResponse.json({ error: "Forbidden: no access to requested company" }, { status: 403 });
  }

  const campaignIdFilter = searchParams.get("campaignId");
  const intentMatchFilter = searchParams.get("intentMatch");
  const matchTypeFilter = searchParams.get("matchType");
  const dateRange = Math.min(parseInt(searchParams.get("days") || "30", 10), 90);
  const dates = gaqlDates(dateRange);
  const forceRefresh = searchParams.get("force") === "true";

  const cacheKey = `${company}:${dateRange}:${campaignIdFilter ?? "ALL"}`;
  if (!forceRefresh) {
    const cacheFile = await readKeywordsCache();
    const cached = cacheFile[cacheKey];
    if (cached) {
      const ageMs = Date.now() - new Date(cached.updatedAt).getTime();
      if (ageMs < CACHE_TTL_MS) {
        return NextResponse.json(applyQueryFilters(cached.response, intentMatchFilter, matchTypeFilter));
      }
    }
  }

  try {
    const customer = getGoogleAdsCustomer(company);

    const [kwResult, campResult, termResult] = await Promise.allSettled([
      // 1. Keywords — same shape as app/api/improvements/route.ts:320-345,
      // plus ad_group.id (search-term join key) and campaign.resource_name
      // (needed for the ADD_NEGATIVE quick-action payload).
      customer.query(`
        SELECT
          ad_group_criterion.criterion_id,
          ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type,
          ad_group_criterion.quality_info.quality_score,
          ad_group_criterion.resource_name,
          ad_group.id,
          ad_group.name,
          campaign.id,
          campaign.name,
          campaign.resource_name,
          metrics.cost_micros,
          metrics.conversions,
          metrics.clicks,
          metrics.impressions,
          metrics.average_cpc
        FROM keyword_view
        WHERE campaign.status = 'ENABLED'
          AND ad_group.status = 'ENABLED'
          AND ad_group_criterion.status = 'ENABLED'
          AND ad_group_criterion.negative = false
          AND campaign.advertising_channel_type = 'SEARCH'
          AND segments.date BETWEEN '${dates.from}' AND '${dates.to}'
          ${campaignIdFilter ? `AND campaign.id = ${parseInt(campaignIdFilter, 10)}` : ""}
        LIMIT 1000
      `),

      // 2. Campaigns — real channel type / bidding strategy / target CPA,
      // filtered to SEARCH since keyword-level bidding only applies there.
      customer.query(`
        SELECT
          campaign.id,
          campaign.name,
          campaign.advertising_channel_type,
          campaign.bidding_strategy_type,
          campaign.target_cpa.target_cpa_micros,
          metrics.clicks,
          metrics.conversions
        FROM campaign
        WHERE campaign.status = 'ENABLED'
          AND campaign.advertising_channel_type = 'SEARCH'
          AND segments.date BETWEEN '${dates.from}' AND '${dates.to}'
      `),

      // 3. Search terms — NEW join field, not used anywhere else in this
      // codebase yet. segments.keyword.ad_group_criterion should be the
      // same resource-name string as ad_group_criterion.resource_name
      // from query 1 — exact-match join. Falls back to (ad_group.id,
      // normalized text, match_type) heuristic join if this field errors.
      customer.query(`
        SELECT
          search_term_view.search_term,
          segments.keyword.ad_group_criterion,
          segments.keyword.info.text,
          segments.keyword.info.match_type,
          ad_group.id,
          metrics.cost_micros,
          metrics.conversions,
          metrics.clicks
        FROM search_term_view
        WHERE segments.date BETWEEN '${dates.from}' AND '${dates.to}'
          AND campaign.status = 'ENABLED'
          AND ad_group.status = 'ENABLED'
          AND metrics.clicks > 0
          ${campaignIdFilter ? `AND campaign.id = ${parseInt(campaignIdFilter, 10)}` : ""}
        LIMIT 5000
      `).catch(async () => {
        // Fallback: drop the unconfirmed join field, keep the heuristic keys.
        return customer.query(`
          SELECT
            search_term_view.search_term,
            segments.keyword.info.text,
            segments.keyword.info.match_type,
            ad_group.id,
            metrics.cost_micros,
            metrics.conversions,
            metrics.clicks
          FROM search_term_view
          WHERE segments.date BETWEEN '${dates.from}' AND '${dates.to}'
            AND campaign.status = 'ENABLED'
            AND ad_group.status = 'ENABLED'
            AND metrics.clicks > 0
            ${campaignIdFilter ? `AND campaign.id = ${parseInt(campaignIdFilter, 10)}` : ""}
          LIMIT 5000
        `);
      }),
    ]);

    const kwRows: Row[] = kwResult.status === "fulfilled" ? kwResult.value : [];
    const campRows: Row[] = campResult.status === "fulfilled" ? campResult.value : [];
    const termRows: Row[] = termResult.status === "fulfilled" ? termResult.value : [];

    let joinMethod: "resource_name" | "heuristic" | "none" = "none";

    // ── Build search-term samples per keyword ──
    const samplesByCriterionResource = new Map<string, Array<{ term: string; clicks: number; cost: number; conv: number }>>();
    const samplesByHeuristicKey = new Map<string, Array<{ term: string; clicks: number; cost: number; conv: number }>>();

    for (const row of termRows) {
      const term = row.search_term_view?.search_term || "";
      if (!term) continue;
      const clicks = Number(row.metrics?.clicks ?? 0);
      const cost = Number(row.metrics?.cost_micros ?? 0) / 1_000_000;
      const conv = Number(row.metrics?.conversions ?? 0);
      const entry = { term, clicks, cost, conv };

      const criterionRes = row.segments?.keyword?.ad_group_criterion as string | undefined;
      if (criterionRes) {
        joinMethod = "resource_name";
        const arr = samplesByCriterionResource.get(criterionRes) ?? [];
        arr.push(entry);
        samplesByCriterionResource.set(criterionRes, arr);
      }

      const kwText = row.segments?.keyword?.info?.text as string | undefined;
      const kwMatch = toKwMatchType(row.segments?.keyword?.info?.match_type);
      const adGroupId = row.ad_group?.id;
      if (kwText && adGroupId) {
        const key = `${adGroupId}::${kwText.toLowerCase()}::${kwMatch}`;
        const arr = samplesByHeuristicKey.get(key) ?? [];
        arr.push(entry);
        samplesByHeuristicKey.set(key, arr);
      }
    }
    if (joinMethod === "none" && samplesByHeuristicKey.size > 0) joinMethod = "heuristic";

    // ── Campaign lookup map ──
    const campByCampaignId = new Map<string, Row>();
    for (const c of campRows) {
      if (c.campaign?.id) campByCampaignId.set(String(c.campaign.id), c);
    }

    // ── Build keyword insights ──
    const keywords: KeywordInsight[] = [];

    for (const row of kwRows) {
      const criterionRes = row.ad_group_criterion?.resource_name as string | undefined;
      const keywordText = row.ad_group_criterion?.keyword?.text || "";
      if (!criterionRes || !keywordText) continue;

      const campaignId = String(row.campaign?.id ?? "");
      const camp = campByCampaignId.get(campaignId);
      const campaignName = row.campaign?.name || "";

      const matchType = toKwMatchType(row.ad_group_criterion?.keyword?.match_type);
      const impressions = Number(row.metrics?.impressions ?? 0);
      const clicks = Number(row.metrics?.clicks ?? 0);
      const spend = Number(row.metrics?.cost_micros ?? 0) / 1_000_000;
      const conversions = Number(row.metrics?.conversions ?? 0);
      const currentCpc = Number(row.metrics?.average_cpc ?? 0) / 1_000_000;
      const ctr = impressions > 0 ? clicks / impressions : 0;
      const qsRaw = row.ad_group_criterion?.quality_info?.quality_score;
      const qualityScore = typeof qsRaw === "number" && qsRaw > 0 ? qsRaw : null;
      const cplEstimate = conversions > 0 ? spend / conversions : null;

      const targetCpaMicros = Number(camp?.campaign?.target_cpa?.target_cpa_micros ?? 0);
      const campClicks = Number(camp?.metrics?.clicks ?? 0);
      const campConv = Number(camp?.metrics?.conversions ?? 0);
      const { value: suggestedMaxCpc, basis: suggestedMaxCpcBasis } = computeSuggestedMaxCpc(
        campaignName, targetCpaMicros, clicks, conversions, campClicks, campConv
      );
      const budgetImpact = computeBudgetImpact(currentCpc, suggestedMaxCpc, clicks);

      // Samples: prefer exact resource-name join, fall back to heuristic key
      const heuristicKey = `${row.ad_group?.id}::${keywordText.toLowerCase()}::${matchType}`;
      const rawSamples =
        samplesByCriterionResource.get(criterionRes) ??
        samplesByHeuristicKey.get(heuristicKey) ??
        [];
      const dedupedSamples = rawSamples
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 8);

      const { intentMatch, avgOverlap } = classifyKeyword(
        keywordText,
        dedupedSamples.map(s => ({ term: s.term, clicks: s.clicks }))
      );

      const searchTermSamples: SearchTermSample[] = dedupedSamples.map(s => {
        const overlap = overlapScore(normalizeWords(keywordText), normalizeWords(s.term));
        return {
          searchTerm: s.term,
          clicks: s.clicks,
          cost: s.cost,
          conversions: s.conv,
          overlapScore: overlap,
          classification: classifySample(overlap),
        };
      });

      const insight: KeywordInsight = {
        id: criterionRes,
        company,
        keyword: keywordText,
        matchType,
        campaignId,
        campaignName,
        campaignResourceName: row.campaign?.resource_name || "",
        adGroupName: row.ad_group?.name || "",
        channelType: enumName(enums.AdvertisingChannelType, camp?.campaign?.advertising_channel_type) || "SEARCH",
        biddingStrategyType: enumName(enums.BiddingStrategyType, camp?.campaign?.bidding_strategy_type),
        targetCpa: targetCpaMicros > 0 ? targetCpaMicros / 1_000_000 : null,
        impressions,
        clicks,
        ctr,
        currentCpc,
        qualityScore,
        conversions,
        spend,
        cplEstimate,
        suggestedMaxCpc,
        suggestedMaxCpcBasis,
        budgetImpact,
        intentMatch,
        intentMatchAvgOverlap: avgOverlap,
        searchTermSamples,
        suggestedAction: suggestAction(intentMatch, budgetImpact, qualityScore, spend, suggestedMaxCpc),
        criterionResourceName: criterionRes,
      };

      keywords.push(insight);
    }

    keywords.sort((a, b) => b.spend - a.spend);

    // Cache the FULL unfiltered result — intentMatch/matchType are applied
    // as a post-filter on every read (cached or fresh) so they never
    // affect the cache key or force an extra Google Ads fetch.
    const fullResponse: KeywordInsightsResponse = {
      company,
      dateRange: dates,
      keywords,
      meta: {
        totalKeywords: keywords.length,
        campaignsAnalyzed: campByCampaignId.size,
        searchTermRowsMatched: termRows.length,
        joinMethod,
      },
    };
    await writeKeywordsCacheEntry(cacheKey, fullResponse);

    return NextResponse.json(applyQueryFilters(fullResponse, intentMatchFilter, matchTypeFilter));
  } catch (error: unknown) {
    const message = googleAdsErrorMessage(error);
    return NextResponse.json({ error: friendlyError(message) }, { status: 500 });
  }
}
