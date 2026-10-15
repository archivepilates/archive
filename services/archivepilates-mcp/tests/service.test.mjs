import assert from 'node:assert/strict';
import test from 'node:test';
import { createService, hash, sourceHash } from '../src/service.mjs';
import { TOOLS, validate } from '../src/catalog.mjs';
import { OperationError, maskedPhone, safeError } from '../src/errors.mjs';

const NOW = Date.parse('2026-10-15T03:00:00Z');
const RECENT = new Date(NOW - 60000).toISOString();
const PHONE = '01012345678';
const SECRET = 'PRIVATE_FIXTURE_HEALTH_AND_CREDENTIAL_CONTENT';
const dates = { startDate: '2026-10-01', endDate: '2026-10-31' };
const memberArgs = { memberId: '123' };
const readCalls = [
  ['members_find', { query: 'Fixture Member' }],
  ['members_get_overview', memberArgs],
  ['members_list_expiring', { daysRemainingMax: 10 }],
  ['bookings_list', { ...memberArgs, ...dates }],
  ['contracts_get_progress', memberArgs],
  ['messages_get_delivery', { ...memberArgs, ...dates }],
  ['operations_get_job', { kind: 'memo', jobId: 'memo-1' }],
];

function record(_id, extra = {}) {
  return { _id, memberId: '123', studioId: '5330', syncedAt: RECENT,
    rawPayload: { phone: PHONE, answers: SECRET }, ...extra };
}

