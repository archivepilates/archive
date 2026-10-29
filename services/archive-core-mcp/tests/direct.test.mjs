import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash } from 'node:crypto';
import { createDirect, DIRECT_ACTIONS } from '../src/direct.mjs';
import { CoreError } from '../src/safety.mjs';

const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw Error('Real network forbidden'); }; });
after(() => { globalThis.fetch = originalFetch; });
const NOW = Date.parse('2026-10-29T02:00:00.000Z');
const TIME = '2026-10-29T02:00:01.123456000Z';
const PRECISE = { seconds: 1793239201, nanoseconds: 123456000 };
const ROOT = 'projects/archive-pilates/databases/(default)/documents';
const clone = value => JSON.parse(JSON.stringify(value));
const blank = () => ({ schema: 'archive.sequence.v1', id: 'note_1', title: '', teacher: '', equipment: 'chair',
  equipmentOther: '', date: '', duration: '', audience: '', goal: '', cues: ['', '', ''], memo: '',
  sketchSpace: true, source: '', moves: { warm: [], main: [], cool: [] } });
const move = () => ({ id: 'move_1', name: '', description: '', muscles: '', purpose: '', image: '' });
const note = (state = blank()) => ({ ownerUid: 'fake-owner', revision: 4, deleted: false,
  createdAt: { seconds: 1, nanoseconds: 987654000 }, payload: JSON.stringify(state),
  title: state.title, teacher: state.teacher, equipment: state.equipment, date: state.date, goal: state.goal, moveCount: 0 });
const renewal = () => ({ caseId: 'case_1', studioId: '5330', memberId: 'member_1', active: true,
  workflowStatus: 'open', kind: 'group', ticketName: 'group pass', ticketIdentity: 'user:ticket_1' });
const member = () => ({ studioId: '5330', memberId: 'member_1', activeTickets: [
  { userTicketId: 'ticket_1', name: 'group pass', remainingCount: 2, expiresAt: '2026-11-05' },
] });
const safeError = code => e => {
  assert.ok(e instanceof CoreError); assert.equal(e.code, code); assert.equal(e.safe, true);
  assert.doesNotMatch(e.message, /FAKE_TOKEN|private-provider-detail/); return true;
};
function fixture() {
  const records = new Map([['renewalCases/case_1', renewal()], ['memberProfiles/member_1', member()]]);
  const times = new Map();
  const events = [], requests = [];
  const current = { staff: { uid: 'fake-owner', role: 'owner', studioId: '5330' } };
  const control = { response: { commitTime: TIME, writeResults: [{ updateTime: TIME }] }, ok: true, status: 200 };
  const db = { collection(collection) { return { doc(id) { return { async get() {
    events.push(`read:${collection}/${id}`);
    if (control.readError) throw control.readError;
    const data = records.get(`${collection}/${id}`);
    return { exists: data !== undefined, data: () => data, updateTime: times.has(`${collection}/${id}`) ? times.get(`${collection}/${id}`) : PRECISE };
  } }; } }; } };
  const access = { async token(actor) {
    assert.equal(actor, current); events.push('token');
    if (control.authError) throw control.authError;
    if (control.onToken) await control.onToken();
    return 'FAKE_TOKEN';
  } };
  const fetcher = async (url, options) => {
    events.push(options.method === 'GET' ? 'get' : 'commit');
    requests.push({ url, options, body: options.body === undefined ? undefined : JSON.parse(options.body) });
    if (control.networkError) throw control.networkError;
    return { ok: control.ok, status: control.status, async json() {
      if (control.jsonError) throw control.jsonError;
      return control.response;
    } };
  };
  const invoke = createDirect({ db, access, fetcher, now: () => NOW });
  return { records, times, events, requests, current, control, invoke,
    call: (name, params, signal, options) => invoke(name, params, current, signal, options) };
}
const save = (f, state = blank(), expectedRevision = 0, signal, options) => f.call('coreSequenceSave', { state, expectedRevision }, signal, options);
const update = (f, workflowStatus = 'contacted', signal, options) => f.call('coreRenewalWorkflowUpdate', { caseId: 'case_1', workflowStatus }, signal, options);

