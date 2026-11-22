import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { createService } from '../src/service.mjs';
import { createHistoryReader, historyResult } from '../src/history-reader.mjs';

const project = 'vrmtkewdqgcrhpbeijhr';
const now = Date.parse('2026-11-20T12:00:00Z');
const memberId = '123456';
const input = { memberId, month: '2026-09' };
const info = { month: input.month, observedAt: '2026-09-30T15:00:00Z', loadedAt: '2026-10-01T00:00:00Z' };
const history = { state: 'member_found', ...info, name: 'Synthetic Member',
  attendance: [{ day: '2026-09-01', type: 'group', status: 'attendance', rawId: 'do-not-expose' }],
  purchaseEvents: [{ day: '2026-09-10', kind: 'payment', amount: 21_000 }] };
const partial = { state: 'partial_member_found', month: '2026-10', scope: 'booking_issued_pass_only',
  observedAt: '2026-11-21T07:09:20.371Z', loadedAt: '2026-11-22T00:00:00Z',
  bookings: [{ day: '2026-10-01', type: 'group', status: 'attendance', passRef: 1 }],
  issuedPasses: [{ ref: 1 }] };

test('history validates bounds and response projection, keeps no-data states separate', () => {
  assert.deepEqual(historyResult(history, input.month, now).history, {
    nameAtLoad: history.name, attendance: [{ day: '2026-09-01', type: 'group', status: 'attendance' }],
    purchaseEvents: [{ day: '2026-09-10', kind: 'payment' }],
  });
  assert.equal(historyResult({ state: 'not_loaded', month: input.month }, input.month, now).status, 'not_loaded');
  assert.equal(historyResult({ state: 'no_member_rows', ...info }, input.month, now).status, 'no_member_rows');
  assert.equal(historyResult(history, input.month, now).source.allowedForExternalActions, false);
  assert.throws(() => historyResult({ ...history, observedAt: '2026-09-29' }, input.month, now), { code: 'HISTORY_EVIDENCE_INVALID' });
  assert.throws(() => historyResult({ ...history, attendance: [{ day: '2026-09-32' }] }, input.month, now), { code: 'HISTORY_EVIDENCE_INVALID' });
  assert.throws(() => historyResult({ ...info, state: 'record_limit' }, input.month, now), { code: 'HISTORY_LIMIT' });
  assert.throws(() => historyResult({ ...history, name: 'Identifying1234567' }, input.month, now), { code: 'HISTORY_EVIDENCE_INVALID' });
});

test('October is explicitly partial and projects only verified booking fields and temporary pass references', () => {
  const when = Date.parse('2026-11-22T12:00:00Z');
  const view = v => historyResult(v, '2026-10', when);
  const result = view({ ...partial, name: 'private', purchaseEvents: [{ kind: 'refund' }],
    bookings: [{ ...partial.bookings[0], bookingKey: 'private' }],
    issuedPasses: [{ ref: 1, passKey: 'private' }] });
  assert.deepEqual(result.history, { bookings: partial.bookings, issuedPasses: partial.issuedPasses });
  assert.equal(result.source.coverage, 'verified_subset');
  assert.equal(result.source.transactionCoverage, 'not_collected');
  assert.equal(result.source.allowedForExternalActions, false);
  assert.equal(view({ ...partial, state: 'partial_no_verified_rows' }).history, null);
  assert.equal(view({ ...partial, state: 'not_loaded' }).status, 'not_loaded');
  for (const invalid of [
    { ...partial, state: 'member_found' },
    { ...partial, scope: 'full' },
    { ...partial, issuedPasses: [{ ref: 2 }] },
    { ...partial, issuedPasses: [{ ref: 1 }, { ref: 2 }] },
    { ...partial, bookings: [{ ...partial.bookings[0], status: 'booked' }] },
    { ...partial, bookings: [{ ...partial.bookings[0], day: '2026-11-01' }] },
  ]) assert.throws(() => view(invalid), { code: 'HISTORY_EVIDENCE_INVALID' });
});