// All dependencies are in-memory doubles. Commit guards here model the store
// contract, not a test of the Firestore transaction or approval-file adapter.
function fixture(t, options = {}) {
  const state = {
    operator: { studioId: '5330', active: true, role: 'manager', uid: 'fixture-operator' },
    profile: record('123', { name: 'Fixture Member', phone: PHONE, memberGrade: 'regular',
      activeTickets: [{ userTicketId: 'ticket-1', name: 'Fixture Pass', status: 'active', remainingCount: 4,
        availableFrom: RECENT, expiresAt: '2026-11-15T00:00:00Z', paymentAmount: 100,
        rawPayload: SECRET }] }),
    lookup: null,
    rows: {
      bookings: [
        record('booking-2', { lectureDate: '2026-10-16', lectureStartAt: '2026-10-16T01:00:00Z' }),
        record('excel_booking_1', { lectureDate: '2026-10-15', lectureStartAt: '2026-10-15T01:00:00Z',
          sourceStatus: 'reserved', appStatus: 'active', attendanceStatus: 'unknown',
          canonicalBookingKey: 'fixture-key', supersededByBookingId: 'booking-1' }),
        record('booking-1', { lectureDate: '2026-10-15', lectureStartAt: '2026-10-15T01:00:00Z',
          canonicalBookingKey: 'fixture-key' }),
        record('outside', { lectureDate: '2026-11-01' }),
      ],
      studiomateMembershipContracts: [record('contract-1', { status: 'waiting_signature', stage: 'sent',
        sentAt: RECENT, welcomeStatus: 'pending', lastError: SECRET })],
      alimtalkCandidates: [record('candidate-1', { status: 'pending', createdAt: RECENT, lastError: SECRET,
        reasonCode: 'contains private text', type: 'fixture', templateCode: 'fixture-template' })],
      alimtalkSends: [record('send-1', { status: 'done', createdAt: RECENT,
        solapiMessageId: 'fixture-message', solapiStatus: 'accepted', error: SECRET })],
    },
    jobs: new Map([['memo:memo-1', record('memo-1', { status: 'pending', lastError: SECRET })]]),
    memos: new Map([['memo-1', record('memo-1', { content: SECRET })]]),
    proposals: new Map(),
    approved: new Set(),
    commits: new Map(),
  };
  const store = {
    getOperator: t.mock.fn(async () => state.operator),
    getProfile: t.mock.fn(async memberId => state.profile?.memberId === memberId ? state.profile : null),
    findMembers: t.mock.fn(async () => [state.profile]),
    getLookup: t.mock.fn(async () => state.lookup),
    getTicketInventory: t.mock.fn(async () => ({ profiles: [state.profile], fetchedAt: NOW, cacheHit: false })),
    getRows: t.mock.fn(async collection => state.rows[collection] || []),
    getMessageRows: t.mock.fn(async (...args) => ({ rows: await store.getRows(...args), coverage: { queryMode: 'fixture' } })),
    getJob: t.mock.fn(async (kind, jobId) => state.jobs.get(`${kind}:${jobId}`) || null),
    getMemo: t.mock.fn(async jobId => state.memos.get(jobId) || null),
    commitMemo: t.mock.fn(async ({ proposal, actor, sourceHash: hashCurrent, validateProfile, now }) => {
      assert.equal(actor.staffId, 'staff-1');
      assert.equal(now, NOW);
      validateProfile(state.profile);
      if (hashCurrent(state.profile) !== proposal.sourceHash) {
        throw new OperationError('SOURCE_CHANGED', 'Fixture source changed.');
      }
      const existing = state.commits.get(proposal.jobId);
      if (existing) return { ...existing, duplicate: true };
      const result = { jobId: proposal.jobId, status: 'pending', duplicate: false };
      state.commits.set(proposal.jobId, result);
      return result;
    }),
  };
  const approvals = {
    prepare: t.mock.fn(async (input, now) => {
      const proposalId = `proposal-${state.proposals.size + 1}`;
      const proposal = { ...input, proposalId, jobId: `fixture_memo_${hash(['5330', input.memberId, input.content])}`,
        issuedAt: now, expiresAt: now + 600000 };
      state.proposals.set(proposalId, proposal);
      const { memberId, memberName, maskedPhone: masked, content } = input;
      return { proposalId, memberId, memberName, maskedPhone: masked, content,
        expiresAt: new Date(proposal.expiresAt).toISOString() };
    }),
    loadApproved: t.mock.fn(async (proposalId, staffId, now) => {
      const proposal = state.proposals.get(proposalId);
      if (!proposal || proposal.expiresAt <= now) throw new OperationError('PROPOSAL_EXPIRED', 'Fixture expired.');
      if (!state.approved.has(proposalId) || staffId !== proposal.staffId) {
        throw new OperationError('APPROVAL_REQUIRED', 'Fixture approval required.');
      }
      return proposal;
    }),
  };
  const service = createService({ store, approvals, staffId: 'staff-1', now: () => NOW, ...options });
  return { ...service, state, store, approvals };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof OperationError);
    assert.equal(error.safe, true);
    assert.equal(error.code, code);
    return true;
  });
}

function noWrites(f) {
  assert.equal(f.approvals.prepare.mock.callCount(), 0);
  assert.equal(f.approvals.loadApproved.mock.callCount(), 0);
  assert.equal(f.store.commitMemo.mock.callCount(), 0);
  assert.equal(f.state.commits.size, 0);
}

async function prepareApproved(f) {
  const result = await f.callTool('memos_prepare', { ...memberArgs, content: 'Fixture memo' });
  f.state.approved.add(result.proposal.proposalId);
  return result.proposal.proposalId;
}

test('catalog exposes seven reads and two explicit memo actions', t => {
  const f = fixture(t);
  assert.deepEqual(f.listTools(), TOOLS);
  assert.deepEqual(TOOLS.filter(tool => tool.annotations.readOnlyHint).map(tool => tool.name),
    readCalls.map(([name]) => name));
  assert.deepEqual(TOOLS.filter(tool => !tool.annotations.readOnlyHint).map(tool => tool.name),
    ['memos_prepare', 'memos_commit']);
  for (const tool of TOOLS) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
  }
  noWrites(f);
});

