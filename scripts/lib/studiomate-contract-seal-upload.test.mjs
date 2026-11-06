import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { uploadStudioMateCenterSeal, CONTRACT_SEAL_UPLOAD_POLICY } from './studiomate-contract-seal-upload.mjs';

const bytes = Buffer.from('synthetic seal');
const contractId = 'a'.repeat(64);
const target = () => ({ presigned_url: 'https://synthetic.s3.ap-northeast-2.amazonaws.com/image?X-Amz-Signature=synthetic',
  method: 'PUT', headers: { 'Content-Type': 'image/png' }, digital_signature_id: 12,
  target_contract_party_id: 34, upload_token: 'synthetic-private-token' });
function fixture(data = target()) {
  const calls = [];
  return { calls, args: { contractId,
    seal: { path: '/synthetic/seal.png', bytes: bytes.length, mimeType: 'image/png',
      sha256: createHash('sha256').update(bytes).digest('hex') },
    readBytes: async () => bytes,
    beforeStep: async phase => calls.push(phase),
    api: { get: async route => { calls.push(['get', route]); return { data }; },
      patch: async (route, body) => calls.push(['patch', route, body]) },
    fetchImpl: async (url, options) => { calls.push(['put', url, options]); return { ok: true }; } } };
}

test('temporary upload follows observed three-step flow without session headers', async () => {
  const { args, calls } = fixture();
  const result = await uploadStudioMateCenterSeal(args);
  assert.equal(result.policy, CONTRACT_SEAL_UPLOAD_POLICY);
  assert.deepEqual(calls.filter(x => typeof x === 'string'), ['reserve', 'upload', 'finalize']);
  const get = calls.find(x => x[0] === 'get');
  const query = new URL(get[1], 'https://studiomate.invalid');
  assert.equal(query.searchParams.get('contract_id_hash'), contractId);
  assert.equal(query.searchParams.get('signature_party'), 'M');
  const put = calls.find(x => x[0] === 'put')[2];
  assert.deepEqual(put.headers, { 'Content-Type': 'image/png' });
  assert.equal(put.redirect, 'error');
  assert.deepEqual(put.body, bytes);
  assert.deepEqual(calls.at(-1), ['patch', '/v2/staff/contract/signature/direct/temporary/12/34',
    { upload_token: 'synthetic-private-token' }]);
  assert.equal(JSON.stringify(result).includes('synthetic-private-token'), false);
});

test('changed seal stops before any provider call', async () => {
  const { args, calls } = fixture(); args.readBytes = async () => Buffer.from('changed');
  await assert.rejects(uploadStudioMateCenterSeal(args), /file_changed/);
  assert.deepEqual(calls, []);
});

test('rejects unsafe upload targets and headers before image transfer', async t => {
  for (const patch of [
    { presigned_url: 'http://synthetic.s3.amazonaws.com/i?X-Amz-Signature=x' },
    { presigned_url: 'https://s3.amazonaws.com.evil.invalid/i?X-Amz-Signature=x' },
    { presigned_url: 'https://user:secret@s3.amazonaws.com/i?X-Amz-Signature=x' },
    { presigned_url: 'https://127.0.0.1/i?X-Amz-Signature=x' },
    { presigned_url: 'https://s3.amazonaws.com/i' },
    { method: 'POST' }, { headers: { Authorization: 'private' } },
    { headers: { 'x-amz-test': 'a\r\nb' } }, { headers: { 'Content-Type': 'image/jpeg' } },
    { digital_signature_id: '../bad' }, { target_contract_party_id: Number.MAX_SAFE_INTEGER + 1 },
    { upload_token: '' },
  ]) await t.test(Object.keys(patch)[0], async () => {
    const { args, calls } = fixture({ ...target(), ...patch });
    await assert.rejects(uploadStudioMateCenterSeal(args), /target_invalid/);
    assert.equal(calls.some(x => x[0] === 'put' || x[0] === 'patch'), false);
  });
});

test('network ambiguity and failed uploads never finalize or retry', async () => {
  for (const response of [async () => { throw new Error('private URL'); }, async () => ({ ok: false })]) {
    const { args, calls } = fixture(); args.fetchImpl = response;
    await assert.rejects(uploadStudioMateCenterSeal(args), /^Error: contract_seal_upload_/);
    assert.equal(calls.some(x => x[0] === 'patch'), false);
  }
});

test('image transfer failures expose only typed status and method for safe diagnosis', async () => {
  const { args, calls } = fixture();
  args.fetchImpl = async () => ({ ok: false, status: 403 });
  await assert.rejects(uploadStudioMateCenterSeal(args), error => {
    assert.equal(error.status, 403); assert.equal(error.method, 'PUT');
    assert.equal(error.errorKind, 'http'); assert.equal(error.ambiguous, true); return true;
  });
  assert.equal(calls.some(x => x[0] === 'patch'), false);
});

test('authorization is rechecked immediately before every remote step', async t => {
  for (const phase of ['reserve', 'upload', 'finalize']) await t.test(phase, async () => {
    const { args, calls } = fixture();
    args.beforeStep = async current => { if (current === phase) throw new Error('paused'); };
    await assert.rejects(uploadStudioMateCenterSeal(args), /paused/);
    assert.equal(calls.filter(x => x[0] === 'get').length, phase === 'reserve' ? 0 : 1);
    assert.equal(calls.filter(x => x[0] === 'put').length, phase === 'finalize' ? 1 : 0);
    assert.equal(calls.some(x => x[0] === 'patch'), false);
  });
});
