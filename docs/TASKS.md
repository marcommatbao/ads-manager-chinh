# Tasks — AdsCommand Gate 3

## Completed

- [x] Add briefing source evidence with date range and read time.
- [x] Block Gemini when critical Meta data is unavailable.
- [x] Add explicit Gemini/fallback/blocked generation modes.
- [x] Persist bounded briefing history with atomic writes and file locking.
- [x] Add authenticated briefing history endpoint.
- [x] Show briefing quality state and evidence in the dashboard.
- [x] Add focused quality, persistence, data-truth, and company P&L tests.
- [x] Add Gate 3 architecture, PRD, plan, acceptance, and test log.

## Remaining before Gate 3 close

- [x] Add real GET/POST route integration tests with mocked auth/provider boundaries, cache, persistence handoff, throttle, fallback, and actual generation-path Gemini call counts (19 tests).
- [x] Sanitize unrecognized generation Error messages in GET/POST; regression tests require generic responses while configuration errors retain translated guidance.
- [ ] Run authenticated staging/browser acceptance for loading, success, fallback, blocked, error, and evidence states.
- [ ] Resolve or separately document the pre-existing lint error at `app/(dashboard)/campaigns/page.tsx:382`.

## Out of scope

- Giai đoạn 4 forecast/budget pacing.
- Automatic campaign mutation or budget application.
