# Firestore read reduction implementation

Local implementation register for the 44 proposals approved on 7 November 2026. The original reasoning and screenshot are retained in [the audit](firestore-read-audit.md). This work includes the previously requested private application drafts and the withdrawal/unsaved-answer notices. No production deployment or production savings measurement is implied by this register.

## Approval coverage

| ID | Implementation | Main source |
| --- | --- | --- |
| 1 | Operation/lookup/empty-query/retry and named cache metrics, process logging, developer endpoint and lazy admin usage panel; no per-request Firestore metrics writes. | `server/read-metrics.mjs`, `server/firebase.mjs`, `src/Components/ReadUsagePanel.tsx` |
| 2 | Server and UI report access restricted to QA, PEN Tester, QA Lead and Developer; authentication precedes report queries. | `server/bug-routes.mjs`, `src/App.tsx` |
| 3 | Staff-only exports, related results, histories and authenticated attachment download issuance; private cache policy and updated privacy guidance. External copies/paste links cannot be recalled. | `server/bug-routes.mjs`, `src/content/legalContent.tsx` |
| 4 | New release-note links start with empty reviewed public wording; public update fields are explicitly selected, and report navigation is staff-only. | `src/Components/UpdateReportLinks.tsx`, `server/news-read-model.mjs`, `src/Pages/UpdateDetails.tsx` |
| 5 | Ordinary and supported single-dimension filters use frozen database cursors and 51-row lookahead; totals use aggregation. Complex/text filters retain complete results through a shared corpus. | `server/bug-query.mjs` |
| 6 | A recent snapshot is reused instead of issuing a different read time for every visit. Explicit refresh produces a new point. | `server/bug-query.mjs` |
| 7 | Compressed, byte-bounded private caches replace the 2 MB all-or-nothing cutoff; raw working sets and concurrent fills are also bounded. Oversized requests fail explicitly rather than returning partial results. | `server/bug-query.mjs`, `server/read-cache.mjs` |
| 8 | Pending cache fills are shared; invalidation cannot resurrect an older fill. | `server/read-cache.mjs` |
| 9 | Valid snapshots, page cursors and results are retained through compatible filtering and navigation. | `src/Pages/Bugs.tsx` |
| 10 | Frozen dictionary values are shared by the same historical snapshot. | `server/bug-query.mjs` |
| 11 | Related suggestions search the shared complete summary corpus and reuse term results; existing debounce/abort behavior remains. Shared fills may finish for other callers rather than being cancelled by one disconnected caller. | `server/bug-query.mjs`, `src/Components/RelatedReports.tsx` |
| 12 | Admin report summaries are initialized once, updated from committed report mutations, and periodically/manually reconciled; changing the display snapshot does not rerun a report census. | `server/admin-workspace.mjs` |
| 13 | Report existence/access checks precede section reads. Comments, activity, attachments and notes have independent lazy 50-row cursor pages. | `server/bug-routes.mjs`, `src/Pages/BugDetails.tsx` |
| 14 | Mutation responses update affected report state/sections instead of refetching every detail collection. | `src/Pages/BugDetails.tsx` |
| 15 | Explicit exports share frozen raw records/comments/attachment metadata. Download access is issued afresh rather than caching expiring signed URLs. | `server/bug-query.mjs`, `server/bug-routes.mjs` |
| 16 | Related release-note queries include published status in Firestore. | `server/bug-routes.mjs`, `firestore.indexes.json` |
| 17 | Role-scoped compact application corpora preserve exact distinct people, with incremental local mutations, bounded fills and visible freshness. | `server/careers-index.mjs` |
| 18 | Opening selection uses maintained opening counts/cached metadata; developer selectors do not start an application census. Historical QA access is reconciled in a scoped legacy path. Initial unintended all-form requests are avoided. | `server/careers-service.mjs`, `src/Components/CareerReviewWorkspace.tsx` |
| 19 | Oldest-first application order uses ascending 21-document cursors. | `server/careers-service.mjs`, `firestore.indexes.json` |
| 20 | Applicant search reuses a complete opening/role summary, then fetches at most 20 current rows for a page. | `server/careers-index.mjs`, `server/careers-service.mjs` |
| 21 | Completed ranking indexes are immutable, cached and seeded by completion; pagination does not rescan the score cohort on every request. Submission revision checks hide old assessments. | `server/careers-ai-service.mjs` |
| 22 | Ordinary lists fetch only visible compact badge records on a cold cache; warm pages reuse them. Full grades/evidence load only on detail. | `server/careers-ai-service.mjs` |
| 23 | Immutable original form versions are cached and shared between applicant reads and assessment work; authoritative mutable deadline/revision checks remain. | `server/careers-service.mjs`, `server/careers-ai-service.mjs` |
| 24 | Careers caches share fills, replay committed changes across a cold fill, and avoid count invalidation for notes/feedback-only edits. | `server/careers-index.mjs`, `server/careers-service.mjs` |
| 25 | Idle AI discovery backs off from 15 seconds to five minutes, with immediate notification and startup recovery. | `server/careers-ai-worker.mjs` |
| 26 | Active-job status reads replace repeated full history polls; hidden tabs pause and completed history loads explicitly. | `server/careers-ai-service.mjs`, `src/Components/CareerAiReviewPanel.tsx` |
| 27 | A worker retains the claimed job while processing its cohort; queue rediscovery is no longer performed per applicant. Leases and edit checks remain. | `server/careers-ai-service.mjs` |
| 28 | Published immutable question-image metadata is cached; private pending uploads remain protected and download URLs are freshly generated. | `server/careers-images.mjs` |
| 29 | News API/UI have complete cursor/search pagination over a durable public manifest with no 100-post cap, preserving legacy authored publication dates. | `server/news-read-model.mjs`, `src/Pages/News.tsx` |
| 30 | Publication materializes safe cover metadata; legacy cover metadata is cached rather than reread per archive request. | `server/updates.mjs` |
| 31 | Public news manifests/details survive process restarts in bounded atomic artifacts. | `server/news-read-model.mjs`, `server/durable-read-cache.mjs` |
| 32 | Public fills are shared, with separate generation markers for sibling-process invalidation. Non-shared hosts revalidate within their TTL. | `server/durable-read-cache.mjs` |
| 33 | Only explicitly allowed anonymous public-content responses receive short public HTTP caching. Cookies, authentication, errors and private APIs remain no-store. | `server/public-read-policy.mjs` |
| 34 | Account calendar/statistics/report/activity sections load when the selected tab needs them. | `src/Pages/Account.tsx` |
| 35 | Complete daily contribution counts use a persistent idempotent sharded read model, legacy reconciliation and mutation callbacks; routine loads read metadata instead of up to 2,001 report records. | `server/account-calendar.mjs`, `server/account-service.mjs` |
| 36 | Identity-qualified profile caching shares immediate authentication/account requests; account-link mutations invalidate it. Authorization remains session/Discord-derived. | `server/account-service.mjs`, `server/account-routes.mjs` |
| 37 | Tester report cursors use a dedicated report endpoint instead of reloading header/statistics/activity. | `server/account-service.mjs`, `src/Pages/AdminTesters.tsx` |
| 38 | Tester directories use bounded cursors, shared caching, and a cached complete-search fallback. | `server/account-service.mjs`, `src/Pages/AdminTesters.tsx` |
| 39 | Intentional domain 409 errors are not retried; genuine Firestore abort/conflict retries remain. | `server/firebase.mjs`, `server/firebase-query.test.mjs` |
| 40 | Published achievement lists/history/thumbnail metadata are cached with publication invalidation and private draft isolation. | `server/achievement-list.mjs`, `server/achievement-list-thumbnails.mjs` |
| 41 | Public tournament eligibility is queried before hydration, slug resolution and misses are cached, and developer previews remain separate. | `server/tournament-read-model.mjs`, `server/tournament-routes.mjs` |
| 42 | Polling follows current live state and visibility, stops on completion, and refreshes once when visible again. | `src/Pages/TournamentDetails.tsx` |
| 43 | Public read limits, identifier validation, bounded negative caches and operational budget-review signals bound repeated expensive requests. | `server/public-read-policy.mjs`, `server/read-metrics.mjs`, public read models |
| 44 | Importer operations have a separate metrics scope and accessible usage information; durable budgets, leases, checkpoints and retry safety remain. New private draft/calendar fields are exempted from unused indexing. | `server/player-import-worker.mjs`, `src/Components/PlayerImportPanel.tsx`, `firestore.indexes.json` |

