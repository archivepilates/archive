# Recommended Meal Survey Submit

- Workspace: `/Users/archivepilates/codex-worktrees/meal-survey-submit-20261020`
- Branch: `codex/mini/meal-survey-submit-20261020`
- Scope: survey submit feedback only; preserve existing responses and meal plans.
- Requested: retain the existing submitted survey and fix the submit button.
- Production writes, regeneration, publication and member sends: none.
- Release: user approved Hosting deployment, scoped commit and push on 2026-10-20.
- Deploy scope: archive-pilates-in and archive-pilates-core, plus archive-pilates
  compatibility paths. No Functions, Firestore rules or indexes deployment.

## Behavior

- Keep required and allergy/consent validation; reject whitespace-only required text.
- Show missing-field summary and focus links, clear resolved errors while editing.
- Block concurrent submit clicks.
- Keep every input after transport/API/protocol errors; focus the visible error.
- Show completion only on `{ok:true,status:submitted}`; accept duplicate confirmation.
- Previously submitted links stay read-only; endpoint and payload unchanged.

## Verification

- `node --test scripts/tests/recommended-meal-submit.test.mjs`: 16 passed.
- `node scripts/validate-recommended-meal-program.mjs`: 11-file static guard passed.
- `git diff --check`: passed.
- Independent focused source review: no additional confirmed defects.
- CUA isolated HTTP mock: missing-field focus, non-first radio choices, live error
  clearing, zero invalid POST, 503 response with input retention, manual retry
  with duplicate success confirmation. Two mock POSTs total, no production POST.
- Responsive checks: 320, 390, 768, 1440px; no horizontal overflow; submit 52px high.
- Canonical response, draft and report SHA-256 plus Firestore updateTime compared
  before/after: all three unchanged. No raw survey answers copied into this task.
- Temporary browser tab and mock server closed; existing user tab preserved.

## Remaining

- Hosting deployment and live verification completed; see release evidence below.
- Prior audit's expired queue display and backend publication-race/name-match
  findings are outside this submit-only patch and remain unmodified.

## Release Evidence

- Released source: `0f6b639c0d92e7cca59ec334293a02d0d6014580`, promoted to
  `origin/main`, deployed from clean local `main`.
- Firebase project `archive-pilates`, existing `archive-codex-operator` service
  account; root firebase.json; Hosting sites archive-pilates, archive-pilates-in,
  archive-pilates-core all reported release complete. No database/Functions deploy.
- Rollback, onsite-welcome and CORE Hosting guards passed. Worktree dependencies
  were linked to the existing runtime before rerunning the initially missing-module
  local checks; no lockfiles or dependency versions changed.
- Canonical and compatibility survey/rules HTML hashes exactly matched local
  source. Both release manifests matched the released source commit.
- `validate-live-release-canary.mjs --surface archivein --surface core --sha
  0f6b639c0d92e7cca59ec334293a02d0d6014580`: 36 checks passed.
- Live browser smoke: missing-link error visible and focused, form remained
  hidden, new validation summary present, console errors absent. No live POST.
- Response/draft/report fingerprints and Firestore updateTimes remained unchanged
  after Hosting deployment. No member data mutations or message sends.
- GitHub Actions `39394121572`: completed/success. Operational error emails were
  not needed; there was no production failure.
- Verification tab closed; original user tabs preserved. No test server remained.
- Post-release docs-only commit records this result; its SHA is intentionally not
  the deployed application source SHA and does not require another Hosting deploy.
