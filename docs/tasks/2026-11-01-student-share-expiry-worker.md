# Instructor student-share expiry worker

## Approval and scope
- User approved moving automatic 40-day revocation to a dedicated Mac mini worker and terminating the Codex repeated e-2 task.
- Base origin/main 8004e9b7; branch codex/mini/student-share-expiry-worker-20261101, worktree ~/codex-worktrees/student-share-expiry-worker-20261101. Runtime remains ~/dev/archive-in-runtime.
- Existing five canonical student-share ledgers stay authoritative. No new grants, new source collections, member messages, video/product changes, permission broadening, first-grant resets or historical replay.

## Implementation
- Existing e261017-access CLI behavior retained; expose a callable runner with the same shared member-group and per-team locks, durable intent, purchase/staff protection and independent native removal verification.
- New local wrapper validates all five source sets and original grant evidence. Every 60-second wake checks private local timestamps only. Before due: zero provider calls. When due: the existing --apply expiry path, without --adopt-verified-grants.
- Unknown intent/result_unknown blocks writes; unchanged failures deduplicate internal reports. Source changes invalidate backoff. Protected staff/purchase rights recheck daily or at an earlier next expiry; original 960-hour periods never restart.
- Private worker checkpoint is operational health/backoff only, not a permission source. It is stored under ~/ArchiveIN/automation/student-share-expiry with owner-only configuration/state. No identities in stdout.
- Installer is prepare/read-only, install/disabled, then activate only after e-2 is deleted or paused. Existing LaunchAgents are not modified. New LaunchAgent is a replacement for the removed Codex lifecycle schedule, not an additional concurrent writer.
- CORE rules-only Hosting target studentShareExpiry; no Functions source or deployment. Workflow guard changes conservatively affect five codebases in CI only.

## Pre-cutover verification
- Read-only native run on 2026-10-31T23:40:39.647Z: five sources, 25 not_due, zero permission writes; all canonical ledgers byte-identical.
- Private current ledgers: 25 active adopted grants, no unknown removals, no expiry currently due; first upcoming expiry 2026-11-27T00:28:25.421Z, latest 2026-12-08T06:27:21.277Z. These are recorded expiry clocks, not proof of future revocation.
- Existing A/B notices independently inspected read-only by sidecar: completion notices 5/5 delivered each; legacy B signup notice delivered, one attempt. No approved unsent notice found. E channel-required hold remains unapproved and must not turn into an automatic send.
- B historical signup followup has stale opaque pending rows despite five grants. Main independently matched all five historical paired-session identities to current grants at 2026-10-31T23:45:25.385Z: three original matches, late-signup proof and approved operator-identity repair. Unique current grants5, formerly pending identities covered2, uncovered0, extra0. Opaque pending-row hash derivation was not reconstructed; those old audit rows remain untouched and are not selected as new work. No signup/notice work is stranded by the replacement.
- Tests and UI: final combined scoped run565/565, zero failures/skips; original policy/expiry149, new wrapper54 and release/install5 included. Note fits320/390/768/1440 with screenshots, no external requests and browser/context closed. Syntax, plist lint, diff and direct CORE Hosting guard pass. No package/lock/Functions source change.
- Root npm ci reports 14 existing dependency advisories (9 moderate,4 high,1 critical). Root package and lock are unchanged by this task; no unsafe bulk audit fix. Not a new worker dependency or a claim that the entire repository is audit-clean.
- Independent review found notification recovery/dedup holes before deployment. Main added persisted-notice reconciliation before every normal return and clears alert episode identity after verified recovery; regression coverage is included in final count.

## Remaining release steps
- Independent new-worker review; final combined tests; source commit/main promotion; rules-only deploy and independent live hash verification; runtime fast-forward and disabled service installation; verify all pending ownership; delete e-2 using automation tool; activate worker; verify natural background no-op with all permission clocks unchanged; CI, final docs/status.
- Do not retire e-2 based only on a prepared file or installed-disabled status. Do not call this operationally complete until the replacement is active and separately verified.

## Actual cutover and independent evidence
- Source0da35046bd9cf11c38f95740c4078b84165d0a22 promoted/pushedmain, runtime fast-forward adopted. Installed com.archive.student-share-expiry disabled; first natural launch exited0 with remoteCalls0 before legacy deletion.
- Official Codex MCP automation_update deleted e-2. Old prompt retained owner-only under worker directory for audit, not as an active scheduler. Activation gate verified the old automation file absent; enabled at2026-10-31T23:46:46.740Z (2026-11-01 08:46KST).
- Natural background execution at23:47:15.419Z: not_due,active25,due0,zero provider calls,exit0. Independent verification at23:47:35.993Z confirmed oldscheduleabsent,allfivecanonicalledgerhashesunchanged,workerlockreleased,installed60sinterval. No member send or permission removal.
- CORE rules-only release version80dde81bc85e5907 / release1793490385468000. Independent GET verification at23:47:18.480Z:63paths,only/rules/index.htmlchanged,62unchanged,configpreserved,bothcustom/FirebaseURLsHTTP200 andSHA256e5e4f7a40adff03229b741324a2edb4125c5cbe34f9b296a2de173e175f9071d.
- Runtime wrapper/install tests59/59passed. Implementation CI CORE MCP Check41253895016 passed. Initial Functions Check41253895174 failed only because the new UI test was included before any Chromium install;545otherchecks inthatstagepassed. Moved UI to the existing CORE browser-equipped job, retained worker/release tests in Functions, added CI-order regression. No runtime behavior changed for that correction; follow-up CI recorded below.
- b36947ed9c29c0c44607b341f949fdc0929e2a4b promoted/pushedmain and fast-forward adopted by runtime. No new Hosting release/reinstall needed because production assets/scripts unchanged. Natural no-op at23:49:15.727Z again confirmed all25not_due and five ledger hashes unchanged. Final combined tests566/566, no failures/skips, after adding the CI-order guard.
- Main independently re-read final CI at2026-10-31T23:52:20Z: Functions Affected Check https://github.com/archivepilates/archive/actions/runs/41254080467 success; CORE MCP security+rules-ui https://github.com/archivepilates/archive/actions/runs/41254080567 success, both exact b36947ed. No skipped UI coverage; UI moved after Chromium installation.
- Final state: e-2 deleted; replacement enabled and natural-run verified; rules-only Hosting independently verified; no permission clock/group changes, messages, new grants, Functions deployment or IAM/secret changes. Source/main clean after final documentation commit; runtime preserves only preexisting untracked scripts/__pycache__/. UI browser/context, worker and team locks were released; no task-owned native browser was opened.
- Future real revocations are not yet due and were not forced for a test. Retained unapproved E notice and historical opaque B followup rows remain audit-only, not silently marked sent or used as write targets. Existing root dependency advisories remain an explicit unrelated limitation.
