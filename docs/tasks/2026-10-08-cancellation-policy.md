# Holiday And Weekend Cancellation Policy

- Requested rule: public-holiday, Saturday and Sunday classes may be cancelled until 21:00 on the previous calendar day, starting with classes dated 2026-10-09.
- Current applied scope: ordinary group classes. Private and instructor-lesson exceptions are preserved pending clarification; do not silently overwrite them.
- StudioMate account: owner session, browser profile scoped to ARCHIVE PILATES. No bookings, member tickets, payments or contracts were created or sent.
- StudioMate class list is the authoritative enforcement surface. Updated only cancellation deadlines, not reservation/change/closure deadlines.
- Changed 6 holiday classes on 10-09 and 9 Sunday classes on 10-11/18/25. Preserved 12 already-correct Saturday classes on 10-10/17/24/31.
- Readback: all 27 ordinary group classes match previous-day 21:00. Weekend list was reloaded and filtered again after saving. Query extended through 12-31; no November/December weekend group classes were present. Ten instructor-lesson rows were excluded.
- StudioMate facility-use term 21282 (new-member template 608) updated and reopened after save. Existing created/sent/signed contracts were not modified. Re-enrollment purchase-condition term refers to the accompanying terms without a conflicting fixed cancellation deadline.
- Notion reservation-system table and StudioMate usage guide updated and read back. Current living-guide and October notice already contain the new rule.
- ARCHIVE IN memberSignup facility wording and ARCHIVE CORE rules updated together. Existing private wording preserved.
- Remaining discrepancy: 10-09 private class at 11:30 uses a 24-hour deadline, while facility copy says previous-day 21:00. No private policy change is inferred from the unanswered scope question.
- Historical 2024 form exports are historical evidence, not rewritten signed contracts or confirmed current masters.
- No new polling automation. Staff must verify deadlines after creating/copying future classes.
- Release approval: user explicitly approved Hosting deployment, scoped commit and push. Hosting only: archive-pilates, archive-pilates-in and archive-pilates-core, Firebase archive-pilates; no Functions/rules deployment. The in custom domain has its own Hosting site and must receive the same memberSignup copy as the default-site compatibility path.
- Existing production branch guard requires origin/main to equal deployment HEAD. Validate first, promote scoped commit, deploy, verify live surfaces, and confirm remote/local identity afterward.
- Verification commands: validate:archive-core-hosting, validate:live-release-rollback-guards, validate:ticket-liability-price, validate:onsite-welcome, verify:archive-core-responsive, Hosting dry-run and live canary.
- Report: docs/reports/2026-10-08-cancellation-policy.html. Final release hash and live verification are recorded in the chat execution evidence.

## 2026-10-11 Scope Clarification

- User-confirmed scope: the previous-calendar-day 21:00 cancellation rule applies ONLY to ordinary group classes on public holidays, Saturdays and Sundays, starting with classes dated 2026-10-09. Private and instructor lessons are excluded; their separate rules are unchanged. Ordinary weekday group classes retain the six-hour cutoff.
- The 2026-10-08 execution record above is preserved as historical evidence. Its pending/unanswered scope question is resolved by this confirmation, not by extending the rule to private or instructor lessons. The existing 27-class readback and excluded instructor-lesson evidence have not been rerun in this patch.
- Still unresolved: the recorded 2026-10-09 11:30 private class has a StudioMate 24-hour cutoff while the facility wording says previous-day 21:00. This scope confirmation does not select a private cutoff or authorize changing either surface; the existing private wording remains unchanged pending separate confirmation.
- Local patch only: clarify the existing ARCHIVE CORE cancellation rule and index, and the ARCHIVE IN memberSignup facility wording. No mail/health rules, existing signed contracts, historical reports, native settings, external terms, notices or Notion pages are changed.
- Deployment status: pending main-chat review and a separately approved release. The 2026-10-08 release approval above is historical and is not authorization to commit, deploy, push or write externally for this patch.
- Verification scope: narrow local static checks and diff review only; no live settings or external copy verification. Next action: main chat reviews the patch, checks external exclusion wording and handles the separate private-cutoff discrepancy.
