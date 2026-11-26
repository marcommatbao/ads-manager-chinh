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
- Original slice (superseded for freshness by the source-read provenance update below): `trackingEvidence` v1 contains company and five ordered layers, each with
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


### ACU-T03 / P2 — GTM source-read provenance follow-up (2026-11-26)

This update supersedes the earlier assembly-time freshness rule above. Public
`fetchGtm` records optional `GtmContainer.readAt` only after the successful body
read and parse. API `readLive` records optional `GtmLive.readAt` after the successful
live response read; `liveToContainer` preserves it, including undefined for legacy
objects. The existing Tag Doctor report cache retains these values unchanged.
`collectedAt` remains assembly time and is never used as source freshness.
No migration, additional request, provider connection, flag or dependency is added.

Configuration is observed only for matching company, successful GTM source,
recognized tag configuration, and **every** returned container having a canonical,
finite, nonfuture source timestamp at most 30 minutes old. The oldest read controls
freshness. Missing/invalid/future times, partial/error reads, and legacy unknown
cache entries remain unverified; existing next-check guidance remains available.
A failed container in the existing multi-read collection conservatively prevents
configuration observation. All deeper layers remain unverified.

The additive v1 configured layer carries a fixed `sourceRef: "tag-doctor:gtm"`,
optional aggregate `readAt` (oldest, only when all timestamps are valid), and up to
20 `sources`: `{ sourceRef: "gtm:api" | "gtm:public" | "tag-doctor:gtm",
readAt: string | null, configVersion?: string }`. Versions accept only 1–20 digits;
references are fixed enums. No IDs, URLs, account paths, tokens, raw payloads or
version names enter this projection. Cross-company projection carries no source
metadata; the existing route rejects mismatched reader company before serialization.

Panel vi/en displays earliest read and individual source reads/available versions
inside the existing native disclosure. Dates use locale formatting and explicit
UTC+07:00. Unknown time has explicit wording and no `<time>` element. Existing
Card/tokens, wrapping and keyboard disclosure are retained. Wording is BA proposed.
`TagDoctorApiResponse.trackingEvidence` is optional for legacy responses.

Focused validation: **39 tests passed across 5 files**, plus scoped ESLint passed:
`tests/tracking-evidence.test.tsx`, `tests/tracking-evidence-route.test.ts`,
`tests/gtm-read-provenance.test.ts`, `tests/tag-doctor-cache-provenance.test.ts`,
`tests/tag-doctor-parent.test.tsx`. Coverage includes public/API completion timing,
pure-parser/legacy unknown, API conversion, actual report assembly/cache retention,
old source + new assembly staying stale, absent/malformed/future/mixed container
times, partial multi-read failure, true fresh configuration, authorization and
cross-company route rejection, bounded secret-free projection, vi/en disclosures,
and actual parent loading/error/403/empty legacy rendering. Provider, SWR and
mutation-panel boundaries are mocked; these are static rendering/unit/route tests,
not full browser routing, live authorization, interaction or screen-reader proof.
No full tsc/build, network/provider/env-secret access, server start, deploy, GTM
publish, event send, commit or push was performed for this update.

Main browser fixture adjustment: add `gtm[].readAt` in canonical ISO form, e.g.
`"2026-11-26T01:00:00.000Z"`, before calling `projectTrackingEvidence` with an
appropriate synthetic `now`. Keep `source: "api" | "public"` and numeric-string
`version` if testing metadata. For stale use a source time older than 30 minutes
while keeping `collectedAt` new; for unknown omit `gtm[].readAt`. Direct panel
fixtures may add the configured-layer `sources` array and aggregate `readAt`
shape above. Previous browser acceptance predates this timestamp UI addition;
responsive/keyboard browser recheck remains with main. User will redeploy manually.

Main resumed verification: actual panel + built CSS browser fixtures passed 24/24
across vi/en, configured/partial/stale/empty and 375/768/1280px. Expanded source
read time/version disclosure and UTC+07:00 were asserted; keyboard Tab/Enter/Space,
no horizontal overflow and no page errors verified. Expanded mobile screenshot
visually reviewed. This is isolated static component evidence, not full Next
routing/auth/provider or screen-reader acceptance. No server/provider calls.

### ACU-T03 / P2 — Connection Health evidence slice (local fixtures, BA wording proposed)

