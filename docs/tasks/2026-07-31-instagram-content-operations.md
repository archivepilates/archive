# Instagram Content Operations

## Goal

Operate `archivepilates_official` as the ARCHIVE PILATES official channel for brand content, Myeongji operations, promotions, and local acquisition without unattended or duplicate publishing.

## Implemented Locally

- Separate `functions-social` codebase and affected-only mapping
- Draft, review, approval, hold, scheduled publish, log, and insight contracts
- Manager-only Firestore reads and callable writes
- ARCHIVE CORE `/core/content/` dashboard
- Content navigation across all CORE pages
- Duplicate publish key and ambiguous publish no-retry guard
- Responsive and release guard coverage
- ARCHIVE CORE operating-rule update

## Pending Before Go Live

- Connect the Meta professional account and store scoped secrets
- Confirm public HTTPS media hosting or add an approved media library
- Deploy Functions, Firestore rules, and Hosting
- Run one operator-approved canary post
- Confirm Meta publish history, Firestore log, live permalink, and insight sync

The first deployment may use `not-configured` Secret sentinel values. In that state, ARCHIVE CORE draft and review surfaces are available, while approval, scheduled publishing, and insights remain blocked until real scoped Meta credentials replace the sentinels and the account check passes.

## Content Direction

- Brand and method
- Myeongji studio operations
- Promotion and consultation conversion
- People and community

## Recommended Cadence

- Monday: local operations or the week's schedule
- Wednesday: movement method Reel
- Friday: people, community, consultation, or a restrained promotion
- Monthly review: follows per reach, profile visits, link taps, and consultation conversion

Automation may prepare drafts, but publication always requires operator approval.
Do not create the recurring Codex draft job until the Meta account and public media source have passed a live canary.
