# Instructor lesson Notion schedule automation

## Scope and state

- Implementation commit `f09ccd0` promoted to origin/main and deployed on 2026-09-26 with prior seat-count commit `6151f38`.
- Corrected the October Notion application examples from September 19/20 to October 24/25 and read back the saved text.
- Initial implementation did not change member records. Subsequent explicit deployment/send approval covered three October registrations. A separate explicit approval resumed the stalled new-member registration after live identity verification; no duplicate member or class booking was created.

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

## Approved deployment and recovery results

- functions-app and functions-alimtalk deployed successfully. Other three codebases were built/validated but not deployed: the broad affected detector conservatively includes them for manifest/package edits; no shared runtime behavior changed.
- ARCHIVE IN primary/custom Hosting deployed. Live HTML/ICS verified for October 24 on both domains, and the full ARCHIVE IN release canary passed.
- GitHub Actions Functions Affected Check run `36247583400` passed.
- Final provider evidence, operator follow-up and scoped recovery details: `docs/reports/2026-09-26-instructor-lesson-confirmation-release.html`.
- CORE operating rules updated for the final Hosting release. No Firestore rules/index change was deployed.
