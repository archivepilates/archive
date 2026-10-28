# Instructor Registration Recovery

- Approval: repair one existing native ticket binding and one unsent instructor signup stage; prevent duplicate issuance and any redispatch of existing confirmation Alimtalk. Validate, deploy, commit and push.
- Scope: lane-specific worktree from origin/main 612d27e8. Preserve runtime's existing untracked scripts/__pycache__/. No member details, native IDs, order IDs or source payloads in Git.
- Canonical sources: exact current Imweb paid order and shared allocation; native StudioMate identity and complete ticket list; canonical registration/jobs/candidate/send ledgers; eformsign progress/completed document searches. workLanes reports are audit only.
- Native receipt: persist the accepted native ticket ID before independent page verification. Visibility/outer-card filtering and one read-only reload resolve transient duplicate presentations, but real duplicates remain blocked. Retained receipt/ID prevents another issuance when a card disappears. A missing/ambiguous response ID never becomes verified.
- Family progress: existing source/identity/approval/cancel/refund eligibility remains strict. Whole-family immutable checks complete before an operational-progress error is typed. Watcher does not revoke approval for that error; eform defers without consuming an attempt and rechecks in five minutes. Concurrent holds/claims/send markers are never overwritten.
- Exact-job executions scope stale-job inspection to the supplied job ID instead of touching unrelated jobs.
- Bounded recovery planner: exact actor/action/registration approval, fresh identity/ticket proof, current paid source externally checked by operator runner, same canonical job and immutable before-state audit. Native binding requires existing issued ticket/date/payment/issue-time match and never issues. Eform requires legacy pre-send failure, no accepted/ambiguous markers, fresh empty document searches and preserved prior confirmation evidence. Original attempts remain; one additional attempt is allowed.
- No API writes, native ticket/member changes, settings/IAM/schedule changes, extra scheduler, contract deletion or confirmation resend. Existing general contract maintenance hold remains unchanged.

## Verification Before Release

- Main instructor/imweb/dispatch Node suites: 976 passed; synthetic fixtures only. Recovery failure cases independently added/reviewed; no production fixtures used in tests.
- Runtime helper changes affect no Functions codebase; TypeScript confirmation guards are deliberately unchanged. Runtime and CORE Hosting publication only.
- Hosting/catalog validation and git diff whitespace check passed. Deployment/live results and exact scoped recovery remain pending until independently read back.
- Final expanded run: 1096 Node tests passed. Independent reviewers' final suites passed (266 recovery/send-boundary and 104 family/concurrency tests, subsets of the expanded run); no remaining blockers. Earlier local findings were fixed before release. No live test dispatch.
- Local CORE responsive QA passed 95 checks at 320, 390, 768, 1440 and 1920 widths. Registration release validator and live rollback guards passed.
- Exact native identity/ticket rechecks and empty eform progress/completed search proofs were obtained privately. Dry-run plans for the two approved canonical IDs are verified before any apply; fresh proofs are mandatory again after deployment.

## First Operational Readback And UI Follow-up

- Source 7315745329b7855f89dbcc0240bf82dcbcbe5aac promoted/main and runtime aligned. Both CORE Hosting sites deployed; 95 live responsive checks, canary and source SHA/rule readbacks passed. GitHub run 40642513674 succeeded. No Functions changes.
- At 15:14 KST, exact native identity/ticket proofs and current Imweb orders were reread. Approved existing-ticket binding applied without issuance; native job done and registration ticket verified. Existing confirmation was absent, so the normal ticket-verification trigger queued the first notice under its original canonical key, not a manual resend.
- The second target's exact eform job was restored at 15:14:50 KST, preserving attempts 3 and allowing one extra attempt. Its existing confirmation candidate and single send/message ID were unchanged; the general contract writer/reminder/maintenance hold matched the preapply snapshot.
- Existing regular eform worker at 15:15 stopped before final send at send_transition (Next timeout). No send markers/document/accepted result; this is an actual production preparation failure, not a provider-send failure. The failed attempt and original error remain in the immutable recovery audit.
- Draft-only live inspection showed the formatted currency string cleared the money field. Digits-only 70000 passed native validation to required 2/2 and the native Send document dialog; final send was never clicked in this inspection. New code validates actual operator values before Next, retains required 2/2 afterward and removes the legacy required-check callback override. Release validator now forbids that override.
- A second exact pre-send failure classification accepts only the structured Next timeout at the expected page/frame; all source, approval, document-absence, prior confirmation and no-send-marker checks still apply. The same canonical job will preserve its four attempts and receive only the next approved attempt, with a separate audit key.

