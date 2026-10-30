import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { beforeEach, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  parsePendingInstructorSignupStatus as parse,
  readPendingInstructorSignupEvidence as read,
  INSTRUCTOR_SIGNUP_SOURCE_DOCUMENTS_URL as PROGRESS_URL,
} from '../lib/instructor-signature-reminder-source.mjs';
import {
  INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID as TEMPLATE,
} from '../lib/instructor-lesson-registration-contract.mjs';

const NOW = Date.parse('2026-10-30T03:00:00.000Z');
const DOC = 'a'.repeat(32), OTHER = 'b'.repeat(32);
const COMPANY = '848f6dc7fa024a6cb28a2994c0835e53';
beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: NOW }));

function fixture() {
  const job = {
    documentId: DOC, documentName: 'Synthetic signup document', templateId: TEMPLATE,
    memberName: 'Synthetic Learner', memberPhone: '01000000001', sentAt: new Date(NOW - 86_400_000).toISOString(),
  };
  return {
    responseUrl: `https://kr-service.eformsign.com/v1.0/companies/${COMPANY}/documents/${DOC}/status?mode=ip&lang=en&_=${NOW}`,
    method: 'GET', httpStatus: 200, selectedDocumentId: DOC, templateId: TEMPLATE, job,
    observedAt: new Date(NOW).toISOString(),
    body: { code: '-1', status: '200', result: { status: {
      document_title: job.documentName,
      steps: [
        { seq: 1, action: 'doc_create', execute_date: NOW - 86_400_001,
          owner: { members: ['Synthetic Staff'], groups: ['staff'], external_creators: null } },
        { seq: 2, action: 'doc_request_participant', execute_date: -1,
          owner: { members: ['Synthetic Learner (+821000000001)'], groups: [], external_creators: null } },
        { seq: 3, action: '', execute_date: -1, owner: { members: [], groups: null, external_creators: [] } },
      ],
      current_infos: [{ step_seq: 2, current_writer: null, waitingExternalApproval: false, expired_date: NOW + 86_400_000 }],
    } } },
  };
}
const state = f => f.body.result.status;
const participant = f => state(f).steps[1];
const current = f => state(f).current_infos[0];
const safeError = error => {
  assert.match(error.code, /^instructor_signature_reminder_[a-z_]+$/);
  assert.equal(error.message, error.code);
  assert.doesNotMatch(error.message, /Synthetic|01000000001|821000000001|gmail|https?:/);
  return true;
};

test('pending response returns exact bound evidence without mutating source', () => {
  const f = fixture(), before = structuredClone(f);
  assert.deepEqual(parse(f), {
    source: 'eformsign_document_status', verified: true, documentId: DOC, templateId: TEMPLATE,
    documentName: f.job.documentName, status: 'waiting', recipientName: 'Synthetic Learner',
    recipientPhone: '01000000001', recipientCount: 1, checkedAt: f.observedAt,
    expiresAt: new Date(NOW + 86_400_000).toISOString(),
  });
  assert.deepEqual(f, before);
});

test('normalizes full recipient phone/name without truncating names', () => {
  const f = fixture();
  f.job.memberName = '  Synthetic   Learner  ';
  f.job.memberPhone = '+82 10-0000-0001';
  participant(f).owner.members = [' Synthetic   Learner (+821000000001)'];
  assert.equal(parse(f).recipientName, 'Synthetic Learner');
  assert.equal(parse(f).recipientPhone, '01000000001');
});

for (const [label, sentAt] of [
  ['Date', () => new Date(NOW - 86_400_000)],
  ['toDate Timestamp', () => ({ toDate: () => new Date(NOW - 86_400_000) })],
  ['toMillis Timestamp', () => ({ toMillis: () => NOW - 86_400_000 })],
  ['serialized Timestamp', () => ({ seconds: (NOW - 86_400_000) / 1000, nanoseconds: 0 })],
]) test(`accepts canonical sentAt as ${label}`, () => {
  const f = fixture(); f.job.sentAt = sentAt(); assert.equal(parse(f).verified, true);
});

