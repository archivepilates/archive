import assert from 'node:assert/strict';
import test from 'node:test';
import { MEMBERSHIP_CONTRACT_RECOVERY_BINDINGS as PINS, membershipContractRecoveryClosureHash as hash,
  planMembershipContractRecoveryClosure as plan } from '../lib/membership-contract-recovery-closure.mjs';

const NOW = Date.parse('2026-11-06T03:00:00.000Z');
const LANE = 'workLanes/studiomate-membership-contract-automation';
const SETTINGS = 'systemSettings/membershipContractAutomation';
function fixture() {
  const entries = PINS.map((pin, index) => {
    const phoneFingerprint = hash(['synthetic-phone', index]), fingerprint = hash(['synthetic-purchase', index]);
    return { memberId: pin.memberId, phoneFingerprint, fingerprint, hintId: hash([phoneFingerprint, fingerprint]),
      productName: '20회(5개월)', previousDownloadedAt: '2026-10-27T01:00:00.000Z',
      sourceDownloadedAt: '2026-10-28T01:00:00.000Z' };
  });
  const config = { studioId: '5330', contractWriterEnabled: false, enabled: true, mode: 'live',
    nativeE2eVerified: false, reminderEnabled: false, unrelated: { preserve: 'synthetic' },
    signatureMaintenanceHold: { id: 'synthetic-hold', requestedAt: '2026-10-23T01:00:00.000Z', autoResume: false },
    signatureMaintenanceRecovery: { policy: 'signature_maintenance_resume_v1', status: 'blocked',
      reference: 'user_signature_resume_20261028', holdId: 'synthetic-hold',
      noticeUrl: 'https://arcpilates.studiomate.kr/boards/studio-notice/224?page=1',
      approvedAt: '2026-10-28T02:00:00.000Z', expiresAt: '2026-10-29T02:00:00.000Z', entries,
      blockedReason: 'synthetic-original-seal-uncertainty', priorOpaqueEvidence: { preserved: ['synthetic'] } } };
  const jobs = [], contracts = [], hints = [];
  for (const [index, pin] of PINS.entries()) {
    const userTicketId = String(900001 + index);
    const selection = { studioId: '5330', memberId: pin.memberId, userTicketId, jobKey: pin.jobId };
    const receipt = { memberId: pin.memberId, contractId: pin.contractId,
      userTicketId, canonicalContractPath: `studiomateMembershipContracts/${pin.contractId}`,
      status: 'accepted', attempts: 1, maxAttempts: 1, noReplay: true, route: 'native_ui',
      acceptedAt: '2026-10-29T03:00:00.000Z',
      nativeResult: { contractId: pin.contractId, memberId: pin.memberId,
        attempts: 1, status: 'accepted', transmissionStatus: 'success', success: 1, failed: 0, pending: 0 } };
    jobs.push({ id: pin.jobId, data: { studioId: '5330', memberId: pin.memberId, contractId: pin.contractId,
      jobKey: pin.jobId, userTicketId, stage: 'review', reason: 'official_seal_outcome_unknown',
      operatorDraftSignatureRequest: receipt } });
    contracts.push({ id: pin.contractId, data: { contractId: pin.contractId, studioId: '5330', selection,
      binding: { studioId: '5330', memberId: pin.memberId, contractId: pin.contractId,
        userTicketId, selectionJobKey: pin.jobId },
      status: index === 4 ? 'review' : 'signed', observationReason: index === 4 ? 'request_expired' : 'signed',
      untouched: 'synthetic-canonical-source' } });
    hints.push({ id: entries[index].hintId, data: { ...entries[index], status: 'review', reason: 'official_seal_outcome_unknown' } });
  }
  return { config, jobs, contracts, hints, now: NOW, expectedConfigHash: hash(config) };
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
function rehash(input) { input.expectedConfigHash = hash(input.config); return input; }
function condensedReceipt(job) {
  const full = job.data.operatorDraftSignatureRequest;
  return { ...full.nativeResult, noReplay: full.noReplay, route: full.route,
    nativeSentMinute: '2026-10-29T03:00:00.000Z', sentTimePrecision: 'minute',
    checkedAt: '2026-10-29T03:01:00.000Z', source: 'synthetic-native-readback',
    providerCompletionTimeAvailable: false, nativeContractStatus: 'waiting', memberSigned: false };
}

test('pins exactly the five supplied member, contract and job identities with immutable constants', () => {
  assert.equal(PINS.length, 5);
  assert.deepEqual(PINS.map(pin => pin.memberId), ['1984759', '4888735', '5077781', '3635427', '5081479']);
  for (const key of ['memberId', 'contractId', 'jobId']) assert.equal(new Set(PINS.map(pin => pin[key])).size, 5);
  assert.throws(() => { PINS[0].memberId = '999'; }, TypeError);
});

test('closes dispatch acceptance only, preserves four signed plus one expired review and never enables writing', () => {
  const input = fixture(), before = structuredClone(input);
  const result = plan(deepFreeze(input));
  assert.deepEqual(input, before);
  assert.equal(result.type, 'dispatch_accepted_not_all_signed');
  assert.deepEqual(Object.keys(result.settingPatch).sort(), ['signatureMaintenanceRecovery.closure', 'signatureMaintenanceRecovery.status']);
  assert.equal(result.settingPatch['signatureMaintenanceRecovery.status'], 'completed');
  const closure = result.settingPatch['signatureMaintenanceRecovery.closure'];
  assert.equal(closure.signatureCompletion, 'not_asserted');
  assert.equal(closure.acceptedDispatchCount, 5);
  assert.equal(closure.writerMustRemainDisabled, true);
  assert.equal(input.config.contractWriterEnabled, false);
  assert.equal(input.contracts[4].data.status, 'review');
  for (const patch of result.hintPatches) {
    assert.deepEqual(Object.keys(patch.patch), ['signatureMaintenanceRecoveryClosure']);
    assert.equal(input.hints.find(row => `${LANE}/purchaseHints/${row.id}` === patch.path).data.status, 'review');
  }
  assert.equal(result.jobPatches, undefined);
  assert.equal(result.contractPatches, undefined);
  assert.doesNotMatch(JSON.stringify(result), /"allMembersSigned":true|"signatureCompletion":"signed"/);
});

test('preserves the full prior approval in a detached private audit and captures every before hash', () => {
  const input = fixture(), result = plan(input);
  assert.equal(result.audit.privateCallerOnly, true);
  assert.deepEqual(result.audit.data.priorApproval, input.config.signatureMaintenanceRecovery);
  assert.equal(result.cas.expectedConfigHash, input.expectedConfigHash);
  assert.equal(result.cas.atomic, true);
  assert.deepEqual(result.cas.createOnly, [result.audit.path]);
  assert.equal(result.cas.preconditions.length, 16);
  assert.equal(result.beforeHashes[SETTINGS], hash(input.config));
  for (const [rows, root] of [[input.jobs, 'studiomateMembershipContractJobs'],
    [input.contracts, 'studiomateMembershipContracts'], [input.hints, `${LANE}/purchaseHints`]]) {
    for (const row of rows) assert.equal(result.beforeHashes[`${root}/${row.id}`], hash(row.data));
  }
  result.audit.data.priorApproval.entries[0].productName = 'changed-output';
  assert.equal(input.config.signatureMaintenanceRecovery.entries[0].productName, '20회(5개월)');
  result.audit.data.bindings[0].memberId = 'changed-output';
  assert.equal(input.jobs[0].data.memberId, PINS[0].memberId);
});

test('hashes and the closure proposal are stable across object-key and snapshot ordering', () => {
  const input = fixture();
  const reverse = value => Array.isArray(value) ? value.map(reverse) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverse(item)])) : value;
  const reordered = reverse(input);
  reordered.jobs.reverse(); reordered.contracts.reverse(); reordered.hints.reverse();
  assert.equal(hash(reordered.config), input.expectedConfigHash);
  assert.deepEqual(plan(reordered), plan(input));
});

