// ============================================================
// Creative Pipeline — Types, Helpers, FB Mapping
// ============================================================
import { META_GRAPH_BASE, META_GRAPH_VERSION } from "@/lib/meta/graph-version"
import { applyPlacementRules } from "@/lib/case/meta-placements"

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface CreativeResult {
  id: string;
  segmentName: string;
  segmentIndex: number;
  funnelStage: "TOFU" | "MOFU" | "BOFU" | string;
  tone: string;
  toneLabel: string;
  platform: "facebook" | "google";
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
  /** Gemini's raw quality estimate (1-10) — use detailedScore for structured evaluation */
  score?: number;
  reason?: string;
  selected: boolean;
  /** Full 6-dimension breakdown from scoreCreative() — authoritative score, 0-100 */
  detailedScore?: import("@/lib/creative-scorer").CreativeScore;
  /** ID of the CreativeBrief this creative was generated from, if any */
  briefId?: string;
  /** false if headline/primaryText/description still exceed the platform's character limit after generation + 1 retry */
  withinLimits?: boolean;
  limitViolations?: import("@/lib/creative-limits").LimitViolation[];
  /** Product key inferred at generation time, e.g. "hosting" — used to re-check compliance at launch preflight */
  productKey?: string;
  complianceNotes?: import("@/lib/creative-brief/types").ComplianceNote[];
  // Image fields — for generated creatives
  imageUrl?: string;    // Local preview URL (blob:// hoặc https://)
  imageHash?: string;   // FB image_hash sau khi upload lên FB Ad Account
  // Existing post fields
  objectStoryId?: string;      // "pageId_postId" — dùng bài đã đăng
  isExistingPost?: boolean;
  postThumbnail?: string;
  postEngagement?: { likes: number; comments: number; shares: number };
}

export interface PagePost {
  id: string;
  postId: string;
  objectStoryId: string;
  message: string;
  createdTime: string;
  thumbnail: string | null;
  mediaType: "photo" | "video" | "link" | "text" | string;
  engagement: {
    likes: number;
    comments: number;
    shares: number;
  };
}

export interface LaunchConfig {
  campaignName: string;
  objectiveKey: string; // OUTCOME_SALES | OUTCOME_LEADS | OUTCOME_TRAFFIC
  objective: string; // legacy — kept for backward compat
  company: string;
  budgetType: "cbo" | "adset";
  dailyBudget: number; // VND — campaign-level CBO budget
  adsetBudget?: number; // legacy
  adSetDailyBudget: number; // VND — per ad set daily budget
  bidStrategy: "LOWEST_COST_WITHOUT_CAP" | "COST_CAP" | "BID_CAP";
  bidAmount?: number; // VND — required when bidStrategy is COST_CAP or BID_CAP
  optimizationGoal: string; // auto-derived from objectiveKey
  /** Sự kiện tiêu chuẩn — enum custom_event_type THẬT của Meta (PURCHASE,
   *  CONTENT_VIEW, INITIATED_CHECKOUT…). Xem lib/meta-pixel-events.ts. */
  pixelEvent?: string;
  /** ID chuyển đổi tuỳ chỉnh, khi người dùng chọn một mục trong nhóm
   *  "Chuyển đổi tùy chỉnh". Có giá trị thì nó thắng pixelEvent. */
  customConversionId?: string;
  /** Tên sự kiện tuỳ chỉnh do web tự bắn (thank_page, form_submit…) khi
   *  người dùng chọn một sự kiện không nằm trong bảng enum của Meta. */
  pixelCustomEventName?: string;
  pixelId?: string; // Facebook Pixel ID — user-selected from get-pixels API
  startDate: string; // YYYY-MM-DD
  endDate?: string;
  continuous: boolean;
  destinationUrl: string;
  pageId: string; // Facebook Page ID — user-selected
  pageName?: string; // Facebook Page Name — for DSA compliance
  segments: LaunchSegment[];
  creatives: CreativeResult[];
  includeInstagram?: boolean; // default false (Facebook-only); true adds Instagram placements
  useAdvantageAudience?: boolean; // default false; true = skip detailed targeting, use Advantage+ only
  autoUTM?: boolean; // default true; append UTM params to destinationUrl
  enableDCO?: boolean; // default false; true = Dynamic Creative — all segment creatives → 1 ad with asset_feed_spec
  /** default false (an toàn) — true = tạo Campaign/AdSet/Ad với status ACTIVE
   *  thay vì PAUSED, nghĩa là chiến dịch CHẠY THẬT và tiêu ngân sách ngay khi
   *  tạo xong. Cả 3 cấp đều phải ACTIVE thì Meta mới thật sự chạy — chỉ đổi
   *  Campaign thôi (như toggle-campaign vẫn làm) không đủ. */
  launchActive?: boolean;
  /** Đợt 7b — mã sản phẩm của wizard (ten-mien, hosting…) để ghi sổ + chấm kinh nghiệm. */
  productKey?: string;
  /** Đợt 7b — vị trí (khoá "facebook:marketplace"…) bỏ khỏi mọi nhóm, theo Sổ kinh nghiệm hoặc người dùng chọn. */
  excludePlacements?: string[];
  /** Đợt 7b — mã dòng Sổ kinh nghiệm người dùng giữ/thêm vào lượt tạo này. */
  playbookEntryIds?: string[];
  /** Đợt 7b — mã dòng "Nên tránh" người dùng vẫn chọn trái khuyến nghị. */
  playbookOverriddenAvoidIds?: string[];
}

export interface LaunchSegment {
  segmentName: string;
  funnelStage: string;
  demographics: {
    ageMin: number;
    ageMax: number;
    gender: "all" | "male" | "female";
    locations: string[];
  };
  interests: string[];
  behaviors: string[];
  jobTitles?: string[];
  excludeAudiences?: string[];
  /** Pre-resolved FB interest IDs from the resolve-interests API.
   *  If provided, mapSegmentToFBTargeting will use these directly
   *  instead of re-calling the FB search API. */
  resolvedInterestIds?: Array<{ id: string; name: string }>;
  /** Đợt 26c: phân khúc lấy từ "tệp thắng" đã lưu (lib/meta/winning-audiences.ts) — tạo nhóm bằng ĐÚNG cấu hình nhắm chọn đó. */
  winningAudienceId?: string;
  /** Saved Meta Custom Audience IDs — when set, targeting uses custom_audiences
   *  instead of interests/behaviors. */
  customAudienceIds?: string[];
  /** Tệp cần LOẠI TRỪ (vd khách đã mua). Khác customAudienceIds ở chỗ nó
   *  không thay thế interests — loại trừ chồng lên bất kỳ cách nhắm nào. */
  excludeCustomAudienceIds?: string[];
}

export interface LaunchResult {
  success: boolean;
  campaignId?: string;
  campaignName?: string;
  adSetCount?: number;
  adCount?: number;
  error?: string;
  log?: string[];
  /** true = tạo với status ACTIVE (đang chạy thật), false = PAUSED (tắt sẵn). */
  launchActive?: boolean;
}

// ─────────────────────────────────────────────
// FB Objective Mapping (rich — includes optimization_goal + billing_event)
// ─────────────────────────────────────────────

