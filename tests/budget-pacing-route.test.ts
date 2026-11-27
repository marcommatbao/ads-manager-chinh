import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const { getCurrentUser, canAccessCompany, getGoogleAdsCustomer } = vi.hoisted(() => ({ getCurrentUser: vi.fn(), canAccessCompany: vi.fn(), getGoogleAdsCustomer: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getCurrentUser }));
vi.mock('@/lib/permissions', () => ({ canAccessCompany }));
vi.mock('@/lib/google-ads-client', () => ({ getGoogleAdsCustomer, GOOGLE_CUSTOMER_IDS: { MBC: '123-456' } }));
import { GET } from '@/app/api/google/toolkit/budget-pacing/route';
const request = () => new NextRequest('http://localhost/api/google/toolkit/budget-pacing?company=MBC&accountId=999&currency=VND&timeZone=Asia/Ho_Chi_Minh');
const metadata = (zone = 'America/New_York', currency = 'USD', id = '123456') => [{ customer: { id, currency_code: currency, time_zone: zone } }];
function member(id = '1', budget = '10', shared = false, status: string | number = 'ENABLED') {
  const resource = `customers/123456/campaignBudgets/${budget}`;
  return { customer: { id: '123456' }, campaign: { id, name: `Campaign ${id}`, status, campaign_budget: resource }, campaign_budget: { id: budget, resource_name: resource, amount_micros: '100000000', explicitly_shared: shared } };
}
const daily = (date: string, cost: unknown = 10_000_000, id = '1', account = '123456') => ({ customer: { id: account }, campaign: { id }, segments: { date }, metrics: { cost_micros: cost } });
const days = () => ['2026-11-07', '2026-11-08', '2026-11-09'].map(d => daily(d));
function fixture(options: { meta?: unknown; members?: unknown; completed?: unknown; today?: unknown } = {}) {
  const query = vi.fn().mockResolvedValueOnce(options.meta ?? metadata()).mockResolvedValueOnce(options.members ?? [member()]).mockResolvedValueOnce(options.completed ?? days()).mockResolvedValueOnce(options.today ?? [daily('2026-11-10', 90_000_000)]);
  getGoogleAdsCustomer.mockReturnValue({ query });
  return query;
}
describe('P6 provider route', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-10T17:00:00Z')); getCurrentUser.mockResolvedValue({ id: 'u' }); canAccessCompany.mockReturnValue(true); });
  afterEach(() => vi.useRealTimers());
  it('uses authoritative metadata, explicit completed ranges and spent + remaining runrate', async () => {
    const query = fixture(); const response = await GET(request()); const body = await response.json(); const b = body.budgets[0];
    expect(response.status).toBe(200); expect(body).toMatchObject({ accountId: '123456', currency: 'USD', timeZone: 'America/New_York' });
    expect(query.mock.calls[0][0]).toContain('customer.time_zone');
    expect(query.mock.calls[1][0]).toContain('campaign_budget.explicitly_shared');
    expect(query.mock.calls[1][0]).toContain("'REMOVED'");
    expect(query.mock.calls[2][0]).toContain("BETWEEN '2026-11-01' AND '2026-11-09'");
    expect(query.mock.calls[3][0]).toContain("BETWEEN '2026-11-10' AND '2026-11-10'");
    expect(b).toMatchObject({ spent: 120, completedSpend: 30, recentDailyAvg: 10, projectedSpend: 240, monthlyReference: 3000, forecastAllowed: true, daysUntilCapped: null });
    expect(b.forecastQuality).toMatchObject({ observedDays: 3, minDaysRequired: 3 });
  });
  it('groups shared campaigns once, includes paused/removed spend and blocks unverified shared forecast', async () => {
    fixture({ members: [member('1', '10', true), member('2', '10', true, 'PAUSED'), member('3', '10', true, 'REMOVED')], completed: [...days(), daily('2026-11-09', 20_000_000, '2'), daily('2026-11-09', 30_000_000, '3')], today: [] });
    const body = await (await GET(request())).json();
    expect(body.budgets).toHaveLength(1); expect(body.budgets[0]).toMatchObject({ spent: 80, dailyBudget: 100, monthlyReference: 3000, scope: 'shared_budget', coverage: 'partial', projectedSpend: null, forecastAllowed: false });
    expect(body.budgets[0].members).toHaveLength(3); expect(body.budgets[0].forecastQuality.observedDays).toBe(3);
  });
  it('keeps unshared budgets separate and does not round micros away', async () => {
    fixture({ members: [member(), member('2', '20')], completed: [...days(), daily('2026-11-09', 1, '2')], today: [] });
    const body = await (await GET(request())).json(); expect(body.budgets).toHaveLength(2); expect(body.budgets[1].spent).toBe(0.000001);
  });
  it('does not invent zero days to satisfy min3', async () => {
    fixture({ completed: [daily('2026-11-09')], today: [] }); const b = (await (await GET(request())).json()).budgets[0];
    expect(b).toMatchObject({ projectedSpend: null, status: 'insufficient_days' }); expect(b.forecastQuality.observedDays).toBe(1);
  });
  it('accepts explicit observed zero days', async () => {
    fixture({ completed: ['2026-11-07', '2026-11-08', '2026-11-09'].map(d => daily(d, 0)), today: [] });
    expect((await (await GET(request())).json()).budgets[0]).toMatchObject({ projectedSpend: 0, forecastAllowed: true });
  });
  it('uses prior month observations on day one and excludes today from forecast actuals', async () => {
    vi.setSystemTime(new Date('2026-10-31T11:00:00Z'));
    const query = fixture({ meta: metadata('Pacific/Kiritimati'), completed: ['2026-10-29', '2026-10-30', '2026-10-31'].map(d => daily(d)), today: [daily('2026-11-01', 90_000_000)] });
    const body = await (await GET(request())).json(); expect(body.today).toBe('2026-11-01');
    expect(query.mock.calls[2][0]).toContain("BETWEEN '2026-10-25' AND '2026-10-31'");
    expect(body.budgets[0]).toMatchObject({ completedSpend: 0, spent: 90, projectedSpend: 300 });
  });
  it.each([['currency', metadata('UTC', 'BAD')], ['zone', metadata('not/a-zone')], ['offset zone', metadata('+07:00')], ['account', metadata('UTC', 'USD', '999')], ['missing', [{}]]])('fails closed for invalid metadata: %s', async (_, meta) => {
    const query = fixture({ meta }); expect((await GET(request())).status).toBe(502); expect(query).toHaveBeenCalledTimes(1);
  });
  it.each([null, undefined, '', ' ', 'NaN', NaN, -1, '1.2', {}, Infinity])('rejects invalid spend %s', async cost => {
    fixture({ completed: [daily('2026-11-09', cost === undefined ? 'undefined' : cost)] }); expect((await GET(request())).status).toBe(502);
  });
  it.each([
    [daily('2026-11-09'), daily('2026-11-09', 2)],
    [daily('2026-11-09'), daily('2026-11-09')],
    [daily('2026-11-10')], [daily('2026-11-31')], [daily('2026-11-09', 10, '1', '999')], [daily('2026-11-09', 10, '999')],
  ])('rejects duplicate, conflicting, out of range and out of scope daily rows', async (...rows) => {
    fixture({ completed: rows }); expect((await GET(request())).status).toBe(502);
  });
  it('rejects inconsistent budget membership', async () => {
    const bad = member('2'); bad.campaign_budget.amount_micros = '2'; fixture({ members: [member(), bad] }); expect((await GET(request())).status).toBe(502);
  });
  it('sanitizes provider failure without zero fallback', async () => {
    const query = fixture(); query.mockReset().mockRejectedValue(new Error('SECRET provider token')); const response = await GET(request());
    expect(response.status).toBe(502); const body = await response.json(); expect(JSON.stringify(body)).not.toContain('SECRET'); expect(body.budgets).toBeUndefined();
  });
  it.each([401, 403])('authorizes before account/provider calls: %s', async status => {
    if (status === 401) getCurrentUser.mockResolvedValue(null); else canAccessCompany.mockReturnValue(false);
    expect((await GET(request())).status).toBe(status); expect(getGoogleAdsCustomer).not.toHaveBeenCalled();
  });
});
