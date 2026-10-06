# Sequence Studio Cloud Persistence

- Worktree: `/Users/archivepilates/codex-worktrees/core-sequence-firestore`
- Branch: `codex/mini/core-sequence-firestore`
- Base: `fe139a1765bda02c16ee983520bb1f5bf78857c2` from fresh `origin/main`.
- Scope: operator-owned Firestore notes/images, compressed images, revision transactions, explicit legacy import, JSON/PDF preservation, CORE operating rules.
- No member, booking, message, StudioMate, Drive, Notion, payment, or Functions changes.

## Checks

- Syntax: app.js, sequence-store.js, studio inline script, live verifier passed.
- `node scripts/test-sequence-firestore-rules.mjs` using isolated Java21 and Firestore emulator: 206 passed; no production data or credentials. Includes 90-image atomic commit/cleanup.
- `npm run verify:archive-core-responsive`: 95 route/viewport combinations passed.
- `npm run validate:archive-core-hosting`: passed, generated Alimtalk catalog fingerprint refreshed solely because app.js changed.
- `node scripts/validate-live-release-rollback-guards.mjs`: passed.
- `node scripts/validate-data-source-policy.mjs`: passed.
- `npm run validate:ticket-liability-price`: 5 passed.
- Dedicated cloud browser suite: 11/11 passed with actual adapter/UI and isolated fake Auth/Firestore SDK, including two contexts and noisy photo compression; independent Korean PDF extraction/rasterization passed. This is not a production Firestore proof.
- Synthetic live verifier: passed against `https://core.archivepilates.com` using real Auth and Firestore. Confirmed text/image persistence, two contexts, conflict rejection, copy recovery, and image deletion. Exact temporary UID was removed from Auth and both Firestore collections; browser closed.
- Deployed asset suite: 11/11 passed against live files with isolated SDK fixtures. All tested controls reached 44px height; no horizontal/text/media overflow.
- Independent public GET check: release and asset hashes matched `753f9434c4058d75fecba8738d5c7d2ca3f22aee`.
- GitHub Actions run `37440388838`: success.

## Release Plan

Commit only this lane, promote fast-forward to main, deploy Firestore rules/indexes and CORE Hosting using archive-codex-operator. Verify CORE release/assets, rerun isolated UI QA against deployed files, then actual Auth/Firestore synthetic manager test across two isolated contexts. Delete exact test-owned Firestore documents and Auth identity in finally; no real operator or member touched. Confirm GitHub CI, main/runtime alignment, clean Git state, closed task browsers, and stopped emulator.

## Release Evidence

- Feature commit: `753f9434c4058d75fecba8738d5c7d2ca3f22aee`, promoted/pushed to main and deployed from clean main.
- Firebase dry-run and actual scoped deploy succeeded. No Functions or legacy Hosting site deployed.
- Existing remote-only index and two field overrides were preserved; no `--force` or deletion used.
- New indexes initially stayed CREATING, so the live readiness test waited rather than claiming success. Both reached READY; actual browser save then passed. Verifier now waits for index availability before creating the synthetic Auth identity and records readiness diagnostics without credentials.
- Operating-rule verification summary and test-runner correction are published in the follow-up commit; application storage behavior is unchanged.

## Recovery / Known Limits

Existing localStorage is retained unchanged until operator explicitly imports. Unsaved cloud failures are shown and navigation warns; JSON export protects pending text when needed. Same-account sharing only. List/export cover recent 100 active notes. Original full-resolution images are not retained. Old immutable image variants are retained until note deletion to protect concurrent readers. No hourly server polling, Drive copies, or Storage buckets are introduced.
