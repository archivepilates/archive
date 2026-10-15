#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

assert.ok(process.argv.includes('--live-read-only'), 'Explicit read-only flag required.');
const directory = await mkdtemp(path.join(os.tmpdir(), 'archive-mcp-v2-read-'));
const registered = process.argv.includes('--registered')
  ? JSON.parse(execFileSync('codex', ['mcp', 'get', 'archivepilates-mcp', '--json'], { encoding: 'utf8' })) : null;
if (registered) {
  assert.equal(registered.enabled, true);
  assert.equal(registered.transport.type, 'stdio');
  assert.ok(registered.enabled_tools.includes('members_list_expiring'));
  assert.equal(registered.transport.env.ARCHIVE_MCP_READ_ONLY, 'true');
}
const client = new Client({ name: 'archivepilates-v2-read-verification', version: '0.1.0' });
const transport = new StdioClientTransport({ command: registered?.transport.command || process.execPath,
  args: registered?.transport.args || [fileURLToPath(new URL('../src/index.mjs', import.meta.url))], stderr: 'pipe',
  env: { ...process.env, ...(registered?.transport.env || {}), ARCHIVE_MCP_OPERATOR_STAFF_ID: '1979746', ARCHIVE_MCP_READ_ONLY: 'true',
    ARCHIVE_MCP_ENABLE_MEMO_WRITES: 'false', ARCHIVE_MCP_STATE_DIR: directory } });
const checks = [];
try {
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 7);
  async function call(name, args) {
    const start = performance.now();
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
    const value = result.structuredContent || JSON.parse(result.content[0].text);
    assert.equal(result.isError, undefined, `${name}: ${value.error?.code}`);
    return { value, milliseconds: Math.round(performance.now() - start) };
  }
  for (const name of ['김서원', '김서원', '정유리']) {
    const found = await call('members_find', { query: name });
    assert.equal(found.value.members.length, 1);
    assert.equal(found.value.liveReadback, true);
    const overview = await call('members_get_overview', { memberId: found.value.members[0].memberId });
    assert.equal(overview.value.member.name, name);
    assert.equal(overview.value.liveReadback, true);
    checks.push({ check: 'live_member_read', name, searchMs: found.milliseconds, overviewMs: overview.milliseconds,
      ticketCount: overview.value.tickets.length, gradeKnown: overview.value.memberGrade !== null });
  }
  for (const attempt of [1, 2]) {
    const result = await call('members_list_expiring', { daysRemainingMax: 10 });
    assert.equal(result.value.liveReadback, false);
    assert.equal(result.value.allowedForExternalActions, false);
    assert.ok(result.value.members.every(m => m.tickets.every(t => t.daysRemaining >= 0 && t.daysRemaining <= 10)));
    checks.push({ check: 'expiring_snapshot', attempt, milliseconds: result.milliseconds,
      memberCount: result.value.memberCount, ticketRowCount: result.value.ticketRowCount,
      range: result.value.range, coverage: result.value.coverage, source: result.value.source });
  }
  console.log(JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), mode: registered ? 'registered_operational_config' : 'candidate_not_registered', checks,
    memberDataWritten: false, messagesSent: false }, null, 2));
} finally {
  await client.close();
  await transport.close();
  await rm(directory, { recursive: true, force: true });
}