test('all seven reads return projected data without raw phones, payloads, or error content', async t => {
  const f = fixture(t);
  for (const [name, args] of readCalls) {
    const response = await f.callTool(name, args);
    assert.equal(response.ok, true, name);
    const serialized = JSON.stringify(response);
    assert.ok(!serialized.includes(PHONE), name);
    assert.ok(!serialized.includes(SECRET), name);
    assert.doesNotMatch(serialized, /rawPayload|"lastError"|"answers"/, name);
  }
  assert.equal(f.store.getOperator.mock.callCount(), 7);
  noWrites(f);
});

test('phone masking and exact-match search do not reflect the raw query', async t => {
  assert.equal(maskedPhone('010-1234-5678'), '010-****-5678');
  assert.equal(maskedPhone('invalid'), null);
  const f = fixture(t);
  const result = await f.callTool('members_find', { query: '010-1234-5678' });
  assert.deepEqual(f.store.findMembers.mock.calls[0].arguments, [PHONE, true]);
  assert.equal(result.match, 'exact');
  assert.equal(result.needsSelection, false);
  assert.equal(result.members[0].maskedPhone, '010-****-5678');
  assert.equal(result.liveReadback, false);
  assert.ok(!JSON.stringify(result).includes(PHONE));
  noWrites(f);
});

test('search excludes merged records and distinguishes missing from ambiguous results', async t => {
  const f = fixture(t);
  const current = f.state.profile;
  f.store.findMembers.mock.mockImplementation(async () => [current,
    record('124', { mergedInto: '123' }), record('125', { canonicalMemberId: '123' }),
    record('126', { memberMerge: { canonicalMemberId: '123' } }), record('127', { status: 'deleted' })]);
  assert.equal((await f.callTool('members_find', { query: 'Fixture Member' })).members.length, 1);
  f.store.findMembers.mock.mockImplementation(async () => []);
  const missing = await f.callTool('members_find', { query: 'Missing Fixture' });
  assert.equal(missing.needsSelection, true);
  assert.deepEqual(missing.members, []);
  assert.match(missing.note, /StudioMate/);
  f.store.findMembers.mock.mockImplementation(async () => [current, record('124', { memberId: '124' })]);
  assert.equal((await f.callTool('members_find', { query: 'Fixture Member' })).needsSelection, true);
  noWrites(f);
});

test('overview projects ticket fields and preserves unknown freshness even for recent persistence', async t => {
  const f = fixture(t);
  const result = await f.callTool('members_get_overview', memberArgs);
  assert.equal(result.member.nativeMemberId, '123');
  assert.equal(result.member.linkVerified, true);
  assert.equal(result.tickets[0].remainingCount, 4);
  assert.equal(result.tickets[0].paymentAmount, 100);
  assert.equal(result.member.source.persistenceAge, 'recent');
  assert.equal(result.member.source.freshness, 'unknown');
  assert.equal(result.member.source.liveReadback, false);
  assert.equal(result.member.source.queriedAt, new Date(NOW).toISOString());
  for (const syncedAt of [null, 'invalid', new Date(NOW - 7200001).toISOString(), new Date(NOW + 1).toISOString()]) {
    f.state.profile.syncedAt = syncedAt;
    const stale = await f.callTool('members_get_overview', memberArgs);
    assert.equal(stale.member.source.persistenceAge, 'old_or_unknown');
    assert.equal(stale.member.source.freshness, 'unknown');
    assert.equal(stale.member.source.liveReadback, false);
  }
  f.state.profile.activeTickets = [];
  assert.deepEqual((await f.callTool('members_get_overview', memberArgs)).tickets, []);
  noWrites(f);
});

test('bookings keep canonical/fallback distinctions, filter dates, sort, and never execute', async t => {
  const f = fixture(t);
  const result = await f.callTool('bookings_list', { ...memberArgs, ...dates });
  assert.deepEqual(result.records.map(row => row.bookingId), ['excel_booking_1', 'booking-1', 'booking-2']);
  assert.equal(result.records[0].sourceKind, 'fallback');
  assert.equal(result.records[0].supersededByBookingId, 'booking-1');
  assert.equal(result.records[1].sourceKind, 'native_or_other');
  assert.equal(result.records[0].canonicalBookingKey, result.records[1].canonicalBookingKey);
  assert.equal(result.records[0].source.freshness, 'unknown');
  noWrites(f);
});

