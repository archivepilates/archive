import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  MEMBER_SMS_PROVIDER_POLICY,
  acceptedMemberSmsMarker,
  createMemberSmsSender,
  memberSmsReceiptFields,
} from '../lib/member-sms-solapi.mjs';

const SENDER = '0200000000';
const RECIPIENT = '01000000000';
const MESSAGE = 'M' + '1'.repeat(24);
const GROUP = 'G' + '2'.repeat(24);
const OTHER_GROUP = 'G' + '3'.repeat(24);
const DAYTIME = '2026-10-31T03:00:00.000Z';
const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const planFor = patch => ({ key: 'synthetic:member-sms:1', memberPhone: RECIPIENT,
  smsTitle: 'ARCHIVE PILATES', smsMessage: 'Synthetic message only.\nNo real recipient.', ...patch });
const receiptFor = (code = '2000') => ({ messageList: [{ messageId: MESSAGE, groupId: GROUP, statusCode: code }],
  failedMessageList: [], groupInfo: { groupId: GROUP } });
const historyRow = (id = MESSAGE, patch = {}) => ({ messageId: id, to: RECIPIENT, from: SENDER,
  type: 'LMS', text: 'A different synthetic message.', ...patch });
const historyPage = (rows = [], nextKey) => ({ messageList: Object.fromEntries(rows.map(row => [row.messageId, row])),
  ...(nextKey === undefined ? {} : { nextKey }) });

function fixture({ active = [{ phoneNumber: SENDER, status: 'ACTIVE' }], pages = [historyPage()],
  response = receiptFor(), postError, readError, onRead, onPost, assertAllowed, initialTime = DAYTIME } = {}) {
  let clock = new Date(initialTime);
  let pageIndex = 0;
  const calls = [], events = [];
  const request = async (resource, method, body) => {
    calls.push({ resource, method, body: structuredClone(body) });
    if (method === 'POST') {
      events.push('post');
      assert.equal(resource, '/messages/v4/send-many/detail');
      if (postError) throw postError;
      if (onPost) await onPost();
      return structuredClone(response);
    }
    assert.equal(method, 'GET');
    if (readError) throw readError;
    if (onRead) await onRead(resource);
    if (resource === '/senderid/v1/numbers/active') {
      events.push('active');
      return structuredClone(active);
    }
    const url = new URL(resource, 'https://synthetic.invalid');
    assert.equal(url.pathname, '/messages/v4/list');
    assert.equal(url.searchParams.get('to'), RECIPIENT);
    assert.equal(url.searchParams.has('from'), false, 'history must cover every account sender and channel');
    assert.equal(url.searchParams.get('limit'), '500');
    assert.equal(url.searchParams.has('type'), false, 'history must cover every provider message type');
    events.push('history');
    assert(pageIndex < pages.length, 'unexpected extra history request');
    return structuredClone(pages[pageIndex++]);
  };
  const options = { request, senderNumber: SENDER, now: () => new Date(clock) };
  if (assertAllowed) options.assertAllowed = () => { events.push('allowed'); assertAllowed(); };
  const send = createMemberSmsSender(options);
  const beforeFinalSend = async () => { events.push('claim'); return () => { events.push('started'); }; };
  return { send, request, calls, events, beforeFinalSend,
    setTime: value => { clock = new Date(value); },
    posts: () => calls.filter(call => call.method === 'POST') };
}

test('LMS send checks active sender and object history before claiming and one strict POST', async () => {
  const f = fixture({ assertAllowed() {} });
  const plan = planFor();
  const receipt = await f.send(plan, f.beforeFinalSend);
  assert.deepEqual(f.events, ['allowed', 'active', 'history', 'claim', 'allowed', 'started', 'allowed', 'post']);
  assert.deepEqual(f.posts()[0].body, { messages: [{ to: RECIPIENT, from: SENDER, type: 'LMS',
    subject: plan.smsTitle, text: plan.smsMessage,
    customFields: { archiveActionKey: plan.key, archivePolicy: MEMBER_SMS_PROVIDER_POLICY } }],
  strict: true, allowDuplicates: false, showMessageList: true });
  assert.deepEqual(receipt, { provider: 'solapi', providerMessageId: MESSAGE, providerGroupId: GROUP,
    providerReceipt: { policy: MEMBER_SMS_PROVIDER_POLICY, actionKey: plan.key, messageId: MESSAGE,
      groupId: GROUP, recipientHash: sha256(RECIPIENT), contentHash: sha256([plan.smsTitle, plan.smsMessage, '']),
      statusCode: '2000', acceptedAt: DAYTIME } });
  assert.deepEqual(memberSmsReceiptFields(receipt, plan), receipt);
  assert.equal(acceptedMemberSmsMarker({ ...receipt, key: plan.key }), true);
  assert.equal(f.posts().length, 1);
});

