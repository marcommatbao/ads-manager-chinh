import { NextRequest, NextResponse } from "next/server"
import { brandOverride } from "@/lib/brand/store"
import { canAccessCompany } from "@/lib/permissions";
import { getGoogleAdsCustomer }      from "@/lib/google-ads-client"
import { metaClient, graphFetch, isMetaTransientInsightError, describeMetaError } from "@/lib/meta-client"
import { getAlerts }                 from "@/lib/alert-engine"
import { callGemini }                from "@/lib/gemini"
import { promises as fs }            from "fs"
import { writeFileAtomic } from "@/lib/fs-atomic";
import path                          from "path"
import { resolveMatchType }          from "@/lib/google-ads-helpers"
import { getCPLTarget, detectProductGroup } from "@/lib/cpl-targets"
import { getCurrentUser, type SessionUser } from "@/lib/auth"
import { checkCronAuth }             from "@/lib/cron-auth"
import { getDismissedIds }           from "@/lib/improvements-store"
import { enums }                     from "google-ads-api"
import { enumName }                  from "@/lib/google-ads-enums"
import { readGroup }                 from "@/lib/odoo-client"
import { getGroupsForCompany }       from "@/lib/odoo-product-categories"
import { matchAdProduct }            from "@/lib/ad-product-mapping"
import { googleAdsErrorMessage } from "@/lib/google-ads-error"
import { daysBackVN } from "@/lib/case/dates"
import { META_GRAPH_BASE } from "@/lib/meta/graph-version"
import { companyIds } from "@/lib/companies"
import { isCompany } from "@/lib/companies/registry";
import { friendlyError } from "@/lib/not-configured";
import { leadCostTarget } from "@/lib/targets/resolve";

// ─────────────────────────────────────
// TYPES
// ─────────────────────────────────────
type ImprovementType =
  | "PAUSE_KEYWORD"
  | "PAUSE_SEARCH_TERM"
  | "NEGATIVE_BRAND_LEAK"
  | "PAUSE_LOW_CTR_AD"
  | "PAUSE_PMAX_ASSET"
  | "PAUSE_FB_AD_FATIGUE"
  | "PAUSE_FB_AD_LOW_CTR"
  | "INCREASE_BID_HIGH_ROAS"
  | "INCREASE_BUDGET_CAPPED"
  | "SHIFT_BUDGET_CHANNEL"
  | "LOWER_TARGET_CPA"
  | "RAISE_BUDGET_TOP_CAMPAIGN"
  | "ADD_EXACT_MATCH"
  | "ADD_COMPETITOR_KW"
  | "EXPAND_REMARKETING"
  | "DUPLICATE_FB_WINNING_ADSET"
  | "FIX_LOW_QS_KEYWORD"
  | "ADD_AD_EXTENSION"
  | "IMPROVE_PMAX_ASSETS"
  | "FIX_AD_STRENGTH"
  | "FB_AUDIENCE_OVERLAP"
  | "DEVICE_BID_ADJUSTMENT"
  | "GEO_BID_ADJUSTMENT"
  | "DAYPART_OPPORTUNITY"

interface Improvement {
  id:             string
  type:           ImprovementType
  source:         "GOOGLE" | "FACEBOOK" | "CROSS_CHANNEL"
  priority:       "HIGH" | "MEDIUM" | "LOW"
  company:        string
  title:          string
  description:    string
  impact:         string
  impactValue:    number
  /** true = impactValue là ước lượng thô (vd chi tiêu × 0.3) — UI không cộng vào tổng, gắn nhãn "ước lượng". */
  impactRough?:   true
  confidence:     number
  campaignName?:  string
  adGroupName?:   string
  keyword?:       string
  adName?:        string
  currentMetric?: string
  targetMetric?:  string
  canAutoApply:   boolean
  applyPayload?:  Record<string, any>
  reasoning?:     string
  status:         "ACTIVE"
}

// ─────────────────────────────────────
// HELPERS
// ─────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat("vi-VN").format(Math.round(n))

/**
 * Tổng "Impact/tháng" — KHÔNG cộng thẳng.
 *
 * Nhiều loại khuyến nghị dùng TOÀN BỘ chi tiêu của campaign làm `impactValue`
 * (xem các chỗ `impactValue: spend`). Một campaign hoàn toàn có thể dính nhiều
 * khuyến nghị HIGH cùng lúc — CPL cao, ngân sách lệch, creative mỏi… Cộng
 * thẳng là tính chi tiêu của CÙNG một campaign nhiều lần, và con số tổng phình
 * lên theo số lượng khuyến nghị chứ không theo tiền thật.
 *
 * Mỗi campaign chỉ tính khoản LỚN NHẤT. Vẫn là ước lượng, nhưng không còn nhân
 * bản. Cùng cách đã áp cho hàng đợi Next Best Action.
 */
function sumImpactDeduped(items: Improvement[]): number {
  const byEntity = new Map<string, number>()
  for (const i of items) {
    if (i.impactRough) continue // ước lượng thô không cộng vào tổng
    // Khoá theo campaign; thiếu tên campaign thì lấy id để không gộp nhầm các
    // khuyến nghị cấp tài khoản vào làm một.
    const key = `${i.company}:${i.campaignName ?? i.id}`
    byEntity.set(key, Math.max(byEntity.get(key) ?? 0, i.impactValue))
  }
  let total = 0
  for (const v of byEntity.values()) total += v
  return total
}

// Ngày theo giờ VN — bản cũ dùng toISOString() (UTC) nên 0h–7h sáng lùi mất một ngày.
function gaqlDates(daysBack: number): { from: string; to: string } {
  return daysBackVN(daysBack)
}

// B2B Vietnam benchmarks — chỉ còn hai ngưỡng THẬT SỰ có người đọc.
//
// Đã gỡ khỏi khối này (kiểm 11/09/2026, không nơi nào còn đọc):
//   • searchCTR, minQS, budgetCapPct — hằng số chết từ trước
//   • cplTargets — mục tiêu CPL nay ở lib/cpl-targets.ts
//
// Để lại hằng số chết ở đây rất dễ khiến người sau chỉnh số rồi tưởng vừa đổi
// ngưỡng, trong khi không có gì xảy ra và không lỗi nào báo — đúng cái bẫy
// vừa gặp với cplTargets.
const BENCHMARKS = {
  fbCTR:        0.01,
  maxFrequency: 3.5,
}

// detectProductGroup / getCPLTarget đã chuyển sang lib/cpl-targets.ts —
// nguồn DUY NHẤT, dùng chung với màn Từ khoá và công cụ Giá thầu thủ công.

function getLeads(actions: Array<{ action_type: string; value: string }> | null): number {
  if (!actions) return 0
  return actions
    .filter(a =>
      a.action_type === "lead" ||
      a.action_type === "offsite_conversion.fb_pixel_lead" ||
      a.action_type === "onsite_conversion.lead_grouped"
    )
    .reduce((s, a) => s + parseFloat(a.value || "0"), 0)
}

// ─────────────────────────────────────
// ODOO REVENUE — real net revenue per product group (revenueKey), for the
// requested date window. Keyed by revenueKey (e.g. "hosting", "cloud"), NOT
// by individual campaign name — Odoo doesn't track revenue per ad campaign,
// only per product category, same granularity already used by
// app/api/odoo/revenue-by-product/route.ts and lib/ad-product-mapping.ts's
// revenueKey field. Call sites match a campaign name to its revenueKey via
// matchAdProduct() and look up that group's revenue here — campaigns
// sharing a product group share that group's revenue figure, which is an
// approximation (Odoo has no way to attribute a single order to one
// specific campaign) but the same one the rest of the app already uses.
// Was previously a stub returning an empty map unconditionally.
const MBC_TYPE_NAMES = ["MBN Overdue", "MBN"]

interface MbSaleRow {
  category_id: [number, string] | false
  revenue: number
}

async function getOdooRevenue(company: string, from: string, to: string): Promise<Map<string, number>> {
  const revenueByKey = new Map<string, number>()
  try {
    const groups = getGroupsForCompany(company)
    const categToKey = new Map<number, string>()
    for (const g of groups) {
      for (const id of g.categoryIds) categToKey.set(id, g.key)
    }

    const domain: unknown[][] = [
      ["invoice_date", ">=", from],
      ["invoice_date", "<=", to],
    ]
    if (company === "MBC") {
      domain.push(["so_id.type_id.name", "in", MBC_TYPE_NAMES])
    }

    const rows = await readGroup(
      "mb.sale.report",
      domain,
      ["revenue:sum"],
      ["category_id"],
      { lazy: false }
    ) as MbSaleRow[]

    for (const row of rows) {
      if (!row.category_id) continue
      const key = categToKey.get(row.category_id[0])
      if (!key) continue
      revenueByKey.set(key, (revenueByKey.get(key) ?? 0) + (row.revenue ?? 0))
    }
  } catch (err) {
    console.warn(`[Improvements] getOdooRevenue failed for ${company} — revenue-linked suggestions will use 0`, err)
  }
  return revenueByKey
}

