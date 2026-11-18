# Product Requirements — AdsCommand

**Status:** Draft — implementation evidence is recorded; product approval remains an explicit Gate decision.

## 1. Problem
Marketing operators need a daily view of campaign performance that distinguishes real zeroes from unavailable data and does not turn incomplete connector data into confident AI advice.

## 2. Users
- Marketing operators: inspect campaign health and take daily action.
- Team leads: review anomalies, recommendations, and source quality.
- Administrators: configure connectors and investigate source failures.

## 3. Goals
- Produce a daily briefing with anomaly signals and actionable recommendations.
- Attach source, date range, and read time to briefing evidence.
- Block AI analysis when a critical source is unavailable.
- Preserve recent briefings for audit and comparison.

## 4. Non-goals
- Automatic budget changes or campaign mutation.
- Forecasting and budget pacing beyond the existing display fields.
- Replacing connector health monitoring.

## 5. User journeys
1. Operator opens the dashboard during the briefing window.
2. System loads or generates the briefing.
3. Operator sees AI, fallback, or blocked status.
4. Operator expands evidence to inspect source and date range.
5. Operator uses the history API/UI to review previous snapshots.

## 6. Business rules
- Unavailable critical source data is never represented as a meaningful zero.
- Gemini is not called when a critical Meta source is unavailable.
- Fallback output must identify itself as fallback.
- Recommendations must remain within the observed source and date range.
- History is bounded and contains normalized briefing data, not raw connector payloads.

## 7. Functional requirements
- Authenticated briefing GET and POST endpoints.
- Briefing evidence with source, range, read time, status, and criticality.
- Persisted briefing history with bounded retention and deduplication.
- Dashboard states for loading, success, fallback, blocked, and error.
- History endpoint protected by authentication.

## 8. Data and evidence requirements
Every source used by the briefing records `source`, `from`, `to`, `readAt`, and `status`. Critical unavailable evidence blocks AI analysis. History stores normalized results only.

## 9. Security and privacy
Require an authenticated session. Do not store API tokens, prompts, raw provider responses, or unsanitized secrets in history or UI. Connector errors must be sanitized before presentation.

## 10. Acceptance criteria
See [ACCEPTANCE.md](ACCEPTANCE.md). Gate 3 is complete only when the required tests pass and the evidence contract is visible in the UI/API.