test('explicit subject and optional image produce the exact approved MMS payload', async () => {
  const f = fixture();
  const plan = planFor({ imageId: 'synthetic_image_123' });
  const receipt = await f.send(plan, f.beforeFinalSend, { subject: 'Short subject' });
  const message = f.posts()[0].body.messages[0];
  assert.equal(message.type, 'MMS');
  assert.equal(message.imageId, plan.imageId);
  assert.equal(message.subject, 'Short subject');
  assert.equal(receipt.providerReceipt.contentHash, sha256(['Short subject', plan.smsMessage, plan.imageId]));
  assert.deepEqual(memberSmsReceiptFields(receipt, plan, { subject: 'Short subject' }), receipt);
  assert.throws(() => memberSmsReceiptFields(receipt, plan), /member_sms_receipt_unverified/);
  assert.throws(() => memberSmsReceiptFields(receipt, plan, { subject: 'Wrong subject' }), /member_sms_receipt_unverified/);
  const query = new URL(f.calls[1].resource, 'https://synthetic.invalid').searchParams;
  assert.equal(query.has('type'), false);
});

test('receipt content hash distinguishes effective subjects including the empty SMS subject', async () => {
  const plan = planFor();
  const receipts = [];
  for (const subject of ['', 'First subject', 'Second subject']) {
    const f = fixture();
    const receipt = await f.send(plan, f.beforeFinalSend, { subject });
    assert.equal(receipt.providerReceipt.contentHash, sha256([subject, plan.smsMessage, '']));
    assert.deepEqual(memberSmsReceiptFields(receipt, plan, { subject }), receipt);
    assert.deepEqual(memberSmsReceiptFields(receipt, { ...plan, smsTitle: 'Different canonical title' }, { subject }), receipt);
    assert.throws(() => memberSmsReceiptFields(receipt, plan, { subject: 'Unapproved replacement' }), /member_sms_receipt_unverified/);
    receipts.push(receipt);
  }
  assert.equal(new Set(receipts.map(receipt => receipt.providerReceipt.contentHash)).size, 3);
});

test('empty subject selects SMS at 90 UTF-8 bytes and LMS above that boundary', async t => {
  for (const [name, smsMessage, type] of [
    ['short ASCII', 'Synthetic SMS.', 'SMS'],
    ['90 ASCII bytes', 'x'.repeat(90), 'SMS'],
    ['91 ASCII bytes', 'x'.repeat(91), 'LMS'],
    ['90 UTF-8 bytes', '\uac00'.repeat(30), 'SMS'],
    ['93 UTF-8 bytes', '\uac00'.repeat(31), 'LMS'],
  ]) await t.test(name, async () => {
    const f = fixture();
    const plan = planFor({ smsMessage });
    const receipt = await f.send(plan, f.beforeFinalSend, { subject: '' });
    const message = f.posts()[0].body.messages[0];
    assert.equal(message.type, type);
    assert.equal(Object.hasOwn(message, 'subject'), false);
    assert.equal(message.text, smsMessage);
    assert.equal(message.to, RECIPIENT);
    assert.equal(message.from, SENDER);
    assert.equal(new URL(f.calls[1].resource, 'https://synthetic.invalid').searchParams.has('type'), false);
    assert.deepEqual(memberSmsReceiptFields(receipt, plan, { subject: '' }), receipt);
    assert.equal(f.posts().length, 1);
  });
});

test('an empty canonical title defaults to SMS for a short body', async () => {
  const f = fixture();
  await f.send(planFor({ smsTitle: '', smsMessage: 'Synthetic SMS.' }), f.beforeFinalSend);
  assert.equal(f.posts()[0].body.messages[0].type, 'SMS');
  assert.equal(Object.hasOwn(f.posts()[0].body.messages[0], 'subject'), false);
});

test('nonempty subject always selects LMS even for a short body', async () => {
  for (const subject of ['Short subject', ' ', 'x'.repeat(40)]) {
    const f = fixture();
    await f.send(planFor({ smsMessage: 'Short.' }), f.beforeFinalSend, { subject });
    assert.equal(f.posts()[0].body.messages[0].type, 'LMS');
    assert.equal(f.posts()[0].body.messages[0].subject, subject);
  }
});

