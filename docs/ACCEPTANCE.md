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

## Gate 3 source diagnostic privacy — 2026-11-21

- Successful blocked briefings now use fixed source/category wording in `dataGaps`; source rejection objects/messages are never stringified. Meta source failures and AI fallback failures log only application-owned category plus Error/non-Error classification.
- Real route/engine regression coverage exercises account insights, campaign list, and campaign insights failures with Error, string, and object rejections containing synthetic private diagnostics/token URLs. JSON responses, GET cache reads, persistence handoff, and source-failure logs exclude those details; blocked sources still prevent Gemini/timeout calls. Healthy Gemini and fallback controls pass.
- History normalizes diagnostic `dataGaps` and `evidence.note` on save and read, retaining only known source prefixes/fixed notes. Legacy read normalization is tested. Reads do not migrate the existing file; a later successful save rewrites retained entries with normalized diagnostics. This is not general redaction of arbitrary snapshot fields or proof that deployed historical files have been migrated.
- Verification: focused route/quality/history/history-route suites **32/32 PASS**. No live providers, staging/browser acceptance, production operations, or feature flag changes. Full suite/build remain for main.
- Main follow-up also replaced route fatal generation/history-write logging with fixed category and Error/non-Error classification; regressions exclude internal diagnostic strings from those logs. History tests now use isolated temporary directories instead of repo data/. Runtime authenticated staging/browser acceptance remains PENDING.
- Scoped ESLint on the two changed libraries and two changed test files: PASS. `npx tsc --noEmit`: PASS.

## Campaign/provider attribution feasibility — 2026-11-21

- **BLOCKED: no trustworthy existing binding from business evidence to provider campaign ID.** `lib/campaign-revenue.ts` groups `sale.order.campaign_id` by Odoo `utm.campaign` product labels, returns no Google/Meta campaign ID, and explicitly refuses MBI separation. Its coverage describes company-wide label presence, not coverage of a provider campaign. `/api/audience/campaign-revenue` exposes that label-level report only; matching a provider campaign name to a label would invent a mapping.
- `lib/attribution/report.ts` joins paid orders to won lead events through `lib/attribution/matcher.ts`. The result identifies an order/lead and matching method, without provider/account/campaign binding or source freshness/completeness metadata. Stored `LeadEvent` has click IDs but no provider campaign ID; `RealOrder` has optional UTM/product labels, while the Odoo adapter does not populate campaign evidence. A click-ID match establishes an order/lead link, not the requested campaign link. The existing report also includes order/lead identities, so it must not be copied into automation responses or persistence.
- Absence cannot safely become zero: `readOrders` returns `[]` for an unconfigured/unsupported source and `readStoredOrders` catches read/parse errors as `[]`. `getCampaignRevenue` keeps explicit errors but its numeric fields default to zero on failure. Matcher revenue coverage includes duplicate-row values in its denominator, so that ratio is also unsuitable for automation coverage without separate remediation.
- Required future contract (design only, **not implemented**): exact company/provider/account/campaign and from/to binding; source and source readAt (null when never read); explicit available/unavailable/stale status; matched/unmatched unique-order counts and a documented coverage denominator; nullable orders/revenue/currency/coverage. Unavailable values must be null. A verified complete read with no orders may legitimately report orders/revenue = 0, with coverage null when the denominator is zero. Do not substitute platform conversion value, product-label totals, or a newly stamped read time for campaign revenue/freshness. Reject cross-company/range binding, ambiguity and duplicate conflicts before producing available evidence. Only aggregates may leave the helper or enter persistence.
- No helper/route/collector integration was added: an always-unavailable helper without a consumer would not establish this contract. Existing `approvable:false`, missing-attribution/profit, learning/maturity and currency/unit guards are unchanged. Unblocking requires an existing authoritative, company/account/provider-scoped campaign binding plus source availability/completeness/read-time evidence; none was found in the inspected source contracts. No new Odoo mapping is assumed.
- Focused existing attribution suites: **4 files / 11 tests PASS**, covering company denial at the report route, unique/ambiguous/duplicate matching, MBI refusal and explicit Odoo failure. These do **not** certify stale/absent/zero-real-versus-unavailable behavior at provider campaign scope; that integration and its acceptance tests remain **BLOCKED**. No live provider/network calls, services, migrations, dependency changes, deploy, staging, commit or push were performed. Full suite/build remain for main.
- Existing collector/consumer/profit guard regression: `campaign-snapshot`, `meta-campaign-snapshot`, `snapshot-consumer`, `profit-evaluator` — **4 files / 52 tests PASS**. Scoped ESLint on the three inspected attribution libraries and four attribution test files: **PASS**. No new tests or runtime code were added in this feasibility-only step.

### ACU-T01 — bounded Google credential durability/provenance slice

- Repro/audit: the previous Google settings writer assigned `process.env` before
  encryption/atomic write, without `env-origin` markers. Startup `applySaved`
  retains nonempty env values. A successful-looking save could therefore differ
  from a fresh process, or change runtime even when persistence failed. This is
  a code-level defect, **not an established diagnosis of the live incident**.
- Compatibility: retain env-first startup, legacy encrypted JSON fields and both
  `customerIdMBC`/`customerIdMbc` spellings. No managed-source migration, extra secret
  copy, revision hash, key/path change, deployment flag or provider call. Existing
  OAuth callback can still read the file. Company maps merge under the existing
  process-local file lock; concurrent writers in separate processes remain an
  existing limitation.
- Save writes encrypted settings atomically before using `patchFromSettings`;
  unmarked env values remain effective. Read/decrypt/write failure returns an
  error and leaves runtime unchanged. Masked input does not replace other secrets.
  GET/POST provenance contains only field names, source categories and booleans;
  supplied provenance is ignored. Existing masked GET fields remain compatible.
- `persisted` on POST describes this write; `provenance.persisted` describes a
  currently readable saved configuration, including one retained after a failed
  write. `effective` compares saved nonempty fields with runtime; neither value
  proves auth, permissions, account access, a stable mount, or a successful restart.
  A no-change POST has `persisted: false` and still reports current provenance.
- Source tracking uses `env-origin` markers, not inspection of an overwritten
  value to reconstruct original deployment env. `origin: env` means nonempty,
  unmarked process env. It cannot recover original env after a legacy writer
  already overwrote it. `restartVerified: false` is intentional. Restart behavior
  is conditional on the same env, key and storage; failed reads are `unknown`.
- Fixture validation: focused Vitest covers actual settings POST → encrypted temp
  file → fresh Node process using `applySaved`, raw env conflict vs settings-origin,
  repeated saves, legacy file compatibility, masked placeholders, missing/wrong
  keys, corrupt files, unusable paths, atomic replacement failure and redaction.
  Tests supply synthetic child env and do not load deployment config or providers.
- Remaining runtime acceptance (`needs_main_action`): establish the actual target,
  persisted mount/path and key lifecycle through approved operational metadata,
  then run restart verification on the canonical staging stack before claiming
  ACU-1a/b/c complete on beta. Real auth rejection/permission/zero-account health
  remains ACU-T02; this slice explicitly reports auth as `not-tested`.
- Separate followup for main review: the existing Google OAuth callback has its
  own legacy writer (direct env overwrite before persistence and swallowed read/
  write errors). Its file format remains compatible; this bounded settings patch
  does not change the callback/provider flow. Reusing `saveGoogleCredentials` there
  and reporting save/conflict failures requires callback-specific tests. Avoid
  claiming this slice fixes every OAuth-origin save path.
