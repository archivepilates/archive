# CORE MCP Compatible Dependency Security Patch

- Approval: `call_6d7d175909db48399e3d30765ef2261e`, compatible security patch and verification only. Preserve the running MCP process, permissions, business behavior and connection configuration.
- Scope: `services/archive-core-mcp/package-lock.json` only for executable dependency changes. Direct SDK, Firebase Admin, AJV and overrides in package.json remain unchanged.
- Compatible transitive updates: @hono/node-server 2.1.5 to 2.1.8; hono 4.13.14 to 4.13.18; fast-xml-parser 5.11.2 to 5.12.1. XML companion updates: fast-xml-builder 1.3.1 to 1.3.2 and is-unsafe 2.0.2 to 2.0.3. No other package entries changed.
- Isolated install: `npm ci --ignore-scripts` in this worktree only. Production/shared node_modules were not replaced.
- Verification: all 252 MCP tests passed, including a repeat under Node 22; `npm audit --omit=dev` reports zero vulnerabilities. Manifest unchanged and exact lock diff independently checked by the main chat.
- No audit suppression, forced upgrade, credential access, MCP restart, function deployment or member action. This is source-lock remediation; it does not assert an already-running MCP process loaded the updated dependencies.
- Purpose: unblock required CI before the separately approved weekend-cancellation runtime adoption. Remote CI and final runtime adoption are recorded in the weekend-cancellation task report after successful verification.
