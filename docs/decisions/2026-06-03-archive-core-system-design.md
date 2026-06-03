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
