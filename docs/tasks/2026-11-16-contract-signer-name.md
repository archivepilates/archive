# Contract Signer Name Separation

- User decision: remove trailing member-management digits from signer names for newly authored StudioMate membership and renewal contracts. Keep native member names/IDs/phones, existing signed or requested contracts, canonical jobs, claims and schedules unchanged. Separate deployment approval permits validation, runtime adoption, scoped CORE rules publication, commit and push; it does not authorize existing-contract cancellation or resend.
- Worktree: `~/codex-worktrees/contract-signer-name-20261116`; branch `codex/mini/contract-signer-name-20261116`; base `d4acc775`.
- Private native evidence is retained outside Git under the dated contract-name audit directory. Existing signed and requested documents used different signer names for the same exact member/phone; no member authentication was impersonated or attempted.

## Implementation

- Strip only trailing ASCII/full-width decimal management suffixes for contract `contractor_name` and `basic.required.name`. Preserve interior digits and punctuation; block empty/invalid names. Never use the stripped name as a member selector.
- Native prepared-request binding uses the exact authored contract name. Do not normalize a mismatched provider response into acceptance.
- Canonical `memberName` remains the original display name. New verified writer outcomes persist `contractSignerName` and versioned policy separately. Existing sources without both explicit fields retain their original contract authentication names.
- Reminder history and contract/DOM name checks use the explicit contract name, while current-member identity checks retain exact original display name, ID and full phone. Existing reminder/claim fingerprints and unknown outcomes are not reset.
- Welcome/profile logic retains its original display-name comparisons. Completion and provider signature still require exact contract DOM/provider names and native member/ticket identities.

## Verification And Release

- Focused initial writer/processor/name/reminder suite: 387 synthetic checks passed with zero failures/skips. No real contract, provider request or member send occurred.
- Full regression, independent review, runtime adoption, scoped CORE publication and CI results are recorded below only after observed. No production Functions handler or schema/rules deployment is planned for local-runtime-only changes.
- Existing-contract correction remains a separate approval-dependent operation; do not treat release of this policy as correction of a previously requested contract.
- Full Node 22 checks passed: 1,354 membership/native contract tests, 629 welcome tests and 250 reminder tests; zero failures/skips. TypeScript no-emit, CORE Hosting/catalog validation and live-release rollback guards passed. The actual-source rules release scope/argument probes passed nine cases without network/writes.
- The isolated new-rule fixture passed 320/390/768/1440 widths with no horizontal overflow and verified browser closure. This is a static text-layout check, not authenticated production UI or member authentication proof.
- Two bounded auxiliary-review requests returned acknowledgments only, with no substantive evidence. They were closed and are not counted as independent review. Main-thread source/diff review and source-level regression checks own the release decision.
