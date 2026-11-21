# Gate 3 Acceptance — AI Analyst chủ động

| ID | Criterion | Evidence | Status |
|---|---|---|---|
| G3-01 | Briefing records source, range, read time | `BriefingEvidence` contract + focused tests | PASS |
| G3-02 | Critical unavailable source blocks Gemini | Real GET/POST → generation engine with mocked Meta failure and synthetic AI key; Gemini/timeout callback count 0 | PASS (route integration) |
| G3-03 | Fallback is explicitly identified | `generationMode` + UI badge + quality tests | PASS |
| G3-04 | Anomaly uses a declared comparison window | Meta evidence contains date ranges | PASS |
| G3-05 | Blocked source produces no AI analysis | Real GET/POST → engine → critical unavailable evidence → blocked mode, Gemini/timeout calls 0; no live provider requests | PASS (route integration) |
| G3-06 | History persists and deduplicates | `morning-briefing-history.test.ts` | PASS |
| G3-07 | History endpoint requires auth | `morning-briefing-history-route.test.ts` | PASS |
| G3-08 | Normalized history avoids raw provider payloads | Store contract + architecture review | PASS |
| G3-09 | Dashboard shows quality mode and evidence | `BriefingEvidencePanel` + dashboard card | PASS |
| G3-10 | Loading/error/blocked/empty states are represented | Existing card + blocked mode UI | PARTIAL (authenticated browser pending) |

## Phase 6 evidence

- Evidence-backed profit contract: PASS in `profit-quality.test.ts`.
- Missing COGS blocks profit/margin/break-even conclusions: PASS.
- Mismatched component date ranges block calculation: PASS.
- P&L profit-readiness panel shows insufficient state, missing sources, formula version, and BA approval notice: PASS (TypeScript; browser acceptance pending).
- Formula metadata (`phase6-v1`) and `requiresBaApproval` are explicit: PASS.
- BA formula confirmation, real COGS/refund integration, and populated runtime acceptance: PENDING.


- Campaign-label attribution contract: PASS.
- Matched/unmatched order and revenue rates: PASS in `campaign-revenue-attribution.test.ts`.
- MBI unsupported attribution and Odoo failure remain explicit/non-attributed: PASS.
- Evidence-bounded lead-to-order matcher (click ID → UTM campaign → campaign label): PASS in `attribution-matcher.test.ts`.
- Duplicate and ambiguous orders remain unmatched: PASS.
- Normalized `LeadEvent`/`RealOrder` adapters avoid persisting identity fields: PASS.
- Authenticated attribution report API with company scope/date validation: PASS in `attribution-report-route.test.ts`.
- Runtime acceptance with real staging event stores: PENDING.


- Forecast quality contract tests: PASS.
- Google budget-pacing route integration tests: PASS (observed-day evidence, campaign budget kind, insufficient-data null projection).
- Runtime connector acceptance for account balance, campaign budget, and internal KPI: PENDING because preview has no provider credentials.


Gate 3 implementation is **in progress**, not fully closed. Real-handler integration tests now cover the generation-path AI guard and route boundaries. Authenticated UI/API acceptance on configured staging/beta remains pending. Unrecognized generation errors now receive a generic public response; do not claim production readiness.

## Deterministic automation evidence

- Evaluator fail-closed guards and approval-required decisions: PASS in `profit-evaluator.test.ts`.
- Dry-run auth/scope and no-provider-mutation contract: PASS in `dry-run-route.test.ts`.
- Approval-only RBAC/TTL/snapshot integrity and zero provider mutation: PASS in `automation-approval.test.ts` and `approve-route.test.ts`.
- Provider-agnostic apply/read-before-write/read-back orchestration with mock adapters: PASS in `provider-apply.test.ts`.
- Real Meta/Google mutation, read-back, and undo adapters: NOT IMPLEMENTED; no provider writes enabled.


## Gate 3 route integration evidence — 2026-11-21

- `tests/morning-briefing-route.test.ts`: **19 passing tests**, importing real GET/POST handlers and executing the real generation engine. Authentication, rate limiter, Meta/Gemini clients, translation, and history writer are mocked. Process environment is replaced temporarily with synthetic test values; deployed flags/configuration are untouched. Network access is blocked and asserted unused.
- Unauthorized and disabled GET/POST: zero generation, provider, AI, history, or throttle calls. GET cache hit: zero generation/provider/AI/history calls. GET cache miss and POST: successful generation, cache update, exact persistence handoff. POST bypasses cache; rejected throttle prevents generation. History-write failure preserves success/cache.
- Critical source unavailable: actual provider rejection is converted by the engine to unavailable evidence and blocked mode; Gemini and timeout wrapper callback counts are zero despite a synthetic key. Healthy sources provide a positive control (AI called once). AI rejection produces explicit fallback.
- Error coverage: known configuration errors are translated without diagnostic details; non-Error throws and unrecognized Error messages produce the generic error response. Regression tests reject internal diagnostics in GET/POST error envelopes. These tests do not certify sanitization of source-error text in successful blocked responses (`dataGaps`).
- Persistence at the route boundary is a mock-writer contract, not a route-to-disk integration test. Real file persistence/deduplication remains covered separately by `morning-briefing-history.test.ts`. Rate-limit storage and real session authentication are also outside this isolated integration suite.
- Verification: `npx vitest run tests/morning-briefing-route.test.ts tests/morning-briefing-quality.test.ts tests/morning-briefing-history.test.ts tests/morning-briefing-history-route.test.ts` — **28/28 passing**; `npx eslint tests/morning-briefing-route.test.ts` and `npx tsc --noEmit` — PASS.
- Isolated worker verification skipped no tests. Browser/staging acceptance and live provider integration remain **PENDING**; final full-suite/build results are recorded in NEXT-EXECUTION-PLAN.md. Environment acceptance requires authenticated configured staging/browser evidence.
- Stored approval execution now hard-blocks with EXECUTION_COORDINATION_UNVERIFIED before reservation, claim or provider access. Transactional coordination remains NOT IMPLEMENTED; mock provider-apply tests are not proof of runtime execution readiness.
