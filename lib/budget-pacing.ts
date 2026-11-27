/** Pacing uses civil dates in the provider account, never the server's local zone. */
export function pacingWindow(timeZone: string, now: Date) {
  if (!timeZone || timeZone.trim() !== timeZone || /^[+-]/.test(timeZone)) throw new Error('INVALID_METADATA');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (key: string) => parts.find(p => p.type === key)!.value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const dayOfMonth = Number(part('day'));
  const year = Number(part('year')), month = Number(part('month'));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  return { today, monthStart: `${today.slice(0, 7)}-01`, yesterday: shift(-1), recentFrom: shift(-7), dayOfMonth, daysInMonth, remainingDays: daysInMonth - dayOfMonth + 1 };
}
export type PacingWindow = ReturnType<typeof pacingWindow>;
export function pacingProjection(completedSpend: number, daily: Record<string, number>, window: PacingWindow) {
  const values = Object.entries(daily).filter(([date]) => date >= window.recentFrom && date <= window.yesterday).map(([, value]) => value);
  if (![completedSpend, ...values].every(v => Number.isFinite(v) && v >= 0)) throw new Error('INVALID_SPEND');
  const observedDays = values.length;
  const forecastAllowed = observedDays >= 3;
  const recentDailyAvg = forecastAllowed ? values.reduce((a, b) => a + b, 0) / observedDays : null;
  return { observedDays, forecastAllowed, recentDailyAvg, projectedSpend: recentDailyAvg === null ? null : completedSpend + recentDailyAvg * window.remainingDays };
}
