import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createService, validateContract } from '../src/service.mjs';
import { config } from '../src/config.mjs';

test('production bootstrap defaults to read-only and cannot enable memo writes accidentally', () => {
  assert.equal(config({ ARCHIVE_MCP_OPERATOR_STAFF_ID: 'operator' }).readOnly, true);
  assert.throws(() => config({ ARCHIVE_MCP_OPERATOR_STAFF_ID: 'operator', ARCHIVE_MCP_ENABLE_MEMO_WRITES: 'true',
    ARCHIVE_MCP_MEMO_ROLLOUT: 'verified_v1' }), { code: 'WRITE_DISABLED' });
});
test('read-only server exposes seven tools and rejects direct memo calls before any dependency access', async () => {
  const service = createService({ store: {}, approvals: {}, staffId: 'operator', readOnly: true });
  assert.equal(service.listTools().length, 7);
  assert.ok(service.listTools().every(tool => tool.annotations.readOnlyHint));
  await assert.rejects(service.callTool('memos_prepare', { memberId: '123', content: 'no writes' }), { code: 'WRITE_DISABLED' });
  await assert.rejects(service.callTool('memos_commit', { proposalId: 'no-approval' }), { code: 'WRITE_DISABLED' });
});
test('repository-root Hosting excludes MCP source and dependencies', async () => {
  const firebase = JSON.parse(await readFile(new URL('../../../firebase.json', import.meta.url), 'utf8'));
  for (const site of firebase.hosting.filter(site => site.public === '.')) assert.ok(site.ignore.includes('services/**'));
});
test('conflicting top-level and nested contract member IDs cannot report a signature receipt', () => {
  const receipt = { _id: 'contract-1', studioId: '5330', memberId: '999', binding: { memberId: '123' },
    signatureReceipt: { authoritative: true, studioId: '5330', memberId: '123', contractId: 'contract-1' } };
  assert.throws(() => validateContract(receipt, ['123']), { code: 'SOURCE_BINDING_MISMATCH' });
  assert.doesNotThrow(() => validateContract({ ...receipt, memberId: '123' }, ['123']));
});
