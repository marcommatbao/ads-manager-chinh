import { NextRequest, NextResponse } from "next/server"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { getCurrentUser } from "@/lib/auth"
import { canAccessCompany } from "@/lib/permissions"
import { friendlyError } from "@/lib/not-configured";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { searchParams } = new URL(req.url)
    const company = (searchParams.get("company") || "MBC") as string
    if (!canAccessCompany(user, company)) {
      return NextResponse.json({ error: "Access denied for this company" }, { status: 403 })
    }

    const customer = getGoogleAdsCustomer(company)

    // Pull campaign budget + this-month spend
    const rows = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign_budget.amount_micros,
        metrics.cost_micros,
        metrics.clicks,
        metrics.impressions,
        metrics.conversions
      FROM campaign
      WHERE campaign.status = 'ENABLED'
        AND segments.date DURING THIS_MONTH
    `)

    // Last 7 days' spend, separately — used to forecast month-end spend
    // off the RECENT daily run-rate rather than the whole month-to-date
    // average, so a budget change made mid-month (a real, common action in
    // this app's own Campaign detail page) is reflected in the forecast
    // instead of being smoothed away by earlier-month history.
    const recentRows = await customer.query(`
      SELECT
        campaign.id,
        metrics.cost_micros
      FROM campaign
      WHERE campaign.status = 'ENABLED'
        AND segments.date DURING LAST_7_DAYS
    `)
    const recentSpendMicrosByCampaign: Record<string, number> = {}
    for (const row of recentRows as Array<{ campaign?: { id?: unknown }; metrics?: { cost_micros?: unknown } }>) {
      const id = String(row.campaign?.id ?? "")
      if (!id) continue
      recentSpendMicrosByCampaign[id] = (recentSpendMicrosByCampaign[id] ?? 0) + Number(row.metrics?.cost_micros ?? 0)
    }

    // Group by campaign — sum cost, take budget from any row
    const campaignMap: Record<string, {
      id: string
      name: string
      dailyBudgetMicros: number
      totalSpendMicros: number
      clicks: number
      conversions: number
    }> = {}

    for (const row of rows as any[]) {
      const id = String(row.campaign?.id ?? "")
      if (!id) continue
      if (!campaignMap[id]) {
        campaignMap[id] = {
          id,
          name: row.campaign?.name ?? "Unknown",
          dailyBudgetMicros: Number(row.campaign_budget?.amount_micros ?? 0),
          totalSpendMicros: 0,
          clicks: 0,
          conversions: 0,
        }
      }
      campaignMap[id].totalSpendMicros += Number(row.metrics?.cost_micros ?? 0)
      campaignMap[id].clicks           += Number(row.metrics?.clicks ?? 0)
      campaignMap[id].conversions       += Number(row.metrics?.conversions ?? 0)
    }

    // Calculate expected % based on day of month
    const now          = new Date()
    const dayOfMonth   = now.getDate()
    const daysInMonth  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const elapsedPct   = Math.round((dayOfMonth / daysInMonth) * 100)

    const remainingDays = Math.max(0, daysInMonth - dayOfMonth)

    const campaigns = Object.values(campaignMap)
      .map(c => {
        const dailyBudget   = c.dailyBudgetMicros / 1_000_000
        const monthlyBudget = dailyBudget * daysInMonth
        const spent         = c.totalSpendMicros / 1_000_000
        const actualPct     = monthlyBudget > 0 ? Math.round((spent / monthlyBudget) * 100) : 0

        // Forecast: recent 7-day run-rate projected forward for the rest
        // of the month, added to what's already spent.
        const recentSpend7d   = (recentSpendMicrosByCampaign[c.id] ?? 0) / 1_000_000
        const recentDailyAvg  = recentSpend7d / 7
        const projectedSpend  = spent + recentDailyAvg * remainingDays
        const projectedPct    = monthlyBudget > 0 ? Math.round((projectedSpend / monthlyBudget) * 100) : 0
        const willExceedBudget = monthlyBudget > 0 && projectedSpend > monthlyBudget * 1.05 // 5% slack — avoid noisy near-100% flags
        const daysUntilCapped  = willExceedBudget && recentDailyAvg > 0
          ? Math.max(0, Math.floor((monthlyBudget - spent) / recentDailyAvg))
          : null

        return {
          id:          c.id,
          name:        c.name,
          spent:       Math.round(spent),
          budget:      Math.round(monthlyBudget),
          dailyBudget: Math.round(dailyBudget),
          expectedPct: elapsedPct,
          actualPct,
          clicks:      c.clicks,
          conversions: c.conversions,
          recentDailyAvg:      Math.round(recentDailyAvg),
          projectedSpend:      Math.round(projectedSpend),
          projectedPct,
          willExceedBudget,
          daysUntilCapped,
        }
      })
      .filter(c => c.budget > 0)
      .sort((a, b) => b.budget - a.budget)

    return NextResponse.json({
      success: true,
      company,
      campaigns,
      elapsedPct,
      dayOfMonth,
      daysInMonth,
    })
  } catch (error: any) {
    console.error("[BudgetPacing]", error)
    return NextResponse.json({ success: false, error: friendlyError(error.message) }, { status: 500 })
  }
}