test('nested signature receipts, completion records, and waiting are separate states', async t => {
  const f = fixture(t);
  f.state.rows.studiomateMembershipContracts = [
    record('receipt', { status: 'signed', signatureReceipt: { authoritative: true, memberId: '123', studioId: '5330', contractId: 'receipt', signedAt: RECENT, checkedAt: RECENT,
      rawPayload: SECRET }, welcomeStatus: 'pending' }),
    record('completion', { status: 'completed', completion: { signedAt: RECENT, checkedAt: RECENT, memberId: '123',
      rawPayload: SECRET }, completedAt: RECENT }),
    record('waiting', { status: 'waiting_signature', stage: 'sent', sentAt: RECENT,
      observationStatus: 'waiting', observationHold: true, welcomeStatus: 'pending', lastError: SECRET }),
  ];
  const { contracts } = await f.callTool('contracts_get_progress', memberArgs);
  assert.deepEqual(contracts.map(row => row.signatureEvidence), ['native_receipt', 'completion_record', 'not_recorded']);
  assert.equal(contracts[0].signedAt, RECENT);
  assert.equal(contracts[0].signatureCheckedAt, RECENT);
  assert.equal(contracts[0].welcomeStatus, 'pending');
  assert.equal(contracts[1].signedAt, RECENT);
  assert.equal(contracts[1].completedAt, RECENT);
  assert.equal(contracts[2].signedAt, null);
  assert.equal(contracts[2].completedAt, null);
  assert.equal(contracts[2].status, 'waiting_signature');
  assert.equal(contracts[2].observationHold, true);
  assert.equal(contracts[2].errorPresent, true);
  assert.ok(!JSON.stringify(contracts).includes(SECRET));
  noWrites(f);
});

test('message dates use KST and done/message IDs do not claim verified delivery', async t => {
  const f = fixture(t);
  f.state.rows.alimtalkCandidates.push(
    record('kst-start', { createdAt: '2026-09-30T15:00:00Z' }),
    record('before-start', { createdAt: '2026-09-30T14:59:59Z' }),
    record('unknown', { createdAt: null }),
  );
  f.state.rows.alimtalkSends.push(record('kst-end', { createdAt: '2026-10-31T14:59:59Z' }),
    record('after-end', { createdAt: '2026-10-31T15:00:00Z' }), record('invalid', { createdAt: 'invalid' }));
  const result = await f.callTool('messages_get_delivery', { ...memberArgs, ...dates });
  assert.equal(result.dateBasis, 'createdAt_Asia_Seoul');
  assert.equal(result.observedUnknownDateRecords, 2);
  assert.deepEqual(result.candidates.map(row => row.recordId), ['candidate-1', 'kst-start']);
  assert.deepEqual(result.sends.map(row => row.recordId), ['send-1', 'kst-end']);
  assert.equal(result.sends[0].status, 'done');
  assert.equal(result.sends[0].solapiMessageId, 'fixture-message');
  assert.equal(result.providerLiveChecked, false);
  assert.equal(result.candidates[0].reasonCode, 'not_exposed');
  noWrites(f);
});

test('job reads distinguish saved memos, pending copies, and absent jobs', async t => {
  const f = fixture(t);
  const pending = await f.callTool('operations_get_job', { kind: 'memo', jobId: 'memo-1' });
  assert.equal(pending.found, true);
  assert.equal(pending.job.memoSaved, true);
  assert.equal(pending.job.status, 'pending');
  assert.equal(pending.job.writtenAt, null);
  assert.equal(pending.job.errorPresent, true);
  f.state.memos.clear();
  assert.equal((await f.callTool('operations_get_job', { kind: 'memo', jobId: 'memo-1' })).job.memoSaved, false);
  assert.deepEqual((await f.callTool('operations_get_job', { kind: 'holding', jobId: 'absent' })).job, null);
  f.state.jobs.set('holding:hold-1', record('hold-1', { status: 'queued' }));
  assert.equal((await f.callTool('operations_get_job', { kind: 'holding', jobId: 'hold-1' })).job.memoSaved, null);
  noWrites(f);
});

