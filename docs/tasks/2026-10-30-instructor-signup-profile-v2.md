# Signed Instructor Signup Profile Enrichment V2

- User authorized future completed-signup logic plus retroactive enrichment for instructor members with completed eformsign documents.
- Worktree: /Users/archivepilates/codex-worktrees/team-instructor-intake-20261029; branch codex/mini/instructor-signup-profile-v2-20261030; base d50c6830.
- Accounts: eformsign archivepilates@gmail.com, StudioMate studio 5330 owner session, Firestore archive-codex-operator for project archive-pilates.
- No member sends, contract creation/signing, ticket issuance, reservation/payment changes, IAM changes or new schedulers.
- Canonical completion source is the exact eformsign template/document/actual single recipient/provider completion timestamp, linked to native member identity. Old queue timestamps are not signature completion times.
- Existing eformsignInstructorMemberJobs remains completion source. Historical registration-free sources use done/baselineOnly/sendAllowed=false records, never fabricated registrations or historical sends. Member memos remain canonical and the existing studiomateMemoWriteJobs handles external copies.
- V2 keys: instructor_member_completion_<documentId> for one short completion note and field-enrichment job. Legacy detailed notes/jobs are preserved. Repeated v2 execution cannot append another completion note.
- DOB/address are independent blank-only fields. Explicit four-digit years only; six-digit century ambiguity, invalid dates, address uncertainty or conflicts preserve current values and record review outcomes. Short memo contains actual completion timestamp and document ID, never DOB/address/health/free-text answers.
- Native editor inspection confirmed DOB, readonly base-address selection and separate detail address. User approved only the base road/lot lookup in call_7c903e0b9f9748e49e31c05b2c0ab891. No name/phone/DOB/unit details enter the postcode query; suspicious prefixes and ambiguous results are held.
- Shared eformsign/StudioMate browser locks and existing periodic workers remain. Source completeness audit, dry-run target plans, sample write/readback, bounded bulk and independent final counts precede completion claims.
- File ownership: main v2 integration/writer/outbox/backfill; Noether future eform worker only; Pasteur pure policy/tests then integration tests; Laplace read-only full inventory script/tests. No subagent production writes/deploy/push.
- Complete inventory: 207 unique documents across 100/100/7 records; original template 103; first page independently revalidated. Source: private inventory-1793289410212.json, mode 0600, no individual answers in inventory.
- Tests cover actual v2 source/projection orchestration, blank-only field writes, live-source race, postcode exact/ambiguous results, completed/failed memo reuse and canonical queue transactions. Removed unused alternative proof/memo interfaces; production uses one actual source validator.
- V2 writes use native UI only, full-content memo readback, per-job lease validation and independent fresh profile comparison before save. Exact --signup-job-ids is capped at 10 and cannot fall through to unrelated jobs or holding projection on empty/malformed input.
- Affected Functions detector: no Functions codebases affected. Scoped CORE Hosting plan verified the existing 63-file version 0c80e2ae448446bd and changes only /rules/index.html; no app/config replacement.
- Pending: final individual source audit, runtime/Hosting release, actual bounded backfill and separate GET-only native readback. Preparation/test passes are not native write completion.
