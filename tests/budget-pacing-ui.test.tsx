import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { makeT } from '@/lib/i18n/translate';
const language = vi.hoisted(() => ({ value: 'en' as 'en' | 'vi' }));
vi.mock('@/lib/i18n/client', () => ({ useT: () => makeT(language.value), useIntlLocale: () => language.value === 'vi' ? 'vi-VN' : 'en-US' }));
vi.mock('@/components/SessionProvider', () => ({ useSession: () => ({ user: null, loading: false }) }));
import { CompanyCard, type ApiResponse } from '@/app/(dashboard)/toolkit/budget-pacing/page';
const data: ApiResponse = {
  success: true, company: 'MBC', accountId: '123456', currency: 'USD', timeZone: 'America/New_York', dayOfMonth: 10, daysInMonth: 30, elapsedPct: 30,
  readAt: '2026-11-10T17:00:00.000Z', sourceRanges: { actual: { from: '2026-11-01', to: '2026-11-10' }, runrate: { from: '2026-11-03', to: '2026-11-09' } },
  budgets: [{ id: 'customers/123456/campaignBudgets/10', name: 'Shared 10', scope: 'shared_budget', currency: 'USD', timeZone: 'America/New_York', members: [{ id: '1', name: 'First member', status: 'ENABLED' }, { id: '2', name: 'Paused member', status: 'PAUSED' }], spent: 80, completedSpend: 70, dailyBudget: 100, monthlyReference: 3000, projectedSpend: null, forecastAllowed: false, status: 'partial_coverage', forecastQuality: { observedDays: 3, minDaysRequired: 3 } }],
};
for (const locale of ['vi', 'en'] as const) {
  describe(`real pacing card ${locale}`, () => {
    it('shows one shared budget, members, currency, timezone, ranges and blocked reason', () => {
      language.value = locale;
      const html = renderToStaticMarkup(<CompanyCard data={data} color="bg-blue-500" />), t = makeT(locale);
      for (const key of ['actual', 'completed', 'reference', 'forecast', 'partialToday', 'partial_coverage', 'disclaimer'] as const) expect(html).toContain(t(`google.budgetPacing.p6.${key}`));
      expect(html.match(/<section/g)).toHaveLength(1);
      expect(html).toContain('First member'); expect(html).toContain('Paused member'); expect(html).toContain('America/New_York'); expect(html).toContain('2026-11-09');
      expect(html).not.toContain('₫'); expect(html).toContain('$'); expect(html).not.toContain('google.budgetPacing.p6.');
      expect(html).toContain('>—</dd>');
    });
    it.each(['USD', 'VND', 'KWD'])('preserves micros in displayed %s amounts', currency => {
      language.value = locale;
      const html = renderToStaticMarkup(<CompanyCard data={{ ...data, currency, budgets: [{ ...data.budgets[0], currency, spent: 0.000001 }] }} color="bg-blue-500" />);
      const formatted = new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 6 }).format(0.000001);
      expect(html).toContain(formatted);
    });
    it('distinguishes real actual from forecast and missing sample', () => {
      language.value = locale;
      const row = { ...data.budgets[0], scope: 'campaign_budget', status: 'ready' as const, forecastAllowed: true, projectedSpend: 240 };
      const html = renderToStaticMarkup(<CompanyCard data={{ ...data, budgets: [row] }} color="bg-blue-500" />);
      expect(html).toContain(new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { style: 'currency', currency: 'USD' }).format(240));
      const blocked = renderToStaticMarkup(<CompanyCard data={{ ...data, budgets: [{ ...row, status: 'insufficient_days', forecastAllowed: false, projectedSpend: null }] }} color="bg-blue-500" />);
      expect(blocked).toContain(makeT(locale)('google.budgetPacing.p6.insufficient_days'));
    });
  });
}
