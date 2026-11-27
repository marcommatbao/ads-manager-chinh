import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAdsCustomer, GOOGLE_CUSTOMER_IDS } from '@/lib/google-ads-client';
import { getCurrentUser } from '@/lib/auth';
import { canAccessCompany } from '@/lib/permissions';
import { pacingWindow, pacingProjection } from '@/lib/budget-pacing';

type Row = {
  customer?: { id?: unknown; currency_code?: unknown; time_zone?: unknown };
  campaign?: { id?: unknown; name?: unknown; status?: unknown; campaign_budget?: unknown };
  campaign_budget?: { id?: unknown; resource_name?: unknown; amount_micros?: unknown; explicitly_shared?: unknown };
  metrics?: { cost_micros?: unknown }; segments?: { date?: unknown };
};
function micros(value: unknown) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') throw new Error('INVALID_SPEND');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('INVALID_SPEND');
  return n / 1e6;
}
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const company = new URL(req.url).searchParams.get('company') || 'MBC';
  if (!canAccessCompany(user, company)) return NextResponse.json({ error: 'Access denied for this company' }, { status: 403 });
  try {
    const accountId = GOOGLE_CUSTOMER_IDS[company]?.replace(/-/g, '');
    if (!accountId || !/^\d+$/.test(accountId)) throw new Error('INVALID_ACCOUNT');
    const customer = getGoogleAdsCustomer(company);
    const metadata = await customer.query('SELECT customer.id, customer.currency_code, customer.time_zone FROM customer') as Row[];
    const meta = metadata[0]?.customer;
    if (metadata.length !== 1 || String(meta?.id) !== accountId || typeof meta?.currency_code !== 'string' || !/^[A-Z]{3}$/.test(meta.currency_code) || typeof meta.time_zone !== 'string') throw new Error('INVALID_METADATA');
    const currency = meta.currency_code, timeZone = meta.time_zone;
    if (!Intl.supportedValuesOf('currency').includes(currency)) throw new Error('INVALID_CURRENCY');
    const now = new Date(), window = pacingWindow(timeZone, now);
    // Explicitly include paused and removed members; no ENABLED-only spend filter.
    const members = await customer.query(`SELECT customer.id, campaign.id, campaign.name, campaign.status,
      campaign.campaign_budget, campaign_budget.id, campaign_budget.resource_name,
      campaign_budget.amount_micros, campaign_budget.explicitly_shared
      FROM campaign WHERE campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED')`) as Row[];
    const budgets = new Map<string, { id: string; name: string; dailyBudget: number; shared: boolean; members: { id: string; name: string; status: string }[]; spent: number; completedSpend: number; daily: Record<string, number> }>();
    const campaignBudget = new Map<string, string>();
    for (const row of members) {
      const c = row.campaign, b = row.campaign_budget;
      const id = String(c?.id ?? ''), resource = String(b?.resource_name ?? '');
      if (String(row.customer?.id) !== accountId || !/^\d+$/.test(id) || !/^\d+$/.test(String(b?.id)) || resource !== `customers/${accountId}/campaignBudgets/${b?.id}` || c?.campaign_budget !== resource || typeof b?.explicitly_shared !== 'boolean' || !['ENABLED', 'PAUSED', 'REMOVED', 2, 3, 4].includes(c?.status as string)) throw new Error('INVALID_MEMBERSHIP');
      if (campaignBudget.has(id)) throw new Error('DUPLICATE_MEMBER');
      const dailyBudget = micros(b.amount_micros);
      let budget = budgets.get(resource);
      if (budget && (budget.dailyBudget !== dailyBudget || budget.shared !== b.explicitly_shared)) throw new Error('CONFLICTING_BUDGET');
      if (!budget) {
        budget = { id: resource, name: String(b.id), dailyBudget, shared: b.explicitly_shared, members: [], spent: 0, completedSpend: 0, daily: {} };
        budgets.set(resource, budget);
      }
      budget.members.push({ id, name: String(c?.name ?? id), status: String(c?.status) });
      campaignBudget.set(id, resource);
    }
    const from = window.recentFrom < window.monthStart ? window.recentFrom : window.monthStart;
    const completedRows = await customer.query(`SELECT customer.id, campaign.id, segments.date, metrics.cost_micros
      FROM campaign WHERE campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED')
      AND segments.date BETWEEN '${from}' AND '${window.yesterday}'`) as Row[];
    const todayRows = await customer.query(`SELECT customer.id, campaign.id, segments.date, metrics.cost_micros
      FROM campaign WHERE campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED')
      AND segments.date BETWEEN '${window.today}' AND '${window.today}'`) as Row[];
    if (completedRows.some(row => String(row.segments?.date) > window.yesterday) || todayRows.some(row => row.segments?.date !== window.today)) throw new Error('INVALID_SOURCE_RANGE');
    const dailyRows = [...completedRows, ...todayRows];
    const seen = new Set<string>();
    for (const row of dailyRows) {
      const id = String(row.campaign?.id ?? ''), date = String(row.segments?.date ?? '');
      const resource = campaignBudget.get(id);
      if (String(row.customer?.id) !== accountId || !resource || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date < from || date > window.today || seen.has(`${id}:${date}`)) throw new Error('INVALID_DAILY');
      seen.add(`${id}:${date}`);
      const value = micros(row.metrics?.cost_micros), budget = budgets.get(resource)!;
      if (date >= window.monthStart) {
        budget.spent += value;
        if (date <= window.yesterday) budget.completedSpend += value;
      }
      if (date <= window.yesterday && date >= window.recentFrom) budget.daily[date] = (budget.daily[date] ?? 0) + value;
    }
    const sourceRanges = { actual: { from: window.monthStart, to: window.today, partialToday: true }, runrate: { from: window.recentFrom, to: window.yesterday }, completed: { from: window.monthStart, to: window.dayOfMonth === 1 ? null : window.yesterday, status: window.dayOfMonth === 1 ? 'no_completed_days' : 'available' } };
    const rows = [...budgets.values()].map(b => {
      if (!b.shared && b.members.length !== 1) throw new Error('INVALID_UNSHARED');
      const projection = pacingProjection(b.completedSpend, b.daily, window);
      // Current membership cannot prove historical shared-budget assignment. Retain actuals,
      // but fail closed on shared forecasts until a budget-level historical source is available.
      const coverage = b.shared ? 'partial' : 'complete';
      const forecastAllowed = projection.forecastAllowed && coverage === 'complete';
      const projectedSpend = forecastAllowed ? projection.projectedSpend : null;
      const reference = b.dailyBudget * window.daysInMonth;
      return { id: b.id, name: b.shared ? b.name : b.members[0].name, scope: b.shared ? 'shared_budget' : 'campaign_budget', members: b.members, currency, timeZone,
        coverage, status: b.shared ? 'partial_coverage' : forecastAllowed ? 'ready' : 'insufficient_days',
        spent: b.spent, completedSpend: b.completedSpend, dailyBudget: b.dailyBudget, monthlyReference: reference,
        budget: reference, budgetKind: 'indicative_current_rate_reference', expectedPct: Math.round((window.dayOfMonth - 1) / window.daysInMonth * 100), actualPct: reference > 0 ? b.spent / reference * 100 : null,
        recentDailyAvg: forecastAllowed ? projection.recentDailyAvg : null, projectedSpend, forecastAllowed,
        projectedPct: projectedSpend !== null && reference > 0 ? projectedSpend / reference * 100 : null,
        daysUntilCapped: null, sourceRanges,
        forecastQuality: { observedDays: projection.observedDays, minDaysRequired: 3, confidence: !forecastAllowed ? 'insufficient' : projection.observedDays >= 7 ? 'medium' : 'low', reason: b.shared ? 'partial_coverage' : forecastAllowed ? 'ready' : 'insufficient_days', source: 'google_ads_campaign_budget_pacing', from: window.recentFrom, to: window.yesterday, readAt: now.toISOString() },
      };
    });
    return NextResponse.json({ success: true, company, accountId, currency, timeZone, budgets: rows, campaigns: rows, sourceRanges, source: 'google_ads', readAt: now.toISOString(), ...window, elapsedPct: Math.round((window.dayOfMonth - 1) / window.daysInMonth * 100) });
  } catch {
    return NextResponse.json({ success: false, error: 'Pacing source unavailable or invalid.', code: 'PACING_SOURCE_UNAVAILABLE' }, { status: 502 });
  }
}
