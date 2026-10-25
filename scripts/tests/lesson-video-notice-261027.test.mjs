import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  PURPOSE, DUE_AT, EXPIRES_AT, SESSIONS, sha256, createActionKey, createPlan,
  renderMessage, dispatchGuard, validateManifest, approvedManifestSha256,
  runLessonVideoNotice, atomicWritePrivate, validatePrivateRoot,
  validateActiveSender, parseLmsHistory, providerOutcome,
} from '../lib/lesson-video-notice-261027.mjs';

const NOW = Date.parse(DUE_AT);
const iso = ms => new Date(ms).toISOString();
const copy = value => structuredClone(value);

function fixture() {
  const source = { source: 'StudioMate live lesson-detail DOM', verifiedAt: iso(NOW - 60000),
    sessions: SESSIONS.map(s => ({ ...s, rows: Array.from({ length: 5 }, (_, i) => ({
      name: `Synthetic${s.team}${i}`, phone: `01090000${s.team.charCodeAt(0)}${i}`,
      attendance: i === 4 ? '결석' : '출석',
    })) })) };
  const recipients = createPlan(source, 'registered_all', NOW).map(row => ({ ...row,
    subject: 'Synthetic subject', text: 'Synthetic approved content', textSha256: sha256('Synthetic approved content') }));
  const state = { schemaVersion: 1, purpose: PURPOSE, dueAt: DUE_AT, expiresAt: EXPIRES_AT,
    recipientPolicy: 'registered_all', approval: { approved: true, source: 'direct_user_request', approvedAt: iso(NOW - 86400000) },
    senderNumber: '0290004425', recipients, sends: {} };
  return { state, source };
}

