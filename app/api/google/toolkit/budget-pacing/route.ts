import { NextRequest, NextResponse } from "next/server"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { getCurrentUser } from "@/lib/auth"
import { canAccessCompany } from "@/lib/permissions"
import { friendlyError } from "@/lib/not-configured";
import { forecastWithQuality } from "@/lib/forecast-quality";

type BudgetPacingRow = {
  campaign?: { id?: unknown; name?: unknown };
  campaign_budget?: { amount_micros?: unknown };
  metrics?: { cost_micros?: unknown; clicks?: unknown; conversions?: unknown };
  segments?: { date?: unknown };
};
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
        segments.date,
        metrics.cost_micros
      FROM campaign
      WHERE campaign.status = 'ENABLED'
        AND segments.date DURING LAST_7_DAYS
    `)
    const recentDailySpendMicrosByCampaign: Record<string, Record<string, number>> = {}
    for (const row of recentRows as BudgetPacingRow[]) {
      const id = String(row.campaign?.id ?? "")
      const date = String(row.segments?.date ?? "")
      if (!id || !date) continue
      const daily = recentDailySpendMicrosByCampaign[id] ??= {}
      daily[date] = (daily[date] ?? 0) + Number(row.metrics?.cost_micros ?? 0)
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

    for (const row of rows as BudgetPacingRow[]) {
      const id = String(row.campaign?.id ?? "")
      if (!id) continue
      if (!campaignMap[id]) {
        campaignMap[id] = {
          id,
          name: String(row.campaign?.name ?? "Unknown"),
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

    const campaigns = Object.values(campaignMap)
      .map(c => {
        const dailyBudget   = c.dailyBudgetMicros / 1_000_000
        const monthlyBudget = dailyBudget * daysInMonth
        const spent         = c.totalSpendMicros / 1_000_000
        const actualPct     = monthlyBudget > 0 ? Math.round((spent / monthlyBudget) * 100) : 0

        // Forecast only from observed daily rows. Missing dates are not zero days.
        const dailySpendMicros = recentDailySpendMicrosByCampaign[c.id] ?? {}
        const observedDates = Object.keys(dailySpendMicros).sort()
        const recentDailySpends = observedDates.map(date => dailySpendMicros[date] / 1_000_000)
        const forecast = forecastWithQuality({
          dailySpends: recentDailySpends,
          monthlyBudget,
          budgetKind: "campaign_budget",
          source: "google_ads_campaign_budget_pacing",
          from: observedDates[0] ?? new Date().toISOString().slice(0, 10),
          to: observedDates.at(-1) ?? new Date().toISOString().slice(0, 10),
          now,
        })
        const recentDailyAvg  = forecast.forecastAllowed ? forecast.dailyAverage : null
        const projectedSpend  = forecast.forecastAllowed ? forecast.forecastTotal : null
        const projectedPct    = projectedSpend !== null && monthlyBudget > 0 ? Math.round((projectedSpend / monthlyBudget) * 100) : null
        const willExceedBudget = projectedSpend !== null && monthlyBudget > 0 && projectedSpend > monthlyBudget * 1.05
        const daysUntilCapped  = willExceedBudget && recentDailyAvg && recentDailyAvg > 0
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
          recentDailyAvg:      recentDailyAvg === null ? null : Math.round(recentDailyAvg),
          projectedSpend:      projectedSpend === null ? null : Math.round(projectedSpend),
          projectedPct,
          forecastQuality: forecast.quality,
          forecastAllowed: forecast.forecastAllowed,
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
  } catch (error: unknown) {
    console.error("[BudgetPacing]", error)
    const message = error instanceof Error ? error.message : "Unknown budget pacing error"
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 500 })
  }
}
