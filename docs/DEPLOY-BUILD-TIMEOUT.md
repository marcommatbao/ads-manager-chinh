# Vibe Host build timeout investigation

Deployment version 19, source 3f62bd6, failed with `build vượt quá 12 phút`. Host logs do not expose the exact npm/Next substep, so the root cause is not confirmed. The built-in diagnose tool is unavailable with HTTP 410.

A concrete local build warning reported project-wide tracing from the admin data-import route. A tracing ignore marker is added to its validated runtime-data path, and Next worker count is limited to 2 for constrained builders. Runtime import validation/auth and the persistent /app/data volume remain unchanged.

Regression after the two-file change: 30 source test files, 126 tests pass; TypeScript and scoped lint pass. Local build and hosted redeploy must still be verified. Do not infer a successful hosted deployment from old version logs or the login page.
