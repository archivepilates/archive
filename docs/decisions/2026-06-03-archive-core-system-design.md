# ARCHIVE CORE System Design

Decision date: 2026-06-03

## Decision

ARCHIVE CORE becomes the operator-only web platform for ARCHIVE PILATES operations.

It is not a teacher app and not a member-facing reservation app. Teachers continue to use the StudioMate teacher app. ARCHIVE IN is reserved for a future member/reservation product when ARCHIVE PILATES moves reservation operations to its own site.

## Product Role

```txt
StudioMate
= reservation, attendance, and payment input system

ARCHIVE CORE
= operator data platform, automation control center, business dashboard, and communication approval system

Notion
= operating rules and decisions

Google Drive
= source Excel files and settlement originals

Gmail
= automation reports and failure alerts
```

## First Navigation

```txt
Home
Members
Lessons
Private
Messages
Automation
Business
Imports
Rules
Settings
```

## Database Direction

ARCHIVE CORE separates current operation records, historical usage records, payment/ticket ledgers, communication records, computed summaries, and source import logs.

Core source collections:

```txt
members
memberAliases
memberTickets
memberPaymentEvents
lessonOccurrences
reservations
memberUsageEvents
communicationCandidates
communicationApprovals
communicationSends
communicationDedupeKeys
operatorActions
sourceImports
automationRuns
dataQualityIssues
auditLogs
staffs
```

Computed/read-model collections:

```txt
privateSessionLedger
automationStatus
memberSummaries
memberPrivateStats
memberRevenueStats
memberTicketStats
memberAttendanceStats
dailyOperationSnapshots
businessSnapshots
member360Cards
```

## Data Flow

```txt
StudioMate Excel download
-> sourceImports
-> normalization and identity matching
-> members / tickets / payments / reservations / usageEvents
-> privateSessionLedger / member summaries / business snapshots
-> ARCHIVE CORE UI
-> operatorActions / communicationCandidates
-> approval
-> external action
-> communicationSends / auditLogs
```

## Safety Rules

- Do not switch Alimtalk source selection while rebuilding the database.
- Do not use `workLanes` as a member-facing source.
- Do not use name-only member matching for writes.
- Do not collapse all StudioMate Excel concepts into `bookings`.
- Keep source imports traceable before applying normalized records.
- Keep existing Alimtalk send logs and dedupe keys connected during migration.

## First Build Scope

The first build scope is an operator web-console shell at `/core`, plus shared contracts and documents.

No production data source is changed in this phase.

## 2026-06-03 Implementation Update

`/core` is now a read-only operator console foundation rather than a static-only sketch.

It reads these Firestore surfaces when the current browser session has permission:

```txt
workLanes/archive-core-transition
automationStatus
sourceImports
dataQualityIssues
```

The page intentionally falls back to static safe states when Firestore auth is not available. This allows local and live smoke tests without accidentally changing production data.

The shared contracts now include minimum document shapes for:

```txt
ArchiveCoreSourceImportDocument
ArchiveCoreAutomationStatusDocument
ArchiveCoreDataQualityIssueDocument
ArchiveCoreMemberUsageEventDocument
ArchiveCorePrivateSessionLedgerDocument
```

## Migration Boundary

ARCHIVE CORE can display and compare source data, but it must not become the target source for member-facing sends or StudioMate/Contacts writes until a separate shadow-compare review approves the source switch.

Required before any production source switch:

```txt
1. dry-run count report
2. sample member verification
3. duplicate canonical key report
4. old-source versus CORE-source target comparison
5. operator approval
6. limited apply
7. send/write log verification
```

## 2026-06-03 Page Structure Update

ARCHIVE CORE is no longer treated as a single long page.

The page structure is:

```txt
/
/members/
/lessons/
/private/
/messages/
/automation/
/business/
/imports/
/rules/
/settings/
```

The main page is a menu summary dashboard. Each menu has a separate detail page.

The same `core/` folder is designed to work in both contexts:

```txt
https://archive-pilates.web.app/core/
https://core.archivepilates.com/
```

Prepared Firebase Hosting site:

```txt
site: archive-pilates-core
public: core
default URL: https://archive-pilates-core.web.app
intended custom domain: core.archivepilates.com
```

Current custom domain state:

```txt
core.archivepilates.com -> Firebase Hosting site archive-pilates-core
hostState: HOST_ACTIVE
ownershipState: OWNERSHIP_ACTIVE
certState: CERT_ACTIVE
```

Firebase Auth authorized domains include:

```txt
archive-pilates-core.web.app
core.archivepilates.com
```

## 2026-06-03 Business Page Update

The Business page now reads `dashboardSnapshots/current` after operator login and displays a CORE-style summary of:

```txt
monthly total revenue
monthly lesson revenue
lesson margin rate
group attendance rate
monthly revenue trend
instructor lesson revenue TOP
ticket deduction revenue TOP
```

This is read-only and does not replace the existing `/dashboard` source or calculations yet.

## 2026-06-04 Command Thread And Worktree Update

ARCHIVE CORE uses one main command thread for requirements, priority, final judgment, and release approval.

Feature-specific threads, Spark tasks, and Subagents must work in lane-specific worktrees and report back to the main command thread before their output becomes project direction.

Decision record:

```txt
docs/decisions/2026-06-04-archive-core-command-thread-worktrees.md
```

Current lane worktrees:

```txt
archive-core-transition   command / integration
archive-core-ui           UI / routing / responsive operator UX
archive-core-data         member data / imports / read models
archive-core-functions    Functions / contracts / rules / APIs
archive-alimtalk          Kakao Alimtalk
studiomate-automation     StudioMate Excel and Playwright automation
archive-core-docs         Notion and operating documents
```

## 2026-06-03 Four-Step Operator Data Update

ARCHIVE CORE now has read-only operator data surfaces for the first four operating steps:

```txt
1. operator login gate and Firebase Auth custom-domain setup
2. Home / Business dashboard bridge
3. Imports source and data quality page
4. Members / Private read-model pages
```

Current read sources:

```txt
Business: dashboardSnapshots/current
Imports: sourceImports, dataQualityIssues
Members: members
Private: privateLessonChartRequests, privateLessonChartRecords, memberUsageEvents, privateSessionLedger
```

The `members` collection is treated as a mirror/read-model. It can support operator review and GPT/business analysis, but it is not approved as an external send/write source.

The `memberUsageEvents` and `privateSessionLedger` collections are visible in the Private page, but are not yet populated. Private lesson chart sends and StudioMate-related writes continue to use existing canonical sources until the usage-history pipeline passes dry-run verification.

Browser write access remains blocked for all newly exposed CORE collections.

## 2026-06-05 Sample Ledger Apply

ARCHIVE CORE now has a limited sample apply for the member-usage and private-session ledger structure.

Applied sample member ids:

```txt
1985970
2047962
3030691
3045390
3574953
4081797
```

Applied CORE-only collections:

```txt
memberUsageEvents
memberTickets
memberPaymentEvents
lessonOccurrences
reservations
privateSessionLedger
sourceImports
automationStatus
dataQualityIssues
```

This does not change the operating source for Alimtalk, StudioMate writes, Google Contacts, reservation decisions, or attendance/memo actions.

The transition script intentionally blocks unsafe expansion:

```txt
dry-run default
apply requires --apply --confirm-archive-core-transition
full apply requires --all --allow-full-apply
```

Current sample finding:

```txt
memberUsageEvents: 2,530
privateSessionLedger: 307
bookings missing from sample usage history: 2,013
duplicate canonical usage rows normalized: 90
status conflict loose match: 1
```

Decision:

- ARCHIVE CORE can use `memberUsageEvents` and `privateSessionLedger` as the candidate data model for operator review.
- They are not yet approved as send/write source collections.
- The next required gate is current StudioMate member-usage re-download and full shadow compare.

Reason:

The available normalized member usage history source is from `2026-05-27`. It proves the model works, but it is stale on `2026-06-05`. For example, 방지숙 currently shows cumulative private round `178` ending at `2026-05-28`, while later manually reviewed Excel evidence exists. Therefore the model should be refreshed before full production switching.