test('an image selects MMS even with empty subject and short body', async () => {
  const f = fixture();
  await f.send(planFor({ smsMessage: 'Short.', imageId: 'synthetic_image_123' }), f.beforeFinalSend, { subject: '' });
  assert.equal(f.posts()[0].body.messages[0].type, 'MMS');
  assert.equal(Object.hasOwn(f.posts()[0].body.messages[0], 'subject'), false);
});

test('short SMS provider history still blocks duplicates before the claim', async () => {
  const plan = planFor({ smsMessage: 'Short SMS.' });
  const f = fixture({ pages: [historyPage([historyRow(MESSAGE,
    { type: 'SMS', text: plan.smsMessage, customFields: { archiveActionKey: plan.key } })])] });
  await assert.rejects(f.send(plan, f.beforeFinalSend, { subject: '' }), /member_sms_prior_provider_message/);
  assert.equal(f.posts().length, 0);
  assert(!f.events.includes('claim'));
});

test('synthetic active-number string response is supported', async () => {
  const f = fixture({ active: [SENDER] });
  await f.send(planFor(), f.beforeFinalSend);
  assert.equal(f.posts().length, 1);
});

test('invalid sender configuration is rejected without requesting anything', () => {
  for (const senderNumber of [undefined, null, '', 200000000, '+82200000000', '02-0000-0000',
    ' 0200000000', '1234567890', '0'.repeat(12)]) {
    let requests = 0;
    assert.throws(() => createMemberSmsSender({ request: () => { requests++; }, senderNumber }),
      /member_sms_sender_unverified/);
    assert.equal(requests, 0);
  }
  assert.throws(() => createMemberSmsSender({ request: null, senderNumber: SENDER }), /member_sms_sender_unverified/);
});

test('invalid key, recipient, body, subject and callback fail before provider reads or claims', async t => {
  const cases = [
    ['missing key', { key: undefined }], ['empty key', { key: '' }], ['unsafe key', { key: 'bad/key' }],
    ['long key', { key: 'x'.repeat(181) }], ['missing phone', { memberPhone: undefined }],
    ['numeric phone', { memberPhone: 1000000000 }], ['formatted phone', { memberPhone: '010-0000-0000' }],
    ['international phone', { memberPhone: '+821000000000' }], ['landline recipient', { memberPhone: SENDER }],
    ['short phone', { memberPhone: '0100000' }], ['long phone', { memberPhone: '010000000000' }],
    ['missing title', { smsTitle: undefined }], ['missing body', { smsMessage: undefined }],
    ['blank body', { smsMessage: ' \n\t' }], ['nonstring body', { smsMessage: {} }],
    ['body byte bound', { smsMessage: '\uac00'.repeat(667) }],
    ['missing subject', {}, { subject: null }],
    ['subject byte bound', {}, { subject: '\uac00'.repeat(14) }],
    ['subject newline', {}, { subject: 'a\nb' }], ['subject control', {}, { subject: 'a\u0000b' }],
  ];
  for (const [name, patch, options] of cases) await t.test(name, async () => {
    const f = fixture();
    await assert.rejects(f.send(planFor(patch), f.beforeFinalSend, options), /member_sms_input_unverified/);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.events, []);
  });
  const f = fixture();
  await assert.rejects(f.send(planFor(), undefined), /member_sms_input_unverified/);
  assert.deepEqual(f.calls, []);
});

test('body and subject UTF-8 limits are inclusive', async () => {
  const f = fixture();
  await f.send(planFor({ smsMessage: 'x'.repeat(2000) }), f.beforeFinalSend, { subject: 'x'.repeat(40) });
  assert.equal(f.posts().length, 1);
});

test('invalid image identifiers fail without reading or claiming', async () => {
  for (const imageId of ['', 'short', '../synthetic-image', 'x'.repeat(151), 1]) {
    const f = fixture();
    await assert.rejects(f.send(planFor({ imageId }), f.beforeFinalSend), /member_sms_image_unverified/);
    assert.deepEqual(f.calls, []);
  }
});

test('missing, inactive, expired, or malformed active sender proof prevents claims', async () => {
  for (const active of [null, {}, [], ['0200000001'], [{ phoneNumber: SENDER, status: 'PENDING' }],
    [{ phoneNumber: SENDER, status: 'ACTIVE', expireAt: DAYTIME }],
    [{ phoneNumber: SENDER, status: 'ACTIVE', expireAt: 'not-a-date' }]]) {
    const f = fixture({ active });
    await assert.rejects(f.send(planFor(), f.beforeFinalSend), /member_sms_(sender_inactive|provider_preflight_unverified)/);
    assert.equal(f.posts().length, 0);
    assert(!f.events.includes('claim'));
  }
});