- Reuses `components/settings/ConnectorHealth.tsx` and the actual GET health / POST test response record. Always-visible semantic rows separate required-field presence from check evidence and freshness. Existing status, permissions, loading/fetch behavior and Test actions remain; details now use a keyboard-operable button. No new provider requests on render.
- `lib/connectors/evidence.ts` imports only the public record type. Its allowlist output contains configuration/freshness/outcome codes, a validated attempt timestamp and a Google/other scope code. No maskedConfig, provider message, URL, secret, digest or internal binding is copied.
- Matrix: absent record/config, partial config, never checked, auth/service failure, disabled, stale (>=1 hour), invalid/calendar-normalized or future timestamps, missing/invalid/old/future success, warning despite prior success, recent Google listing and conservative non-Google recorded success. Warning always requires recheck; acknowledgment is not a resolution. Google listing requires healthy public status plus matching recent check/success timestamps; the engine owns credential identity validation.
- Google scope explicitly excludes configured campaign data, event receipt and attribution. Other providers describe only the configured check, potentially configuration-only: public records do not identify whether a success came from a synthetic check or real traffic. No invented per-provider capability statuses. TrackingEvidencePanel is unchanged.
- Validation: `npx vitest run tests/connector-evidence.test.tsx tests/google-health-binding.test.ts tests/google-connector-account-health.test.ts tests/google-debug-health.test.ts` — **60 passed**, including 21 new projection/static-card tests. Existing binding test additionally consumes real GET JSON, asserts public record shape and no internal marker, checks GET does not invoke the checker, and projects Google listing from that response.
- Focused ESLint: helper, tests and both locale files pass. ConnectorHealth retains the pre-existing `react-hooks/set-state-in-effect` error at `useEffect(() => { load(); }, [load])`, reproduced by linting HEAD via stdin; left unchanged. No full TypeScript/build or unrelated lint fixes.
- Browser fixture shape: `{ records: { google_ads: ConnectorHealthRecord }, connectors: [{ id: "google_ads", displayName: "Google Ads", supportsLiveTest: true, color: "", icon: "" }], canTest: boolean }`. Mock GET and existing POST test responses only. Use canonical ISO timestamps relative to fixture clock; card export accepts optional `now` for deterministic isolated renders. Cover vi/en × missing/partial/never/failed/stale/future/invalid/healthy-listing/warning-with-lastSuccess/absent-record × 375/768/1280, plus canTest false/loading/error and keyboard detail toggle. Missing `records[id]` or legacy absent `records` falls back to no check evidence.
- Main review additionally downgraded stale healthy card/summary badges, added explicit GET loading denial/failure/retry and empty states, and regression-tested stale warning rendering. Full regression 431 PASS/71 skipped before extra final assertion; final evidence+binding42 PASS. Static real-card browser fixtures36/36 PASS, no overflow/page errors, keyboard focus verified, mobile screenshot reviewed. No hydrated click/full route transition or screen-reader claim. Existing component effect lint defect remains documented.
- Remaining acceptance: hydrated interaction/theme/screen-reader checks, full Next auth/routing and deployed response compatibility, manual provider listing scope proof, BA wording approval, and broader ACU-2a–e receipt/reconciliation/runtime evidence. No live provider/config/deploy action. Main records final build/commit/push in NEXT; worker did not perform these.

### ACU / P3 — First Action Inbox DATA QUALITY slice (26/11/2026, local fixtures)

