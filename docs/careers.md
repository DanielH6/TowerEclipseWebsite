# Careers and applications

Uses the existing website Firestore project. No new Firebase project, OAuth client, storage bucket, or hosting service is needed. Production still needs the existing Roblox account-linking OAuth configuration and public Roblox approval from the account work.

## Team workflow

1. Open **Careers → Manage openings**, or **Admin → Careers & applications**. Existing Developer access includes the site's mapped Discord Owner/Admin roles. QA and QA Lead do not get access to private applications.
2. Choose **New opening**. Start from a Tester, Moderator, or Developer template, or build from scratch. Templates are editable drafts, not published recruitment terms; review the commitment, description, and questions yourself.
3. Add short/long answers, multiple choice, checkboxes, ranking, or linear scales. Set required questions, help text, options, scale labels, a deadline, and the confirmation message. Questions can be moved, duplicated, and removed.
4. **Save draft** saves an explicit draft. **Preview** lets you try the question controls without submitting. **Publish opening/version** confirms the current draft and makes it public.
5. **Close opening** stops new applications. It keeps existing submissions available. Publishing again reopens it; choose a future deadline or clear the old one first.
6. Open **Review applications**, either for one opening or all openings. Filter by status and use Next/Previous for more records. Read original answers, select a status, write optional applicant feedback and/or private notes, and **Save review**.

Statuses: Submitted, Under review, Shortlisted, Accepted, Rejected, Withdrawn. Opening an application does not silently change its status; reviewers explicitly save their decision. Decisions do not send messages or grant platform roles.

Applicants sign in through the existing Discord flow and connect Roblox through Account → Connections. Both are checked again on submission, including the Roblox ownership claim. Applications are available under Account → Applications and as a recent preview on the profile overview. The details view shows submitted answers, feedback, and the latest 50 public status/feedback changes. Applicants can withdraw an undecided application, with confirmation. There is one submission per Discord account per opening, including after withdrawal; create a **new opening** for a new recruitment round. Existing Google Forms submissions are not imported.

## Data and cost design

