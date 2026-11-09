// ─────────────────────────────────────────────
// Competitor Intelligence Hub — Data Fetcher
// SimilarWeb (cache 24h) + FB/Google/TikTok Ads
// Gemini AI: Batch Analysis tất cả đối thủ
// ─────────────────────────────────────────────

import {
  INTEL_COMPETITORS,
  type IntelCompetitor,
  type FBKeywordAd,
  type GoogleTransparencyData,
  type TikTokAdData,
  type ChannelAnalysis,
  type ChannelScores,
  type MarketAnalysis,
} from "./intelligence-config";

import {
  fetchAllCompetitorsSW,
  toChannelScores,
  getLatestVisits,
  type SimilarWebData,
  usableForTrend,
} from "./similarweb";

import {
  setSWData,
  setFBKeywordAds,
  setGoogleAds,
  setTikTokAds,
  setChannelAnalysis,
  setMarketAnalysis,
  addAlert,
  getLastSnapshot,
  saveSnapshot,
  setLastSyncAt,
} from "./intelligence-store";
import { callGemini } from "./gemini";

// ─── SOURCE 2: Facebook Ad Library (Keyword-based via Apify) ──

export async function fetchFBAdsByKeyword(
  competitor: IntelCompetitor,
  apifyToken?: string
): Promise<FBKeywordAd[]> {
  if (apifyToken) {
    try {
      const input = {
        search_type: "keyword",
        keyword: competitor.name,
        country: "VN",
        ad_type: "all",
        max_ads: 20,
      };

      const url = `https://api.apify.com/v2/acts/curious_coder~facebook-ads-scraper/run-sync-get-dataset-items?token=${apifyToken}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(120_000),
      });

      if (res.ok) {
        const data = await res.json();
        const ads: FBKeywordAd[] = (data || []).map((ad: any) => ({
          pageId: ad.page_id || ad.pageId || "",
          pageName: ad.page_name || ad.pageName || competitor.name,
          adCount: 1,
          latestAdText:
            ad.ad_creative_bodies?.[0] || ad.text || ad.body || null,
          latestAdHeadline:
            ad.ad_creative_link_titles?.[0] || ad.title || null,
          snapshotUrl: ad.ad_snapshot_url || ad.url || null,
          keyword: competitor.name,
        }));

        const grouped: Record<string, FBKeywordAd> = {};
        for (const ad of ads) {
          if (grouped[ad.pageName]) {
            grouped[ad.pageName].adCount++;
          } else {
            grouped[ad.pageName] = { ...ad };
          }
        }
        return Object.values(grouped);
      }
    } catch (err) {
      console.warn(`[FB Ads] Apify failed for ${competitor.name}:`, err);
    }
  }

  // No Apify token, or the real fetch failed — honestly report "no ads
  // found" rather than fabricating competitor ad copy/counts.
  return [];
}

// ─── SOURCE 3: Google Ads Transparency (SerpApi) ──

export async function fetchGoogleTransparency(
  domain: string,
  serpApiKey?: string
): Promise<GoogleTransparencyData> {
  if (serpApiKey) {
    try {
      const params = new URLSearchParams({
        engine: "google_ads_transparency_center",
        q: domain,
        region: "VN",
        api_key: serpApiKey,
      });

      const res = await fetch(`https://serpapi.com/search?${params}`, {
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        const data = await res.json();
        return {
          domain,
          totalAds: data.ads?.length || 0,
          activeAds: data.ads?.filter((a: any) => a.is_active)?.length || 0,
          adFormats: [...new Set<string>(data.ads?.map((a: any) => a.format) || [])],
          lastSeen: data.ads?.[0]?.last_shown || null,
          fetchedAt: new Date().toISOString(),
          available: true,
        };
      }
    } catch (err) {
      console.warn(`[Google Ads] SerpApi failed for ${domain}:`, err);
    }
  }

  // No SerpApi key, or the real fetch failed — honest "unknown", not a
  // fabricated ad count. `available:false` lets the UI distinguish this
  // from a real, confirmed zero.
  return {
    domain,
    totalAds: 0,
    activeAds: 0,
    adFormats: [],
    lastSeen: null,
    fetchedAt: new Date().toISOString(),
    available: false,
  };
}