## Cost and consistency boundaries

- A cold ordinary report page reads its 51-row lookahead, two aggregation results, and frozen dictionaries. It does not load every report. Many unfinished upload rows can require additional bounded pages to find 50 submitted rows.
- Text search, unsupported structured filter combinations and complete exports still require a complete corpus on a cold snapshot. Results remain complete beyond 1,000 reports. They reuse bounded compressed historical data afterward; these paths have not been replaced with a paid external search service.
- Numbered report jumps may walk cursor anchors. Normal next/previous navigation reuses those anchors without Firestore offsets.
- Careers counts/search indexes reconcile external-process changes within 15 minutes, expose their timestamp, and support an explicit refresh. Local authoritative mutations update them immediately. Cold cohort/legacy fills still incur their actual document reads; warm pages avoid repeating them.
- News pagination uses a durable manifest rather than requiring a live backfill of a new archive-sort field. A cold rebuild reads all published legacy summaries once; subsequent pages/search reuse it. It preserves authored dates and older posts rather than pretending every cold load costs only one database page.
- Shared-volume artifact invalidation applies to processes using the same `LOCAL_CACHE_DIR`. Separate hosts without a shared volume rely on bounded TTL revalidation. Caches accelerate reads; they never supply authorization.
- Contribution calendars add summary/membership writes to remove repeated historical reads. Reconciliation is complete, not capped at 2,000 reports. Exceptional oversized memberships are calculated completely without persisting an oversized document.
- Read metrics are per process and restart with it. Returned-document counts and minimum query estimates are not a precise billing ledger; index/aggregation charges, other instances and external callers require Cloud Monitoring/billing reconciliation. Logs contain feature labels and totals, not report/application bodies.
- Restricting reports does not revoke already-exported files, independent third-party paste links or previously issued storage links before their expiry. New attachment issuance requires staff access.

