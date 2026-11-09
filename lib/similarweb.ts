// ─────────────────────────────────────────────
// SimilarWeb — Undocumented API + 24h Cache
// Không cần API key
// ─────────────────────────────────────────────

import { INTEL_COMPETITORS } from "./intelligence-config";

// ── Types ──

export interface SimilarWebData {
  domain: string;
  globalRank: number;
  countryRank: number;
  categoryRank: number;
  category: string;
  monthlyVisits: Record<string, number>; // { "2026-01-01": 278135 }
  trafficSources: {
    direct: number;   // 0–1 (VD: 0.40 = 40%)
    search: number;
    social: number;
    mail: number;
    referral: number;
    paid: number;     // display ads
  };
  topSocialNetworks: Array<{
    name: string;   // "Facebook", "YouTube", "TikTok"
    value: number;  // % của social traffic
  }>;
  bounceRate: number;
  fetchedAt: Date;
  /** True khi SimilarWeb lỗi/bị chặn hoặc trả thiếu nguồn traffic — phần thiếu để 0/trống (không bịa),
   * UI phải báo "thiếu số", cảnh báo/ảnh chụp tuần không dùng bản này. */
  isEstimated?: boolean;
  /** Bản ghi từ 07/10 trở đi (không còn bù số tự chế). Bản ghi cũ isEstimated mà thiếu cờ này có thể chứa số bịa → đọc ra phải lọc. */
  noInvent?: boolean;
}

// ── In-Memory Cache (TTL = 24h) ──

const SW_CACHE = new Map<
  string,
  { data: SimilarWebData; fetchedAt: number }
>();

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 giờ

// ── Fetch single domain ──

