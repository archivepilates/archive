# Member inquiry intake lane — design only

- Lane: member-inquiry-intake; proposed workLanes/member-inquiry-intake, no Firestore record created.
- Worktree: /Users/archivepilates/.codex/worktrees/member-inquiry-intake/archive-in-runtime
- Branch: codex/mini/member-inquiry-intake, based on freshly fetched origin/main.
- Allowed files: this note and docs/reports/2026-11-09-member-inquiry-intake.html. No runtime code changes.
- Scope: six-category member inquiry intake, policy presentation, staff assignment, administrator approval, bounded execution after native readback.
- User named separate latest Notion rules; live-fetched holding, reservation, fixed-booking manual, November pricing and transfer-of-ownership documents. Do not treat ownership transfer as ticket conversion.
- Resolved 2026-11-09: operator directly confirmed current fixed reservations cannot be canceled or changed. Use this rule in the intake design and member guidance; do not use the older once-monthly-before-opening exception for automated eligibility. Exception review may be requested but does not itself authorize mutation. This confirms the current rule, not a retrospective change to historic bookings. Older Notion manual and live CORE text remain unchanged.
- Open issue: no ticket-conversion formula in searched sources; renewal special-price slug could not be resolved. Do not invent policy or price eligibility.
- MCP observed: coreRenewalWorkflowUpdate updates existing cases only; operatorApproveHoldingNotice approves notices only. Generic ordinary reservation/ticket/holding changes and CORE rule saves unsupported in catalog.
- Existing source references: services/archive-core-mcp/src/plans.mjs:67-129; src/actions.mjs:96-107,243-246; src/direct.mjs:222-237; scripts/lib/holding-notice-operator-dispatch.mjs; scripts/lib/member-operation-service.mjs. Source implementation is not a live deployment claim.
- Reuse approval plan hash, current canonical source, durable actionKey and unknown-result no-replay guards. Do not reuse retired onsiteWelcomeRequest POST (410).
- Provisional data only in workLanes after approval; promotion requires canonical intake source, queue destination, identity and duplicate keys, readers, forbidden actions, retention, dry-run report and verification. No member-facing decisions from workLanes or member360 mirrors.
- CORE operating-rule draft is included in report, explicitly pending/unimplemented/undeployed. No generic MCP rule-save endpoint exists; no production policy or deployment authorization received. Actual CORE update remains pending with initial implementation.
- No member source, contact, health record or credential copied. No messages, business writes, database writes, schedulers, deploy, commit or push.
- Validation: inline JavaScript syntax, DOM target existence, absence of network/persistent-storage calls, and git diff --check passed. Independent read-only requirements/source-boundary review found no material errors. Browser local-file navigation was denied by the browser URL security policy; no alternate transport or browser workaround was attempted. Responsive visual and live interaction QA therefore remain unverified. No task-owned tab was opened by that denied navigation.

- Follow-up: report and both booking/fixed demo guidance updated after the operator confirmation. No runtime function, Notion, CORE live page, member reservation or deployed policy changed. CORE draft now records confirmed policy with implementation/deployment pending. Narrow copy-only update checked with JavaScript parsing and stale-text assertions; browser visual QA remains unavailable under the previously observed local-file URL restriction.

## Category-first objective-choice revision

- User requested a scoreboard-style category home and minimal writing. The same HTML now opens on six category tiles; operator design notes are collapsed below the member flow.
- Flow: category -> conditional objective choices/date-time pickers -> name/phone -> masked sample receipt. Additional free text is optional, collapsed and capped at 200 characters.
- Six categories use radio/checkbox options; only change/new-fixed requests reveal their relevant scheduling questions. Unknown/consultation paths avoid forcing invented member/ticket/booking details.
- The real service must populate canonical ticket/booking choices only after identity verification. No fake booking inventory or entitlement is shown.
- Current fixed cancellation/change prohibition retained. Fixed exceptions route to administrator review, not execution.
- Changed files remain the report and this task note only. No runtime, CORE live rules, Notion, deployment, external write or persistence changes.
- Validation passed: inline JS syntax, six tiles/category schemas, objective/date input schema, four fixed/free routing cases, disconnected-mode guard and git diff --check. Independent static interaction/domain/mobile-CSS review found no material defect.
- Responsive screenshot/browser interaction checks at 320/390/tablet/desktop remain unverified because the previously observed browser URL security policy prohibited this local-file navigation; no workaround was attempted. No task-owned browser surfaces were opened in this revision.