// ─────────────────────────────────────
// META ADSET / AD INSIGHTS
// Direct Graph API call (MetaClient only supports campaign level)
// ─────────────────────────────────────
async function fetchMetaLevelInsights(
  level: "adset" | "ad",
  dateRange: { from: string; to: string }
): Promise<any[]> {
  const token     = process.env.META_ACCESS_TOKEN
  const accountId = process.env.META_AD_ACCOUNT_ID
  if (!token || !accountId) return []

  try {
    const fields = level === "adset"
      ? "adset_id,adset_name,campaign_name,impressions,clicks,spend,reach,frequency,actions,cost_per_action_type"
      : "ad_id,ad_name,adset_name,campaign_name,impressions,clicks,spend,actions,cost_per_action_type"

    const params = new URLSearchParams({
      access_token: token,
      fields,
      time_range:  JSON.stringify({ since: dateRange.from, until: dateRange.to }),
      level,
      limit:       "200",
    })

    // graphFetch thay cho fetch trần: đọc header hạn mức và tôn trọng thời
    // gian nghỉ chung. Kèm thử lại cho nhóm "Meta quá tải / hết giờ chờ" —
    // đây là truy vấn insights cấp TÀI KHOẢN, đúng dạng Meta hay từ chối.
    const url = `${META_GRAPH_BASE}/act_${accountId}/insights?${params}`
    let data: { data?: unknown[]; error?: { message?: string; code?: number; error_subcode?: number } } | null = null
    const MAX_ATTEMPTS = 3
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await graphFetch(url)
      data = await res.json()
      if (!data?.error) break
      if (isMetaTransientInsightError(data.error) && attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 1500 * attempt))
        continue
      }
      break
    }

    // Lỗi Meta trước đây bị nuốt trọn: hàm trả mảng rỗng và trang Cải thiện
    // hiện "không có gì cần làm" — sai hẳn, vì thực tế là KHÔNG ĐỌC ĐƯỢC dữ
    // liệu. Giữ nguyên kiểu trả về (mọi nơi gọi đều mong một mảng) nhưng ghi
    // log đủ code/subcode để còn truy được nguyên nhân.
    if (data?.error) {
      console.error(`[improvements] Meta insights (level=${level}) hỏng: code=${data.error.code ?? "?"} subcode=${data.error.error_subcode ?? "?"} — ${describeMetaError(data.error.message ?? "không rõ", data.error.code)}`)
      return []
    }
    return data?.data || []
  } catch (err) {
    console.error(`[improvements] Meta insights (level=${level}) ném lỗi:`, err instanceof Error ? err.message : err)
    return []
  }
}

// ─────────────────────────────────────
// IMPROVEMENTS JSON CACHE
// ─────────────────────────────────────
const DATA_DIR        = path.join(process.cwd(), "data")
const IMPROVEMENTS_FILE = path.join(DATA_DIR, "improvements-cache.json")

interface ImprovementsCache {
  updatedAt:    string
  improvements: Improvement[]
}

async function readCache(): Promise<ImprovementsCache | null> {
  try {
    const raw = await fs.readFile(IMPROVEMENTS_FILE, "utf-8")
    return JSON.parse(raw) as ImprovementsCache
  } catch {
    return null
  }
}

async function writeCache(improvements: Improvement[]): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true })
    const payload: ImprovementsCache = {
      updatedAt:    new Date().toISOString(),
      improvements,
    }
    await writeFileAtomic(IMPROVEMENTS_FILE, JSON.stringify(payload, null, 2))
  } catch (err) {
    console.error("[Improvements] Cache write failed:", err)
  }
}

// ─────────────────────────────────────
// MAIN GET HANDLER
// ─────────────────────────────────────
const CACHE_TTL_MS = 60 * 60 * 1000 // 60 minutes — skip all API + Gemini calls if fresh

