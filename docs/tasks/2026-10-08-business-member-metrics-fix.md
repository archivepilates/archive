# ARCHIVE CORE Business Member Metrics

## Scope And Workspace

- Worktree: /Users/archivepilates/codex-worktrees/business-member-metrics-audit-20261008
- Branch: codex/mini/business-member-metrics-audit-20261008
- Base: origin/main bb68a2c1
- User requested missing metric logic correction and explicitly approved the deployment set on 2026-10-08 (배포세트 진행해줘), including scoped metric recovery, commit, main promotion, deployment, verification and push.
- Canonical aggregate destination: dashboardSnapshots/current.월별회원지표.
- Existing ticket-member source remains 아카이브 DB / 월별 유효회원; booking and attendance counts remain canonical bookings with existing exclusions.
- These aggregates are display-only. They must not select Alimtalk, contract, ticket, reservation or other member-facing writes.

## Implemented Locally

- Independent member metric step in the existing daily 23:00 runner, including revenue failure paths.
- Default bounded refresh: missing summary months plus current/previous KST month; future sheet projections excluded.
- Live sheet count validated against its distinct-phone member list. Missing columns/months, duplicate months and mismatches stop before mutation.
- No cached ticket count fallback and no missing-to-zero conversion. Empty booking query stops before mutation.
- Existing booking deduplication/status/instructor-lesson exclusion semantics unchanged.
- Scoped Firestore field masks, updateTime concurrency precondition, conflict reread/retry, newer-result protection and readback verification.
- Revenue EXPORT fallback no longer performs the historical full booking scan or overwrites member metric fields.
- CORE missing/null/invalid counts show 집계 필요; valid zero remains zero; selected-month connection warning updates.
- CORE operating-rule implementation is included in the approved Hosting release; actual deployment evidence is recorded below after verification.
- Generated Alimtalk catalog refreshed only for app.js fingerprint parity; no send policy or template settings changed.

## Evidence

- Production-read-only dry run: /Users/archivepilates/ArchiveIN/automation/reports/business-member-metrics/2026-10-08T08-26-41-118Z-dry-run.json.
- August: ticket sheet 87, booking members 153, attended members 152, raw booking docs 1910.
- September: ticket sheet 69, booking members 155, attended members 153, raw booking docs 1873.
- October (in progress): ticket sheet 52, booking members 147, attended members 121, raw booking docs 1003 at query time.
- Ticket counts match the source sheet and its distinct-phone list. This does not independently prove current live inventory or upstream month-end completeness. Do not relabel them as freshly reconstructed live ticket counts.
- Historical metric rows preserved: 19. Raw booking counts are not unique member counts.
- Unit/presentation tests: node --test scripts/tests/business-member-metrics*.test.mjs (22 passed).
- Existing CORE workflow regressions: npm run test:core-operator-workflow (52 + 26 tests passed).
- Hosting source validator passed; focused responsive fixture: 320/390/768/1440, complete/missing states, 8 screenshots, no page overflow or clipped metric text.
- Browser QA uses synthetic data only, external requests blocked, contexts/browser closed in finally.
- Review found field-mask quoting, HTTP 400 FAILED_PRECONDITION handling, revenue-independent recent months and older-run protection gaps; all addressed with regression cases.

## Approved Rollout Checklist

1. Final test/diff review, scoped commit and main promotion per release guards.
2. Update clean main deployment checkout and runtime; do not copy dirty source files into runtime.
3. CORE Hosting only; no Functions/schema/rules deployment required.
4. Scoped --months=2026-08,2026-09,2026-10 --apply, guarded readback; verify other snapshot fields and 19 historical rows unchanged.
5. Verify live source plus all three months/card values, CORE rules and runtime daily runner linkage; check GitHub CI and clean status.
6. Record actual rollout result. Natural 23:00 run remains a separate future observation; do not claim it has already executed.

No production data, notifications, StudioMate, Contacts, scheduler settings or source Sheets were changed during local implementation.
