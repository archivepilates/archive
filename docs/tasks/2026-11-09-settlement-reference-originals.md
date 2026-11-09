# Settlement reference originals

- Branch: `codex/mini/settlement-reference-canonical-20261109`; base `f18b9abb`.
- Approval: operator selected the two existing native Google Sheets as sole active originals, requested redundant month-end-folder tables be removed, and required original updates as part of future new-instructor/renewed-contract work.
- Preserve original Sheet IDs, folder parents and monthly runner `.gsheet` pointers. No scheduler, calculation engine, finalization, member messaging or payment changes.

## Applied data operations

- Reconciled the current native instructor roster and signed-contract evidence. Updated the compensation original and copied the already-reviewed regular-pay conditions into its own tab. Contract effective-period limitations remain explicit; a subsequent renewal was not inferred.
- Updated the period-ticket reference from current published pricing and actual purchase amounts in October and November lesson exports; retained historical entries and source-row priority.
- Removed only public-reader link permission from the compensation Sheet. Preserved its owner. Existing delegated `home@archivepilates.com` monthly-reader scopes independently read both original IDs after the change and after the content update. No new IAM/OAuth permissions were granted.
- Existing two duplicate XLSX file IDs in the month-end folder were moved to recoverable Drive trash only after native originals and current-reader values were independently verified. Four pre-change backups remain separate from active sources. Existing finalized October statement hash remains unchanged.
- Sensitive contracts, rates, pay details, access receipts and change intents remain private under `~/ArchiveIN/operations/settlement-reference-update-20261109/`, not in Git or the public CORE page.

## Ongoing rule

- A new-instructor or signed-renewal task must reconcile identity, applicable period, group/private compensation and regular-pay inclusions; update only the original Sheet; and verify the existing reader before completion. Missing/conflicting terms require review. This is an operator/task rule, not a newly implemented background detector.
- No recalculation of finalized historical payroll, pay transfer, staff dispatch or contract signing is authorized by a reference change.

## Verification and release

- Live source edits, owner-only sharing, unchanged pointer IDs and recovery-only removal are verified in private receipts. Native current-reader values match the approved references and unchanged historical price entries.
- Implemented locally: CORE rules and project instructions updated together without compensation details. Reference/rate/split/finalization and release-scope checks: 99 passed. Initial missing development dependencies were installed without changing manifests or lock files; full CORE Hosting/catalog validation and whitespace checks now pass.
- Google-rendered group/private/pay-condition and price tabs were inspected under the existing `home@archivepilates.com` session. The share control independently displays owner-only access. Both task-owned spreadsheet tabs were closed.
- Hosting plan is scoped to `/rules/index.html`: 65 files total, other 64 hashes and the current site configuration retained. Plan baseline is `sites/archive-pilates-core/versions/66667551a3bf4ab6`. The release helper rejects a stale baseline, unrelated source edits, no-op manifests and previous unknown write intents. Release and CI remain pending until recorded below.
- No Functions were changed/deployed. Local checks used the available Node 25 runtime; the unchanged Functions dependency installation warned that its declared runtime is Node 22. Existing dependency-audit warnings were not auto-fixed in this documentation/source-policy scope.

## Released and independently verified

- Source commit `588275e4119fc8770de79c15ac6cd51ebd94900e` was pushed on the feature branch and promoted fast-forward to `origin/main`. The active runtime checkout fast-forwarded cleanly to that source; no worker restart was needed because calculation code and schedule did not change.
- CORE Hosting version `sites/archive-pilates-core/versions/f42cc3af3748c2de`, release `sites/archive-pilates-core/releases/1794225612119000`, verified at 2026-11-09T12:00:14.631Z. Only `/rules/index.html` changed; all other 64 file hashes and site configuration remain the live baseline. Independent custom-domain and Firebase-domain byte hashes match source.
- Live policy rows were checked at 320/390/768/1440px: all three rows and the page had no horizontal overflow. Temporary viewport override was reset and the task-owned live-rule tab was closed.
- Exact-source main CI: Functions Affected Check `42613346567` and CORE MCP Check `42613346694` succeeded, including affected-functions, rules-ui and security jobs. Feature-branch Functions Affected Check `42613298829` also succeeded. No queued/running/failing runs remain for this source.
- After duplicate-file trash, the existing settlement reader independently re-read the same native Sheet IDs and verified the current values, unchanged legacy price rows, and unchanged finalized October statement. No regeneration, pay transfer, staff dispatch, native contract edit, IAM or scheduler change occurred.