for (const [label, change] of [
  ['wrong origin', f => { f.responseUrl = f.responseUrl.replace('kr-service.eformsign.com', 'example.invalid'); }],
  ['wrong company', f => { f.responseUrl = f.responseUrl.replace(COMPANY, OTHER); }],
  ['cross-document response', f => { f.responseUrl = f.responseUrl.replace(DOC, OTHER); }],
  ['invalid response URL', f => { f.responseUrl = 'Synthetic private URL'; }],
  ['response credentials', f => { f.responseUrl = f.responseUrl.replace('https://', 'https://user:private@'); }],
  ['unexpected response query', f => { f.responseUrl += '&stale=1'; }],
  ['wrong response mode', f => { f.responseUrl = f.responseUrl.replace('mode=ip', 'mode=ai'); }],
  ['duplicate mode', f => { f.responseUrl += '&mode=ip'; }],
  ['unobserved language', f => { f.responseUrl = f.responseUrl.replace('lang=en', 'lang=unknown'); }],
  ['missing native query', f => { f.responseUrl = f.responseUrl.split('?')[0]; }],
  ['response fragment', f => { f.responseUrl += '#stale'; }],
  ['POST response', f => { f.method = 'POST'; }],
  ['HTTP failure', f => { f.httpStatus = 500; }],
  ['provider failure', f => { f.body.code = '400'; }],
  ['numeric envelope code', f => { f.body.code = -1; }],
  ['numeric envelope status', f => { f.body.status = 200; }],
  ['wrong envelope status', f => { f.body.status = '500'; }],
  ['wrong selected document', f => { f.selectedDocumentId = OTHER; }],
  ['wrong template', f => { f.templateId = OTHER; }],
  ['wrong job template', f => { f.job.templateId = OTHER; }],
  ['non-native document id', f => { f.job.documentId = 'excel_' + DOC; }],
  ['empty document name', f => { f.job.documentName = ''; }],
  ['missing job', f => { f.job = null; }],
  ['missing status', f => { delete f.body.result.status; }],
  ['different exact document title', f => { state(f).document_title += '_other'; }],
  ['steps array-like', f => { state(f).steps = { ...state(f).steps, length: 3 }; }],
  ['missing step', f => { state(f).steps.pop(); }],
  ['extra step', f => { state(f).steps.push({}); }],
  ['null creation', f => { state(f).steps[0] = null; }],
  ['wrong creation sequence', f => { state(f).steps[0].seq = 2; }],
  ['string sequence', f => { participant(f).seq = '2'; }],
  ['wrong creation action', f => { state(f).steps[0].action = 'doc_revoke'; }],
  ['signed', f => { participant(f).action = 'doc_accept_participant'; participant(f).execute_date = NOW - 1; }],
  ['revoked', f => { participant(f).action = 'doc_revoke'; }],
  ['rejected', f => { participant(f).action = 'doc_reject'; }],
  ['participant executed', f => { participant(f).execute_date = NOW - 1; }],
  ['participant date string', f => { participant(f).execute_date = '-1'; }],
  ['completed', f => { state(f).steps[2].action = 'doc_complete'; state(f).steps[2].execute_date = NOW - 1; }],
  ['wrong final sequence', f => { state(f).steps[2].seq = 4; }],
  ['executed final', f => { state(f).steps[2].execute_date = NOW - 1; }],
  ['missing final owner', f => { delete state(f).steps[2].owner; }],
  ['final owner member', f => { state(f).steps[2].owner.members = ['Synthetic Staff']; }],
  ['final owner group', f => { state(f).steps[2].owner.groups = ['group']; }],
  ['final external owner', f => { state(f).steps[2].owner.external_creators = ['external']; }],
  ['malformed final owner', f => { state(f).steps[2].owner.members = {}; }],
  ['missing current info', f => { state(f).current_infos = []; }],
  ['multiple current infos', f => { state(f).current_infos.push({ ...current(f) }); }],
  ['array-like current infos', f => { state(f).current_infos = { 0: current(f), length: 1 }; }],
  ['wrong current step', f => { current(f).step_seq = 3; }],
  ['active current writer', f => { current(f).current_writer = 'Synthetic Learner'; }],
  ['missing current writer', f => { delete current(f).current_writer; }],
  ['external approval', f => { current(f).waitingExternalApproval = true; }],
  ['missing approval state', f => { delete current(f).waitingExternalApproval; }],
  ['multiple owners', f => { participant(f).owner.members.push('Other Learner (+821000000002)'); }],
  ['duplicate same owner', f => { participant(f).owner.members.push(participant(f).owner.members[0]); }],
  ['missing recipient', f => { participant(f).owner.members = []; }],
  ['non-string recipient', f => { participant(f).owner.members = [{ name: 'Synthetic Learner' }]; }],
  ['array-like owner members', f => { participant(f).owner.members = { 0: participant(f).owner.members[0], length: 1 }; }],
  ['group owner', f => { participant(f).owner.groups = ['group']; }],
  ['external creator', f => { participant(f).owner.external_creators = ['external']; }],
  ['malformed group collection', f => { participant(f).owner.groups = { length: 0 }; }],
  ['malformed external collection', f => { participant(f).owner.external_creators = ''; }],
  ['wrong recipient name', f => { f.job.memberName = 'Other Learner'; }],
  ['wrong recipient phone', f => { f.job.memberPhone = '01000000002'; }],
  ['masked phone', f => { participant(f).owner.members = ['Synthetic Learner (+8210****0001)']; }],
  ['domestic owner phone instead of observed native schema', f => { participant(f).owner.members = ['Synthetic Learner (01000000001)']; }],
  ['trailing owner content', f => { participant(f).owner.members[0] += ' other'; }],
  ['truncated full name collision', f => {
    f.job.memberName = 'A'.repeat(40); participant(f).owner.members = [`${'A'.repeat(40)}B (+821000000001)`];
  }],
  ['zero creation date', f => { state(f).steps[0].execute_date = 0; }],
  ['fractional creation date', f => { state(f).steps[0].execute_date += 0.5; }],
  ['string creation date', f => { state(f).steps[0].execute_date = String(NOW - 86_400_001); }],
  ['created after original send', f => { state(f).steps[0].execute_date = NOW - 86_399_999; }],
  ['future creation date', f => { state(f).steps[0].execute_date = NOW + 1; }],
  ['missing sentAt', f => { delete f.job.sentAt; }],
  ['future sentAt', f => { f.job.sentAt = new Date(NOW + 1).toISOString(); }],
  ['invalid calendar sentAt', f => { f.job.sentAt = '2026-02-30T00:00:00Z'; }],
  ['malformed timestamp', f => { f.job.sentAt = { seconds: 1, nanoseconds: -1 }; }],
  ['expired', f => { current(f).expired_date = NOW - 1; }],
  ['expiry at current instant', f => { current(f).expired_date = NOW; }],
  ['non-positive expiry', f => { current(f).expired_date = 0; }],
  ['string expiry', f => { current(f).expired_date = String(NOW + 1); }],
  ['fractional expiry', f => { current(f).expired_date = NOW + 0.5; }],
  ['unrepresentable expiry', f => { current(f).expired_date = 8_640_000_000_000_001; }],
  ['stale observation', f => { f.observedAt = new Date(NOW - 60_001).toISOString(); }],
  ['future observation', f => { f.observedAt = new Date(NOW + 1).toISOString(); }],
  ['invalid observation', f => { f.observedAt = 'Synthetic private clock'; }],
]) test(`parser rejects ${label} with safe codes`, () => {
  const f = fixture(); change(f); assert.throws(() => parse(f), safeError);
});

