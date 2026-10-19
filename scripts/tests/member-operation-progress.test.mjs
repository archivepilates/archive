import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, inspect, backend, at, stage, secret, acceptanceHash } from '../../services/archivepilates-mcp/tests/member-operation-progress-fixture.mjs';
import { operationProgressView } from '../../services/archivepilates-mcp/src/operation-progress.mjs';

test('exact six deterministic document gets, read-only and sanitized, for both immutable memo policies', async () => {
  for (const policy of ['holding_delivery_memo_v1', 'holding_acceptance_memo_v2']) {
    const f = fixture({ policy }), { result, reads } = await inspect(f);
    assert.equal(reads.length, 6); assert.equal(new Set(reads).size, 6);
    assert.deepEqual(reads, [...f.docs.keys()]);
    assert.ok(reads.slice(4).every(path => path.endsWith(f.memoId)));
    assert.equal(result.status, 'completed'); assert.equal(result.liveReadback, false);
    assert.equal(result.readOnly, true); assert.equal(result.allowedForExternalActions, false);
    assert.equal(result.source.freshness, 'unknown'); assert.equal(result.nextAction, 'none');
    assert.ok(!JSON.stringify(result).includes(secret)); assert.ok(!JSON.stringify(result).includes(f.send.memberPhone));
    assert.deepEqual(operationProgressView(result, f.input), result);
  }
});