function directory(t, data = fixture()) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'synthetic-lesson-notice-'));
  fs.chmodSync(root, 0o700);
  const put = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value)}\n`, { mode: 0o600 });
  put('state.json', data.state); put('fresh-source.json', data.source);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, put, read: () => JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8')) };
}

function provider(state, options = {}) {
  const calls = [], stored = new Map();
  const request = async (resource, method, body) => {
    calls.push({ resource, method, body });
    const url = new URL(resource, 'https://synthetic.invalid');
    await options.onRequest?.(url, method, body);
    if (method === 'POST') {
      assert.equal(resource, '/messages/v4/send-many/detail');
      assert.equal(body.messages.length, 1);
      assert.equal(body.strict, true); assert.equal(body.allowDuplicates, false); assert.equal(body.showMessageList, true);
      assert.equal(Object.hasOwn(body, 'scheduledDate'), false);
      const message = body.messages[0], n = calls.filter(c => c.method === 'POST').length;
      assert.equal(message.type, 'LMS'); assert.equal(Object.hasOwn(message, 'scheduledDate'), false);
      if (options.transportUnknown) throw new Error('synthetic transport timeout');
      const row = { ...message, messageId: `synthetic-message-${n}`, groupId: `synthetic-group-${n}`,
        statusCode: options.readbackCode || '2000', dateCreated: iso(NOW) };
      if (options.readback) stored.set(message.to, row);
      if (options.response) return options.response(row);
      return { groupInfo: { groupId: row.groupId, count: { registeredSuccess: 1 } },
        messageList: [{ messageId: row.messageId, statusCode: '2000' }], failedMessageList: [] };
    }
    assert.equal(method, 'GET');
    if (url.pathname === '/senderid/v1/numbers/active') return options.active ?? [state.senderNumber];
    if (url.pathname === '/iam/v1/black/') {
      assert.equal(url.searchParams.get('limit'), '1000');
      assert.equal(url.searchParams.get('senderNumber'), state.senderNumber);
      return options.black ?? { blackList: [], limit: 1000, startKey: null, nextKey: null };
    }
    if (url.pathname === '/iam/v1/block/numbers/') {
      assert.equal(url.searchParams.get('limit'), '1000');
      assert.ok(url.searchParams.get('phoneNumber'));
      return options.block ?? { blockNumbers: [], limit: 1000, startKey: null, nextKey: null };
    }
    if (url.pathname === '/messages/v4/list') {
      assert.equal(url.searchParams.get('dateType'), 'CREATED');
      assert.equal(url.searchParams.get('type'), 'LMS');
      assert.equal(url.searchParams.get('limit'), '500');
      assert.equal(url.searchParams.get('startDate'), '2026-10-24T00:00:00+09:00');
      assert.ok(Number.isFinite(Date.parse(url.searchParams.get('endDate'))));
      if (options.history) return options.history(url, stored);
      const row = stored.get(url.searchParams.get('to'));
      return { messageList: row ? { [row.messageId]: row } : {}, limit: 500, startKey: null, nextKey: null };
    }
    throw new Error('unexpected synthetic endpoint');
  };
  return { request, calls, stored, posts: () => calls.filter(c => c.method === 'POST') };
}

const apply = (root, p, extra = {}) => runLessonVideoNotice({ root, mode: 'apply', clock: () => NOW,
  makeRequest: () => p.request, ...extra });
const assertNoClaims = root => {
  assert.deepEqual(fs.readdirSync(root).sort(), ['fresh-source.json', 'state.json']);
};
const assertUnlocked = root => assert.equal(fs.readdirSync(root).some(name => name.endsWith('.lock')), false);

for (const [value, allowed] of [
  ['2026-10-26T11:00:00+09:00', false], ['2026-10-27T08:59:59+09:00', false],
  ['2026-10-27T09:00:00+09:00', false], ['2026-10-27T10:59:59.999+09:00', false],
  [DUE_AT, true], ['2026-10-27T22:59:59.999+09:00', true], [EXPIRES_AT, false],
  ['2026-10-28T09:00:00+09:00', false], [NaN, false],
]) test(`due/date/quiet boundary ${value}`, () => assert.equal(dispatchGuard(value).allowed, allowed));

test('every minute of due day respects both due time and shared quiet window', () => {
  const midnight = Date.parse('2026-10-27T00:00:00+09:00');
  for (let minute = 0; minute < 1440; minute++)
    assert.equal(dispatchGuard(midnight + minute * 60000).allowed, minute >= 660 && minute < 1380);
});

test('early/late apply does not load private state, authenticate, or claim', async () => {
  for (const now of [NOW - 1, Date.parse(EXPIRES_AT), NOW + 86400000]) {
    let authenticated = false;
    const result = await runLessonVideoNotice({ mode: 'apply', root: '/nonexistent/synthetic', clock: () => now,
      makeRequest: () => { authenticated = true; throw Error('forbidden'); } });
    assert.equal(result.status, 'deferred'); assert.equal(result.attempted, 0); assert.equal(authenticated, false);
  }
});

test('default plan is read-only, contains only counts and hashed action keys', async t => {
  const { root } = directory(t);
  const result = await runLessonVideoNotice({ root, clock: () => NOW, makeRequest: () => { throw Error('no auth'); } });
  assert.equal(result.status, 'planned'); assert.equal(result.recipients, 20);
  assert.equal(result.actionKeyHashes.length, 20); assertNoClaims(root);
  assert.equal(/Synthetic|010900|approved content/.test(JSON.stringify(result)), false);
});

test('action key canonicalization, exact approved rendering and frozen subject hash', () => {
  const { state } = fixture(), row = state.recipients[0];
  assert.equal(createActionKey({ ...row, name: ` ${row.name} `, phone: `+82 ${row.phone.slice(1)}` }), row.actionKey);
  assert.equal(createActionKey({ ...row, teams: ['B', 'A'] }), createActionKey({ ...row, teams: ['A', 'B'] }));
  const message = renderMessage({ ...row, subject: '  exact subject  ', text: 'exact\nbody ', textSha256: sha256('exact\nbody ') }, state.senderNumber);
  assert.equal(message.subject, '  exact subject  '); assert.equal(message.text, 'exact\nbody ');
  const digest = approvedManifestSha256(state); state.recipients[0].subject += '!';
  assert.notEqual(approvedManifestSha256(state), digest);
  const second = copy(state); second.sends[row.actionKey] = { status: 'accepted' };
  assert.equal(approvedManifestSha256(second), approvedManifestSha256(state));
});

for (const [field, value, limit] of [
  ['subject', 'a'.repeat(40), 40], ['subject', '\uac00'.repeat(13) + 'a', 40],
  ['subject', '\u{1f600}'.repeat(10), 40],
  ['text', 'a'.repeat(2000), 2000], ['text', '\uac00'.repeat(666) + 'ab', 2000],
  ['text', '\u{1f600}'.repeat(500), 2000],
]) test(`LMS ${field} preserves exact ${limit} UTF-8 bytes (${value.length} code units)`, () => {
  const { state } = fixture(), row = { ...state.recipients[0], [field]: value };
  row.textSha256 = sha256(row.text);
  assert.equal(Buffer.byteLength(value, 'utf8'), limit);
  assert.equal(renderMessage(row, state.senderNumber)[field], value);
  const oversized = { ...row, [field]: value + 'x' };
  oversized.textSha256 = sha256(oversized.text);
  assert.throws(() => renderMessage(oversized, state.senderNumber), new RegExp(`${field}_exceeds_${limit}_utf8_bytes`));
});

for (const [label, change] of [
  ['missing team session', x => x.source.sessions.pop()],
  ['wrong native class', x => { x.source.sessions[0].lessonId = 'excel_97134106'; }],
  ['wrong date', x => { x.source.sessions[0].date = '2026-10-25'; }],
  ['less than five registered', x => x.source.sessions[0].rows.pop()],
  ['attendance disagreement', x => { x.source.sessions[0].rows[0].attendance = '결석'; }],
  ['unknown attendance', x => { x.source.sessions[0].rows[0].attendance = '예약'; }],
  ['changed roster', x => { for (const s of x.source.sessions.filter(s => s.team === 'A')) s.rows[0].name = 'Changed'; }],
  ['same-team registered mismatch', x => { x.source.sessions[0].rows[0].phone = '01099998888'; }],
  ['masked phone', x => { x.source.sessions[0].rows[0].phone = '010****8888'; }],
  ['conflicting phone names', x => { x.source.sessions[2].rows[0].phone = x.source.sessions[0].rows[0].phone; }],
  ['duplicate registered phone', x => { x.source.sessions[0].rows[1] = copy(x.source.sessions[0].rows[0]); }],
  ['text drift', x => { x.state.recipients[0].text += '!'; }],
  ['subject over conservative UTF-8 limit', x => { x.state.recipients[0].subject = '\uac00'.repeat(14); }],
  ['text over conservative UTF-8 limit', x => {
    x.state.recipients[0].text = '\uac00'.repeat(667);
    x.state.recipients[0].textSha256 = sha256(x.state.recipients[0].text);
  }],
  ['unapproved request', x => { x.state.approval.approved = false; }],
  ['superseded attendance-only policy', x => { x.state.recipientPolicy = 'attended_only'; }],
  ['wrong due date', x => { x.state.dueAt = '2026-10-28T11:00:00+09:00'; }],
  ['unexpected recipient', x => { x.state.recipients[0].phone = '01099998888'; }],
  ['missing recipient', x => x.state.recipients.pop()],
  ['missing selected team', x => { x.state.recipients[0].teams = ['D', 'C']; }],
  ['non-native source', x => { x.source.source = 'cached CRM mirror'; }],
  ['source exactly two hours old', x => { x.source.verifiedAt = iso(NOW - 7200000); }],
  ['future source', x => { x.source.verifiedAt = iso(NOW + 1); }],
]) test(`fail closed before auth: ${label}`, async t => {
  const data = fixture(); change(data); const { root } = directory(t, data);
  let authenticated = false;
  await assert.rejects(runLessonVideoNotice({ root, mode: 'apply', clock: () => NOW,
    makeRequest: () => { authenticated = true; } }));
  assert.equal(authenticated, false); assertNoClaims(root);
});

test('same normalized phone across teams dedupes and retains all team bindings', () => {
  const { source } = fixture();
  for (const s of source.sessions.filter(s => s.team === 'B')) s.rows[0] = copy(source.sessions[0].rows[0]);
  const plan = createPlan(source, 'attended_only', NOW);
  assert.equal(plan.length, 15);
  assert.deepEqual(plan.find(r => r.phone === source.sessions[0].rows[0].phone).teams, ['A', 'B']);
  assert.equal(createPlan(source, 'registered_all', NOW).length, 19);
});

test('registered_all requires same complete native roster and includes absentees', () => {
  const { state, source } = fixture(); state.recipientPolicy = 'registered_all';
  state.recipients = createPlan(source, state.recipientPolicy, NOW).map(r => ({ ...state.recipients[0], ...r }));
  assert.equal(validateManifest(state, source, NOW).length, 20);
  source.sessions[1].rows[4].attendance = '출석';
  assert.throws(() => validateManifest(state, source, NOW), /same_team_roster_changed/);
});

test('ACTIVE strings and documented ACTIVE dictionaries supported; unknown/inactive invalid', () => {
  assert.doesNotThrow(() => validateActiveSender(['0290004425'], '0290004425', NOW));
  assert.doesNotThrow(() => validateActiveSender([{ phoneNumber: '0290004425', status: 'ACTIVE' }], '0290004425', NOW));
  for (const value of [{ senderIds: [] }, [null], [42], ['masked****'], [{ phoneNumber: '0290004425', status: 'INACTIVE' }], []])
    assert.throws(() => validateActiveSender(value, '0290004425', NOW));
});

for (const [label, options] of [
  ['KISA pagination', { black: { blackList: [], nextKey: 'more' } }],
  ['missing KISA cursor', { black: { blackList: [] } }],
  ['KISA unknown schema', { black: { blackList: {}, nextKey: null } }],
  ['KISA unknown type', { black: { blackList: [{ type: 'UNKNOWN' }], nextKey: null } }],
  ['block-number pagination', { block: { blockNumbers: [], nextKey: 'more' } }],
  ['missing block-number list', { block: { nextKey: null } }],
  ['invalid active sender', { active: [false] }],
  ['history pagination', { history: () => ({ messageList: {}, nextKey: 'more' }) }],
  ['missing history', { history: () => ({ nextKey: null }) }],
  ['array history', { history: () => ({ messageList: [], nextKey: null }) }],
  ['malformed history row', { history: () => ({ messageList: { bad: {} }, nextKey: null }) }],
  ['unexpected history cap', { history: () => ({ messageList: {}, limit: 20, nextKey: null }) }],
]) test(`live preflight creates no claims: ${label}`, async t => {
  const data = fixture(), { root } = directory(t, data), p = provider(data.state, options);
  await assert.rejects(apply(root, p)); assert.equal(p.posts().length, 0); assertNoClaims(root);
});

test('blacklisted and individually blocked recipients excluded, never attempted', async t => {
  const data = fixture(), { root, read } = directory(t, data);
  const [a, b] = data.state.recipients;
  const p = provider(data.state, {
    black: { blackList: [{ type: 'SPAM', senderNumber: data.state.senderNumber, recipientNumber: a.phone }], nextKey: null },
    block: { blockNumbers: [{ phoneNumber: b.phone }], nextKey: null },
  });
  const result = await apply(root, p);
  assert.equal(result.excluded, 2); assert.equal(result.attempted, 18);
  assert.equal(read().sends[a.actionKey], undefined); assert.equal(read().sends[b.actionKey], undefined);
  assertUnlocked(root);
});

test('accepted response without readback retains IDs and never reposts', async t => {
  const data = fixture(), { root, read } = directory(t, data), p = provider(data.state);
  const result = await apply(root, p);
  assert.equal(result.attempted, 20);
  for (const send of Object.values(read().sends)) {
    assert.equal(send.status, 'accepted_pending_readback'); assert.ok(send.attemptToken);
    assert.ok(send.groupId); assert.equal(send.receipts.length, 1);
  }
  const again = await apply(root, p); assert.equal(again.attempted, 0); assert.equal(p.posts().length, 20);
  assertUnlocked(root);
});

test('delivered only from independent provider history, not POST response', async t => {
  const data = fixture(), { root, read } = directory(t, data), p = provider(data.state, { readback: true, readbackCode: '4000' });
  assert.equal((await apply(root, p)).outcomes.delivered, 20);
  assert.ok(Object.values(read().sends).every(s => s.status === 'delivered' && s.readbackAt));
  await apply(root, p); assert.equal(p.posts().length, 20); assertUnlocked(root);
});

test('unknown transport is durable result_unknown, does not retry the same recipient', async t => {
  const data = fixture(), { root, read } = directory(t, data), p = provider(data.state, { transportUnknown: true });
  assert.equal((await apply(root, p)).attempted, 1);
  const [key] = Object.keys(read().sends); assert.equal(read().sends[key].status, 'result_unknown');
  await apply(root, p);
  assert.equal(p.posts().filter(c => c.body.messages[0].customFields.archiveActionKey === key).length, 1);
  assertUnlocked(root);
});

test('intent persisted and fsynced before POST, failed state persistence prevents POST and replay', async t => {
  const data = fixture(), { root, read } = directory(t, data), p = provider(data.state);
  await assert.rejects(apply(root, p, { writeAtomic: () => { throw Error('synthetic disk failure'); } }));
  assert.equal(p.posts().length, 0); assert.deepEqual(read().sends, {});
  const name = fs.readdirSync(root).find(n => n.startsWith('intent-'));
  const intent = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  assert.ok(intent.attemptToken); assert.equal(intent.ownerPid, process.pid); assertUnlocked(root);
  await apply(root, p);
  assert.equal(p.posts().some(c => c.body.messages[0].customFields.archiveActionKey === intent.actionKey), false);
});

test('intent file and ledger both exist before each single-recipient POST', async t => {
  const data = fixture(), { root, read } = directory(t, data);
  const p = provider(data.state, { onRequest: (_, method, body) => {
    if (method !== 'POST') return;
    const key = body.messages[0].customFields.archiveActionKey;
    const intent = JSON.parse(fs.readFileSync(path.join(root, `intent-${key}.json`), 'utf8'));
    assert.equal(read().sends[key].attemptToken, intent.attemptToken);
    assert.equal(fs.statSync(path.join(root, `intent-${key}.json`)).mode & 0o777, 0o600);
  } });
  await apply(root, p); assertUnlocked(root);
});

test('crossing 23:00 during preflight is deferred without intent or attempt', async t => {
  const data = fixture(), { root } = directory(t, data); let now = NOW;
  const p = provider(data.state, { onRequest: url => { if (url.pathname === '/messages/v4/list') now = Date.parse(EXPIRES_AT); } });
  const result = await apply(root, p, { clock: () => now });
  assert.equal(result.status, 'deferred'); assert.equal(result.attempted, 0); assertNoClaims(root);
});

test('immediate pre-POST clock guard can defer after intent without recording failure/attempt', async t => {
  const data = fixture(), { root, read } = directory(t, data), p = provider(data.state); let now = NOW;
  const result = await apply(root, p, { clock: () => now, writeAtomic: (target, value) => {
    atomicWritePrivate(target, value); now = Date.parse(EXPIRES_AT);
  } });
  assert.equal(result.status, 'deferred'); assert.equal(result.attempted, 0); assert.equal(p.posts().length, 0);
  assert.equal(Object.values(read().sends)[0].status, 'deferred_before_post'); assertUnlocked(root);
});

test('each recipient rechecks the clock; first POST crossing 23:00 never claims a second', async t => {
  const data = fixture(); let now = Date.parse(EXPIRES_AT) - 1;
  data.source.verifiedAt = iso(now - 60000);
  const { root } = directory(t, data);
  const p = provider(data.state, { onRequest: (_, method) => { if (method === 'POST') now = Date.parse(EXPIRES_AT); } });
  const result = await apply(root, p, { clock: () => now });
  assert.equal(result.attempted, 1); assert.equal(result.status, 'deferred'); assert.equal(p.posts().length, 1);
  assert.equal(fs.readdirSync(root).filter(n => n.startsWith('intent-')).length, 1); assertUnlocked(root);
});

test('roster change between recipients stops before any second intent', async t => {
  const data = fixture(), { root, put } = directory(t, data);
  const p = provider(data.state, { onRequest: (_, method) => {
    if (method !== 'POST') return;
    const changed = copy(data.source);
    for (const session of changed.sessions.filter(s => s.team === 'D')) session.rows[0].name = 'ChangedSynthetic';
    put('fresh-source.json', changed);
  } });
  await assert.rejects(apply(root, p), /recipient_binding_changed/);
  assert.equal(p.posts().length, 1);
  assert.equal(fs.readdirSync(root).filter(n => n.startsWith('intent-')).length, 1); assertUnlocked(root);
});

test('source staleness during preflight prevents intent and releases lock', async t => {
  const data = fixture(), { root } = directory(t, data); let now = NOW;
  const p = provider(data.state, { onRequest: url => { if (url.pathname === '/messages/v4/list') now = NOW + 7200000; } });
  await assert.rejects(apply(root, p, { clock: () => now }), /stale_source/);
  assert.equal(p.posts().length, 0); assertNoClaims(root);
});

test('immutable pin catches subject and recomputed text hash drift between invocations', async t => {
  const data = fixture(), { root, put, read } = directory(t, data), p = provider(data.state);
  await apply(root, p);
  for (const mutate of [s => { s.recipients[0].subject += '!'; }, s => {
    s.recipients[0].text += '!'; s.recipients[0].textSha256 = sha256(s.recipients[0].text);
  }]) {
    const changed = read(); mutate(changed); put('state.json', changed);
    await assert.rejects(apply(root, p), /frozen_manifest_changed/);
    put('state.json', { ...data.state, sends: {} });
  }
  assertUnlocked(root);
});

test('provider duplicate canonical key or legacy body hash prevents POST regardless of status', async t => {
  for (const withKey of [true, false]) {
    const data = fixture(), { root, read } = directory(t, data);
    const p = provider(data.state, { history: url => {
      const recipient = data.state.recipients.find(r => r.phone === url.searchParams.get('to'));
      return { messageList: { historical: { messageId: 'historical', groupId: 'historical-group', to: recipient.phone,
        from: data.state.senderNumber, type: 'LMS', text: recipient.text, statusCode: '3040', dateCreated: iso(NOW),
        customFields: withKey ? { archiveActionKey: recipient.actionKey, purpose: PURPOSE } : {} } }, nextKey: null };
    } });
    const result = await apply(root, p);
    assert.equal(result.attempted, 0); assert.equal(p.posts().length, 0); assert.equal(result.reconciled, 20);
    assert.ok(Object.values(read().sends).every(s => s.status === (withKey ? 'failed' : 'result_unknown'))); assertUnlocked(root);
  }
});

for (const [label, mutate] of [
  ['changed text', row => { row.text += ' changed'; }],
  ['changed sender', row => { row.from = '01099998888'; }],
  ['omitted sender', row => { delete row.from; }],
  ['invalid sender', row => { row.from = 'masked****'; }],
  ['changed purpose', row => { row.customFields.purpose = 'different_purpose'; }],
  ['omitted purpose', row => { delete row.customFields.purpose; }],
]) {
  test(`matching action key with ${label} is preflight attention, never delivered or claimed`, async t => {
    const data = fixture(), { root } = directory(t, data);
    const p = provider(data.state, { history: url => {
      const recipient = data.state.recipients.find(r => r.phone === url.searchParams.get('to'));
      const row = { ...renderMessage(recipient, data.state.senderNumber), messageId: 'historical',
        groupId: 'historical-group', statusCode: '4000' };
      mutate(row);
      return { messageList: { historical: row }, limit: 500, startKey: null, nextKey: null };
    } });
    const result = await apply(root, p);
    assert.equal(result.status, 'attention_required'); assert.equal(result.reason, 'provider_action_key_conflict');
    assert.equal(result.attempted, 0); assert.equal(result.outcomes.delivered, undefined);
    assert.equal(p.posts().length, 0); assertNoClaims(root);
  });

  test(`post-send keyed readback with ${label} stays attention and cannot replay`, async t => {
    const data = fixture(), { root, read } = directory(t, data);
    const p = provider(data.state, { readback: true, readbackCode: '4000', history: (url, stored) => {
      const row = copy(stored.get(url.searchParams.get('to')));
      if (row) mutate(row);
      return { messageList: row ? { [row.messageId]: row } : {}, limit: 500, startKey: null, nextKey: null };
    } });
    const result = await apply(root, p);
    assert.equal(result.status, 'attention_required'); assert.equal(result.outcomes.delivered, undefined);
    assert.equal(p.posts().length, 1);
    assert.equal(Object.values(read().sends)[0].status, 'attention_required');
    assert.equal((await apply(root, p)).status, 'attention_required');
    assert.equal(p.posts().length, 1); assertUnlocked(root);
  });
}

test('omitted customFields on unrelated old LMS is normalized without mutation or blocking new recipients', async t => {
  const data = fixture(), { root } = directory(t, data);
  const p = provider(data.state, { history: url => {
    const row = { messageId: 'old', groupId: 'old-group', to: url.searchParams.get('to'), type: 'LMS',
      text: 'Different unrelated synthetic history', statusCode: '4000' };
    const parsed = parseLmsHistory({ messageList: { old: row } }, { phone: row.to });
    assert.deepEqual(parsed[0].customFields, {}); assert.equal(Object.hasOwn(row, 'customFields'), false);
    return { messageList: { old: row }, limit: 500, startKey: null, nextKey: null };
  } });
  assert.equal((await apply(root, p)).attempted, 20); assertUnlocked(root);
});

test('omitted customFields with matching legacy body still fences duplicates without claiming delivery', async t => {
  const data = fixture(), { root, read } = directory(t, data);
  const p = provider(data.state, { history: url => {
    const recipient = data.state.recipients.find(r => r.phone === url.searchParams.get('to'));
    return { messageList: { old: { messageId: 'old', groupId: 'old-group', to: recipient.phone,
      from: data.state.senderNumber, type: 'LMS', text: recipient.text, statusCode: '4000' } }, nextKey: null };
  } });
  const result = await apply(root, p);
  assert.equal(result.status, 'attention_required'); assert.equal(result.attempted, 0);
  assert.equal(result.outcomes.delivered, undefined); assert.equal(p.posts().length, 0);
  assert.ok(Object.values(read().sends).every(s => s.status === 'result_unknown')); assertUnlocked(root);
});

test('provider readback error leaves accepted receipt pending, never transport-failed or replayed', async t => {
  const data = fixture(), { root, read } = directory(t, data); let posted = false;
  const p = provider(data.state, { onRequest: (_, method) => { if (method === 'POST') posted = true; },
    history: () => posted ? { messageList: {}, nextKey: 'incomplete' } : { messageList: {}, nextKey: null } });
  await assert.rejects(apply(root, p));
  assert.equal(Object.values(read().sends)[0].status, 'accepted_pending_readback');
  assert.equal(p.posts().length, 1); assertUnlocked(root);
});

test('unknown LMS schemas and full-page histories fail closed', () => {
  const recipient = fixture().state.recipients[0];
  const row = { messageId: 'm', groupId: 'g', to: recipient.phone, type: 'LMS', text: recipient.text, customFields: {}, statusCode: '4000' };
  assert.equal(parseLmsHistory({ messageList: { m: row } }, recipient).length, 1);
  for (const changes of [{ type: 'ATA' }, { to: '01099998888' }, { messageId: 'other' },
    { customFields: null }, { customFields: undefined }, { customFields: [] }, { customFields: 'invalid' }, { statusCode: null }])
    assert.throws(() => parseLmsHistory({ messageList: { m: { ...row, ...changes } } }, recipient));
  const all = Object.fromEntries(Array.from({ length: 500 }, (_, n) => [`m${n}`, { ...row, messageId: `m${n}` }]));
  assert.throws(() => parseLmsHistory({ messageList: all, nextKey: null }, recipient), /history_at_page_limit/);
  assert.equal(providerOutcome({ statusCode: '4000' }), 'delivered');
  assert.equal(providerOutcome({ statusCode: '3000' }), 'accepted');
  assert.equal(providerOutcome({ statusCode: '3040' }), 'failed');
  assert.equal(providerOutcome({ statusCode: '9000' }), 'result_unknown');
});

test('owner-only permissions, no symlinks/hardlinks and cleanup', async t => {
  const { root } = directory(t);
  fs.chmodSync(path.join(root, 'state.json'), 0o644);
  assert.throws(() => validatePrivateRoot(root));
  fs.chmodSync(path.join(root, 'state.json'), 0o600);
  fs.symlinkSync(path.join(root, 'state.json'), path.join(root, 'unsafe-link'));
  assert.throws(() => validatePrivateRoot(root)); fs.unlinkSync(path.join(root, 'unsafe-link'));
  fs.linkSync(path.join(root, 'state.json'), path.join(root, 'unsafe-hardlink'));
  assert.throws(() => validatePrivateRoot(root)); fs.unlinkSync(path.join(root, 'unsafe-hardlink'));
  assert.doesNotThrow(() => validatePrivateRoot(root)); assertUnlocked(root);
});

test('existing owner lock cannot be reclaimed and no authentication happens', async t => {
  const { root } = directory(t), lock = path.join(root, `dispatch-${sha256(PURPOSE)}.lock`);
  const owner = { pid: process.pid, token: 'synthetic-other-owner' };
  fs.writeFileSync(lock, JSON.stringify(owner), { mode: 0o600 });
  let authenticated = false;
  await assert.rejects(runLessonVideoNotice({ root, mode: 'apply', clock: () => NOW,
    makeRequest: () => { authenticated = true; } }), { code: 'EEXIST' });
  assert.equal(authenticated, false); assert.deepEqual(JSON.parse(fs.readFileSync(lock, 'utf8')), owner);
});
