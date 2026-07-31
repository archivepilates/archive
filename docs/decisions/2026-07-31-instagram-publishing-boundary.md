# Instagram Publishing Boundary

Date: 2026-07-31

## Decision

ARCHIVE PILATES Instagram operations use an approval-gated Meta API flow.

- Codex or staff may create drafts and request review.
- Only an authenticated ARCHIVE CORE manager may approve a draft.
- Approval creates an idempotent scheduled publish job.
- `functions-social` owns Instagram publishing and insights only.
- Browser automation is not used for unattended posting.
- The first connection uses Instagram API with Facebook Login and a Page access token.
- Approval and publishing both stop unless the resolved username is exactly `archivepilates_official`.

## Canonical Data

- Draft and review state: `socialContentDrafts`
- Scheduled work: `socialPublishJobs`
- Publish evidence: `socialPublishLogs`
- Performance snapshots: `socialInsightsSnapshots`

The social collections must never select members, send Alimtalk, write StudioMate, or update Google Contacts.

## Failure Rule

If the Meta publish request may have reached Instagram but the response is ambiguous, stop automatic retries and move the job to manual review. A retry is allowed only before the publish request stage and within the bounded attempt limit.

## Release Gate

Do not enable production approval or run a canary post until:

1. A Page-linked Instagram professional account grants `instagram_basic`, `instagram_content_publish`, `pages_show_list`, and `pages_read_engagement`.
2. The scoped Page access token and IG user ID are stored as `INSTAGRAM_ACCESS_TOKEN` and `INSTAGRAM_USER_ID` in Secret Manager.
3. The connected professional account resolves to `archivepilates_official`.
4. Media URLs are public HTTPS URLs readable by Meta.
5. Functions, Firestore rules, ARCHIVE CORE Hosting, and live callable checks pass.
