import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, chmod, lstat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createApprovals } from '../src/approvals.mjs';
import { config } from '../src/config.mjs';
import { hash } from '../src/service.mjs';

const at = Date.parse('2026-10-15T10:00:00Z');
const data = { staffId: 'operator', memberId: '123', memberName: '테스트', maskedPhone: '010-****-1234', content: '테스트 메모', sourceHash: 'hash' };
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'archive-mcp-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, approvals: await createApprovals(dir) };
}
test('prepare is private local state, approval is separate and bound to actor/content', async t => {
  const { dir, approvals } = await fixture(t), proposal = await approvals.prepare(data, at);
  const file = path.join(dir, `${proposal.proposalId}.proposal.json`);
  assert.equal((await lstat(file)).mode & 0o077, 0);
  await assert.rejects(approvals.loadApproved(proposal.proposalId, 'operator', at + 1), { code: 'APPROVAL_REQUIRED' });
  await approvals.approve(proposal.proposalId, at + 2, hash(await approvals.getPending(proposal.proposalId, at + 1)));
  assert.equal((await approvals.loadApproved(proposal.proposalId, 'operator', at + 3)).content, data.content);
  await assert.rejects(approvals.loadApproved(proposal.proposalId, 'another', at + 3), { code: 'APPROVAL_REQUIRED' });
  const edited = JSON.parse(await readFile(file, 'utf8')); edited.content = '변조';
  await writeFile(file, JSON.stringify(edited));
  await assert.rejects(approvals.loadApproved(proposal.proposalId, 'operator', at + 3), { code: 'APPROVAL_REQUIRED' });
});
test('same member/content produces stable job ID across proposal retries and dates', async t => {
  const { approvals } = await fixture(t);
  const a = await approvals.prepare(data, at), b = await approvals.prepare(data, at + 86400000);
  assert.notEqual(a.proposalId, b.proposalId);
  assert.equal((await approvals.getPending(a.proposalId, at)).jobId, (await approvals.getPending(b.proposalId, at + 86400000)).jobId);
});
test('expired and future proposals are rejected', async t => {
  const { approvals } = await fixture(t), p = await approvals.prepare(data, at);
  await assert.rejects(approvals.getPending(p.proposalId, at + 600000), { code: 'PROPOSAL_EXPIRED' });
  await assert.rejects(approvals.getPending(p.proposalId, at - 1), { code: 'PROPOSAL_EXPIRED' });
});
test('world-readable state or proposal and symlink state are rejected', async t => {
  const { dir, approvals } = await fixture(t), p = await approvals.prepare(data, at);
  await chmod(path.join(dir, `${p.proposalId}.proposal.json`), 0o644);
  await assert.rejects(approvals.getPending(p.proposalId, at), { code: 'LOCAL_STATE_UNSAFE' });
  await chmod(dir, 0o755);
  await assert.rejects(createApprovals(dir), { code: 'LOCAL_STATE_UNSAFE' });
  const link = `${dir}-link`; t.after(() => rm(link, { force: true })); await symlink(dir, link);
  await assert.rejects(createApprovals(link), { code: 'LOCAL_STATE_UNSAFE' });
});
test('approval command rejects piped input', () => {
  const result = spawnSync(process.execPath, ['src/approve-memo.mjs', 'p1'], { input: 'approve p1\n', encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /HUMAN_CONFIRMATION_REQUIRED/);
});
test('configuration defaults writes off, fixes project and requires rollout gate', () => {
  assert.equal(config({ ARCHIVE_MCP_OPERATOR_STAFF_ID: 'operator' }).memoWritesEnabled, false);
  assert.throws(() => config({}), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => config({ ARCHIVE_MCP_OPERATOR_STAFF_ID: 'operator', GOOGLE_CLOUD_PROJECT: 'other' }), { code: 'CONFIG_INVALID' });
  assert.throws(() => config({ ARCHIVE_MCP_OPERATOR_STAFF_ID: 'operator', ARCHIVE_MCP_ENABLE_MEMO_WRITES: 'true' }), { code: 'WRITE_DISABLED' });
});
