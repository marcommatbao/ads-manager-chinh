# Stabilization Inputs Required

## Runtime acceptance (staging only)

- A staging URL reachable from the workspace, or a local route with DNS resolved.
- A non-production test session for an authorized user with MBC/MBI scope.
- Sandbox/test credentials for Meta, Google Ads, Gemini, and Odoo; do not place secrets in git.
- Isolated staging event data covering:
  - Gate 3: AI success, fallback, blocked source, evidence/history.
  - Gate 4: account balance, campaign budget, internal KPI.
  - Gate 5: matched click/UTM/campaign-label order, unmatched order, duplicate order, ambiguous evidence.

## Phase 6 BA approval

The BA must approve the formula version `phase6-v1` or provide corrections for:

- gross revenue definition;
- refund/return definition and period attribution;
- COGS source and allocation level;
- net revenue formula;
- gross margin formula;
- break-even ROAS inclusions/exclusions.

Until approved, the API/UI must keep `requiresBaApproval=true` and `quality.allowed=false` when COGS/refund sources are absent.

## Dependency remediation plan

Before public beta/go-live, review and test these upgrade groups separately:

1. Node type/toolchain compatibility, then Vitest 5/tinypool.
2. `google-ads-api` 26 and its protobuf/stream-json chain.
3. `proxy-addr`/Express-related transitive chain.
4. `shadcn`/Vite tooling chain.

Each group requires npm audit, TypeScript, source tests, lint, and production build. Do not use `npm audit fix --force` or `--legacy-peer-deps` as a substitute for compatibility testing.
