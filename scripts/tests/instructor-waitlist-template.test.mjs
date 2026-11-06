import assert from 'node:assert/strict';
import test from 'node:test';
import { INSTRUCTOR_WAITLIST_TEMPLATE as spec, instructorWaitlistTemplatePayload,
  assertInstructorWaitlistTemplate } from '../lib/instructor-waitlist-template.mjs';
import { INSTRUCTOR_WAITLIST_STATE_FILE, listInstructorWaitlistTemplates, main,
  runInstructorWaitlistTemplate } from '../create-instructor-waitlist-solapi-template.mjs';

const NEW_ID = 'KA01TPsyntheticNew';
const reference = { templateId: spec.referenceTemplateId, status: 'APPROVED', channelId: spec.channelId,
  categoryCode: '004001', messageType: 'BA', emphasizeType: 'IMAGE', imageId: 'reference-image', securityFlag: false };
const body = '#{이름}님,\nARCHIVE PILATES 수강대기가 접수되었습니다.\n\n수업: #{수업명}\n주제: #{수업주제}\n수강일: #{수강일}\n\n현재는 예약 확정 전이며,\n결원 발생 시 별도로 안내드립니다.\n\n아래 버튼에서 현재 대기순번을 확인하거나\n수강대기를 취소하실 수 있습니다.';

function fixture(options = {}) {
  const payload = instructorWaitlistTemplatePayload(reference);
  let state = {}, current = options.current ? { ...structuredClone(payload), templateId: NEW_ID, status: 'PENDING', ...options.current } : null;
  const calls = [], events = [];
  let locked = false, saves = 0, releases = 0, reads = 0;
  const journal = {
    read() { return structuredClone(state); },
    save(value) { assert.equal(locked, true); state = structuredClone(value); saves++; events.push('save'); },
    acquire() {
      assert.equal(locked, false); locked = true;
      return () => { locked = false; releases++; };
    },
  };
  const request = async (resource, method = 'GET', sent) => {
    calls.push({ resource, method, body: structuredClone(sent) }); events.push(`${method} ${resource}`);
    if (method === 'GET' && resource === `/kakao/v2/templates/${spec.referenceTemplateId}`)
      return structuredClone({ ...reference, ...options.reference });
    if (method === 'GET' && resource.startsWith('/kakao/v2/templates?')) {
      if (options.list) return options.list({ current, calls });
      return { templateList: current ? [structuredClone(current)] : [] };
    }
    if (method === 'POST' && resource === '/kakao/v2/templates') {
      assert.ok(state.creationIntentAt); assert.deepEqual(state.payload, sent);
      assert.equal(state.templateId, undefined); assert.equal(locked, true);
      if (options.post) return options.post({ sent, state });
      current = { ...structuredClone(sent), templateId: NEW_ID, status: 'PENDING' };
      return structuredClone(current);
    }
    if (method === 'GET' && resource === `/kakao/v2/templates/${NEW_ID}`) {
      reads++;
      if (options.readback) return options.readback({ current, reads });
      assert.ok(current); return structuredClone(current);
    }
    if (method === 'PUT' && resource === `/kakao/v2/templates/${NEW_ID}/inspection`) {
      assert.ok(state.inspectionIntentAt); assert.equal(state.templateId, NEW_ID);
      assert.equal(state.createdByThisJournal, true); assert.equal(locked, true);
      assert.deepEqual(state.payload, payload);
      assert.deepEqual(calls.at(-2), { resource: `/kakao/v2/templates/${NEW_ID}`, method: 'GET', body: undefined });
      if (options.put) return options.put({ current, state });
      current.status = 'INSPECTING'; return {};
    }
    throw Error(`Unexpected fake transport: ${method} ${resource}`);
  };
  return { request, journal, calls, events,
    run(mode = '--apply') { return runInstructorWaitlistTemplate({ mode, request, journal, now: () => '2026-11-06T03:00:00.000Z' }); },
    get state() { return state; },
    get current() { return current; },
    get stats() { return { saves, releases, locked }; },
    setState(value) { state = structuredClone(value); },
  };
}

