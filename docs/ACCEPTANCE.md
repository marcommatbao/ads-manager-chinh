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
- OAuth callback followup: Google Ads now reuses `saveGoogleCredentials`, including
  encrypted persistence before runtime changes, fail-closed reads and env-first
  precedence. It saves the client pair actually used for token exchange with the
  new refresh token. Success requires both persisted and effective credentials;
  `google_error=reconnect_required_env_conflict` reports a saved/env conflict
  without a connection-success flag. Success redirects with `google_oauth_saved=true`,
  not `google_connected=true`; Settings displays saved OAuth separately from account
  connectivity and asks for a separate read test. Settings renders `google_error` as a
  non-success result. Redirects use fixed error codes; audit contains field names
  and a fixed outcome note, explicitly saying Google API reads were not tested.
- Callback fixture validation: actual GET with mocked token-provider boundary and
  isolated encrypted temp storage covers cold startup, atomic/unusable-path write
  failures, corrupt/wrong-key preservation, infra refresh conflict, auth/RBAC/state
  rejection before exchange/write, generic provider errors, and GA4 routing/save
  regressions. No real credentials, provider, login or deployment was exercised.
  Full suite/typecheck/build and canonical staging restart/auth verification remain
  for main; apply guards and rollout flags are unchanged.

### ACU-T02 / ACU-1d — Google debug health correction (local fixtures)

Scope: `GET /api/google/debug` → real `googleAdsClient` → mocked Google Ads SDK query boundary. This is a live account-read diagnostic, separate from saved credentials / callback success (`db3ad2d`). Configuration presence alone never proves authentication or account access.

| Source / consumer | Evidence and behavior |
| --- | --- |
| Google debug | No repository UI consumer found. Previously returned `ok:true, accounts:[]` when every account query failed because breakdown filtered rejected promises. Now uses request-local attempted/accounts/errors evidence. |
| Debug: all account reads fail (including invalid_client / permission failures) | `ok:false`, `status:failed`, sanitized `account_reads_failed`; per-account reason `account_read_failed`. No raw provider text, token URLs, client IDs from errors, or account metrics returned. |
| Debug: some reads fail | `ok:false`, `status:partial`; successful scoped account identities plus sanitized failed identities. |
| Debug: all configured scoped reads succeed with zero campaign rows | `ok:true`, `status:account_readable`. Successful campaign query proves account readability; it does not assert active campaigns or useful metrics. |
| Debug: no configured scoped accounts | `ok:false`, `status:unverified`, `no_verified_accounts`; no provider call. An empty list alone cannot establish health. |
| Debug: missing credentials / unauthorized session / role / no company scope | Missing config is explicit; 401/403 guards run before provider reads. Credential visibility uses existing `guardViewCredentials`; only authorized company IDs reach provider. |
| Connector Health UI | `components/settings/ConnectorHealth.tsx` calls `/api/connectors/health` and connector test endpoints → engine → `checks/google.ts`; it does **not** consume debug. Checker independently refreshes token and lists accessible customers. No UI/engine patch in this slice. |
| Saved OAuth status | `/api/connect/status` reports stored connection presence; settings test and callback/storage remain unchanged. Presence is not proof of account readability. |

Compatibility: legacy `getAccountBreakdown()` still returns successful summaries and updates `lastBreakdownErrors` (including throwing on absent customer config). New `getAccountBreakdownResult()` returns local evidence and never reads/writes that singleton snapshot, preventing overlapping health reads from mixing results. Error details remain internal legacy data; debug exposes fixed reason codes only.

Validation: `npx vitest run tests/google-debug-health.test.ts` — 11 tests passed; `npx eslint app/api/google/debug/route.ts tests/google-debug-health.test.ts` — passed. Including `lib/google-client.ts` in focused lint reports two pre-existing `no-explicit-any` errors in unchanged account-budget helpers (current lines 572/574), plus an existing unused-disable warning at line 152; verified against HEAD, left outside scope. Covers actual handler/client with provider boundary mocked: invalid_client all-failed, partial, zero campaigns, no accounts, missing credentials, auth/role/scope before provider, scoped account filtering, concurrent reads and legacy snapshot preservation.

Limits: debug fixture evidence only; no real provider/network or host verification. Main additionally hardened independent Google connector checker: malformed/missing resourceNames returns service_error, empty list returns warning with ok:false, valid list proves listing only (not configured campaign read access). Seven focused checker cases cover these boundaries. Snapshot/engine configuration provenance and credential-change invalidation still require follow-up; no claim of full layered health completion. No OAuth callback/storage or execution guard changes. ACU-1d runtime acceptance remains pending.

### ACU-T02 follow-up — Google connector evidence identity (local fixtures)

Google connector snapshots now require disk-only HMAC binding to the effective
runtime OAuth values and origin, developer token, all company customer mappings,
login customer, or gateway URL/install key/connection/account scope. Both check
and success timestamps must be finite, nonfuture and less than one hour old.
Config alone and legacy records without binding require recheck (warning).
The HMAC key is process-local: restart/another process deliberately requires a
new check; this slice does not claim cross-process durable proof. No secret or
marker is added to public health records, maskedConfig or logs.

Live checks capture identity before provider work and compare after; Google
success from recordLiveOutcome is ignored because that API supplies no pre-call
identity proof. Failures still record normally; non-Google behavior is retained.
Gateway health requests obtain a fresh gateway token rather than reusing the
connection-ID cache, which may belong to a previous installation URL/key.
OAuth callback and settings writes need no new writes/hooks: their effective
runtime credential changes invalidate the next snapshot automatically.