test('invalid kind, ID, path and studio fail before any dependency read', async () => {
  let reads = 0;
  const run = backend().createMemberOperationInspector({ readDocument: async () => { reads++; }, now: () => new Date(at) });
  for (const input of [null, {}, { kind: 'refund', operationId: fixture().input.operationId },
    { ...fixture().input, operationId: '../secret' }, { ...fixture().input, operationId: `holding_operator_notice_${'A'.repeat(64)}` },
    { ...fixture().input, extra: secret }]) await assert.rejects(run(input, '5330'), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(run(fixture().input, 'other'), { code: 'PERMISSION_DENIED' }); assert.equal(reads, 0);
});

test('default backend uses one read-only transaction with only the six fixed document reads', async () => {
  const f = fixture(), reads = []; let transactions = 0;
  const db = { doc: path => ({ path }), runTransaction: async (callback, options) => {
    transactions++; assert.equal(options.readOnly, true);
    return callback({ get: async ref => { reads.push(ref.path); return { data: () => f.docs.get(ref.path) }; } });
  } };
  const api = backend({ db });
  await assert.rejects(api.inspectMemberOperationProgress({ ...f.input, kind: 'refund' }, '5330'), { code: 'INVALID_ARGUMENT' });
  assert.equal(transactions, 0);
  const result = await api.inspectMemberOperationProgress(f.input, '5330');
  assert.equal(transactions, 1); assert.deepEqual(reads, [...f.docs.keys()]); assert.equal(result.status, 'completed');
});

test('absent documents are not found; detection-only is normal waiting; partial linked ledgers require review', async () => {
  const absent = fixture(); absent.docs.clear();
  assert.equal((await inspect(absent)).result.status, 'not_found');
  const detected = fixture(); detected.docs = new Map([[`holdingNoticeEvents/${detected.input.operationId}`, detected.event]]);
  const waiting = (await inspect(detected)).result;
  assert.equal(waiting.status, 'in_progress'); assert.equal(stage(waiting, 'detection').status, 'confirmed');
  const f = fixture(); f.docs.delete(`holdingNoticeClaims/${f.input.operationId}`);
  const { result } = await inspect(f); assert.equal(result.status, 'review_required');
  assert.equal(stage(result, 'provider_acceptance').status, 'unknown'); assert.ok(result.codes.includes('evidence_missing'));
});

test('accepted before memo projection is normal progress, not delivery or queue completion', async () => {
  const f = fixture({ delivered: false, queued: false }), { result } = await inspect(f);
  assert.equal(result.status, 'in_progress'); assert.deepEqual(result.codes, []);
  assert.equal(stage(result, 'provider_acceptance').status, 'confirmed');
  assert.equal(stage(result, 'provider_delivery').status, 'pending'); assert.equal(stage(result, 'memo_queued').status, 'unknown');
  assert.deepEqual(operationProgressView(result, f.input), result);
});

test('manual no-event operations retain other observed progress but never claim all-stage completion', async () => {
  const f = fixture(); f.docs.delete(`holdingNoticeEvents/${f.input.operationId}`);
  for (const row of [f.send, f.candidate]) row.payload = { holdingNotice: true, source: 'studiomate_live_ticket_readback', deliveryMode: 'operator_verified_one_off' };
  const { result } = await inspect(f); assert.equal(result.status, 'in_progress'); assert.deepEqual(result.codes, []);
  assert.equal(stage(result, 'detection').status, 'unknown'); assert.equal(stage(result, 'memo_synced').status, 'confirmed');
});

test('v2 acceptance and synced audit survive later mutable provider, send, claim and candidate failure', async () => {
  const f = fixture({ delivered: false });
  f.send.providerStatus = 'FAILED'; f.send.providerStatusCode = '5000'; f.send.providerOutcome = 'delivery_failed';
  f.send.status = 'failed'; f.claim.status = 'failed'; f.candidate.status = 'failed';
  const { result } = await inspect(f); assert.equal(result.status, 'review_required');
  assert.equal(stage(result, 'provider_acceptance').status, 'confirmed'); assert.equal(stage(result, 'provider_delivery').status, 'failed');
  assert.equal(stage(result, 'memo_queued').status, 'confirmed'); assert.equal(stage(result, 'memo_synced').status, 'confirmed');
  assert.deepEqual(operationProgressView(result, f.input), result);
});

test('done or a message ID alone is neither verified acceptance nor COMPLETE4000 delivery', async () => {
  for (const mutate of [f => { delete f.send.holdingMemoAcceptedAt; delete f.claim.holdingMemoAcceptedAt; },
    f => { f.send.providerStatus = 'COMPLETE'; f.send.providerStatusCode = '4001'; },
    f => { f.send.providerStatusCode = '4000'; f.send.providerStatus = 'SENDING'; }]) {
    const f = fixture({ queued: false, delivered: false }); mutate(f);
    const { result } = await inspect(f); assert.notEqual(result.status, 'completed');
    assert.notEqual(stage(result, 'provider_delivery').status, 'confirmed');
  }
});

test('all durable v2 marker components and recalculated fingerprint must match on send and claim', async () => {
  for (const target of ['send', 'claim']) for (const field of ['holdingMemoAcceptedAt', 'holdingMemoAcceptedMessageId', 'holdingMemoAcceptanceEvidence', 'holdingMemoAcceptanceFingerprint']) {
    const f = fixture(); f[target][field] = 'invalid';
    const { result } = await inspect(f); assert.equal(result.status, 'review_required');
    assert.notEqual(stage(result, 'provider_acceptance').status, 'confirmed');
    assert.notEqual(stage(result, 'memo_synced').status, 'confirmed');
    operationProgressView(result, f.input);
  }
  const f = fixture(); f.send.message = f.candidate.message = 'changed';
  const { result } = await inspect(f); assert.notEqual(stage(result, 'provider_acceptance').status, 'confirmed');
  f.send.holdingMemoAcceptanceFingerprint = f.claim.holdingMemoAcceptanceFingerprint = acceptanceHash(f.send);
  assert.equal(stage((await inspect(f)).result, 'provider_acceptance').status, 'confirmed');
});

test('legacy requires final delivery before queue proof; both policies require actual done + synced', async () => {
  const old = fixture({ policy: 'holding_delivery_memo_v1', delivered: false });
  assert.notEqual(stage((await inspect(old)).result, 'memo_queued').status, 'confirmed');
  for (const mutate of [f => { f.job.status = 'pending'; }, f => { f.memo.syncStatus = 'pending'; },
    f => { delete f.job.writtenAt; }, f => { delete f.memo.syncedAt; }, f => { f.job.status = 'failed'; }]) {
    const f = fixture(); mutate(f); const { result } = await inspect(f);
    assert.notEqual(result.status, 'completed'); assert.notEqual(stage(result, 'memo_synced').status, 'confirmed');
    operationProgressView(result, f.input);
  }
});

test('wrong member, studio, canonical hash, message, policy, content and job links fail closed', async () => {
  const changes = [f => { f.event.memberPhone = '01099999999'; }, f => { f.event.memberId = '702'; },
    f => { f.claim.issuanceFingerprint = 'a'.repeat(64); }, f => { f.send.sendId = 'other'; },
    f => { f.candidate.candidateId = 'other'; }, f => { f.claim.solapiMessageId = 'other'; },
    f => { f.send.studioId = 'other'; }, f => { f.memo.studioId = 'other'; }, f => { f.candidate.holdingMemoPolicy = 'unknown'; },
    f => { f.event.policyId = 'other'; }, f => { f.send.holdingMemoId = 'other'; }, f => { f.memo.memoId = 'other'; },
    f => { f.job.jobId = 'other'; }, f => { f.job.contentHash = 'a'.repeat(64); }, f => { f.memo.content += 'other'; },
    f => { f.job.memberId = 'other'; }, f => { f.job.solapiMessageId = 'other'; }, f => { f.job.holdingMemoPolicy = 'other'; },
    f => { f.job.source = 'other'; }, f => { f.job.studiomateMemberId = '702'; }];
  for (const mutate of changes) {
    const f = fixture(); mutate(f); const { result } = await inspect(f);
    assert.equal(result.status, 'review_required'); assert.notEqual(stage(result, 'memo_synced').status, 'confirmed');
    assert.ok(!JSON.stringify(result).includes(secret)); operationProgressView(result, f.input);
  }
});

test('missing memo/job pair is normal; one-sided queue or read errors are review, never empty success', async () => {
  const f = fixture({ queued: false }); f.send.holdingMemoStatus = 'ready';
  assert.equal((await inspect(f)).result.status, 'in_progress');
  for (const collection of ['memberMemos', 'studiomateMemoWriteJobs']) {
    const one = fixture(); one.docs.delete(`${collection}/${one.memoId}`);
    assert.equal((await inspect(one)).result.status, 'review_required');
  }
  for (const fail of ['holdingNoticeEvents', 'alimtalkCandidates', 'alimtalkSends', 'holdingNoticeClaims', 'memberMemos', 'studiomateMemoWriteJobs']) {
    const { result, reads } = await inspect(fixture(), { fail });
    assert.equal(reads.length, 6); assert.equal(result.status, 'review_required'); assert.ok(result.codes.includes('source_read_failed'));
    assert.ok(!JSON.stringify(result).includes(secret)); operationProgressView(result, fixture().input);
  }
});

test('Firestore timestamps normalize and missing timestamps cannot manufacture completed proof', async () => {
  const f = fixture(); f.send.holdingMemoAcceptedAt = f.claim.holdingMemoAcceptedAt = { toMillis: () => Date.parse(at) };
  assert.equal((await inspect(f)).result.status, 'completed');
  for (const mutate of [f => { delete f.event.registeredAt; }, f => { delete f.send.observedAt; },
    f => { delete f.send.holdingMemoQueuedAt; delete f.job.createdAt; }]) {
    const missing = fixture(); mutate(missing); const { result } = await inspect(missing);
    assert.equal(result.status, 'review_required'); assert.ok(result.codes.includes('timestamp_missing'));
    operationProgressView(result, missing.input);
  }
});
