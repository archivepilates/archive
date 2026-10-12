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
- Production source: `83e8e469cbd22be527064f61210d1ea1a73e333a`, promoted to `origin/main`; Hosting dry-run and deployment succeeded from clean main.
- Deployed only `hosting:archive-pilates` and `hosting:archive-pilates-in` in Firebase project `archive-pilates`.
- Live static verification: 48/48 Chromium/WebKit cases passed on `https://in.archivepilates.com/groupSurvey/`, all APIs mocked. Three live HTML bodies exactly matched source SHA-256 `dacd0edd2d7fe733e75cd75419b0a0b822b8fd47ba6694176bae3c6161483f97` and all three returned `no-cache, no-store, must-revalidate`.
- Other verified paths: `https://archive-pilates-in.web.app/groupSurvey/`, `https://archive-pilates.web.app/archivein/groupSurvey/`. Live release manifest reports production source `83e8e469`.
- GitHub source CI run `38217567131`: completed/success.
- No Functions, Firestore, StudioMate changes, real submission or additional Alimtalk dispatch.
- CORE operating-rule changes are unnecessary: presentation and static HTML caching only; no staff workflow, source selection, timing, exclusion or approval rule changes.
- All test contexts, browsers and fixture servers closed in finally. Screenshots and final synthetic/live test evidence: `/tmp/group-survey-responsive/`.
