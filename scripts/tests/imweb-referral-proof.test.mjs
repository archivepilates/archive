import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readPointAwardProof } from '../lib/imweb-referral-proof.mjs';
import { referralKey } from '../lib/imweb-referral-policy.mjs';
import { IMWEB_REFERRAL_SCOPE as scope } from '../lib/imweb-referral-source.mjs';

const inviter = Object.freeze({ ...scope, memberCode: 'proof-test-inviter', uid: 'proof-test-uid' });
const rewardKey = 'a'.repeat(64);
const record = Object.freeze({ rewardKey, inviterKey: referralKey(inviter),
  providerReason: `imweb-referral:${rewardKey}`, amountWon: 3000,
  createdAt: '2026-09-15T01:00:00.750Z' });
const now = '2026-09-15T01:01:00.250Z';
const context = { resolved_profile: { site_code: scope.siteCode, unit_code: scope.unitCode } };
const row = (extra = {}) => ({ changePoint: 3000, currency: 'KRW', expireTime: null,
  memberCode: inviter.memberCode, memberUid: inviter.uid, reason: record.providerReason,
  time: '2026-09-15T01:00:01.000Z', type: 'etc', unitCode: scope.unitCode, ...extra });
const other = (extra = {}) => row({ reason: 'unrelated-test-adjustment', ...extra });
const page = (list, { currentPage = 1, pageSize = 50, totalCount = list.length,
  totalPage = Math.ceil(totalCount / pageSize) } = {}) =>
  ({ data: { currentPage, pageSize, totalCount, totalPage, list } });

function fakeCli(pages, { pageSize = 50, resolvedContext = context } = {}) {
  const calls = [];
  let index = 0;
  const run = args => {
    calls.push([...args]);
    if (args[0] === 'config') {
      assert.deepEqual(args, ['config', 'context']);
      assert.equal(calls.length, 1, 'Scope must be checked before reading logs');
      return structuredClone(resolvedContext);
    }
    // This allowlist rejects writes, dry runs, and any additional CLI operation.
    assert.deepEqual(args, ['promotion', 'point', 'log', '--unit-code', scope.unitCode,
      '--member-uid', inviter.uid, '--page', String(index + 1), '--limit', String(pageSize)]);
    assert.ok(index < pages.length, 'Unexpected page request');
    return structuredClone(pages[index++]);
  };
  return { run, calls };
}

function readRows(rows, options = {}) {
  const cli = fakeCli([page(rows)]);
  return readPointAwardProof({ inviter, record }, { now, ...options, run: cli.run });
}

function failsClosed(operation, label) {
  assert.throws(operation, error => error instanceof Error && !(error instanceof assert.AssertionError), label);
}

test('one exact award is verified only after all pages using config and point-log reads', () => {
  const cli = fakeCli([row(), other({ changePoint: -3000 }), other({ reason: 'another-test-adjustment' })]
    .map((item, index) => page([item], { pageSize: 1, currentPage: index + 1, totalCount: 3 })), { pageSize: 1 });
  const proof = readPointAwardProof({ inviter, record }, { run: cli.run, pageSize: 1, now });
  assert.deepEqual(proof, { sourceVerified: true, member: inviter, amountWon: 3000,
    reason: record.providerReason, logId: proof.logId });
  assert.match(proof.logId, /^imweb-log-fingerprint:[a-f0-9]{64}$/);
  assert.equal(cli.calls.length, 4);
  assert.equal(cli.calls[0][0], 'config');
  assert.deepEqual(cli.calls.slice(1).map(args => args[8]), ['1', '2', '3']);
});

test('absent or nonidentical same-reason rows return null; identical row signatures throw', () => {
  for (const rows of [[], [other()], [row({ reason: `${record.providerReason}-suffix` })],
    [row({ reason: `prefix-${record.providerReason}` })]]) {
    assert.equal(readRows(rows), null);
  }
  for (const second of [row({ time: '2026-09-15T01:00:02.000Z' }), row({ changePoint: -3000 })]) {
    assert.equal(readRows([row(), second]), null);
    const cli = fakeCli([row(), second].map((item, index) =>
      page([item], { pageSize: 1, currentPage: index + 1, totalCount: 2 })), { pageSize: 1 });
    assert.equal(readPointAwardProof({ inviter, record }, { run: cli.run, pageSize: 1, now }), null);
    assert.equal(cli.calls.length, 3);
  }
  for (const original of [row(), other()]) {
    const duplicate = { ...Object.fromEntries(Object.entries(original).reverse()), ignoredMetadata: 'not-an-id' };
    assert.throws(() => readRows([original, duplicate]), /Duplicate point-log rows/);
    const cli = fakeCli([original, duplicate].map((item, index) =>
      page([item], { pageSize: 1, currentPage: index + 1, totalCount: 2 })), { pageSize: 1 });
    assert.throws(() => readPointAwardProof({ inviter, record }, { run: cli.run, pageSize: 1, now }),
      /Duplicate point-log rows/);
    assert.equal(cli.calls.length, 3);
  }
});

