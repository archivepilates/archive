# ARCHIVE IN Legacy Retirement

Decision date: 2026-06-23

## Decision

ARCHIVE IN is no longer the operator workspace.
Operator work should happen in ARCHIVE CORE.

ARCHIVE IN remains as a compatibility host for active member/staff links:

- private survey;
- private chart;
- private lesson reports;
- onsite welcome;
- member signup;
- short links;
- method/material links;
- legacy `/archivein/api/*` endpoints.

## Changed

- `archivein/index.html` is now a legacy notice page that points operators to ARCHIVE CORE.
- The old monolithic operator app source was moved to `docs/legacy/archivein-operator-app-2026-06-23.html`.
- The ARCHIVE IN service worker now only clears old `archive-in-*` caches and does not cache app screens.
- `/kangsain/**` and `/dashboard/**` now redirect to ARCHIVE CORE.
- `/archive-method/**` now redirects to `/method/`.
- Old `dashboard`, `kangsain`, and `archive-method` source folders were moved under `docs/legacy/` so they are not deployed as active programs.

## Must Stay Active

Do not remove or rewrite these without a separate compatibility plan:

- `https://in.archivepilates.com/privateSurvey/`
- `https://in.archivepilates.com/private-chart/`
- `https://in.archivepilates.com/onsiteWelcome/`
- `https://in.archivepilates.com/memberSignup/`
- `https://in.archivepilates.com/s/**`
- `https://in.archivepilates.com/api/privateSurveySubmit`
- `https://in.archivepilates.com/api/privateChart`
- `https://in.archivepilates.com/api/privateLessonReport`
- `https://in.archivepilates.com/api/memberSignupContract`
- `https://in.archivepilates.com/api/onsiteWelcomeRequest`
- `/archivein/api/*` legacy equivalents on `archive-pilates.web.app`

## Deferred Cleanup Candidates

These should be audited before deletion because they look like generated artifacts or stale samples:

- `archivein/private-reports/`
- `archivein/private-surveys/`
- `archivein/pricing/`

## Verification Rule

Before deploy, verify:

- legacy root shows the retirement notice;
- active paths still return 200;
- short link fallback still returns expected 404 for missing links;
- Functions boundary validation still passes;
- Firebase Hosting dry-run succeeds.

After deploy, run the same live URL checks against:

- `https://archive-pilates.web.app/archivein/`
- `https://in.archivepilates.com/`
- `https://in.archivepilates.com/privateSurvey/`
- `https://in.archivepilates.com/private-chart/`
- `https://in.archivepilates.com/onsiteWelcome/`
- `https://in.archivepilates.com/memberSignup/`
- `https://in.archivepilates.com/s/not-existing-legacy-check`