test('a matching active sender with future expiry is accepted', async () => {
  const f = fixture({ active: [{ phoneNumber: SENDER, status: 'ACTIVE', expireAt: '2026-11-01T00:00:00Z' }] });
  await f.send(planFor(), f.beforeFinalSend);
  assert.equal(f.posts().length, 1);
});

test('history pagination follows valid cursors and is fully read before claim', async () => {
  const cursor = 'M' + '4'.repeat(24);
  const f = fixture({ pages: [historyPage([historyRow()], cursor), historyPage()] });
  await f.send(planFor(), f.beforeFinalSend);
  assert.deepEqual(f.events, ['active', 'history', 'history', 'claim', 'started', 'post']);
  assert.equal(new URL(f.calls[2].resource, 'https://synthetic.invalid').searchParams.get('startKey'), cursor);
});

test('prior matching action or exact body on any page blocks before callback', async () => {
  for (const patch of [{ customFields: { archiveActionKey: planFor().key } }, { text: planFor().smsMessage }]) {
    const f = fixture({ pages: [historyPage([], MESSAGE), historyPage([historyRow(MESSAGE, patch)])] });
    await assert.rejects(f.send(planFor(), f.beforeFinalSend), /member_sms_prior_provider_message/);
    assert(!f.events.includes('claim'));
    assert.equal(f.posts().length, 0);
  }
});

test('same generic body is allowed only for a different proven canonical action', async t => {
  const differentKey = 'synthetic:member-sms:new-document';
  const cases = [
    ['different proven action', { archiveActionKey: differentKey, archivePolicy: MEMBER_SMS_PROVIDER_POLICY }, true],
    ['same proven action', { archiveActionKey: planFor().key, archivePolicy: MEMBER_SMS_PROVIDER_POLICY }, false],
    ['same action without policy', { archiveActionKey: planFor().key }, false],
    ['same action with unknown policy', { archiveActionKey: planFor().key, archivePolicy: 'unknown' }, false],
    ['unkeyed', undefined, false],
    ['policy only', { archivePolicy: MEMBER_SMS_PROVIDER_POLICY }, false],
    ['different action without policy', { archiveActionKey: differentKey }, false],
    ['different action with unknown policy', { archiveActionKey: differentKey, archivePolicy: 'unknown' }, false],
    ['invalid action key', { archiveActionKey: 'bad/key', archivePolicy: MEMBER_SMS_PROVIDER_POLICY }, false],
    ['empty action key', { archiveActionKey: '', archivePolicy: MEMBER_SMS_PROVIDER_POLICY }, false],
    ['nonstring action key', { archiveActionKey: 123, archivePolicy: MEMBER_SMS_PROVIDER_POLICY }, false],
    ['oversized action key', { archiveActionKey: 'x'.repeat(181), archivePolicy: MEMBER_SMS_PROVIDER_POLICY }, false],
  ];
  for (const [name, customFields, allowed] of cases) await t.test(name, async () => {
    const plan = planFor();
    const f = fixture({ pages: [historyPage([], MESSAGE),
      historyPage([historyRow(MESSAGE, { text: plan.smsMessage, customFields })])] });
    if (allowed) {
      const receipt = await f.send(plan, f.beforeFinalSend);
      assert.equal(f.posts().length, 1);
      assert(f.events.includes('claim'));
      assert.equal(receipt.providerReceipt.actionKey, plan.key);
    } else {
      await assert.rejects(f.send(plan, f.beforeFinalSend), /member_sms_prior_provider_message/);
      assert.equal(f.posts().length, 0);
      assert(!f.events.includes('claim'));
    }
  });
});

test('same action blocks across SMS, LMS, MMS and non-text types before claim', async t => {
  for (const type of ['SMS', 'LMS', 'MMS', 'ATA', 'RCS']) await t.test(type, async () => {
    const plan = planFor();
    const row = historyRow(MESSAGE, { type, text: type === 'ATA' ? undefined : 'Different body.',
      customFields: { archiveActionKey: plan.key, archivePolicy: MEMBER_SMS_PROVIDER_POLICY } });
    const f = fixture({ pages: [historyPage([row])] });
    await assert.rejects(f.send(plan, f.beforeFinalSend), /member_sms_prior_provider_message/);
    assert.equal(f.posts().length, 0);
    assert(!f.events.includes('claim'));
  });
});

