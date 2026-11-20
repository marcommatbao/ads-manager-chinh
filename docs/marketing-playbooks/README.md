# Marketing Capability Layer

**Source reviewed:** `coreyhaines31/marketingskills` (MIT License, Copyright (c) 2025 Corey Haines). This project adapts capability concepts rather than copying the upstream skill files. The upstream MIT notice is retained in `docs/marketing-playbooks/THIRD-PARTY-NOTICE.md`.

## Integration boundary

Marketing playbooks provide checklists, required evidence, and explanation templates. They do not call provider mutation APIs and do not choose budgets. Deterministic AdsCommand rules remain the only decision path for campaign/budget actions.

## Priority matrix

| Capability | Upstream skill | AdsCommand integration | Priority |
|---|---|---|---|
| Product/business context | `product-marketing` | Business Policy/Profile: products, USP, audience, prohibited claims, targets | P0 |
| Campaign planning | `ads` | Campaign diagnosis/checklist using Meta/Google source snapshots | P0 |
| Analytics quality | `analytics` | Connector/source freshness, metric definition, zero vs unavailable | P0 |
| Conversion tracking | `conversion-tracking` | UTM, gclid/gbraid/wbraid, pixel, GA4, tracking health | P0 |
| Attribution | `attribution` | Existing evidence-bounded campaign→order report | P0 |
| Creative review | `ad-creative` | Creative identity, hook/angle/limits/fatigue checklist | P1 |
| Experiment review | `ab-testing` | Before/after/A-B guardrails; no causal claim without design | P1 |
| Scheduled loops | `marketing-loops` | Cron monitoring/reporting only; no silent provider writes | P1 |
| Landing/CRO | `cro`, `copy-editing`, `copywriting` | Landing/copy recommendations after tracking is healthy | P2 |
| SEO/content | `seo-audit`, `schema`, `content-strategy` | Separate product surface; not budget decision path | P2 |

## Implementation stages

### M0 — Playbook foundation

- Version each playbook and record source/attribution.
- Add Business Policy/Profile schema and review status.
- Map each playbook to existing source contracts and UI evidence.
- Add tests that playbooks cannot mutate provider state.

### M1 — Tracking and analytics health

- Implement conversion-tracking checklist against current UTM/GA4/Meta/Google routes.
- Show source, range, readAt, status and missing fields.
- Block attribution/profit automation when tracking coverage is below policy.

### M2 — Ads/creative/experiment review

- Add deterministic campaign and creative checklists.
- Require creative identity/version and comparable windows.
- Keep recommendations separate from apply/approval.

### M3 — Marketing loops

- Schedule health/report loops through existing job registry.
- Deduplicate notifications and expose delivery/audit state.
- Do not silently enable mutation jobs.

### M4 — CRO/SEO/content extensions

- Add only after M0–M3 and runtime Gate 3–6 acceptance.
- Keep SEO/content recommendations separate from ad budget decisions.

## Acceptance

- Third-party notice is present.
- Every playbook has source/version/scope and no secrets.
- A playbook cannot directly invoke Meta/Google mutation clients.
- Missing tracking data produces blocked/insufficient states.
- Existing Gate 3–6 evidence contracts remain authoritative.
- Copy/creative outputs require human review before publication.