function responseFor(f, { jsonError, finishedError } = {}) {
  const request = { method: () => f.method, url: () => f.responseUrl };
  return {
    request: () => request, url: () => f.responseUrl, status: () => f.httpStatus,
    finished: async () => finishedError ?? null,
    json: async () => { if (jsonError) throw new Error('Synthetic private body 01000000001'); return structuredClone(f.body); },
  };
}

class MockPage extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.f = fixture();
    this.location = PROGRESS_URL;
    this.body = 'archivepilates@gmail.com Documents In progress';
    this.selectedId = options.autoSelected ? DOC : OTHER;
    this.selectedCount = 1;
    this.calls = [];
    this.waiters = [];
    this.href = `https://www.eformsign.com/eform/document/view_service.html?form_id=${TEMPLATE}&document_id=${DOC}`;
  }
  url() { return this.location; }
  nativeResponse(f = this.f, { tracked = true, ...options } = {}) {
    const response = responseFor(f, options);
    if (tracked) this.emit('request', response.request());
    this.emit('response', response);
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.matches(response)) waiter.resolve(response);
      else waiter.reject(new Error('Synthetic private timeout 01000000001'));
    }
  }
  async goto(url) {
    this.calls.push(['goto', url]);
    assert.equal(url, PROGRESS_URL, 'never navigate to the signing link');
    this.options.onGoto?.(this);
  }
  async waitForFunction(fn, id) {
    this.calls.push([id == null ? 'waitForAccount' : 'waitForSelected', id]);
    this.options.onWait?.(this, id);
    const document = { body: { innerText: this.body }, querySelectorAll: selector => {
      assert.equal(selector, '#RWDtable tr[id][aria-selected="true"]');
      return Array.from({ length: this.selectedCount }, () => ({ id: this.selectedId }));
    } };
    if (!runInNewContext(`(${fn.toString()})(id)`, { document, id })) throw new Error('Synthetic private row timeout');
  }
  waitForResponse(matches) {
    this.calls.push(['waitForResponse']);
    return new Promise((resolve, reject) => this.waiters.push({ matches, resolve, reject }));
  }
  locator(selector) {
    const page = this;
    const selected = selector === '#RWDtable tr[id][aria-selected="true"]';
    const row = selector === '#RWDtable tr[id]';
    return {
      filter({ hasText }) { assert.equal(hasText, page.f.job.documentName); return this; },
      locator(child) {
        assert.equal(row, true); assert.equal(child, 'a[href*="view_service.html"]');
        return {
          count: async () => page.options.linkCount ?? 1,
          innerText: async () => page.options.linkText ?? page.f.job.documentName,
          getAttribute: async key => { assert.equal(key, 'href'); return page.href; },
        };
      },
      async waitFor() { page.calls.push(['waitFor', selector]); },
      getByText(value, options) {
        assert.equal(row, true); assert.equal(value, page.f.job.documentName); assert.equal(options.exact, true);
        return this;
      },
      async fill(value) {
        assert.equal(selector, '#simpleSearchKey'); assert.equal(value, page.f.job.memberName);
        page.calls.push(['fill', selector, value]);
      },
      async click() {
        page.calls.push(['click', selector]);
        if (selector === '#simpleSearchButton') { page.options.onSearch?.(page); return; }
        assert.equal(row, true, 'only search or row selection may be clicked');
        page.selectedId = DOC;
        if (page.options.onRowClick) page.options.onRowClick(page);
        else page.nativeResponse();
      },
      async innerText() {
        assert.equal(selector, 'body'); return page.body;
      },
      async count() { return selected ? page.selectedCount : page.options.rowCount ?? 1; },
      async getAttribute(key) {
        assert(row || selected);
        if (key === 'id') return selected ? page.selectedId : page.options.rowId ?? DOC;
        assert.equal(key, 'aria-selected'); return page.selectedId === DOC ? 'true' : 'false';
      },
    };
  }
}