// ─── SOURCE 4: TikTok Ads Library (SearchApi) ──

export async function fetchTikTokAds(
  keyword: string,
  searchApiKey?: string
): Promise<TikTokAdData[]> {
  if (searchApiKey) {
    try {
      const params = new URLSearchParams({
        engine: "tiktok_ads_library",
        q: keyword,
        country: "VN",
        api_key: searchApiKey,
      });

      const res = await fetch(
        `https://www.searchapi.io/api/v1/search?${params}`,
        { signal: AbortSignal.timeout(15_000) }
      );

      if (res.ok) {
        const data = await res.json();
        return (
          data.ads?.map((ad: any) => ({
            advertiser: ad.advertiser_name || keyword,
            description: ad.description || "",
            firstSeen: ad.first_shown_datetime || null,
            lastSeen: ad.last_shown_datetime || null,
            videoUrl: ad.video_link || null,
          })) || []
        );
      }
    } catch (err) {
      console.warn(`[TikTok] SearchApi failed for ${keyword}:`, err);
    }
  }

  // No SearchApi key, or the real fetch failed — honestly report "no ads
  // found" rather than fabricating a TikTok ad list.
  return [];
}

// ─── GEMINI AI — Per-competitor fallback analysis (chỉ dùng scores) ──

function createFallbackPerCompetitor(
  competitorId: string,
  scores: Record<string, number>,
  isEstimated: boolean = false
): ChannelAnalysis {
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const dominant = entries[0]?.[0] || "google";
  const weak = entries[entries.length - 1]?.[0] || "tiktok";
  const growing = entries[1]?.[0] || "seo";

  return {
    competitorId,
    channelScores: scores as ChannelScores,
    dominantChannel: dominant,
    growingChannel: growing,
    weakChannel: weak,
    channelSummary: `Tập trung mạnh vào ${dominant} (${entries[0]?.[1] || 0}/100), yếu nhất ở ${weak} (${entries[entries.length - 1]?.[1] || 0}/100).`,
    opportunityFor:
      weak === "tiktok" ? "TikTok Ads"
      : weak === "email" ? "Email Marketing"
      : weak === "facebook" ? "Facebook Ads"
      : "Display Ads",
    analyzedAt: new Date().toISOString(),
    // scores above come straight from toChannelScores(swData, ...) at the
    // call site — carry the source's isEstimated flag so this verdict
    // doesn't read as more confident than the data backing it.
    isEstimated,
  };
}

// ─── GEMINI AI — Batch Analysis tất cả đối thủ cùng lúc ──

interface CompetitorSyncData {
  competitor: IntelCompetitor;
  swData: SimilarWebData;
  scores: Record<string, number>;
  fbAds: FBKeywordAd[];
  ggAds: GoogleTransparencyData;
  ttAds: TikTokAdData[];
}