test('unkeyed matching text blocks across every direct text type', async () => {
  for (const type of ['SMS', 'LMS', 'MMS']) {
    const plan = planFor();
    const f = fixture({ pages: [historyPage([historyRow(MESSAGE, { type, text: plan.smsMessage })])] });
    await assert.rejects(f.send(plan, f.beforeFinalSend), /member_sms_prior_provider_message/);
    assert.equal(f.posts().length, 0);
    assert(!f.events.includes('claim'));
  }
});

test('another valid sender is accepted in unrelated text history', async () => {
  const f = fixture({ pages: [historyPage([historyRow(MESSAGE, { from: '0200000001' })])] });
  await f.send(planFor(), f.beforeFinalSend);
  assert.equal(f.posts().length, 1);
  assert.equal(f.posts()[0].body.messages[0].from, SENDER);
});

test('same action under another sender or senderless ATA blocks before claim', async () => {
  for (const patch of [{ type: 'LMS', from: '0200000001' }, { type: 'ATA', from: null, text: undefined }]) {
    const plan = planFor();
    const row = historyRow(MESSAGE, { ...patch, customFields: { archiveActionKey: plan.key } });
    const f = fixture({ pages: [historyPage([row])] });
    await assert.rejects(f.send(plan, f.beforeFinalSend), /member_sms_prior_provider_message/);
    assert.equal(f.posts().length, 0);
    assert(!f.events.includes('claim'));
  }
});

test('non-text history with another action is skipped after validating identity and routing', async () => {
  for (const patch of [{ type: 'ATA', text: undefined }, { type: 'ATA', text: planFor().smsMessage },
    { type: 'ATA', from: null, text: undefined }, { type: 'RCS', text: null }]) {
    const row = historyRow(MESSAGE, { ...patch, customFields: { archiveActionKey: 'synthetic:other-action' } });
    const f = fixture({ pages: [historyPage([row])] });
    await f.send(planFor(), f.beforeFinalSend);
    assert.equal(f.posts().length, 1);
  }
  const f = fixture({ pages: [historyPage([historyRow(MESSAGE, { type: 'ATA', to: '01000000001' })])] });
  await assert.rejects(f.send(planFor(), f.beforeFinalSend), /member_sms_history_unverified/);
  assert.equal(f.posts().length, 0);
  assert(!f.events.includes('claim'));
});

test('history requires bounded object pages with exact row identity and recipient/type binding', async t => {
  const badRows = [null, {}, { ...historyRow(), messageId: 'bad' },
    historyRow(MESSAGE, { to: '01000000001' }), historyRow(MESSAGE, { from: 'not-a-phone' }),
    historyRow(MESSAGE, { type: null }), historyRow(MESSAGE, { text: null })];
  const pages = [null, [], {}, { messageList: [] }, { messageList: null },
    ...badRows.map(row => ({ messageList: { [MESSAGE]: row } })),
    { messageList: {}, nextKey: 'bad' }, { messageList: {}, nextKey: 123 }];
  for (const [index, page] of pages.entries()) await t.test(`malformed page ${index}`, async () => {
    const f = fixture({ pages: [page] });
    await assert.rejects(f.send(planFor(), f.beforeFinalSend), /member_sms_(history_unverified|provider_preflight_unverified)/);
    assert(!f.events.includes('claim'));
    assert.equal(f.posts().length, 0);
  });
});

test('cyclic pagination fails closed before callback', async () => {
  const f = fixture({ pages: [historyPage([], MESSAGE), historyPage([], MESSAGE)] });
  await assert.rejects(f.send(planFor(), f.beforeFinalSend), /member_sms_(history_unverified|provider_preflight_unverified)/);
  assert(!f.events.includes('claim'));
  assert.equal(f.posts().length, 0);
});

test('ten terminal pages are allowed but a continuing tenth page cannot dispatch', async () => {
  const pages = Array.from({ length: 10 }, (_, i) => historyPage([], 'M' + String(i).repeat(24)));
  const blocked = fixture({ pages });
  await assert.rejects(blocked.send(planFor(), blocked.beforeFinalSend), /member_sms_(history_incomplete|provider_preflight_unverified)/);
  assert.equal(blocked.calls.filter(call => call.resource.startsWith('/messages/v4/list?')).length, 10);
  assert(!blocked.events.includes('claim'));
  assert.equal(blocked.posts().length, 0);
  pages[9] = historyPage();
  const allowed = fixture({ pages });
  await allowed.send(planFor(), allowed.beforeFinalSend);
  assert.equal(allowed.posts().length, 1);
});