test('reversal, wrong amount, currency, or type cannot prove a positive 3000 KRW award', () => {
  for (const extra of [{ changePoint: -3000 }, { changePoint: 0 }, { changePoint: 2999 },
    { changePoint: 3001 }, { currency: 'USD' }, { currency: 'krw' }, { currency: null },
    { currency: undefined }, { type: 'purchase' }, { type: 'ETC' }, { type: null }, { type: undefined }]) {
    assert.equal(readRows([row(extra)]), null, JSON.stringify(extra));
  }
});

test('wrong recipient or unit fails closed even on an unrelated row after the matching page', () => {
  for (const extra of [{ memberCode: 'different-member' }, { memberUid: 'different-uid' },
    { unitCode: 'different-unit' }, { memberCode: undefined }, { memberUid: undefined }, { unitCode: undefined }]) {
    const cli = fakeCli([row(), other(extra)].map((item, index) =>
      page([item], { pageSize: 1, currentPage: index + 1, totalCount: 2 })), { pageSize: 1 });
    failsClosed(() => readPointAwardProof({ inviter, record }, { run: cli.run, pageSize: 1, now }), JSON.stringify(extra));
    assert.equal(cli.calls.length, 3);
  }
});

test('canonical scope, reward record, and CLI context must agree before log reads', () => {
  const invalidInputs = [
    { inviter: null }, { inviter: { ...inviter, siteCode: 'wrong-site' } },
    { inviter: { ...inviter, unitCode: 'wrong-unit' } }, { inviter: { ...inviter, uid: ' ' } },
    { inviter: { ...inviter, memberCode: 'different-member' } }, { record: null },
    ...[{ inviterKey: 'b'.repeat(64) }, { rewardKey: 'a'.repeat(63) }, { rewardKey: 'g'.repeat(64) },
      { providerReason: `imweb-referral:${'b'.repeat(64)}` }, { amountWon: 2999 }, { amountWon: '3000' },
      { createdAt: 'invalid' }, { createdAt: '2026-09-15T01:00:00' }]
      .map(extra => ({ record: { ...record, ...extra } })),
  ];
  for (const input of invalidInputs) {
    const cli = fakeCli([]);
    failsClosed(() => readPointAwardProof({ inviter, record, ...input }, { run: cli.run, now }));
    assert.deepEqual(cli.calls, []);
  }
  for (const resolvedContext of [{}, { resolved_profile: null },
    { resolved_profile: { ...context.resolved_profile, site_code: 'wrong-site' } },
    { resolved_profile: { ...context.resolved_profile, unit_code: 'wrong-unit' } }]) {
    const cli = fakeCli([], { resolvedContext });
    failsClosed(() => readPointAwardProof({ inviter, record }, { run: cli.run, now }));
    assert.deepEqual(cli.calls, [['config', 'context']]);
  }
});

test('timestamp bounds include exactly one second tolerance but exclude the next millisecond', () => {
  for (const timestamp of ['2026-09-15T00:59:59.750Z', '2026-09-15T01:00:00Z',
    record.createdAt, now, '2026-09-15T01:01:01.250Z']) {
    assert.equal(readRows([row({ time: timestamp })]).sourceVerified, true, timestamp);
  }
  for (const timestamp of ['2026-09-15T00:59:59.749Z', '2026-09-15T01:01:01.251Z']) {
    assert.equal(readRows([row({ time: timestamp })]), null, timestamp);
  }
  for (const invalidNow of ['invalid', '2026-09-15T01:01:00', null]) {
    const cli = fakeCli([]);
    failsClosed(() => readPointAwardProof({ inviter, record }, { run: cli.run, now: invalidNow }));
    assert.deepEqual(cli.calls, []);
  }
});