test('operator revocation is enforced again on every tool call', async t => {
  const f = fixture(t, { memoWritesEnabled: true });
  await f.callTool('members_get_overview', memberArgs);
  for (const operator of [null, { active: false, role: 'manager', studioId: '5330' },
    { active: true, role: 'teacher', studioId: '5330' }, { active: true, role: 'owner', studioId: 'other' }]) {
    f.state.operator = operator;
    const profileReads = f.store.getProfile.mock.callCount();
    for (const [name, args] of [...readCalls,
      ['memos_prepare', { ...memberArgs, content: 'Fixture' }], ['memos_commit', { proposalId: 'p-1' }]]) {
      await rejectsCode(f.callTool(name, args), 'PERMISSION_DENIED');
    }
    assert.equal(f.store.getProfile.mock.callCount(), profileReads);
  }
  noWrites(f);
});

test('cross-studio profiles and mismatched member identities fail closed', async t => {
  for (const patch of [{ studioId: 'other' }, { _id: 'different' }, { memberId: 'different' }]) {
    const f = fixture(t);
    Object.assign(f.state.profile, patch);
    await rejectsCode(f.callTool('members_get_overview', memberArgs), 'MEMBER_NOT_FOUND');
    noWrites(f);
  }
});

test('cross-studio ledger rejections propagate from the store without partial results', async t => {
  const f = fixture(t);
  f.store.getRows.mock.mockImplementation(async () => { throw new OperationError('SOURCE_SCOPE_MISMATCH', 'Fixture scope.'); });
  f.store.getJob.mock.mockImplementation(async () => { throw new OperationError('SOURCE_SCOPE_MISMATCH', 'Fixture scope.'); });
  for (const [name, args] of readCalls.filter(([name]) => ['bookings_list', 'contracts_get_progress', 'messages_get_delivery', 'operations_get_job'].includes(name))) {
    await rejectsCode(f.callTool(name, args), 'SOURCE_SCOPE_MISMATCH');
  }
  noWrites(f);
});

function alias(f) {
  f.state.profile = { ...f.state.profile, _id: 'excel_fixture', memberId: 'excel_fixture',
    studiomateMemberId: '123', studiomateMemberIdResolvedAt: RECENT };
  f.state.lookup = { status: 'done', memberId: 'excel_fixture', studioId: '5330', studiomateMemberId: '123',
    memberName: 'Fixture Member', memberPhone: '010-1234-5678', resolvedAt: RECENT };
  return { memberId: 'excel_fixture' };
}

test('aliases require matching persisted resolution proof and query both IDs only after proof', async t => {
  const f = fixture(t);
  const args = alias(f);
  const overview = await f.callTool('members_get_overview', args);
  assert.equal(overview.member.nativeMemberId, null);
  assert.equal(overview.member.linkedNativeMemberId, '123');
  assert.equal(overview.member.linkVerified, false);
  for (const [name, extra] of [['bookings_list', dates], ['contracts_get_progress', {}], ['messages_get_delivery', dates]]) {
    await f.callTool(name, { ...args, ...extra });
  }
  assert.equal(f.store.getLookup.mock.callCount(), 3);
  for (const call of f.store.getRows.mock.calls) assert.deepEqual(call.arguments[1], ['excel_fixture', '123']);
  noWrites(f);
});

test('missing, mismatched, and stale-resolution aliases cannot silently show partial ledgers', async t => {
  for (const patch of [null, { status: 'pending' }, { studioId: 'other' }, { memberId: 'excel_other' },
    { studiomateMemberId: '124' }, { memberName: 'Other' }, { memberPhone: '01000000000' },
    { resolvedAt: null }, { resolvedAt: new Date(NOW - 120000).toISOString() }]) {
    const f = fixture(t);
    const args = alias(f);
    f.state.lookup = patch === null ? null : { ...f.state.lookup, ...patch };
    for (const [name, extra] of [['bookings_list', dates], ['contracts_get_progress', {}], ['messages_get_delivery', dates]]) {
      await rejectsCode(f.callTool(name, { ...args, ...extra }), 'SOURCE_ID_UNRESOLVED');
    }
    assert.equal(f.store.getRows.mock.callCount(), 0);
    noWrites(f);
  }
});

