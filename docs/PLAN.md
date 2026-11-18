# Gate 3 Completion Plan

1. Formalize evidence and generation-mode contracts.
2. Add quality-gate and history persistence tests.
3. Expose evidence in the dashboard and re-enable the briefing card.
4. Record architecture, requirements, acceptance evidence, and project state.
5. Run typecheck, focused tests, full safe tests, and diff checks.


## Phase 4 start — Forecast quality contract

- Add `lib/forecast-quality.ts` around the existing spend forecaster.
- Require at least 3 observed days and a valid budget before allowing a forecast.
- Return confidence, source, date range, read time, reason, and budget kind.
- Keep account balance, campaign budget, and internal KPI as distinct kinds.
- Do not apply budget changes automatically.
- Next: wire this contract into forecast/budget-pacing API responses and UI states, then add source-specific integration tests.