test('catalog exposes one local read and three non-member-facing bounded write actions', () => {
  assert.deepEqual(DIRECT_ACTIONS.map(a => a.name), ['coreSequenceGet', 'coreRenewalWorkflowUpdate', 'coreSequenceSave', 'coreSequenceRemove']);
  for (const entry of DIRECT_ACTIONS) {
    assert.deepEqual(Object.keys(entry).sort(), ['name', 'mode', 'label', 'memberFacing', 'required', 'sources', 'notes'].sort());
    assert.equal(entry.mode, entry.name === 'coreSequenceGet' ? 'read' : 'write'); assert.equal(entry.memberFacing, false);
    assert.ok(entry.required.length); assert.ok(entry.sources.length); assert.ok(entry.notes);
  }
});

test('renewal uses fixed REST URL and Firebase token, strict masked fields and precise CAS', async () => {
  const f = fixture();
  assert.deepEqual(await update(f), { caseId: 'case_1', workflowStatus: 'contacted', commitTime: TIME });
  const { url, options, body } = f.requests[0];
  assert.equal(url, `https://firestore.googleapis.com/v1/${ROOT}:commit`);
  assert.doesNotMatch(url, /cloudfunctions/);
  assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
  assert.deepEqual(options.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer FAKE_TOKEN' });
  assert.ok(options.signal instanceof AbortSignal);
  const [w] = body.writes;
  assert.equal(w.update.name, `${ROOT}/renewalCases/case_1`);
  assert.deepEqual(w.currentDocument, { updateTime: new Date(PRECISE.seconds * 1000).toISOString().replace('.000Z', '.123456000Z') });
  assert.deepEqual(w.update.fields, { workflowStatus: { stringValue: 'contacted' },
    operatorUpdatedByUid: { stringValue: 'fake-owner' }, nextActionAt: { nullValue: null } });
  assert.deepEqual(w.updateMask.fieldPaths, ['workflowStatus', 'operatorUpdatedByUid', 'nextActionAt']);
  assert.deepEqual(w.updateTransforms, ['operatorUpdatedAt', 'updatedAt'].map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })));
  assert.deepEqual(f.events, ['read:renewalCases/case_1', 'read:memberProfiles/member_1', 'token', 'commit']);
});

test('all five UI statuses accepted; snooze exactly seven days and other statuses clear it', async () => {
  for (const status of ['contacted', 'considering', 'snoozed', 'resolved', 'excluded']) {
    const f = fixture(); await update(f, status);
    assert.deepEqual(f.requests[0].body.writes[0].update.fields.nextActionAt,
      status === 'snoozed' ? { timestampValue: '2026-11-05T02:00:00.000Z' } : { nullValue: null });
  }
});

test('exhaustive action argument keys and primitive types rejected before reads/auth/claims', async () => {
  const actions = [
    ['coreSequenceGet', { noteId: 'note_1' }],
    ['coreRenewalWorkflowUpdate', { caseId: 'case_1', workflowStatus: 'contacted' }],
    ['coreSequenceSave', { state: blank(), expectedRevision: 0 }],
    ['coreSequenceRemove', { noteId: 'note_1', expectedRevision: 4 }],
  ];
  for (const [name, valid] of actions) {
    const bad = [null, [], '', 1, true, { ...valid, url: 'https://evil.invalid' }, { ...valid, ownerUid: 'other' }];
    for (const key of Object.keys(valid)) {
      const missing = { ...valid }; delete missing[key]; bad.push(missing);
      for (const value of [null, undefined, [], {}, true]) bad.push({ ...valid, [key]: value });
    }
    for (const params of bad) {
      const f = fixture(); await assert.rejects(() => f.call(name, params), safeError('INVALID_ARGUMENT'));
      assert.deepEqual(f.events, []);
    }
  }
  for (const name of ['unknown', '../coreSequenceSave', 'https://example.invalid', 'coreSequenceSave/other']) {
    const f = fixture(); await assert.rejects(() => f.call(name, {}), safeError('UNKNOWN_ACTION')); assert.deepEqual(f.events, []);
  }
  for (const status of ['open', 'sent', '', 0, 'CONTACTED']) {
    const f = fixture(); await assert.rejects(() => update(f, status), safeError('INVALID_ARGUMENT')); assert.deepEqual(f.events, []);
  }
});

