# Website operations and QA rollout

## What was checked locally

The automated suite covers complete lists past 1,000 reports, tied pagination boundaries, snapshot reuse after edits/deletion, tampering and expiry, Pastebin validation, duplicate graph constraints, editable release-link input, private saved queues/onboarding, and HTTP role/CSRF boundaries. Attachment checks use signed URLs against an in-memory object transport and compare downloaded bytes. Backup tests serialize and restore nested documents, timestamp precision, relationships, and binary objects, then verify hashes.

These checks do not prove live Discord OAuth, deployed Firestore indexes, real R2 permissions/CORS, or restoration into another cloud project. No separate test website/database was available during implementation, so no live restore or real-account upload experiment was performed.

## Release gate

Run `npm run db:indexes -- --apply` to request the checked-in indexes, then `npm run db:indexes -- --require-ready`. The latter exits nonzero if an index is missing or still building. `npm run check:release` runs unit/HTTP tests, the production build, and this index gate. Add that command immediately before the hosting platform’s deploy step; this repository does not contain a hosting deployment pipeline to edit.

Required new field indexes: `websiteAccounts.verifiedRole` ascending, and `updates.linkedReportIds` array contains. Startup’s existing dictionary seeding adds the `needs_info` status if missing. Existing report data needs no migration; new fields default to empty and existing descriptions/credit remain intact.

Deploy frontend and backend together. Verify as QA, Member and Developer; check the new admin route, a saved filter link, console-link validation, a duplicate relationship, an unpublished versus published release link, and onboarding progress after reload. Do not use real sensitive information in public reports.

## Repeatable browser checks

`npm run test:staging` runs the checked-in Playwright suite for Member, QA and Developer using authenticated browser states. It deliberately refuses `towereclipse.com` and has no default target. A separate test site must have its own database and storage bucket.

1. Set `STAGING_BASE_URL` to that site’s origin.
2. Sign in normally with three dedicated test accounts and save Playwright storage states to `.runtime/browser-auth/member.json`, `qa.json`, and `dev.json`. These files contain session cookies: `.runtime` is ignored, and they must never be committed or shared. The test verifies the actual signed-in role, so expired or wrong-role states fail clearly.
3. Set `STAGING_ALLOW_WRITES=yes` only for that disposable site. The upload check creates one clearly labelled report and leaves it for inspection. There is no delete/cleanup against live data.
4. Install the test browser on the test runner with `npx playwright install chromium`, or select an installed Chrome with `PLAYWRIGHT_CHANNEL=chrome`. Run `npm run test:staging`.

The suite checks actual protected endpoints as well as role-visible browser UI, stable filtered exports, and the normal attachment begin/upload/complete/finalize/download flow. It does not bypass Discord login or inject a production authentication shortcut. Trace/video capture is disabled so session data is not casually retained. The authentication approach follows [Playwright’s authenticated-state guidance](https://playwright.dev/docs/auth).

For visual development without cloud services, run `node scripts/preview-workspace.mjs` and open `http://127.0.0.1:5174/__test/login/qa` (or `member`, `dev`, `leadqa`). This separate entrypoint binds only loopback, uses throwaway sessions/storage and 1,205 synthetic reports, and never imports the production database. It exercises the real query, workspace and role-guard services, but its content/upload endpoints are partial fixtures and do not replace the staging suite.

## Backup and restore rehearsal

Backups are private operational artifacts, distinct from public report exports. Keep them outside Git in restricted storage; `backups/` and `*.backup.json` are ignored. They contain private applications, staff notes, account data and private resource metadata where stored in Firestore. They do not include server secrets, OAuth sessions, database indexes/rules or unreferenced R2 objects.

- `npm run backup:create -- /safe/path/workspace.backup.json` recursively captures Firestore documents/subcollections at one read time and downloads referenced non-pending R2 objects. It preserves Firestore value types, includes object bytes and hashes, and refuses to overwrite an existing file. A missing referenced object fails the backup instead of claiming completeness. Pending uploads are retained as records but have no guaranteed binary data; complete or cancel them before a planned backup.
- `npm run backup:verify -- /safe/path/workspace.backup.json` verifies manifest/document/object integrity without modifying data.
- To rehearse restoration, configure credentials for a **different, disposable Firestore project and R2 bucket**, set `RESTORE_DISPOSABLE_TARGET` to the exact `project-id/bucket-name`, then run `npm run backup:restore-disposable -- /safe/path/workspace.backup.json`.

The restore rejects the source project/bucket and populated destination documents or conflicting object keys, validates the whole bundle before writing, uses create-only document writes and conditional object uploads, and verifies restored content. Cross-project Firestore document references are remapped to the destination. It never deletes data. If restoration fails partway, retain the diagnostic result and retry into another empty disposable target; there is no destructive rollback or overwrite mode. Bucket names are checked conservatively even when accounts differ.

Firestore’s read-time reads are limited to the recent retention window; this tool uses a timestamp within the last hour. Very large backups or frequent bulk searches should move to managed Firestore backup/export and streaming object inventory instead of a single in-memory JSON artifact. The read-time behavior follows [Firestore’s REST query documentation](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/runQuery). Cloud restore has not been rehearsed because a disposable cloud target is not available yet.

## Scaling review: remain on one API instance for now

- Sessions are held in an in-process Map and persisted to a locally encrypted file. Multiple replicas will not share login state, revocation, OAuth transactions or refresh-token updates. Sticky routing alone does not solve restart/failover consistency. Before scaling, move sessions/OAuth transactions to a shared TTL-backed store with atomic refresh/revocation and a common signing key; test login, refresh, logout and expiry across replicas.
- Dictionary disk caches update only on the writer’s instance. News, tournament and account summary caches are per-process. Add shared invalidation or bounded freshness for those stores before relying on multiple replicas.
- Bug snapshots are portable across replicas sharing the signing key: the token pins a Firestore read time, and the optional small memory cache is only acceleration. Eviction or process restart does not change the underlying snapshot. Rate limits remain per-process and need a shared store or edge enforcement when scaling.
- Complete substring search currently scans database pages on a cold snapshot. Measure read volume and latency as the dataset grows; use an indexed search service before this becomes a high-traffic workload. Never reintroduce a silent result cap.
- Use persistent storage for the current single-instance session file, control deployment concurrency, and review hosting replica settings. No live hosting settings were changed here.
- No new game analytics were added. If introduced later, start with build-level aggregate errors, completion rates and performance; define access, retention and collection scope before collecting player-level detail.

## Verification on 23 September 2026

- Production build and 97 automated tests passed. Disposable local browser checks covered QA onboarding persistence, saved queues, related suggestions, an older report among 1,205 submissions, the admin overview/editor, and member access restrictions.
- The read-only live index check found `websiteAccounts.verifiedRole` and `updates.linkedReportIds` overrides missing. Applying additions failed with HTTP 403 because the configured service account cannot manage indexes. No index addition succeeded. Run `npm run db:indexes -- --apply` using an identity authorized to manage database indexes, then `npm run db:indexes -- --require-ready` before release.
- No separate staging environment exists. Live staging role/upload tests and a real cloud restore have not run; attachment and restore tests used disposable local fixtures. No website deployment was performed.
