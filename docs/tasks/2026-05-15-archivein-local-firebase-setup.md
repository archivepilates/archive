# ArchiveIN Local Firebase Setup

Date: 2026-05-15

## Working Copy

- Worktree: `/Users/archivepilates/codex-worktrees/archivein-live-setup`
- Branch: `codex/mini/archivein-live-setup`
- Base: `origin/archivein-canonical-20260514`
- Remote: `https://github.com/archivepilates/archive.git`

## Local Build Status

Installed dependencies:

- root package: `npm ci`
- Functions package: `npm ci` in `firebase/kangsain-functions/functions`

Verified builds:

```bash
npm run build:dashboard
npm --prefix firebase/kangsain-functions/functions run build
```

Both passed.

Note: the Functions package declares Node.js `22`, while the current shell used Node.js `24.14.1`, so npm showed an engine warning during install. The TypeScript build still passed.

## Firebase and GCP Access

Target project:

```text
archive-pilates
```

Service account:

```text
archive-codex-operator@archive-pilates.iam.gserviceaccount.com
```

Local key path:

```text
/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json
```

The key file exists locally with owner-only permissions and contains a service-account private key for `archive-pilates`.

`gcloud` was configured to:

```text
account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com
project=archive-pilates
```

Verified read access:

- `gcloud projects describe archive-pilates`
- `gcloud functions list --project archive-pilates --regions asia-northeast3`
- `gcloud secrets list --project archive-pilates`
- Firebase CLI Web App list using a service-account access token
- Firebase CLI Hosting site list using a service-account access token

## Firebase CLI Auth Note

The global Firebase CLI had a stale signed-in user token for `home@archivepilates.com`, so direct Firebase CLI commands failed with a reauth message.

Use the service-account helper before Firebase CLI work:

```bash
source scripts/use-archivein-firebase-service-account.sh
firebase --token "$FIREBASE_TOKEN" --project archive-pilates <command>
```

This avoids relying on the stale user token. The helper does not store the generated access token; it only exports a fresh token in the current shell.

## Confirmed Live Backend Surface

All listed Functions in `asia-northeast3` were ACTIVE at setup time, including:

- `getInstructorHome`
- `loginStaffWithPin`
- `setupStaffPinWithTempCode`
- `submitBookingAttendance`
- `submitMemberMemo`
- `registerFcmToken`
- `adminSyncLecturesRange`
- `adminPollManagerNotices`
- scheduled sync, write queue, contact sync, Alimtalk queue, dashboard sync, and reminder functions

Secret names visible in Secret Manager included:

- `STUDIOMATE_LOGIN_ID`
- `STUDIOMATE_LOGIN_PASSWORD`
- `MANAGER_LOGIN_ID`
- `MANAGER_LOGIN_PASSWORD`
- `GOOGLE_DWD_SERVICE_ACCOUNT_JSON`
- `SOLAPI_API_KEY`
- `SOLAPI_API_SECRET`
- `SOLAPI_PFID`
- `DASHBOARD_SYNC_KEY`

Secret values were not printed.

## Not Done

- No deploy was run.
- No `git push` was run.
- No Secret Manager writes were run.
- No Firestore writes were run.
- No StudioMate, Google Contacts, or SOLAPI write/send action was run.