async function checkedRead(page, reject = false) {
  try {
    if (reject) await assert.rejects(read(page, page.f.job), safeError);
    else {
      const result = await read(page, page.f.job);
      assert.equal(result.documentId, DOC); assert.equal(result.verified, true); assert.equal(result.status, 'waiting');
      assert.equal(result.checkedAt, new Date(NOW).toISOString());
    }
  } finally {
    assert.equal(page.listenerCount('request'), 0);
    assert.equal(page.listenerCount('response'), 0);
    assert.equal(page.waiters.length, 0);
  }
}

test('reader captures auto-selected exact response during navigation and does not click/open signing link', async () => {
  const page = new MockPage({ autoSelected: true, onGoto: p => p.nativeResponse() });
  await checkedRead(page);
  assert.deepEqual(page.calls.filter(([method]) => method === 'goto'), [['goto', PROGRESS_URL]]);
  assert.deepEqual(page.calls.filter(([method]) => method === 'click'), [['click', '#simpleSearchButton']]);
  assert.deepEqual(page.calls.filter(([method]) => method === 'fill'), [['fill', '#simpleSearchKey', page.f.job.memberName]]);
});

test('reader waits for the account header after document-list navigation', async () => {
  const page = new MockPage({
    onGoto: p => { p.body = ''; },
    onWait: (p, id) => { if (id == null) p.body = 'archivepilates@gmail.com Documents In progress'; },
  });
  await checkedRead(page);
  assert.equal(page.calls.some(([method]) => method === 'waitForAccount'), true);
});