- **Audit / reuse (CODE):** read `CLAUDE.md`, `AGENTS.md`, upgrade plan P3; existing `lib/inbox/{build,store,labels,localize,template,job}.ts`, `app/api/inbox/route.ts`, Việc hôm nay, overview health, connector engine/store/types/evidence and binding tests. Existing stable keys, dedup, kind 1→2→3 ranking, nullable money, snapshot persistence, status and reverse localization already exist. Gap: source errors were only banners; stored Google health had no Inbox consumer; card lacked source evidence and a read-only next check. No second Inbox or lifecycle engine added.
- **Implemented path:** existing build appends bounded Google connection/source-failure items → existing atomic snapshot store → actual GET → existing card with `components/inbox/SourceEvidence.tsx`. Additive optional `InboxItem.evidence` has allowlisted source reference, global/company scope, normalized reason, nullable source `checkedAt`, diagnostic next-step code. No migration or new endpoint. `lib/inbox/evidence.ts` is client-safe; locale wording in vi/en overview remains **proposed, pending BA**.
- **Truth / scope:** Google input comes from `snapshotAllConnectors()` with current exact binding validation, never raw disk healthy. GET authorizes installed company scope before Inbox/health reads, reprojects current Google evidence without writing the snapshot, and only emits authorized-company items. Global connector health explicitly does **not** prove each company/account's access, campaign metrics, receipt or attribution. No account IDs, masked config, binding digest, provider error text or secrets are copied. Source failures are normalized in newly built snapshots and legacy errors are normalized on API output; digest keys are scope-filtered and raw digest errors omitted.
- **User-visible states:** missing/partial config, never checked, auth failure, service failure, stale and recheck differ from optimization opportunities. Source read failure has a separate reason and null timestamp. Valid known check time is shown with UTC+07:00; unknown/future/invalid time remains null. Shared check timestamp is labelled as connector evidence, not company source observation. Healthy current engine evidence avoids the connection issue. Data-quality items have no money, campaign IDs or budget mutation. Existing rank formula and old status semantics remain. Current health can appear even before the first scheduled Inbox snapshot; no fabricated build time.
- **Notification boundary:** no new provider calls, schedules or auto-send. Existing build still uses its existing source readers; the new health step reads only the engine snapshot. New quality items are excluded from existing digest selection/open count, leaving the pre-existing notification selection and sending path in place. Tests never send messages. GET reads do not call source/provider readers or write files.
- **Validation:** `npx vitest run tests/inbox-quality.test.ts tests/inbox-quality-boundary.test.ts tests/inbox-quality-ui.test.tsx tests/google-health-binding.test.ts tests/connector-evidence.test.tsx` (final result below). Actual build and GET run against real Inbox files in temporary directories, with provider/auth boundaries mocked and real company permissions; tests cover repeated stable/deduped keys, normalized failures, absent snapshot, denied-before-source access, company-isolated API/digest output, GET no provider/send/write, persisted item refreshed by engine projection, and preserved ranking/digest selection. The actual connector engine/binding test confirms raw disk healthy cannot suppress an issue after effective identity changes or missing authority. Static real evidence-panel renders cover vi/en, unknown timestamp, known timestamp and read-only diagnostic link. Fixtures only; no production Inbox reset/delete.
- **Limits / remaining P3:** ACU-3b and part of ACU-3d have local evidence only; do not close full P3. No new acknowledge/ownership/observing/resolved model, revision/409 concurrency, briefing blocked/fallback integration, source-wide account authority, campaign evidence enrichment, hydrated browser/375px/keyboard acceptance, deployed auth/response verification or runtime/provider proof. Existing done/snooze/dismiss behavior remains; it is not verified resolution. Legacy optimization items retain existing evidence limits. Beta/Meta writes, notifications rollout, GTM receipt and broader P3 lifecycle remain deferred. Main owns NEXT/plan/release tracking. No tsc/build, service, dependency, deploy, stage, commit or push performed.
- Main review: dynamically projected data-quality items are read-only; existing done/snooze/dismiss controls are hidden for them, avoiding unsupported snapshot-only status updates. Legacy item controls are unchanged. Main full regression initially exposed two incomplete UI test fixtures; corrected worker fixtures and final full suite450 PASS/71 skipped. Browser actual SourceEvidence component/CSS fixtures18/18 PASS, no overflow/page errors, keyboard link focus verified, mobile screenshot reviewed. Not hydrated full-page workflow acceptance. Final typecheck/build recorded in NEXT.
- **Final local evidence:** focused command above — **5 files / 60 tests PASS**; focused ESLint over all 13 changed TypeScript/TSX files — **PASS, no warnings**; `git diff --check` — **PASS**. Vitest prints the existing config-loader compatibility notice. Initial static-panel fixture omitted the required `viewItems` state argument; corrected fixture to consume pure builder output, then all final tests passed. No tsc/build or full-suite claim. Overview health can internally settle partial sub-source failures into cards/notes without throwing; those inner failures are not yet propagated into Inbox items by this slice and remain a follow-up.

## P3 bounded legacy Inbox status revision — 2026-11-26