for (const [name, mutate, configChanged = false] of [
  ['changed config', x => { x.config.unrelated.preserve = 'different'; }],
  ['enabled writer', x => { x.config.contractWriterEnabled = true; }, true],
  ['wrong studio', x => { x.config.studioId = '999'; }, true],
  ['unblocked approval', x => { x.config.signatureMaintenanceRecovery.status = 'approved'; }, true],
  ['already completed approval', x => { x.config.signatureMaintenanceRecovery.status = 'completed'; }, true],
  ['unexpired approval', x => { x.now = Date.parse('2026-10-28T03:00:00.000Z'); }],
  ['wrong policy', x => { x.config.signatureMaintenanceRecovery.policy = 'other'; }, true],
  ['wrong reference', x => { x.config.signatureMaintenanceRecovery.reference = 'other'; }, true],
  ['wrong hold', x => { x.config.signatureMaintenanceRecovery.holdId = 'other'; }, true],
  ['wrong notice', x => { x.config.signatureMaintenanceRecovery.noticeUrl = 'https://untrusted.invalid'; }, true],
  ['overlong approval', x => { x.config.signatureMaintenanceRecovery.expiresAt = '2026-10-30T02:00:00.000Z'; }, true],
  ['duplicate approval entry', x => { x.config.signatureMaintenanceRecovery.entries[1] = x.config.signatureMaintenanceRecovery.entries[0]; }, true],
  ['missing approval entry', x => { x.config.signatureMaintenanceRecovery.entries.pop(); }, true],
  ['wrong approval member', x => { x.config.signatureMaintenanceRecovery.entries[0].memberId = '999'; }, true],
  ['duplicate approval phone', x => { x.config.signatureMaintenanceRecovery.entries[1].phoneFingerprint = x.config.signatureMaintenanceRecovery.entries[0].phoneFingerprint; }, true],
  ['approval fingerprint mismatch', x => { x.config.signatureMaintenanceRecovery.entries[0].fingerprint = 'a'.repeat(64); }, true],
  ['unknown product', x => { x.config.signatureMaintenanceRecovery.entries[0].productName = 'other'; }, true],
  ['invalid clock', x => { x.now = NaN; }],
  ['partial jobs', x => { x.jobs.pop(); }],
  ['partial contracts', x => { x.contracts.pop(); }],
  ['partial hints', x => { x.hints.pop(); }],
  ['duplicate job snapshot', x => { x.jobs[1] = x.jobs[0]; }],
  ['wrong contract snapshot', x => { x.contracts[0].id = 'a'.repeat(64); }],
  ['wrong snapshot path', x => { x.jobs[0].path = 'other/wrong'; }],
  ['wrong job member', x => { x.jobs[0].data.memberId = '999'; }],
  ['wrong job contract', x => { x.jobs[0].data.contractId = 'a'.repeat(64); }],
  ['wrong job key', x => { x.jobs[0].data.jobKey = PINS[1].jobId; }],
  ['missing issuance', x => { delete x.jobs[0].data.userTicketId; }],
  ['wrong contract selection', x => { x.contracts[0].data.selection = { ...x.contracts[0].data.selection, userTicketId: '999' }; }],
  ['wrong canonical studio', x => { x.contracts[0].data.studioId = '999'; }],
  ['conflicting canonical member', x => { x.contracts[0].data.memberId = '999'; }],
  ['conflicting canonical issuance', x => { x.contracts[0].data.userTicketId = '999'; }],
  ['conflicting canonical binding', x => { x.contracts[0].data.binding.selectionJobKey = PINS[1].jobId; }],
  ['missing receipt', x => { delete x.jobs[0].data.operatorDraftSignatureRequest; }],
  ['unknown receipt', x => { x.jobs[0].data.operatorDraftSignatureRequest.status = 'unknown'; }],
  ['zero attempts', x => { x.jobs[0].data.operatorDraftSignatureRequest.attempts = 0; }],
  ['repeated attempts', x => { x.jobs[0].data.operatorDraftSignatureRequest.attempts = 2; }],
  ['missing max attempts', x => { delete x.jobs[0].data.operatorDraftSignatureRequest.maxAttempts; }],
  ['replay allowed', x => { x.jobs[0].data.operatorDraftSignatureRequest.noReplay = false; }],
  ['wrong route', x => { x.jobs[0].data.operatorDraftSignatureRequest.route = 'legacy_api'; }],
  ['wrong receipt contract', x => { x.jobs[0].data.operatorDraftSignatureRequest.contractId = PINS[1].contractId; }],
  ['wrong receipt job', x => { x.jobs[0].data.operatorDraftSignatureRequest.jobId = PINS[1].jobId; }],
  ['wrong receipt member', x => { x.jobs[0].data.operatorDraftSignatureRequest.memberId = '999'; }],
  ['wrong receipt issuance', x => { x.jobs[0].data.operatorDraftSignatureRequest.userTicketId = '999'; }],
  ['wrong canonical path', x => { x.jobs[0].data.operatorDraftSignatureRequest.canonicalContractPath = 'other/wrong'; }],
  ['native outcome unknown', x => { x.jobs[0].data.operatorDraftSignatureRequest.nativeResult.status = 'unknown'; }],
  ['native missing contract', x => { delete x.jobs[0].data.operatorDraftSignatureRequest.nativeResult.contractId; }],
  ['native missing member', x => { delete x.jobs[0].data.operatorDraftSignatureRequest.nativeResult.memberId; }],
  ['native wrong member', x => { x.jobs[0].data.operatorDraftSignatureRequest.nativeResult.memberId = '999'; }],
  ['native repeated attempt', x => { x.jobs[0].data.operatorDraftSignatureRequest.nativeResult.attempts = 2; }],
  ['native send failed', x => { x.jobs[0].data.operatorDraftSignatureRequest.nativeResult.failed = 1; }],
  ['native send pending', x => { x.jobs[0].data.operatorDraftSignatureRequest.nativeResult.pending = 1; }],
  ['native no success', x => { x.jobs[0].data.operatorDraftSignatureRequest.nativeResult.success = 0; }],
  ['native not transmitted', x => { x.jobs[0].data.operatorDraftSignatureRequest.nativeResult.transmissionStatus = 'pending'; }],
  ['native wrong binding', x => { x.jobs[0].data.operatorDraftSignatureRequest.nativeResult.contractId = PINS[1].contractId; }],
  ['hint source changed', x => { x.hints[0].data.sourceDownloadedAt = '2026-11-01T01:00:00.000Z'; }],
  ['hint already closed', x => { x.hints[0].data.signatureMaintenanceRecoveryClosure = {}; }],
]) {
  test(`refuses ${name} without mutating any input`, () => {
    const input = fixture(); mutate(input); if (configChanged) rehash(input);
    const before = structuredClone(input);
    assert.throws(() => plan(input), /contract_recovery_closure_/);
    assert.deepEqual(input, before);
  });
}