test('reader clicks row and observes exact native GET when not auto-selected', async () => {
  const page = new MockPage();
  await checkedRead(page);
  assert.equal(page.calls.some(([method]) => method === 'waitForResponse'), true);
  assert.equal(page.calls.some(([method, selector]) => method === 'click' && selector === '#RWDtable tr[id]'), true);
});

test('native Preview link label is not a document title; exact ID and status title still bind the row', async () => {
  await checkedRead(new MockPage({ linkText: 'Preview' }));
});

test('reader rejects late old-navigation response as evidence and requests a fresh row response', async () => {
  const page = new MockPage({ autoSelected: true, onGoto: p => {
    const old = fixture(); participant(old).action = 'doc_accept_participant';
    p.nativeResponse(old, { tracked: false });
  } });
  await checkedRead(page);
  assert.equal(page.calls.some(([method]) => method === 'waitForResponse'), true);
});

test('reader does not reuse captures across invocations on the same page', async () => {
  const page = new MockPage({ autoSelected: true, onGoto: p => p.nativeResponse() });
  await checkedRead(page);
  page.options.onGoto = p => p.nativeResponse(p.f, { tracked: false });
  page.calls = [];
  await checkedRead(page);
  assert.equal(page.calls.some(([method]) => method === 'waitForResponse'), true);
});

test('reader ignores another auto-selected document, then reads exact selected document', async () => {
  const page = new MockPage({ onGoto: p => {
    const other = fixture(); other.responseUrl = other.responseUrl.replace(DOC, OTHER);
    p.nativeResponse(other);
  } });
  await checkedRead(page);
});

test('reader rejects a captured response that becomes stale during search', async t => {
  const page = new MockPage({
    autoSelected: true, onGoto: p => p.nativeResponse(),
    onSearch: () => t.mock.timers.tick(60_001),
  });
  await checkedRead(page, true);
});

test('reader keeps response arrival time instead of stamping delayed parsing as fresh', async t => {
  const page = new MockPage({
    autoSelected: true, onGoto: p => p.nativeResponse(),
    onSearch: () => t.mock.timers.tick(1_000),
  });
  try {
    const result = await read(page, page.f.job);
    assert.equal(result.checkedAt, new Date(NOW).toISOString());
    assert.notEqual(result.checkedAt, new Date().toISOString());
  } finally {
    assert.equal(page.listenerCount('request'), 0);
    assert.equal(page.listenerCount('response'), 0);
  }
});