test('preflight transport error never claims or posts', async () => {
  const f = fixture({ readError: new Error('synthetic read failure') });
  await assert.rejects(f.send(planFor(), f.beforeFinalSend), /member_sms_provider_preflight_unverified/);
  assert(!f.events.includes('claim'));
  assert.equal(f.posts().length, 0);
});

test('durable callback failure or invalid mark-started callback never posts', async () => {
  const callbacks = [async () => { throw new Error('synthetic claim conflict'); },
    async () => undefined, async () => () => { throw new Error('synthetic start failure'); }];
  for (const beforeFinalSend of callbacks) {
    const f = fixture();
    await assert.rejects(f.send(planFor(), beforeFinalSend), /synthetic claim conflict|member_sms_claim_unverified|synthetic start failure/);
    assert.equal(f.posts().length, 0);
  }
});

test('quiet hours block before any provider request using the supplied clock', async () => {
  for (const initialTime of ['2026-10-31T14:00:00Z', '2026-10-30T23:59:59Z']) {
    const f = fixture({ initialTime });
    await assert.rejects(f.send(planFor(), f.beforeFinalSend));
    assert.deepEqual(f.calls, []);
  }
});

test('default time policy is checked again after callback crosses 23:00 KST', async () => {
  const f = fixture({ initialTime: '2026-10-31T13:59:59Z' });
  await assert.rejects(f.send(planFor(), async () => {
    f.events.push('claim');
    f.setTime('2026-10-31T14:00:00Z');
    return () => f.events.push('started');
  }));
  assert(f.events.includes('claim'));
  assert(!f.events.includes('started'));
  assert.equal(f.posts().length, 0);
});

test('claim and start callbacks cannot change the previously verified payload', async t => {
  const mutations = [
    ['recipient', { memberPhone: 'not-a-phone' }],
    ['action', { key: 'synthetic:changed-action' }],
    ['body', { smsMessage: 'x'.repeat(2001) }],
    ['image', { imageId: '../not-an-approved-image' }],
  ];
  for (const stage of ['claim', 'started']) for (const [field, patch] of mutations) {
    await t.test(`${stage} changes ${field}`, async () => {
      const f = fixture();
      const plan = planFor();
      const original = structuredClone(plan);
      let receipt;
      try {
        receipt = await f.send(plan, async () => {
          if (stage === 'claim') Object.assign(plan, patch);
          return () => { if (stage === 'started') Object.assign(plan, patch); };
        });
      } catch (error) {
        assert.match(error.message, /member_sms_/);
        assert.equal(f.posts().length, 0, 'payload drift must stop before transport');
        return;
      }
      // An immutable snapshot is also safe: compare every wire field with the approved plan.
      assert.deepEqual(f.posts()[0].body.messages, [{ to: original.memberPhone, from: SENDER, type: 'LMS',
        subject: original.smsTitle, text: original.smsMessage,
        customFields: { archiveActionKey: original.key, archivePolicy: MEMBER_SMS_PROVIDER_POLICY } }]);
      assert.deepEqual(memberSmsReceiptFields(receipt, original), receipt);
    });
  }
});

test('minimal payload snapshot precedes the first read and survives changes during provider reads', async t => {
  for (const stage of ['active', 'history']) await t.test(stage, async () => {
    const plan = planFor();
    const original = structuredClone(plan);
    Object.defineProperty(plan, 'unusedPrivateContext', {
      enumerable: true, get() { throw new Error('unrelated caller context must not be copied'); },
    });
    let mutated = false;
    const f = fixture({ onRead: resource => {
      const matchesStage = stage === 'active' ? resource.startsWith('/senderid/') : resource.startsWith('/messages/');
      if (!matchesStage || mutated) return;
      Object.assign(plan, { key: 'synthetic:changed-during-read', memberPhone: 'not-a-phone',
        smsTitle: 'Changed title', smsMessage: 'x'.repeat(2001), imageId: '../not-approved' });
      mutated = true;
    } });
    const receipt = await f.send(plan, f.beforeFinalSend);
    assert.equal(mutated, true);
    assert.equal(Object.isFrozen(plan), false, 'do not freeze the caller-owned object');
    assert.equal(plan.memberPhone, 'not-a-phone', 'the test must actually mutate the caller object');
    assert.deepEqual(f.posts()[0].body.messages, [{ to: original.memberPhone, from: SENDER, type: 'LMS',
      subject: original.smsTitle, text: original.smsMessage,
      customFields: { archiveActionKey: original.key, archivePolicy: MEMBER_SMS_PROVIDER_POLICY } }]);
    assert.deepEqual(memberSmsReceiptFields(receipt, original), receipt);
    assert.equal(f.posts().length, 1);
  });
});

