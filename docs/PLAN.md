# Gate 3 Completion Plan

1. Formalize evidence and generation-mode contracts.
2. Add quality-gate and history persistence tests.
3. Expose evidence in the dashboard and re-enable the briefing card.
4. Record architecture, requirements, acceptance evidence, and project state.
5. Run typecheck, focused tests, full safe tests, and diff checks.


## Phase 5 start — Campaign-label attribution

- [x] Preserve the proven attribution boundary: Odoo `sale.order.campaign_id` only.
- [x] Report matched/unmatched order and revenue counts/rates.
- [x] Refuse MBI attribution where the business rule cannot separate it.
- [x] Keep connector errors explicit; never interpret an empty report as zero revenue.
- [x] Adapt normalized `LeadEvent` and `RealOrder` records without persisting identity fields.
- [ ] Add UTM/click/session evidence ingestion from the real event store.
- [ ] Add runtime acceptance for matched/unmatched attribution.

- Add `lib/forecast-quality.ts` around the existing spend forecaster.
- Require at least 3 observed days and a valid budget before allowing a forecast.
- Return confidence, source, date range, read time, reason, and budget kind.
- Keep account balance, campaign budget, and internal KPI as distinct kinds.
- Do not apply budget changes automatically.
- [x] Wire this contract into the Google budget-pacing API response with `forecastQuality`, `forecastAllowed`, and nullable projection fields.
- [x] Wire quality state into budget-pacing UI states; insufficient forecasts show an explicit warning and nullable projection values are not rendered.
- [x] Add source-specific Google Ads integration tests for observed-day quality and nullable projections.
- [ ] Complete runtime acceptance for account balance, campaign budget, and internal KPI sources with configured connectors.
