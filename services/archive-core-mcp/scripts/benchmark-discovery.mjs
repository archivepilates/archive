import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('../src/index.mjs', import.meta.url))],
  env: { PATH: process.env.PATH, HOME: process.env.HOME, ARCHIVE_CORE_MCP_STAFF_ID: '1979746' }, stderr: 'pipe' });
const client = new Client({ name: 'archive-core-mcp-discovery-benchmark', version: '1.0.0' });
let stderrObserved = false;
transport.stderr?.on('data', () => { stderrObserved = true; });
const metrics = [];
async function measure(label, name, args) {
  const started = performance.now();
  const response = await client.callTool({ name, arguments: args });
  assert.ok(!response.isError && response.structuredContent?.ok, `${label} failed`);
  metrics.push({ label, elapsedMs: Math.round(performance.now() - started),
    payloadBytes: Buffer.byteLength(JSON.stringify(response.structuredContent)) });
  return response.structuredContent.result;
}
try {
  const started = performance.now();
  await client.connect(transport);
  const startupMs = Math.round(performance.now() - started);
  const full = await measure('full', 'core_catalog', { view: 'detail' });
  const summary = await measure('summary', 'core_catalog', {});
  const selected = await measure('selected', 'core_catalog', { operation: 'submitMemberMemo' });
  const area = await measure('area', 'core_catalog', { area: 'automationStatus' });
  assert.deepEqual(summary.actions.map(a => a.name), full.actions.map(a => a.name));
  assert.deepEqual(summary.areas.map(a => a.name), full.areas.map(a => a.name));
  assert.deepEqual(selected.actions, full.actions.filter(a => a.name === 'submitMemberMemo'));
  assert.equal(area.areas[0].name, 'automationStatus');
  await measure('stored-read', 'core_records_list', { area: 'automationStatus', limit: 1 });
  console.log(JSON.stringify({ ok: true, startupMs, metrics, actions: full.actions.length,
    areas: full.areas.length, writes: 0, stderrObserved }));
} finally { await client.close(); await transport.close(); }
