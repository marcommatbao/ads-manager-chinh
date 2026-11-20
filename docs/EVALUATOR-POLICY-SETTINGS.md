# Evaluator policy settings — implementation evidence

## Scope

The new evaluator policy panel is embedded in `/settings/automation`, separate from legacy auto-apply controls. Policy management is global and restricted to `super_admin` on both GET and POST `/api/automation/policy`.

## Implemented behavior

- Strict numeric/type validation, coverage bounds, budget floor/ceiling checks, integer limits, approved-owner requirement.
- Dry-run reads policy from server and ignores client-supplied policy/limit overrides.
- Save always creates a draft with global automation and provider apply OFF.
- Actor identity comes from the authenticated session, not the payload.
- Revision conflicts return HTTP 409 instead of overwriting a newer policy.
- Audit intent is written before policy changes; corrupt/unwritable audit prevents saving.
- UI includes loading, permission denied, load/save error, conflict, saved confirmation, and reload controls.
- Form bounds mirror server validation; wording is in Vietnamese/English i18n and remains subject to BA review.

## Verification

- TypeScript: PASS.
- Regression tổng hợp hiện tại (excluding live fixtures): 30 test files / 126 tests PASS.
- Lint all 35 changed/new source files: PASS after fixing settings company-state mirroring and effect-time load setters. Company-specific settings are remounted with a company key; obsolete fetches are aborted and ignored.
- Latest production build after the settings effect fix: PASS (exit 0).
- `git diff --check`: PASS.
- Browser fixture verification: PASS using actual settings page/policy component, built app CSS, and mocked i18n/store/company boundary and HTTP APIs. Desktop 1440px and mobile 375px screenshots visually reviewed; no horizontal overflow at 375px. Checked numeric validation, keyboard Tab, draft-save payload, revision conflict disabling/reload, load/save errors, permission denial, local/global company switching, and zero page errors. All API requests intercepted; no real provider/network writes. Temporary loopback fixture server stopped after tests.
- Fixture artifacts: `/tmp/ads-policy-browser-fixture/{desktop.png,mobile.png,results.json}` (temporary, not committed). This is not authenticated staging/backend acceptance, full Next routing/hydration verification, automated accessibility audit or screen-reader coverage. Initial loading state existed but was not separately captured/ asserted.

## Limits / not enabled

- No approval/activation control for the new policy is exposed by this settings form.
- No provider budgets were changed; legacy auto-apply behavior was not modified.
- File locking is process-local, not distributed. Multi-process/replica deployment requires transactional shared storage before concurrent policy administration is supported.
- Audit records are `draft_save_requested` intent entries, not proof a policy file write succeeded. A failed subsequent write may leave intent without an applied revision.
- Minimum observation days and daily mutation caps remain policy configuration; this change does not claim full enforcement in a live provider apply flow.
