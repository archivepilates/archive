# ARCHIVE IN dashboard DB automation

Date: 2026-05-22

## Decision

Simplify the settlement/dashboard data path:

```text
StudioMate Playwright download
  -> 수업매출원본데이터 Excel + 수강권매출원본데이터 Excel
  -> 아카이브 DB
  -> current-month daily settlement preview
  -> Firebase dashboard snapshot
  -> ARCHIVE IN dashboard
```

`아카이브 정산 자동화` is no longer a required middle step for daily dashboard updates.

## Safety rule

The refined settlement calculation must not change accidentally.

For that reason, the first automation only updates sheets that can be rebuilt from source sales Excel without changing instructor settlement pay:

- `수강권매출_원본`
- `수강권매출_Master`
- `회원별누적매출`
- `수강권분석_Master`
- `매출일일누적`
- `정산대장_DailyPreview`
- `강사통계_DailyPreview`

The automation does not overwrite these protected sheets:

- `정산대장_Master`
- `강사통계_Long`

Those protected sheets should only be automated after a regression check proves that rebuilt monthly settlement output matches the existing `월별정산백업` values.

The daily preview sheets are rebuilt only for months that are still in progress. They use the existing settlement rate history from `정산대장_Master` where possible, so the dashboard can show current-month instructor and margin cards without replacing the final month-end settlement books.

## Daily cumulative revenue

The new `매출일일누적` sheet is built from `수강권매출원본데이터` using `결제일` and `결제금액합계`.

Columns:

- `기준일`
- `기준월`
- `일매출`
- `월누적매출`
- `전월동일일누적`
- `전년동월동일일누적`

Comparison values use cumulative revenue through the same day in the previous month and the same date in the previous year. If the comparison month has fewer days, the comparison date is clamped to that month end.

For the selected/current month, dates with no payment rows are still written through today with `일매출 = 0` and the prior cumulative total. This keeps the dashboard line continuous for day-1-through-today reporting.

Current-month sales are not written into `수강권매출_Master`, because that sheet feeds the existing month-end settlement summary cards. Current-month revenue should appear through `매출일일누적`; closed-month summary cards stay based on month-end settlement data.

## Current-month settlement preview

`대시보드_EXPORT` is generated from the monthly settlement spreadsheet and is the dashboard sync source.
The previous local `정산대장_DailyPreview` / `강사통계_DailyPreview` calculation path is deprecated.

The preview is for dashboard visibility only:

- it can change every day until month end
- it is pushed into Firebase for the current dashboard month
- it does not overwrite `정산대장_Master`
- it does not overwrite `강사통계_Long`
- month-end settlement remains the accounting source of truth until the preview logic is regression-checked against the legacy backup output

## Commands

Dry run:

```bash
npm run run:archive-dashboard-sales-daily
```

Download current month sales Excel, apply to `아카이브 DB`, and then trigger Firebase dashboard sync:

```bash
npm run create:dashboard-export -- --month=2026-05 --apply
npm run sync:archive-dashboard-db -- --month=2026-05 --apply
```

Re-run DB/Firebase sync without downloading again:

```bash
npm run run:archive-dashboard-sales-daily -- --apply --skip-download --month=2026-05
```

Inspect one month in dry-run only:

```bash
npm run run:archive-dashboard-sales-daily -- --month=2026-04
```

Do not use `--month` with `--apply` for the master dashboard DB. Applying only one month would replace master tabs with partial data, so the script blocks that combination unless `--allow-partial-overwrite` is passed intentionally for recovery work.

Reports are written to:

```text
~/ArchiveIN/automation/reports/archive-dashboard-sales-daily/
~/ArchiveIN/automation/reports/archive-dashboard-db-sync/
```

Sales Excel downloads are staged under:

```text
~/ArchiveIN/automation/downloads/sales/
```

Then copied to:

```text
~/Library/CloudStorage/GoogleDrive-home@archivepilates.com/내 드라이브/아카이브 정산/수업매출원본데이터/
~/Library/CloudStorage/GoogleDrive-home@archivepilates.com/내 드라이브/아카이브 정산/수강권매출원본데이터/
```

When multiple files exist for the same month, the DB sync uses the newest source file per month by default to avoid duplicate monthly revenue.

The ticket-sales Excel is exported through the StudioMate sales screen. The lesson-sales screen currently renders the export data client-side, so the automation uses the same logged-in StudioMate browser session to call the StudioMate fixed-lecture sales report API and writes the response into the legacy Excel column format before copying it to Drive.

## Scheduler

LaunchAgent template:

```text
firebase/kangsain-functions/macmini-studiomate/com.archive.archive-dashboard-db-sync.plist
```

Default schedule: every day at 23:00 KST.

The plist runs:

```bash
node scripts/run-archive-dashboard-sales-daily.mjs --apply --sync-firebase
```

The plist is committed as a template and is loaded on the Mac mini after a successful dry run and one confirmed apply run.

Current installed LaunchAgent path:

```text
~/Library/LaunchAgents/com.archive.archive-dashboard-db-sync.plist
```

## Google authorization

The Sheets write uses the Archive Codex service account with domain-wide delegation to `home@archivepilates.com`.

The Firebase dashboard sync endpoint is not public; the sync script calls it with a service-account identity token, then patches the Firestore `dashboardSnapshots/current` document directly with current-month `summary`, `강사별`, `강사통계`, `월별강사평균인원`, and `매출일일누적` preview rows. The current deployed Cloud Function still owns the closed-month sheet sync; the Mac mini job owns the current-month preview patch.

## Login and safety

The downloader uses the persistent Mac mini StudioMate browser profile:

```text
~/ArchiveIN/automation/browser-profile
```

If StudioMate shows login, captcha, verification, or a changed export UI, the job stops. It does not bypass security screens.