test('any conflicting copy of a receipt fails closed, even when another copy is accepted', () => {
  const input = fixture();
  input.contracts[0].data.operatorDraftSignatureRequest = condensedReceipt(input.jobs[0]);
  input.contracts[0].data.operatorDraftSignatureRequest.pending = 1;
  assert.throws(() => plan(input), /contract_receipt_unverified/);
});

test('actual receipt shape needs no invented job key or nested job selection', () => {
  const input = fixture();
  for (const row of input.jobs) {
    assert.equal(row.data.selection, undefined);
    assert.equal(row.data.operatorDraftSignatureRequest.jobId, undefined);
    assert.equal(row.data.operatorDraftSignatureRequest.jobKey, undefined);
  }
  assert.equal(plan(input).type, 'dispatch_accepted_not_all_signed');
});

test('a contract copy can never replace the mandatory full job receipt', () => {
  const input = fixture();
  for (let i = 0; i < 5; i++) {
    input.contracts[i].data.operatorDraftSignatureRequest = input.jobs[i].data.operatorDraftSignatureRequest;
    delete input.jobs[i].data.operatorDraftSignatureRequest;
  }
  assert.throws(() => plan(input), /receipt_missing/);
});

test('accepts exact condensed native-result copies without inventing absent copied fields', () => {
  const input = fixture();
  for (let i = 0; i < 5; i++) {
    const receipt = condensedReceipt(input.jobs[i]);
    assert.equal(receipt.userTicketId, undefined);
    assert.equal(receipt.canonicalContractPath, undefined);
    assert.equal(receipt.maxAttempts, undefined);
    assert.equal(receipt.jobId, undefined);
    assert.equal(receipt.nativeResult, undefined);
    input.contracts[i].data.operatorDraftSignatureRequest = receipt;
  }
  const before = structuredClone(input), result = plan(deepFreeze(input));
  assert.equal(result.type, 'dispatch_accepted_not_all_signed');
  assert.deepEqual(input, before);
});

