# Gate 3 Acceptance — AI Analyst chủ động

| ID | Criterion | Evidence | Status |
|---|---|---|---|
| G3-01 | Briefing records source, range, read time | `BriefingEvidence` contract + focused tests | PASS |
| G3-02 | Critical unavailable source blocks Gemini | `shouldBlockAiAnalysis` test; route integration remains required | PARTIAL |
| G3-03 | Fallback is explicitly identified | `generationMode` + UI badge + quality tests | PASS |
| G3-04 | Anomaly uses a declared comparison window | Meta evidence contains date ranges | PASS |
| G3-05 | Blocked source produces no AI analysis | Generator gate code; provider-call integration test remains required | PARTIAL |
| G3-06 | History persists and deduplicates | `morning-briefing-history.test.ts` | PASS |
| G3-07 | History endpoint requires auth | Route code review; route test remains required | PARTIAL |
| G3-08 | Normalized history avoids raw provider payloads | Store contract + architecture review | PASS |
| G3-09 | Dashboard shows quality mode and evidence | `BriefingEvidencePanel` + dashboard card | PASS |
| G3-10 | Loading/error/blocked/empty states are represented | Existing card + blocked mode UI | PARTIAL |

## Gate decision

Gate 3 implementation is **in progress**, not fully closed. The remaining mandatory work is route-level integration testing (including asserting Gemini call count), and an authenticated UI/API acceptance run on the configured staging/beta environment. Do not claim production readiness or start Giai đoạn 4 until those checks pass.
