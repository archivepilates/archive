# CORE MCP bounded discovery

- Request: diagnose slow command-chat work and CORE MCP routing; preserve existing operations.
- Source: origin/main ad47ab5a; branch codex/mini/core-mcp-fast-discovery-20261030.
- Owned files: services/archive-core-mcp/src/{catalog,service,transport}.mjs, catalog/service tests, README, read-only benchmark, this task/report, AGENTS bounded-investigation guidance, existing CORE MCP rule section.
- Existing connected MCP baseline: catalog 840ms / serialized response 50,518 characters; bounded automationStatus list 764ms. These are two observations, not a latency distribution or firewall diagnosis.
- Confirmed inefficiencies: full catalog includes 45 actions and 46 areas; stored-record MCP and native StudioMate writes are separate paths. This chat also contains extensive historical and repeated heartbeat context. The relative contribution of context to model latency is unmeasured.
- Changes: summary-by-default discovery; exact operation/area detail; explicit full compatibility view; write preparation retains operation notes. No authorization caching, privilege, collection, action, retry, dispatch or scheduling changes.
- Validation: npm ci --ignore-scripts; npm test 250 pass; git diff --check; independent read-only stdio process with current owner authorization and automationStatus limit 1.
- New process measurements: startup 1381ms; full 425ms/31,102 structured bytes; summary 448ms/10,743 bytes; selected operation 517ms/3,533 bytes; selected area 432ms/2,920 bytes; stored read 532ms/525 bytes. Approximately 65% smaller overview, not a measured improvement to request latency or model response time. Process stderr was present; raw stderr was not copied and no diagnostic cause is claimed.
- No member data writes, sends, browser sessions or Firebase deployments. Benchmark closed its owned client and transport in finally.
- Approval: user approved runtime application, commit and push in call_12f9435f2d14489fb428e71fd7539919. Hosting scope is only the existing CORE MCP rule note on archive-pilates-core; Functions and database are unchanged.
- Release in progress: implementation and isolated live read verified; current chat remains on its existing MCP process. Do not label the current connected server updated without a new-response marker. Final rollout evidence is appended below after readback.
- Working method can change immediately: reuse already-discovered capability context and summarize bounded results, avoid duplicate UI/database reads. This does not reset this chat or erase its history.
- Main runtime unrelated untracked scripts/__pycache__/ remains untouched. No related memory edits.

## Approved rollout

- Source commit 7116defc94d9afac5259b56629db24ddd4911880 pushed to origin/main and codex/mini/core-mcp-fast-discovery-20261030. Runtime fast-forwarded to that source, preserving the unrelated pycache directory.
- Runtime-path new MCP process: startup 1203ms; full 412ms/31,109B; summary 415ms/10,750B; operation 422ms/3,539B; area 409ms/2,926B; stored read 531ms. Writes 0. Client/transport closed in finally.
- Rules-only release: sites/archive-pilates-core/versions/4c237fed08d311fe, release 1793341681120000 at 2026-10-30T06:28:01.076Z (15:28 KST). Existing 63 paths/config retained; only /rules/index.html replaced. Source hash 9dabeb70fa6f051caf9cfce1f3ac0343be70cae742c4dac16dde64271b4d29ad. Custom CORE and Firebase rules endpoints independently HTTP 200, source match and new marker confirmed.
- Connected current-chat MCP returned legacy-full after disk rollout. No reconnect/refresh tool is exposed in this session. Do not kill existing processes or restart the app without the user's restart handoff. App/session reconnection remains pending; newly spawned runtime MCP is verified separately.
- Initial CI CORE MCP Check 41014212262 failed because the rules UI test's exact label list omitted the new note. Corrected that expected list without relaxing layout/security assertions. Local 320/390/768/1440 test and subsequent CI are recorded below.
- Correction commit 639c6a35eeb1819847254bf224a3f8d2f8b58f45 pushed to main and task branch, runtime synchronized. Local CORE rules UI six tests passed at 320/390/768/1440; 390px section screenshot inspected. Context/browser closed in the test's finally blocks. Additional focused root tests 54 passed. No app restart or current-chat MCP disconnection occurred.
- Follow-up CORE MCP Check 41014477418 succeeded, including security, dependency audit, responsive rules UI and downstream UI coverage. Initial source Functions Affected Check 41014212263 succeeded. Correction main Functions Affected Check 41014477464 succeeded, including build, boundaries, source policy, system hardening, release guards and operational regressions. The duplicate task-branch check is verified in the final status readback.
