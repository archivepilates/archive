# ARCHIVE PILATES OPS Project Data Housekeeping

## Approved Scope And Names

The operator requested deletion of confirmed-unused resources and readable
names. They first chose a Korean label, approved an English console label,
then explicitly chose `ARCHIVE PILATES OPS` everywhere rather than mixed
suffixes. This supersedes the old ARCHIVE IN display-name convention only;
technical IDs, existing member URLs and approved historical content remain.

Project `archive-pilates` only. Do not modify careers or other projects.
Branch: `codex/mini/project-data-housekeeping-20261028`.
Worktree: `/Users/archivepilates/.codex/worktrees/project-data-housekeeping-20261028/ARCHIVE-IN`.

## Evidence And Applied Actions

- Read existing cloud metadata and aggregate counts using the operator service
  account. Snapshot includes one active DB, 119 root collections and seven
  Hosting sites. Counts are documents, not unique people or proof of use.
- Existing retention dry-run found zero eligible fixture/contract/media deletes.
  No whole collection was deleted. A zero parent-document count is not proof
  of no descendants (`studiomateRaw` is preserved).
- Source-defined video collection rate guards use UTC hour keys and expiry two
  days after update. Of 23 expired records, only 22 met all additional proof
  checks and the one-hour grace. The unchanged-version checks and deletion ran
  in one Firestore transaction, with one attempt. All 22 exact paths were
  independently absent afterward. Events, sessions, active limits and one
  insufficient-proof expired record remain. No recurring purge was added.
- Deleted exact Cloud Run Job `archive-reservation-mirror-isolation` after
  verifying its completed October 23 execution, zero active executions, no
  matching Scheduler target and unchanged etag. Delete operation completed;
  exact resource GET returned 404. No active Cloud Run service was deleted.
- Firebase project and shared web app display names are `ARCHIVE PILATES OPS`.
  Project number, project/app IDs and complete SDK config hash were preserved.
- Korean project-name requests returned 400. The approved English Firebase
  request returned 500 but had applied: independent GET showed the intended
  name, so the write was not replayed. Shared web-app rename succeeded.
- Google Cloud Resource Manager still had the old display name. The service
  account lacked project-update permission and the saved home CLI credential
  needed reauthentication. No IAM expansion was attempted. After operator
  authentication, the exact project-name field was saved in Chrome's verified
  official-account profile for `home@archivepilates.com`; source IDs were
  unchanged. Independent API reads then matched all three display names.
- Hosting purpose/status labels were added to seven exact sites, preserving
  existing labels, site/app identity and URL. No DNS, domain ownership,
  network, auth, service configuration or message template was changed.

## Protected And Uncertain Assets

Keep `(default)`, source/action/audit/claim/contract/memo/link collections,
derived read models with readers, work-lane state, OAuth caches, production
Functions, deployment source buckets and archived recovery material.
`archive-pilates-home` remains review-required, not declared unused.
`archive-pilates-in` serves member compatibility links despite its old ID.
Private classification is not a source for member-facing decisions.

Raw member profiles, health answers, passwords and tokens were not exported.
Exact expired-guard before-images and all write intents/receipts are private
under `/Users/archivepilates/ArchiveIN/operations/project-data-housekeeping-20261028/`.
They are not committed. The public dictionary contains resource IDs and
readable labels only; it does not rename Firestore collections.

## Verification And Release

`node --test scripts/tests/project-housekeeping-policy.test.mjs
apps/reservation-mirror/test/release-hosting.test.mjs`: 26 passed (six policy,
20 release safeguards). Final review strengthened exact subject-key binding,
empty-path rejection and timestamp fail-closed behavior. All 22 private
before-images passed that stronger predicate read-only; no deletion was
replayed. Final suite: 28 passed (eight policy, 20 release safeguards).
`validate:archive-core-hosting` and `git diff --check`
passed. Affected Functions detection returned no codebases. Exact comparison
with the base confirmed that only one section was added to the CORE rules
page; existing rules, layout and scripts are unchanged.
All 119 captured collection IDs have dictionary labels; project/default DB
IDs are unchanged. Final resource, SDK, site and public-route checks are
recorded in private `final-verification.json`. Public HTML response checks
do not establish authenticated end-to-end workflows. No real member message,
reservation, contract request or climate command was tested. The standalone
HTML report could not be visually opened because the browser URL policy
blocked local file URLs; no alternate browser route was attempted. Therefore
responsive screenshots of that report were not verified in this session.

Only the CORE rules page is an application release target. The naming guide,
policy tests and dictionary are source/docs changes, not a new scheduler or
Functions deployment. Final scoped Hosting receipt, CI and Git status follow.
