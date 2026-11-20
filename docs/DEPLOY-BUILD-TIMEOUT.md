# Vibe Host build timeout investigation

Deployment version 19, source 3f62bd6, failed with `build vượt quá 12 phút`. Host logs do not expose the exact npm/Next substep, so the root cause is not confirmed. The built-in diagnose tool is unavailable with HTTP 410.

A concrete local build warning reported project-wide tracing from the admin data-import route. A tracing ignore marker is added to its validated runtime-data path, and Next worker count is limited to 2 for constrained builders. Runtime import validation/auth and the persistent /app/data volume remain unchanged.

Regression after the two-file change: 30 source test files, 126 tests pass; TypeScript and scoped lint pass. Local build and hosted redeploy must still be verified. Do not infer a successful hosted deployment from old version logs or the login page.

## Follow-up evidence: source 96d55d8 / history version 23

- Hosted history version 23 (source 7b925b0) timed out at 12 minutes. Diagnose AI returns HTTP 410; host stage logs expose no detailed compiler/npm timings.
- Local legacy Docker build context: 13.31 MB. `npm ci` completed in 30 seconds; Next compiled successfully in 67 seconds. The bounded 720-second Docker build client timed out after log `Running TypeScript ...`. This locates the local stall but does not prove the same host root cause.
- Native source Next build and all 133 source tests previously passed; browser snapshot fixture passed.
- TypeScript input census: 3302 inputs; zero under `.next/standalone` or `.claude`, zero JavaScript inputs. Do not disable typechecking or change tsconfig on a pollution hypothesis unsupported by this evidence.
- Isolated diagnostic container requested network none, 1 GB RAM, 1 CPU and PID limit, but failed before execution: OCI cgroupv2 `/sys/fs/cgroup/docker` threaded-mode configuration error. No memory/runtime measurement was obtained. Resource limits were not removed to bypass that failure.

### Ops request

For Vibe Host project cmw8vkt4k0xwf0i5fem40rhaa, provide Docker/Next per-step build output for job cmwosra3i2fx00i5f6jg778re (version 23), build cgroup memory limit and peak/OOM events, and the PID/substep active at timeout. Confirm whether the build has memory separate from the app runtime 1024 MB allocation. Do not send env values or credentials.

For the workspace Docker daemon, repair support for CPU/memory/PID cgroup limits before rerunning isolated resource diagnostics. Keep /app/data volume and the running website unchanged. No retry deployment, resource increase or typecheck bypass is proposed without those facts.

## Cold typecheck investigation

A native non-incremental TypeScript run passed in 74.96 seconds, with 3,302 files, 1,147,251 declaration lines, 1,690,010 KB compiler memory and 1,883,084 KB child peak RSS. This is material memory pressure but does not establish the hosted build memory limit or OOM cause.

Next 16.4.6 already defaults to `experimental.useTypeScriptCli=true`; setting it again is not a fix. An experiment is running `next typegen`, the complete TypeScript project with Next's cache filename, then `next build` sequentially. Both typecheck stages remain enabled; no source/type exclusion or ignoreBuildErrors is introduced. No production configuration changes have been made based on this experiment yet.

Sequential native experiment completed successfully: route typegen 0.92s, pre-typecheck 10.10s, Next build 132.53s (compile 68s; internal TypeScript 12.2s). This run reused caches and therefore does not prove cold-build improvement. A temporary Dockerfile outside the repository is now testing the same sequence with a newly executed RUN layer, bounded at 720 seconds; the release Dockerfile remains unchanged.

## Accepted local Docker experiment

Temporary sequential Dockerfile completed all 75 stages with exit 0, including runner image `0660f1713b37` (`ads-manager-buildcheck:pretype`). No app stack was started. The 720-second limit did not expire. The source Dockerfile now uses the tested sequence: route typegen → full tsc using `.next/cache/.tsbuildinfo` → normal `npm run build`. Next's type validation remains enabled. This is a local success; hosted timing/root cause still requires verification on redeploy.
