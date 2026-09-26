# Instructor lesson Notion schedule automation

## Scope and state

- Implemented locally; not deployed or pushed in this task.
- Corrected the October Notion application examples from September 19/20 to October 24/25 and read back the saved text.
- No member records, tickets, reservations, Alimtalk candidates or sends changed.

## Source contract

- Schedule source: immediate monthly child pages of Notion Myongji page `198d49eae4bf8001895bf0378d58c641`, titled `N월 아카이브 강사레슨`.
- Read the official year/month heading, ARCHIVE METHOD heading with course/date/weekday/time, daily capacity, and A/B team table. Application examples are not schedule sources.
- No separate Notion database or new production collection. Parsed page content has an in-process five-minute cache; it is not an independent source of truth.
- Member-facing targets remain canonical `instructorLessonRegistrations` with verified StudioMate ticket evidence. Notion supplies schedule fields only, never member selection.
- Candidate payload records a JSON source snapshot, page ID, edit timestamp and semantic fingerprint for audit.
- Stable dynamic management key: `notion-YYMMDD`; existing September keys remain unchanged. Existing phone/date/action dedupe and staff/test restrictions remain in force.
- Before send, validate current registration, date, receiver, ticket evidence, schedule fields and calendar. Missing/ambiguous/mismatched source blocks sending. Schedule changes require operator review/requeue.
- Public calendar endpoint exposes only the approved schedule fields under the fixed source parent, not arbitrary Notion page content.

## Verification

- Registration contract/unit suite passed: 10 JavaScript and 20 TypeScript tests.
- TypeScript typecheck, all physical Functions codebase builds and boundary validation passed.
- Read-only live Notion resolver returned October 24 and 25, 2026; 13:00-15:10 KST; capacity 10 per date; matching A/B sessions.
- Calendar UTC conversion verified: 04:00-06:10 UTC on each date.
- Regression suite checks source binding and snapshot preservation.
- Local rendered calendar checked with Playwright at 320/390/768/1440 pixels: no horizontal overflow, official logo loaded, 48px link target. Screenshots are local ignored outputs; all task browser contexts closed.

## Deployment handoff

- Required targets: functions-app (calendar/callable/ticket trigger), functions-alimtalk (send-time source verification), ARCHIVE IN Hosting (calendar rewrites), ARCHIVE CORE Hosting (operating rules and prior seat-count changes).
- NOTION_TOKEN must be bound on the new endpoint, callable and ticket trigger; queue workers already bind it.
- Deploy and verify the calendar endpoint/Hosting routes before unblocking pending registrations. Do not mark pending Kim Jiwoo confirmation as sent without provider evidence.
- After approved deployment, independently verify live calendar HTML/ICS and perform an authorized pending-registration retry with canonical duplicate checks.