## Actual intake implementation — 2D category UI

- User authorized implementing actual submission, staff review and administrator approval with 2D graphics; proposed help.archivepilates.com. No production release/DNS/privacy/access scope was yet confirmed.
- Implemented help/ with 6 SVG category illustrations, objective conditional forms, consent, receipt recovery and unknown-result stable-key retries; CORE /inquiries/ with current Firebase access, assigned-only staff queue, exact-plan manager decisions and separate manual result recording.
- Added server functions memberInquiryApi/memberInquiryStaff, strict choice validation, distributed rate counters, transaction audit+command dedupe, sorted review hashes and expiration access denial.
- Proposed 90-day privacy notice and dedicated TTL groups; default production setting remains absent/closed until explicit privacy/retention/promotion readiness flags and staffing setup.
- Source CORE operating rule updated as implemented/verified locally/pending deployment. No live CORE/Notion, production Firestore, staff permissions or DNS mutation.
- All 82 tests, all five physical Functions builds, function-boundary check, CORE Hosting guard, schema/contract freshness and diff check passed. Runtime contract packaging was corrected to a generated local module checked by prepare; no sibling runtime import remains.
- Browser E2E used atomic in-memory DB and fake test roles only. Synthetic receipt progressed received -> awaiting_approval -> approved, revisions1..3 with3events. No external execution or notification. Screenshots at320/390/768/1366 for home/detail/member/staff/manager showed no horizontal overflow. Previous design-only file-navigation limitation is superseded for this new HTTP application's local QA; no file URL workaround was used.
- Task-owned tabs4,5,6,7,8 closed; viewport reset; both temporary HTTP test-server sessions stopped and final port53212 confirmed closed. Existing user tabs preserved.
- Private synthetic evidence: /Users/archivepilates/ArchiveIN/operations/2026-11-09-member-inquiry-build/verification.json and PNGs. No real member data involved.
- Scope decisions/evidence: docs/decisions/2026-11-09-member-inquiry-intake-promotion.md. Pending: actual staff names/default assignment, privacy90-day approval, help existing A-record reuse and release approval, live auth/DB/TTL/domain verification. Node22 runtime test remains a release check; local Node25.9.0 completed current checks.


## 2026-11-10 approved release
- Operator approved all current same-studio staff read access, 90-day retention, deployment and help.archivepilates.com domain transition. Manager approval remains unchanged. Non-manager mutation remains assigned-only; unassigned requests can be claimed. No default assignee is invented.
- Release preparation uses archive-codex-operator@archive-pilates.iam.gserviceaccount.com for project archive-pilates; no member messages or native booking/ticket changes are included.

- Release CI found the new mixed read/write inquiry callable missing explicit MCP coverage. It is deliberately excluded from generic MCP business actions until separate read and prepare/execute contracts exist; staff use the approved CORE UI. Added the documented exclusion, preserved callable coverage checks, and reran the relevant check. Added the inquiry link to the current-staff navigation while preserving the private-record landing page.

## Production verification 2026-11-10
- Source promoted and pushed through bece4b7f. Guarded clean-main release completed five detected Functions codebases, CORE Hosting and isolated help Hosting. Provider: 110/110 ACTIVE. GitHub CORE MCP and affected checks successful.
- Four dedicated TTL fields ACTIVE/index exemptions applied; list composite READY. Rules deployed. Unlisted existing indexes and field overrides preserved.
- Actual public UI -> Firestore -> authenticated CORE operator -> claim/review/approve/complete -> independent read: synthetic receipt mi_e5b26e55a01d619828fb91764b22f4cc, revision5, events5, commands4, exactly one synthetic request, exact90day expiry. No external action/message.
- Same-studio current-staff read scope approved; assigned-only mutations and manager decisions retained. No bulk staff flags granted.
- Cloudflare official home account signed in with native autofill. Added exact help CNAME and ACME TXT DNS-only. No independent old help A existed; wildcard preserved. NS/1.1.1.1/8.8.8.8 verified. Custom TLS pending; verified working site https://archive-pilates-help.web.app/.
- Private proof: operations/2026-11-10-member-inquiry-release. Self-contained result: docs/reports/2026-11-10-member-inquiry-release.html. No duplicate scheduler created. Remaining: custom-domain certificate and normal HTTPS verification.