async function analyzeAllCompetitors(
  allData: CompetitorSyncData[]
): Promise<MarketAnalysis> {
  const geminiKey = process.env.GEMINI_API_KEY;

  // Domains whose SimilarWeb numbers feeding this batch are estimated/fallback,
  // not a real measurement — surfaced on the result so the UI can warn
  // wherever the resulting verdict is shown, and fed to Gemini below so the
  // verdict text itself hedges instead of reading as fully confident.
  const estimatedDomains = allData
    .filter((d) => d.swData.isEstimated)
    .map((d) => d.competitor.domain);

  if (!geminiKey) {
    return createFallbackMarketAnalysis(allData, estimatedDomains);
  }

  // Compact summary — chỉ gửi số liệu cần thiết, không gửi full object
  const summary = allData
    .map(({ competitor, swData, scores, fbAds, ggAds, ttAds }) => {
      const totalFB = fbAds.reduce((s, a) => s + a.adCount, 0);
      const visits  = Math.round(getLatestVisits(swData) / 1000);
      const estimatedTag = swData.isEstimated ? " [THIẾU SỐ SIMILARWEB — visits/src=0 là CHƯA ĐO, không phải bằng 0]" : "";
      return `${competitor.domain}: visits=${visits}K | ` +
        `src=D${(swData.trafficSources.direct * 100).toFixed(0)}%` +
        `/S${(swData.trafficSources.search * 100).toFixed(0)}%` +
        `/Sc${(swData.trafficSources.social * 100).toFixed(0)}%` +
        `/P${(swData.trafficSources.paid   * 100).toFixed(0)}%` +
        ` | scores=FB${scores.facebook}/GG${scores.google}/TT${scores.tiktok}/SEO${scores.seo}` +
        ` | ads=FB${totalFB}/GG${ggAds.totalAds}/TT${ttAds.length}${estimatedTag}`;
    })
    .join("\n");

  // Build dynamic competitorHighlights schema from actual data
  const highlightSchema = allData
    .map(({ competitor }) =>
      `{"domain":"${competitor.domain}","strategy":"<1 câu>","threat":"low|medium|high"}`
    )
    .join(",\n    ");

  const hedgeInstruction = estimatedDomains.length > 0
    ? `\nLưu ý: các domain có nhãn [DỮ LIỆU ƯỚC TÍNH] (${estimatedDomains.join(", ")}) không có số đo SimilarWeb thật — nếu kết luận (marketOverview, dominantChannels, competitorHighlights liên quan các domain đó) dựa phần lớn vào các domain này, hãy diễn đạt thận trọng hơn, thêm cụm "(dựa trên dữ liệu ước tính)" thay vì khẳng định chắc chắn.\n`
    : "";

  const prompt = `Chuyên gia digital marketing VN. Thị trường: domain/hosting/email doanh nghiệp.
Data ${allData.length} đối thủ:
${summary}
${hedgeInstruction}
Trả về JSON (CHỈ JSON):
{
  "marketOverview": "<1-2 câu>",
  "dominantChannels": {"channel": "<google|facebook|seo|tiktok|email|direct>", "reason": "<ngắn gọn>"},
  "underinvestedChannels": ["<channel>"],
  "competitorHighlights": [
    ${highlightSchema}
  ],
  "opportunityForMBC": {"bestChannel": "<channel>", "reasoning": "<ngắn gọn>", "quickWin": "<action cụ thể>"}
}`;

  try {
    const geminiRes = await callGemini(
      prompt,
      // thinkingBudget: 0 là bắt buộc cho mọi lời gọi đòi JSON: token suy nghĩ ăn
      // vào chính maxOutputTokens, nên thiếu dòng này thì JSON bị cắt giữa chừng và
      // JSON.parse bên dưới hỏng — trông như "AI không trả lời được". Đây là chỗ
      // thứ 8 cùng lỗi; 7 chỗ trước đã sửa ở đợt Policy Radar.
      { temperature: 0.3, maxOutputTokens: 1024, responseMimeType: "application/json", thinkingBudget: 0 },
      geminiKey
    );

    const parsed = JSON.parse(geminiRes.text);
    return {
      ...parsed,
      estimatedDomains,
      analyzedAt: new Date().toISOString(),
    } as MarketAnalysis;
  } catch (err) {
    console.error("[Gemini] Batch analysis failed:", err);
    return createFallbackMarketAnalysis(allData, estimatedDomains);
  }
}

