# AdsCommand — shared Coolify deployment

## Canonical target

Confirmed by the workspace user on 2026-11-27:

- Existing Coolify application: `s4ys4p3oy0byc8x99k68hsgk` (`ads-manager`).
- URL: https://ads-manager.mk.dev.matbao.ai
- Approved source: https://github.com/marcommatbao/ads-manager-chinh, branch `main`.
- The old GitLab source has a different history. Never force-push the local/GitHub history onto it.
- Persistent data: existing volume `s4ys4p3oy0byc8x99k68hsgk-ads-manager-data`, mounted at `/app/data`. Keep this volume and existing environment configuration during updates.
- Do not create a second beta, change access restrictions, or replace encryption/auth keys to deploy this update.

## Build and verification

```bash
NODE_OPTIONS=--max-old-space-size=3072 npm run build
npx vitest run tests/budget-pacing-navigation.test.ts tests/budget-pacing.test.ts tests/budget-pacing-route.test.ts tests/budget-pacing-ui.test.tsx tests/forecast-quality.test.ts --maxWorkers=1
```

The 1,536 MB heap trial compiled successfully but ran out of heap during TypeScript validation. Keep type validation enabled. A successful local build does not prove a successful hosted deployment.

Browser acceptance must use the completed production artifact, a separate runtime working directory and TEST-only data/auth keys. Do not copy or link the real `data/` into a browser fixture runtime. Stop the temporary server after the run; watchdog must be no longer than four hours. Provider fixtures are not evidence of live Google Ads connectivity.

## Operate the existing application

Use the existing application's controls in https://ops.matbao.ai. Start/redeploy the same app; do not run a new Compose stack in this workspace.

Authenticated API equivalents (the credential stays in the secret file):

```bash
# Start the existing application again after a stop.
curl --fail-with-body -X POST \
  -H "Authorization: Bearer $(tr -d '\n' < /run/secrets/deploy/coolify-token)" \
  https://ops.matbao.ai/api/v1/applications/s4ys4p3oy0byc8x99k68hsgk/start

# Redeploy only after the intended release has been pushed to the approved source.
curl --fail-with-body -X POST \
  -H "Authorization: Bearer $(tr -d '\n' < /run/secrets/deploy/coolify-token)" \
  'https://ops.matbao.ai/api/v1/deploy?uuid=s4ys4p3oy0byc8x99k68hsgk&force=false'
```

A returned deployment UUID means queued, not successful. Verify the deployment's terminal status, exact commit, runtime Ready/health and persistent mount before reporting completion. If a start command is queued, verify its completion too. Do not delete volumes, reset data or relax access restrictions to recover startup.

Stop/log controls are available on the same Coolify application. Existing TTL/operational labels must be inspected rather than assumed; this release does not grant a new continuous-runtime exemption.

## Rollback

Keep the previous release identifier and source configuration privately before changing source. If the new deployment fails, preserve the volume/environment and inspect bounded sanitized logs. Restoring the previous source settings alone does not restore service: the old app was already stopped/unhealthy before this release attempt. Do not claim a working rollback without runtime evidence.
