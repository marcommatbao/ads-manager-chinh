# Project Context — AdsCommand

AdsCommand is a Next.js 16 + React 19 + TypeScript dashboard for Meta Ads and Google Ads operations, with company separation for MBC/MBI and server-side connector integrations.

## Current scope

The current implementation work is Gate 3 completion for the AI Analyst briefing: source quality checks, anomaly context, explainable evidence, safe fallback/blocked states, and bounded briefing history. Giai đoạn 4 forecast/budget pacing and automatic campaign mutation are out of scope.

## Conventions

- Keep provider credentials server-side and read configuration from environment variables.
- Never represent unavailable source data as a meaningful zero.
- Add source, date range, and read time when introducing analytical conclusions.
- Use normalized data in persisted history; never store raw provider payloads, prompts, or secrets.
- Use atomic file writes and file locks for file-backed stores.
- Run TypeScript and focused Vitest tests before reporting completion.
- Read user identity from workspace environment when needed; do not hardcode identity.

## Project guidance

See [AGENTS.md](AGENTS.md), [docs/ROADMAP.md](docs/ROADMAP.md), [docs/ARCH.md](docs/ARCH.md), and [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).
