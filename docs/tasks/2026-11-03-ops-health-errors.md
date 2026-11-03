# Operations Health Error Review

## Scope

Latest user request: inspect and fix the newly received error email. Existing clean worktree reused on dedicated branch `codex/mini/ops-health-errors-20261103`, based on `ec67dca0`. User approved verification, runtime/CORE rules integration, necessary deployment, commit and push in `call_086cb50916b747519734e8374cdd3001`. No member dispatch, contract replay, financial recalculation, scheduler change or IAM change.

## Verified Sources

- Latest actual operational attention email: Gmail `1a19ea2c4e561549`, 2026-11-03 08:40 KST. Four findings, not a new Gmail ingress failure. The later 09:39 email is the previous internal receipt test, not an incident.
- Independent read-only health run `health_202611030959_quick_read_only`: same four findings, no repair, restart, mail or status mutation.
- Canonical private chart and request `plc_281189166`: both cancelled, no submissions, no known Notion page or creation intent, inactive lease. Failed at 11/2 22:20 KST in member-folder identity/submission validation. Cancellation was treated as a folder-creation failure instead of a no-content no-op. CORE MCP returned business metadata; missing notionSync/lease fields were narrowly read using the operator service account.
- Contract recovery remains intentionally gated: latest natural Excel run 09:13 KST succeeds independently of `signature_recovery_approval_unavailable`. This is not an IAM lookup failure. Do not clear the approval or enable automatic writer.
- Monthly settlement last scheduled execution failed 11/1 09:30 with local pointer read error `-11`; bounded retries were already fixed on 11/2. The October review index exists, the canonical final index does not. No settlement execution or financial regeneration attempted.

## Changes

- Empty cancellation no-op requires matching canonical request/record identifiers and both cancelled, no answer/report/media/page/create intent/lease or successful projection evidence. Only the known pre-dispatch identity guard error or no error is eligible. Unknown provider failures remain reviewable.
- Persist explicit `pending / cancelled_without_submission`, never synced. Retain historical failedAt and attempted version; unchanged repeats perform no write or external call. Reactivation/submission resumes the ordinary path.
- Health excludes only the explicit eligible marker, not an arbitrary cancelled failure. Add a separate diagnostic count.
- Read-only settlement artifact inspection distinguishes review-only/missing/final-present without changing paths or accepting drafts as success.
- Preserve the historical unkeyed settlement finding title/cause/first source so explanatory changes do not create duplicate unresolved incidents.
- Health labels the exact recovery-only contract issue as approval hold; simultaneous issues retain the general review title.
- Explicit null run time is stored as unknown, not the health observation time; existing logging callers without that option retain defaults.
- Exact one-off metadata repair defaults to plan. Apply requires expected fingerprint, clean main matching origin/main, canonical cancellation guards, one-time audit and independent source/request/readback hashes. It cannot call Notion or send messages. Do not apply before approved release or replay an unknown transaction.
- CORE rules source updated, not deployed.

## Current State

Local implementation complete. Node 22 regression: 216 tests passed, zero failures/skips, including 49 isolated one-off runner tests. The one-off test helper is mocked; real cancellation eligibility is separately confirmed by the compiled production helper against the exact stored record, without apply. TypeScript build, syntax and whitespace checks passed. Functions affected detection: private-chart only. No production dry-run was attempted from the dirty feature branch.

Static CORE responsive preview: 95 checks across 320/390/768/1440/1920 widths. Expanded changed section and HTML report additionally checked at 320/390/768/1440, no horizontal overflow. These are synthetic/static previews, not authenticated live production checks. Task-owned local servers, pages, contexts and browsers closed in finally; no user browser state touched.

Release is approved and being prepared. Cancellation plan reports eligible; this is not yet an applied repair. Actual deployment, status recovery, runtime/health readbacks and CI evidence will be recorded after completion. Contract approval and October final settlement remain operator follow-ups and are not hidden.
