# P6 — bounded attribution source truth

Implemented an opt-in `readOrdersTruth` in `lib/orders/sources.ts`, consumed by the existing `readAttributionReport` and `/api/attribution/report`. No global change to `readOrders`, `readStoredOrders`, ingestion, provider adapters, or campaign revenue consumers.

## Contract

- Source metadata binds company, selected source, exact ISO from/to, status, completeness, reason and nullable source readAt. Scope is explicitly `selected_local_store`.
- Missing/unconfigured/unsupported source, malformed config, missing/unreadable/malformed store or invalid order shape produce unavailable + orders null. The report emits empty detail lists with nullable duplicate count and coverage; these lists are not proof of zero orders. Check source.status before using them.
- A successful complete empty local-store read legitimately yields empty matched/unmatched lists and duplicateOrders 0. Order and revenue coverage are null when their denominator is zero. No aggregate revenue/currency total was added.
- readAt is stamped only after bytes are actually read from the order store, including a read whose JSON validation fails. It is null when no order source was read. It is neither ingestion time nor upstream freshness, never persisted by this path, and cannot unblock pacing.
- Completeness only describes reading the selected local file in full. It does not establish upstream delivery coverage. Requests beyond the existing 120-day retention window, or a store at the 20,000-row cap, fail closed; no retention watermark/history was invented.
- Supported Odoo is explicitly unavailable with `completeness_unverified`, readAt null. Its existing adapter caps the raw query at 5,000 before normalization and has no truncation proof. This strict path does not call it or certify completeness. Unsupported Odoo remains a distinct unavailable reason. The legacy Odoo path is unchanged.
- The report route still authenticates and authorizes before source reads. Multi-company ALL requires selecting one company rather than manufacturing a source for ALL. A single authorized company still resolves from ALL. Existing lead won-stage, order payment/team/type and date filters remain intact.

## Unique-order coverage

The matcher revenue denominator excludes duplicate rows. Identical duplicate evidence contributes one order/value. Duplicate conflict in value, currency or matching evidence prevents assigning that key; its unique unmatched row has value null, and both coverage rates are null for the report. This is independent of input order. Nonconflicting rows may still appear as details; no complete revenue total is claimed. Multiple currencies also make revenue coverage null instead of summing unlike units. Duplicate detail rows remain identified as duplicate_order for compatibility and must not be summed.

Matching priority and ambiguity behavior otherwise remain click ID, UTM campaign, campaign label. No provider/account/campaign IDs, authoritative campaign mapping, new customer identities or raw config/error diagnostics were added. Existing lead/order IDs remain only in their existing report API. No new persistence or automation integration.

## Limits / integration

This is a source-quality fix for the existing lead/order report, **not completed P6 pacing**. Account/campaign attribution remains blocked pending authoritative company/provider/account/campaign mapping and upstream freshness/completeness evidence. Profit/COGS is outside this slice.

No current UI calls `/api/attribution/report`: `app/(dashboard)/reports/attribution/page.tsx` calls the separate platform-comparison `/api/attribution`. No parallel report or misleading source state was added to that unrelated API/UI. The existing API now carries explicit unavailable/unknown coverage for its consumers. Lead-event store availability remains a separate limitation: this slice does not change its legacy empty-on-error behavior.

No jobs, workflow, Inbox, ACCEPTANCE, shared i18n, provider business filters or deployment files changed. No provider/network/live data, services, dependency changes, full tsc/build or git actions.

## Local validation

- `npx vitest run tests/orders-source-truth.test.ts tests/attribution-matcher.test.ts tests/attribution-report.test.ts tests/attribution-report-route.test.ts tests/campaign-revenue-attribution.test.ts` — 5 files / 34 tests PASS.
- Real route/report/source integration uses synthetic in-memory file reads and mocked auth/lead boundaries. Auth/company/ALL denial occurs before reads. Corrupt vs empty store reaches the real response without diagnostic text. Tests cover missing/invalid configuration, unsupported/capped Odoo contract, unreadable/corrupt store, metadata, source/date selection, retained range, unchanged legacy behavior, identical/conflicting duplicates in both orders, mixed currencies, ambiguity and null coverage.
- Focused ESLint over the four runtime files and four changed test files — PASS (no warnings).
- Vitest prints the existing Vite config-loader compatibility notice. No browser/runtime/provider acceptance claim.