export async function fetchSimilarWeb(
  domain: string
): Promise<SimilarWebData | null> {
  // 1. Check cache trước
  const cached = SW_CACHE.get(domain);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    console.log(`[SimilarWeb] Cache hit for ${domain}`);
    return cached.data;
  }

  try {
    const res = await fetch(
      `https://data.similarweb.com/api/v1/data?domain=${domain}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
            "AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const raw = await res.json();

    const data: SimilarWebData = {
      domain,
      globalRank: raw.GlobalRank?.Rank ?? 0,
      countryRank: raw.CountryRank?.Rank ?? 0,
      categoryRank: raw.CategoryRank?.Rank ?? 0,
      category: raw.Category ?? "",

      // Monthly visits: lấy 3 tháng gần nhất
      monthlyVisits: raw.EstimatedMonthlyVisits ?? {},

      trafficSources: {
        direct: raw.TrafficSources?.direct ?? 0,
        search: raw.TrafficSources?.search ?? 0,
        social: raw.TrafficSources?.social ?? 0,
        mail: raw.TrafficSources?.mail ?? 0,
        referral: raw.TrafficSources?.referrals ?? 0,
        paid: raw.TrafficSources?.paid_referrals ?? 0,
      },

      topSocialNetworks: raw.TopSocialNetworks ?? [],
      bounceRate: raw.Engagments?.BounceRate ?? 0,
      fetchedAt: new Date(),
    };

    // Kiểm tra data hợp lệ: nếu traffic sources TOÀN = 0 → data không đủ ý nghĩa
    const totalTraffic = Object.values(data.trafficSources).reduce((s, v) => s + v, 0);

    if (totalTraffic < 0.01) {
      // Soát dữ liệu 07/10: KHÔNG bù số tự chế — giữ đúng phần API trả, phần thiếu để trống + gắn cờ.
      console.warn(`[SimilarWeb] Traffic data for ${domain} is empty (all zeros) — marked incomplete, nothing invented`)
      const enriched: SimilarWebData = { ...data, isEstimated: true, noInvent: true }
      SW_CACHE.set(domain, { data: enriched, fetchedAt: Date.now() });
      return enriched;
    }

    // 2. Lưu cache
    SW_CACHE.set(domain, { data, fetchedAt: Date.now() });
    console.log(`[SimilarWeb] Fetched & cached ${domain} (rank #${data.countryRank}, traffic: ${(totalTraffic * 100).toFixed(0)}%)`);

    return data;
  } catch (err) {
    console.error(`[SimilarWeb] Fetch failed for ${domain}:`, err);
    // Soát dữ liệu 07/10: lỗi/bị chặn → trả bản RỖNG gắn cờ, không bịa hạng/lượt truy cập/nguồn traffic.
    const mockData: SimilarWebData = emptyData(domain)
    SW_CACHE.set(domain, { data: mockData, fetchedAt: Date.now() });
    return mockData;
  }
}

// ── Fetch tất cả đối thủ song song ──

export async function fetchAllCompetitorsSW(): Promise<
  Array<{
    competitor: (typeof INTEL_COMPETITORS)[number];
    data: SimilarWebData | null;
    error: string | null;
  }>
> {
  const results = await Promise.allSettled(
    INTEL_COMPETITORS.map((c) => fetchSimilarWeb(c.domain))
  );

  return results.map((r, i) => ({
    competitor: INTEL_COMPETITORS[i],
    data: r.status === "fulfilled" ? r.value : null,
    error: r.status === "rejected" ? String(r.reason) : null,
  }));
}

// ── Convert traffic sources → Channel Scores 0-100 ──
// Ví dụ thực tế: pavietnam.vn
//   TrafficSources.search = 0.563 → SEO score = 56
//   TrafficSources.social = 0.005 → social base = 1
//   TrafficSources.paid   = 0.025 → display base = 3

export function toChannelScores(
  sw: SimilarWebData,
  fbAdCount: number, // số ads FB đang chạy
  ggAdCount: number, // số ads Google đang chạy
  ttAdCount: number  // số ads TikTok đang chạy
): Record<string, number> {

  // Base scores từ SimilarWeb traffic %
  const seoScore    = Math.round(sw.trafficSources.search   * 100);
  const emailScore  = Math.round(sw.trafficSources.mail     * 100);
  const directScore = Math.round(sw.trafficSources.direct   * 100);

  // FB score = social traffic + boost nếu có ads đang chạy
  const fbScore = Math.round(Math.min(100,
    Math.round(sw.trafficSources.social * 100)
    + (fbAdCount > 20 ? 40 : fbAdCount > 10 ? 25 : fbAdCount > 0 ? 10 : 0)
  ));

  // Google score = paid traffic × 3 + SEO signal + ad boost
  const ggScore = Math.round(Math.min(100,
    Math.round(sw.trafficSources.paid * 100) * 3
    + (ggAdCount > 10 ? 30 : ggAdCount > 0 ? 15 : 0)
  ));

  // TikTok — check trong topSocialNetworks
  const ttSocialShare = sw.topSocialNetworks
    ?.find(n => n.name?.toLowerCase().includes("tiktok"))
    ?.value ?? 0;

  const ttScore = Math.round(Math.min(100,
    Math.round(ttSocialShare * 100)
    + (ttAdCount > 5 ? 40 : ttAdCount > 0 ? 20 : 0)
  ));

  return {
    facebook: fbScore,
    google:   ggScore,
    tiktok:   ttScore,
    seo:      seoScore,
    email:    emailScore,
    direct:   directScore,
  };
}

// ── Helper: get latest monthly visits ──

export function getLatestVisits(sw: SimilarWebData): number {
  const entries = Object.entries(sw.monthlyVisits);
  if (entries.length === 0) return 0;
  // Sort by key (date string) desc
  entries.sort((a, b) => b[0].localeCompare(a[0]));
  return entries[0][1] ?? 0;
}

// ── Cache management ──

export function clearSWCache(): void {
  SW_CACHE.clear();
}

export function getSWCacheStatus(): {
  size: number;
  domains: string[];
} {
  return {
    size: SW_CACHE.size,
    domains: Array.from(SW_CACHE.keys()),
  };
}

// ── Khi SimilarWeb không trả số ──
// Trước 07/10 chỗ này sinh số "ước lượng" từ hồ sơ gõ tay + dao động ±10% mỗi ngày — đã gỡ (luật không bịa số).

/** Bản rỗng khi SimilarWeb lỗi/bị chặn — mọi số = 0/trống (UI hiện "N/A"), isEstimated=true nghĩa là THIẾU số đo. */
export function emptyData(domain: string): SimilarWebData {
  return {
    domain, globalRank: 0, countryRank: 0, categoryRank: 0, category: "",
    monthlyVisits: {},
    trafficSources: { direct: 0, search: 0, social: 0, mail: 0, referral: 0, paid: 0 },
    topSocialNetworks: [], bounceRate: 0, fetchedAt: new Date(), isEstimated: true, noInvent: true,
  }
}

/** Bản ghi cũ (trước 07/10) gắn isEstimated có thể chứa hạng/lượt truy cập/nguồn traffic bịa → thay bằng bản rỗng khi đọc ra. */
export function scrubLegacyEstimate(sw: SimilarWebData): SimilarWebData {
  if (!sw.isEstimated || sw.noInvent) return sw
  return { ...emptyData(sw.domain), fetchedAt: sw.fetchedAt }
}

/** Cảnh báo tăng đột biến + ảnh chụp tuần chỉ dùng số SimilarWeb đo đủ. */
export function usableForTrend(sw: SimilarWebData): boolean {
  return !sw.isEstimated
}
