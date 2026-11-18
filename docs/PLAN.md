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
- [x] Build authenticated attribution report API with company scope and date validation.
- [x] Add evidence-bounded lead/order matcher with click-ID, UTM campaign, and campaign-label precedence.
- [x] Add event-store adapters for normalized LeadEvent and RealOrder records.
- [x] Prevent duplicate order counting and leave ambiguous/no-evidence orders unmatched.
- [ ] Add runtime acceptance for matched/unmatched attribution.

## Phase 4 — Forecast quality contract

- [x] Add `lib/forecast-quality.ts` around the existing spend forecaster.
- [x] Require at least 3 observed days and a valid budget before allowing a forecast.
- [x] Return confidence, source, date range, read time, reason, and budget kind.
- [x] Keep account balance, campaign budget, and internal KPI as distinct kinds.
- [x] Wire this contract into the Google budget-pacing API response with `forecastQuality`, `forecastAllowed`, and nullable projection fields.
- [x] Wire quality state into budget-pacing UI states; insufficient forecasts show an explicit warning and nullable projection values are not rendered.
- [x] Add source-specific Google Ads integration tests for observed-day quality and nullable projections.
- [ ] Complete runtime acceptance for account balance, campaign budget, and internal KPI sources with configured connectors.

## Phase 6 start — Profit quality contract

- [x] Add net revenue, refunds, COGS, gross profit, margin, and break-even ROAS contract.
- [x] Require common date range and source metadata for all components.
- [x] Return `insufficient` when COGS or any required component is unavailable.
- [ ] BA confirm business formulas and refund/COGS definitions.
- [x] Expose authenticated profit readiness API; missing ledgers return explicit `insufficient` with missing source list.
- [x] Add P&L profit-readiness panel with insufficient state, missing-source list, formula version, and BA approval notice.
- [ ] Integrate real COGS/refund sources and expose populated profit API/UI.
- [ ] Add runtime acceptance for profit calculations.

## Deterministic automation — Phase A/B

- [x] Deterministic budget evaluator with source/stale/attribution/learning/cooldown/floor/ceiling guards.
- [x] Decision audit store without secrets.
- [x] Authenticated dry-run endpoint with company scope and `mutationPerformed: false`.
- [ ] Approval endpoint with TTL and snapshot hash.
- [ ] Provider apply/read-back/undo adapters.
- [ ] Supervised rollout and runtime acceptance.
