# LG ThinQ air conditioner control

- Scope: operator-only ARCHIVE CORE menu, official LG ThinQ Connect REST API, no StudioMate or member automation changes.
- Worktree: `/Users/archivepilates/codex-worktrees/lg-thinq-control-20261021`.
- Branch: `codex/mini/lg-thinq-control-20261021`; base `8bac515a` (`origin/main`, fetched 2026-10-21).
- Backend ownership: `src/climate/**`, three callables in `exports/app.ts`; physical codebase `functions-app`.
- Frontend ownership: `core/climate/index.html`, `core/assets/climate.{js,css}`; main integrates nav and auth-gated bootstrap in `app.js`.
- No production deploy, Secret Manager/IAM write, member mutation, LG control POST, scheduler or MQTT subscription is authorized/performed in this implementation turn. User later requested a grouped all-off control; its implementation and synthetic validation do not authorize a real-device test.

## Design / promotion contract

- Canonical device source: LG `GET /devices`, `/devices/{id}/profile`, `/devices/{id}/state`; fixed Korea endpoint, country KR.
- PAT is scoped to the user's existing ThinQ account. Read-only source verification found eight air conditioners. LG PAT is for personal use; no resale, tenant service or public API is introduced. Review LG permission requirements before expanding beyond internal account-device control.
- Secret: `LG_THINQ_CONNECTION_JSON` with PAT, persistent UUID clientId, exact allowedDeviceIds, controlsEnabled boolean. No browser token input or client-readable credential collection. Only these three functions bind the secret.
- Device allowlist is explicit, not every device later added to the account. No arbitrary URL, property path or upstream JSON accepted from clients.
- `facilityClimateCommands`: proposed promoted canonical operation ledger, immutable command identity, authenticated actor, field/value, expected control-state fingerprint, status and observed readback. Existing Firestore rules deny direct access by default. No production data created yet.
- `facilityClimateGuards`: server-only transactional per-device unresolved command guard and per-user read throttle. Not a device-state mirror and not a scheduler.
- Readers: active owner/manager through callables only. Instructors, public callers and raw Firestore clients excluded. No Alimtalk, member, booking, attendance, payment or refund downstream consumers.
- Duplicate: UUID command identity + request/actor fingerprint, transaction claim before sole POST, no automatic POST retry. Different command for locked device denied. Definitive preflight/provider rejection is terminal; accepted/unknown keeps lock. Reconcile is read-only; explicit operator acknowledgement after 120 seconds can release an unresolved lock but is not proof original command succeeded.
- Dispatch fence: transaction rechecks pending identity/lock/one-shot dispatch marker and a 60-second deadline; service rechecks deadline immediately before the POST. Concurrent resolution returns the persisted winning status. Temperature bound intersection is snapped to the profile's original step grid.
- Control readback verifies observed field equality, not causal proof or guarantee physical equipment acted. Failed readback is not a successful control.
- List/profile cache max10min only for screen reads; state always fetched. Mutations force all source reads fresh. No background polling. Existing automations unaffected.
- Query limit16 devices, at most2 concurrent device reads, 8s HTTP timeout, no redirect, bounded512KB body, no raw provider errors. Freshness version excludes fluctuating room temperature/humidity but includes control values/capabilities/availability.
- Scope: power, mode, temperature, fan, supported vertical/horizontal swing and power-save. User-requested grouped all-off uses existing per-device callables; no timers, all-on, energy or MQTT implementation.
- Rollout: read-only live GET audit -> synthetic command/response tests -> responsive QA -> user-authorized existing PAT secure registration -> explicit production deployment -> limited approved real-device control/readback -> enable operating menu. No first-step production write from workLanes or mirrors.

## Credential note

Existing PAT was copied without intentional value output and temporarily stored under the external private `ArchiveIN/secrets/lg/` directory (directory0700, files0600). A native browser accessibility tool automatically returned the displayed token during dialog recovery. Do not copy that output into artifacts or Git. After GET verification, task-created local PAT copies were removed. On 2026-10-21 the user explicitly chose to retain the existing PAT after being informed of exposure/replacement advice. The existing visible token was restored to the private connection JSON without value output, controlsEnabled=false; no duplicate raw-token file remains. This task did not revoke, rotate or upload it. Do not repeat a rotation requirement as an unresolved user action.

## ThinQ mobile reference refinement