- `careerForms/{randomId}`: opening metadata and editable draft. Public queries only return metadata for published, unexpired openings. Public listings have a bounded 60-second server cache, invalidated by edits. Submission checks always read the authoritative opening.
- `careerFormVersions/{openingId_revision}`: immutable questions and description, one document per published version. Applications reference this instead of copying every question into every response. Draft saves do not generate published versions.
- `careerApplications/{hash(openingId:discordId)}`: identity snapshot, validated answers, status, feedback, private notes, and bounded history. Deterministic IDs and Firestore transactions prevent duplicate writes on concurrent/retried submission. Edits use revision checks to prevent overwriting another reviewer or a withdrawal.
- One application document write on first submission, one on review/withdrawal. No database writes for typing, previewing, or opening a submission; no polling and no notification fan-out. Transactions may perform additional reads on conflicts.
- Lists return at most 20 summaries plus a lookahead document (21 reads maximum per query), cursor-paginated with a document ID tie-breaker. Answers, private notes, and history are excluded from list projections. An application detail normally reads its application plus one shared form version. Applicant submission also reads the profile, Roblox ownership claim, existing application, opening, and published version.
- Form maximum: 40 questions, 15 options each. Answers maximum: 64 KB UTF-8 total; 500 characters per short answer and 5,000 per long answer. Feedback is limited to 2,000 characters, notes to 6,000, history to the latest 50 public changes. These are bounds per record, not a promise of fixed total storage cost.
- Large question, answer, note, and history fields have index exemptions. Only list/filter fields are indexed. This follows [Firestore guidance on index exemptions and cursors](https://firebase.google.com/docs/firestore/best-practices).
- New records go into Firestore, not local `.runtime`. Local runtime caches/sessions continue to follow the existing host's persistence setup. No large application archive is placed on the host's 4 GB disk.

## Database preparation before deployment

`firestore.indexes.json` includes the new Careers indexes and field exemptions alongside the existing account indexes. The existing setup script has been generalized; both the old `account:indexes` command and the clearer new name below run it.

```sh
npm run db:indexes
# With credentials authorized to administer Firestore indexes:
npm run db:indexes -- --apply
# Repeat the read-only check until all indexes are READY:
npm run db:indexes
```

The script is additive and leaves unrelated indexes alone. It applies the explicit field exemptions/overrides in the file. The current application service account previously lacked permission to create indexes; an authorized project administrator may need to run this or use the Firebase console. Do not add broad index-administration privileges to the runtime application just for this step.

Required composites: `careerForms` state ASC + openUntil ASC; `careerApplications` createdAt DESC following each of these equality-filter sets: applicantId; status; formId; formId+status; applicantId+status; applicantId+formId; applicantId+formId+status. Firestore adds its document-name tie-breaker. `careerForms` and `careerApplications` each retain a descending single-field createdAt index; the wildcard automatic index exemption disables unnecessary fields. `careerFormVersions` needs no field indexes.

The repository’s `firestore.rules` denies all direct client reads and writes, including the new collections. Keep that rule deployed. This application uses authenticated server REST access. Check existing Firestore security rules do not grant broad public access to arbitrary collections. Server routes enforce applicant ownership and Developer-only review; Firestore Admin credentials bypass client security rules, so both boundaries matter.

After deployment, verify `/careers`, one real Discord/Roblox link, a draft/preview/publish cycle, a submission, a reviewer update, and the applicant's tracker. Ensure `/api/careers/*` goes to Node with API caching disabled and SPA paths reach `index.html`, following the current hosting setup. Existing API/header configuration is sufficient; no new CSP destinations were introduced.

## Privacy, retention, and support

Privacy and terms pages now describe applications, identity snapshots, reviewer access, and withdrawal. No automatic archive deletion is enabled: the operator must decide retention periods rather than silently lose recruitment records. Review storage periodically and fulfill verified access/deletion requests through `contact@towereclipse.com`.

For a verified privacy request, query `careerApplications` by applicantId and paginate all results. Applicant exports must exclude internalNotes and reviewer metadata unless the operator determines disclosure is appropriate under the applicable request; private notes may still need consideration when fulfilling legal rights. Application deletion removes its record including embedded history and notes. Deleting that record also removes the one-submission guard, so handle a retained minimal anti-abuse record only if justified and disclosed. Unlinking Roblox alone does not erase historical application identity snapshots. A shared form version contains form questions rather than applicant answers and must not be removed while applications reference it.

## Validation and boundaries

Run `npm test` and `npm run build`. Careers service tests cover all question types, malformed/oversized answers, linked ownership, concurrent duplicate submissions, immutable published versions, deadlines, closed openings, optimistic concurrency, ownership/privacy, withdrawal, cache invalidation, bounded history, and tied-timestamp pagination. HTTP tests exercise authentication, role restrictions, CSRF, origin enforcement, and rejection of client attempts to select admin access.

Browser checks use a loopback preview with synthetic accounts and an in-memory implementation of the database, while exercising the real Careers router/service and built React UI. They do not prove live Firestore indexes, real OAuth consent, production hosting, email delivery, or behavior under production load. No forms or applications are seeded into production by this implementation.

Read-only deployment check on 14 September 2026: the four account composites and account wildcard exemption are READY. The eight Careers composites and five Careers field overrides are not yet configured. This check made no changes to production.

Local validation on 14 September 2026: all 80 server tests and the production build passed. Browser checks passed for all six question controls, submit/receipt/profile tracking, reviewer feedback versus private notes, template/save/preview/publish/close, scale editing/reordering, signed-out and unlinked gates, and responsive layouts at 400/433 CSS pixels. The shared mobile header was adjusted to keep Play beside the wordmark and navigation below it.