function createFallbackMarketAnalysis(
  allData: CompetitorSyncData[],
  estimatedDomains: string[] = []
): MarketAnalysis {
  // Tính channel trung bình
  const avgScores: Record<string, number> = { facebook: 0, google: 0, tiktok: 0, seo: 0, email: 0, direct: 0 };
  for (const d of allData) {
    for (const [k, v] of Object.entries(d.scores)) {
      avgScores[k] = (avgScores[k] || 0) + v;
    }
  }
  const n = allData.length || 1;
  for (const k of Object.keys(avgScores)) avgScores[k] = Math.round(avgScores[k] / n);

  const sorted = Object.entries(avgScores).sort((a, b) => b[1] - a[1]);
  const dominant = sorted[0]?.[0] || "seo";
  const weak = sorted[sorted.length - 1]?.[0] || "email";
  const underinvested = sorted.filter(([, v]) => v < 15).map(([k]) => k);

  return {
    marketOverview: `Ngành hosting/domain VN đang tập trung chủ yếu vào ${dominant} và ${sorted[1]?.[0] || "google"}. ${weak} là kênh ít được đầu tư nhất.`,
    dominantChannels: {
      channel: dominant,
      reason: `${dominant} có điểm trung bình cao nhất (${sorted[0]?.[1]}), cho thấy đa số đối thủ đang đổ nguồn lực vào kênh này.`,
    },
    underinvestedChannels: underinvested.length > 0 ? underinvested : [weak],
    competitorHighlights: allData.map(({ competitor, scores }) => {
      const topCh = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
      const totalScore = Object.values(scores).reduce((s, v) => s + v, 0);
      return {
        domain: competitor.domain,
        strategy: `Tập trung ${topCh?.[0]} (${topCh?.[1]}/100), tổng lực ${totalScore} điểm.`,
        threat: (totalScore > 200 ? "high" : totalScore > 120 ? "medium" : "low") as "low" | "medium" | "high",
      };
    }),
    opportunityForMBC: {
      bestChannel: weak,
      reasoning: `${weak} có điểm trung bình thấp nhất (${sorted[sorted.length - 1]?.[1]}), ít cạnh tranh trong ngành.`,
      quickWin: weak === "email" ? "Thiết lập email automation sequence cho khách mới đăng ký"
        : weak === "tiktok" ? "Tạo 3-5 video ngắn giới thiệu sản phẩm trên TikTok"
        : weak === "facebook" ? "Chạy 2-3 campaign Facebook retargeting website visitors"
        : "Tối ưu landing page cho Google Ads với A/B testing",
    },
    analyzedAt: new Date().toISOString(),
    estimatedDomains,
  };
}

// ─── ALERT CHECK — Spike Detection ──

