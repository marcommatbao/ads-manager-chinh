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

## Bounded Gate 3 privacy follow-up — 2026-11-21

- [x] Replace raw provider diagnostics in successful blocked briefing gaps with fixed source wording; retain only safe source/category/Error classification in engine logs.
- [x] Remove raw AI fallback exception logging; preserve healthy/fallback/blocked behavior.
- [x] Normalize diagnostic gap/note fields on history write and legacy read; test both boundaries without claiming an on-disk historical migration.
- [x] Add synthetic secret/token-URL regressions for Error and non-Error source failures across API JSON, cache, history handoff, and source logs; focused suites 32/32 PASS.
- [x] Main: independently reviewed edits; full suite 230 PASS / 71 skipped, final route/history 25 PASS, TypeScript/scoped lint/build PASS. Worker wrapper failed after leaving edits; main verification is authoritative.
- [x] Sanitize fatal generation/history-write route logging and add regression assertions; history test data isolated under temp directory.
- [ ] Runtime authenticated staging/browser acceptance.