for (const [field, value] of Object.entries({ contractId: 'a'.repeat(64), memberId: '999',
  status: 'unknown', attempts: 2, noReplay: false, route: 'legacy_api', transmissionStatus: 'pending',
  success: 0, failed: 1, pending: 1, userTicketId: '999', jobId: PINS[1].jobId,
  jobKey: PINS[1].jobId, maxAttempts: 2, studioId: '999', canonicalContractPath: 'other/wrong' })) {
  test(`rejects conflicting condensed contract receipt ${field}`, () => {
    const input = fixture();
    input.contracts[0].data.operatorDraftSignatureRequest = { ...condensedReceipt(input.jobs[0]), [field]: value };
    assert.throws(() => plan(input), /contract_receipt_/);
  });
}

for (const field of ['transmissionStatus', 'success', 'failed', 'pending']) {
  test(`rejects condensed receipt missing direct ${field}`, () => {
    const input = fixture(), receipt = condensedReceipt(input.jobs[0]);
    delete receipt[field]; input.contracts[0].data.operatorDraftSignatureRequest = receipt;
    assert.throws(() => plan(input), /contract_receipt_unverified/);
  });
}

test('CAS fingerprints detect changes in any receipt, canonical source or hint after planning', () => {
  const input = fixture(), result = plan(input);
  for (const [row, root] of [[input.jobs[0], 'studiomateMembershipContractJobs'],
    [input.contracts[0], 'studiomateMembershipContracts'], [input.hints[0], `${LANE}/purchaseHints`]]) {
    const data = structuredClone(row.data); data.concurrentChange = 'synthetic';
    assert.notEqual(hash(data), result.beforeHashes[`${root}/${row.id}`]);
  }
});

test('rejects lossy or executable snapshots rather than dropping evidence from a CAS hash', () => {
  for (const value of [undefined, NaN, Infinity, () => {}, new Date(), { missing: undefined }, [, 1]]) {
    assert.throws(() => hash(value), /non_json_snapshot/);
  }
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => hash(cyclic), /non_json_snapshot/);
});
