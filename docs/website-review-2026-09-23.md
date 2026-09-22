# Tower Eclipse website review — 23 September 2026

Scope: review of the local React/Node implementation, its API routes, data contracts, and existing tests, plus isolated browser checks of this change. This is not a production security audit or a live Discord/Firestore/R2 validation.

## Current coverage

The website already combines a public game homepage and Roblox statistics, About/credits galleries, game updates and developer blogs, tournament management and results, careers/application review, Discord identity with optional Roblox linking, personal report statistics/activity, and a public bug tracker with staff moderation and attachments. The new export and tester overview connect more of the development workflow to those existing features.

The biggest opportunity is to connect reporting, testing, fixing, and publishing into one traceable process. Additional isolated content pages would be less useful to development than those connections.

## Recommended priorities

1. **Replace the 1,000-report list cache limit with complete server pagination.** The list/export currently represents recent cached reports, while personal account statistics can include older history. At higher volume this becomes confusing. Preserve the filters, add an explicit data refresh timestamp, and support stable export snapshots. Acceptance: an older matching report remains discoverable after more than 1,000 newer submissions exist.

2. **Introduce structured reproduction fields and duplicate links.** Today the description prompt asks for what happened, reproduction steps, and expectations in one free-text field. Add separate steps, expected/actual behavior, frequency, game mode/place, and match/build identifiers where available. Suggest related reports before submission and allow staff to link a duplicate to its canonical report. Preserve original submissions and credit. This follows the useful structured-input pattern illustrated in [GitHub’s issue-form documentation](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms).

3. **Create QA test runs and regression checklists.** A lead could open a test run for a specific game version, select maps/modes/devices/features, assign testers, and record pass/fail/blocked evidence. A failed check should link directly to a report. This would make gaps in testing visible and give the tester overview meaningful context beyond submission volume.

4. **Connect bugs to fixes and release notes.** Add an assignee, target build, fixed build, and verification state. Link a report to the published update that resolves it; allow the update editor to gather selected verified fixes into a draft. Keep public wording editable and require normal publishing actions. Useful path: reported → reproduced → fixed → retested → released.

5. **Add a real admin landing page and saved queues.** `/admin` currently opens dictionaries. A landing page could show reports awaiting triage, regressions, reports needing more information, drafts awaiting publication, and applications awaiting review, with links to each existing manager. Save common bug filters in URLs so leads can share exact work queues.

6. **Expand tester contribution context.** Add recent authored comments/retests and assigned test-run completion. The new viewer currently shows submissions and updates on the tester’s reports. Distinguish those from activity the tester performed on someone else’s report. Avoid treating raw report counts as a quality score; duplicate discovery, clear reproduction evidence, and successful retests also matter. If live membership becomes necessary, plan a deliberate Discord synchronization mechanism instead of presenting historical verification as current rank.

7. **Give players a public known-issues and release-readiness view.** Curate major issues, workarounds, supported platforms, and the current test/release stage from existing report/update data. Keep internal commitments and unconfirmed dates out of public projections. This could reduce repeated questions in Discord while helping players submit better reports.

8. **Invest in operational checks before expanding live game data.** Add authenticated staging browser tests for QA/admin/member roles, attachment upload/download checks, deployment-time index readiness checks, and tested backup restoration. The existing session store and in-process caches also warrant a scaling review before running multiple API instances. If game analytics are added later, start with aggregate crash/error, match-completion, and performance measures tied to builds; define collection and retention before adding player-level detail.

Additional community ideas: tournament registration/check-in connected to verified accounts, optional subscriptions to selected public updates, tester onboarding resources, and a searchable developer journal archive. These are secondary to the QA and release workflow above.

## This change and rollout

- Bug export: applied-filter JSON across all matching list pages, with public comments and ready attachment links, copy/select/download controls, and explicit cache scope. Internal notes and unfinished uploads are excluded.
- Admin tester directory: rank/identity search, verification dates, paginated history, cached rolling submission counts, and recent updates on the tester’s reports. Only the existing developer/admin role can access its API.
- Last-verified ranks populate as existing accounts authenticate or refresh; no historical Discord membership backfill is claimed.
- Privacy wording now describes exports and the private tester viewer. This is a factual feature disclosure update, not a legal compliance assessment.
- Apply the checked-in `websiteAccounts.verifiedRole` index before releasing the directory. The existing account report/activity indexes are reused.
- Production deployment, live account-role changes, and live data/export delivery still require rollout verification.