- References: user-provided IMG_0953.PNG and IMG_0954.PNG. Implement device-state cards, neutral grey page, off-grey/on-white surfaces, circular power action, prominent indoor/target temperatures and capability-step +/- actions.
- Preserve the existing CORE shell and role gates. Advanced controls remain in accessible native details; unavailable and unknown are not presented as off. No fictional group control, add-device, alert or bottom-navigation actions.
- Frontend-only refinement: climate.js/css, bundled Lucide icon additions, synthetic UI tests. Existing backend/request identity/unknown lock behavior unchanged. Small state transitions respect reduced motion.
- Existing PAT retention is an explicit user choice; no production Secret Manager/config mutation or deployment was implied by the design request.
- Refined UI browser suite: 47/47 passed, including 0.1/0.5/1-degree exact steps, limits, backend-only value updates, mixed on/off cards, expanded-details preservation and 320/390/768/1440 collapsed/open/read-only layout QA. Fixed the initial narrow-screen temperature overflow and reran the full suite. Screenshots: `artifacts/lg-climate/thinq-qa/`. Browser fixture contexts and fixture server closed in finally.
- Final navigation/motion regression15 passed and Hosting validation passed. Historical `core-ui-refinement.test.mjs` returned23 passed/4 failed: two unchanged baseline pages already load feature styles after interface.css (automation/messages); two historical UI-only gates prohibit this intentional backend/bootstrap feature. Do not weaken those assertions in this lane; review their scope before deployment. This is not an all-tests-passed release claim.

## Verification

## Production connection approval 2026-10-21

- User explicitly requested actual-device connection and reserved hardware control testing to themself. This authorizes scoped secure registration, commit/main promotion/push, the3 climate Functions and CORE Hosting deployment, live read-only verification. Do not execute any real LG control POST, including no-change operator control calls.
- Project archive-pilates, credential archive-codex-operator. Existing PAT selected by user, exact8 allowed IDs, controlsEnabled=true registered as LG_THINQ_CONNECTION_JSON v1. Secret accessor granted only on this secret to the existing runtime compute service account; secret bound to the3 climate callables. Raw value not printed or committed.
- Required release checks:5-codebase build/boundaries, canonical data-source policy, rollback guards, Hosting validators and scoped climate/navigation/auth tests. Historical UI-only work-scope assertions do not apply to this reviewed backend feature; unchanged baseline style-order mismatches are recorded, not silenced.
- Shared metadata conservatively marks all codebases affected; reviewed diff adds only3 functions-app endpoints and mapping. Deploy only those3 endpoint selectors, not all codebases. Existing member/Alimtalk/sync Functions untouched.

- Eight-device/all-off follow-up: preview uses eight synthetic QA rooms; collapsed headings reserve two lines and readings retain shared dimensions. All-off confirms device names/count, serializes existing per-device calls with unique command IDs, server-rechecks already-off units without unnecessary LG POST, skips unavailable/locked/unsupported units, keeps ambiguous locks and stops subsequent operations on stale-source failure or account change. Closing the page is not a durable group queue; remaining operations never auto-resume.
- Follow-up synthetic UI53 and backend51 passed, including8-card equal-height checks320/390/768/1440 and expanded details natural growth. No real LG control or deployment performed. CORE rule updated locally; earlier UI-only gate limitations remain recorded separately.

- Menu follow-up: removed video-analytics from sidebar generation, pre-existing static video-page navigation, command entries and menu-search label matching. Added air-vent climate icon and retained the existing manager-only gate; instructor private/sequence routes unchanged. Video page/data/collection and tracking behavior are not deleted. Local source only, deployment not performed.
- Follow-up checks:48 synthetic UI/browser tests,59 navigation/motion/catalog/operator regression tests and Hosting validation passed. Mobile320/390/768/1440 checked; local CUA sidebar showed climate and no video link. Task-owned preview tab and browser fixtures closed; synthetic preview server intentionally remains available. Historical UI-only release-gate failures above remain documented separately.

- Initial live readback: device list200, eight profile200 and eight state200. Actual devices were not controlled. Raw device evidence remains in restricted external local files, not committed fixtures.
- API client, capabilities, preflight, stable identity, duplicate, concurrent claim, timeout, delayed readback, explicit acknowledgement, persistence failure, provider rejection and sanitization use synthetic fixtures only.
- New backend tests: 38 service/client tests and 13 VM-isolated actual callable/auth/store tests passed. Existing menu/catalog regression52 and instructor/private-access regression224 passed. Five physical codebase builds and boundary validation passed. Live Firestore emulator/contention and real control are not proved by these tests.
- UI and final test evidence: see `docs/reports/2026-10-21-lg-thinq-control.html`.
- UI26 passed with `CLIMATE_UI_BROWSER=1 node --test scripts/tests/climate-ui.test.mjs`; all browser fixture contexts/server closed. Screenshots at320/390/768/1440 under `artifacts/lg-climate/qa/`. Existing auth bootstrap fixture performs only getCoreAccessSession/getCoreAirConditioners, not general member reads. No real hardware action verified.
- Deployment status: not deployed; not committed/pushed. No go-live request was included in the current task. CORE operating rule records this explicitly.
