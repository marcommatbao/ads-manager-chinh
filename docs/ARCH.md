# Architecture — AI Analyst Briefing

## Flow

```text
Dashboard MorningBriefingCard
        |
        v
GET/POST /api/automation/morning-briefing
        |
        v
lib/morning-briefing.ts
  |-- Meta account insights / campaign insights
  |-- normalize metrics and detect anomalies
  |-- create BriefingEvidence
  |-- critical source quality gate
  |-- Gemini analysis OR explicit fallback/blocked summary
        |
        +--> lib/morning-briefing-history.ts
              atomic JSON write + file lock

GET /api/automation/morning-briefing/history
        |
        v
recent normalized briefing snapshots
```

## Components

- `MorningBriefing`: normalized daily result containing metrics, alerts, anomalies, forecast display data, evidence, and `generationMode`.
- `BriefingEvidence`: source, date range, read time, status, criticality, and sanitized note.
- `MorningBriefingCard`: dashboard presentation of summary, quality mode, data gaps, and expandable evidence.
- `morning-briefing-history`: bounded single-instance file store. Writes use atomic replacement and a per-file lock.

## Quality gate

Meta fetches record evidence. A critical unavailable Meta evidence item causes `shouldBlockAiAnalysis` to return true. The generator returns a blocked explanatory summary and does not call Gemini. A Gemini timeout/error produces an explicitly labelled fallback. Complete source data with a configured Gemini key produces `generationMode: gemini`.

## Auth and boundaries

Both briefing and history routes require `getCurrentUser()`. Provider tokens remain server-side. The history store receives only normalized briefing objects; it must not receive raw provider responses or prompts.

## Persistence and operations

History is stored at `data/morning-briefing-history.json`, capped at 90 entries. This is suitable for the current single-instance file-backed deployment. A multi-instance deployment must migrate this store to shared persistence before relying on cross-instance history. Rollback stops new writes without deleting the existing file.

## Failure paths

- Connector unavailable: data gap + unavailable evidence + blocked AI.
- Gemini unavailable: fallback summary + fallback evidence.
- History write failure: briefing response remains available; server logs the persistence error.
- Unauthorized API request: HTTP 401.
