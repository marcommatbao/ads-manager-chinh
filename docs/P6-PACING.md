# P6 — Account-aware budget pacing

P6 is a read-only slice at `/toolkit/budget-pacing`. P7 remains blocked. No mutation route, shared forecast utility, acceptance document or NEXT document changes.

## Calculation and scope

The authorized company resolves its account ID server-side (`GOOGLE_CUSTOMER_IDS`), then a customer query must return that same ID, supported currency and a valid IANA time zone. Browser account/currency/timezone parameters have no authority. Civil calendar arithmetic uses that zone; UTC is used only to increment civil dates, never to decide account “today”.

Four sequential provider queries: customer metadata; full current membership with explicit ENABLED/PAUSED/REMOVED statuses and budget resource/id/amount/explicitly_shared; campaign daily spend from the earlier of month start and seven days ago through yesterday; today's daily spend separately. The provider query client must resolve the entire result set. No LIMIT, enabled-only spend filter or fallback zero on failure. Every spend row must match the account, known member and requested calendar range. Duplicate campaign/date rows (including identical duplicates), invalid dates, conflicting metadata, negative/noninteger/nonfinite micros fail the response closed with a sanitized 502. A fully successful empty result establishes no returned spend; an absent date never becomes an observed zero for run-rate sampling.

Budget identity is `customers/{account}/campaignBudgets/{id}`. Current members include paused/removed campaigns so their spend is retained. Daily budgets are counted once per resource; campaign/date spend is counted once. Shared rows show current membership, partial coverage and actuals grouped by **current assignment**. Current membership does not prove historical shared-budget assignment: shared forecasts remain blocked until that evidence exists. This limitation is explicit in the UI; no historical budget attribution is claimed.

For an unshared budget, at least **3 observed completed dates** are required, preserving the existing quality contract. Missing dates are excluded, not imputed as zero. The run-rate is the mean of observed dates within the seven completed days through yesterday. Forecast = completed month-to-date actual + run-rate × remaining calendar days, **including today**. Today's partial spend appears only in actual MTD, not in the forecast baseline or run-rate. On day one the completed MTD baseline is zero; `sourceRanges.completed.to` is null with `no_completed_days`, while recent observations may come from the previous month. DST and UTC+14 do not change civil day counts.

`monthlyReference = dailyBudget × daysInMonth` describes the current daily rate over a calendar month. It is neither Google's billed spending limit nor a hard cap, account balance, or historical approved budget. No exhaustion date or automatic action is produced. Numeric amounts retain micros precision rather than rounding to whole currency units. UI formats the authoritative currency using the selected vi/en locale.

## Response and browser fixture

`budgets` is authoritative; `campaigns` is a compatibility alias of those same **budget rows**, not duplicated campaign allocations. Honest legacy aliases retained: `budget` (monthly reference only), `spent`, `dailyBudget`, `actualPct`, `expectedPct` (completed-day elapsed percentage), `recentDailyAvg`, `projectedSpend`, `projectedPct`, `forecastQuality`, `forecastAllowed`. `daysUntilCapped` is always null; old cap assertions/click/conversion fields are omitted. Consumers requiring campaign allocations must migrate rather than sum both aliases.

The real card is exported as `CompanyCard`. The deterministic fixture in `tests/budget-pacing-ui.test.tsx` renders it in vi/en, including shared membership, actuals, references, blocked/insufficient reasons and a separate ready forecast. For browser request interception, return this shape from the GET endpoint (use each authorized company in its corresponding response):

```json
{
  "success": true,
  "company": "MBC",
  "accountId": "123456",
  "currency": "USD",
  "timeZone": "America/New_York",
  "readAt": "2026-11-10T17:00:00.000Z",
  "dayOfMonth": 10,
  "daysInMonth": 30,
  "elapsedPct": 30,
  "sourceRanges": {
    "actual": {"from": "2026-11-01", "to": "2026-11-10", "partialToday": true},
    "runrate": {"from": "2026-11-03", "to": "2026-11-09"}
  },
  "budgets": [{
    "id": "customers/123456/campaignBudgets/10",
    "name": "Shared 10",
    "scope": "shared_budget",
    "currency": "USD",
    "timeZone": "America/New_York",
    "coverage": "partial",
    "status": "partial_coverage",
    "members": [
      {"id": "1", "name": "First member", "status": "ENABLED"},
      {"id": "2", "name": "Paused member", "status": "PAUSED"}
    ],
    "spent": 80,
    "completedSpend": 70,
    "dailyBudget": 100,
    "monthlyReference": 3000,
    "projectedSpend": null,
    "forecastAllowed": false,
    "forecastQuality": {"observedDays": 3, "minDaysRequired": 3}
  }]
}
```

Render expectation: one budget section, both member names, USD currency formatting, account timezone, actual and run-rate ranges, partial-today label, no cap/balance claim, and an em dash plus historical-coverage reason for forecast. To exercise ready/insufficient states, use the fixture variations in the UI test. The card consumes `budgets`; browser fixtures do not need compatibility aliases.

## Verification boundaries

Focused Vitest route tests mock the actual GET handler's provider customer, not a replacement route. Clock is frozen. Calculator tests cover first/last day, leap year, DST and UTC+14; route tests cover provider metadata, grouping, spend validation, missing dates, authorization and sanitized failure. UI tests statically render the real component in both locales; they are not browser interaction/E2E evidence.

No live provider/network calls, services, dependencies, migration, deployment or git stage/commit/push. No full TypeScript check/build (reserved for main). Existing generic forecast quality tests are included to check its contract remains unchanged.