for (const [label, change] of [
  ['stale account', p => { p.body = 'other@example.invalid Documents In progress'; }],
  ['account substring spoof', p => { p.body = 'notarchivepilates@gmail.com Documents In progress'; }],
  ['account domain suffix spoof', p => { p.body = 'archivepilates@gmail.com.invalid Documents In progress'; }],
  ['login page', p => { p.location = 'https://www.eformsign.com/eform/account/login.html'; }],
  ['login text despite cached account', p => { p.body += ' Sign in'; }],
  ['security challenge', p => { p.body += ' 보안 확인'; }],
  ['captcha', p => { p.body += ' captcha'; }],
  ['wrong source view', p => { p.location = PROGRESS_URL.replace('mode=ip', 'mode=ai'); }],
  ['wrong UI origin', p => { p.location = PROGRESS_URL.replace('www.eformsign.com', 'example.invalid'); }],
  ['multiple rows', p => { p.options.rowCount = 2; }],
  ['wrong row id', p => { p.options.rowId = OTHER; }],
  ['multiple view links', p => { p.options.linkCount = 2; }],
  ['wrong link origin', p => { p.href = p.href.replace('www.eformsign.com', 'example.invalid'); }],
  ['wrong link path', p => { p.href = p.href.replace('/eform/document/', '/sign/'); }],
  ['wrong link template', p => { p.href = p.href.replace(TEMPLATE, OTHER); }],
  ['wrong link document', p => { p.href = p.href.replace(DOC, OTHER); }],
  ['missing href', p => { p.href = ''; }],
  ['duplicated link document', p => { p.href += '&document_id=' + OTHER; }],
  ['duplicated link template', p => { p.href += '&form_id=' + OTHER; }],
]) test(`reader rejects ${label} before row click and cleans observers`, async () => {
  const page = new MockPage({ onGoto: change });
  await checkedRead(page, true);
  assert.equal(page.calls.some(([method, selector]) => method === 'click' && selector === '#RWDtable tr[id]'), false);
});

for (const [label, change] of [
  ['cross-document response after row click', p => {
    const other = fixture(); other.responseUrl = other.responseUrl.replace(DOC, OTHER); p.nativeResponse(other);
  }],
  ['POST status response', p => { const post = fixture(); post.method = 'POST'; p.nativeResponse(post); }],
  ['signed document', p => { participant(p.f).action = 'doc_accept_participant'; p.nativeResponse(); }],
  ['revoked document', p => { participant(p.f).action = 'doc_revoke'; p.nativeResponse(); }],
  ['expired document', p => { current(p.f).expired_date = NOW; p.nativeResponse(); }],
  ['wrong selected row after response', p => { p.nativeResponse(); p.selectedId = OTHER; }],
  ['multiple selected rows after response', p => { p.nativeResponse(); p.selectedCount = 2; }],
  ['account changes after selection', p => { p.nativeResponse(); p.body = 'other@example.invalid Documents In progress'; }],
  ['unparseable private response', p => { p.nativeResponse(p.f, { jsonError: true }); }],
  ['failed response transport', p => { p.nativeResponse(p.f, { finishedError: new Error('Synthetic private transport') }); }],
]) test(`reader fails closed for ${label} and sanitizes errors`, async () => {
  await checkedRead(new MockPage({ onRowClick: change }), true);
});

test('reader sanitizes navigation failures and removes both observers', async () => {
  const page = new MockPage({ onGoto: () => { throw new Error('Synthetic private URL 01000000001'); } });
  await checkedRead(page, true);
});

test('reader preserves caller-owned observers', async () => {
  const page = new MockPage(), observer = () => {};
  page.on('response', observer);
  try {
    await read(page, page.f.job);
    assert.deepEqual(page.listeners('response'), [observer]);
    assert.equal(page.listenerCount('request'), 0);
  } finally { page.off('response', observer); }
});