test('reject path injection and invalid revisions locally', async () => {
  for (const badId of ['../x', 'x/y', '%2f', 'x?updateMask=ownerUid', 'note\n', 'note\r', '', 'x'.repeat(101), 123]) {
    const f = fixture(); const state = blank(); state.id = badId;
    await assert.rejects(() => save(f, state), safeError('INVALID_ARGUMENT'));
    await assert.rejects(() => f.call('coreRenewalWorkflowUpdate', { caseId: badId, workflowStatus: 'resolved' }), safeError('INVALID_ARGUMENT'));
    await assert.rejects(() => f.call('coreSequenceRemove', { noteId: badId, expectedRevision: 1 }), safeError('INVALID_ARGUMENT'));
    assert.deepEqual(f.events, []);
  }
  for (const bad of [-1, 1.1, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    const f = fixture(); await assert.rejects(() => save(f, blank(), bad), safeError('INVALID_ARGUMENT'));
    await assert.rejects(() => f.call('coreSequenceRemove', { noteId: 'note_1', expectedRevision: bad }), safeError('INVALID_ARGUMENT'));
    assert.deepEqual(f.events, []);
  }
});

test('mutating exported catalog cannot register a new local dispatch route', async () => {
  const f = fixture(); DIRECT_ACTIONS.push({ name: 'injected' });
  try { await assert.rejects(() => f.call('injected', { noteId: 'note_1', expectedRevision: 4 }), safeError('UNKNOWN_ACTION')); }
  finally { DIRECT_ACTIONS.pop(); }
  assert.deepEqual(f.events, []);
});

test('full state schema validates every field, move, phase, text length and type', async () => {
  const mutations = [s => { s.schema = 'other'; }, s => { s.createdAt = NOW; }, s => { s.ownerUid = 'other'; },
    s => { delete s.title; }, s => { s.moves.other = []; }, s => { delete s.moves.cool; }, s => { s.moves.warm = {}; },
    s => { s.cues = ['', '']; }, s => { s.cues = ['', '', '', '']; }, s => { s.cues[0] = 'x'.repeat(66); },
    s => { s.sketchSpace = 'true'; }, s => { s.duration = '241'; }, s => { s.duration = '-1'; },
    s => { s.date = '2026-02-30'; }, s => { s.moves.main = Array.from({ length: 31 }, move); },
    s => { s.moves.main = [move(), move()]; }, s => { s.moves.main = [null]; },
    s => { const m = move(); delete m.image; s.moves.main = [m]; },
    s => { s.moves.main = [{ ...move(), ignored: 'anything' }]; },
    s => { s.moves.main = [{ ...move(), id: 'a/b' }]; }];
  const limits = { title: 70, teacher: 30, equipment: 30, equipmentOther: 35, date: 10,
    duration: 3, audience: 50, goal: 180, memo: 220, source: 120 };
  for (const [key, max] of Object.entries(limits)) {
    mutations.push(s => { s[key] = 'x'.repeat(max + 1); }, s => { s[key] = 1; });
  }
  for (const [key, max] of Object.entries({ name: 80, description: 160, muscles: 80, purpose: 120, image: 90000 })) {
    mutations.push(s => { s.moves.main = [{ ...move(), [key]: 'x'.repeat(max + 1) }]; },
      s => { s.moves.main = [{ ...move(), [key]: false }]; });
  }
  for (const mutate of mutations) {
    const f = fixture(), state = blank(); mutate(state);
    await assert.rejects(() => save(f, state), safeError('INVALID_ARGUMENT')); assert.deepEqual(f.events, []);
  }
  for (const value of [Object.assign(blank(), { [Symbol('hidden')]: 'x' }), Object.create(blank())]) {
    const f = fixture(); await assert.rejects(() => save(f, value), safeError('INVALID_ARGUMENT'));
  }
  const f = fixture(), state = blank(); Object.defineProperty(state, 'title', { enumerable: true, get() { throw Error('Getter must not run'); } });
  await assert.rejects(() => save(f, state), safeError('INVALID_ARGUMENT'));
});

test('new sequence uses exists:false and server creation time; max move count and equipment projection', async () => {
  const f = fixture(), state = blank();
  state.equipment = '기타'; state.equipmentOther = 'custom'; state.duration = '240'; state.date = '2026-10-29';
  for (const stage of ['warm', 'main', 'cool']) state.moves[stage] = Array.from({ length: 30 }, (_, i) => ({ ...move(), id: stage + i }));
  assert.deepEqual(await save(f, state), { noteId: state.id, revision: 1, deleted: false, commitTime: TIME });
  const w = f.requests[0].body.writes[0];
  assert.deepEqual(w.currentDocument, { exists: false }); assert.equal(w.update.fields.moveCount.integerValue, '90');
  assert.equal(w.update.fields.equipment.stringValue, 'custom'); assert.equal(w.update.fields.ownerUid.stringValue, 'fake-owner');
  assert.deepEqual(w.updateTransforms.map(t => t.fieldPath), ['updatedAt', 'createdAt']);
  assert.deepEqual(JSON.parse(w.update.fields.payload.stringValue), state);
});

test('update preserves immutable createdAt (including legacy absence) without serializing or overwriting it', async () => {
  for (const hasCreatedAt of [true, false]) {
    const f = fixture(), old = note(); if (!hasCreatedAt) delete old.createdAt;
    f.records.set('sequenceNotes/note_1', old);
    await save(f, { ...blank(), title: 'new title' }, 4);
    const w = f.requests[0].body.writes[0];
    assert.deepEqual(w.updateTransforms.map(t => t.fieldPath), ['updatedAt']);
    assert.equal(w.update.fields.revision.integerValue, '5');
    assert.ok(!w.updateMask.fieldPaths.includes('createdAt')); assert.ok(!Object.hasOwn(w.update.fields, 'createdAt'));
    assert.deepEqual(old, f.records.get('sequenceNotes/note_1'));
  }
});

test('exact UID ownership, stale revision, missing/deleted tombstones prevent save/remove', async () => {
  for (const patch of [{ ownerUid: 'teacher-uid' }, { revision: 5 }, { deleted: true }, { revision: 0 }]) {
    for (const name of ['coreSequenceSave', 'coreSequenceRemove']) {
      const f = fixture(); f.records.set('sequenceNotes/note_1', { ...note(), ...patch });
      const params = name === 'coreSequenceSave' ? { state: blank(), expectedRevision: 4 } : { noteId: 'note_1', expectedRevision: 4 };
      await assert.rejects(() => f.call(name, params), safeError(patch.ownerUid ? 'PERMISSION_DENIED' : 'CONFLICT'));
      assert.equal(f.requests.length, 0); assert.ok(!f.events.includes('token'));
    }
  }
  const f = fixture(); await assert.rejects(() => save(f, blank(), 1), safeError('CONFLICT'));
  await assert.rejects(() => f.call('coreSequenceRemove', { noteId: 'note_1', expectedRevision: 1 }), safeError('CONFLICT'));
  f.records.set('sequenceNotes/note_1', { ...note(), deleted: true });
  await assert.rejects(() => save(f, blank(), 0), safeError('CONFLICT'));
});

test('remove is exactly a masked tombstone and never hard deletes the note or images', async () => {
  const f = fixture(); f.records.set('sequenceNotes/note_1', note());
  assert.deepEqual(await f.call('coreSequenceRemove', { noteId: 'note_1', expectedRevision: 4 }),
    { noteId: 'note_1', revision: 5, deleted: true, commitTime: TIME });
  const [w] = f.requests[0].body.writes;
  assert.deepEqual(w.update.fields, { deleted: { booleanValue: true }, revision: { integerValue: '5' }, payload: { stringValue: '{}' } });
  assert.ok(!Object.hasOwn(w, 'delete')); assert.ok(!w.updateMask.fieldPaths.includes('createdAt'));
  assert.deepEqual(f.events, ['read:sequenceNotes/note_1', 'token', 'commit']);
});

const JPEG = 'data:image/jpeg;base64,/9j/AAAA';
const HASH = createHash('sha256').update(JPEG).digest('hex');
function imageFixture() {
  const f = fixture(), state = blank(); state.moves.main = [{ ...move(), image: HASH }];
  f.records.set('sequenceNotes/note_1', note(state));
  f.records.set(`sequenceNoteImages/note_1_${HASH}`, { ownerUid: 'fake-owner', noteId: 'note_1', dataUrl: JPEG });
  return { f, state };
}
test('unchanged existing JPEG can be supplied as a stored hash or expanded data URL; reference and input preserved', async () => {
  for (const image of [HASH, JPEG]) {
    const { f, state } = imageFixture(); state.moves.main[0].image = image;
    const original = clone(state); await save(f, state, 4);
    assert.deepEqual(state, original);
    assert.equal(JSON.parse(f.requests[0].body.writes[0].update.fields.payload.stringValue).moves.main[0].image, HASH);
    assert.equal(f.requests[0].body.writes.length, 1);
    assert.ok(f.events.includes(`read:sequenceNoteImages/note_1_${HASH}`));
  }
});

test('new/replaced/removed/reassigned image attachments explicitly unsupported, never written', async () => {
  for (const mutate of [s => { s.moves.main[0].image = ''; }, s => { s.moves.main = []; },
    s => { s.moves.main[0].id = 'another-move'; }, s => { s.moves.main[0].image = 'b'.repeat(64); },
    s => { s.moves.main.push({ ...move(), id: 'another', image: HASH }); }]) {
    const { f, state } = imageFixture(); mutate(state);
    await assert.rejects(() => save(f, state, 4), safeError('IMAGES_UNSUPPORTED')); assert.equal(f.requests.length, 0);
  }
  for (const image of [JPEG, HASH, 'data:image/png;base64,AAAA', 'https://evil.invalid/image.jpg']) {
    const f = fixture(), state = blank(); state.moves.main = [{ ...move(), image }];
    await assert.rejects(() => save(f, state), safeError('IMAGES_UNSUPPORTED')); assert.equal(f.requests.length, 0);
  }
});

test('existing image missing, foreign, wrong parent, non-JPEG, corrupt hash or oversized data is blocked', async () => {
  for (const patch of [null, { ownerUid: 'teacher' }, { noteId: 'other' }, { dataUrl: 'data:image/png;base64,AAAA' },
    { dataUrl: JPEG + 'AAAA' }, { dataUrl: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(90000) }]) {
    const { f, state } = imageFixture(); const path = `sequenceNoteImages/note_1_${HASH}`;
    if (patch === null) f.records.delete(path); else f.records.set(path, { ...f.records.get(path), ...patch });
    await assert.rejects(() => save(f, state, 4), safeError(patch === null || patch.ownerUid || patch.noteId ? 'SOURCE_UNVERIFIED' : 'SOURCE_INVALID'));
    assert.equal(f.requests.length, 0);
  }
});

test('malformed stored sequence or mismatched payload ID is not replaced', async () => {
  for (const payload of ['{', '{}', JSON.stringify({ ...blank(), id: 'wrong-note' })]) {
    const f = fixture(); f.records.set('sequenceNotes/note_1', { ...note(), payload });
    await assert.rejects(() => save(f, blank(), 4), safeError('SOURCE_INVALID')); assert.equal(f.requests.length, 0);
  }
});

test('renewal requires existing same-studio canonical profile with activeTickets and active/current UI case', async () => {
  const cases = [
    ['renewalCases/case_1', null, 'SOURCE_MISSING'], ['renewalCases/case_1', { studioId: 'other' }, 'SOURCE_SCOPE'],
    ['renewalCases/case_1', { active: false }, 'SOURCE_NOT_CURRENT'], ['renewalCases/case_1', { workflowStatus: 'resolved' }, 'SOURCE_NOT_CURRENT'],
    ['renewalCases/case_1', { workflowStatus: 'excluded' }, 'SOURCE_NOT_CURRENT'], ['renewalCases/case_1', { ticketName: '체험' }, 'SOURCE_NOT_CURRENT'],
    ['renewalCases/case_1', { caseId: 'other' }, 'SOURCE_UNVERIFIED'], ['memberProfiles/member_1', null, 'SOURCE_UNVERIFIED'],
    ['memberProfiles/member_1', { studioId: 5330 }, 'SOURCE_SCOPE'], ['memberProfiles/member_1', { memberId: 'other' }, 'SOURCE_UNVERIFIED'],
    ['memberProfiles/member_1', { activeTickets: undefined }, 'SOURCE_UNVERIFIED'],
    ['memberProfiles/member_1', { activeTickets: ['pass name only'] }, 'SOURCE_UNVERIFIED'],
  ];
  for (const [path, patch, code] of cases) {
    const f = fixture(); if (patch === null) f.records.delete(path); else f.records.set(path, { ...f.records.get(path), ...patch });
    await assert.rejects(() => update(f), safeError(code)); assert.equal(f.requests.length, 0); assert.ok(!f.events.includes('token'));
  }
});

test('renewed healthy exact or alternative tickets make case historical; expired/excluded/different kind are ignored', async () => {
  for (const id of ['ticket_1', 'new-ticket']) {
    const f = fixture(); f.records.get('memberProfiles/member_1').activeTickets.push({ userTicketId: id, name: 'group pass', remainingCount: 20, expiresAt: '2027-01-01' });
    await assert.rejects(() => update(f), safeError('SOURCE_NOT_CURRENT')); assert.equal(f.requests.length, 0);
  }
  const f = fixture(); f.records.get('memberProfiles/member_1').activeTickets.push(
    { name: 'group pass', remainingCount: 100, expiresAt: '2026-01-01' },
    { name: 'group 강사레슨', remainingCount: 100, expiresAt: '2027-01-01' },
    { name: 'private pass', remainingCount: 100, expiresAt: '2027-01-01' });
  await update(f); assert.equal(f.requests.length, 1);
});

test('source timestamp absent or imprecise cannot silently downgrade CAS to exists:true', async () => {
  for (const time of [null, {}, { seconds: 1 }, { seconds: 1, nanoseconds: -1 }, { seconds: 1, nanoseconds: 1e9 }]) {
    const f = fixture(); f.times.set('renewalCases/case_1', time);
    await assert.rejects(() => update(f), safeError('SOURCE_INVALID')); assert.equal(f.requests.length, 0);
  }
});

test('180k input limit enforced before reads including many repeated image data URLs', async () => {
  const f = fixture(), state = blank(); const image = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(65536);
  state.moves.main = Array.from({ length: 3 }, (_, i) => ({ ...move(), id: `move_${i}`, image }));
  await assert.rejects(() => save(f, state), safeError('INPUT_TOO_LARGE')); assert.deepEqual(f.events, []);
});

test('actor studio and role checks cannot bypass same-UID sequence guard or manager renewal authority', async () => {
  for (const patch of [{ uid: '' }, { studioId: 'other' }, { role: 'member' }]) {
    const f = fixture(); Object.assign(f.current.staff, patch);
    await assert.rejects(() => update(f), safeError('OWNER_REQUIRED')); assert.deepEqual(f.events, []);
  }
  const f = fixture(); f.current.staff.role = 'instructor';
  await assert.rejects(() => update(f), safeError('PERMISSION_DENIED')); assert.deepEqual(f.events, []);
  await save(f); assert.equal(f.requests.length, 1); // Firestore rules retain final session/access authority.
});

test('token and serialized body ready before awaited hook; hook mutation cannot change dispatched params', async () => {
  const f = fixture(), state = blank(); let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const pending = save(f, state, 0, undefined, { async beforeDispatch() {
    assert.equal(f.events.at(-1), 'token'); f.events.push('hook.start'); state.title = 'tampered'; entered();
    await gate; f.events.push('hook.end');
  } });
  await started; assert.equal(f.requests.length, 0); release(); await pending;
  assert.deepEqual(f.events.slice(-4), ['token', 'hook.start', 'hook.end', 'commit']);
  assert.equal(f.requests[0].body.writes[0].update.fields.title.stringValue, '');
});

test('cancellation before reads, during auth, or during hook cannot dispatch', async () => {
  for (const where of ['before', 'auth', 'hook']) {
    const f = fixture(), controller = new AbortController();
    if (where === 'before') controller.abort();
    if (where === 'auth') f.control.onToken = () => controller.abort();
    await assert.rejects(() => update(f, 'contacted', controller.signal, { beforeDispatch() {
      f.events.push('hook'); if (where === 'hook') controller.abort();
    } }), safeError('CANCELLED'));
    assert.equal(f.requests.length, 0);
    if (where === 'before') assert.deepEqual(f.events, []);
    if (where === 'auth') assert.ok(!f.events.includes('hook'));
  }
});

test('source/auth/hook failures do not claim completion or issue commit', async () => {
  for (const where of ['source', 'auth', 'hook']) {
    const f = fixture(), error = new CoreError('TEST_GATE', 'synthetic gate');
    if (where === 'source') f.control.readError = error;
    if (where === 'auth') f.control.authError = error;
    await assert.rejects(() => update(f, 'contacted', undefined, { beforeDispatch() { throw error; } }),
      safeError(where === 'source' ? 'SOURCE_UNAVAILABLE' : 'TEST_GATE'));
    assert.equal(f.requests.length, 0);
  }
});

test('transport errors, invalid JSON, server errors or incomplete commit receipts are unknown, never retried', async () => {
  const scenarios = [
    { networkError: Error('private-provider-detail FAKE_TOKEN') }, { jsonError: Error('private-provider-detail') },
    { ok: false, status: 503, response: { error: { status: 'UNAVAILABLE', message: 'private-provider-detail' } } },
    { response: {} }, { response: null }, { response: { commitTime: TIME, writeResults: [] } },
    { response: { commitTime: TIME, writeResults: [{}] } },
    { response: { commitTime: 'bad', writeResults: [{ updateTime: TIME }] } },
    { response: { error: { status: 'PERMISSION_DENIED', message: 'private-provider-detail' } } },
  ];
  for (const scenario of scenarios) {
    const f = fixture(); Object.assign(f.control, scenario);
    await assert.rejects(() => update(f), safeError('OUTCOME_UNKNOWN')); assert.equal(f.requests.length, 1);
    assert.equal(f.events.filter(e => e === 'token').length, 1);
  }
});

test('explicit rules/CAS rejections are sanitized; no retry or Admin write fallback', async () => {
  for (const status of ['PERMISSION_DENIED', 'FAILED_PRECONDITION', 'ABORTED', 'UNAUTHENTICATED', 'RESOURCE_EXHAUSTED']) {
    const f = fixture(); Object.assign(f.control, { ok: false, status: 403,
      response: { error: { status, message: 'private-provider-detail FAKE_TOKEN' } } });
    await assert.rejects(() => update(f), safeError(status)); assert.equal(f.requests.length, 1);
  }
});

function readDocument(data = note()) {
  return { name: `${ROOT}/sequenceNotes/note_1`, fields: {
    ownerUid: { stringValue: data.ownerUid }, payload: { stringValue: data.payload },
    revision: { integerValue: String(data.revision) }, deleted: { booleanValue: data.deleted },
    // Generic output must never spread extra fields from a document.
    privateExtra: { stringValue: 'not-returned' },
  } };
}
test('sequence get returns authoritative REST state/revision, not the stale Admin payload or raw images', async () => {
  const { f, state } = imageFixture(); f.control.response = readDocument(note({ ...state, title: 'REST current' }));
  const result = await f.call('coreSequenceGet', { noteId: 'note_1' });
  assert.deepEqual(result, { state: { ...state, title: 'REST current' }, revision: 4, readOnly: false });
  assert.doesNotMatch(JSON.stringify(result), /data:image|privateExtra|not-returned/);
  const r = f.requests[0];
  assert.equal(r.url, `https://firestore.googleapis.com/v1/${ROOT}/sequenceNotes/note_1`);
  assert.equal(r.options.method, 'GET'); assert.equal(r.options.redirect, 'error');
  assert.equal(r.options.body, undefined); assert.deepEqual(r.options.headers, { Authorization: 'Bearer FAKE_TOKEN' });
  assert.deepEqual(f.events, ['read:sequenceNotes/note_1', 'token', 'get']);
});

test('owner/manager may read teacher notes, instructor only own; deleted notes not returned even to owner', async () => {
  for (const role of ['owner', 'manager', 'instructor']) {
    const f = fixture(), data = { ...note(), ownerUid: 'teacher' };
    f.current.staff.role = role; f.records.set('sequenceNotes/note_1', data); f.control.response = readDocument(data);
    if (role === 'instructor') {
      await assert.rejects(() => f.call('coreSequenceGet', { noteId: 'note_1' }), safeError('PERMISSION_DENIED'));
      assert.equal(f.requests.length, 0);
    } else assert.equal((await f.call('coreSequenceGet', { noteId: 'note_1' })).readOnly, true);
  }
  for (const missing of [false, true]) {
    const f = fixture(); if (!missing) f.records.set('sequenceNotes/note_1', { ...note(), deleted: true });
    await assert.rejects(() => f.call('coreSequenceGet', { noteId: 'note_1' }), safeError('NOT_FOUND'));
    assert.equal(f.requests.length, 0);
  }
});

test('get independently revalidates REST identity, revision, tombstone, actor and hash-only images', async () => {
  for (const mutate of [d => { d.name += '_other'; }, d => { d.fields.revision.integerValue = 'NaN'; },
    d => { d.fields.revision.integerValue = '9007199254740992'; }, d => { delete d.fields.payload; },
    d => { d.fields.payload.stringValue = '{}'; },
    d => { const s = blank(); s.moves.main = [{ ...move(), image: JPEG }]; d.fields.payload.stringValue = JSON.stringify(s); }]) {
    const f = fixture(); f.records.set('sequenceNotes/note_1', note()); f.control.response = readDocument(); mutate(f.control.response);
    await assert.rejects(() => f.call('coreSequenceGet', { noteId: 'note_1' }), safeError('SOURCE_INVALID')); assert.equal(f.requests.length, 1);
  }
  const f = fixture(); f.records.set('sequenceNotes/note_1', note()); f.control.response = readDocument({ ...note(), deleted: true });
  await assert.rejects(() => f.call('coreSequenceGet', { noteId: 'note_1' }), safeError('NOT_FOUND'));
  const g = fixture(); g.current.staff.role = 'instructor'; g.records.set('sequenceNotes/note_1', note());
  g.control.response = readDocument({ ...note(), ownerUid: 'another' });
  await assert.rejects(() => g.call('coreSequenceGet', { noteId: 'note_1' }), safeError('PERMISSION_DENIED'));
});

test('read token precedes hook and ID-token REST denial never falls back to Admin content', async () => {
  for (const fault of ['denied', 'network', 'json', 'cancel', 'hook']) {
    const f = fixture(), controller = new AbortController(); f.records.set('sequenceNotes/note_1', note());
    f.control.response = readDocument();
    if (fault === 'denied') { f.control.ok = false; f.control.response = { error: { message: 'private-provider-detail' } }; }
    if (fault === 'network') f.control.networkError = Error('private-provider-detail');
    if (fault === 'json') f.control.jsonError = Error('private-provider-detail');
    await assert.rejects(() => f.call('coreSequenceGet', { noteId: 'note_1' }, controller.signal, { beforeDispatch() {
      assert.equal(f.events.at(-1), 'token'); f.events.push('hook');
      if (fault === 'cancel') controller.abort();
      if (fault === 'hook') throw new CoreError('TEST_GATE', 'synthetic gate');
    } }), safeError(fault === 'cancel' ? 'CANCELLED' : fault === 'hook' ? 'TEST_GATE' : 'SOURCE_UNAVAILABLE'));
    assert.equal(f.requests.length, ['cancel', 'hook'].includes(fault) ? 0 : 1);
  }
});

test('mocked operator-only lifecycle create -> title update -> tombstone retains audit note', async () => {
  const f = fixture(), state = blank(); state.id = 'operator_smoke_fake';
  const created = await save(f, state, 0); assert.equal(created.revision, 1);
  // Mock server persistence only: no live credentials or external calls.
  const persisted = { ...note(state), revision: 1 };
  f.records.set('sequenceNotes/operator_smoke_fake', persisted);
  state.title = 'operator smoke updated';
  const updated = await save(f, state, 1); assert.equal(updated.revision, 2);
  f.records.set('sequenceNotes/operator_smoke_fake', { ...persisted, revision: 2, payload: JSON.stringify(state), title: state.title });
  const removed = await f.call('coreSequenceRemove', { noteId: state.id, expectedRevision: 2 }); assert.equal(removed.revision, 3);
  assert.equal(removed.deleted, true);
  f.records.set('sequenceNotes/operator_smoke_fake', { ...persisted, revision: 3, deleted: true, payload: '{}' });
  await assert.rejects(() => save(f, state, 0), safeError('CONFLICT'));
  assert.equal(f.requests.length, 3);
  assert.ok(f.requests.every(r => r.body.writes.every(w => !Object.hasOwn(w, 'delete'))));
});
