import { describe, expect, it } from 'vitest';
import { pacingProjection, pacingWindow } from '@/lib/budget-pacing';
describe('pacing civil calendar and calculator', () => {
  it.each([
    ['America/New_York', '2026-03-08T06:30:00Z', '2026-03-08', '2026-03-07', 31],
    ['America/New_York', '2026-03-08T07:30:00Z', '2026-03-08', '2026-03-07', 31],
    ['America/New_York', '2026-11-01T06:30:00Z', '2026-11-01', '2026-10-31', 30],
    ['Pacific/Kiritimati', '2026-12-31T10:30:00Z', '2027-01-01', '2026-12-31', 31],
    ['UTC', '2028-02-29T00:00:00Z', '2028-02-29', '2028-02-28', 29],
  ])('uses account date %s %s', (zone, instant, today, yesterday, daysInMonth) => {
    expect(pacingWindow(zone, new Date(instant))).toMatchObject({ today, yesterday, daysInMonth });
  });
  it('adds remaining days including today to completed actual, never extrapolates recent sum over whole month', () => {
    const w = pacingWindow('UTC', new Date('2026-11-10T00:00:00Z'));
    expect(pacingProjection(100, { '2026-11-07': 10, '2026-11-08': 20, '2026-11-09': 30, '2026-11-10': 999 }, w)).toMatchObject({ recentDailyAvg: 20, projectedSpend: 520, observedDays: 3 });
  });
  it('has one remaining day on month end', () => {
    const w = pacingWindow('UTC', new Date('2026-11-30T00:00:00Z'));
    expect(pacingProjection(500, { '2026-11-27': 10, '2026-11-28': 10, '2026-11-29': 10 }, w).projectedSpend).toBe(510);
  });
  it.each(['+07:00', '-05:00'])('rejects fixed offsets rather than treating them as account IANA zones: %s', zone => {
    expect(() => pacingWindow(zone, new Date('2026-11-10'))).toThrow();
  });
  it('does not impute missing dates', () => {
    const w = pacingWindow('UTC', new Date('2026-11-10'));
    expect(pacingProjection(30, { '2026-11-07': 10, '2026-11-09': 20 }, w)).toMatchObject({ observedDays: 2, projectedSpend: null });
  });
});