test('receipt stays bound to the wire payload if the caller changes plan during POST', async () => {
  const plan = planFor();
  const original = structuredClone(plan);
  const f = fixture({ onPost: () => { plan.smsMessage = 'Changed during pending response.'; } });
  let receipt;
  try {
    receipt = await f.send(plan, f.beforeFinalSend);
  } catch (error) {
    assert.match(error.message, /member_sms_/);
    assert.equal(f.posts().length, 1);
    return;
  }
  assert.equal(f.posts()[0].body.messages[0].text, original.smsMessage);
  assert.deepEqual(memberSmsReceiptFields(receipt, original), receipt);
});

test('start callback crossing 23:00 KST cannot issue the provider POST', async () => {
  const f = fixture({ initialTime: '2026-10-31T13:59:59.999Z' });
  await assert.rejects(f.send(planFor(), async () => () => {
    f.setTime('2026-10-31T14:00:00.000Z');
  }));
  assert.equal(f.posts().length, 0);
});

test('09:00 KST boundary is allowed', async () => {
  const f = fixture({ initialTime: '2026-10-31T00:00:00Z' });
  await f.send(planFor(), f.beforeFinalSend);
  assert.equal(f.posts().length, 1);
});

test('uncertain or rejected transport errors are thrown after exactly one POST without retry', async () => {
  for (const message of ['synthetic connection closed', 'synthetic timeout', 'SOLAPI POST 429', 'SOLAPI POST 400']) {
    const error = new Error(message);
    const f = fixture({ postError: error });
    await assert.rejects(f.send(planFor(), f.beforeFinalSend), thrown => thrown === error);
    assert.equal(f.posts().length, 1);
    assert.deepEqual(f.events.slice(-3), ['claim', 'started', 'post']);
  }
});

test('only exactly one M receipt, G group and string acceptance code 2000 or 4000 are accepted', async t => {
  for (const code of ['2000', '4000']) await t.test(`accepted ${code}`, async () => {
    const f = fixture({ response: receiptFor(code) });
    const receipt = await f.send(planFor(), f.beforeFinalSend);
    assert.equal(receipt.providerReceipt.statusCode, code);
    assert.equal(f.posts().length, 1);
  });
  const invalid = [null, {}, { ...receiptFor(), messageList: [] },
    { ...receiptFor(), messageList: [receiptFor().messageList[0], receiptFor().messageList[0]] },
    { ...receiptFor(), messageList: { [MESSAGE]: receiptFor().messageList[0] } },
    { ...receiptFor(), failedMessageList: undefined }, { ...receiptFor(), failedMessageList: [{}] },
    { ...receiptFor(), groupInfo: {} }, { ...receiptFor(), groupInfo: { groupId: MESSAGE } },
    ...['2001', '3000', '5000', 2000, null, undefined].map(statusCode => ({ ...receiptFor(),
      messageList: [{ messageId: MESSAGE, groupId: GROUP, statusCode }] })),
    ...['bad', GROUP, 'Mshort', 'M' + 'x'.repeat(81)].map(messageId => ({ ...receiptFor(),
      messageList: [{ messageId, statusCode: '2000' }] }))];
  for (const [index, response] of invalid.entries()) await t.test(`rejected receipt ${index}`, async () => {
    const f = fixture({ response });
    await assert.rejects(f.send(planFor(), f.beforeFinalSend), /member_sms_receipt_unverified/);
    assert.equal(f.posts().length, 1);
  });
});

test('receipt rejects a conflicting row group instead of binding it to another group', async () => {
  const response = receiptFor();
  response.messageList[0].groupId = OTHER_GROUP;
  const f = fixture({ response });
  await assert.rejects(f.send(planFor(), f.beforeFinalSend), /member_sms_receipt_unverified/);
  assert.equal(f.posts().length, 1);
});