test('strict catalog rejects unknown names, extra keys, missing fields, wrong types and invalid enums', async t => {
  const invalid = [
    ['unknown_tool', {}], ['members_find', null], ['members_find', []], ['members_find', { query: 123 }],
    ['members_find', { query: '' }], ['members_find', { query: 'x'.repeat(51) }],
    ['members_get_overview', {}], ['members_get_overview', { memberId: '123', extra: 'forbidden' }],
    ['bookings_list', { ...memberArgs, startDate: dates.startDate }],
    ['messages_get_delivery', { ...memberArgs, ...dates, limit: 5 }],
    ['operations_get_job', { kind: 'send_everything', jobId: 'job-1' }],
    ['memos_prepare', { ...memberArgs, content: 'x'.repeat(1001) }],
    ['memos_commit', { proposalId: 'p-1', approved: 'true' }],
  ];
  const f = fixture(t);
  for (const [name, args] of invalid) {
    assert.equal(validate(name, args), false, name);
    await rejectsCode(f.callTool(name, args), 'INVALID_ARGUMENT');
  }
  assert.equal(f.store.getOperator.mock.callCount(), 0);
  noWrites(f);
});

test('strict schema also rejects keys inherited from Object.prototype', () => {
  for (const key of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
    const args = { memberId: '123', [key]: 'forbidden' };
    assert.equal(validate('members_get_overview', args), false, key);
  }
});

test('invalid identifiers and non-exact or incomplete searches are rejected', async t => {
  const f = fixture(t);
  for (const memberId of ['a/b', '../member', 'member space']) {
    await rejectsCode(f.callTool('members_get_overview', { memberId }), 'INVALID_ARGUMENT');
  }
  for (const query of ['x', '   ', '12345678', '010-1234', 'Fixture\u0000Member']) {
    await rejectsCode(f.callTool('members_find', { query }), 'INVALID_ARGUMENT');
  }
  assert.equal(f.store.findMembers.mock.callCount(), 0);
  noWrites(f);
});

test('both ranged tools accept 31 inclusive days and reject 32, reversals and nonexistent dates', async t => {
  const f = fixture(t);
  for (const name of ['bookings_list', 'messages_get_delivery']) {
    assert.equal((await f.callTool(name, { ...memberArgs, ...dates })).ok, true);
    assert.equal((await f.callTool(name, { ...memberArgs, startDate: '2028-02-29', endDate: '2028-02-29' })).ok, true);
    for (const [startDate, endDate] of [
      ['2026-10-01', '2026-11-01'], ['2026-10-31', '2026-10-01'],
      ['2026-02-29', '2026-03-01'], ['2026-02-30', '2026-03-01'],
      ['2026-13-01', '2026-13-02'], ['2026-10-00', '2026-10-01'],
      ['2026-1-01', '2026-01-02'], ['not-a-date', '2026-10-01'],
    ]) {
      const before = f.store.getRows.mock.callCount();
      await rejectsCode(f.callTool(name, { ...memberArgs, startDate, endDate }), 'INVALID_ARGUMENT');
      assert.equal(f.store.getRows.mock.callCount(), before);
    }
  }
  noWrites(f);
});

