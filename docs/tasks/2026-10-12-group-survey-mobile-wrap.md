# Group First-Class Survey Mobile Wrapping

- Worktree: `/Users/archivepilates/codex-worktrees/group-survey-mobile-wrap`
- Branch: `codex/mini/group-survey-mobile-wrap`
- User approval: scoped validation, Hosting deployment, commit and push.
- Source: `archivein/groupSurvey/index.html`; the form opened from the current approved group first-class Alimtalk.

## Changes

- Full-width introduction below the title and logo, with separate sentences.
- Korean word-level wrapping for title phrases, legends, options, text fields and member badges; zero-minimum flexible grid tracks.
- Stable 44px option targets and accessible textarea labels.
- Explicit hidden-form handling for invalid links and already submitted forms.
- Suppress a missing lesson time represented by `-` instead of displaying an empty badge.
- Scoped no-cache headers for the group survey on both Hosting paths.
- Question text, option values, POST payload, tokens, API, member data and send rules remain unchanged.

## Validation And Release

- Inline JavaScript syntax, original option values and submission payload: passed.
- Existing onsite-welcome retirement and CORE Hosting guards: passed.
- Responsive Chromium/WebKit fixture verification: 48/48 cases passed at 320/390/768/1440px; screenshots reviewed. Invalid, rejected and submitted links, Other validation, mocked retry and duplicate submission included. No production API calls.
- Functions predeploy safety tests: 20/20 passed; existing live rollback guards and configuration-only diff checks passed.
- Live static verification: pending deployment.
- Deploy only `hosting:archive-pilates` and `hosting:archive-pilates-in` in Firebase project `archive-pilates` from clean main.
- No Functions, Firestore, StudioMate changes, real submission or additional Alimtalk dispatch.
- CORE operating-rule changes are unnecessary: presentation and static HTML caching only; no staff workflow, source selection, timing, exclusion or approval rule changes.
- Close all task-owned browsers and fixture servers after verification.