Validation: `npx vitest run tests/google-health-binding.test.ts tests/google-connector-account-health.test.ts tests/google-debug-health.test.ts`
— 39 tests passed, including fresh gateway token scope.
Binding fixtures use a temporary health store and synthetic Google credentials.
Coverage: unchanged live success, config without proof, OAuth fields, settings
origin, all customer mapping names/login/developer token, gateway URL/key and
connection/account scope, legacy marker, missing/invalid/stale/future success
and future check timestamps, mid-check change, unbound traffic success,
denied/service failures, non-Google success; actual GET health, POST refresh-all
and POST connector test handlers serialize without the internal marker.
Focused ESLint on changed connector modules and tests passed.
No real provider/network, deploy, credential/data writes, dependencies or services;
no tsc/full build. Listing success still proves accessible-account listing only,
not configured account campaign access; runtime acceptance remains pending.

### ACU-T03 / P2 — first read-only evidence slice (BA wording proposed)

Surface: existing `/do-luong` → Tag Doctor tab (`TagDoctorView`), existing
`GET /api/measure/tags`; no new endpoint, fetch, environment flag, dependency or
write capability. Roll back by removing the panel inclusion and additive
`trackingEvidence` field. Existing action/publish routes are unchanged.

Source audit / mini-spec:
- GTM report contains parsed/live tag configuration, version, source kind and
  source-level status. It has no per-source read timestamp. `collectedAt` is
  report assembly time and is used only to reject old/future/invalid reports;
  it is never presented as GTM read time. No layer claims fresh or healthy.
- `trackingEvidence` v1 contains company and five ordered layers, each with
  `status`, reason code and optional fixed source reference `tag-doctor:gtm`.
  Configured is `observed` only for same-company, at-most-30-minute report with
  successful GTM source and parsed Meta/Google tag presence. Partial/error/empty
  metadata stays unverified. This observes presence, not correctness or firing.
- Fired, sent, received and business reconciliation are unverified: current
  reader supplies no linked event-level evidence. Platform aggregate counts,
  Odoo totals, screenshots, variable Names and configuration are insufficient.
  No event identifiers, provider labels, payloads, URLs, credentials or customer
  information enter the new projection. No `readAt` is invented.
- Actual route guards user/company before the existing reader, history or GTM
  configuration helpers. Mismatched reader company is rejected before report
  serialization. No new provider connection/auth claim is inferred.

State / test map:

| Acceptance | Delivered behavior / focused proof |
| --- | --- |
| ACU-2a | Deeper layers stay unverified even with config/fired extra fields; unit projection test. |
| ACU-2b | Variables Names/screenshot ignored; runtime next check asks for redacted Values; unit + localized static render. |
| ACU-2c | Partial/error source fails closed. Consent, network, receipt delay, currency and browser/server dedup require evidence; checklist only, no automatic diagnosis. |
| ACU-2d | Old/future/invalid/mismatched metadata fails closed; real route auth/company guards tested with boundary mocks; mismatched report returns 502. |
| ACU-2e | TikTok read-only checklist explicitly states missing authorization/scopes/test target; no TikTok reader or writes added. |

Loading/error/permission continue through existing Tag Doctor parent (no second
request); missing additive response field has an empty fallback. Partial/stale
responses render per-layer reasons. Panel uses existing Card, semantic tokens,
Lucide and vi/en keys. Native details/summary is keyboard operable, focus visible,
no chart/stat tile. Copy is proposed for BA review, not business sign-off.

Validation: `npx vitest run tests/tracking-evidence.test.tsx tests/tracking-evidence-route.test.ts`
and focused ESLint on changed TS/TSX files. Fixtures are TEST ONLY; provider,
auth/session and persistence boundaries are mocked. No env secrets, network,
service start, build, tsc, deploy, publish or event sending was performed.

Browser fixture instructions for main (not executed by worker): on an existing
local preview, intercept **only** GET `/api/measure/tags*` with a TEST ONLY copy
of a normal response shape; do not point at a provider or enable mutation actions.
Use `projectTrackingEvidence` and synthetic report from
`tests/tracking-evidence.test.tsx` to produce the additive field. Alternatively
mount `TrackingEvidencePanel` in an existing local component fixture inside
`I18nProvider`; it needs only `trackingEvidence`, no session/provider. Exercise
observed-config, missing/partial, stale, future and undefined data in both locales.
At 375/768/1280px verify wrapping/no horizontal scroll, Tab to every summary,
Enter/Space expansion and visible focus. For whole-screen states, intercept the
existing GET with delayed response, 401/403/500 and empty data; confirm parent
loading/error/permission feedback and no extra request. Do not click existing
fix/publish buttons. Browser viewport/keyboard verification remains pending main;
static render tests do not establish visual acceptance. Main subsequently ran an isolated real-component + built-CSS Chromium fixture: 24/24 vi/en × configured/partial/stale/empty × 375/768/1280 passed, no horizontal overflow/page errors, Tab/Enter/Space verified and mobile screenshot reviewed. No server/provider calls; full parent routing/auth, screen reader and live receipt verification remain pending. No new fixture route is
shipped. Full P2 runtime/receipt/reconciliation remains outside this first slice.