Implemented on existing GET/POST `/api/inbox`, without a new workflow engine.
GET includes each item's `revision` (explicit `null` for no saved state; stable
SHA-256 legacy token for rows without a revision). Reads do not migrate state.
POST requires `expectedRevision`; malformed/missing tokens return 400, stale
edits return 409. The existing process-local file mutex encloses current saved
item lookup, company authorization, evidence eligibility, state read, revision
check and atomic write. Successful edits receive a server UUID revision and
server session actor. Reopening retains a `new` row so it cannot immediately
restore a previously issued null token. Existing 90-day pruning remains.

Read-only quality evidence cannot be marked seen/done/snoozed/dismissed through
POST, including guessed keys. Missing snapshots/current items return 404;
unauthorized companies return 403 without writing state. Failed atomic writes
and malformed stored JSON return failure rather than fabricated success.
Existing until/reason, money baseline, snooze/money/done resurfacing and
notification candidate rules remain in use; status edits do not send anything.

The Việc hôm nay UI submits the GET revision (the captured item revision for
an open dialog). A 409 shows localized reload/review guidance and revalidates;
there is no automatic mutation retry or optimistic success notification.

Validation: `npx vitest run tests/inbox-status-revision.test.ts tests/inbox-quality-boundary.test.ts tests/inbox-quality.test.ts tests/inbox-quality-ui.test.tsx`
— **36 tests passed across 4 files**, using actual temporary file stores and
route handlers with mocked auth/connector metadata; no provider calls or sends.
Coverage includes same-token parallel winner/conflict, stale after reload and
reopen, legacy/idempotent reads, different-key preservation, actor spoofing,
company/auth denial, quality/missing snapshot rejection, malformed status/token,
normal status and notification eligibility, and atomic-write failure.
Focused ESLint passed for the changed TS/TSX files; `git diff --check` passed.

Limitations: the mutex is **process-local**, not cross-process/distributed
locking or SQLite authority. Existing state retention still bounds token
history. UI conflict handling was inspected in code; no browser interaction
run was performed. Existing evidence rendering tests passed. No full suite,
tsc, build, deployment, migration, real-data changes, commit or push performed.
The existing Vitest/Vite configuration emits its CommonJS/native-loader warning.

## Bounded P3/P4 Google source-health loop — 2026-11-26

**Chosen path:** Google connector source-quality only. Overview and Việc hôm nay
render `QualityActionBrief` from `actionBriefs` in authenticated GET `/api/inbox`.
`google-source-health-v1` is a deterministic, company-scoped action digest,
not generated AI prose. Both the brief and the existing Inbox quality evidence
panel expose the **same registry ID, stable Inbox key, source ref, source read
time and capture time**. The global morning briefing/history are unchanged;
this does not claim that the generated AI briefing is now Inbox-integrated.
Missing source time stays null. A healthy connector may remove the current
warning, but the action/timeline remains visible for its retention period.

**Workflow:** editor records an external source-remediation action, with an
immutable server reference/baseline, session actor and server action time.
Execution remains `externally_recorded_unverified`. One action per company/key
is retained for 90 days; repeat recording of that baseline is idempotent,
not another external action. The manual recheck button first GETs
`/api/inbox/quality?company=MBC`, then POSTs the returned registry ID and the
viewed workflow revision. The engine snapshot reader is reused; **this does
not run a live connector check**. Another existing authorized source check
must have produced newer evidence for a conclusive health observation.
Timeline includes actor/time, baseline and observation refs/read times,
`listing_observed`, `issue_observed` or `inconclusive`. No new/post-action read,
stale/missing/future/invalid source time stays inconclusive. A source read no
newer than the previous observation also stays inconclusive. Repeated refs are
idempotent; a different observation within 30 seconds returns 429.

**Authority and boundaries:** authentication/company checks precede source or
store access; POST requires `can_edit`, checks current evidence when recording,
and rejects client metrics/extra fields. Workflow CAS uses server UUID revisions
and returns 409 for stale versions; record/observation retries return the prior
write for the same reference. Registry references are allowlisted projections
from the current connector engine, content-addressed, immutable and valid for
15 minutes. Exact company/provider/Inbox key/source/global-connector scope is
validated. This is **global Google listing health**, not proof of company,
account or campaign access. There is no invented campaign/account mapping,
currency or budgetKind. Existing campaign snapshot registry/consumer and budget
reconciliation are untouched and remain available for a later campaign-bound
slice with exact account/campaign/currency/budgetKind verification.

