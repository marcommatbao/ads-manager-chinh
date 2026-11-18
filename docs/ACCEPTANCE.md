# Gate 3 Acceptance — AI Analyst chủ động

| ID | Criterion | Evidence | Status |
|---|---|---|---|
| G3-01 | Briefing records source, range, read time | `BriefingEvidence` contract + focused tests | PASS |
| G3-02 | Critical unavailable source blocks Gemini | `generateAiSummaryWithQualityGate` call-count test | PASS |
| G3-03 | Fallback is explicitly identified | `generationMode` + UI badge + quality tests | PASS |
| G3-04 | Anomaly uses a declared comparison window | Meta evidence contains date ranges | PASS |
| G3-05 | Blocked source produces no AI analysis | Quality gate call-count test; live provider call not performed | PASS (contract) |
| G3-06 | History persists and deduplicates | `morning-briefing-history.test.ts` | PASS |
| G3-07 | History endpoint requires auth | `morning-briefing-history-route.test.ts` | PASS |
| G3-08 | Normalized history avoids raw provider payloads | Store contract + architecture review | PASS |
| G3-09 | Dashboard shows quality mode and evidence | `BriefingEvidencePanel` + dashboard card | PASS |
| G3-10 | Loading/error/blocked/empty states are represented | Existing card + blocked mode UI | PARTIAL (authenticated browser pending) |

## Phase 6 evidence

- Evidence-backed profit contract: PASS in `profit-quality.test.ts`.
- Missing COGS blocks profit/margin/break-even conclusions: PASS.
- Mismatched component date ranges block calculation: PASS.
- BA formula confirmation, real COGS/refund integration, and runtime acceptance: PENDING.


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


Gate 3 implementation is **in progress**, not fully closed. Contract-level tests now cover the AI call guard and history auth. The remaining item is authenticated UI/API acceptance on configured staging/beta; do not claim production readiness until that environment evidence exists.