test('SOURCE_LIMIT propagates rather than returning a truncated success', async t => {
  const f = fixture(t);
  for (const activeTickets of [Array.from({ length: 101 }, () => ({})), { rawPayload: SECRET }]) {
    f.state.profile.activeTickets = activeTickets;
    await rejectsCode(f.callTool('members_get_overview', memberArgs), 'SOURCE_LIMIT');
  }
  for (const failedCollection of ['bookings', 'studiomateMembershipContracts', 'alimtalkCandidates', 'alimtalkSends']) {
    f.store.getRows.mock.mockImplementation(async collection => {
      if (collection === failedCollection) throw new OperationError('SOURCE_LIMIT', 'Fixture limit.');
      return f.state.rows[collection];
    });
    const name = failedCollection === 'bookings' ? 'bookings_list'
      : failedCollection === 'studiomateMembershipContracts' ? 'contracts_get_progress' : 'messages_get_delivery';
    await rejectsCode(f.callTool(name, name === 'contracts_get_progress' ? memberArgs : { ...memberArgs, ...dates }), 'SOURCE_LIMIT');
  }
  noWrites(f);
});

test('memo preparation is local-only, normalized, masked and never automatically approved or committed', async t => {
  const f = fixture(t);
  const before = structuredClone(f.state.profile);
  const result = await f.callTool('memos_prepare', { ...memberArgs, content: '  Fixture\r\nmemo  ' });
  assert.equal(result.ok, true);
  assert.equal(result.writesEnabled, false);
  assert.equal(result.proposal.content, 'Fixture\nmemo');
  assert.equal(result.proposal.maskedPhone, '010-****-5678');
  assert.ok(!JSON.stringify(result).includes(PHONE));
  assert.equal(f.approvals.prepare.mock.callCount(), 1);
  const [input, at] = f.approvals.prepare.mock.calls[0].arguments;
  assert.equal(input.sourceHash, sourceHash(before));
  assert.equal(input.staffId, 'staff-1');
  assert.equal(at, NOW);
  assert.deepEqual(f.state.profile, before);
  assert.equal(f.state.approved.size, 0);
  assert.equal(f.approvals.loadApproved.mock.callCount(), 0);
  assert.equal(f.store.commitMemo.mock.callCount(), 0);
  assert.equal(f.state.commits.size, 0);
});

test('memo preparation rejects stale, unresolved, merged, ineligible and invalid-phone sources', async t => {
  const cases = [
    [{ syncedAt: null }, 'SOURCE_STALE'], [{ syncedAt: new Date(NOW - 7200001).toISOString() }, 'SOURCE_STALE'],
    [{ syncedAt: new Date(NOW + 1).toISOString() }, 'SOURCE_STALE'],
    [{ _id: 'excel_fixture', memberId: 'excel_fixture' }, 'SOURCE_ID_UNRESOLVED'],
    [{ externalActionEligible: false }, 'SOURCE_ID_UNRESOLVED'], [{ phone: 'invalid' }, 'SOURCE_ID_UNRESOLVED'],
    [{ mergedInto: '124' }, 'SOURCE_CHANGED'], [{ memberMerge: { canonicalMemberId: '124' } }, 'SOURCE_CHANGED'],
  ];
  for (const [patch, code] of cases) {
    const f = fixture(t);
    Object.assign(f.state.profile, patch);
    await rejectsCode(f.callTool('memos_prepare', { memberId: f.state.profile.memberId, content: 'Fixture' }), code);
    noWrites(f);
  }
  const f = fixture(t);
  for (const content of ['   ', 'Fixture\u0000memo']) {
    await rejectsCode(f.callTool('memos_prepare', { ...memberArgs, content }), 'INVALID_ARGUMENT');
  }
  noWrites(f);
});

test('commit is disabled by default before any approval load or storage mutation', async t => {
  const f = fixture(t);
  await rejectsCode(f.callTool('memos_commit', { proposalId: 'proposal-1' }), 'WRITE_DISABLED');
  noWrites(f);
});