## Application notices and drafts

Withdrawal confirmation explicitly says that the applicant cannot apply again to the same opening and offers editing/resubmission before the deadline instead. It also explains administrator restoration. Unsaved-answer warnings explicitly recommend **Save draft**. Guarded internal links, programmatic SPA navigation and browser back/forward support cancelling the move; closing/reloading uses the browser's native warning, whose wording the browser controls. Successful draft saves and submissions do not raise an unsaved warning.

Drafts remain separate owner-only records. Explicit saves may contain incomplete answers; neither typing nor draft loading starts an AI request. Saved edits do not change the submitted version until resubmission. Multi-tab revisions, original question recovery, deadlines and read-only saved-work recovery remain enforced.

## Rollout

1. Apply only the approved index families using an identity authorized to administer indexes:

   ```sh
   npm run db:indexes -- --only-read-optimizations --apply
   npm run db:indexes -- --only-read-optimizations --require-ready
   ```

   Repeat the readiness check until every target is READY. The script is additive and does not delete database records or unrelated indexes. The runtime service account need not receive index administration privileges.
2. Deploy the source/build through the existing host workflow. Git push alone does not prove the running backend restarted or the indexes became ready.
3. Set `LOCAL_CACHE_DIR` to a writable persistent volume. Use the same directory for sibling Node workers that should share public artifact generations. Retain adequate space and normal operational access controls.
4. Verify signed-out/member rejection on report APIs, legitimate staff access, narrow note permissions, approved public news, draft/resubmission behavior, and account contribution updates.
5. Open **Admin → Database read usage** or request `GET /api/admin/read-metrics` as a Developer. Compare like-for-like 24-hour and seven-day project windows after rollout, including process counts, traffic, returned documents and cache reuse. The code changes do not by themselves prove usage below 50,000/day.

## Validation

Completed local validation on 7 November 2026:

- `npm test`: **389 tests passed**, zero failures/skips.
- `npm run build`: TypeScript and production Vite bundle passed.
- `git diff --check`: clean.
- Browser checks passed: `careers-drafts.mjs`, `careers-resubmission.mjs`, `careers-authoring.mjs`, `careers-ai.mjs`, `bugs-read-optimization.mjs`, and `public-account-reads.mjs`. All use synthetic accounts/storage and deterministic provider fixtures. They cover desktop/mobile layouts, restrictive CSP, privacy boundaries and native/SPA navigation behavior; no production data or paid AI requests were used.

Meaningful read-budget evidence:

- 1,205-report ordinary list: 51 report documents for a 50-row page; same-snapshot navigation/search reuse does not repeat the full scan. An all-unfinished-upload dataset returns no submitted rows without a report-document scan. Historical matches and complete exports remain covered.
- Shared large-description corpora avoid the former 2 MB cache cliff; concurrent requests share fills. Raw working sets, retained bytes and concurrent work are bounded. Admin overview refresh across a new snapshot window performs zero report-document reads after its maintained summary is initialized.
- Lazy report details traverse all 125 synthetic comments in cursor pages. Adding a comment does not reread the core report and every section. Anonymous/member and invalid encoded-ID requests are denied before database access.
- Careers oldest-first pages use 21-document cursors. A 523-application statistics corpus uses two initial batches, shares concurrent fills/status filters, and retains 30 exact distinct people; local note/feedback/status updates do not rescan it. Search reuses a 103-application corpus across terms/pages and reads at most 20 fresh application rows per page.
- A 437-post news manifest builds with three 200-document queries; all subsequent 37 API pages reuse it without another database scan. Authored dates, older search matches and public-field exclusions remain covered.
- A 2,450-report contribution calendar reconciles completely and then uses its daily summary, with idempotent finalize/delete callbacks. Tester directory pages use 51-row lookahead, and report-page navigation avoids header/activity rereads.
- Cache generation/invalidation races, failed fills, domain-versus-Firestore transaction conflicts, cookie/private response isolation, signed URL lifetime plus downstream HTTP caching, AI idle backoff, claimed-job reuse and hidden/terminal polling are covered by regression checks.

These checks establish local behavior and query budgets. Production index readiness, host deployment, cross-host volume configuration, real OAuth and actual daily billing/traffic reductions remain rollout checks. No commit, push, publication, production migration or index-creation request was performed.
