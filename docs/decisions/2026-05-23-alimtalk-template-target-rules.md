# ARCHIVE IN Alimtalk Template Target Rules

Date: 2026-05-23

## Decision

ARCHIVE IN Alimtalk target rules must be managed per template/candidate type.

The source of truth in code is:

- `firebase/kangsain-functions/functions/src/alimtalk/templateTargetRules.ts`

## Current Rules

| Type | Target | Main Exclusions |
| --- | --- | --- |
| `new_member` | New StudioMate member with phone and active lesson ticket, within the new-member window | no phone, no active lesson ticket, non-lesson product, excluded member, duplicate welcome send |
| `private_survey` | First upcoming private booking from today through next Sunday | prior private survey in the last year, prior private attendance, group/instructor lesson, no phone |
| `group_survey` | First upcoming group booking from today through next Sunday | prior group survey in the last year, prior group attendance, private/instructor lesson, too-late same-day booking, no phone, button URL over 100 chars |
| `ticket_expiring` | Active group ticket expiring within 14 days and no other active lesson ticket | private/instructor/non-lesson ticket, another active ticket, duplicate ticket-period send in 30 days |
| `remaining_low` | Active group ticket with 1-4 remaining sessions and no other active lesson ticket | private/instructor/non-lesson ticket, another active ticket, duplicate ticket-count send in 30 days |
| `private_count_low` | Active private ticket with 1-3 remaining sessions and no other active lesson ticket | group/instructor/non-lesson ticket, another active ticket, duplicate private-count send in 30 days |
| `private_ticket_expiring` | Active private ticket expiring within 14 days and no other active lesson ticket | group/instructor/non-lesson ticket, another active ticket, duplicate private-period send in 30 days |
| `instructor_lesson_material` | Instructor lesson booking with material management number | non-instructor lesson, missing material number, duplicate material/date send, button URL over 100 chars |

## SOLAPI Button URL Limit

- SOLAPI web-link button URLs must be 100 characters or fewer after variable substitution.
- Staff survey detail buttons use `https://in.archivepilates.com/privateSurveyResponseView?id=#{설문ID}&token=#{접근토큰}`.
- Group survey request buttons use `https://in.archivepilates.com/groupSurvey?id=#{설문ID}&token=#{접근토큰}`.
- Instructor lesson material buttons use `https://in.archivepilates.com/method/#{관리번호}`.
- If the rendered URL is longer than 100 characters, ARCHIVE IN blocks sending before calling SOLAPI.

## Operational Check

- SOLAPI template approval is still checked before queueing/sending.
- Large daily batches of 10 or more sendable candidates still require email approval.
- On 2026-05-23, two remaining stale group survey candidates were manually marked `skipped` after re-check.
