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
- Synthetic live verifier: pending deployment and final run.

## Release Plan

Commit only this lane, promote fast-forward to main, deploy Firestore rules/indexes and CORE Hosting using archive-codex-operator. Verify CORE release/assets, rerun isolated UI QA against deployed files, then actual Auth/Firestore synthetic manager test across two isolated contexts. Delete exact test-owned Firestore documents and Auth identity in finally; no real operator or member touched. Confirm GitHub CI, main/runtime alignment, clean Git state, closed task browsers, and stopped emulator.

## Recovery / Known Limits

Existing localStorage is retained unchanged until operator explicitly imports. Unsaved cloud failures are shown and navigation warns; JSON export protects pending text when needed. Same-account sharing only. List/export cover recent 100 active notes. Original full-resolution images are not retained. Old immutable image variants are retained until note deletion to protect concurrent readers. No hourly server polling, Drive copies, or Storage buckets are introduced.
