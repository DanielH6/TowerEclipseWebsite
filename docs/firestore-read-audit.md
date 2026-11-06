# Firestore read audit and approval catalogue

Audit date: **7 November 2026**. Scope: the current website checkout and the supplied seven-day Query Insights screenshot. This preserves the **original audit and proposal IDs**, all approved on 7 November 2026. Observations below describe the pre-change code. Local implementation, tradeoffs, validation and rollout status are tracked in [the implementation register](firestore-read-implementation.md). The audit itself made no production database queries or configuration changes.

The separately implemented careers draft feature is a user-facing feature, not a read optimisation. It uses an explicit **Save draft** action, no autosave or polling, and one additional owner-specific draft-document load when opening the relevant application form/detail. Draft answers remain private and do not enter application counts or AI review until submitted.

## What the screenshot establishes

The selected window is **31 October–7 November**, and **Latency** is selected rather than **Read operations**. The visible rows are not a complete daily bill or a complete list of every operation.

| Visible query family | Executions | Reads shown | Average documents returned |
| --- | ---: | ---: | ---: |
| `bugReports ORDER…`, first large row | 803 | 401,500 | 500 |
| `bugReports ORDER…`, second large row | 1,615 | 419,659 | 259.851 |
| `bugReports SELECT…` | 75 | 6,438 | 85.84 |
| `updates WHERE…` | 263 | 20,182 | 76.738 |
| `careerApplications…` | 149 | 24,222 | 162.564 |
| Other visible rows combined | — | 296 | — |
| **Visible total** | — | **872,297** | — |

The two large bug-report queries account for **821,159 reads, about 94.1% of the visible total**. Their 500-document batches strongly fit the full-scan implementation below. The full normalized query text is truncated, so the screenshot alone cannot assign every row to an individual route. The application average exceeds the normal application's 21-document page limit and therefore points to a larger-result path such as statistics, search, or ranked sorting.

At the reported **400,000 reads/day**, getting below **50,000/day** requires an **87.5% reduction**. The screenshot's seven-day visible total must not be presented as 400,000/day, nor as the complete project usage. Query Insights lists query/list/aggregation API operations; direct document lookups can add reads outside these normalized query rows, and real-time listeners are excluded. Compare the Read operations view with Cloud Monitoring and billing over the same window. [Official Query Insights documentation](https://docs.cloud.google.com/firestore/native/docs/query-insights)

### Billing and interpretation rules

