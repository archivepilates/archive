# ARCHIVE CORE Data Quality Issue Dedupe

Decision date: 2026-06-05

## Problem

`dataQualityIssues` created one new open `missing_phone` issue for every hourly member Excel import.

Recent `sourceImports` documents from the automation worktree also did not always include `studioId`.

## Cause

The live automation helper included `sourceImportIds` and `sourcePaths` in the data quality issue id seed.

That made the same underlying issue change id whenever a new Excel file was imported.

## Decision

Use a stable `issueKey` based on:

```txt
studioId
issueType
memberId
memberName
title
```

Always write `studioId` to:

```txt
sourceImports
automationStatus
dataQualityIssues
```

Member Excel rows with missing phone are logged as `info`, because they are excluded from member/contact matching and external execution sources.

## Current Cleanup

Existing duplicate open `missing_phone` issues were resolved and superseded by canonical issue:

```txt
4a25e5a708cb7edfce997a0fe26117fe
```
