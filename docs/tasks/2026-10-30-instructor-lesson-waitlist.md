# Instructor lesson unpaid waitlist

Date: 2026-10-30
Status: implemented and locally verified; scoped production rollout approved and being prepared.
Worktree: /Users/archivepilates/codex-worktrees/instructor-lesson-waitlist-20261030
Branch: codex/mini/instructor-lesson-waitlist-20261030
Base: origin/main 319a904f

## Scope

- Existing manual course selector adds `waitlist` (수강대기).
- No payment, occupied seat, member creation, ticket, eform, memo, or confirmation job.
- Date cards show a separate waitlist count. Roster shows ordered name, administrator-only phone, and intake time.
- Existing paid registration, cancellation and dispatch policies remain unchanged.
- No automatic promotion, notifications, scheduler, or production test records.

## Canonical State

Use existing `instructorLessonRegistrations` and the original studio + normalized phone + lesson date key. Waiting records have `courseKind=waitlist`, `mode=waitlist`, `status=waitlisted`, `waitlistOnly=true`, `intakeOnly=true`, `paymentMethod=none`, false payment/seat checks, and all downstream steps `not_required`.

Duplicate waiting submissions retain the original position and timestamps. Paid records cannot become waiting records. Explicit paid registration of the same identity/date can replace waiting state only with fresh payment/seat checks, no existing issuance job, and matching identity. Preserve original intake time in `waitlistHistory`; normal paid handling then applies. Team conversion remains internal intake only.

The schedule and Imweb seat calculations explicitly exclude waiting records. Confirmation and existing Mac mini registration worker reject them even if step flags are forged. A stray pending/retry issuance job is quarantined as `review_required`, without changing the waiting registration or incrementing attempts, so it cannot starve normal paid work.

Full waiting phone data is available only through the existing manager-authorized dashboard. Generic MCP public results keep their existing masking policy. No mirror is a downstream action source.

## Source Changes

- CORE instructor page, app rendering/submit handlers, interface CSS and operating rules.
- Registration parser/transaction, waitlist helper, schedule, derived state, confirmation guard.
- Existing runtime contract, Imweb capacity helper, registration worker.
- Existing CORE MCP operation notes; no new tool or permission.
- Focused synthetic tests and existing CI coverage.

## Verification

- 59 backend tests: waitlist creation, normalized duplicate/concurrent calls, standard/team paid conversion, forged step guards, queue isolation/quarantine, paid schedule/confirmation regressions.
- 43 UI tests including waiting/paid/team flows and responsive Chromium at 320, 390, 768, 1440 px.
- 10 runtime contract / Imweb helper tests.
- 250 CORE MCP tests.
- Functions TypeScript noEmit, all physical codebase builds, boundary validation, data-source policy and JS syntax checks passed.
- Browser evidence: artifacts/core-instructor-waitlist-ui/report.json and four screenshots. No external network, browser errors, unintended callables, or remaining contexts.
- Independent review found orphan queue starvation; fixed with quarantine and repeat-run regression coverage.
- Read-only live page/assets returned HTTP 200 and still lack waitlist markers: local implementation is not an operational release.
- Local MCP suite initially lacked its dedicated dependency link; linking the existing runtime dependencies restored the full 250-test pass. No production service changed.

## Release Boundary

The user approved scoped Functions + CORE + runtime + rules deployment/commit/push in call_931a276f99df449b9a2bee1261e39ff5. Existing member records and sends remain untouched. Report deployed state only after independent release verification.

Affected detector conservatively includes all five codebases because CI workflow files changed. Runtime source changes are confined to app registration/dashboard and confirmation consumers in app/alimtalk; decide precise exported function targets on approved release. Deploy only from freshly synchronized clean main, preserve unrelated Hosting paths/config and live source guards, update the Mac mini runtime by fast-forward, verify live hashes/function revisions and CI, then report the actual release. No member-facing send is part of this task.