test('incomplete scans and changing page metadata throw even after finding a matching row', () => {
  const cases = [
    { pageSize: 1, maxPages: 1, pages: [page([row()], { pageSize: 1, totalCount: 2 })] },
    { pageSize: 1, pages: [page([row()], { pageSize: 1, totalCount: 2 }),
      page([], { pageSize: 1, currentPage: 2, totalCount: 2 })] },
    { pageSize: 2, pages: [page([row(), other()], { pageSize: 2, totalCount: 4 }),
      page([other()], { pageSize: 2, currentPage: 2, totalCount: 3 })] },
    { pageSize: 1, pages: [page([row()], { pageSize: 1, totalCount: 2 }),
      page([other()], { pageSize: 1, currentPage: 2, totalCount: 3 })] },
    { pageSize: 1, pages: [page([row()], { pageSize: 1, totalCount: 2 }),
      page([other()], { pageSize: 1, currentPage: 1, totalCount: 2 })] },
    { pageSize: 1, pages: [page([row()], { pageSize: 1, totalCount: 2 }),
      page([other()], { pageSize: 2, currentPage: 2, totalCount: 2 })] },
    { pageSize: 1, pages: [page([row()], { pageSize: 1, totalCount: 3 }),
      page([row({ changePoint: -3000 })], { pageSize: 1, currentPage: 2, totalCount: 3 }), { data: null }] },
  ];
  for (const { pages, pageSize, maxPages = 10 } of cases) {
    const cli = fakeCli(pages, { pageSize });
    failsClosed(() => readPointAwardProof({ inviter, record }, { run: cli.run, pageSize, maxPages, now }));
  }
  const shortPage = fakeCli([page([row()], { pageSize: 2, totalCount: 3 })], { pageSize: 2 });
  assert.throws(() => readPointAwardProof({ inviter, record }, { run: shortPage.run, pageSize: 2, now }),
    /Invalid point-log response/);
  assert.equal(shortPage.calls.length, 2, 'A short nonfinal page must fail immediately');
  const cli = fakeCli([page([row()], { pageSize: 1, totalCount: 2 })], { pageSize: 1 });
  const run = args => {
    if (args[0] === 'promotion' && args[8] === '2') throw new Error('Synthetic page read failure');
    return cli.run(args);
  };
  failsClosed(() => readPointAwardProof({ inviter, record }, { run, pageSize: 1, now }));
});

test('malformed response metadata and rows cannot be mistaken for an empty or verified scan', () => {
  const malformedData = [{ list: null }, { list: {} }, { currentPage: '1' }, { currentPage: 0 },
    { pageSize: '50' }, { pageSize: 49 }, { totalCount: -1 }, { totalCount: 1.5 }, { totalCount: '1' },
    { totalCount: Number.MAX_SAFE_INTEGER + 1 }, { totalPage: -1 }, { totalPage: 1.5 },
    { totalPage: '1' }, { totalPage: 2 }, { totalCount: 2 }, { totalCount: 0, totalPage: 0 },
    { list: Array.from({ length: 51 }, () => other()), totalCount: 51, totalPage: 2 }];
  for (const response of [null, undefined, {}, { data: null },
    ...malformedData.map(extra => ({ data: { ...page([row()]).data, ...extra } }))]) {
    const cli = fakeCli([response]);
    failsClosed(() => readPointAwardProof({ inviter, record }, { run: cli.run, now }));
  }
  for (const invalidRow of [null, {}, ...[{ changePoint: '3000' }, { changePoint: 3000.5 },
    { changePoint: NaN }, { changePoint: Infinity }, { changePoint: Number.MAX_SAFE_INTEGER + 1 },
    { reason: null }, { reason: 3000 }, { time: 'invalid' }, { time: '2026-09-15T01:00:01' },
    { time: undefined }].map(extra => row(extra))]) {
    failsClosed(() => readRows([invalidRow]));
  }
});

test('invalid scan limits fail before invoking the fake CLI', () => {
  for (const options of [{ maxPages: 0 }, { maxPages: -1 }, { maxPages: 101 }, { maxPages: 1.5 },
    { maxPages: '10' }, { maxPages: Infinity }, { pageSize: 0 }, { pageSize: -1 }, { pageSize: 51 },
    { pageSize: 1.5 }, { pageSize: '50' }, { pageSize: NaN }]) {
    const cli = fakeCli([]);
    failsClosed(() => readPointAwardProof({ inviter, record }, { run: cli.run, now, ...options }));
    assert.deepEqual(cli.calls, []);
  }
});

test('fingerprint is a stable derived reference over fixed fields, not a provider log ID', () => {
  const original = row();
  assert.equal(Object.hasOwn(original, 'id'), false);
  assert.equal(Object.hasOwn(original, 'logId'), false);
  const expected = createHash('sha256').update(JSON.stringify([scope.siteCode, scope.unitCode,
    inviter.memberCode, inviter.uid, original.time, record.providerReason, 3000, 'KRW', 'etc'])).digest('hex');
  const proof = readRows([original]);
  assert.equal(proof.logId, `imweb-log-fingerprint:${expected}`);
  assert.equal(readRows([structuredClone(original)]).logId, proof.logId);
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  assert.equal(readRows([other(), { ...reordered, unrelatedMetadata: 'ignored' }]).logId, proof.logId);
  assert.notEqual(readRows([row({ time: '2026-09-15T01:00:02.000Z' })]).logId, proof.logId);
  const secondRecord = { ...record, rewardKey: 'b'.repeat(64), providerReason: `imweb-referral:${'b'.repeat(64)}` };
  const cli = fakeCli([page([row({ reason: secondRecord.providerReason })])]);
  assert.notEqual(readPointAwardProof({ inviter, record: secondRecord }, { run: cli.run, now }).logId, proof.logId);
});
