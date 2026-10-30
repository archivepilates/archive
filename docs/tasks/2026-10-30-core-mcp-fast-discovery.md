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
