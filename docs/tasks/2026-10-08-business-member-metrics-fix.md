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

## Approved Rollout Result

- Source commit: 2c50db12dcf1db7471e15a6bd971db92a1865b16, promoted/pushed to origin/main before deployment as required by the clean-main release guard.
- Clean main deploy checkout and archive-in-runtime fast-forwarded to the source commit. Existing loaded daily 23:00 LaunchAgent points to the updated runtime; no scheduler change or full revenue job was manually triggered.
- Scoped production recovery completed at 2026-10-08T08:43:15.033008Z; apply log: /Users/archivepilates/ArchiveIN/automation/reports/business-member-metrics/2026-10-08T08-43-11-277Z-apply.json.
- August 87/153/152, September 69/155/153, October 52/147/121, respectively sheet ticket members / booking users / attended members.
- Independent Firestore readTime comparison against the captured pre-apply document version confirmed all 17 unrelated fields and 19 historical rows unchanged; 22 metric months now present. Recursive key sorting avoids false differences from Firestore map key order.
- npm run deploy:archive-core-live completed: archive-pilates and archive-pilates-core Hosting only. No Functions, rules, source Sheet, StudioMate or member-facing changes.
- Initial responsive sidecar found a 320px SDK-error URL overflow. Scoped business hero paragraph wrapping fixed it; full 95-case local and live responsive suites passed afterwards.
- Deployed JavaScript/CSS match source exactly. Custom-domain/web.app canary passed for release source 2c50db12.
- Deployed renderer plus independently read canonical aggregates rendered the correct three counts for August/September/October at 320/1440px (6 checks); isolated DOM verification, not an authenticated operator-session test.
- CORE operating rules deployed. First natural 23:00 execution of this version remains pending observation, not claimed completed.
- Task-owned QA contexts, browser processes and local servers closed; user browser state preserved.
- Source-commit GitHub CI succeeded: https://github.com/archivepilates/archive/actions/runs/37751687659 (ARCHIVE IN Functions Affected Check). Deployment evidence is a separate documentation-only follow-up commit, so the live release manifest remains source commit 2c50db12.