test('exact body and variables never embed an initial or current queue number', () => {
  assert.equal(spec.name, '강사레슨_수강대기 접수 안내 v1');
  assert.equal(spec.referenceTemplateId, 'KA01TP2608241233353269Jgtoiwnzi6');
  assert.equal(spec.channelId, 'KA01PF260511123407631PSoAflYAVXs');
  assert.equal(spec.content, body);
  assert.deepEqual([...body.matchAll(/#\{([^}]+)\}/g)].map(match => match[1]), ['이름', '수업명', '수업주제', '수강일']);
  assert.doesNotMatch(body, /#\{[^}]*(순번|번호|대기ID|대기토큰)[^}]*\}|\d/);
  assert.ok(body.length < 1000);
});

test('two exact WL links keep credentials and cancel view in the fragment, with no PII', () => {
  const link = 'https://in.archivepilates.com/instructor-waitlist/?id=#{대기ID}#token=#{대기토큰}';
  assert.equal(spec.buttons.length, 2);
  assert.deepEqual(spec.buttons.map(b => b.buttonName), ['현재 대기순번 확인', '수강대기 취소']);
  spec.buttons.forEach((button, index) => {
    assert.equal(button.buttonType, 'WL'); assert.equal(button.targetOut, true);
    assert.equal(button.linkMo, button.linkPc);
    assert.equal(button.linkMo, `${link}${index ? '&view=cancel' : ''}`);
    assert.deepEqual([...button.linkMo.matchAll(/#\{([^}]+)\}/g)].map(m => m[1]), ['대기ID', '대기토큰']);
    const url = new URL(button.linkMo.replace('#{대기ID}', 'opaque-id').replace('#{대기토큰}', 'opaque-token'));
    assert.equal(url.origin, 'https://in.archivepilates.com');
    assert.equal(url.pathname, '/instructor-waitlist/');
    assert.deepEqual([...url.searchParams], [['id', 'opaque-id']]);
    assert.equal(url.hash, `#token=opaque-token${index ? '&view=cancel' : ''}`);
    assert.doesNotMatch(url.search, /token|이름|전화|phone|name|순번|rank|position/i);
  });
});

test('new BA/NONE definition never copies the reference image or mutates the reference', () => {
  const before = structuredClone(reference), payload = instructorWaitlistTemplatePayload(reference);
  assert.deepEqual(reference, before);
  assert.equal(payload.messageType, 'BA'); assert.equal(payload.emphasizeType, 'NONE');
  assert.equal(payload.categoryCode, reference.categoryCode); assert.equal(payload.securityFlag, false);
  assert.equal('imageId' in payload, false); assert.deepEqual(payload.quickReplies, []);
  payload.buttons[0].linkMo = 'changed'; assert.notEqual(spec.buttons[0].linkMo, 'changed');
  assert.ok(INSTRUCTOR_WAITLIST_STATE_FILE.endsWith('/ArchiveIN/operations/instructor-waitlist-notice-20261106/template-state.json'));
});

test('reference identity, channel, approval, type, category and security flag fail closed', () => {
  for (const change of [{ templateId: NEW_ID }, { status: 'PENDING' }, { channelId: 'other' }, { isDeleted: true },
    { messageType: 'AD' }, { categoryCode: '' }, { categoryCode: null }, { securityFlag: 'false' }, { securityFlag: undefined }])
    assert.throws(() => instructorWaitlistTemplatePayload({ ...reference, ...change }));
});

test('all known statuses validate structurally, unknown statuses fail', () => {
  const payload = instructorWaitlistTemplatePayload(reference);
  for (const status of ['PENDING', 'INSPECTING', 'APPROVED', 'REJECTED'])
    assert.doesNotThrow(() => assertInstructorWaitlistTemplate({ ...payload, status }, payload));
  for (const status of ['UNKNOWN', 'DELETED', undefined, 'approved'])
    assert.throws(() => assertInstructorWaitlistTemplate({ ...payload, status }, payload));
});

test('provider content, presentation, security and link drift fail exact readback', () => {
  const payload = instructorWaitlistTemplatePayload(reference), actual = { ...payload, status: 'PENDING' };
  for (const change of [{ content: `${body}\n대기순번: #{대기순번}` }, { channelId: 'other' }, { name: 'other' },
    { categoryCode: 'other' }, { messageType: 'AD' }, { emphasizeType: 'IMAGE' }, { securityFlag: true },
    { imageId: 'image' }, { imageUrl: 'https://example.com/image' }, { ad: 'promotion' }, { extra: 'other' },
    { header: 'other' }, { title: 'other' }, { subtitle: 'other' }, { highlight: {} }, { item: {} },
    { commerce: {} }, { quickReplies: [{}] }, { quickReplies: {} }, { isDeleted: true }, { buttons: [] },
    { buttons: [...payload.buttons].reverse() }, { buttons: [{ ...payload.buttons[0], linkMo: 'https://example.com' }, payload.buttons[1]] },
    { buttons: [{ ...payload.buttons[0], linkAnd: 'app://other' }, payload.buttons[1]] },
    { buttons: [{ ...payload.buttons[0], targetOut: false }, payload.buttons[1]] }])
    assert.throws(() => assertInstructorWaitlistTemplate({ ...actual, ...change }, payload));
});

test('optional empty text fields are safe without normalizing required fields or structured defaults', () => {
  const payload = instructorWaitlistTemplatePayload(reference), actual = { ...payload, status: 'PENDING' };
  for (const empty of ['', null, undefined]) {
    const optional = Object.fromEntries(['ad', 'extra', 'imageId', 'imageUrl', 'header', 'title', 'subtitle', 'highlight', 'item', 'commerce']
      .map(key => [key, empty]));
    const buttons = payload.buttons.map(button => ({ ...button, linkAnd: empty, linkIos: empty }));
    assert.doesNotThrow(() => assertInstructorWaitlistTemplate({ ...actual, ...optional, buttons }, payload));
  }
  for (const quickReplies of [[], null, undefined])
    assert.doesNotThrow(() => assertInstructorWaitlistTemplate({ ...actual, quickReplies }, payload));
  for (const change of [{ item: {} }, { highlight: {} }, { quickReplies: '' }, { securityFlag: null },
    { buttons: payload.buttons.map(button => ({ ...button, targetOut: undefined })) }])
    assert.throws(() => assertInstructorWaitlistTemplate({ ...actual, ...change }, payload));
});

test('read-only uses GET only, with no journal/lock writes or real transport factory', async () => {
  for (const current of [null, { status: 'PENDING' }, { status: 'INSPECTING' }, { status: 'APPROVED' }, { status: 'REJECTED' }]) {
    const f = fixture({ current });
    const result = await main(['--read-only'], { request: f.request, journal: f.journal,
      makeRequest: () => { throw Error('Real credential transport must not run'); } });
    assert.equal(result.status, current?.status ?? 'NOT_CREATED'); assert.equal(result.memberSends, 0);
    assert.ok(f.calls.every(c => c.method === 'GET'));
    assert.deepEqual(f.stats, { saves: 0, releases: 0, locked: false });
    assert.deepEqual(result.proposal, instructorWaitlistTemplatePayload(reference));
  }
});

test('invalid CLI flags never initialize transport or journal', async () => {
  for (const args of [[], ['--send'], ['--apply', '--read-only'], ['--apply', '--template-id=other']])
    await assert.rejects(main(args, { makeRequest: () => { throw Error('must not run'); }, journal: null }), /Use --read-only or --apply/);
});

test('apply durably records intents, creates once, verifies original payload, and inspects only the new ID', async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.status, 'INSPECTING'); assert.equal(result.templateId, NEW_ID); assert.equal(result.memberSends, 0);
  assert.deepEqual(f.calls.filter(c => c.method !== 'GET').map(c => [c.method, c.resource]),
    [['POST', '/kakao/v2/templates'], ['PUT', `/kakao/v2/templates/${NEW_ID}/inspection`]]);
  assert.ok(f.state.creationIntentAt); assert.ok(f.state.inspectionIntentAt); assert.ok(f.state.verifiedAt);
  assert.equal(f.state.templateId, NEW_ID); assert.equal(f.state.createdByThisJournal, true);
  assert.deepEqual(f.state.payload, instructorWaitlistTemplatePayload(reference));
  assert.equal(f.events[f.events.indexOf('POST /kakao/v2/templates') - 1], 'save');
  assert.equal(f.events[f.events.indexOf(`PUT /kakao/v2/templates/${NEW_ID}/inspection`) - 1], 'save');
  assert.equal(f.stats.locked, false); assert.equal(f.stats.releases, 1);
  const before = f.calls.length;
  await f.run(); f.current.status = 'APPROVED'; await f.run();
  assert.ok(f.calls.slice(before).every(c => c.method === 'GET'));
  assert.equal(f.state.status, 'APPROVED');
});

test('same-name template without journal ownership is never submitted or modified', async () => {
  const f = fixture({ current: { status: 'PENDING' } });
  await assert.rejects(f.run(), /Unowned template/);
  assert.ok(f.calls.every(c => c.method === 'GET')); assert.equal(f.stats.releases, 1);
});

test('paging exhausts every cursor and detects same-name duplicates on later pages', async () => {
  const cursors = [];
  const rows = await listInstructorWaitlistTemplates(async resource => {
    const url = new URL(resource, 'https://fake.invalid'), cursor = url.searchParams.get('startKey'); cursors.push(cursor);
    return { templateList: [], nextKey: cursor === null ? 'first/+ cursor' : cursor === 'first/+ cursor' ? 'last' : null };
  });
  assert.deepEqual(rows, []); assert.deepEqual(cursors, [null, 'first/+ cursor', 'last']);
  const f = fixture({ list: ({ calls }) => {
    const last = calls.at(-1).resource.includes('startKey=');
    return { templateList: [{ channelId: spec.channelId, name: spec.name, templateId: last ? NEW_ID : 'KA01TPother' }], nextKey: last ? null : 'next' };
  } });
  await assert.rejects(f.run(), /Duplicate template names/); assert.ok(f.calls.every(c => c.method === 'GET'));
});

test('repeated or invalid cursors and incomplete/wrong-channel inventories fail closed', async () => {
  for (const reply of [{ templateList: [], nextKey: 'repeat' }, { templateList: [], nextKey: {} }, {},
    { templateList: [{ templateId: NEW_ID, name: spec.name, channelId: 'wrong' }] }]) {
    let count = 0;
    await assert.rejects(listInstructorWaitlistTemplates(async () => { assert.ok(++count <= 2); return reply; }));
  }
});

test('even a deleted same-name template blocks recreation', async () => {
  const f = fixture({ current: { isDeleted: true } });
  await assert.rejects(f.run(), /deleted/); assert.ok(f.calls.every(c => c.method === 'GET'));
});

test('ambiguous create is never retried, including after matching template appears', async () => {
  const f = fixture({ post: () => { throw Error('synthetic ambiguous transport'); } });
  await assert.rejects(f.run(), /ambiguous/); assert.ok(f.state.creationIntentAt);
  await assert.rejects(f.run(), /Unknown prior create/);
  const read = await f.run('--read-only'); assert.equal(read.recoveryRequired, true); assert.equal(read.status, 'CREATE_UNKNOWN');
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  const withMatch = fixture({ current: { status: 'PENDING' } }); withMatch.setState(f.state);
  await assert.rejects(withMatch.run(), /Unknown prior create/);
  assert.ok(withMatch.calls.every(c => c.method === 'GET'));
});

test('missing create ID leaves a durable intent and blocks a second POST', async () => {
  const f = fixture({ post: () => ({ status: 'PENDING' }) });
  await assert.rejects(f.run(), /Unknown template create result/);
  await assert.rejects(f.run(), /Unknown prior create/);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});

test('known created ID survives provider drift and readback failures, without inspection', async () => {
  for (const readback of [() => { throw Error('readback unavailable'); },
    ({ current }) => ({ ...current, content: 'drift' }), ({ current }) => ({ ...current, templateId: 'KA01TPother' })]) {
    const f = fixture({ readback });
    await assert.rejects(f.run()); assert.equal(f.state.templateId, NEW_ID);
    assert.equal(f.calls.filter(c => c.method === 'PUT').length, 0); assert.equal(f.stats.locked, false);
    await assert.rejects(f.run()); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  }
});

test('create cannot redirect inspection to the reference or any pre-existing template', async () => {
  for (const id of [spec.referenceTemplateId, 'KA01TPother']) {
    const f = fixture({ list: () => ({ templateList: [{ templateId: 'KA01TPother', name: 'other', channelId: spec.channelId }] }),
      post: () => ({ templateId: id }) });
    await assert.rejects(f.run(), /Unowned/); assert.equal(f.state.templateId, id);
    assert.equal(f.state.createdByThisJournal, false); assert.equal(f.calls.filter(c => c.method === 'PUT').length, 0);
    await assert.rejects(f.run()); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  }
});

test('fresh pre-inspection readback catches drift after the first successful readback', async () => {
  const f = fixture({ readback: ({ current, reads }) => ({ ...current, ...(reads > 1 ? { content: 'drift' } : {}) }) });
  await assert.rejects(f.run(), /content mismatch/);
  assert.equal(f.state.templateId, NEW_ID); assert.equal(f.state.inspectionIntentAt, undefined);
  assert.equal(f.calls.filter(c => c.method === 'PUT').length, 0);
});

test('ambiguous inspection never resubmits; independent INSPECTING readback reconciles it', async () => {
  const f = fixture({ put: () => { throw Error('synthetic inspection ambiguity'); } });
  await assert.rejects(f.run(), /ambiguity/); assert.ok(f.state.inspectionIntentAt);
  await assert.rejects(f.run(), /no blind resubmit/);
  assert.equal((await f.run('--read-only')).recoveryRequired, true);
  f.current.status = 'INSPECTING'; assert.equal((await f.run()).status, 'INSPECTING');
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(f.calls.filter(c => c.method === 'PUT').length, 1);
});

test('inspection response alone is not completion and rejected/unknown states are not mutated', async () => {
  const f = fixture({ put: () => ({ status: 'INSPECTING' }) });
  await assert.rejects(f.run(), /Inspection not confirmed/);
  await assert.rejects(f.run(), /no blind resubmit/);
  f.current.status = 'REJECTED'; await assert.rejects(f.run(), /rejected/);
  f.current.status = 'UNKNOWN'; await assert.rejects(f.run(), /Unknown template status/);
  assert.equal(f.calls.filter(c => c.method === 'PUT').length, 1);
});

test('journal payload/category drift, missing owned result, or failed durable save prevents mutation', async () => {
  const original = fixture(); await original.run();
  const changed = fixture({ current: {}, reference: { categoryCode: 'changed' } }); changed.setState(original.state);
  await assert.rejects(changed.run(), /content drift/); assert.ok(changed.calls.every(c => c.method === 'GET'));
  const missing = fixture(); missing.setState(original.state);
  await assert.rejects(missing.run(), /result missing/); assert.ok(missing.calls.every(c => c.method === 'GET'));
  const badSave = fixture(); badSave.journal.save = () => { throw Error('durability unavailable'); };
  await assert.rejects(badSave.run(), /durability/); assert.ok(badSave.calls.every(c => c.method === 'GET'));
  assert.equal(badSave.stats.locked, false);
  const badInspectionSave = fixture(); const save = badInspectionSave.journal.save;
  badInspectionSave.journal.save = value => { if (value.inspectionIntentAt) throw Error('durability unavailable'); save(value); };
  await assert.rejects(badInspectionSave.run(), /durability/);
  assert.equal(badInspectionSave.calls.filter(c => c.method === 'PUT').length, 0);
});

test('inventory ending on page twenty succeeds without requesting page twenty-one', async () => {
  let count = 0;
  const rows = await listInstructorWaitlistTemplates(async () => {
    assert.ok(++count <= 20);
    return { templateList: [{ templateId: `KA01TPpage${count}`, channelId: spec.channelId, name: `other-${count}` }],
      nextKey: count < 20 ? `page-${count}` : null };
  });
  assert.equal(count, 20); assert.equal(rows.length, 20);
});

test('continuation after page twenty fails without returning a partial inventory or requesting more', async () => {
  let count = 0;
  await assert.rejects(listInstructorWaitlistTemplates(async () => {
    assert.ok(++count <= 20);
    return { templateList: [], nextKey: `page-${count}` };
  }), /20-page limit/);
  assert.equal(count, 20);
});

test('duplicate template IDs across pages or within one page fail even with different names', async () => {
  const row = { templateId: 'KA01TPduplicate', channelId: spec.channelId, name: 'other' };
  for (const samePage of [false, true]) {
    let count = 0;
    await assert.rejects(listInstructorWaitlistTemplates(async () => {
      count++;
      if (samePage) return { templateList: [row, { ...row, name: 'renamed' }] };
      return { templateList: [{ ...row, name: `other-${count}` }], nextKey: count === 1 ? 'next' : null };
    }), /Duplicate template IDs/);
    assert.equal(count, samePage ? 1 : 2);
  }
});

test('over-limit or duplicate-ID inventory blocks both creation and later inspection', async () => {
  for (const phase of ['create', 'inspection']) {
    for (const failure of ['limit', 'duplicate']) {
      let pages = 0;
      const row = { templateId: 'KA01TPduplicate', channelId: spec.channelId, name: 'other' };
      const f = fixture({ list: ({ current }) => {
        if (phase === 'inspection' && !current) return { templateList: [] };
        pages++;
        return failure === 'limit' ? { templateList: [], nextKey: `page-${pages}` }
          : { templateList: [row], nextKey: pages === 1 ? 'next' : null };
      } });
      await assert.rejects(f.run(), failure === 'limit' ? /20-page limit/ : /Duplicate template IDs/);
      assert.equal(pages, failure === 'limit' ? 20 : 2);
      assert.equal(f.calls.filter(c => c.method === 'POST').length, phase === 'create' ? 0 : 1);
      assert.equal(f.calls.filter(c => c.method === 'PUT').length, 0);
      assert.equal(f.stats.locked, false);
      if (phase === 'inspection') assert.equal(f.state.templateId, NEW_ID);
    }
  }
});

test('a duplicate appearing after creation blocks inspection without recreating', async () => {
  const f = fixture({ list: ({ current }) => ({ templateList: current
    ? [current, { ...current, templateId: 'KA01TPduplicate' }] : [] }) });
  await assert.rejects(f.run(), /Duplicate template names/);
  assert.equal(f.state.templateId, NEW_ID); assert.equal(f.state.inspectionIntentAt, undefined);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(f.calls.filter(c => c.method === 'PUT').length, 0);
});

test('lock failure and malformed journal block even transport initialization', async () => {
  let initialized = false;
  const makeRequest = () => { initialized = true; throw Error('must not initialize'); };
  await assert.rejects(runInstructorWaitlistTemplate({ mode: '--apply', makeRequest,
    journal: { acquire() { throw Error('lock held'); } } }), /lock held/);
  for (const state of [null, [], { actionKey: 'other' }, { creationIntentAt: 'prior' }]) {
    const f = fixture(); f.setState(state);
    await assert.rejects(runInstructorWaitlistTemplate({ mode: '--apply', makeRequest, journal: f.journal }), /journal/);
    assert.equal(f.stats.releases, 1);
  }
  assert.equal(initialized, false);
});

test('status changes on the last pre-inspection read are respected without an extra PUT', async () => {
  for (const status of ['APPROVED', 'INSPECTING', 'REJECTED']) {
    const f = fixture({ readback: ({ current, reads }) => ({ ...current, ...(reads > 1 ? { status } : {}) }) });
    if (status === 'REJECTED') await assert.rejects(f.run(), /Inspection not confirmed/);
    else assert.equal((await f.run()).status, status);
    assert.equal(f.calls.filter(c => c.method === 'PUT').length, 0);
  }
});