test('operator role and fresh live member search are required; defaults keep the existing catalog', async () => {
  let actorIsActive = true, time = now, reads = 0;
  const options = { staffId: 'operator', readOnly: true, now: () => time,
    store: { getOperator: async () => ({ active: actorIsActive, role: 'owner', studioId: '5330' }) },
    liveReader: { findMembers: async () => ({
      members: [{ memberId, name: 'Synthetic Member', phone: '01000000000' }], checkedAt: new Date(time).toISOString(),
    }) } };
  const service = createService({ ...options, historyReader: async () => { reads++; return { ok: true }; } });
  const name = 'history_get_member_month';
  assert.equal(createService(options).listTools().some(item => item.name === name), false);
  assert.equal(service.listTools().find(item => item.name === name).annotations.readOnlyHint, true);
  await assert.rejects(service.callTool(name, input), { code: 'LIVE_SELECTION_REQUIRED' });
  await assert.rejects(service.callTool(name, { ...input, memberId: 'excel_fixture' }), { code: 'INVALID_ARGUMENT' });
  await service.callTool('members_find', { query: 'Synthetic Member' });
  await assert.rejects(service.callTool(name, { ...input, month: '2026-11' }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(service.callTool(name, { ...input, memberId: '123457' }), { code: 'LIVE_SELECTION_REQUIRED' });
  await service.callTool(name, input);
  actorIsActive = false;
  await assert.rejects(service.callTool(name, input), { code: 'PERMISSION_DENIED' });
  actorIsActive = true; time += 10 * 60_000;
  await assert.rejects(service.callTool(name, input), { code: 'LIVE_SELECTION_REQUIRED' });
  assert.equal(reads, 1);
});

test('reader binds only the HMAC, enforces usage and TLS, closes and redacts failures', async () => {
  const hmacKey = '11'.repeat(32);
  const privateSettings = { project, host: 'aws-7-ap-northeast-2.pooler.supabase.com', hmacKey,
    ca: '-----BEGIN CERTIFICATE-----fixture', password: 'x'.repeat(28) };
  let config = privateSettings, usage = { project, observedAt: new Date(now).toISOString(), egressBytes: 0 };
  let connects = 0, closes = 0, fail = false;
  const read = async file => file.endsWith('.usage.json') ? usage : config;
  class Client {
    constructor(options) {
      assert.equal(options.user, `archive_history_mcp_reader.${project}`);
      assert.equal(options.ssl.rejectUnauthorized, true);
      assert.equal(options.host, privateSettings.host);
    }
    on() {}
    async connect() { connects++; }
    async end() { closes++; }
    async query(sql, values) {
      assert.match(sql, /^SELECT archive_history_ro.mcp_member_month\(\$1::text,\$2::date\)/);
      assert.deepEqual(values, [createHmac('sha256', Buffer.from(hmacKey, 'hex'))
        .update(`archive-ops:studiomate:5330:member:${memberId}`).digest('hex'), '2026-09-01']);
      if (fail) throw Error('sensitive provider failure');
      return { rows: [{ result: history }] };
    }
  }
  const lookup = createHistoryReader('/fixture', { read, Client, now: () => now });
  assert.equal((await lookup(input)).status, 'member_found');
  usage = { ...usage, egressBytes: 4_000_000_000 };
  await assert.rejects(lookup(input), { code: 'HISTORY_USAGE_HOLD' });
  usage = { ...usage, egressBytes: 0, observedAt: new Date(now - 86400_000).toISOString() };
  await assert.rejects(lookup(input), { code: 'HISTORY_USAGE_HOLD' });
  usage = { ...usage, observedAt: new Date(now).toISOString() };
  config = { ...config, host: 'not-supabase.example' };
  await assert.rejects(lookup(input), { code: 'SOURCE_UNAVAILABLE' });
  config = privateSettings; fail = true;
  await assert.rejects(lookup(input), e => e.code === 'SOURCE_UNAVAILABLE' && !e.message.includes('sensitive'));
  assert.deepEqual([connects, closes], [2, 2]);
});

test('October only binds the selected member HMAC to the dedicated function', async () => {
  const today = Date.parse('2026-11-22T12:00:00Z');
  const hmacKey = '11'.repeat(32);
  const read = async file => file.endsWith('.usage.json')
    ? { project, observedAt: new Date(today).toISOString(), egressBytes: 0 }
    : { project, host: `db.${project}.supabase.co`, hmacKey,
      ca: '-----BEGIN CERTIFICATE-----fixture', password: 'x'.repeat(28) };
  class Client {
    on() {}
    async connect() {}
    async end() {}
    async query(sql, values) {
      assert.equal(sql, 'SELECT archive_history_ro.mcp_october_booking_pass($1::text) AS result');
      assert.deepEqual(values, [createHmac('sha256', Buffer.from(hmacKey, 'hex'))
        .update(`archive-ops:studiomate:5330:member:${memberId}`).digest('hex')]);
      return { rows: [{ result: partial }] };
    }
  }
  const result = await createHistoryReader('/fixture', { read, Client, now: () => today })({ memberId, month: '2026-10' });
  assert.equal(result.status, 'partial_member_found');
});
