import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createMcpServer } from '../src/transport.mjs';

const tools = [{
  name: 'local_lookup',
  description: 'Read an in-memory test fixture.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
}];

async function connect(t, options = {}) {
  const server = createMcpServer({
    listTools: () => tools,
    callTool: async () => ({ ok: true }),
    ...options,
  });
  const client = new Client({ name: 'transport-tests', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

function assertToolError(response, code, message) {
  const payload = { ok: false, error: { code, message } };
  assert.equal(response.isError, true);
  assert.deepEqual(response.structuredContent, payload);
  assert.deepEqual(response.content, [{ type: 'text', text: JSON.stringify(payload) }]);
}

test('discovers tools and identifies the low-level MCP server', async (t) => {
  const { server, client } = await connect(t);
  assert.ok(server instanceof Server);
  assert.deepEqual(client.getServerVersion(), {
    name: 'archivepilates-mcp', version: '0.1.0',
  });
  assert.deepEqual(client.getServerCapabilities(), { tools: {} });
  assert.match(client.getInstructions(), /조회 전용/);
  assert.deepEqual(await client.listTools(), { tools });
});

test('returns the business object as structured content and matching JSON text', async (t) => {
  const payload = { ok: true, rows: [{ id: 'fixture-1' }], count: 1 };
  const { client } = await connect(t, {
    callTool: async (name, args) => {
      assert.equal(name, 'local_lookup');
      assert.deepEqual(args, { query: 'fixture' });
      return payload;
    },
  });
  const response = await client.callTool({ name: 'local_lookup', arguments: { query: 'fixture' } });
  assert.notEqual(response.isError, true);
  assert.deepEqual(response.structuredContent, payload);
  assert.deepEqual(response.content, [{ type: 'text', text: JSON.stringify(payload) }]);
});

test('defaults omitted arguments to an empty object', async (t) => {
  const { client } = await connect(t, {
    callTool: async (_name, args) => {
      assert.deepEqual(args, {});
      return { ok: true };
    },
  });
  assert.deepEqual((await client.callTool({ name: 'local_lookup' })).structuredContent, { ok: true });
});

test('rejects unknown tools without dispatching or reflecting their name', async (t) => {
  let calls = 0;
  const { client } = await connect(t, {
    callTool: async () => { calls += 1; return { ok: true }; },
  });
  const response = await client.callTool({ name: 'unknown-private-fixture' });
  assertToolError(response, 'UNKNOWN_TOOL', 'Unknown tool.');
  assert.equal(calls, 0);
  assert.doesNotMatch(JSON.stringify(response), /unknown-private-fixture/);
});

test('exposes only explicitly safe business error fields', async (t) => {
  const error = Object.assign(new Error('A review is required.'), {
    safe: true,
    code: 'REVIEW_REQUIRED',
    privateDetails: 'private-fixture-secret',
    cause: new Error('private-fixture-cause'),
  });
  const { client } = await connect(t, { callTool: async () => { throw error; } });
  const response = await client.callTool({ name: 'local_lookup' });
  assertToolError(response, 'REVIEW_REQUIRED', 'A review is required.');
  assert.doesNotMatch(JSON.stringify(response), /private-fixture|stack|cause/);
});

test('redacts raw errors, thrown values, and invalid safe markers', async (t) => {
  const errors = [
    Object.assign(new Error('private-fixture-secret'), { code: 'PRIVATE_CODE' }),
    { code: 'PRIVATE_CODE', message: 'private-fixture-secret' },
    { safe: 'true', code: 'PRIVATE_CODE', message: 'private-fixture-secret' },
    { safe: true, code: '', message: 'private-fixture-secret' },
    { safe: true, code: 'PRIVATE_CODE', message: 42 },
    { get safe() { throw new Error('private-fixture-secret'); } },
    'private-fixture-secret',
    null,
    undefined,
  ];
  let index = 0;
  const { client } = await connect(t, { callTool: async () => { throw errors[index++]; } });
  for (const _error of errors) {
    const response = await client.callTool({ name: 'local_lookup' });
    assertToolError(response, 'INTERNAL_ERROR', 'Tool execution failed.');
    assert.doesNotMatch(JSON.stringify(response), /private-fixture|PRIVATE_CODE|stack/);
  }
});

test('redacts discovery failures at the protocol boundary', async (t) => {
  const { client } = await connect(t, {
    listTools: () => { throw new Error('private-fixture-secret'); },
  });
  await assert.rejects(client.listTools(), (error) => {
    assert.equal(error.code, -32603);
    assert.match(error.message, /Tool discovery failed\./);
    assert.doesNotMatch(error.message, /private-fixture/);
    return true;
  });
  assertToolError(await client.callTool({ name: 'local_lookup' }), 'INTERNAL_ERROR', 'Tool execution failed.');
});

test('redacts result serialization failures', async (t) => {
  const payload = { ok: true };
  payload.circular = payload;
  const { client } = await connect(t, { callTool: async () => payload });
  assertToolError(await client.callTool({ name: 'local_lookup' }), 'INTERNAL_ERROR', 'Tool execution failed.');
});

test('leaves concurrent call coordination to the business layer', { timeout: 5000 }, async (t) => {
  const pending = [];
  const { client } = await connect(t, {
    callTool: (_name, args) => new Promise((resolve) => {
      pending.push(() => resolve({ ok: true, query: args.query }));
      if (pending.length === 2) pending.forEach((complete) => complete());
    }),
  });
  const responses = await Promise.all([
    client.callTool({ name: 'local_lookup', arguments: { query: 'first' } }),
    client.callTool({ name: 'local_lookup', arguments: { query: 'second' } }),
  ]);
  assert.deepEqual(responses.map((response) => response.structuredContent), [
    { ok: true, query: 'first' },
    { ok: true, query: 'second' },
  ]);
});

test('MCP cancellation is propagated to the live reader signal', async t => {
  let entered, cancelled;
  const started = new Promise(resolve => { entered = resolve; });
  const stopped = new Promise(resolve => { cancelled = resolve; });
  const { client } = await connect(t, { callTool: (_name, _args, { signal }) => new Promise(resolve => {
    assert.equal(signal.aborted, false);
    signal.addEventListener('abort', () => { cancelled(); resolve({ ok: false }); }, { once: true });
    entered();
  }) });
  const controller = new AbortController();
  const result = assert.rejects(client.callTool({ name: 'local_lookup' }, undefined, { signal: controller.signal }));
  await started;
  controller.abort();
  await result;
  await stopped;
});