test('enabled commits propagate missing, expired and staff-mismatched approval failures', async t => {
  const f = fixture(t, { memoWritesEnabled: true });
  await rejectsCode(f.callTool('memos_commit', { proposalId: 'missing' }), 'PROPOSAL_EXPIRED');
  const result = await f.callTool('memos_prepare', { ...memberArgs, content: 'Fixture memo' });
  const proposalId = result.proposal.proposalId;
  await rejectsCode(f.callTool('memos_commit', { proposalId }), 'APPROVAL_REQUIRED');
  f.state.approved.add(proposalId);
  const proposal = f.state.proposals.get(proposalId);
  proposal.staffId = 'different-staff';
  await rejectsCode(f.callTool('memos_commit', { proposalId }), 'APPROVAL_REQUIRED');
  proposal.staffId = 'staff-1';
  proposal.expiresAt = NOW;
  await rejectsCode(f.callTool('memos_commit', { proposalId }), 'PROPOSAL_EXPIRED');
  assert.equal(f.store.commitMemo.mock.callCount(), 0);
});

test('commit revalidates the canonical profile and does not run after role revocation', async t => {
  const f = fixture(t, { memoWritesEnabled: true });
  const proposalId = await prepareApproved(f);
  f.state.operator.active = false;
  await rejectsCode(f.callTool('memos_commit', { proposalId }), 'PERMISSION_DENIED');
  assert.equal(f.approvals.loadApproved.mock.callCount(), 0);
  f.state.operator.active = true;
  f.state.profile.syncedAt = null;
  await rejectsCode(f.callTool('memos_commit', { proposalId }), 'SOURCE_STALE');
  assert.equal(f.store.commitMemo.mock.callCount(), 0);
});

test('commit supplies source guards and propagates a fake-store source change without retry', async t => {
  const f = fixture(t, { memoWritesEnabled: true });
  const proposalId = await prepareApproved(f);
  f.state.profile.name = 'Changed Fixture';
  await rejectsCode(f.callTool('memos_commit', { proposalId }), 'SOURCE_CHANGED');
  assert.equal(f.store.commitMemo.mock.callCount(), 1);
  assert.equal(f.state.commits.size, 0);
  const [{ proposal, actor, sourceHash: compare, validateProfile, now }] = f.store.commitMemo.mock.calls[0].arguments;
  assert.equal(proposal.proposalId, proposalId);
  assert.equal(actor.staffId, 'staff-1');
  assert.equal(compare, sourceHash);
  assert.equal(now, NOW);
  assert.throws(() => validateProfile({ ...f.state.profile, studioId: 'other' }), { code: 'MEMBER_NOT_FOUND' });
});

test('duplicate commits surface store idempotence and never claim StudioMate completion', async t => {
  const f = fixture(t, { memoWritesEnabled: true });
  const proposalId = await prepareApproved(f);
  const first = await f.callTool('memos_commit', { proposalId });
  const second = await f.callTool('memos_commit', { proposalId });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.jobId, second.jobId);
  assert.equal(first.status, 'pending');
  assert.equal(first.studioMateVerified, false);
  assert.equal(second.studioMateVerified, false);
  const newProposalId = await prepareApproved(f);
  assert.notEqual(newProposalId, proposalId);
  const third = await f.callTool('memos_commit', { proposalId: newProposalId });
  assert.equal(third.duplicate, true);
  assert.equal(third.jobId, first.jobId);
  assert.equal(third.studioMateVerified, false);
  assert.equal(f.state.commits.size, 1);
  assert.equal(f.store.commitMemo.mock.callCount(), 3);
  assert.equal(f.approvals.prepare.mock.callCount(), 2);
});

test('safeError exposes only explicit OperationError fields and hides raw failures', () => {
  const safe = Object.assign(new OperationError('SOURCE_LIMIT', 'Fixture limit.'), { privateDetails: SECRET });
  assert.deepEqual(safeError(safe), { code: 'SOURCE_LIMIT', message: 'Fixture limit.' });
  for (const error of [new Error(SECRET), { safe: true, code: 'PRIVATE', message: SECRET }, SECRET, null]) {
    const result = safeError(error);
    assert.equal(result.code, 'SOURCE_UNAVAILABLE');
    assert.ok(!JSON.stringify(result).includes(SECRET));
    assert.ok(!JSON.stringify(result).includes('stack'));
  }
});