export const OBJECTIVE_MAP: Record<string, {
  objective: string;
  optimization_goal: string;
  billing_event: string;
}> = {
  OUTCOME_SALES:   { objective: "OUTCOME_SALES",   optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS" },
  OUTCOME_LEADS:   { objective: "OUTCOME_LEADS",   optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS" },
  OUTCOME_TRAFFIC: { objective: "OUTCOME_TRAFFIC", optimization_goal: "LINK_CLICKS",         billing_event: "IMPRESSIONS" },
};

// Legacy mapping — kept for backward compat
export const FB_OBJECTIVES: Record<string, string> = {
  "increase_sales":   "OUTCOME_SALES",
  "increase_traffic": "OUTCOME_TRAFFIC",
  "lead_generation":  "OUTCOME_LEADS",
  "brand_awareness":  "OUTCOME_AWARENESS",
  "OUTCOME_SALES":    "OUTCOME_SALES",
  "OUTCOME_LEADS":    "OUTCOME_LEADS",
  "OUTCOME_TRAFFIC":  "OUTCOME_TRAFFIC",
};

// ─────────────────────────────────────────────
// FBTargeting Interface
// ─────────────────────────────────────────────

export interface FBTargeting {
  geo_locations: Record<string, unknown>;
  age_min: number;
  age_max: number;
  genders?: number[];
  flexible_spec?: Record<string, unknown>[];
  exclusions?: Record<string, unknown>[];
  // Advantage+ Audience — MUST be inside targeting per FB API docs
  targeting_automation?: { advantage_audience: 0 | 1 };
  // Saved Meta Custom Audiences
  custom_audiences?: Array<{ id: string }>;
  /** Tệp LOẠI TRỪ — vd tệp khách đã mua, để chỉ đuổi theo khách mới.
   *
   *  Đây là thứ gần nhất với "Chiến lược vòng đời khách hàng" mà Ads Manager
   *  mới mở: Meta CHƯA có trường API nào cho tính năng đó (tra bảng Ad Set
   *  API 11/09/2026 — chỉ có existing_customer_budget_percentage, là chia %
   *  ngân sách, không phải cùng một thứ). Loại trừ tệp khách cũ đạt được cùng
   *  ý đồ, nhưng KHÔNG có phần "xử lý chuyên biệt" Meta nói kèm setting gốc —
   *  giao diện phải nói rõ điều đó, không được để người dùng tưởng là một. */
  excluded_custom_audiences?: Array<{ id: string }>;
  // Placements
  publisher_platforms?: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
  audience_network_positions?: string[];
  device_platforms?: string[];
}

// ─────────────────────────────────────────────
// Placement theo Objective — Marketing API v25/v26
// 26/10/2026 (task #7099): bỏ instagram "explore" (lưới Khám phá — v26 báo lỗi khi khai rõ) và messenger "story"
// (Meta tự bỏ ở mọi phiên bản từ 27/10/2026); giữ "explore_home". Phiên bản dưới v26 bắt khai "explore" đi kèm
// "explore_home" → sanitizeTargeting gọi applyPlacementRules (lib/case/meta-placements.ts) để thêm/bỏ theo phiên bản.
// ─────────────────────────────────────────────

const PLACEMENT_BY_OBJECTIVE: Record<string, {
  facebook_positions: string[];
  instagram_positions: string[];
  audience_network_positions?: string[];
  messenger_positions?: string[];
}> = {
  // Lead / Conversions → KHÔNG có reels FB
  OUTCOME_LEADS: {
    facebook_positions: ["feed", "marketplace",
      "story", "search", "instream_video", "right_hand_column"],
    instagram_positions: ["stream", "story", "reels",
      "explore_home", "profile_feed"],
    messenger_positions: ["messenger_home"],
  },
  OUTCOME_SALES: {
    facebook_positions: ["feed", "marketplace",
      "story", "search", "instream_video", "right_hand_column"],
    instagram_positions: ["stream", "story", "reels",
      "explore_home", "profile_feed"],
    messenger_positions: ["messenger_home"],
  },
  // Traffic → reels FB không hợp lệ với API hiện tại
  OUTCOME_TRAFFIC: {
    facebook_positions: ["feed", "marketplace",
      "story", "search", "instream_video", "right_hand_column"],
    instagram_positions: ["stream", "story", "reels",
      "explore_home", "profile_feed"],
    audience_network_positions: ["classic", "instream_video"],
    messenger_positions: ["messenger_home"],
  },
  // Awareness / Reach → rộng nhất
  OUTCOME_AWARENESS: {
    facebook_positions: ["feed", "marketplace",
      "story", "search", "instream_video", "right_hand_column"],
    instagram_positions: ["stream", "story", "reels",
      "explore_home", "profile_feed", "profile_reels"],
    audience_network_positions: ["classic", "instream_video", "rewarded_video"],
    messenger_positions: ["messenger_home"],
  },
  // Engagement
  OUTCOME_ENGAGEMENT: {
    facebook_positions: ["feed", "marketplace",
      "story", "search", "right_hand_column"],
    instagram_positions: ["stream", "story", "reels",
      "explore_home", "profile_feed"],
    messenger_positions: ["messenger_home"],
  },
};

// Default an toàn nhất (nếu objective không khớp)
const SAFE_DEFAULT_PLACEMENT = {
  facebook_positions: ["feed", "story", "marketplace", "search"],
  instagram_positions: ["stream", "story", "reels", "explore_home"],
};

// ─────────────────────────────────────────────
// Sanitize Geo Targeting — Fix city/region format
// ─────────────────────────────────────────────

// Known VN city keys for name → key fallback
const VN_CITY_KEYS: Record<string, string> = {
  "Ho Chi Minh City": "1566083", "Hồ Chí Minh": "1566083", "HCM": "1566083", "TP.HCM": "1566083",
  "Hanoi": "1581130", "Hà Nội": "1581130", "HN": "1581130",
  "Da Nang": "1572666", "Đà Nẵng": "1572666",
  "Can Tho": "1565018", "Cần Thơ": "1565018",
  "Hai Phong": "1580663", "Hải Phòng": "1580663",
  "Bien Hoa": "1564752", "Biên Hòa": "1564752",
  "Nha Trang": "1574715",
  "Vung Tau": "1562414", "Vũng Tàu": "1562414",
  "Buon Ma Thuot": "1562450",
  "Huế": "1580240", "Hue": "1580240",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitizeGeoTargeting(targeting: any): any {
  if (!targeting?.geo_locations) return targeting;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geo = { ...targeting.geo_locations } as Record<string, any>;

  // ── Fix 1: Normalize cities array ──
  if (geo.cities && geo.cities.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const normalizedCities = geo.cities
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((city: any) => {
        // String → convert to key object
        if (typeof city === "string") {
          const key = VN_CITY_KEYS[city];
          if (!key) {
            console.warn(`[GeoTargeting] Unknown city string: "${city}" → skip`);
            return null;
          }
          return { key, radius: 0, distance_unit: "kilometer" };
        }
        // Object without key → skip
        if (typeof city === "object" && !city.key) {
          console.warn(`[GeoTargeting] City missing key:`, city);
          return null;
        }
        // Ensure radius + distance_unit exist
        if (typeof city === "object" && city.key) {
          return {
            key: city.key,
            radius: city.radius ?? 0,
            distance_unit: city.distance_unit ?? "kilometer",
          };
        }
        return city;
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter(Boolean) as any[];

    if (normalizedCities.length === 0) {
      delete geo.cities;
    } else {
      geo.cities = normalizedCities;
    }
  }

  // ── Fix 2: Normalize regions array ──
  if (geo.regions && geo.regions.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    geo.regions = geo.regions.filter((r: any) => {
      if (!r.key) {
        console.warn(`[GeoTargeting] Region missing key:`, r);
        return false;
      }
      return true;
    });
    if (geo.regions.length === 0) delete geo.regions;
  }

  // ── 1. Fix: countries vs cities/regions — CANNOT have both ──
  // FB coi countries:["VN"] + cities trong VN = “trùng lặp vị trí”
  // Chỉ dùng countries làm fallback khi KHÔNG có cities/regions
  if (geo.cities?.length > 0 || geo.regions?.length > 0) {
    // Có cities/regions cụ thể → XÓA countries để tránh trùng lặp
    delete geo.countries;
  } else if (!geo.countries || geo.countries.length === 0) {
    // Không có gì → fallback toàn quốc VN
    geo.countries = ["VN"];
  }

  // ── 2. Fix: location_types — city-level chỉ chấp nhận home + recent ──
  if (geo.cities?.length > 0 && geo.location_types) {
    geo.location_types = geo.location_types.filter(
      (t: string) => ["home", "recent"].includes(t)
    );
    if (geo.location_types.length === 0) delete geo.location_types;
  }

  console.log("[sanitizeGeoTargeting] Final geo_locations:", JSON.stringify(geo));

  return { ...targeting, geo_locations: geo };
}

/**
 * Sanitize targeting object — lọc placement theo objective của campaign.
 * Mỗi objective chỉ chấp nhận một tập placement nhất định.
 * Ví dụ: OUTCOME_LEADS không cho phép "reels" trong facebook_positions.
 */
export function sanitizeTargeting(
  targeting: FBTargeting,
  objective?: string,
  version: string = META_GRAPH_VERSION
): FBTargeting {
  if (!targeting) return targeting;

  // 1. Sanitize geo targeting (Fix city/region format)
  let sanitized = sanitizeGeoTargeting(targeting) as Record<string, unknown>;

  // 2. Sanitize placements
  // Lấy whitelist theo objective
  const validPlacements = (objective && PLACEMENT_BY_OBJECTIVE[objective])
    || SAFE_DEFAULT_PLACEMENT;

  const sanitizedRecord = { ...sanitized } as Record<string, unknown>;

  const platformFields = [
    "facebook_positions",
    "instagram_positions",
    "audience_network_positions",
    "messenger_positions",
  ] as const;

  for (const field of platformFields) {
    const current = sanitizedRecord[field];
    if (!current || !Array.isArray(current)) continue;

    const whitelist = (validPlacements as Record<string, string[] | undefined>)[field];

    if (!whitelist) {
      // Objective này không support platform → xóa
      console.warn(`[sanitizeTargeting][${objective}] Removed unsupported ${field}`);
      delete sanitizedRecord[field];

      // Xóa khỏi publisher_platforms
      if (sanitizedRecord.publisher_platforms && Array.isArray(sanitizedRecord.publisher_platforms)) {
        const platform = field.replace("_positions", "");
        sanitizedRecord.publisher_platforms = (sanitizedRecord.publisher_platforms as string[])
          .filter((p: string) => p !== platform);
      }
      continue;
    }

    const before = [...(current as string[])];
    const after = before.filter((pos: string) => whitelist.includes(pos));

    // Log nếu có position bị loại
    const removed = before.filter((p: string) => !after.includes(p));
    if (removed.length > 0) {
      console.warn(`[sanitizeTargeting][${objective}] Removed from ${field}:`, removed);
    }

    if (after.length === 0) {
      // Không còn position nào → dùng default safe của platform
      sanitizedRecord[field] = whitelist.slice(0, 3);
    } else {
      sanitizedRecord[field] = after;
    }
  }

  // Đồng bộ publisher_platforms với positions còn lại
  if (sanitizedRecord.publisher_platforms && Array.isArray(sanitizedRecord.publisher_platforms)) {
    const platformMap: Record<string, string> = {
      facebook: "facebook_positions",
      instagram: "instagram_positions",
      audience_network: "audience_network_positions",
      messenger: "messenger_positions",
    };

    sanitizedRecord.publisher_platforms = (sanitizedRecord.publisher_platforms as string[]).filter(
      (platform: string) => {
        const posField = platformMap[platform];
        return !posField || !sanitizedRecord[posField] ||
          (Array.isArray(sanitizedRecord[posField]) && (sanitizedRecord[posField] as string[]).length > 0);
      }
    );

    if ((sanitizedRecord.publisher_platforms as string[]).length === 0) {
      delete sanitizedRecord.publisher_platforms;
    }
  }

  // Cuối cùng: quy tắc vị trí theo phiên bản Graph API (v25 bắt explore đi kèm explore_home, v26 cấm explore).
  return applyPlacementRules(sanitizedRecord, version).body as unknown as FBTargeting;
}

// ─────────────────────────────────────────────
// Vietnamese City → FB Geo Codes
// ─────────────────────────────────────────────

export const FB_CITY_CODES: Record<string, { key: string; name: string; type: string }> = {
  "Hồ Chí Minh": { key: "1580578", name: "Ho Chi Minh City", type: "city" },
  "HCM":         { key: "1580578", name: "Ho Chi Minh City", type: "city" },
  "TP.HCM":      { key: "1580578", name: "Ho Chi Minh City", type: "city" },
  "Hà Nội":      { key: "1581130", name: "Hanoi",            type: "city" },
  "HN":          { key: "1581130", name: "Hanoi",            type: "city" },
  "Đà Nẵng":     { key: "1583992", name: "Da Nang",          type: "city" },
  "ĐN":          { key: "1583992", name: "Da Nang",          type: "city" },
  "Bình Dương":  { key: "1581302", name: "Binh Duong",       type: "province" },
  "Đồng Nai":    { key: "1582295", name: "Dong Nai",         type: "province" },
  "Hải Phòng":   { key: "1581298", name: "Hai Phong",        type: "city" },
  "Cần Thơ":     { key: "1587544", name: "Can Tho",          type: "city" },
};

// The AI is free-text (see audience-insight prompt) and routinely produces
// official-form variants like "TP. Hồ Chí Minh" or "Tỉnh Bình Dương" that
// don't exact-match any FB_CITY_CODES key above — the exact-match lookup
// then falls through to a live FB search for the RAW unnormalized string,
// which can miss and get silently dropped. Strip the common VN
// administrative prefixes before matching so "TP. Hồ Chí Minh" still hits
// the "Hồ Chí Minh" entry.
function normalizeLocationKey(s: string): string {
  return s
    .trim()
    .replace(/^(TP\.?|Tp\.?|Thành phố|Tỉnh)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

const FB_CITY_CODES_NORMALIZED: Record<string, { key: string; name: string; type: string }> =
  Object.fromEntries(
    Object.entries(FB_CITY_CODES).map(([k, v]) => [normalizeLocationKey(k), v])
  );

// ─────────────────────────────────────────────
// FB Behavior Map — Real IDs from FB Marketing API
// ─────────────────────────────────────────────

const BEHAVIOR_MAP: Record<string, { id: string; name: string }> = {
  "Small business owners":                { id: "6022788483637", name: "Small business owners" },
  "Facebook Page admins":                 { id: "6003283626097", name: "Facebook Page admins" },
  "Business decision makers":             { id: "6003672085522", name: "Business decision makers" },
  "Engaged shoppers":                     { id: "6002714895372", name: "Engaged shoppers" },
  "High-value goods purchasers in Vietnam": { id: "6107534682800", name: "High-value goods purchasers in Vietnam" },
  "Monthly spenders on ads":              { id: "6003464133172", name: "Monthly spenders on ads" },
  "Technology early adopters":            { id: "6003596184972", name: "Technology early adopters" },
  "New active business (6-12 months)":    { id: "6067522235983", name: "New active business (6-12 months)" },
  "Ads Managers":                         { id: "6003228601736", name: "Ads Managers" },
  // Vietnamese aliases
  "Chủ doanh nghiệp nhỏ":               { id: "6022788483637", name: "Small business owners" },
  "Quản trị viên Fanpage doanh nghiệp":  { id: "6003283626097", name: "Facebook Page admins" },
  "Người đưa ra quyết định mua sắm":     { id: "6003672085522", name: "Business decision makers" },
  "Người đưa ra quyết định kinh doanh":   { id: "6003672085522", name: "Business decision makers" },
  "Người mua sắm tích cực":              { id: "6002714895372", name: "Engaged shoppers" },
  "Sử dụng thanh toán điện tử":          { id: "6002714895372", name: "Engaged shoppers" },
  "Người mua sắm trực tuyến":            { id: "6002714895372", name: "Engaged shoppers" },
  "Thường xuyên mua sắm trực tuyến B2B": { id: "6002714895372", name: "Engaged shoppers" },
  "Người sử dụng thiết bị di động cao cấp": { id: "6003596184972", name: "Technology early adopters" },
  "Sử dụng thiết bị di động cao cấp":    { id: "6003596184972", name: "Technology early adopters" },
  "Người sớm áp dụng công nghệ":         { id: "6003596184972", name: "Technology early adopters" },
  "Người đưa ra quyết định mua sắm trong công ty": { id: "6003672085522", name: "Business decision makers" },
};

// ─────────────────────────────────────────────
// CTA — Label ↔ Meta call_to_action_type mapping
// ─────────────────────────────────────────────
// Single source of truth for every layer that touches a creative's CTA: the
// AI generation prompt's allowed values, this app's own ad-preview label,
// and the real Meta enum sent at launch. Previously each layer had its own
// disconnected idea of what CTAs exist — the AI prompt offered "Get Offer",
// the preview's label map didn't have an entry for it, and launch-time used
// a naive `.replace(/\s+/g,"_").toUpperCase()` that happily produced the
// real-but-wrong enum GET_OFFER (that value requires a linked Meta Offer
// object, which this pipeline never creates, so Facebook shows the CTA
// button as "Không xác định (GET_OFFER)" on a plain link ad).
export const CTA_OPTIONS: Array<{ metaValue: string; labelVi: string }> = [
  { metaValue: "SHOP_NOW",   labelVi: "Mua ngay" },
  { metaValue: "LEARN_MORE", labelVi: "Tìm hiểu thêm" },
  { metaValue: "SIGN_UP",    labelVi: "Đăng ký" },
  { metaValue: "DOWNLOAD",   labelVi: "Tải xuống" },
  { metaValue: "CONTACT_US", labelVi: "Liên hệ với chúng tôi" },
];

export const CTA_LABELS_VI: Record<string, string> = Object.fromEntries(
  CTA_OPTIONS.map(o => [o.metaValue, o.labelVi])
);

// Values the AI/free-text field may still contain (legacy generations, or a
// value that requires a Meta object type this pipeline doesn't create) —
// remapped to the closest valid CTA for a plain link_data ad instead of
// being sent to Meta as-is.
const CTA_ALIASES: Record<string, string> = {
  GET_OFFER: "SHOP_NOW",
};

/** Resolve free-text/AI-generated CTA ("Shop Now", "Get Offer", ...) → a real, launch-safe Meta call_to_action_type. */
export function resolveCtaType(rawCta: string | undefined): string {
  const normalized = (rawCta ?? "").trim().replace(/\s+/g, "_").toUpperCase();
  if (!normalized) return "LEARN_MORE";
  if (CTA_LABELS_VI[normalized]) return normalized;
  if (CTA_ALIASES[normalized]) return CTA_ALIASES[normalized];
  return "LEARN_MORE";
}

// ─────────────────────────────────────────────
// Loại trừ chi tiết (sở thích/hành vi) — Meta ĐÃ BỎ
// ─────────────────────────────────────────────
// Changelog Marketing API v22.0: không tạo mới loại trừ nhắm chọn chi tiết (`targeting.exclusions`) — áp mọi phiên bản
// từ 21/04/2025; các ID hành vi trong bảng EXCLUSION_MAP cũ cũng đã bị Meta khai tử (đo 25/08/2026, subcode 1487694).
// Còn loại trừ được: TỆP KHÁCH (`excluded_custom_audiences`). `excludeAudiences` dạng chữ của AI chỉ còn được báo ra
// nhật ký tạo chiến dịch (ignoredExclusions), không gửi lên Meta. Bỏ 26/10/2026, task #7099.

// ─────────────────────────────────────────────
// Interest ID Resolution via FB Search API (with cache)
// ─────────────────────────────────────────────

const META_BASE = META_GRAPH_BASE;

// Module-level cache for interest lookups
const interestCache = new Map<string, { id: string; name: string } | null>();

// FB's adinterest search does fuzzy cross-language matching and will
// happily return a completely unrelated entity as the #1 result for a
// short keyword — confirmed live:
//   "Fashion" (vi_VN locale)         → "Fashion (band)" (a musical act)
//   "Online shopping" (vi_VN locale) → "Daraz Online Shopping" (a
//     Bangladesh/Pakistan-focused app, not a generic VN-relevant category)
// Both resolve correctly once the SAME query is searched in en_US instead
// ("Online shopping" → "Online shopping" itself, 1.3B+ audience). So:
// pick locale by the query's own script (Vietnamese diacritics → vi_VN
// first, else en_US first), request a wider candidate pool, and reject
// candidates that share no real word with the query — "Brand protection"
// only ever returns "Sports equipment" in every locale (zero word
// overlap), which is now dropped instead of forced in as noise.
const STOPWORDS = new Set(["a", "an", "the", "and", "or", "for", "of", "in", "on", "to", "với", "và", "cho", "của", "là"]);

function hasVietnameseChars(s: string): boolean {
  return /[^\x00-\x7F]/.test(s);
}

function relevantWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[().,]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function isRelevantMatch(query: string, candidateName: string): boolean {
  const queryWords = relevantWords(query);
  if (queryWords.length === 0) return true; // nothing to judge against — don't block
  const lowerName = candidateName.toLowerCase();
  return queryWords.some(w => lowerName.includes(w));
}

/**
 * Resolve one interest keyword to the best real FB interest match, or
 * null if nothing genuinely relevant exists. Exported so both this file's
 * bulk searchFBInterests() and app/api/creative/resolve-interests/route.ts
 * share the exact same matching logic instead of maintaining two
 * divergent implementations.
 */
/** Chuẩn hoá để so tên chính xác: bỏ dấu, bỏ ký tự ngoài chữ-số, gộp khoảng trắng. */
function normalizeForExactMatch(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface InterestResolution {
  match: { id: string; name: string } | null;
  /** Các ứng viên còn lại đã qua bộ lọc liên quan, xếp theo cỡ tệp giảm dần. */
  alternates: Array<{ id: string; name: string }>;
  /**
   * true khi lựa chọn giữa top-1 và top-2 là gần như tuỳ tiện.
   *
   * Bộ chọn xếp theo cỡ tệp rồi lấy đầu bảng. Khi hai ứng viên đầu có cỡ tệp
   * xấp xỉ nhau (chênh dưới 2 lần), "đầu bảng" không còn mang nghĩa "đúng hơn"
   * — nó chỉ là cái nhỉnh hơn vài phần trăm. Đó chính là kiểu chọn đã đưa
   * "Travel website" vào một chiến dịch bán TÊN MIỀN. Nói ra để người duyệt
   * quyết, thay vì im lặng chọn hộ.
   */
  ambiguous: boolean;
}

/** Bản đầy đủ: trả cả ứng viên thay thế và cờ mập mờ. Một lượt gọi Meta như cũ. */
export async function resolveInterestWithAlternates(
  query: string,
  accessToken: string
): Promise<InterestResolution> {
  const localeOrder: Array<string | undefined> = hasVietnameseChars(query)
    ? ["vi_VN", "en_US", undefined]
    : ["en_US", "vi_VN", undefined];

  for (const locale of localeOrder) {
    try {
      const params = new URLSearchParams({ type: "adinterest", q: query, limit: "8", access_token: accessToken });
      if (locale) params.set("locale", locale);
      const res = await fetch(`${META_BASE}/search?${params}`);
      const data = await res.json();
      const candidates: Array<{ id: string; name: string; audience_size_upper_bound?: number }> = data.data ?? [];
      const relevant = candidates.filter(c => isRelevantMatch(query, c.name));
      if (relevant.length > 0) {
        // Broad, correctly-mapped categories consistently have much larger
        // audiences than niche brand/band/app-specific entities that happen
        // to share the search word — prefer the largest among survivors.
        relevant.sort((a, b) => (b.audience_size_upper_bound ?? 0) - (a.audience_size_upper_bound ?? 0));

        // NHƯNG: KHỚP TÊN CHÍNH XÁC luôn thắng tệp lớn.
        //
        // Quy tắc "chọn tệp lớn nhất" có lý do đúng (tránh vớ phải tên ban nhạc
        // hay ứng dụng trùng chữ), nhưng nó cũng biến một truy vấn HẸP thành một
        // hạng mục RỘNG khác hẳn nghĩa. Bằng chứng thật 25/08: AI đề xuất
        // "Website" → bộ chọn trả về "Travel website" cho một chiến dịch bán TÊN
        // MIỀN, chỉ vì hạng mục du lịch có tệp lớn hơn. Suốt hai ngày tôi tưởng
        // "Travel website" do AI đề xuất; chỉ khi chip hiện cả tên gốc lẫn tên
        // Meta khớp về mới thấy nó sinh ra ở đây.
        //
        // Nếu Meta có đúng hạng mục mang TÊN Y HỆT truy vấn thì đó là thứ người
        // dùng muốn — không có lý do gì đổi sang một hạng mục rộng hơn.
        const qNorm = normalizeForExactMatch(query);
        const exact = relevant.find((c) => normalizeForExactMatch(c.name) === qNorm);
        const top = exact ?? relevant[0];
        const second = relevant.find((c) => c !== top);
        const topSize = top.audience_size_upper_bound ?? 0;
        const secondSize = second?.audience_size_upper_bound ?? 0;
        const ambiguous = Boolean(second) && topSize > 0 && secondSize > 0 && topSize < secondSize * 2;
        return {
          match: { id: top.id, name: top.name },
          alternates: relevant.slice(1, 4).map(c => ({ id: c.id, name: c.name })),
          ambiguous,
        };
      }
    } catch {
      // try next locale
    }
  }
  return { match: null, alternates: [], ambiguous: false };
}

export async function resolveOneInterest(
  query: string,
  accessToken: string
): Promise<{ id: string; name: string } | null> {
  return (await resolveInterestWithAlternates(query, accessToken)).match;
}

/**
 * Resolve tên behavior → id THẬT, hỏi thẳng Meta lúc chạy.
 *
 * Vì sao phải có: bảng BEHAVIOR_MAP tĩnh trong file này đã bị Meta khai tử —
 * đo trực tiếp 25/08/2026 bằng validate_only, mọi id trong đó trả lỗi 1487694
 * "hạng mục không còn tồn tại" ở CẢ hai chế độ Advantage+. Id quảng cáo là thứ
 * Meta tự đổi và tự bỏ; hardcode một bảng id là hẹn ngày nó chết mà không ai hay,
 * vì lỗi hiện ra dưới dạng "targeting bị từ chối" chứ không phải "id sai".
 *
 * Behavior đi qua CÙNG endpoint /search với interest nhưng khác `type`:
 * `adTargetingCategory` + `class=behaviors`. Dùng lại nguyên bộ lọc liên quan và
 * quy tắc ưu tiên tệp lớn của interest để hai bên không trôi khác nhau.
 */
const behaviorCache = new Map<string, { id: string; name: string } | null>();

export async function resolveOneBehavior(
  query: string,
  accessToken: string
): Promise<{ id: string; name: string } | null> {
  const localeOrder: Array<string | undefined> = hasVietnameseChars(query)
    ? ["vi_VN", "en_US", undefined]
    : ["en_US", "vi_VN", undefined];

  for (const locale of localeOrder) {
    try {
      const params = new URLSearchParams({
        type: "adTargetingCategory",
        class: "behaviors",
        q: query,
        limit: "12",
        access_token: accessToken,
      });
      if (locale) params.set("locale", locale);
      const res = await fetch(`${META_BASE}/search?${params}`);
      const data = await res.json();
      const candidates: Array<{ id: string; name: string; audience_size_upper_bound?: number }> = data.data ?? [];
      const relevant = candidates.filter(c => isRelevantMatch(query, c.name));
      if (relevant.length > 0) {
        relevant.sort((a, b) => (b.audience_size_upper_bound ?? 0) - (a.audience_size_upper_bound ?? 0));
        return { id: relevant[0].id, name: relevant[0].name };
      }
    } catch {
      // thử locale tiếp theo
    }
  }
  return null;
}

/** Resolve cả danh sách behavior, có cache (kể cả kết quả rỗng). */
export async function searchFBBehaviors(
  names: string[],
  accessToken: string
): Promise<Array<{ id: string; name: string }>> {
  const results: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();

  for (const name of names.slice(0, 10)) {
    if (behaviorCache.has(name)) {
      const cached = behaviorCache.get(name);
      if (cached && !seen.has(cached.id)) {
        results.push(cached);
        seen.add(cached.id);
      }
      continue;
    }

    const match = await resolveOneBehavior(name, accessToken);
    behaviorCache.set(name, match);

    if (match) {
      if (!seen.has(match.id)) {
        results.push(match);
        seen.add(match.id);
      }
    } else {
      // Không tìm thấy thì BỎ, không thay bằng id đoán. Một behavior thiếu chỉ
      // làm tệp rộng hơn; một id chết làm hỏng cả ad set.
      console.warn(`[searchFBBehaviors] Meta không còn hạng mục nào khớp: "${name}"`);
    }
  }

  return results;
}

/**
 * Search FB Marketing API to resolve interest names → real IDs.
 * Uses cache to avoid duplicate API calls. Limits to 15 interests max
 * for performance.
 */
export async function searchFBInterests(
  interests: string[],
  accessToken: string
): Promise<Array<{ id: string; name: string }>> {
  const results: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();

  for (const interest of interests.slice(0, 15)) {
    // Check cache first (including cached negative results — a keyword
    // that had no relevant match once won't suddenly gain one)
    if (interestCache.has(interest)) {
      const cached = interestCache.get(interest);
      if (cached && !seen.has(cached.id)) {
        results.push(cached);
        seen.add(cached.id);
      }
      continue;
    }

    const match = await resolveOneInterest(interest, accessToken);
    interestCache.set(interest, match);

    if (match) {
      if (!seen.has(match.id)) {
        results.push(match);
        seen.add(match.id);
      }
    } else {
      console.warn(`[searchFBInterests] No relevant match for: "${interest}"`);
    }
  }

  // Ghi lại ÁNH XẠ tên AI đề xuất → hạng mục Meta thật sự chọn.
  // Bộ resolve ưu tiên hạng mục có tệp LỚN NHẤT trong số các ứng viên "liên
  // quan" — cách này hay kéo một truy vấn hẹp thành một hạng mục ngành rất
  // rộng (ca thật 25/08: sản phẩm tên miền ra "Bất động sản (ngành)"). Không
  // log ánh xạ thì lệch kiểu đó chỉ lộ ra khi có người tình cờ nhìn tệp trên
  // Meta.
  const mapping = interests
    .slice(0, 15)
    .map((q) => `${q} → ${interestCache.get(q)?.name ?? "(không khớp)"}`)
    .join(" | ");
  if (mapping) console.log(`[searchFBInterests] ánh xạ: ${mapping}`);

  if (results.length === 0) return results;

  // Validate via adinterestvalid — filters parent-category nodes that cause code: 100.
  // FB API expects IDs under "interest_fbid_list" (NOT "interest_list" —
  // that param name is silently accepted but Meta returns a degenerate response
  // with no `id`/`valid` fields, so this validation was a complete no-op the
  // whole time it used the wrong name: every ID always "matched 0").
  //
  // Previously: 0-valid was treated as "the validation call is probably
  // broken" and kept every candidate anyway. Now that adinterestvalid uses
  // the right param and demonstrably works, that fallback just forwards
  // interest IDs Meta has already told us it will reject straight into ad
  // set creation — guaranteed code:100 → silent Advantage+ Audience
  // downgrade at launch (confirmed live 2026-07-30). Drops invalid IDs
  // instead; a genuinely-broken validation call (network error, malformed
  // response) still falls through to the catch/empty-response branches
  // below unchanged.
  //
  // IDs sent as STRINGS, never parseInt'd — FB interest/entity IDs can
  // exceed Number.MAX_SAFE_INTEGER (2^53-1, 16 digits), and many real ones
  // do. Round-tripping through parseInt silently rounds those to a
  // different, likely-nonexistent ID, so Meta validates the WRONG id and
  // the real (valid) interest gets dropped as "invalid" — confirmed as the
  // cause of a user report where an interest dragged directly from Meta's
  // own UI was flagged invalid here. Graph API accepts string IDs in
  // interest_fbid_list just fine.
  try {
    const strIds = results.map(r => r.id).filter(id => /^\d+$/.test(id));
    const params = new URLSearchParams({
      type: "adinterestvalid",
      interest_fbid_list: JSON.stringify(strIds),
      access_token: accessToken,
    });
    const res = await fetch(`${META_BASE}/search?${params}`);
    const data = await res.json() as { data?: Array<{ id: string | number; name: string; valid?: boolean }> };
    if (data.data && Array.isArray(data.data) && data.data.length > 0) {
      // Normalise response IDs to strings for comparison
      const validIds = new Set(data.data.filter(item => item.valid !== false).map(item => String(item.id)));
      const valid = results.filter(r => validIds.has(String(r.id)));
      const dropped = results.length - valid.length;
      if (dropped > 0) {
        console.warn(`[searchFBInterests] Validation dropped ${dropped}/${results.length} invalid IDs: ${results.filter(r => !validIds.has(String(r.id))).map(r => r.name).join(", ")}`);
      }
      return valid; // may be empty — caller (mapSegmentToFBTargeting) already handles zero interests
    }
    // data.data missing/empty → validation call didn't return usable data,
    // not "confirmed all invalid" — keep unvalidated candidates rather than guess.
    console.warn("[searchFBInterests] adinterestvalid returned no usable data — keeping unvalidated candidates");
  } catch (e) {
    console.warn("[searchFBInterests] Validation call failed, using unvalidated IDs:", e);
  }

  return results;
}


/** @deprecated Use searchFBInterests instead */
export const resolveInterestIds = async (
  interestNames: string[],
  accessToken: string
) => {
  const results = await searchFBInterests(interestNames, accessToken);
  return results.map(r => ({ id: parseInt(r.id, 10), name: r.name }));
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Parse age range string like "25-45" → { min: 25, max: 45 }
 */
export function parseAgeRange(age: string): { min: number; max: number } {
  const match = age.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (match) return { min: parseInt(match[1], 10), max: parseInt(match[2], 10) };
  return { min: 25, max: 55 }; // default
}

/**
 * Map audience segment targeting to Facebook format.
 *
 * Full mapping:
 * 1. LOCATION — Vietnamese city aliases → FB geo codes
 * 2. AGE — from demographics
 * 3. GENDER — "Nam 60% / Nữ 40%" detection
 * 4. INTERESTS — via FB Search API (real IDs)
 * 5. BEHAVIORS — static map of verified FB behavior IDs
 * 6. FLEXIBLE_SPEC — OR between interests / behaviors groups
 * 7. EXCLUSIONS — exclude audiences (students, competitors, etc.)
 * 8. PLACEMENTS — auto-selected by funnel stage
 */
export async function mapSegmentToFBTargeting(
  segment: LaunchSegment,
  accessToken: string,
  objective?: string,
  includeInstagram = false,
  useAdvantageAudience = false
): Promise<{ targeting: FBTargeting; unresolvedLocations: string[]; ignoredExclusions: string[] }> {

  // ── 1. LOCATION — lookup từ FB Geo Search API ──
  // FB phân loại VN: HCM, Hà Nội = "region" (KHÔNG phải "city")
  // Nếu đặt sai type → lỗi "City targeting is not supported" (code 100)
  const locationNames = segment.demographics?.locations || [];

  interface GeoResult {
    key: string;
    name: string;
    type: "city" | "region" | "country" | "zip" | "geo_market" | "electoral_district" | string;
    country_code?: string;
    supports_city?: boolean;
    supports_region?: boolean;
  }

  const lookupLocation = async (locName: string): Promise<GeoResult | null> => {
    if (locName === "Toàn quốc" || locName === "Toàn Quốc") return null;
    const staticEntry = FB_CITY_CODES[locName] ?? FB_CITY_CODES_NORMALIZED[normalizeLocationKey(locName)];
    const searchQuery = staticEntry ? staticEntry.name : locName;
    try {
      const params = new URLSearchParams({
        type: "adgeolocation",
        q: searchQuery,
        location_types: JSON.stringify(["city", "region"]),
        limit: "5",
        access_token: accessToken,
      });
      const res = await fetch(`${META_GRAPH_BASE}/search?${params.toString()}`);
      const json = await res.json();
      const results: GeoResult[] = json?.data || [];
      // Ưu tiên kết quả VN
      const match = results.find((r) => r.country_code === "VN") || null;
      if (match) {
        console.log(`[Location] "${locName}" → key=${match.key}, name=${match.name}, type=${match.type}, supports_city=${match.supports_city}, supports_region=${match.supports_region}`);
        return match;
      }
      console.warn(`[Location] No VN match for "${locName}" — falling back to country VN`);
    } catch (e) {
      console.warn(`[Location] Lookup failed for "${locName}":`, e);
    }
    return null;
  };

  const locationLookups = await Promise.all(
    locationNames.map(async (loc: string) => ({ loc, result: await lookupLocation(loc) }))
  );
  const resolvedLocations = locationLookups
    .map(l => l.result)
    .filter(Boolean) as GeoResult[];
  // "Toàn quốc" deliberately resolves to null (→ countries: ["VN"] fallback
  // below) — only flag names that were supposed to resolve to a real place
  // and didn't, so the launch log doesn't cry wolf on every nationwide segment.
  const unresolvedLocations = locationLookups
    .filter(l => !l.result && l.loc !== "Toàn quốc" && l.loc !== "Toàn Quốc")
    .map(l => l.loc);

  // Separate cities from regions based strictly on the key type
  // FB returns Ho Chi Minh as type="region", but supports_city=true.
  // The key returned is the REGION key (3847). Putting 3847 in `cities` causes Code 100.
  // If the key type is region, it MUST go to regions!
  const fbCities = resolvedLocations.filter(r => r.type === "city" || r.type === "neighborhood" || r.type === "zip");
  const fbRegions = resolvedLocations.filter(r => r.type === "region" || r.type === "state" || r.type === "province");

  // Build geo_locations with correct arrays
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geoLocations: Record<string, any> = { location_types: ["home", "recent"] };
  if (fbCities.length > 0) {
    geoLocations.cities = fbCities.map(c => ({ key: c.key, radius: 0, distance_unit: "kilometer" }));
  }
  if (fbRegions.length > 0) {
    geoLocations.regions = fbRegions.map(r => ({ key: r.key }));
  }
  if (fbCities.length === 0 && fbRegions.length === 0) {
    // Fallback: toàn quốc VN
    geoLocations.countries = ["VN"];
  }
  // KHÔNG thêm countries khi có cities/regions — FB coi đó là trùng lặp

  // ── 2. AGE ──
  const ageMin = segment.demographics?.ageMin ?? 18;
  const ageMax = segment.demographics?.ageMax ?? 65;

  // ── 3. GENDER ──
  // Support both old format ("male"/"female"/"all") and
  // new format from AI ("Nam 60% / Nữ 40%")
  let genders: number[] = [];
  const gender = segment.demographics?.gender || "";
  if (gender === "male") {
    genders = [1];
  } else if (gender === "female") {
    genders = [2];
  } else if (typeof gender === "string" && gender.includes("Nam") && !gender.includes("Nữ")) {
    genders = [1];
  } else if (typeof gender === "string" && gender.includes("Nữ") && !gender.includes("Nam")) {
    genders = [2];
  }
  // Nếu cả 2 hoặc "all" hoặc không rõ → [] = all genders

  // ── 4. INTERESTS — Use pre-resolved IDs if available, else search FB API ──
  let interestIds: Array<{ id: string; name: string }>;

  if (segment.resolvedInterestIds && segment.resolvedInterestIds.length > 0) {
    // Pre-resolved from /api/creative/resolve-interests in Step 4
    interestIds = segment.resolvedInterestIds;
    console.log(`[Targeting] Using ${interestIds.length} pre-resolved interests for "${segment.segmentName}"`);
  } else {
    // Fallback: search FB API (may fail for some interests)
    interestIds = await searchFBInterests(
      segment.interests || [],
      accessToken
    );
    console.log(`[Targeting] searchFBInterests: ${interestIds.length}/${(segment.interests || []).length} resolved for "${segment.segmentName}"`);
  };

  // ── 5. BEHAVIORS — Map từ static behavior list + fallback from unresolved interests ──
  // Some AI-generated "interest" names actually map to FB Behaviors (e.g., "Small business owners").
  // For any name in segment.interests that also exists in BEHAVIOR_MAP, add it as a behavior too.
  // ⚠️ BEHAVIOR_MAP ĐANG TẮT MẶC ĐỊNH — id trong bảng đã bị Meta khai tử.
  //
  // Đo trực tiếp trên tài khoản thật 25/08/2026 bằng validate_only
  // (app/api/creative/diagnose-targeting), 6 biến thể:
  //     A. chỉ độ tuổi,          advantage_audience 0        → HỢP LỆ
  //     C. + behaviors TĨNH,     advantage_audience 0        → lỗi 1487694
  //     D. + behaviors TĨNH,     advantage_audience 1        → lỗi 1487694 (y hệt C)
  //     E. + interest LẤY SỐNG,  advantage_audience 0        → HỢP LỆ
  // C và D chỉ khác nhau đúng cờ Advantage+ mà hỏng y hệt ⇒ thủ phạm là NỘI DUNG
  // id, không phải cơ chế. E hợp lệ ⇒ cấu trúc flexible_spec không có vấn đề.
  //
  // Hậu quả khi còn bật: mỗi lần launch, nhóm behaviors chết này kéo cả ad set
  // bị từ chối, tool hạ cấp dần rồi rơi xuống Advantage+ broad — MẤT SẠCH độ
  // tuổi và sở thích người dùng đã chọn. Đó chính là thứ người dùng nhìn thấy
  // trên Meta ngày 25/08: chỉ còn vị trí.
  //
  // Bật lại bằng META_ENABLE_STATIC_BEHAVIORS=1 sau khi đã làm mới bảng id và
  // xác thực từng id còn sống.
  const staticBehaviorsEnabled = process.env.META_ENABLE_STATIC_BEHAVIORS === "1";

  // Tên behavior cần resolve: lấy từ segment.behaviors, cộng những tên trong
  // segment.interests vốn thật ra là hành vi chứ không phải sở thích (bảng tĩnh
  // dùng để NHẬN DẠNG tên — vẫn hữu ích — nhưng id của nó thì không dùng nữa).
  const behaviorNames = [
    ...(segment.behaviors || []),
    ...(segment.interests || []).filter((name: string) => BEHAVIOR_MAP[name]),
  ].filter((name, i, arr) => arr.indexOf(name) === i);

  let behaviorTargets: Array<{ id: string; name: string }> = [];
  if (behaviorNames.length > 0) {
    if (staticBehaviorsEnabled) {
      // Đường cũ, chỉ còn để mở lại khi cần đối chứng.
      behaviorTargets = behaviorNames
        .map((b: string) => BEHAVIOR_MAP[b])
        .filter(Boolean)
        .filter((b, i, arr) => arr.findIndex(x => x.id === b.id) === i);
      console.log(`[Targeting] Dùng ${behaviorTargets.length} behavior TĨNH (META_ENABLE_STATIC_BEHAVIORS=1)`);
    } else {
      // Hỏi thẳng Meta lúc chạy — id nào Meta không còn thì tự rụng, không kéo
      // theo cả ad set bị từ chối như bảng tĩnh đã làm.
      behaviorTargets = await searchFBBehaviors(behaviorNames, accessToken);
      console.log(
        `[Targeting] Behavior resolve SỐNG: ${behaviorTargets.length}/${behaviorNames.length} còn tồn tại` +
        (behaviorTargets.length > 0 ? ` — ${behaviorTargets.map(b => b.name).join(", ")}` : ""),
      );
    }
  }

  // ── 6. FLEXIBLE_SPEC — Kết hợp interests + behaviors ──
  // flexible_spec là mảng — mỗi phần tử là OR group
  // Trong 1 group: AND giữa các criteria
  const flexibleSpec: Record<string, unknown>[] = [];

  if (interestIds.length > 0) {
    flexibleSpec.push({
      interests: interestIds.map(i => ({ id: i.id, name: i.name })),
    });
  }
  if (behaviorTargets.length > 0) {
    flexibleSpec.push({
      behaviors: behaviorTargets.map(b => ({ id: b.id, name: b.name })),
    });
  }

  // ── 7. EXCLUSIONS ── loại trừ chi tiết không còn gửi được (xem đầu tệp, mục "Loại trừ chi tiết").
  const ignoredExclusions = (segment.excludeAudiences || []).filter((ex) => typeof ex === "string" && ex.trim())

  // ── 8. PLACEMENTS — Tự động theo funnelStage ──
  //
  // TOFU: Rộng nhất — dùng Advantage+ (automatic_placements)
  // MOFU: Feed + Stories + Reels + Instream (engagement)
  // BOFU: Feed + Marketplace + Search + Instream (intent cao)
  let placements: Partial<FBTargeting> = {};

  const funnel = (segment.funnelStage || "").toUpperCase();
  if (funnel === "TOFU" || funnel === "") {
    placements = {
      publisher_platforms: includeInstagram ? ["facebook", "instagram"] : ["facebook"],
      facebook_positions: ["feed", "story", "marketplace", "search"],
      ...(includeInstagram ? { instagram_positions: ["stream", "story", "reels", "explore_home"] } : {}),
      device_platforms: ["mobile", "desktop"],
    };
  } else if (funnel === "MOFU") {
    placements = {
      publisher_platforms: includeInstagram ? ["facebook", "instagram"] : ["facebook"],
      facebook_positions: ["feed", "story", "instream_video", "search"],
      ...(includeInstagram ? { instagram_positions: ["stream", "story", "reels", "explore_home", "profile_feed"] } : {}),
      device_platforms: ["mobile", "desktop"],
    };
  } else if (funnel === "BOFU") {
    placements = {
      publisher_platforms: ["facebook"],
      facebook_positions: ["feed", "instream_video", "marketplace", "search"],
      device_platforms: ["mobile", "desktop"],
    };
  }

  // ── Build targeting object cuối cùng ──
  // Meta API requires EXPLICIT targeting_automation to control Advantage+ mode.
  // If targeting_automation is omitted entirely, Meta defaults to the ad account's
  // setting (usually Advantage+ ON) — meaning interests/behaviors in flexible_spec
  // become mere "suggestions" and disappear from "Nhắm mục tiêu chi tiết" in the UI.
  //
  // Rules:
  //   advantage_audience: 0  → "Giới hạn hơn nữa" mode — detailed targeting is enforced
  //   advantage_audience: 1  → Advantage+ broad mode — flexible_spec becomes suggestions
  //
  // Note: Do NOT send advantage_audience: 1 alongside flexible_spec — interests will
  // be ignored. Only use advantage_audience: 1 as a true broad-targeting fallback.
  const hasCustomAudiences = (segment.customAudienceIds ?? []).length > 0;
  // Advantage+ mode = purely the user's own toggle (config.useAdvantageAudience,
  // default OFF). Previously this also force-enabled Advantage+ whenever a
  // segment had zero resolved interests — even with the toggle off — which
  // silently discarded the user's configured age range (Advantage+ forces
  // age_max: 65) and put the ad set in Meta's broad mode without any warning.
  // A restricted ad set with only age/gender/geo and no interests at all is a
  // completely valid, common Meta targeting shape — it does not require
  // Advantage+.
  const useAdvantageMode = useAdvantageAudience;
  // When Advantage+ is active, FB requires age_max = 65
  const effectiveAgeMax = useAdvantageMode ? 65 : (ageMax || 65);

  const rawTargeting: FBTargeting = {
    geo_locations: geoLocations,
    age_min: ageMin || 18,
    age_max: effectiveAgeMax,
    // Always explicit — 0 opts out of Advantage+, 1 enables it
    targeting_automation: { advantage_audience: useAdvantageMode ? 1 : 0 },
    ...(genders.length > 0 ? { genders } : {}),
    ...(!useAdvantageAudience && !hasCustomAudiences && flexibleSpec.length > 0 ? { flexible_spec: flexibleSpec } : {}),
    ...(hasCustomAudiences ? { custom_audiences: segment.customAudienceIds!.map(id => ({ id })) } : {}),
    // Loại trừ tệp áp dụng cho MỌI cách nhắm — kể cả Advantage+, vì đây là
    // ràng buộc "đừng tiêu tiền vào nhóm người này", không phải một tín hiệu
    // nhắm mục tiêu để Meta cân nhắc rồi bỏ qua.
    ...((segment.excludeCustomAudienceIds?.length ?? 0) > 0
      ? { excluded_custom_audiences: segment.excludeCustomAudienceIds!.map(id => ({ id })) }
      : {}),
    ...placements,
  };

  // Sanitize — lọc placement theo objective trước khi trả về
  const targeting = sanitizeTargeting(rawTargeting, objective);

  console.log(`[Targeting] ${funnel} "${segment.segmentName}":`,
    `locations=${locationNames.length}, interests=${interestIds.length}, behaviors=${behaviorTargets.length}, ignoredExclusions=${ignoredExclusions.length}`
  );
  if (unresolvedLocations.length > 0) {
    console.warn(`[Targeting] "${segment.segmentName}" — ${unresolvedLocations.length} location(s) failed to resolve and were dropped: ${unresolvedLocations.join(", ")}`);
  }

  return { targeting, unresolvedLocations, ignoredExclusions };
}

/**
 * Auto-generate campaign name
 */
export function generateCampaignName(company: string, product: string): string {
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;
  const shortProduct = product.length > 30 ? product.slice(0, 30) + "..." : product;
  return `${company}-${shortProduct.toUpperCase()}-${dateStr}`;
}

/**
 * Format VND currency
 */
export function fmtVND(n: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n);
}

// ─────────────────────────────────────────────
// FB API Call Wrapper with detailed error log
// ─────────────────────────────────────────────

/**
 * Robust wrapper around FB Graph API POST calls.
 * Logs full error details (code, subcode, fbtrace_id, params) on failure.
 */
export async function fbApiCall(
  endpoint: string,
  params: Record<string, unknown>,
  label: string,
  accessToken: string
): Promise<Record<string, unknown>> {
  const url = `${META_BASE}${endpoint}`;
  const body = { ...params, access_token: accessToken };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (data.error) {
    console.error(`❌ FB API Error [${label}]:`, {
      code: data.error.code,
      subcode: data.error.error_subcode,
      message: data.error.message,
      userMsg: data.error.error_user_msg,
      fbtrace: data.error.fbtrace_id,
      params: JSON.stringify(params, null, 2),
    });
    throw new Error(
      `FB [${label}]: ${data.error.error_user_msg || data.error.message} (code: ${data.error.code})`
    );
  }

  console.log(`✅ FB API [${label}]: OK → id=${data.id}`);
  return data;
}

/**
 * Best-effort delete of a single FB object (ad/adset/campaign) — sets
 * status: DELETED, same convention as /api/creative/toggle-campaign.
 * Never throws — a rollback step failing must not mask the original
 * launch error or abort the rest of the rollback sequence.
 */
export async function rollbackMetaObject(
  id: string,
  label: string,
  accessToken: string
): Promise<{ id: string; label: string; ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${META_BASE}/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "DELETED", access_token: accessToken }),
    });
    const data = await res.json();
    if (data.error) {
      console.error(`❌ Rollback failed [${label} ${id}]:`, data.error.message);
      return { id, label, ok: false, error: data.error.message as string };
    }
    console.log(`🧹 Rollback OK [${label}]: ${id} → DELETED`);
    return { id, label, ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ Rollback threw [${label} ${id}]:`, message);
    return { id, label, ok: false, error: message };
  }
}