export async function GET(req: NextRequest) {
  // Service-to-service path for the auto-apply cron (app/api/cron/improvements-auto-apply) —
  // reuses this exact same computation (Google/Meta pulls, cache, canAutoApply
  // flags) instead of duplicating 1300+ lines of rule logic. Only consulted
  // when an Authorization header is actually present, so normal browser
  // session-cookie requests (the vast majority) never hit checkCronAuth's
  // rejection logging.
  const hasAuthHeader = req.headers.has("authorization")
  const user: SessionUser | null = hasAuthHeader && checkCronAuth(req, "improvements/service-read").ok
    ? { id: "cron", name: "Cron", email: "cron@internal", role: "super_admin", companies: ["ALL"] }
    : await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { searchParams } = new URL(req.url)
    const companyRaw = (searchParams.get("company") || "ALL").toUpperCase()
    const forceRefresh = searchParams.get("force") === "true"

    const dismissedIds = new Set([
      ...(await getDismissedIds("MBC")),
      ...(await getDismissedIds("MBI")),
    ])

    // Validate company access against the authenticated user's permissions —
    // computed before both the cache-hit and cache-miss paths below, since
    // the cache-hit path used to skip this check entirely (it returned
    // cached.improvements filtered only by dismissedIds, never by company —
    // a viewer_mbc hitting a warm cache got MBI's improvements too).
    // Chấm theo VAI TRÒ, không theo user.companies: trường đó là PHẠM VI và
    // đang mang ["ALL"] cho MỌI tài khoản nên chưa từng chặn được ai.
    const requestedCompaniesEarly = companyRaw === "ALL" ? companyIds() : [companyRaw]
    const companiesEarly = requestedCompaniesEarly.filter(
      c => canAccessCompany(user, c as string)
    )
    if (companiesEarly.length === 0) {
      return NextResponse.json({ error: "Forbidden: no access to requested company" }, { status: 403 })
    }

    // Return cached data early if fresh — avoids all Google/Meta/Gemini API calls
    if (!forceRefresh) {
      const cached = await readCache()
      if (cached) {
        const ageMs = Date.now() - new Date(cached.updatedAt).getTime()
        if (ageMs < CACHE_TTL_MS && cached.improvements.length > 0) {
          const sorted = cached.improvements.filter(i => !dismissedIds.has(i.id) && companiesEarly.includes(i.company.toUpperCase()))
          return NextResponse.json({
            total:    sorted.length,
            high:     sorted.filter(i => i.priority === "HIGH").length,
            medium:   sorted.filter(i => i.priority === "MEDIUM").length,
            savings:  sumImpactDeduped(sorted.filter(i => i.priority === "HIGH")),
            improvements: sorted.map(i => ({ ...i, platform: i.source === "GOOGLE" ? "GOOGLE" : "FACEBOOK" })),
            meta: {
              total: sorted.length,
              byPlatform: {
                FACEBOOK: sorted.filter(i => i.source === "FACEBOOK").length,
                GOOGLE:   sorted.filter(i => i.source === "GOOGLE").length,
              },
              byPriority: {
                HIGH:   sorted.filter(i => i.priority === "HIGH").length,
                MEDIUM: sorted.filter(i => i.priority === "MEDIUM").length,
                LOW:    sorted.filter(i => i.priority === "LOW").length,
              },
              totalImpact: sumImpactDeduped(sorted.filter(i => i.priority === "HIGH")),
              autoApplyCount: sorted.filter(i => i.canAutoApply && i.status === "ACTIVE").length,
            },
            sources: {
              google:   sorted.filter(i => i.source === "GOOGLE").length,
              facebook: sorted.filter(i => i.source === "FACEBOOK").length,
              cross:    sorted.filter(i => i.source === "CROSS_CHANNEL").length,
            },
            updatedAt: cached.updatedAt,
            fromCache: true,
          })
        }
      }
    }

    // Validate company access against the authenticated user's permissions
    const requestedCompanies = companyRaw === "ALL" ? companyIds() : [companyRaw]
    const companies = requestedCompanies.filter(
      c => canAccessCompany(user, c as string)
    )
    if (companies.length === 0) {
      return NextResponse.json({ error: "Forbidden: no access to requested company" }, { status: 403 })
    }

    const dateRange  = Math.min(parseInt(searchParams.get("days") || "30", 10), 90)
    const dates      = gaqlDates(dateRange)
    const fbDates    = { from: dates.from, to: dates.to }

    const improvements: Improvement[] = []

    // ── Pull Facebook data once (shared across companies) ──
    const [fbCampaignsResult, fbAdSetResult, fbAdResult] = await Promise.allSettled([
      metaClient.getCampaigns({ status: ["ACTIVE", "PAUSED"] }),
      fetchMetaLevelInsights("adset", fbDates),
      fetchMetaLevelInsights("ad",    fbDates),
    ])

    const fbCampaigns = fbCampaignsResult.status === "fulfilled"
      ? fbCampaignsResult.value : []
    const fbAdSetArr  = fbAdSetResult.status  === "fulfilled"
      ? fbAdSetResult.value  : []
    const fbAdArr     = fbAdResult.status     === "fulfilled"
      ? fbAdResult.value     : []

    // FB campaign insights — một lượt gọi cho cả danh sách (xem meta-client).
    // Hỏng thì hạ cấp giống 3 nguồn Meta ở trên (vẫn ra được đề xuất phía
    // Google), NHƯNG phải nói ra: thiếu số Facebook mà im lặng thì danh sách
    // trông vẫn "đầy đủ" trong khi nửa dữ liệu không có.
    let fbInsights: Awaited<ReturnType<typeof metaClient.getCampaignInsights>> = []
    let fbInsightsError: string | null = null

    // Sổ ghi MỌI nguồn dữ liệu lấy hụt. Chú thích ngay phía trên đã nói đúng
    // nguyên tắc — "hỏng thì phải nói ra, im lặng thì danh sách trông vẫn đầy
    // đủ" — nhưng chỉ áp cho đúng một biến Facebook, còn 12 nguồn khác vẫn
    // nuốt lỗi. Engine này là chỗ phát hiện từ khoá/quảng cáo đang đốt tiền:
    // báo "không có gì cần cải thiện" trong khi thực ra KHÔNG KIỂM ĐƯỢC nghĩa
    // là tiền cứ chảy mà không ai được cảnh báo.
    const dataErrors: string[] = []
    const noteError = (label: string, co: string, err: unknown) => {
      // Thư viện google-ads-api KHÔNG ném Error mà ném object GoogleAdsFailure,
      // nên `String(err)` ra đúng "[object Object]" — và đó là thứ log
      // production đang in cho geographic_view. lib/google-ads-error.ts đã được
      // viết sẵn cho đúng ca này từ trước, chỉ chưa ai nối vào đây.
      const msg = googleAdsErrorMessage(err)
      console.error(`[Improvements] ${label} (${co}) lỗi:`, msg)
      dataErrors.push(`${label} (${co}): ${msg}`)
    }
    if (fbCampaigns.length > 0) {
      try {
        fbInsights = await metaClient.getCampaignInsights(fbCampaigns.map(c => c.id), fbDates)
      } catch (err) {
        fbInsightsError = err instanceof Error ? err.message : String(err)
        console.warn("[Improvements] không lấy được insights Facebook:", fbInsightsError)
      }
    }

    // ── Process each company ──
    for (const co of companies) {
      if (!isCompany(co)) continue

      const odooRevenue = await getOdooRevenue(co, dates.from, dates.to)

      const customer = getGoogleAdsCustomer(co)

      // Pull all Google data in parallel
      const [
        keywords,
        searchTerms,
        campaigns,
        ads,
        adExtensions,
        pmaxAssets,
        deviceData,
        geoData,
        hourData,
      ] = await Promise.allSettled([

        // 1. Keywords
        customer.query(`
          SELECT
            ad_group_criterion.criterion_id,
            ad_group_criterion.keyword.text,
            ad_group_criterion.keyword.match_type,
            ad_group_criterion.quality_info.quality_score,
            ad_group_criterion.quality_info.search_predicted_ctr,
            ad_group_criterion.quality_info.creative_quality_score,
            ad_group_criterion.quality_info.post_click_quality_score,
            ad_group_criterion.resource_name,
            ad_group.name,
            campaign.id,
            campaign.name,
            metrics.cost_micros,
            metrics.conversions,
            metrics.clicks,
            metrics.impressions,
            metrics.average_cpc,
            metrics.cost_per_conversion
          FROM keyword_view
          WHERE campaign.status = 'ENABLED'
            AND ad_group.status = 'ENABLED'
            AND ad_group_criterion.status = 'ENABLED'
            AND segments.date BETWEEN '${dates.from}' AND '${dates.to}'
          LIMIT 1000
        `),

        // 2. Search Terms
        customer.query(`
          SELECT
            search_term_view.search_term,
            campaign.name,
            campaign.resource_name,
            ad_group.name,
            metrics.cost_micros,
            metrics.conversions,
            metrics.clicks,
            metrics.impressions
          FROM search_term_view
          WHERE segments.date BETWEEN '${dates.from}' AND '${dates.to}'
            AND campaign.status = 'ENABLED'
            AND metrics.cost_micros > 0
          LIMIT 2000
        `),

        // 3. Campaigns
        customer.query(`
          SELECT
            campaign.id,
            campaign.name,
            campaign.advertising_channel_type,
            campaign.bidding_strategy_type,
            campaign.target_cpa.target_cpa_micros,
            campaign.resource_name,
            campaign_budget.amount_micros,
            campaign_budget.resource_name,
            metrics.cost_micros,
            metrics.conversions,
            metrics.clicks,
            metrics.impressions,
            metrics.cost_per_conversion,
            metrics.search_budget_lost_impression_share,
            metrics.search_impression_share
          FROM campaign
          WHERE campaign.status = 'ENABLED'
            AND segments.date BETWEEN '${dates.from}' AND '${dates.to}'
        `),

        // 4. Ads
        customer.query(`
          SELECT
            ad_group_ad.ad.id,
            ad_group_ad.ad_strength,
            ad_group_ad.resource_name,
            ad_group.name,
            campaign.name,
            metrics.cost_micros,
            metrics.conversions,
            metrics.clicks,
            metrics.impressions,
            metrics.ctr
          FROM ad_group_ad
          WHERE campaign.status = 'ENABLED'
            AND ad_group.status = 'ENABLED'
            AND ad_group_ad.status = 'ENABLED'
            AND segments.date BETWEEN '${dates.from}' AND '${dates.to}'
            AND campaign.advertising_channel_type = 'SEARCH'
          LIMIT 500
        `),

        // 5. Tài sản quảng cáo (extension)
        //
        // ĐỔI 16/09/2026. Bản cũ hỏi `campaign_extension_setting` — resource
        // này KHÔNG còn tồn tại trong phiên bản API đang dùng (không có
        // CampaignExtensionSettingField nào trong danh mục kiểu của SDK), nên
        // truy vấn hỏng 100%. Kèm `.catch(() => [])` nên `extData` LUÔN rỗng,
        // và logic bên dưới suy ra MỌI campaign Search "thiếu cả 5 loại
        // extension" rồi đẩy khuyến nghị "tăng CTR 10-15%" — một lời khuyên
        // BỊA, không phản ánh tài khoản thật.
        //
        // `campaign_asset.field_type` là chỗ thay thế (repo đã dùng đúng
        // resource này ở app/api/google/policy-status/route.ts).
        //
        // KHÔNG nuốt lỗi nữa: hỏng thì để null để bên dưới BỎ QUA hẳn mục
        // khuyến nghị này. Thà không khuyên còn hơn khuyên bừa.
        //
        // SỬA 17/09/2026 — truy vấn này ĐANG lỗi trên production, thấy trong log
        // runtime: Google trả "The following field must be present in SELECT
        // clause: 'campaign.status'". GAQL đòi trường dùng để LỌC phải có mặt
        // trong SELECT. Truy vấn campaign_asset khác trong repo
        // (app/api/google/policy-status/route.ts) không gặp lỗi này vì nó lọc
        // theo campaign.id chứ không theo campaign.status.
        // Hệ quả của lỗi: nhánh catch trả null → mục khuyến nghị tài sản mở rộng
        // bị bỏ im lặng suốt từ trước tới nay, không ai biết.
        customer.query(`
          SELECT
            campaign.id,
            campaign.status,
            campaign_asset.field_type
          FROM campaign_asset
          WHERE campaign.status = 'ENABLED'
          LIMIT 500
        `).catch((err: unknown) => {
          // PHẢI gọi noteError như MỌI truy vấn khác trong tệp này.
          //
          // Bản trước chỉ console.error rồi return null — nghĩa là khi nguồn
          // này hỏng, nhóm khuyến nghị "tài sản mở rộng" biến mất hoàn toàn
          // mà banner "Danh sách bên dưới CHƯA ĐẦY ĐỦ" KHÔNG hề nhắc tới. Mọi
          // truy vấn khác trong cùng tệp đều noteError; đúng chỗ này thì
          // không, nên lỗi sống ẩn suốt từ trước tới nay.
          //
          // Đây chính là lớp lỗi mà bản thân tệp này đã ghi chú ở trên: nuốt
          // lỗi rồi trả rỗng sinh ra khuyến nghị BỊA ("mọi campaign đều thiếu
          // extension"). Im lặng theo kiểu `null` thì không bịa, nhưng vẫn
          // giấu mất một mảng khuyến nghị.
          noteError("campaign_asset", co, err)
          return null
        }),

        // 6. PMax Asset Groups
        customer.query(`
          SELECT
            asset_group.name,
            asset_group.ad_strength,
            asset_group.resource_name,
            campaign.name,
            metrics.cost_micros,
            metrics.conversions
          FROM asset_group
          WHERE campaign.status = 'ENABLED'
            AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
            AND segments.date BETWEEN '${dates.from}' AND '${dates.to}'
        `).catch((err: unknown) => { noteError("asset_group", co, err); return [] }),

        // 7. Device performance
        customer.query(`
          SELECT
            segments.device,
            campaign.id,
            campaign.name,
            metrics.cost_micros,
            metrics.conversions,
            metrics.clicks
          FROM campaign
          WHERE campaign.status = 'ENABLED'
            AND segments.date BETWEEN '${dates.from}' AND '${dates.to}'
        `).catch((err: unknown) => { noteError("campaign", co, err); return [] }),

        // 8. Geographic performance
          // `campaign.status` PHẢI có trong SELECT với resource này. Đo ngày
          // 19/09/2026: Google chỉ bắt buộc điều đó ở MỘT SỐ resource —
          // geographic_view, landing_page_view, campaign_asset thì bắt; còn
          // campaign, keyword_view, search_term_view, asset_group,
          // ad_group_criterion thì không. Không có luật chung để suy ra, phải
          // thử từng cái.
        customer.query(`
          SELECT
            geographic_view.resource_name,
            campaign.id,
            campaign.name,
            campaign.status,
            metrics.cost_micros,
            metrics.conversions,
            metrics.clicks
          FROM geographic_view
          WHERE campaign.status = 'ENABLED'
            AND segments.date BETWEEN '${dates.from}' AND '${dates.to}'
            AND metrics.cost_micros > 0
          LIMIT 500
        `).catch((err: unknown) => { noteError("geographic_view", co, err); return [] }),

        // 9. Hourly performance (aggregate across date range by hour)
        customer.query(`
          SELECT
            segments.hour,
            campaign.id,
            metrics.cost_micros,
            metrics.conversions,
            metrics.clicks
          FROM campaign
          WHERE campaign.status = 'ENABLED'
            AND segments.date BETWEEN '${dates.from}' AND '${dates.to}'
          LIMIT 10000
        `).catch((err: unknown) => { noteError("campaign", co, err); return [] }),
      ])

      // Ghi sổ cả nhánh rejected. Bản cũ lặng lẽ trả fallback nên một truy vấn
      // hỏng chỉ khiến hạng mục đó rỗng — nhìn y như "tài khoản sạch".
      const get = <T>(r: PromiseSettledResult<T>, fallback: T, label = "truy vấn Google"): T => {
        if (r.status === "fulfilled") return r.value
        noteError(label, co, r.reason)
        return fallback
      }

      const kwData   = get(keywords,     [], "keyword") as any[]
      const termData = get(searchTerms,  [], "search term") as any[]
      const campData = get(campaigns,    [], "campaign") as any[]
      const adData   = get(ads,          [], "ad") as any[]
      // fallback null (KHÔNG phải []): truy vấn extension hỏng thì phải phân
      // biệt được với "campaign không có extension nào". Để [] ở đây là vô
      // hiệu hoá luôn bản sửa bên dưới.
      const extData  = get(adExtensions, null) as any[] | null
      const pmaxData = get(pmaxAssets,   [], "pmax asset") as any[]
      const devData  = get(deviceData,   [], "device") as any[]
      const gData    = get(geoData,      [], "geo") as any[]
      const hData    = get(hourData,     [], "hourly") as any[]

      // ════════════════════════════════════
      // TẦNG 1: PHÁT HIỆN LÃNG PHÍ
      // ════════════════════════════════════

      // ── 1A. Keyword tốn tiền, 0 conv ──
      for (const kw of kwData) {
        const spend  = (kw.metrics?.cost_micros  || 0) / 1_000_000
        const conv   = kw.metrics?.conversions || 0
        const clicks = kw.metrics?.clicks      || 0
        const target = leadCostTarget(co, kw.campaign?.name || "", getCPLTarget(kw.campaign?.name || "")) // Đợt 23 (3b)

        if (conv === 0 && spend >= target * 0.5 && clicks >= 5) {
          improvements.push({
            id:           `PAUSE_KW_${co}_${kw.ad_group_criterion?.criterion_id}`,
            type:         "PAUSE_KEYWORD",
            source:       "GOOGLE",
            priority:     spend >= target * 2 ? "HIGH" : "MEDIUM",
            company:      co,
            title:        `Pause keyword "${kw.ad_group_criterion?.keyword?.text}"`,
            description:  `Keyword [${resolveMatchType(kw.ad_group_criterion?.keyword?.match_type)}] tốn ₫${fmt(spend)} với ${clicks} clicks nhưng 0 conversion`,
            impact:       `Tiết kiệm ₫${fmt(spend)}/tháng`,
            impactValue:  spend,
            confidence:   clicks >= 20 ? 95 : 75,
            campaignName: kw.campaign?.name,
            adGroupName:  kw.ad_group?.name,
            keyword:      kw.ad_group_criterion?.keyword?.text,
            currentMetric:`₫${fmt(spend)} spend, ${clicks} clicks, 0 conv`,
            targetMetric: `Target CPL: ₫${fmt(target)}`,
            canAutoApply: spend >= target * 3 && clicks >= 20,
            applyPayload: {
              action:       "PAUSE_KEYWORD",
              resourceName: kw.ad_group_criterion?.resource_name,
            },
            status: "ACTIVE",
          })
        }
      }

      // ── 1B. Search term không liên quan ──
      const IRRELEVANT_PATTERNS = [
        /miễn phí mãi mãi/i, /free forever/i, /xem phim/i,
        /nghe nhạc/i, /crack/i, /hack/i, /keygen/i, /game/i,
      ]
      const COMPETITOR_TERMS = [
        /\bviettel\b/i, /\bvnpt\b/i, /\bfpt\b/i,
        /\bmisa\b/i, /\bbkav\b/i, /\bnacencom\b/i,
      ]

      for (const term of termData) {
        const t     = term.search_term_view?.search_term || ""
        const spend = (term.metrics?.cost_micros || 0) / 1_000_000
        const conv  = term.metrics?.conversions || 0
        const clicks= term.metrics?.clicks      || 0

        if (spend < 50_000 || clicks < 3) continue

        if (IRRELEVANT_PATTERNS.some(p => p.test(t))) {
          improvements.push({
            id:           `NEG_TERM_${co}_${Buffer.from(t).toString("base64").slice(0, 8)}`,
            type:         "PAUSE_SEARCH_TERM",
            source:       "GOOGLE",
            priority:     spend > 200_000 ? "HIGH" : "MEDIUM",
            company:      co,
            title:        `Negative search term không liên quan: "${t}"`,
            description:  `Search term này không phải khách hàng B2B — đang lãng phí ngân sách`,
            impact:       `Tiết kiệm ₫${fmt(spend)}`,
            impactValue:  spend,
            confidence:   90,
            campaignName: term.campaign?.name,
            currentMetric:`₫${fmt(spend)} spend, ${clicks} clicks, 0 conv`,
            canAutoApply: conv === 0,
            applyPayload: {
              action:           "ADD_NEGATIVE",
              campaignResource: term.campaign?.resource_name,
              term:             t,
              matchType:        "EXACT",
            },
            status: "ACTIVE",
          })
        }

        if (COMPETITOR_TERMS.some(p => p.test(t)) && conv === 0 && spend > 300_000) {
          improvements.push({
            id:           `COMP_TERM_${co}_${Buffer.from(t).toString("base64").slice(0, 8)}`,
            type:         "PAUSE_SEARCH_TERM",
            source:       "GOOGLE",
            priority:     "MEDIUM",
            company:      co,
            title:        `Competitor term "${t}" không chuyển đổi`,
            description:  `Người tìm kiếm brand đối thủ thường khó convert — cân nhắc negative hoặc tách riêng campaign`,
            impact:       `Tiết kiệm ₫${fmt(spend)}`,
            impactValue:  spend,
            confidence:   70,
            campaignName: term.campaign?.name,
            currentMetric:`₫${fmt(spend)} spend, 0 conv`,
            canAutoApply: false,
            applyPayload: {
              action:           "ADD_NEGATIVE",
              campaignResource: term.campaign?.resource_name,
              term:             t,
              matchType:        "PHRASE",
            },
            status: "ACTIVE",
          })
        }
      }

      // ── 1C. Brand term lọt vào non-brand campaign ──
      const BRAND_TERMS       = [/mat bao/i, /matbao/i, /\bmbc\b/i, /\bmbi\b/i, /sale\.ai/i]
        // Đợt 21 A3: thêm tên thương hiệu trong hồ sơ (công ty của bản cài khác)
        .concat(companyIds().map((c) => brandOverride(c)?.brandName).filter((x): x is string => !!x).map((n) => new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")))
      const NON_BRAND_CAMPAIGN = /domain|ssl|hosting|einvoice|hóa đơn/i

      for (const term of termData) {
        const t     = term.search_term_view?.search_term || ""
        const camp  = term.campaign?.name || ""
        const spend = (term.metrics?.cost_micros || 0) / 1_000_000

        if (spend < 50_000) continue
        if (BRAND_TERMS.some(p => p.test(t)) && NON_BRAND_CAMPAIGN.test(camp)) {
          improvements.push({
            id:           `BRAND_LEAK_${co}_${Buffer.from(t + camp).toString("base64").slice(0, 8)}`,
            type:         "NEGATIVE_BRAND_LEAK",
            source:       "GOOGLE",
            priority:     "HIGH",
            company:      co,
            title:        `Brand term "${t}" lọt vào non-brand campaign`,
            description:  `"${t}" trigger trong "${camp}" → inflate CTR/conv giả cho non-brand`,
            impact:       `Dữ liệu sạch hơn, tiết kiệm ₫${fmt(spend)}`,
            impactValue:  spend,
            confidence:   95,
            campaignName: camp,
            currentMetric:`Brand term lọt vào non-brand`,
            canAutoApply: true,
            applyPayload: {
              action:           "ADD_NEGATIVE",
              campaignResource: term.campaign?.resource_name,
              term:             t,
              matchType:        "EXACT",
            },
            status: "ACTIVE",
          })
        }
      }

      // ── 1D. Ad CTR thấp + Ad Strength POOR ──
      for (const ad of adData) {
        const ctr      = ad.metrics?.ctr      || 0
        const spend    = (ad.metrics?.cost_micros || 0) / 1_000_000
        const impr     = ad.metrics?.impressions || 0
        // ad_strength comes back as a raw number (enums.AdStrength), not the
        // string "POOR"/"GOOD" this code compares against — same bug class
        // fixed earlier this session in lib/google-pmax-client.ts and
        // lib/google-audit-engine.ts. Also: the real enum has no "LOW" value
        // (UNSPECIFIED/UNKNOWN/PENDING/NO_ADS/POOR/AVERAGE/GOOD/EXCELLENT) —
        // this comparison at line ~700 could never have matched.
        const strength = enumName(enums.AdStrength, ad.ad_group_ad?.ad_strength)

        if (impr < 100 || spend < 100_000) continue

        if (ctr < 0.03 && impr > 500) {
          improvements.push({
            id:           `LOW_CTR_AD_${co}_${ad.ad_group_ad?.ad?.id}`,
            type:         "PAUSE_LOW_CTR_AD",
            source:       "GOOGLE",
            priority:     ctr < 0.01 ? "HIGH" : "MEDIUM",
            company:      co,
            title:        `Ad CTR ${(ctr * 100).toFixed(1)}% — dưới ngưỡng 3%`,
            description:  `Ad trong "${ad.ad_group?.name}" chỉ ${(ctr * 100).toFixed(1)}% CTR (ngưỡng lọc nội bộ của tool: 3% — không phải chuẩn ngành có nguồn). Nên viết lại headlines mạnh hơn.`,
            impact:       `Tăng CTR → giảm CPC thực tế`,
            impactRough:  true, // số ước lượng thô (tỷ lệ gõ tay), không phải tiền đo được
            impactValue:  spend * 0.3,
            confidence:   80,
            campaignName: ad.campaign?.name,
            adGroupName:  ad.ad_group?.name,
            currentMetric:`CTR: ${(ctr * 100).toFixed(1)}%, ${impr.toLocaleString()} impr`,
            targetMetric: `Target: 5%+`,
            canAutoApply: false,
            status: "ACTIVE",
          })
        }

        if (strength === "POOR" && spend > 200_000) {
          improvements.push({
            id:           `AD_STRENGTH_${co}_${ad.ad_group_ad?.ad?.id}`,
            type:         "FIX_AD_STRENGTH",
            source:       "GOOGLE",
            priority:     "MEDIUM",
            company:      co,
            title:        `Ad Strength POOR trong "${ad.ad_group?.name}"`,
            description:  `Ad này được Google đánh giá POOR → QS thấp → CPC cao hơn`,
            impact:       `Cải thiện QS → giảm CPC 20-40%`,
            impactRough:  true, // số ước lượng thô (tỷ lệ gõ tay), không phải tiền đo được
            impactValue:  spend * 0.25,
            confidence:   85,
            campaignName: ad.campaign?.name,
            adGroupName:  ad.ad_group?.name,
            currentMetric:`Ad Strength: POOR`,
            targetMetric: `Target: EXCELLENT`,
            canAutoApply: true,
            applyPayload: {
              action:                "FIX_AD_STRENGTH",
              adGroupAdResourceName: ad.ad_group_ad?.resource_name,
              adGroupName:           ad.ad_group?.name,
              campaignName:          ad.campaign?.name,
              productGroup:          detectProductGroup(ad.campaign?.name || ""),
            },
            status: "ACTIVE",
          })
        }
      }

      // ── 1E. PMax Asset Group xếp hạng LOW/POOR ──
      for (const asset of pmaxData) {
        const strength = enumName(enums.AdStrength, asset.asset_group?.ad_strength)
        const spend    = (asset.metrics?.cost_micros || 0) / 1_000_000
        if (spend < 200_000) continue

        if (strength === "POOR" || strength === "AVERAGE") {
          improvements.push({
            id:           `PMAX_ASSET_${co}_${asset.asset_group?.resource_name?.replace(/\//g, "_")}`,
            type:         "IMPROVE_PMAX_ASSETS",
            source:       "GOOGLE",
            priority:     "HIGH",
            company:      co,
            title:        `PMax Asset Group "${asset.asset_group?.name}" xếp hạng ${strength}`,
            description:  `Asset group yếu → Google không phân phối ngân sách hiệu quả. Thêm hình, video, headlines đa dạng.`,
            impact:       `Tăng reach và conv của PMax`,
            impactRough:  true, // số ước lượng thô (tỷ lệ gõ tay), không phải tiền đo được
            impactValue:  spend * 0.4,
            confidence:   90,
            campaignName: asset.campaign?.name,
            currentMetric:`Asset Strength: ${strength}`,
            targetMetric: `Target: GOOD hoặc EXCELLENT`,
            canAutoApply: false,
            status: "ACTIVE",
          })
        }
      }

      // ════════════════════════════════════
      // TẦNG 2: TỐI ƯU DOANH THU
      // ════════════════════════════════════

      // ── 2A. Campaign bị cap budget ──
      for (const camp of campData) {
        const budget      = (camp.campaign_budget?.amount_micros || 0) / 1_000_000
        const spend       = (camp.metrics?.cost_micros           || 0) / 1_000_000
        const conv        = camp.metrics?.conversions || 0
        const lostIS      = camp.metrics?.search_budget_lost_impression_share || 0
        const matchedProduct = matchAdProduct(camp.campaign?.name || "", co)
        const campRevenue = matchedProduct?.revenueKey ? (odooRevenue.get(matchedProduct.revenueKey) || 0) : 0

        if (budget === 0 || spend === 0) continue

        if (lostIS > 0.2 && conv > 3) {
          const suggested = budget * 1.3
          improvements.push({
            id:           `BUDGET_CAP_${co}_${camp.campaign?.id}`,
            type:         "INCREASE_BUDGET_CAPPED",
            source:       "GOOGLE",
            priority:     lostIS > 0.4 ? "HIGH" : "MEDIUM",
            company:      co,
            title:        `"${camp.campaign?.name}" bị giới hạn ngân sách — mất ${(lostIS * 100).toFixed(0)}% impression`,
            description:  `Campaign đang convert tốt nhưng mất ${(lostIS * 100).toFixed(0)}% lượt hiển thị${campRevenue > 0 ? ` — đã tạo ₫${fmt(campRevenue)} doanh thu` : ""}`,
            impact:       `Tăng ~${Math.round(lostIS * conv)} conv thêm/tháng`,
            impactRough:  true, // số ước lượng thô (tỷ lệ gõ tay), không phải tiền đo được
            impactValue:  campRevenue > 0
              ? campRevenue * lostIS
              : (spend / conv) * conv * lostIS,
            confidence:   88,
            campaignName: camp.campaign?.name,
            currentMetric:`Budget: ₫${fmt(budget)}/ngày, Lost IS: ${(lostIS * 100).toFixed(0)}%`,
            targetMetric: `Đề xuất: ₫${fmt(suggested)}/ngày`,
            canAutoApply: lostIS > 0.3 && conv > 5,
            applyPayload: {
              action:               "UPDATE_BUDGET",
              campaignId:           String(camp.campaign?.id ?? ""),
              campaignName:         camp.campaign?.name,
              campaignResourceName: camp.campaign?.resource_name,
              budgetResourceName:   camp.campaign_budget?.resource_name,
              newBudgetMicros:      Math.round(suggested * 1_000_000),
            },
            status: "ACTIVE",
          })
        }
      }

      // ── 2B. tCPA đặt quá cao so với thực tế ──
      for (const camp of campData) {
        const targetCPA = (camp.campaign?.target_cpa?.target_cpa_micros || 0) / 1_000_000
        const actualCPA = (camp.metrics?.cost_per_conversion             || 0) / 1_000_000
        const conv      = camp.metrics?.conversions || 0

        if (targetCPA === 0 || actualCPA === 0 || conv < 5) continue

        if (actualCPA < targetCPA * 0.7) {
          const suggestedCPA = actualCPA * 1.1
          improvements.push({
            id:           `LOWER_TCPA_${co}_${camp.campaign?.id}`,
            type:         "LOWER_TARGET_CPA",
            source:       "GOOGLE",
            priority:     "MEDIUM",
            company:      co,
            title:        `tCPA "${camp.campaign?.name}" đặt cao hơn thực tế — đang mất volume`,
            description:  `CPA thực ₫${fmt(actualCPA)} nhưng target ₫${fmt(targetCPA)} → Google giữ bid thấp, có thể lấy thêm conv`,
            impact:       `Tăng ~${Math.round(conv * 0.3)} conv cùng ngân sách`,
            impactRough:  true, // số ước lượng thô (tỷ lệ gõ tay), không phải tiền đo được
            impactValue:  conv * 0.3 * actualCPA,
            confidence:   80,
            campaignName: camp.campaign?.name,
            currentMetric:`tCPA: ₫${fmt(targetCPA)}, Actual: ₫${fmt(actualCPA)}`,
            targetMetric: `Đề xuất tCPA: ₫${fmt(suggestedCPA)}`,
            canAutoApply: true,
            applyPayload: {
              action:               "UPDATE_TARGET_CPA",
              campaignId:           String(camp.campaign?.id ?? ""),
              campaignName:         camp.campaign?.name,
              campaignResourceName: camp.campaign?.resource_name,
              targetCPAMicros:      Math.round(suggestedCPA * 1_000_000),
            },
            status: "ACTIVE",
          })
        }
      }

      // ── 2C. Keyword CPL tốt → scale up ──
      for (const kw of kwData) {
        const spend  = (kw.metrics?.cost_micros || 0) / 1_000_000
        const conv   = kw.metrics?.conversions || 0
        const cpl    = conv > 0 ? spend / conv : 0
        const target = leadCostTarget(co, kw.campaign?.name || "", getCPLTarget(kw.campaign?.name || "")) // Đợt 23 (3b)

        if (conv < 3 || cpl === 0) continue

        if (cpl < target * 0.5 && spend < 1_000_000) {
          improvements.push({
            id:           `SCALE_KW_${co}_${kw.ad_group_criterion?.criterion_id}`,
            type:         "INCREASE_BID_HIGH_ROAS",
            source:       "GOOGLE",
            priority:     "MEDIUM",
            company:      co,
            title:        `Scale keyword "${kw.ad_group_criterion?.keyword?.text}" — CPL chỉ ₫${fmt(cpl)}`,
            description:  `CPL ₫${fmt(cpl)} — thấp hơn 50% target ₫${fmt(target)}. Tăng bid để lấy thêm volume.`,
            impact:       `Tăng ~${conv} conv thêm/tháng`,
            impactRough:  true, // số ước lượng thô (tỷ lệ gõ tay), không phải tiền đo được
            impactValue:  conv * (target - cpl),
            confidence:   75,
            campaignName: kw.campaign?.name,
            keyword:      kw.ad_group_criterion?.keyword?.text,
            currentMetric:`CPL: ₫${fmt(cpl)}, ${conv} conv`,
            targetMetric: `Target CPL: ₫${fmt(target)}`,
            canAutoApply: false,
            status: "ACTIVE",
          })
        }
      }

      // ════════════════════════════════════
      // TẦNG 3: CƠ HỘI
      // ════════════════════════════════════

      // ── 3A. Broad có conv → thêm exact ──
      const broadWithConv = kwData.filter((k: any) =>
        resolveMatchType(k.ad_group_criterion?.keyword?.match_type) === "BROAD" &&
        (k.metrics?.conversions || 0) >= 3 &&
        (k.metrics?.cost_micros || 0) > 500_000_000
      )
      for (const kw of broadWithConv) {
        improvements.push({
          id:           `ADD_EXACT_${co}_${kw.ad_group_criterion?.criterion_id}`,
          type:         "ADD_EXACT_MATCH",
          source:       "GOOGLE",
          priority:     "MEDIUM",
          company:      co,
          title:        `Thêm [exact] cho "${kw.ad_group_criterion?.keyword?.text}"`,
          description:  `Broad keyword này có ${kw.metrics?.conversions} conv — thêm [exact] để kiểm soát traffic và giảm CPC`,
          impact:       `Giảm CPC ~20%, tăng chất lượng traffic`,
          impactRough:  true, // số ước lượng thô (tỷ lệ gõ tay), không phải tiền đo được
          impactValue:  (kw.metrics?.cost_micros || 0) / 1_000_000 * 0.2,
          confidence:   78,
          campaignName: kw.campaign?.name,
          keyword:      kw.ad_group_criterion?.keyword?.text,
          currentMetric:`${kw.metrics?.conversions} conv từ BROAD match`,
          canAutoApply: false,
          status: "ACTIVE",
        })
      }

      // ── 3B. Extension còn thiếu ──
      //
      // extData === null nghĩa là KHÔNG ĐO ĐƯỢC (truy vấn hỏng), khác hẳn
      // "đo được và campaign không có extension nào". Bản cũ gộp hai trường
      // hợp này làm một nên đẻ ra khuyến nghị bịa cho mọi campaign.
      const EXTENSION_TYPES = ["SITELINK", "CALLOUT", "STRUCTURED_SNIPPET", "CALL", "LEAD_FORM"]
      const extByCampaign   = new Map<string, Set<string>>()
      const extensionsMeasured = extData !== null
      for (const ext of extData ?? []) {
        const cid  = ext.campaign?.id
        // field_type của campaign_asset trả về cùng bộ tên với extension_type cũ
        // (SITELINK, CALLOUT, STRUCTURED_SNIPPET, CALL, LEAD_FORM…).
        const type = ext.campaign_asset?.field_type
        if (!cid) continue
        if (!extByCampaign.has(cid)) extByCampaign.set(cid, new Set())
        if (type) extByCampaign.get(cid)!.add(String(type))
      }

      for (const camp of campData) {
        // advertising_channel_type comes back as a raw numeric enum from
        // google-ads-api, not the string "SEARCH" — this comparison never
        // matched, so ad-extension-gap detection was silently a no-op.
        if (enumName(enums.AdvertisingChannelType, camp.campaign?.advertising_channel_type) !== "SEARCH") continue
        const spend   = (camp.metrics?.cost_micros || 0) / 1_000_000
        if (spend < 200_000) continue

        // Chưa đo được thì không khuyên gì về extension.
        if (!extensionsMeasured) continue

        const hasTypes = extByCampaign.get(camp.campaign?.id) || new Set()
        const missing  = EXTENSION_TYPES.filter(t => !hasTypes.has(t))

        if (missing.length >= 2) {
          improvements.push({
            id:           `ADD_EXT_${co}_${camp.campaign?.id}`,
            type:         "ADD_AD_EXTENSION",
            source:       "GOOGLE",
            priority:     "MEDIUM",
            company:      co,
            title:        `"${camp.campaign?.name}" thiếu ${missing.length} loại extension`,
            description:  `Chưa có: ${missing.join(", ")} — tiện ích miễn phí, Google khuyên bật để tăng tỷ lệ nhấp (mức tăng tuỳ tài khoản, đo lại sau 14 ngày)`,
            impact:       `Có thể tăng CTR — đo lại sau khi bật`,
            impactRough:  true, // số ước lượng thô (tỷ lệ gõ tay), không phải tiền đo được
            impactValue:  spend * 0.12,
            confidence:   85,
            campaignName: camp.campaign?.name,
            currentMetric:`Thiếu: ${missing.join(", ")}`,
            canAutoApply: false,
            status: "ACTIVE",
          })
        }
      }

      // ════════════════════════════════════
      // TẦNG 4: CHẤT LƯỢNG
      // ════════════════════════════════════

      // ── 4A. Quality Score thấp ──
      for (const kw of kwData) {
        const qs    = kw.ad_group_criterion?.quality_info?.quality_score || 0
        const spend = (kw.metrics?.cost_micros || 0) / 1_000_000
        const adRel = kw.ad_group_criterion?.quality_info?.creative_quality_score
        const lp    = kw.ad_group_criterion?.quality_info?.post_click_quality_score
        const ctr   = kw.ad_group_criterion?.quality_info?.search_predicted_ctr

        if (qs === 0 || qs > 5 || spend < 200_000) continue

        const weakPart =
          adRel === "BELOW_AVERAGE" ? "Ad Relevance thấp → headlines chưa chứa từ khóa" :
          lp    === "BELOW_AVERAGE" ? "Landing Page thấp → trang đích chưa liên quan" :
          ctr   === "BELOW_AVERAGE" ? "Expected CTR thấp → cần thêm USP vào ad copy" :
          "Cần cải thiện tổng thể"

        improvements.push({
          id:           `LOW_QS_${co}_${kw.ad_group_criterion?.criterion_id}`,
          type:         "FIX_LOW_QS_KEYWORD",
          source:       "GOOGLE",
          priority:     qs <= 3 ? "HIGH" : "MEDIUM",
          company:      co,
          title:        `QS ${qs}/10 cho "${kw.ad_group_criterion?.keyword?.text}" — đang trả thừa tiền`,
          description:  `QS thấp → Google tính CPC cao hơn. ${weakPart}`,
          impact:       `Tăng QS 1 điểm → giảm CPC ~8%. Tiết kiệm ~₫${fmt(spend * 0.15)}/tháng`,
          impactRough:  true, // số ước lượng thô (tỷ lệ gõ tay), không phải tiền đo được
          impactValue:  spend * 0.15,
          confidence:   88,
          campaignName: kw.campaign?.name,
          adGroupName:  kw.ad_group?.name,
          keyword:      kw.ad_group_criterion?.keyword?.text,
          currentMetric:`QS: ${qs}/10, Spend: ₫${fmt(spend)}`,
          targetMetric: `Target QS: 7+`,
          canAutoApply: false,
          status: "ACTIVE",
        })
      }

      // ── 4B. Device Bid: Mobile CPL > Desktop × 1.5 ──
      const deviceByCampaign = new Map<string, any>()
      for (const row of devData) {
        const cid = row.campaign?.id
        if (!cid) continue
        if (!deviceByCampaign.has(cid)) {
          deviceByCampaign.set(cid, { name: row.campaign?.name, MOBILE: null, DESKTOP: null })
        }
        const entry  = deviceByCampaign.get(cid)
        // Same numeric-enum bug fixed elsewhere this session — segments.device
        // is a raw number (enums.Device), not "MOBILE"/"DESKTOP" strings.
        const device = enumName(enums.Device, row.segments?.device)
        if (device === "MOBILE" || device === "DESKTOP") {
          const spend = (row.metrics?.cost_micros || 0) / 1_000_000
          const conv  = row.metrics?.conversions || 0
          const cur   = entry[device] || { spend: 0, conv: 0 }
          entry[device] = {
            spend: cur.spend + spend,
            conv:  cur.conv  + conv,
          }
        }
      }

      for (const [cid, data] of deviceByCampaign) {
        const mob  = data.MOBILE
        const desk = data.DESKTOP
        if (!mob || !desk || mob.conv === 0 || desk.conv === 0) continue
        const mobCPL  = mob.spend  / mob.conv
        const deskCPL = desk.spend / desk.conv
        if (mobCPL <= deskCPL * 1.5 || mob.spend < 200_000) continue

        const bidAdj = -Math.min(Math.round((1 - deskCPL / mobCPL) * 100), 40)
        improvements.push({
          id:           `DEVICE_BID_${co}_${cid}`,
          type:         "DEVICE_BID_ADJUSTMENT",
          source:       "GOOGLE",
          priority:     mobCPL > deskCPL * 2 ? "HIGH" : "MEDIUM",
          company:      co,
          title:        `Mobile CPL cao hơn Desktop ${Math.round(mobCPL / deskCPL * 100 - 100)}% — "${data.name}"`,
          description:  `Mobile: CPL ₫${fmt(mobCPL)} vs Desktop: ₫${fmt(deskCPL)}. B2B thường convert tốt hơn trên Desktop.`,
          impact:       `Giảm bid mobile ${Math.abs(bidAdj)}% → tiết kiệm ₫${fmt(mob.spend * Math.abs(bidAdj) / 100)}/tháng`,
          impactRough:  true, // số ước lượng thô (tỷ lệ gõ tay), không phải tiền đo được
          impactValue:  mob.spend * Math.abs(bidAdj) / 100,
          confidence:   82,
          campaignName: data.name,
          currentMetric:`Mobile CPL: ₫${fmt(mobCPL)}, Desktop CPL: ₫${fmt(deskCPL)}`,
          targetMetric: `Bid adjustment Mobile: ${bidAdj}%`,
          canAutoApply: true,
          applyPayload: {
            action:       "UPDATE_DEVICE_BID",
            campaignId:   cid,
            campaignName: data.name,
            device:       "MOBILE",
            bidModifier: 1 + bidAdj / 100,
          },
          status: "ACTIVE",
        })
      }

      // ── 4C. Geo: Khu vực 0 conv + high spend ──
      const geoByCampaign = new Map<string, any[]>()
      for (const row of gData) {
        const cid = row.campaign?.id
        if (!cid) continue
        if (!geoByCampaign.has(cid)) geoByCampaign.set(cid, [])
        geoByCampaign.get(cid)!.push({
          resource: row.geographic_view?.resource_name,
          spend:    (row.metrics?.cost_micros || 0) / 1_000_000,
          conv:     row.metrics?.conversions || 0,
          clicks:   row.metrics?.clicks      || 0,
        })
      }

      for (const [cid, geos] of geoByCampaign) {
        const camp     = campData.find((c: any) => c.campaign?.id === cid)
        const badGeos  = geos.filter((g: any) => g.conv === 0 && g.spend > 300_000 && g.clicks >= 10)
        if (badGeos.length < 2) continue

        const totalWaste = badGeos.reduce((s: number, g: any) => s + g.spend, 0)
        improvements.push({
          id:           `GEO_BID_${co}_${cid}`,
          type:         "GEO_BID_ADJUSTMENT",
          source:       "GOOGLE",
          priority:     totalWaste > 1_000_000 ? "HIGH" : "MEDIUM",
          company:      co,
          title:        `${badGeos.length} khu vực địa lý 0 conv trong "${camp?.campaign?.name}"`,
          description:  `${badGeos.length} tỉnh/TP đang tốn ₫${fmt(totalWaste)} nhưng 0 conversion — B2B thường tập trung HCM, HN`,
          impact:       `Tiết kiệm ₫${fmt(totalWaste)}/tháng`,
          impactValue:  totalWaste,
          confidence:   75,
          campaignName: camp?.campaign?.name,
          currentMetric:`${badGeos.length} khu vực xấu, tổng ₫${fmt(totalWaste)}`,
          canAutoApply: false,
          status: "ACTIVE",
        })
      }

      // ── 4D. Daypart: Khung giờ 0 conv ──
      const HOURS_MAP = new Map<number, { spend: number; conv: number }>()
      for (const row of hData) {
        const hour = row.segments?.hour
        if (hour === undefined || hour === null) continue
        const cur  = HOURS_MAP.get(hour) || { spend: 0, conv: 0 }
        cur.spend += (row.metrics?.cost_micros || 0) / 1_000_000
        cur.conv  += row.metrics?.conversions || 0
        HOURS_MAP.set(hour, cur)
      }

      const totalHourSpend = Array.from(HOURS_MAP.values()).reduce((s, h) => s + h.spend, 0)
      const totalHourConv  = Array.from(HOURS_MAP.values()).reduce((s, h) => s + h.conv, 0)
      const hourAvgSpend   = HOURS_MAP.size > 0 ? totalHourSpend / HOURS_MAP.size : 0

      const badHours = Array.from(HOURS_MAP.entries())
        .filter(([_, h]) => h.conv === 0 && h.spend > hourAvgSpend * 0.3 && h.spend > 200_000)
        .map(([hour]) => hour)
        .sort((a, b) => a - b)

      if (badHours.length >= 3) {
        const wastedSpend = badHours.reduce((s, hour) => s + (HOURS_MAP.get(hour)?.spend || 0), 0)
        improvements.push({
          id:           `DAYPART_${co}`,
          type:         "DAYPART_OPPORTUNITY",
          source:       "GOOGLE",
          priority:     wastedSpend > 1_000_000 ? "HIGH" : "MEDIUM",
          company:      co,
          title:        `${badHours.length} khung giờ 0 conversion — ₫${fmt(wastedSpend)}/tháng`,
          description:  `Giờ ${badHours.map(h => `${h}:00`).join(", ")} — 0 conv nhưng tốn ₫${fmt(wastedSpend)}. B2B thường chỉ convert trong giờ hành chính.`,
          impact:       `Tắt giờ kém → tiết kiệm ₫${fmt(wastedSpend)}/tháng`,
          impactValue:  wastedSpend,
          confidence:   85,
          currentMetric:`${badHours.length} giờ xấu: ${badHours.join(", ")}:00`,
          targetMetric: `Chỉ chạy 7:00–21:00`,
          canAutoApply: false,
          status: "ACTIVE",
        })
      }
    } // end for (co of companies)

    // ════════════════════════════════════
    // TẦNG 5: FACEBOOK
    // ════════════════════════════════════

    // ── 5A. Ad Set Frequency > 3.5 ──
    const fbAdSetAgg = new Map<string, any>()
    for (const row of fbAdSetArr) {
      const id  = row.adset_id
      if (!id) continue
      const cur = fbAdSetAgg.get(id) || {
        name: row.adset_name, campaign: row.campaign_name,
        spend: 0, reach: 0, impressions: 0, leads: 0,
      }
      cur.spend       += parseFloat(row.spend       || "0")
      cur.reach       += parseInt(row.reach       || "0", 10)
      cur.impressions += parseInt(row.impressions || "0", 10)
      cur.leads       += getLeads(row.actions)
      fbAdSetAgg.set(id, cur)
    }

    for (const [id, adset] of fbAdSetAgg) {
      const freq   = adset.reach > 0 ? adset.impressions / adset.reach : 0
      const cpl    = adset.leads > 0 ? adset.spend / adset.leads : 0
      const company= companies.length === 1 ? companies[0] : "MBC"

      if (freq > BENCHMARKS.maxFrequency && adset.spend > 500_000) {
        improvements.push({
          id:           `FB_FREQ_${id}`,
          type:         "PAUSE_FB_AD_FATIGUE",
          source:       "FACEBOOK",
          priority:     freq > 5 ? "HIGH" : "MEDIUM",
          company,
          title:        `FB Ad Set "${adset.name}" — Frequency ${freq.toFixed(1)}× quá cao`,
          description:  `Audience thấy quảng cáo TB ${freq.toFixed(1)} lần. Frequency > 3.5 = burnout, CPL sẽ tăng.`,
          impact:       `Refresh creative hoặc mở rộng audience`,
          impactRough:  true, // số ước lượng thô (tỷ lệ gõ tay), không phải tiền đo được
          impactValue:  adset.spend * 0.3,
          confidence:   88,
          campaignName: adset.campaign,
          adGroupName:  adset.name,
          currentMetric:`Frequency: ${freq.toFixed(1)}×, CPL: ₫${fmt(cpl)}`,
          targetMetric: `Target: < 3.5×`,
          canAutoApply: false,
          status: "ACTIVE",
        })
      }

      // Ad set tốt → scale
      const target = leadCostTarget(company, adset.campaign || "", getCPLTarget(adset.campaign || "")) // Đợt 23 (3b)
      if (cpl > 0 && cpl < target * 0.7 && adset.leads >= 5 && freq < 3 && adset.spend < 5_000_000) {
        improvements.push({
          id:           `FB_SCALE_${id}`,
          type:         "DUPLICATE_FB_WINNING_ADSET",
          source:       "FACEBOOK",
          priority:     "MEDIUM",
          company,
          title:        `Scale FB Ad Set "${adset.name}" — CPL chỉ ₫${fmt(cpl)}`,
          description:  `Ad set đang perform tốt CPL ₫${fmt(cpl)} < target ₫${fmt(target)}. Tăng budget hoặc duplicate để scale.`,
          impact:       `Tăng ~${Math.round(adset.leads * 0.5)} leads thêm/tháng`,
          impactRough:  true, // số ước lượng thô (tỷ lệ gõ tay), không phải tiền đo được
          impactValue:  adset.leads * 0.5 * (target - cpl),
          confidence:   73,
          campaignName: adset.campaign,
          adGroupName:  adset.name,
          currentMetric:`CPL: ₫${fmt(cpl)}, ${adset.leads} leads, Freq: ${freq.toFixed(1)}`,
          canAutoApply: false,
          status: "ACTIVE",
        })
      }
    }

    // ── 5B. FB Ad CTR < 1% ──
    const fbAdAgg = new Map<string, any>()
    for (const row of fbAdArr) {
      const id  = row.ad_id
      if (!id) continue
      const cur = fbAdAgg.get(id) || {
        name: row.ad_name, adSet: row.adset_name,
        campaign: row.campaign_name,
        spend: 0, impressions: 0, clicks: 0, leads: 0,
      }
      cur.spend       += parseFloat(row.spend       || "0")
      cur.impressions += parseInt(row.impressions || "0", 10)
      cur.clicks      += parseInt(row.clicks      || "0", 10)
      cur.leads       += getLeads(row.actions)
      fbAdAgg.set(id, cur)
    }

    for (const [id, ad] of fbAdAgg) {
      if (ad.impressions < 500 || ad.spend < 200_000) continue

      const ctr     = ad.impressions > 0 ? ad.clicks / ad.impressions : 0
      const company = companies.length === 1 ? companies[0] : "MBC"

      if (ctr < BENCHMARKS.fbCTR) {
        improvements.push({
          id:           `FB_CTR_${id}`,
          type:         "PAUSE_FB_AD_LOW_CTR",
          source:       "FACEBOOK",
          priority:     ctr < 0.005 ? "HIGH" : "MEDIUM",
          company,
          title:        `FB Ad "${ad.name}" CTR ${(ctr * 100).toFixed(2)}% — quá thấp`,
          description:  `CTR dưới 1% = creative không hút. Pause và thử visual/copy mới.`,
          impact:       `Tăng CTR → giảm CPM, tăng lead quality`,
          impactRough:  true, // số ước lượng thô (tỷ lệ gõ tay), không phải tiền đo được
          impactValue:  ad.spend * 0.25,
          confidence:   85,
          campaignName: ad.campaign,
          adGroupName:  ad.adSet,
          adName:       ad.name,
          currentMetric:`CTR: ${(ctr * 100).toFixed(2)}%, ${ad.impressions.toLocaleString()} impr`,
          targetMetric: `Target: > 1%`,
          canAutoApply: false,
          status: "ACTIVE",
        })
      }
    }

    // ── 5C. FB Alerts (CPL / budget alerts từ alert-engine) ──
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    for (const co of companies) {
      const alerts = await getAlerts({ company: co, is_resolved: false })
      const recent = alerts
        .filter(a => new Date(a.created_at).getTime() >= sevenDaysAgo)
        .slice(0, 10)

      for (const alert of recent) {
        improvements.push({
          id:           `FB_ALERT_${alert.id}`,
          type:         "PAUSE_FB_AD_FATIGUE",
          source:       "FACEBOOK",
          priority:     alert.severity === "critical" ? "HIGH" : "MEDIUM",
          company:      co,
          title:        alert.severity === "critical"
            ? "CPL nguy hiểm — Cần xử lý ngay"
            : "CPL cao hơn ngưỡng",
          description:  alert.message,
          impact:       "Xử lý để kiểm soát chi phí",
          impactRough:  true, // số ước lượng thô (tỷ lệ gõ tay), không phải tiền đo được
          impactValue:  alert.metadata?.cpl || 0,
          confidence:   90,
          campaignName: alert.campaign_name,
          currentMetric:`CPL: ₫${fmt(alert.metadata?.cpl || 0)}`,
          canAutoApply: false,
          applyPayload: { action: "RESOLVE_ALERT", alertId: alert.id },
          status: "ACTIVE",
        })
      }
    }

    // ────────────────────────────────────
    // AI ENRICHMENT — Gemini
    // Enrich top 5 by impact
    // ────────────────────────────────────
    const topImprovements = [...improvements]
      .sort((a, b) => b.impactValue - a.impactValue)
      .slice(0, 5)

    if (topImprovements.length > 0 && process.env.GEMINI_API_KEY) {
      try {
        const prompt = `Chuyên gia Google/Facebook Ads B2B VN. Viết reasoning ngắn (max 1 câu, thực tế) cho mỗi improvement:

${topImprovements.map((imp, i) =>
  `${i + 1}. ID="${imp.id}" — ${imp.title}: ${imp.description.slice(0, 100)}`
).join("\n")}

JSON (CHỈ JSON): [{"id":"...","reasoning":"..."}]`

        const geminiRes = await callGemini(
          prompt,
          { temperature: 0.3, maxOutputTokens: 512, responseMimeType: "application/json", thinkingBudget: 0 },
          process.env.GEMINI_API_KEY
        )
        const match = geminiRes.text.match(/\[[\s\S]*?\]/)
        if (match) {
          const enriched = JSON.parse(match[0]) as { id: string; reasoning: string }[]
          for (const item of enriched) {
            const imp = improvements.find(i => i.id === item.id)
            if (imp) imp.reasoning = item.reasoning
          }
        }
      } catch (err) {
        console.error("[AI Enrichment] Failed:", err)
      }
    }

    // ────────────────────────────────────
    // SORT & DEDUP & RETURN
    // ────────────────────────────────────
    const PRIORITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }

    const deduped = Array.from(
      new Map(improvements.map(i => [i.id, i])).values()
    ).filter(i => !dismissedIds.has(i.id))

    const sorted = deduped.sort((a, b) => {
      const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
      if (pDiff !== 0) return pDiff
      if (b.impactValue !== a.impactValue) return b.impactValue - a.impactValue
      return b.confidence - a.confidence
    })

    // Cache to JSON file — compare with previous before overwriting
    const previousCache = await readCache()
    const previousHighCount = previousCache?.improvements
      ?.filter(i => i.priority === "HIGH" && i.status === "ACTIVE").length ?? 0
    await writeCache(sorted)

    // ── Real-time Slack alert if HIGH improvements spike ──
    const newHighCount = sorted.filter(i => i.priority === "HIGH").length
    if (newHighCount > previousHighCount + 3) {
      const appUrl = process.env.APP_URL || "http://localhost:3000"
      fetch(`${appUrl}/api/alerts/slack`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type:    "NEW_HIGH",
          company: companyRaw,
          data: {
            improvements: sorted
              .filter(i => i.priority === "HIGH")
              .slice(0, 5),
            totalSavings: sumImpactDeduped(sorted.filter(i => i.priority === "HIGH")),
          },
        }),
      }).catch(console.error) // fire-and-forget
    }

    return NextResponse.json({
      // Có giá trị = phần Facebook của danh sách này đang thiếu, không phải
      // "Facebook không có gì để cải thiện".
      facebookError: fbInsightsError,
      // Danh sách nguồn dữ liệu lấy hụt. Rỗng = đã soi được hết; có phần tử =
      // danh sách bên dưới THIẾU phần đó, không phải "không có gì cần cải thiện".
      dataErrors,
      total:    sorted.length,
      high:     sorted.filter(i => i.priority === "HIGH").length,
      medium:   sorted.filter(i => i.priority === "MEDIUM").length,
      savings:  sumImpactDeduped(sorted.filter(i => i.priority === "HIGH")),
      improvements: sorted.map(i => ({
        ...i,
        platform: i.source === "GOOGLE" ? "GOOGLE" : "FACEBOOK"
      })),
      meta: {
        total:    sorted.length,
        byPlatform: {
          FACEBOOK: sorted.filter(i => i.source === "FACEBOOK").length,
          GOOGLE:   sorted.filter(i => i.source === "GOOGLE").length,
        },
        byPriority: {
          HIGH:   sorted.filter(i => i.priority === "HIGH").length,
          MEDIUM: sorted.filter(i => i.priority === "MEDIUM").length,
          LOW:    sorted.filter(i => i.priority === "LOW").length,
        },
        totalImpact: sumImpactDeduped(sorted.filter(i => i.priority === "HIGH")),
        autoApplyCount: sorted.filter(i => i.canAutoApply && i.status === "ACTIVE").length,
      },
      sources: {
        google:   sorted.filter(i => i.source === "GOOGLE").length,
        facebook: sorted.filter(i => i.source === "FACEBOOK").length,
        cross:    sorted.filter(i => i.source === "CROSS_CHANNEL").length,
      },
      updatedAt: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error("[Improvements] GET error:", error)
    return NextResponse.json(
      { error: friendlyError(error.message), improvements: [], total: 0, high: 0, medium: 0 },
      { status: 500 }
    )
  }
}

// Real apply/undo/dismiss/bulk logic lives in app/api/improvements/apply/route.ts
// — this file used to also export a POST handler here, but nothing ever called
// it (the frontend has always called /api/improvements/apply, which didn't
// exist as a route until now). Removed rather than left as unreachable dead code.
