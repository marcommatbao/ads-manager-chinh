import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import { numT } from "@/lib/google-i18n"
import { safeDateRange, safeNumericId, InvalidGaqlInput } from "@/lib/google-ads-guards"
import { getGoogleAdsCustomer }      from "@/lib/google-ads-client"
import { getCurrentUser }            from "@/lib/auth"
import { canAccessCompany }          from "@/lib/permissions"
import { friendlyError } from "@/lib/not-configured";

// ============================================================
// GET /api/google/toolkit/ngram/search
// Given a keyword phrase, evaluate — per campaign — whether it
// performs well enough to add as a real keyword, or badly enough
// to add as a negative. User-supplied phrase is never interpolated
// into GAQL; it only filters rows already pulled by a fixed query
// (same approach as the sibling n-gram route) to avoid GAQL injection.
// ============================================================

interface CampaignAgg {
  campaignId: string
  campaignName: string
  cost: number
  conversions: number
  clicks: number
  impressions: number
  adGroups: Map<string, { adGroupId: string; adGroupName: string; cost: number }>
}

export async function GET(req: NextRequest) {
  const t = await getT()
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { searchParams } = new URL(req.url)
    const company    = (searchParams.get("company")    || "MBC") as string
    const campaignId = searchParams.get("campaignId") || "ALL"
    let dateRange: string
    try {
      dateRange = safeDateRange(searchParams.get("range"))
    } catch (err) {
      if (err instanceof InvalidGaqlInput) return NextResponse.json({ error: friendlyError(err.message) }, { status: 400 })
      throw err
    }
    const phrase     = (searchParams.get("phrase") || "").toLowerCase().trim().replace(/\s+/g, " ")

    if (!phrase) {
      return NextResponse.json({ error: t("libgoogle.ng.noPhrase") }, { status: 400 })
    }
    if (!canAccessCompany(user, company)) {
      return NextResponse.json({ error: "Access denied for this company" }, { status: 403 })
    }

    const customer = getGoogleAdsCustomer(company)

    const whereClause = campaignId !== "ALL"
      ? `AND campaign.id = ${parseInt(campaignId, 10)}` : ""

    const rows = await customer.query(`
      SELECT
        search_term_view.search_term,
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        metrics.cost_micros,
        metrics.conversions,
        metrics.clicks,
        metrics.impressions
      FROM search_term_view
      WHERE segments.date DURING ${dateRange}
        AND campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        ${whereClause}
    `)

    // ── Avg CPA toàn account (từ toàn bộ search terms, không chỉ cụm từ đang tìm) ──
    const totalCost = rows.reduce((s: number, r: any) => s + (r.metrics?.cost_micros || 0), 0)
    const totalConv = rows.reduce((s: number, r: any) => s + (r.metrics?.conversions || 0), 0)
    const avgCPA = totalConv > 0 ? (totalCost / totalConv) / 1_000_000 : 0

    // ── Lọc các search term chứa cụm từ đang tìm, gộp theo campaign + ad group ──
    const campaignMap = new Map<string, CampaignAgg>()
    let matchedTermCount = 0

    for (const row of rows) {
      const term = (row.search_term_view?.search_term || "").toLowerCase().trim().replace(/\s+/g, " ")
      if (!term.includes(phrase)) continue
      matchedTermCount++

      const cId = String(row.campaign?.id ?? "")
      const cName = row.campaign?.name || ""
      const gId = String(row.ad_group?.id ?? "")
      const gName = row.ad_group?.name || ""
      if (!cId || !gId) continue

      if (!campaignMap.has(cId)) {
        campaignMap.set(cId, {
          campaignId: cId, campaignName: cName,
          cost: 0, conversions: 0, clicks: 0, impressions: 0,
          adGroups: new Map(),
        })
      }
      const agg = campaignMap.get(cId)!
      const cost        = (row.metrics?.cost_micros || 0) / 1_000_000
      const conversions = row.metrics?.conversions || 0
      const clicks       = row.metrics?.clicks || 0
      const impressions   = row.metrics?.impressions || 0

      agg.cost        += cost
      agg.conversions += conversions
      agg.clicks       += clicks
      agg.impressions   += impressions

      if (!agg.adGroups.has(gId)) agg.adGroups.set(gId, { adGroupId: gId, adGroupName: gName, cost: 0 })
      agg.adGroups.get(gId)!.cost += cost
    }

    if (campaignMap.size === 0) {
      return NextResponse.json({
        phrase, avgCPA: Math.round(avgCPA), matchedTermCount: 0, campaigns: [],
      })
    }

    // ── Kiểm tra cụm từ đã tồn tại làm keyword / negative ở campaign nào chưa ──
    const campaignIds = Array.from(campaignMap.keys()).filter((id) => /^\d+$/.test(id))
    const idList = campaignIds.join(",")

    const [criterionRows, campaignNegRows] = await Promise.all([
      customer.query(`
        SELECT
          ad_group_criterion.keyword.text,
          ad_group_criterion.negative,
          campaign.id
        FROM ad_group_criterion
        WHERE ad_group_criterion.type = 'KEYWORD'
          AND ad_group_criterion.status != 'REMOVED'
          AND campaign.id IN (${idList})
      `).catch(() => []),
      customer.query(`
        SELECT
          campaign_criterion.keyword.text,
          campaign.id
        FROM campaign_criterion
        WHERE campaign_criterion.type = 'KEYWORD'
          AND campaign_criterion.negative = true
          AND campaign.id IN (${idList})
      `).catch(() => []),
    ])

    const existingKeyword = new Set<string>()   // `${campaignId}:${text}`
    const existingNegative = new Set<string>()

    for (const r of criterionRows as any[]) {
      const text = (r.ad_group_criterion?.keyword?.text || "").toLowerCase().trim()
      const cId  = String(r.campaign?.id ?? "")
      if (!text || !cId) continue
      const key = `${cId}:${text}`
      if (r.ad_group_criterion?.negative) existingNegative.add(key)
      else existingKeyword.add(key)
    }
    for (const r of campaignNegRows as any[]) {
      const text = (r.campaign_criterion?.keyword?.text || "").toLowerCase().trim()
      const cId  = String(r.campaign?.id ?? "")
      if (!text || !cId) continue
      existingNegative.add(`${cId}:${text}`)
    }

    // ── Xây khuyến nghị từng campaign ──
    const campaigns = Array.from(campaignMap.values()).map((agg) => {
      const cpa = agg.conversions > 0 ? agg.cost / agg.conversions : null
      const vsAvgPct = (cpa !== null && avgCPA > 0)
        ? Math.round((cpa - avgCPA) / avgCPA * 100) : null

      const key = `${agg.campaignId}:${phrase}`
      const alreadyKeyword  = existingKeyword.has(key)
      const alreadyNegative = existingNegative.has(key)

      const topAdGroup = Array.from(agg.adGroups.values())
        .sort((a, b) => b.cost - a.cost)[0]

      let recommendation: "ADD_KEYWORD" | "ADD_NEGATIVE" | "MONITOR" | "EXISTS_KEYWORD" | "EXISTS_NEGATIVE"
      let reason: string

      if (alreadyNegative) {
        recommendation = "EXISTS_NEGATIVE"
        reason = t("libgoogle.ng.exNeg")
      } else if (alreadyKeyword) {
        recommendation = "EXISTS_KEYWORD"
        reason = t("libgoogle.ng.exKw")
      } else if (cpa !== null && avgCPA > 0 && cpa <= avgCPA * 0.8) {
        recommendation = "ADD_KEYWORD"
        reason = t("libgoogle.ng.addKw", { pct: Math.abs(vsAvgPct ?? 0), n: agg.conversions })
      } else if (agg.conversions === 0 && agg.clicks >= 5) {
        recommendation = "ADD_NEGATIVE"
        reason = t("libgoogle.ng.negZero", { clicks: agg.clicks, cost: numT(t, Math.round(agg.cost)) })
      } else if (cpa !== null && avgCPA > 0 && cpa >= avgCPA * 1.5) {
        recommendation = "ADD_NEGATIVE"
        reason = t("libgoogle.ng.negCpa", { pct: vsAvgPct ?? 0 })
      } else {
        recommendation = "MONITOR"
        reason = t("libgoogle.ng.monitor")
      }

      return {
        campaignId: agg.campaignId,
        campaignName: agg.campaignName,
        cost: Math.round(agg.cost),
        conversions: agg.conversions,
        clicks: agg.clicks,
        impressions: agg.impressions,
        cpa: cpa ? Math.round(cpa) : 0,
        vsAvgPct: vsAvgPct ?? 0,
        topAdGroupId: topAdGroup?.adGroupId ?? "",
        topAdGroupName: topAdGroup?.adGroupName ?? "",
        recommendation,
        reason,
      }
    }).sort((a, b) => b.cost - a.cost)

    return NextResponse.json({
      phrase,
      avgCPA: Math.round(avgCPA),
      matchedTermCount,
      campaigns,
    })
  } catch (error: any) {
    console.error("N-Gram phrase search error:", error)
    return NextResponse.json({ error: friendlyError(error.message), phrase: "", avgCPA: 0, matchedTermCount: 0, campaigns: [] }, { status: 500 })
  }
}
