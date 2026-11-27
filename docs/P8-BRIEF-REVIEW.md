# P8 — Creative brief versioned review (narrow slice)

Implemented in the existing creative brief store, routes and brief page/builder. Scope is internal human content review only. This does not publish, launch, approve an ad on a platform, integrate experiments, change Business Profiles or open P7. vi/en wording is proposed for BA review.

## Audit and behavior

Previously saveDraft replaced a draft in place, truncated the collection to 50, and interpreted missing/invalid JSON as an empty store. POST allowed read-only roles; detail routes used a different company check from the list. The history drawer silently removed deleted rows even if DELETE failed, and generation immediately unmounted the builder.

Now company access uses canAccessCompany everywhere; mutations also require can_edit. Existing-ID generation checks stored company and revision before builder/playbook boundaries. Viewer may list/get only accessible companies, including history, and cannot generate/edit/review/delete. Reviewer identity is always session user.id; client actor/review/output fields cannot authorize a review.

Each changed save appends a content snapshot with a monotonic revision and SHA-256 reference over JSON {name,input,output}. Current content duplicates the last snapshot and is checked on read. The hash is a persisted content reference, not a signature or protection from filesystem administrators. Source values embedded in output remain snapshots; referenced playbook entry IDs are not independent versioned source documents. No Business Profile revision contract or migration is added.

A review is an acknowledgement attached once to the exact current revision/hash, recording server actor and time. It does not increment the content revision. Retry preserves the first review actor/time. New content has no current review; old reviewed snapshots stay intact. Same-content saves are no-ops. Legacy drafts project to revision 0, unreviewed, without writing a migration; their original snapshot is retained on subsequent edits/review. Historical content has no mutation endpoint. DELETE returns 409 for editors to retain history; the drawer no longer offers deletion.

## Storage and concurrency limits

A genuinely missing data/creative-brief-drafts.json (ENOENT) retains first-install compatibility: reads return no drafts and the first authorized save initializes it. Malformed, inconsistent, unreadable or oversized EXISTING stores return503 and are never replaced with an empty collection. Main added first-install regression; no real data file or migration was created. A missing mount cannot be distinguished from a new installation by file code alone: host persistence acceptance remains mandatory.

Limits: 50 drafts across all companies, 100 snapshots per draft (including legacy snapshot), 5,000,000 UTF-8 bytes for the serialized store. Capacity returns 409 without eviction; reviewed history is preserved. Review writes also obey byte capacity. There is no archival/retention UI. Writes use the existing same-directory temp-file + rename helper. Failed rename leaves the old file intact; the helper may leave a temp file. No fsync durability guarantee is added.

expectedRevision check and write run under the existing withFileLock keyed by store path. This serializes only callers in ONE Node process. It is not a distributed or filesystem lock: multiple workers/replicas need a transactional store or cross-process lock before rollout. A concurrent edit loses with 409; a concurrent review and edit can both succeed because review does not change content revision, and the edit preserves that review in history. No runtime/deployment concurrency was verified.

## API fixtures

All examples use authenticated sessions and synthetic values. IDs and references come from responses.

- POST /api/creative/brief retains {input,name?,draftId?,expectedRevision?}. New draft omits draftId/revision; overwrite requires both existing ID and exact revision. Returns {success:true,data:{brief,draft}}. This existing generation path may touch providers indirectly; tests mock builder and playbook boundaries, never call real providers.
- GET /api/creative/brief?limit=20 returns {success:true,data:{drafts,total}} scoped to user, total is returned count. GET /api/creative/brief/:id returns {success:true,data:{draft,canEdit}}.
- PATCH /api/creative/brief/:id review body: {action:"review",company:"MBC",expectedRevision:1,contentHash:"<response hash>"}. actorId is ignored; server derives it.
- PATCH edit body: {action:"edit",company:"MBC",expectedRevision:1,usp:"Updated USP",valueProposition:"Updated value"}. Only these two content fields are editable manually (nonempty, max 4000 characters each); stored input and other output fields remain unchanged. Returns {success:true,data:{draft}}. These PATCH paths never call a generator.
- Errors use {success:false,error?:string}: 401 unauthenticated, 403 company/role denial, 400 invalid action/input, 404 missing ID, 409 revision/reference/capacity/deletion conflict, 503 unavailable store/write failure. Existing generation compliance failures retain 422 behavior.

A draft fixture contains id/name/input/output?/createdAt/updatedAt plus revision/contentHash/history and optional review. Each history entry contains revision/contentHash/name/input/output?/savedAt and optional review {revision,contentHash,actorId,reviewedAt}. Use complete synthetic CreativeBrief output, as in tests/creative-brief-review.test.ts; stores validate input/output structure and history references.

## UI and verification

BriefBuilder and the existing brief page retain the returned draft reference. History selection opens its review panel. The panel shows current review state/reference, reviewer/time, two manual fields and retained revision previews. Unsaved edits disable review. Explicit review opens the existing accessible Dialog with revision/hash, checklist language and an unchecked acknowledgement; confirmation stays disabled until checked. Viewer has no mutation controls. No integration into the existing separate Generate Ad Copy action was added.

Browser fixture: mount BriefReviewPanel under I18nProvider locale="vi" or "en", passing {draft:<complete API draft>,canEdit:true|false,onChange:<state setter>}; key the component by id:revision as production does. Or mock authenticated brief POST and history GET responses on /creative/brief, then mock PATCH 200/409/503. Confirm unchecked/disabled review, cancel/focus behavior, save → new unreviewed revision, review → actor/time, old reviewed history, stale conflict/reload and viewer controls. Use SessionProvider with the matching admin_mbc/viewer_mbc fixture for the whole page. Do not invoke the separate Generate Ad Copy action or real audience/provider requests in fixtures.

Focused verification: tests/creative-brief-review.test.ts exercises actual routes/store using temporary files with builder/playbook mocked; tests/creative-brief-review-ui.test.tsx renders the real panel in vi/en and checks viewer read-only/review labels. UI tests are SSR only, not browser/hydration/click acceptance. No claim of full P8 acceptance, live source proof, Business Profile versioning, experiments, staging or deployment. No full TypeScript/build, network/provider, environment-secret reads, services, dependencies or git operations were run.