No provider writes, approvals, consumed-approval fixtures, claims, quota,
execution outcomes, legacy Inbox status guards, auto-resolution, provider calls,
notifications or causal benefit claims are added. Day 3/7 due dates are visible
as pending assessment, never a fabricated outcome. Campaign budget comparison,
real checkpoint samples/outcome scheduling, confounder collection, broader
ownership/resolution lifecycle and deployed/hydrated browser acceptance remain
open; this does not close all P3/P4 gates.

**Storage/privacy:** reuses `withFileLock` and `writeFileAtomicSync`; normalized
health references/actions live in `data/inbox-quality-workflow.json`. GET may
register a new server evidence reference, but identical evidence within TTL
reuses its ID without rewriting. No provider payload, masked config, secret,
provider error text, free-form notes or LLM output is stored. Actor identity and
normalized evidence are returned only within authorized company scope; do not
publish this internal file. Registry/actions cap at 2,000 each, observations at
30 per action; full capacity refuses rather than evicting valid references.
Expired refs and actions older than 90 days are pruned on successful activity;
retention cleanup is lazy, not a timed erasure guarantee. Baselines and past
observation refs remain embedded in retained actions after registry expiry.
Malformed storage fails closed. Atomic rename protects file replacement;
the mutex/CAS is **process-local only**, with no multi-process/distributed
write guarantee. Existing shared atomic helper can leave a temporary file if
rename fails; a failed write does not replace the prior authoritative file.

**Browser fixture shapes (synthetic only):** GET `/api/inbox` retains existing
`items/errors/builtAt/canEdit` fields, adding `actionBriefs: [{version, company,
key, reference, action}]`; Google quality items also carry
`evidenceRef: {registryId, capturedAt}` matching the brief. `reference` contains
`registryId/company/key/provider:"google"/scope:"global_connector"/sourceRef:
"connector:google_ads"/capturedAt/expiresAt/readAt/health/evidence`.
`action` is null initially, then `{id,company,key,revision,baseline,actor,
actionAt,execution:"externally_recorded_unverified",observations:[]}`.
Observations append `{ref,at,actor,result,reason}`. Fixtures should preserve
baseline/ref identities across reload, mock a later engine read for a positive
listing observation, and keep unchanged source time for inconclusive. Scoped
GET `/api/inbox/quality` returns `{success:true,brief,canEdit}`. POST body is
exactly `{company,operation:"record"|"observe",registryId,expectedRevision}`;
responses are `{success:true,action}` or `{success:false,code}` (409 conflict,
429 throttle, 503 unavailable). UI supports vi/en, pending, error, viewer,
disabled/loading and conflict/reload states with semantic tokens. Actual static
component renders are tested; no hydrated browser workflow was run here.

**Focused verification:** temporary-file route/store integration, pure evidence
matching and actual React render tests in `tests/inbox-quality-workflow.test.tsx`
cover shared Inbox/brief identity, scope/auth/role denial, immutable baseline,
actor, stale/future/missing/pre-action evidence, replay, CAS conflict, concurrent
idempotency, atomic failure/reload, malformed storage, eligible/healthy/failure
states, throttle, observation cap/retention and vi/en timeline controls.
Final focused results are recorded below. All new action records were synthetic
and written only under OS temporary directories. No live provider/network,
secret inspection, migration/service/deploy, full tsc/build, dependency change,
git stage/commit/push, or NEXT/plan edits were performed.

Final local result: **9 files / 101 tests passed** with
`npx vitest run tests/inbox-quality-workflow.test.tsx tests/inbox-quality-boundary.test.ts tests/inbox-status-revision.test.ts tests/inbox-quality-ui.test.tsx tests/inbox-quality.test.ts tests/morning-briefing-route.test.ts tests/morning-briefing-history-route.test.ts tests/snapshot-consumer.test.ts tests/connector-evidence.test.tsx`.
Focused ESLint passed without warnings on the nine changed/new TS/TSX files
other than the overview page. Overview ESLint reports four pre-existing errors
(`set-state-in-effect` twice, `purity`, `immutability`) and existing warnings;
running the same lint against `git show HEAD:app/(dashboard)/page.tsx` confirmed
the identical four errors before this patch. No lint guards were removed.
`git diff --check` passed. The existing Vite config-loader notice remains.