- Firestore's free allowance is 50,000 document reads/day. Even an empty query has a minimum one-read charge. `count()` over up to 1,000 index entries is billed as one read; its cost grows by index-entry batches. [Official billing rules](https://firebase.google.com/docs/firestore/pricing)
- Queries with at most one range field are exempt from index-entry read charges under the documented rules. Do not multiply the screenshot's scanned index-entry numbers into a bill without checking the actual query shape; `__name__` ordering can affect range-field classification. [Index-entry billing](https://firebase.google.com/docs/firestore/pricing#reads_writes_and_deletes)
- Reading 500 returned documents in one query is approximately 500 document reads, not one read. A smaller `limit()` is useful only if the server actually stops after that page instead of looping over all pages.
- Field projections, smaller response objects, and batching reduce payload or latency; they do **not** turn N returned documents into one billed document read. Promise concurrency is not a billing optimisation by itself.
- Cursors avoid paying for skipped offset documents. A complete export/search must still cover all matching records; silently imposing a 1,000-report cap would break an established requirement. [Cursor and offset billing](https://firebase.google.com/docs/firestore/pricing#managing_large_result_sets)
- Estimates below describe code-path costs and hypothetical replacements. They are not measured production savings, and overlapping estimates must not be added together.

### Local proof of the report-cache problem

A synthetic database with **1,205 reports** exercised the real query service. These counts are `bugReports` query requests, not billed document-read counts; dictionary queries are additional.

| Scenario | Report-query requests |
| --- | ---: |
| First page, 200-character descriptions | 3 |
| Second page, same token, small dataset still cached | 0 |
| Second page, same token, 2,000-character descriptions | 3 |
| Two simultaneous cold requests, same token, either description size | 6 |

The larger serialized dataset crosses the existing 2 MB cache threshold, so an ordinary second page repeats the full 1,205-document scan. Concurrent cold requests independently scan the same dataset because there is no shared in-flight fetch. This is local synthetic evidence, not proof of the deployed dataset size or traffic mix.

## Priority 0: measure costs and close the public report boundary

### 1. Attribute reads to routes, features, and cache misses

**Observed:** The custom adapter does not emit a route-level read ledger. Query Insights cannot show the cost of an entire page assembled from many queries and direct lookups. Source: [server/firebase.mjs:89](../server/firebase.mjs#L89), [server/firebase.mjs:307](../server/firebase.mjs#L307), [server/firebase.mjs:371](../server/firebase.mjs#L371).

**Proposal:** Record aggregate query requests, returned-document counts, empty queries, direct lookups, transaction retries, cache hits/misses, shared fetches, and latency, labelled by route/feature and process. Use operational logs/metrics rather than writing one Firestore metric document per request. Do not log application answers, console contents, cookies, or credentials. Add expected read budgets for common pages.

**Benefit and condition:** Establishes which deployed callers explain the remaining daily usage and verifies every later saving. Reconcile estimates with Cloud Monitoring `QUERY`, `LOOKUP`, and not-found operations and the billing window; do not claim adapter counts alone are the exact bill.

### 2. Make every bug-report API read staff-only before database access

**Observed:** List, export, and related-report routes are public. Detail uses `optionalAuth`. Source: [server/bug-routes.mjs:956](../server/bug-routes.mjs#L956). The current UI and privacy text describe public access.

**Proposal:** Require a valid session and one of `qa`, `pentester`, `leadqa`, or `dev` before **any** report query or lookup. Signed-out visitors and ordinary members should receive no report data. Apply corresponding UI route/navigation guards, update privacy/onboarding wording, and preserve existing role distinctions for edits and private notes.

**Benefit and condition:** Removes unauthorised visitors, crawlers, and ordinary members as report-read sources while protecting unreleased-game information. This is a privacy decision as well as a cost change. Savings depend on their share of traffic; staff full scans remain expensive afterward. Test API access directly, not only hidden navigation.

### 3. Include evidence, exports, histories, and cache scope in report privacy

**Observed:** Report data includes console URLs, author identities, comments, activity, and ready attachment URLs. Sources: [server/bug-routes.mjs:332](../server/bug-routes.mjs#L332), [server/bug-query.mjs:97](../server/bug-query.mjs#L97).

**Proposal:** Apply the staff boundary to every report-data surface, including related suggestions and downloads, and recheck privilege when issuing attachment access. Keep private response caches scoped appropriately and never put reports into a public CDN cache. Remove public report links/previews where access is unavailable. Define how already-issued signed links should expire or be revoked.

**Benefit and condition:** Prevents a partial privacy conversion that hides the list but leaves evidence accessible. Existing signed URLs are bearer access and can remain usable until expiry; an API guard alone does not revoke them. Existing exported copies cannot be recalled by changing website permissions.

Third-party console paste links remain independently accessible: staff-only website access cannot make pastes.dev content private; sensitive future console evidence could instead use authenticated attachment storage or redaction, while the current report-field provider format remains unchanged pending approval.

### 4. Require reviewed public wording for release-note links

**Observed:** Selecting a report automatically copies its description into the public release-note summary. Source: [src/Components/UpdateReportLinks.tsx:10](../src/Components/UpdateReportLinks.tsx#L10). Published update serialization also spreads stored update fields. Sources: [server/updates.mjs:301](../server/updates.mjs#L301), [server/updates.mjs:428](../server/updates.mjs#L428).

**Proposal:** Keep intentionally approved public fix descriptions, but require an editor to supply/review public wording instead of silently copying a private report. Use explicit public update response fields, and show links to private report details only to authorised staff. Review existing published linked summaries for unintended disclosure.

**Benefit and condition:** Makes private reports compatible with public development news. Do not automatically delete approved public release history or assume copying a private report into a public summary is safe.

## Priority 1: remove the dominant bug-report scans

### 5. Use real query pagination for ordinary report browsing

**Observed:** Every uncached page scans all reports in 500-document batches, filters in JavaScript, counts every match, and keeps only 50 results. Source: [server/bug-query.mjs:43](../server/bug-query.mjs#L43), [server/bug-query.mjs:67](../server/bug-query.mjs#L67).

**Proposal:** Push supported structured filters and sort order into Firestore and use stable cursors with a 51-record lookahead. Separate exact totals from loading a page. Handle text search through a shared searchable summary/index, not a fresh collection scan on each page.

**Estimated benefit:** In the 1,205-report example, a plain first page could read about 51 report documents rather than 1,205, roughly **96% fewer report-document reads** before other costs. Some combined filters/searches need indexes or a materialized search representation. Preserve all historical matches and stable tie ordering.

### 6. Reuse a shared snapshot instead of minting a new cache key for every visit

**Observed:** A fresh token embeds a millisecond-specific read time, and the scan cache is keyed by that exact value. Source: [server/bug-query.mjs:9](../server/bug-query.mjs#L9), [server/bug-query.mjs:29](../server/bug-query.mjs#L29).

**Proposal:** Reuse an explicitly published current snapshot for a short freshness window or use controlled time buckets, with an intentional refresh action. A shared materialized snapshot can serve compatible users/filters without another complete scan.

**Benefit and condition:** Several visits/filter changes can share one expensive snapshot. Keep server authorization independent of tokens, document the freshness window, and preserve the chosen read time across pagination/export. Do not reuse a private response across incompatible permission scopes.

### 7. Fix the cache's size cliff without removing its memory limit

**Observed:** Serialized scans exceeding 2 MB are not cached at all; otherwise only five snapshots are retained for three minutes. Source: [server/bug-query.mjs:31](../server/bug-query.mjs#L31).

**Proposal:** Cache a compact query/search projection, bounded chunks, or a private durable/shared snapshot rather than dropping caching entirely when descriptions grow. Bound total bytes and entries, and define invalidation/retention. Do not solve this by keeping unlimited copies of full reports in RAM.

**Benefit and condition:** The synthetic large-description case repeats three report queries on page two; eliminating that repeat saves another full 1,205-report scan for that navigation. Exact production benefit requires measuring serialized size, eviction, and hit rate.

### 8. Share concurrent snapshot fills

**Observed:** Two cold requests for the same snapshot both run their own scan. Source: [server/bug-query.mjs:28](../server/bug-query.mjs#L28).

**Proposal:** Store a pending fill per snapshot/scope, allow followers to await it, remove failed entries, and bound concurrent work. If several Node instances are deployed, decide whether the snapshot is shared between them or separately filled.

**Estimated benefit:** The synthetic two-request case falls from six report-query requests to three. This saves reads as well as CPU; ordinary `Promise.all` batching does not. Streaming consumers and failed/cancelled fills need explicit handling.

### 9. Retain snapshots through filter changes and navigation

**Observed:** Location/filter effects request a fresh snapshot, including when returning to the page. Sources: [src/Pages/Bugs.tsx:196](../src/Pages/Bugs.tsx#L196), [src/Pages/Bugs.tsx:215](../src/Pages/Bugs.tsx#L215).

**Proposal:** Preserve the current valid snapshot and cached response when applying compatible filters, going back from a report, or switching pages. Deduplicate overlapping effects and reserve fresh data for explicit refresh or expiry.

**Benefit and condition:** Avoids restarting the entire snapshot just to present a different view of the same data. Keep filters reflected in the URL and show the existing refresh timestamp so users understand freshness.

### 10. Reuse dictionaries for the same historical snapshot

**Observed:** Every cold report scan reads all six dictionary collections at its read time instead of using the normal catalog cache. Source: [server/bug-query.mjs:44](../server/bug-query.mjs#L44). The regular catalog already has memory, disk, and pending-fetch caching: [server/dictionaries.mjs:111](../server/dictionaries.mjs#L111).

**Proposal:** Cache normalized dictionaries by snapshot/version or preserve immutable dictionary versions referenced by snapshots. Reuse them for list, related results, and export.

**Benefit and condition:** Removes six query requests plus all their returned dictionary documents on repeated cold scans. Do not substitute today's mutable catalog into a historical snapshot without deliberately changing the snapshot contract.

### 11. Stop full report scans for every related-suggestion request

**Observed:** Suggestions scan the full report collection, keep only six matches, and use a shared point lasting 30 seconds. Source: [server/bug-query.mjs:79](../server/bug-query.mjs#L79). The browser already has a five-character gate, 700 ms debounce, and abort handling: [src/Components/RelatedReports.tsx:10](../src/Components/RelatedReports.tsx#L10); abort does not propagate into database work on the server.

**Proposal:** Search a cached compact corpus or suitable search index; reuse results by normalized term/category, and stop unnecessary server work when callers disconnect where safe. Consider an explicit suggestion action if live suggestions are not useful enough to justify their cost.

**Benefit and condition:** One writing session can currently trigger multiple full scans. Preserve older matches; merely searching the latest 50 reports or increasing debounce alone is incomplete. Shared fill cancellation must not cancel other legitimate waiters.

### 12. Replace the admin overview's full report census

**Observed:** Every overview load creates a fresh snapshot and scans all reports to count statuses and urgency before making additional count queries. Source: [server/admin-workspace.mjs:4](../server/admin-workspace.mjs#L4).

**Proposal:** Use maintained counters or cached aggregate summaries for total, pending, needs-info, ready-for-QA, urgent-open, and recent submissions. Update affected counters on authoritative report mutations and reconcile them periodically.

**Benefit and condition:** Makes opening the admin home independent of the total report count. Moving-window totals such as the last 24 hours need time-aware buckets, not a counter that only increments forever.

### 13. Authorize and load the report before loading its large detail sections

**Observed:** A detail request concurrently loads the report, up to 300 comments, 300 activity events, and 100 attachments before checking whether the report exists or an unfinished submission is visible. Up to 300 private notes are loaded for privileged viewers afterward. Source: [server/bug-routes.mjs:332](../server/bug-routes.mjs#L332).

**Proposal:** Check the staff route guard first, read/authorize the report next, then paginate comments, history, attachments, and private notes independently. Load collapsed sections on demand.

**Estimated benefit:** Large reports can approach 701 documents before notes, despite showing only a small portion initially. Denied/missing detail requests should never read their subcollections. Preserve access distinctions for private notes and unfinished uploads.

### 14. Apply mutation responses instead of refetching the whole report

**Observed:** The detail UI applies a successful mutation result, then calls `refresh()` anyway. Source: [src/Pages/BugDetails.tsx:233](../src/Pages/BugDetails.tsx#L233).

**Proposal:** Update the changed report/comment/attachment locally from the authoritative response; fetch only an affected page or a small revision summary when needed. Invalidate list summaries intentionally.

**Benefit and condition:** Saving one field or adding one comment should not reread hundreds of comments, events, and attachments. Do not invent local authorizations or discard concurrent server updates; reconcile revisions or fetch the narrow changed resource.

### 15. Keep full exports explicit and reuse completed work

**Observed:** A full export scans matching reports and makes separate comment and attachment queries for each match. Source: [server/bug-query.mjs:97](../server/bug-query.mjs#L97).

**Proposal:** Preserve complete export semantics but reuse the selected snapshot and, when safe, a completed private export keyed by scope/filter/snapshot. For large exports use a bounded background job or streamed artifact, with explicit user action and expiry. Optionally offer a separately labelled summary-only export.

**Benefit and condition:** Avoids paying for repeated identical export clicks; even empty per-report subqueries have a minimum cost. Do not silently remove comments/attachments, cap historical reports, include internal notes, or turn this into automatic external sharing.

### 16. Filter linked published updates in Firestore

**Observed:** Report details fetch all updates linking the report and then discard unpublished records in JavaScript. Source: [server/bug-routes.mjs:369](../server/bug-routes.mjs#L369).

**Proposal:** Query both the linked report ID and published status, with a suitable index, or use a maintained safe public relationship projection.

**Benefit and condition:** Saves reads of draft/private updates on each detail visit. Keep intentionally approved public summaries independent from private report contents, as required by proposal 4.

## Priority 2: careers queries and background AI reads

### 17. Maintain application statistics instead of scanning every application

**Observed:** A statistics-cache miss scans every matching application in batches of 500; the cache lasts 60 seconds. Source: [server/careers-service.mjs:306](../server/careers-service.mjs#L306).

**Proposal:** Maintain role/category/opening/status summaries, or cache an aggregate census for a longer controlled interval. Separate application totals from unique-person totals and reconcile them.

**Estimated benefit:** At 163 matching applications a cold count costs roughly 163 application reads; stored summaries could cost a few. `count()` can help simple totals but cannot by itself deduplicate one person applying to several openings. Keep QA Lead counts restricted to QA and exclude drafts completely.

### 18. Make the careers selector independent of global statistics

**Observed:** `reviewForms()` calls global application statistics before listing openings. The UI initially mounts an all-forms list, then automatically selects an opening and loads again. Sources: [server/careers-service.mjs:290](../server/careers-service.mjs#L290), [src/Components/CareerReviewWorkspace.tsx:16](../src/Components/CareerReviewWorkspace.tsx#L16).

**Proposal:** Store inexpensive per-opening counts for the selector and wait for initial selection before mounting the application list/statistics. Keep the explicit all-forms overview available.

**Benefit and condition:** Avoids a global census and an initial all-form page when the user intends to review one opening. Coalesce identical selector/statistics cache fills rather than performing simultaneous scans.

### 19. Use ascending cursor pagination for oldest-first application order

**Observed:** Every non-newest sort enters the full-pool scanning branch. Source: [server/careers-service.mjs:243](../server/careers-service.mjs#L243).

**Proposal:** Treat oldest-first as an ordinary ascending Firestore query with a document-ID tie-breaker and cursor.

**Estimated benefit:** For 163 applications, about 21 rather than 163 application reads per page, roughly 87% fewer; at 1,000, roughly 98% fewer. Preserve tied-date pagination and original submission-order semantics.

### 20. Search applicants through a reusable searchable summary

**Observed:** Every changed search term scans the selected application pool; the browser debounces for 300 ms. Sources: [server/careers-service.mjs:243](../server/careers-service.mjs#L243), [src/Pages/Applications.tsx:22](../src/Pages/Applications.tsx#L22).

**Proposal:** Use a bounded cached summary/index or appropriate prefix search queries; optionally make search explicit or increase debounce. Reuse matching result IDs across pages.

**Benefit and condition:** Avoids one full scan for every pause while typing a name. Preserve Discord/display/Roblox-name coverage, authorization, and complete-pool search rather than current-page search.

### 21. Publish/cache a queryable completed ranking

**Observed:** Ranked sorting reads all selected applications and all completed-run score documents before returning only 20 rows. Sources: [server/careers-service.mjs:243](../server/careers-service.mjs#L243), [server/careers-ai-service.mjs:105](../server/careers-ai-service.mjs#L105).

**Proposal:** Cache immutable score indexes by completed run ID and use a ranking index or bounded ranking pages for pagination. Include any status/search projection needed to avoid another entire-pool join.

**Estimated benefit:** A 163-application/ranked cohort can currently cost about 326 documents before row decoration. Keep atomic publication, whole-pool relative scores, status-filter semantics, and stale-answer revision checks; never show an old score as current after resubmission.

### 22. Remove repeated score-document reads from application rows

**Observed:** `decorate()` reads each distinct form and then one full score document per ranked row. Source: [server/careers-ai-service.mjs:94](../server/careers-ai-service.mjs#L94).

**Proposal:** Cache completed scores or materialize minimal row-badge data tied to the current completed-run pointer. Fetch full grades/evidence on the detail page only.

**Estimated benefit:** A standard ranked page can cost approximately 21 application reads + one form + 20 scores = 42 reads. Caching/materializing can remove much of the additional 21. Projection alone would save bytes, not document-read count.

### 23. Cache immutable published form versions

**Observed:** Application detail and AI work repeatedly read the same immutable `careerFormVersions` documents. Sources: [server/careers-service.mjs:88](../server/careers-service.mjs#L88), [server/careers-ai-service.mjs:145](../server/careers-ai-service.mjs#L145).

**Proposal:** Add a bounded version-ID cache shared by relevant request/run paths.

**Benefit and condition:** Removes repeated version lookups, especially in a large cohort using one published form. Continue reading mutable application revision, status, opening state, and deadline wherever authority requires them.

### 24. Coalesce careers caches and invalidate only affected statistics

**Observed:** Public forms/statistics cache completed values without a pending promise. Every review clears all statistics, including feedback/private-note-only changes. Sources: [server/careers-service.mjs:26](../server/careers-service.mjs#L26), [server/careers-service.mjs:350](../server/careers-service.mjs#L350).

**Proposal:** Share in-flight cache fills, use scoped invalidation for affected counts, and consider longer metadata TTLs with safe invalidation across deployed processes. Do not invalidate counts for note-only edits.

**Benefit and condition:** Stops concurrent identical scans and needless censuses after reviews. Filter expired public openings at response time; longer caching must not extend the server's submission deadline.

### 25. Back off the AI worker while no jobs exist

**Observed:** A configured worker polls every 15 seconds, even idle; newly started jobs already notify the local worker immediately. Source: [server/careers-ai-worker.mjs:5](../server/careers-ai-worker.mjs#L5).

**Proposal:** Retain startup recovery and durable fallback polling, but back off when idle or designate one worker process.

**Estimated benefit:** About 5,760 idle queries/day/process at the current interval. A zero-result screenshot row does not establish that every empty probe is free. Verify active instance count and configured state before attributing this volume to production.

### 26. Poll only the active AI run, and pause hidden tabs

**Observed:** During a run, each browser polls every five seconds and the server loads the form plus up to ten historical jobs. Sources: [src/Components/CareerAiReviewPanel.tsx:13](../src/Components/CareerAiReviewPanel.tsx#L13), [server/careers-ai-service.mjs:76](../server/careers-ai-service.mjs#L76).

**Proposal:** Return a compact active-job status, cache completed job summaries, load history on expansion, and suspend polling when the page is hidden. Resume with one freshness request.

**Estimated benefit:** Up to 11 reads per poll, or about 132/minute for one browser, can become one active-job read per poll or fewer. Only poll while queued/running, as the UI already attempts to do.

### 27. Retain a claimed AI run instead of rediscovering the queue per applicant

**Observed:** Each unit of work queries up to 100 active jobs before processing one applicant, then repeats quickly. Source: [server/careers-ai-service.mjs:119](../server/careers-ai-service.mjs#L119).

**Proposal:** Keep a claimed run ID and read its lease/progress directly while processing; periodically discover other jobs. Reuse safe run-local immutable inputs.

**Benefit and condition:** Removes repeated active-job discovery queries, especially when several jobs exist. Preserve transaction leases, cancellation, edit invalidation, durable recovery, and the rule against silently duplicating an uncertain paid request.

### 28. Cache published careers image metadata

**Observed:** Every published question-image request and each AI image input reads an asset document. Source: [server/careers-images.mjs:39](../server/careers-images.mjs#L39), [server/careers-ai-service.mjs:148](../server/careers-ai-service.mjs#L148).

**Proposal:** Cache immutable published metadata and generate fresh signed URLs without rereading it unnecessarily; reuse within an AI run. A detail response may include already-authorized URLs.

**Benefit and condition:** Saves repeated reads of the same question images across applicants/views. Do not cache unpublished-state authorization as public, bypass upload verification, or retain URLs beyond their valid expiry.

## Priority 2: news archives and public caches

### 29. Page the news archive instead of reading every published post

**Observed:** Each public-list cache miss loads up to 100 published updates, then sorts in JavaScript. The cache lasts 60 seconds by default. Source: [server/updates.mjs:428](../server/updates.mjs#L428).

**Proposal:** Fetch 12–20 published summaries with a stable database order/cursor, or serve a cached compact archive manifest that supports the existing archive filters. Handle the site's authored `publishedOn` dates correctly.

**Estimated benefit:** The visible average of about 77 update documents could fall to 13–21 per first-page cache miss. Preserve access to older updates and complete archive search; do not replace the current 100 cap with a new invisible truncation.

### 30. Remove the archive's cover-image N+1 lookups

**Observed:** Each update summary with a cover loads another image document. Source: [server/updates.mjs:301](../server/updates.mjs#L301).

**Proposal:** Store safe ready cover metadata on the published summary, or cache immutable published image metadata separately.

**Estimated benefit:** A 77-post list with 77 covers can read about 154 documents, not just the 77 visible in the archive query row. These extra image lookups should be measured separately. Keep signed URLs fresh and avoid publishing private object keys.

### 31. Publish durable public news artifacts

**Observed:** List/detail results live in one process's memory for one minute. Source: [server/updates.mjs:32](../server/updates.mjs#L32), [server/updates.mjs:448](../server/updates.mjs#L448).

**Proposal:** Generate a public archive/detail JSON artifact on publish, or use a shared cache with explicit publication/unpublication invalidation. Apply the reviewed public-field policy in proposal 4 first.

**Benefit and condition:** Ordinary public reads can avoid Firestore entirely, and restarts/new instances need not repopulate the archive. Define failure handling and unpublication propagation; do not serve an indefinitely stale public copy after removal.

### 32. Share cold public cache fills and control cross-instance duplication

**Observed:** News and tournament caches store completed responses but do not share a pending load. Sources: [server/updates.mjs:428](../server/updates.mjs#L428), [server/tournament-routes.mjs:128](../server/tournament-routes.mjs#L128).

**Proposal:** Use per-key pending promises, failure eviction, bounded entries, and a deployment-appropriate shared cache/artifact strategy if there are multiple instances.

**Benefit and condition:** Several requests arriving at cache expiry can share one database fetch rather than each querying the same data. Publication invalidation must not be undone by an older in-flight fetch finishing later.

### 33. Enable selective public HTTP caching

**Observed:** Every API response gets `Cache-Control: no-store`. Source: [server/index.mjs:139](../server/index.mjs#L139).

**Proposal:** Define an explicit cache policy for audience-independent published news, public tournament data, and public achievement data. Keep accounts, applications, drafts, reports, and admin responses private/no-store. Use versioning or safe conditional responses where appropriate.

**Benefit and condition:** Browser/CDN reuse can avoid requests reaching the database. Tournament developer preview currently shares a public URL, so separate the preview route or handle authenticated variants safely before public caching. Signed-image expiry also bounds cache duration.

## Priority 3: account and tester dashboards

### 34. Load account sections only when used

**Observed:** Staff account visits always load statistics, calendar, reports, and activity, including direct visits to Applications or Connections. Source: [src/Pages/Account.tsx:116](../src/Pages/Account.tsx#L116).

**Proposal:** Load section resources for the active tab and retain valid data when switching tabs. Serve a compact unread-count projection separately if the tab badge needs it.

**Estimated benefit:** A cold staff visit can currently make eight aggregation queries, load up to 2,001 calendar documents, 21 report summaries, and 30 activity events that may never be displayed. Lazy loading removes irrelevant work, without changing what Overview can show.

### 35. Maintain contribution-calendar buckets where volume justifies it

**Observed:** A 15-minute calendar-cache miss reads up to 2,001 annual report documents. Personal statistics already use eight count queries and a 60-second promise-backed cache. Sources: [server/account-service.mjs:132](../server/account-service.mjs#L132), [server/account-service.mjs:147](../server/account-service.mjs#L147).

**Proposal:** Store daily contribution buckets or a bounded annual summary, with adjustments on submission/deletion and reconciliation. Consider maintained period totals only if the already-small aggregate-query cost is material.

**Benefit and condition:** Can replace a large annual scan with a few summary reads. Preserve unfinished-upload exclusions and rolling-window dates. The screenshot's projected report-query row could include calendar traffic, but its truncated text does not prove that mapping.

### 36. Reuse the account profile across authentication and account entry

**Observed:** `/api/auth/me` ensures the profile in a transaction, then the account profile endpoint does so again. Sources: [server/index.mjs:353](../server/index.mjs#L353), [server/account-routes.mjs:38](../server/account-routes.mjs#L38).

**Proposal:** Reuse the safe result briefly or ensure identity snapshots at meaningful identity changes and cache/read the profile afterward.

**Benefit and condition:** Avoids a duplicate profile transaction on account entry. This is a small saving, not a credible explanation of 400,000 daily reads by itself. Discord-derived sessions remain authoritative; stored profile roles must not grant permissions.

### 37. Separate tester report pagination from its dashboard header

**Observed:** Every tester report-page request reloads the profile, activity, and statistics as well as the next reports. Sources: [server/account-service.mjs:194](../server/account-service.mjs#L194), [src/Pages/AdminTesters.tsx:19](../src/Pages/AdminTesters.tsx#L19).

**Proposal:** Cache the selected tester's safe header/summary and fetch only report pages when its cursor changes. Refresh header/activity explicitly or on their own freshness interval.

**Estimated benefit:** Each extra page can avoid roughly 31 profile/activity reads plus uncached count queries, while retaining the 21 needed report-summary reads. Enforce the same developer-only boundary on both paths.

### 38. Cache and paginate the tester directory

**Observed:** Each directory visit queries three roles, with up to 501 records each, then filters/sorts client-side. Source: [server/account-service.mjs:183](../server/account-service.mjs#L183).

**Proposal:** Add short promise-backed caching and real directory pagination/search. Invalidate safely after a verified identity/role change where needed.

**Benefit and condition:** Avoids rereading up to 1,503 account records on repeated directory visits. Combining roles with an `in` query can simplify network calls but does not itself reduce the billed count of returned accounts. Keep the directory private.

## Priority 3: shared infrastructure and smaller read sources

### 39. Retry only genuine transaction conflicts

**Observed:** The adapter retries any `status === 409` up to five times, including application-level stale revision, closed-opening, and invalid-state rejections. Source: [server/firebase.mjs:573](../server/firebase.mjs#L573).

**Proposal:** Distinguish Firestore abort/contention errors from intentional domain errors and retry only the former. Add meaningful regression tests for rejected inputs and real transaction conflicts.

**Estimated benefit:** A stale revision can read the same record five times instead of once; a closed submit can repeat several reads five times. Do not remove concurrency safety or silently accept a stale write to save reads.

### 40. Cache the public achievement list, history, and published thumbnail metadata

**Observed:** Every list visit reads the main document, each change-log page reads up to 11 records, and each custom thumbnail request reads its own asset metadata. Sources: [server/achievement-list.mjs:16](../server/achievement-list.mjs#L16), [server/achievement-list-thumbnails.mjs:59](../server/achievement-list-thumbnails.mjs#L59).

**Proposal:** Use the list revision for invalidation, cache immutable history pages, and cache published thumbnail metadata or return already-authorized URLs. Keep draft thumbnails private and signed links valid.

**Benefit and condition:** The main list is already a bounded one-document design; thumbnail lookups can cost more than the list itself. This is lower priority than report/application scans and should retain the existing publication/change-log contract.

### 41. Query only eligible public tournaments and cache slug resolution

**Observed:** The public list reads up to 200 tournaments before excluding unpublished/archived entries. Slug detail requests first try a direct document ID, then query the slug. Source: [server/tournament-routes.mjs:63](../server/tournament-routes.mjs#L63), [server/tournament-routes.mjs:77](../server/tournament-routes.mjs#L77).

**Proposal:** Push public eligibility into the query, retain stable pagination where needed, and cache slug-to-ID mappings. Keep developer preview separate from public cached output.

**Benefit and condition:** Saves reads of private/old events as the collection grows and repeated failed ID probes for slug URLs. The screenshot shows only 219 reads in the visible tournament rows, so this is not a leading cost source at present.

### 42. Stop live-page timers when their state no longer needs polling

**Observed:** Tournament detail starts a one-minute interval when live, but does not clear it after a later response becomes completed; it continues until unmount. Source: [src/Pages/TournamentDetails.tsx:24](../src/Pages/TournamentDetails.tsx#L24).

**Proposal:** Drive polling from current state, stop at terminal/non-live states, pause hidden tabs, and resume with one fresh request. Apply consistent visibility-aware policy to other active-only polls.

**Benefit and condition:** Removes idle background requests without delaying a visible live event unnecessarily. Different intervals/conditional responses should be measured rather than presented as realtime guarantees.

### 43. Bound expensive public reads and cache repeated misses

**Observed:** Public detail routes can repeatedly read nonexistent IDs, and several expensive read routes lack a route-specific cost limit. Sources: [server/updates.mjs:448](../server/updates.mjs#L448), [server/tournament-routes.mjs:146](../server/tournament-routes.mjs#L146), [server/achievement-list.mjs:51](../server/achievement-list.mjs#L51).

**Proposal:** Validate identifiers before I/O, use short bounded negative caches, coalesce repeated misses, and apply proportionate route/account/IP limits. Add operational read-budget alerts or a controlled degraded response for expensive nonessential reads.

**Benefit and condition:** Prevents repeated invalid links or scraping from becoming an unbounded read source. Keep legitimate staff workflows usable, do not cache authentication failures across users, and do not claim a budget alert is an automatic spending cap.

### 44. Measure importer consumption and retain its consistency checks

**Observed:** The daily importer already has durable shared leases, bounded batches, retry backoff, and a proposed daily allowance of 10,000 reads. UI status is explicitly loaded/refreshed, not continuously polled. Sources: [server/player-import-budget.mjs:3](../server/player-import-budget.mjs#L3), [server/player-import-worker.mjs:28](../server/player-import-worker.mjs#L28), [src/Components/PlayerImportPanel.tsx:42](../src/Components/PlayerImportPanel.tsx#L42).

**Proposal:** Give imports a visible feature budget, verify whether they are enabled, and compare charged usage with the durable counters. Review manual repeated sweeps and process count before changing scheduling. Keep checkpoint acknowledgments and concurrency checks; consider incremental refresh only when source change detection is reliable.

**Benefit and condition:** Establishes headroom and avoids spending on unnecessary sweeps. A bounded 10,000-read daily sweep alone does not explain 400,000/day. Roblox source-datastore/API reads and Firestore index reads are different services and must not be conflated. Do not weaken recovery safety for a small reduction in verification reads.

## Recommended first approval package

Approve **1–9, 12–14, and 39** together as the first implementation package: measurement; complete staff-only bug privacy including evidence/release-note boundaries; real first-page pagination; shared stable snapshots; a bounded cache without the 2 MB cliff; shared pending fills; sensible client snapshot reuse; inexpensive overview counts; narrow detail reads; mutation-response reuse; and correct transaction retry classification.

The privacy boundary should land first so unauthorised requests cannot populate private caches or trigger scans. Instrument and reproduce the existing behaviour before query replacements, then measure the new paths using the same synthetic workload and deployed traffic window. Search/export paths must remain complete while the ordinary list moves to true pagination.

The next package is **10–11 and 15–28**: snapshot dictionary/search/export reuse and the careers/statistics/AI read paths. Public content/account changes **29–38 and 40–44** provide additional headroom; implement earlier if instrumentation shows they dominate the missing daily usage.

Approval may also be given by individual stable item number. These are reviewable proposals, not changes awaiting an automatic deployment.

## Validation and deployment criteria

1. Prove signed-out visitors and ordinary members receive no report data, including direct list/detail/export/related/evidence paths, before database work. Verify all authorised staff roles still work and existing note/edit restrictions remain intact.
2. Prove a 50-row unfiltered list does not read every report as the collection grows. Cover tied timestamps, back navigation, combined filters, expired snapshots, and old matches beyond 1,000 records.
3. Repeat the 1,205-report synthetic cases for both small and large descriptions. Concurrent requests for the same scope/snapshot must share one fill; cache memory must remain bounded and failures must be recoverable.
4. Verify identical full export/filter/search results before and after changes, including public comments/ready attachments and exclusion of internal notes/unfinished uploads. Do not silently trade correctness for lower counts.
5. Assert read budgets for normal application pages, oldest/ranked/search pagination, selector/count requests, account tabs, and active/idle worker states. Verify resubmission invalidates stale AI results.
6. Check cache isolation across users, roles, processes, previews, and publication state. Test invalidation racing with a pending fill, signed-link expiry, and unpublication.
7. Run appropriate server/browser checks and the production build. Local synthetic checks do not establish production traffic, index readiness, or deployed savings.
8. Deploy the authorised package, verify required indexes, and compare equivalent 24-hour and seven-day windows using the same database and complete read metrics. Track reads/day, reads/request, cache hit/coalescing rates, process count, denied requests, latency, and errors. Reassess after traffic differences and midnight quota boundaries.
9. Use targeted Query Explain examples where actual index-entry charges or scans are uncertain. Analyze mode executes the query and is billed normally, so it is not a free recurring monitoring loop. [Official Query Explain documentation](https://firebase.google.com/docs/firestore/query-explain)

No daily-read target is guaranteed by this static audit. The evidence supports addressing repeated full report scans first, then verifying that the measured combined reduction provides enough margin below the free quota.