## 2026-06-04 Member Read-Model Apply

ARCHIVE CORE member-centered data has now been generated as a read-model mirror.

Applied collections:

```txt
members/{memberId}
members/{memberId}/summary/current
members/{memberId}/tickets/{ticketId}
members/{memberId}/purchases/{purchaseId}
members/{memberId}/bookings/{bookingId}
members/{memberId}/memos/{memoId}
members/{memberId}/alimtalkLogs/{logId}
members/{memberId}/tags/{tagId}
member360Cards/{memberId}
```

Verified counts:

```txt
members: 852
member360Cards: 852
```

Sample verification:

```txt
members/3045390: 방지숙, totalRevenue 11200000
members/3045390/purchases: 15
members/3045390/bookings: 52
members/3045390/summary/current: exists
member360Cards/3045390: exists
```

Source inputs used:

```txt
memberProfiles: 348
bookings: 13779
memberMemos: 1858
memberTags: 330
alimtalkCandidates: 1895
alimtalkSends: 481
ticketPurchases: 2903
```

This does not change the source-of-truth policy. Existing feature collections remain canonical for sends, writes, attendance, reservations, memos, and Alimtalk decisions. `members` and `member360Cards` are approved only for operator review, ARCHIVE CORE display, GPT/business analysis, and sample verification.

The separate StudioMate member usage booking backfill remains pending. The 2026-06-04 dry-run found:

```txt
selectedRows: 65521
bookingCreates: 53191
bookingUpdates: 683
lectureCreates: 11579
plannedWrites: 65453
memberNoMatch: 0
```

Because this would update canonical `bookings` and `lectures`, it must not be applied as a background mirror job. Required next step is sample verification and explicit approval for limited apply.

## 2026-06-04 Step 1-4 UI/Data Decision

ARCHIVE CORE can now expose member-centered detail and business insight screens before the database source switch is approved, with one strict boundary:

```txt
display/read-model use: allowed
external send/write target selection: not allowed
```

Implemented read-only screens:

```txt
Members list -> member detail
Private chart health -> private ledger migration status
Automation -> status document dashboard
Imports -> source and quality dashboard
Business -> dashboardSnapshots plus member360 revenue insight
```

Member detail reads:

```txt
members/{memberId}
member360Cards/{memberId}
members/{memberId}/summary/current
members/{memberId}/tickets
members/{memberId}/purchases
members/{memberId}/bookings
members/{memberId}/memos
members/{memberId}/alimtalkLogs
members/{memberId}/tags
```

The Private page may show the usage-history backfill dry-run result, but `memberUsageEvents` and `privateSessionLedger` remain pending until limited apply is separately approved. The existing private chart request and Alimtalk flows must not switch to the new ledger during this UI step.

## 2026-06-04 Automation Status / Source Imports / Quality Issues

ARCHIVE CORE now receives operational records from the StudioMate Excel sync pipeline.

Connected writer surfaces:

```txt
scripts/run-studiomate-excel-emergency-mode.mjs
-> automationStatus/studiomate-excel-sync

scripts/emergency-import-studiomate-member-excel.mjs
-> sourceImports
-> dataQualityIssues

scripts/emergency-import-studiomate-reservation-excel.mjs
-> sourceImports
-> dataQualityIssues

scripts/emergency-import-studiomate-deleted-class-excel.mjs
-> sourceImports
```

This is operational metadata only. It does not switch Alimtalk target selection, Contacts writes, StudioMate memo writes, attendance writes, or canonical booking writes to ARCHIVE CORE.

Important bug found during verification:

```txt
reservation latest-file discovery accepted 수업매출 sales files
```

Decision:

```txt
reservation import must require reservation/booking filenames
reservation import must exclude sales/매출 paths
wrong sourceImports from that dry-run must be superseded, not deleted
```

Verified dry-run from the actual LaunchAgent path:

```txt
/Users/archivepilates/codex-worktrees/archivein-live-setup
member sourceImportId: e44c00be488037c6f10da266adc04649
reservation sourceImportId: 846f95c7f856f6d57639e9db78459c9c
automationStatus/studiomate-excel-sync: healthy
```