export async function checkForAlerts(
  competitorId: string,
  competitorName: string,
  newScores: Record<string, number>,
  newVisits: number
): Promise<void> {
  const lastSnap = getLastSnapshot(competitorId);

  if (lastSnap) {
    // Check từng kênh
    for (const [channel, newVal] of Object.entries(newScores)) {
      const oldVal = lastSnap.scores[channel] ?? 0;
      if (oldVal === 0) continue;

      const changePct = ((newVal - oldVal) / oldVal) * 100;

      if (changePct >= 30) {
        await addAlert({
          id: `alert_${competitorId}_${channel}_${Date.now()}`,
          type: "CHANNEL_SPIKE",
          competitor: competitorName,
          channel,
          changePercent: Math.round(changePct),
          message: `${competitorName} tăng mạnh ${channel.toUpperCase()} +${Math.round(changePct)}%`,
          level: changePct >= 50 ? "high" : "medium",
          isRead: false,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Overall traffic spike
    if (lastSnap.monthlyVisits > 0) {
      const visitChange =
        ((newVisits - lastSnap.monthlyVisits) / lastSnap.monthlyVisits) * 100;
      if (visitChange >= 20) {
        await addAlert({
          id: `alert_traffic_${competitorId}_${Date.now()}`,
          type: "TRAFFIC_SPIKE",
          competitor: competitorName,
          channel: "overall",
          changePercent: Math.round(visitChange),
          message: `${competitorName} traffic tổng tăng +${Math.round(visitChange)}%`,
          level: "high",
          isRead: false,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  // Save snapshot
  await saveSnapshot({
    competitorId,
    weekOf: new Date().toISOString(),
    scores: newScores,
    monthlyVisits: newVisits,
    measured: true,
  });
}

// ─── FULL SYNC ORCHESTRATOR ──

export async function syncAllIntelligence(): Promise<{
  synced: number;
  errors: string[];
  details: { name: string; status: string }[];
}> {
  const apifyToken = process.env.APIFY_API_TOKEN;
  const serpApiKey = process.env.SERP_API_KEY;
  const searchApiKey = process.env.SEARCH_API_KEY;

  const errors: string[] = [];
  const details: { name: string; status: string }[] = [];
  let synced = 0;

  // Collect all data for batch Gemini analysis
  const allCompetitorData: CompetitorSyncData[] = [];

  // 1. Fetch SimilarWeb tất cả đối thủ song song (cache 24h)
  console.log("[Intel Sync] Step 1: Fetching SimilarWeb data (parallel)...");
  const swResults = await fetchAllCompetitorsSW();

  // 2. Xử lý từng đối thủ — fetch ads + tính scores
  for (const swResult of swResults) {
    const { competitor, data: swData } = swResult;

    if (!swData) {
      // fetchSimilarWeb() itself already has an honestly-flagged
      // (isEstimated:true) fallback for real fetch failures — swData is
      // only null here if that call unexpectedly rejected outright.
      // Skip this competitor rather than fabricate a second layer of data.
      console.error(`[Intel Sync] ${competitor.name}: no SimilarWeb data (fetch rejected)`);
      errors.push(`${competitor.name}: SimilarWeb fetch rejected`);
      details.push({ name: competitor.name, status: "❌ SimilarWeb fetch rejected" });
      continue;
    }

    try {
      const effectiveSW = swData;
      await setSWData(competitor.domain, effectiveSW);

      // Fetch ads song song
      console.log(`[Intel Sync] ${competitor.name}: Fetching ads (parallel)...`);
      const [fbAds, ggAds, ttAds] = await Promise.all([
        fetchFBAdsByKeyword(competitor, apifyToken),
        fetchGoogleTransparency(competitor.domain, serpApiKey),
        fetchTikTokAds(competitor.name, searchApiKey),
      ]);

      await setFBKeywordAds(competitor.id, fbAds);
      await setGoogleAds(competitor.domain, ggAds);
      await setTikTokAds(competitor.id, ttAds);

      // Tính channel scores
      const totalFBAds = fbAds.reduce((s, a) => s + a.adCount, 0);
      const scores = toChannelScores(effectiveSW, totalFBAds, ggAds.totalAds, ttAds.length);

      // Save per-competitor analysis (fallback, sẽ được enrich bởi batch Gemini)
      const perCompAnalysis = createFallbackPerCompetitor(competitor.id, scores, !!effectiveSW.isEstimated);
      await setChannelAnalysis(competitor.id, perCompAnalysis);

      // Check alerts (spike vs tuần trước) — CHỈ khi SimilarWeb đo đủ; thiếu số thì không báo tăng/giảm, không ghi ảnh chụp tuần.
      if (usableForTrend(effectiveSW)) await checkForAlerts(competitor.id, competitor.name, scores, getLatestVisits(effectiveSW));

      // Collect for batch analysis
      allCompetitorData.push({
        competitor,
        swData: effectiveSW,
        scores,
        fbAds,
        ggAds,
        ttAds,
      });

      synced++;
      details.push({ name: competitor.name, status: effectiveSW.isEstimated ? "✅ OK (estimated)" : "✅ OK" });
      console.log(`[Intel Sync] ${competitor.name} — done`);
    } catch (err) {
      console.error(`[Intel Sync] ${competitor.name} failed:`, err);
      errors.push(`${competitor.name}: ${String(err)}`);
      details.push({
        name: competitor.name,
        status: `❌ ${String(err).slice(0, 80)}`,
      });
    }
  }

  // 3. Gemini Batch Analysis — phân tích TẤT CẢ đối thủ cùng lúc
  if (allCompetitorData.length > 0) {
    console.log("[Intel Sync] Step 3: Gemini batch analysis (all competitors)...");
    try {
      const marketAnalysis = await analyzeAllCompetitors(allCompetitorData);
      await setMarketAnalysis(marketAnalysis);

      // Enrich per-competitor analysis từ batch highlights
      if (marketAnalysis.competitorHighlights) {
        for (const highlight of marketAnalysis.competitorHighlights) {
          const compData = allCompetitorData.find(
            (d) => d.competitor.domain === highlight.domain
          );
          if (compData) {
            const existing = createFallbackPerCompetitor(
              compData.competitor.id,
              compData.scores,
              !!compData.swData.isEstimated
            );
            existing.channelSummary = highlight.strategy;
            await setChannelAnalysis(compData.competitor.id, existing);
          }
        }
      }

      console.log("[Intel Sync] Gemini batch analysis — done");
    } catch (err) {
      console.error("[Intel Sync] Market analysis failed:", err);
    }
  }

  await setLastSyncAt(new Date().toISOString());
  return { synced, errors, details };
}

