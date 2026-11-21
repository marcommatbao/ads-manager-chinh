# Beta runtime and adapter verification — required evidence

## Current boundary

Canonical URL recorded in existing acceptance configuration: `https://adscommand-chinh.vibe.tinhgon.xyz`. Authenticated HTTP/browser availability has been verified separately. It does not establish staging isolation, deployment commit, runtime version or durable storage.

This workspace has no configured Vibe Host management MCP/SSH connection for that app. No app container matching AdsCommand was found on the local Docker daemon. Do not infer remote volume configuration from the repository Compose file.

## Read-only runtime probe

Run inside the existing canonical app container, not in an unrelated workspace:

```sh
node scripts/check-execution-runtime.mjs /app/data
```

The script prints Node and in-memory SQLite versions, whether the data directory exists and the containing mount filesystem. It does not read application DB contents or credentials and does not write any file. A mount is not proof of persistence.

The host owner must provide bounded metadata: app/deployment ID and source commit, replica count, Node image digest/version, `/app/data` volume destination and local/shared filesystem classification, owner and backup/restore arrangement. Do not provide environment dumps or secrets.

Verify persistence with a controlled staging fixture/redeploy drill only after confirming this exact storage is isolated staging. Do not change data paths on an existing populated app without an inventory and recovery plan. Current remote persistence remains unverified.

## Adapter test scope required before any provider write

A campaign must be explicitly confirmed as a test target. Required scope: company, provider, account, campaign ID, test-account status, currency/budget unit, campaign vs shared/adset budget semantics, allowed before/after range, absolute delta caps and test window. Never assume a campaign with low spend or ACTIVE status is a sandbox.

Then verify: read-before-write, policy/source/approval recheck, atomic claim/reservation, one bounded write, read-back, timeout/uncertain reconciliation without blind retry, and undo only while current value still matches applied value. Preserve shared budget scope; no campaign-only mutation for a shared budget.

No confirmed campaign scope was found in the current request/configuration. No adapter write or undo has been performed. Coordinator remains disconnected from live apply.
