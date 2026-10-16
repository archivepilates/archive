#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

assert.equal(process.argv.includes('--live-read-only'), true, 'Explicit --live-read-only is required.');
const registered = process.argv.includes('--registered') ? JSON.parse(execFileSync('codex', ['mcp', 'get', 'archivepilates-mcp', '--json'], { encoding: 'utf8' })) : null;
const readTools = ['members_find', 'members_get_overview', 'members_list_expiring', 'bookings_list', 'contracts_get_progress', 'messages_get_delivery', 'messages_validate_target', 'operations_get_job'];
if (registered) {
  assert.equal(registered.enabled, true);
  assert.equal(registered.transport.type, 'stdio');
  assert.deepEqual([...registered.enabled_tools].sort(), [...readTools].sort());
  assert.equal(registered.transport.env.ARCHIVE_MCP_READ_ONLY, 'true');
  assert.equal(registered.transport.env.ARCHIVE_MCP_ENABLE_MEMO_WRITES, 'false');
} else assert.ok(process.env.ARCHIVE_MCP_OPERATOR_STAFF_ID, 'Operator staff ID is required.');
const directory = await mkdtemp(path.join(os.tmpdir(), 'archive-mcp-smoke-'));
const client = new Client({ name: 'archivepilates-read-only-smoke', version: '0.1.0' });
const transport = new StdioClientTransport({ command: registered?.transport.command || process.execPath,
  args: registered?.transport.args || [fileURLToPath(new URL('../src/index.mjs', import.meta.url))], stderr: 'pipe',
  env: { ...process.env, ...(registered?.transport.env || {}), ARCHIVE_MCP_STATE_DIR: directory,
    ARCHIVE_MCP_READ_ONLY: 'true', ARCHIVE_MCP_ENABLE_MEMO_WRITES: 'false' } });
const checks = [];
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, readTools.length);
  assert.ok(tools.tools.every(tool => tool.annotations.readOnlyHint));
  checks.push({ check: 'stdio_handshake_and_discovery', tools: tools.tools.length, ok: true });
  async function call(name, args) {
    const start = performance.now();
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
    const value = result.structuredContent || JSON.parse(result.content[0].text);
    checks.push({ check: name, ok: !result.isError, milliseconds: Math.round(performance.now() - start),
      ...(result.isError ? { error: value.error?.code } : {}) });
    assert.equal(result.isError, undefined, `${name}: ${value.error?.code}`);
    return value;
  }
  const found = await call('members_find', { query: '01086488585' });
  assert.equal(found.members.length, 1);
  assert.equal(found.members[0].memberId, '1982133');
  const memberId = found.members[0].memberId;
  const overview = await call('members_get_overview', { memberId });
  assert.equal(found.liveReadback, true);
  assert.equal(overview.member.source.liveReadback, true);
  assert.equal(JSON.stringify(overview).includes('01086488585'), false);
  const now = new Date(Date.now() + 9 * 3600000), endDate = now.toISOString().slice(0, 10);
  const startDate = new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  await call('bookings_list', { memberId, startDate, endDate });
  await call('contracts_get_progress', { memberId });
  const messages = await call('messages_get_delivery', { memberId, startDate, endDate });
  if (process.argv.includes('--require-date-indexes')) {
    assert.equal(messages.coverage.candidates.needsIndexDeployment, false);
    assert.equal(messages.coverage.sends.needsIndexDeployment, false);
  }
  const missing = await call('operations_get_job', { kind: 'memo', jobId: 'mcp_readonly_smoke_nonexistent' });
  assert.equal(missing.found, false);
  const expiring = await call('members_list_expiring', { daysRemainingMax: 10 });
  assert.equal(expiring.liveReadback, true);
  assert.equal(expiring.coverage.liveRosterComplete, true);
  assert.equal(expiring.allowedForExternalActions, false);
  const blocked = await client.callTool({ name: 'memos_commit', arguments: { proposalId: 'smoke-no-approval' } });
  assert.equal(blocked.isError, true);
  assert.equal(blocked.structuredContent.error.code, 'UNKNOWN_TOOL');
  checks.push({ check: 'production_write_disabled', ok: true });
  console.log(JSON.stringify({ ok: true, mode: registered ? 'registered_config_read_only' : 'live_read_only', checks,
    dateIndexesActive: !messages.coverage.candidates.needsIndexDeployment && !messages.coverage.sends.needsIndexDeployment, memberDataWritten: false,
    studioMateBrowserOpened: true, messagesSent: false }, null, 2));
} finally {
  await client.close();
  await transport.close();
  await rm(directory, { recursive: true, force: true });
}