## Native Completion Notice Readiness

- Source 21c06664 was deployed and CI run 40643565589 succeeded. The bounded fifth preparation attempt passed Next but stopped at the native send-dialog stage before recipient setup or final send. No accepted/document/send markers were created; do not call that attempt sent.
- Read-only inspection of the native Send handler established that the required-field completion notice deliberately suppresses Send until its completion-toast flag clears. Required 2/2 and network idle do not establish this readiness. No provider callback or validation state was altered.
- Added a read-only native-ready predicate (notice inactive, viewer loaded, button Send), then exactly one click. Removed unproven network-idle experiments. Exact source-extracted draft preparation reached the native recipient dialog without any recipient or final-send click, twice including the initial experimental predicate proof.
- Approved recovery classification now also recognizes only the structured send-dialog timeout at the loaded expected page and Send label. All fresh identity/ticket/order/document-absence/confirmation/no-effect proofs remain mandatory; attempts are retained. Actual recovery and independent result readback remain pending until executed.

## PDF Widget Commit

- Source 078af2d was deployed to both CORE sites, runtime aligned, live canary and responsive checks passed; CI run 40645597744 succeeded. The sixth bounded preparation stopped before Next because the PDF amount widget cleared a fill/Tab value. No recipient or send marker was created.
- Instructor input now uses the existing refund worker's native keyboard/Enter commit pattern instead of programmatic fill/Tab with swallowed commit errors. Both operator values and native Required 2/2 remain mandatory. Exact source preparation with this pattern reached the recipient dialog without any final send. Native completion-notice waiting remains in force.
- Only the structured operator-values mismatch at loaded expected page/Next can enter the already approved recovery planner, subject to all fresh proof and no-effect guards. It is not a provider-send failure and does not cause automatic attempt resets or general retries.

## Final Operational Readback

- Source 55a11e05367c1a080b7b52f1e7d39babae93ba2b promoted/main and runtime aligned. Untransformed source preparation passed twice with 3ms keyboard events and Enter, without recipient/final-send activity. Final regression run: 1,129 passed; focused independent review: 246 passed.
- At 15:50 KST, exact current paid order/family, native identity, complete native tickets and empty progress/completed document searches were refreshed. Same eform job restored with attempts 6 preserved and one additional preparation attempt; immutable phase-specific audit retained.
- At 15:50:59 KST the exact existing worker accepted one signup document, failures 0, waiting_completion. At 15:51:53 KST independent original progress-document search confirmed exactly one matching unique title/document ID and signature pending. No final delivery or signed/completed claim.
- Existing ticket-binding target is completed. New signup target is waiting_signature; its original confirmation candidate and exactly one historical send/message ID are unchanged. General membership contract maintenance hold compared deep-equal to the preapply snapshot. No new native issuance, external member changes, confirmation resend, settings/schedule/IAM/Functions/DNS changes.
- HTML report finalized with actual outcomes. Task-owned diagnostic browsers closed and profile locks released in finally; user browser sessions preserved. Existing runtime untracked scripts/__pycache__/ remains untouched.
- Final runtime source CI run 40646271787 succeeded. Post-recovery full native ticket readback at 15:53:38 KST again found exactly one original ticket for each target. HTML report rendered without overflow at 320, 390, 768 and 1440 widths. The final CORE rule text includes keyboard/Enter commit; final Hosting publication and canary are performed from clean main after this record commit.