test('null or missing receipt row produces sanitized unverified receipt error after one POST', async () => {
  for (const messageList of [[null], [undefined], new Array(1)]) {
    const f = fixture({ response: { ...receiptFor(), messageList } });
    await assert.rejects(f.send(planFor(), f.beforeFinalSend), error => {
      assert.equal(error.code, 'member_sms_receipt_unverified');
      assert.equal(error.message, 'member_sms_receipt_unverified');
      return true;
    });
    assert.equal(f.posts().length, 1);
  }
});

test('receipt rejects mismatched recipient or sender when the provider echoes those fields', async () => {
  for (const patch of [{ to: '01000000001' }, { from: '0200000001' }]) {
    const response = receiptFor();
    Object.assign(response.messageList[0], patch);
    const f = fixture({ response });
    await assert.rejects(f.send(planFor(), f.beforeFinalSend), /member_sms_receipt_unverified/);
    assert.equal(f.posts().length, 1);
  }
});

test('receipt allows omitted optional group and routing echoes but validates matching echoes', async () => {
  for (const row of [{ messageId: MESSAGE, statusCode: '2000' },
    { messageId: MESSAGE, groupId: GROUP, statusCode: '4000', to: RECIPIENT, from: SENDER }]) {
    const response = receiptFor();
    response.messageList = [row];
    const f = fixture({ response });
    assert.equal((await f.send(planFor(), f.beforeFinalSend)).providerMessageId, MESSAGE);
    assert.equal(f.posts().length, 1);
  }
});

test('receipt fields reject tampering and cannot be reused for another action, recipient or content', async () => {
  const f = fixture();
  const plan = planFor();
  const valid = await f.send(plan, f.beforeFinalSend);
  for (const patch of [{ key: 'synthetic:other' }, { memberPhone: '01000000001' },
    { smsTitle: 'Changed' }, { smsMessage: 'Changed' }, { imageId: 'synthetic_image_123' }]) {
    assert.throws(() => memberSmsReceiptFields(valid, { ...plan, ...patch }), /member_sms_receipt_unverified/);
  }
  for (const patch of [{ policy: 'other' }, { actionKey: 'other' }, { messageId: 'bad' },
    { groupId: OTHER_GROUP }, { recipientHash: 'bad' }, { contentHash: 'bad' }, { statusCode: '5000' }]) {
    assert.throws(() => memberSmsReceiptFields({ ...valid, providerReceipt: { ...valid.providerReceipt, ...patch } }, plan),
      /member_sms_receipt_unverified/);
  }
  for (const patch of [{ provider: 'other' }, { providerMessageId: 'bad' }, { providerGroupId: 'bad' },
    { providerReceipt: undefined }]) {
    assert.throws(() => memberSmsReceiptFields({ ...valid, ...patch }, plan), /member_sms_receipt_unverified/);
  }
});

test('legacy positive integer smsId receipts remain compatible without accepting other providers', () => {
  const plan = planFor();
  assert.deepEqual(memberSmsReceiptFields({ smsId: 123 }, plan), { smsId: 123 });
  assert.equal(acceptedMemberSmsMarker({ smsId: 123 }), true);
  for (const smsId of [undefined, null, 0, -1, '123', 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => memberSmsReceiptFields({ smsId }, plan), /member_sms_receipt_unverified/);
    assert.equal(acceptedMemberSmsMarker({ smsId }), false);
  }
  assert.equal(acceptedMemberSmsMarker({ provider: 'other', smsId: 123 }), false);
  assert.throws(() => memberSmsReceiptFields({ provider: 'other', smsId: 123 }, plan), /member_sms_receipt_unverified/);
});

test('accepted marker requires a policy-valid accepted receipt, not matching IDs alone', async () => {
  const f = fixture();
  const plan = planFor();
  const receipt = await f.send(plan, f.beforeFinalSend);
  const row = { ...receipt, key: plan.key };
  assert.equal(acceptedMemberSmsMarker(row), true);
  for (const patch of [{ policy: 'other' }, { statusCode: '5000' }, { actionKey: 'other' },
    { messageId: 'bad' }, { groupId: OTHER_GROUP }, { recipientHash: 'bad' }, { contentHash: 'bad' }]) {
    assert.equal(acceptedMemberSmsMarker({ ...row, providerReceipt: { ...row.providerReceipt, ...patch } }), false,
      `invalid accepted marker: ${JSON.stringify(patch)}`);
  }
  assert.equal(acceptedMemberSmsMarker({ ...row, key: 'other' }), false);
  assert.equal(acceptedMemberSmsMarker({ ...row, providerReceipt: undefined }), false);
  assert.equal(acceptedMemberSmsMarker(null), false);
});
