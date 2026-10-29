import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { beforeEach, test } from 'node:test';
import { applySignupProfileV2, splitSignupPostalAddress, SIGNUP_ADDRESS_LOOKUP_APPROVED } from '../lib/instructor-signup-profile-v2-writer.mjs';
import { signupProfileMemoPresent } from '../lib/instructor-signup-profile.mjs';

const NOW = new Date('2026-10-30T03:00:00Z');
const MEMBER = '9000001', DOC = 'a'.repeat(32), REG = 'ilr_' + 'b'.repeat(24);
const BASE = 'https://arcpilates.studiomate.kr';
const ADDRESS = '서울특별시 강남구 테헤란로 123 합성빌딩 704호';
const clone = structuredClone;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
beforeEach(t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  t.mock.method(globalThis, 'fetch', () => assert.fail('Real network/browser/production writes forbidden'));
});
function job() {
  return { jobId: 'instructor_member_completion_' + DOC, registrationId: REG, profileSourceJobId: REG,
    source: 'instructor_member_eformsign', studioId: '5330', memberId: MEMBER, studiomateMemberId: MEMBER,
    memberName: '합성회원', memberPhone: '01000000001', claimToken: 'synthetic-owned-claim', status: 'processing',
    content: '[ARCHIVE PILATES 강사회원 가입서 완료]\n문서 ID: ' + DOC,
    profileUpdate: { version: 2, documentId: DOC, birthDateRaw: '19900102', addressRaw: ADDRESS } };
}
function nativePage(j, options = {}) {
  const events = [], progress = [];
  let stored = { birthDate: options.birthDate ?? '', address: options.address ?? '', detail: options.detail ?? '',
    phone: options.phone ?? j.memberPhone, name: options.name ?? j.memberName, grade: options.grade ?? '강사회원',
    registrationDate: options.registrationDate ?? '2020-01-02', unrelated: options.unrelated ?? 'preserve-synthetic-value' };
  let draft = clone(stored), url = '', saves = 0, popupClosed = false, closed = false;
  const freshPages = [];
  const resultChoices=()=>({
    first:()=>({waitFor:async()=>{if(!optionsPostal().choices.length)throw Error('No visible postcode results');events.push({operation:'postal-results'});}}),
    evaluateAll:async fn=>fn(optionsPostal().choices.map(t=>({textContent:'도로명 '+t+' 선택 안내',querySelectorAll:()=>[{textContent:t}]}))),
    nth:index=>({click:async()=>{
      events.push({operation:'postal-select',index});draft.address=optionsPostal().selected??optionsPostal().choices[index].replace(/^(도로명|지번)\s*/,'');
      if(optionsPostal().autoClose!==false)popupClosed=true;
    }}),
  });
  const postalFrame = {
    locator:selector=>{assert.equal(selector,'button.link_post:not(.link_btn_map)');return resultChoices();},
    getByRole: (role, options = {}) => {
      if (role === 'textbox') return { fill: async value => { events.push({ operation: 'postal-query', value }); } };
      if (role === 'heading') assert.fail('Hidden screen-reader heading must not gate postcode readiness');
      assert.equal(role, 'button');
      if (options.name) {
        assert.equal(options.name, '검색');
        return { click: async () => { events.push({ operation: 'postal-search' }); } };
      }
      assert.fail('Map/other buttons cannot be treated as address choices');
    },
  };
  const optionsPostal = () => options.postal;
  const popup = { frameLocator: selector => { assert.equal(selector, 'iframe'); return postalFrame; },
    isClosed: () => popupClosed, close: async () => { popupClosed = true; events.push({ operation: 'popup-close' }); } };
  const keyFor = { '생년월일 (YYYY-MM-DD)': 'birthDate', '주소를 입력해 주세요': 'address',
    '상세 주소를 입력해 주세요': 'detail', '휴대폰 번호': 'phone', '이름을 입력해주세요': 'name' };
  const input = placeholder => {
    const key = keyFor[placeholder]; assert(key, placeholder);
    const locator = { filter: opts => { assert.deepEqual(opts, { visible: true }); return locator; },
      inputValue: async () => draft[key], waitFor: async () => {}, page: () => page,
      click: async () => { events.push({ operation: 'field-click', field: key }); },
      fill: async value => { assert(!options.readOnly); events.push({ operation: 'fill', field: key, value }); assert(['birthDate', 'detail'].includes(key)); draft[key] = value; },
      pressSequentially: async value => {
        assert(!options.readOnly); events.push({ operation: 'type', field: key, value }); assert.equal(key, 'birthDate'); assert.match(value, /^\d{8}$/);
        draft[key] = options.badMask ? value : `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
      }, press: async keyName => { events.push({ operation: 'key', key: keyName }); } };
    return locator;
  };
  const page = {
    goto: async target => { events.push({ operation: 'load', target }); url = options.wrongId ? target.replace(MEMBER, '999') : target; if(options.wrongOrigin)url=url.replace(BASE,'https://other.studiomate.kr'); draft = clone(stored); },
    url: () => url,
    getByPlaceholder: placeholder => input(placeholder),
    getByRole: (role, { name } = {}) => {
      if (role === 'textbox') return { and: locator => locator };
      if (role === 'heading') return { waitFor: async () => assert.equal(draft.name, name) };
      assert.equal(role, 'button');
      if (name === '회원정보 수정') return { click: async () => { events.push({ operation: 'open-editor' }); url=url.replace('/users/detail','/users/create'); } };
      assert.equal(name, '회원 수정 완료');
      return { click: async () => {
        assert(!options.readOnly, 'fresh snapshot page must never save');
        events.push({ operation: 'save' }); saves++;
        if (options.saveThrowsBefore) throw Error('Synthetic save response unknown before persistence');
        if (options.persist !== false) stored = clone(draft);
        url=url.replace('/users/create','/users/detail');
        if (options.changeProtected) stored.registrationDate = '2099-01-01';
        if (options.changeAddress) stored.address = 'changed unexpectedly';
        if (options.saveThrowsAfter) throw Error('Synthetic save response unknown after persistence');
      } };
    },
    locator: selector => {
      assert.equal(selector, 'input');
      return { evaluateAll: async fn => fn([
        ['이름을 입력해주세요', draft.name], ['휴대폰 번호', draft.phone],
        ['등록일을 입력해주세요', draft.registrationDate], ['선택', draft.grade],
      ].map(([placeholder, value]) => ({ value, getClientRects: () => [1], getAttribute: key => {
        assert.equal(key, 'placeholder'); return placeholder;
      } }))) };
    },
    waitForFunction: async (_fn, expected) => {
      if (expected && typeof expected === 'object') {
        assert.equal(typeof expected.expected, 'string');
        assert(draft.address.includes(expected.expected));
        return;
      }
      assert.equal(typeof expected, 'string');
      assert.equal(draft.phone.replace(/\D/g, ''), expected);
    },
    waitForURL: async expected => assert.equal(url, expected),
    waitForEvent: async event => {
      events.push({ operation: 'popup', event }); assert.equal(event, 'popup');
      if (options.postal) return popup;
      Object.assign(stored, options.changeLiveOnPostalFailure || {});
      throw Error('Synthetic lookup unavailable; no external service opened');
    },
    context: () => ({ newPage: async () => {
      events.push({ operation: 'fresh-page-open' });
      Object.assign(stored, options.changeLiveBeforeSave || {});
      const fresh = nativePage(j, { ...clone(stored), readOnly: true });
      freshPages.push(fresh);
      return { ...fresh.page, close: async () => { await fresh.page.close(); events.push({ operation: 'fresh-page-close' }); } };
    } }),
    close: async () => { closed = true; },
  };
  return { page, events, progress, stored: () => clone(stored), saves: () => saves,
    popupClosed: () => popupClosed,
    freshPages, isClosed: () => closed,
    recordProgress: async value => { progress.push(clone(value)); } };
}
const run = (m, j, options = {}) => applySignupProfileV2(m.page, j, MEMBER, BASE, { recordProgress: m.recordProgress, lookupApproved: false, ...options });

for (const [label, address] of [
  ['full phone embedded before road', '서울특별시 강남구 010-0000-0001 테헤란로 123 704호'],
  ['unit detail before road', '서울특별시 강남구 704호 테헤란로 123'],
]) test('postal privacy rejects ' + label + ' without query or native save', async () => {
  const j = job(); j.profileUpdate.birthDateRaw = ''; j.profileUpdate.addressRaw = address;
  const m = nativePage(j), before = m.stored();
  assert.equal(splitSignupPostalAddress(address), null);
  const result = await run(m, j, { lookupApproved: true });
  assert.equal(result.address.status, 'review'); assert.equal(result.birthDate.status, 'not_provided');
  assert.equal(m.saves(), 0); assert.deepEqual(m.stored(), before);
  assert(!m.events.some(e => ['popup', 'field-click', 'postal-query', 'postal-search', 'postal-select', 'fill', 'type', 'save'].includes(e.operation)));
  assert(!m.progress.some(p => p.saveIntentAt));
});

test('writer fills only an empty DOB, defers address lookup, verifies persisted readback and is replay-idempotent', async () => {
  const j = job(), before = clone(j), m = nativePage(j), result = await run(m, j);
  assert.equal(SIGNUP_ADDRESS_LOOKUP_APPROVED, true);
  assert.equal(result.birthDate.status, 'verified'); assert.equal(result.address.status, 'awaiting_address_lookup_approval');
  assert.equal(m.stored().birthDate, '1990-01-02'); assert.equal(m.stored().address, ''); assert.equal(m.stored().detail, '');
  assert.equal(m.stored().unrelated, 'preserve-synthetic-value');
  assert.deepEqual(m.events.filter(e => ['fill', 'type'].includes(e.operation)).map(e => e.field), ['birthDate', 'birthDate']);
  assert.equal(m.saves(), 1); assert(!m.events.some(e => e.operation === 'popup' || e.operation === 'field-click'));
  assert(m.progress.some(p => p.saveIntentAt));
  const repeat = await run(m, j); assert.equal(repeat.birthDate.status, 'already_equal'); assert.equal(m.saves(), 1);
  assert.deepEqual(j, before);
});

test('existing conflicting DOB is preserved and returns reviewable independent statuses, not an exception', async () => {
  const j = job(), m = nativePage(j, { birthDate: '1989-01-02' }), result = await run(m, j);
  assert.equal(result.birthDate.status, 'conflict'); assert.equal(result.address.status, 'awaiting_address_lookup_approval');
  assert.equal(m.stored().birthDate, '1989-01-02'); assert.equal(m.saves(), 0);
  assert(!m.events.some(e => ['fill', 'type', 'popup', 'save'].includes(e.operation)));
});
test('completion-only mode never writes profile fields or opens postcode even when native fields are empty',async()=>{
  const j=job();j.profileUpdate={version:2,mode:'completion_only',documentId:DOC,fieldReviewReason:'signed_fields_unverified'};
  const m=nativePage(j),r=await run(m,j,{lookupApproved:true});
  assert.equal(r.birthDate.status,'review');assert.equal(r.address.status,'review');assert.equal(m.saves(),0);
  assert(!m.events.some(e=>['fill','type','postal-query','popup','save'].includes(e.operation)));
  const q=memoOrchestrator(j,m);await q.run();assert(q.memos.has(j.content));
});
test('address clash never blocks independent DOB completion or alters the existing address/detail', async () => {
  const j = job(), m = nativePage(j, { address: '서울특별시 강남구 테헤란로 124', detail: '기존 801호' });
  const before = m.stored(), result = await run(m, j);
  assert.equal(result.birthDate.status, 'verified'); assert.equal(result.address.status, 'conflict');
  assert.equal(m.stored().address, before.address); assert.equal(m.stored().detail, before.detail);
  assert.equal(m.saves(), 1); assert(!m.events.some(e => e.operation === 'popup'));
});
test('six-digit DOB review leaves native DOB empty and independently defers a valid address', async () => {
  const j = job(); j.profileUpdate.birthDateRaw = '900102'; const m = nativePage(j), result = await run(m, j);
  assert.equal(result.birthDate.status, 'review'); assert.equal(result.address.status, 'awaiting_address_lookup_approval');
  assert.equal(m.stored().birthDate, ''); assert.equal(m.saves(), 0);
});
test('missing fields are not_provided and never clear existing native values', async () => {
  const j = job(); j.profileUpdate.birthDateRaw = ''; j.profileUpdate.addressRaw = '';
  const m = nativePage(j, { birthDate: '1989-01-02', address: '서울특별시 강남구 테헤란로 124', detail: '801호' });
  const before = m.stored(), result = await run(m, j);
  assert.equal(result.birthDate.status, 'not_provided'); assert.equal(result.address.status, 'not_provided');
  assert.deepEqual(m.stored(), before); assert.equal(m.saves(), 0);
});
test('failed mock postcode selection does not block independent empty DOB completion', async () => {
  const j = job(), m = nativePage(j), result = await run(m, j, { lookupApproved: true });
  assert.equal(result.birthDate.status, 'verified'); assert.equal(result.address.status, 'review');
  assert.equal(m.stored().address, ''); assert.equal(m.saves(), 1);
  assert.equal(m.events.filter(e => e.operation === 'popup').length, 1);
});
test('partial native address/detail is never completed speculatively', async () => {
  const j = job(), m = nativePage(j, { detail: '기존 상세주소' }), result = await run(m, j);
  assert.equal(result.birthDate.status, 'verified'); assert.equal(result.address.status, 'review');
  assert.equal(m.stored().detail, '기존 상세주소'); assert.equal(m.stored().address, '');
});
test('a DOB conflict does not trigger address lookup when the existing address already matches', async () => {
  const j = job(), m = nativePage(j, { birthDate: '1989-01-02', address: '서울특별시 강남구 테헤란로 123', detail: '합성빌딩 704호' });
  const result = await run(m, j, { lookupApproved: true });
  assert.equal(result.birthDate.status, 'conflict'); assert.equal(result.address.status, 'already_equal');
  assert.equal(m.saves(), 0); assert(!m.events.some(e => e.operation === 'popup'));
});
test('native postcode building suffix does not make an already persisted exact address a conflict',async()=>{
  const j=job(),m=nativePage(j,{birthDate:'1990-01-02',address:'서울특별시 강남구 테헤란로 123 (합성건물)',detail:'합성빌딩 704호'});
  const r=await run(m,j,{lookupApproved:true});assert.equal(r.address.status,'already_equal');assert.equal(m.saves(),0);
  assert(!m.events.some(e=>e.operation==='postal-query'));
});

for (const [label, options] of Object.entries({ wrongId: { wrongId: true }, wrongOrigin:{wrongOrigin:true}, wrongName: { name: '다른회원' },
  wrongPhone: { phone: '01000000002' }, wrongGrade: { grade: '일반회원' }, badMask: { badMask: true } })) {
  test('writer rejects ' + label + ' before save', async () => {
    const j = job(), m = nativePage(j, options);
    await assert.rejects(run(m, j)); assert.equal(m.saves(), 0); assert.equal(m.stored().birthDate, '');
  });
}
for (const [label, options] of Object.entries({ noPersistence: { persist: false }, unknownBeforeSave: { saveThrowsBefore: true },
  protectedFieldChanged: { changeProtected: true }, unexpectedAddressChanged: { changeAddress: true } })) {
  test('writer rejects ' + label + ' after exactly one save attempt, never retries', async () => {
    const j = job(), m = nativePage(j, options);
    await assert.rejects(run(m, j)); assert.equal(m.saves(), 1);
  });
}
test('a response error with independently verified persistence is not replayed', async () => {
  const j = job(), m = nativePage(j, { saveThrowsAfter: true }), result = await run(m, j);
  assert.equal(result.saveResponse, 'unknown'); assert.equal(result.birthDate.status, 'verified'); assert.equal(m.saves(), 1);
  assert.equal((await run(m, j)).birthDate.status, 'already_equal'); assert.equal(m.saves(), 1);
});
test('fresh pre-save page reads stored state independently from the draft and always closes', async () => {
  const j = job(), m = nativePage(j), before = m.stored(), result = await run(m, j);
  assert.equal(result.birthDate.status, 'verified');
  assert.equal(m.freshPages.length, 1); assert.deepEqual(m.freshPages[0].stored(), before);
  assert.equal(m.freshPages[0].saves(), 0); assert.equal(m.freshPages[0].isClosed(), true);
  assert.equal(m.stored().birthDate, '1990-01-02');
  assert.equal(result.beforeFieldHashes.birthDate, hash(before.birthDate));
  assert.equal(result.beforeFieldHashes.address, hash(before.address));
  assert.equal(result.beforeFieldHashes.detail, hash(before.detail));
  assert.match(result.beforeFieldHashes.protectedHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(result.beforeFieldHashes).sort(), ['address', 'birthDate', 'detail', 'protectedHash']);
});
test('changed live source before save rejects the stale draft, preserves staff edit and performs zero saves', async () => {
  const j = job(), m = nativePage(j, { changeLiveBeforeSave: { birthDate: '1988-03-04' } });
  await assert.rejects(run(m, j), /Native profile changed while this draft was open/);
  assert.equal(m.saves(), 0); assert.equal(m.stored().birthDate, '1988-03-04');
  assert.equal(m.freshPages.length, 1); assert.equal(m.freshPages[0].isClosed(), true);
  assert(!m.progress.some(p => p.saveIntentAt));
});
test('postal failure discards draft only if the independently reloaded profile is still unchanged', async () => {
  const j = job(), m = nativePage(j, { changeLiveOnPostalFailure: { birthDate: '1988-03-04' } });
  await assert.rejects(run(m, j, { lookupApproved: true }), /Native profile changed while address selection was pending/);
  assert.equal(m.saves(), 0); assert.equal(m.stored().birthDate, '1988-03-04');
  assert(!m.events.some(e => e.operation === 'type'));
});
test('foreign source, member or origin rejects before any mock page interaction', async () => {
  for (const change of [j => { j.source = 'foreign'; }, j => { j.studiomateMemberId = '999'; }, j => { j.profileUpdate.version = 1; }]) {
    const j = job(); change(j); const m = nativePage(j);
    await assert.rejects(run(m, j)); assert.deepEqual(m.events, []);
  }
  const j = job(), m = nativePage(j);
  await assert.rejects(applySignupProfileV2(m.page, j, MEMBER, 'https://example.invalid'));
  assert.deepEqual(m.events, []);
});
test('postal splitter preserves supplied detail and refuses to invent a base for incomplete text', () => {
  assert.deepEqual(splitSignupPostalAddress(ADDRESS), { base: '서울특별시 강남구 테헤란로 123', detail: '합성빌딩 704호' });
  assert.equal(splitSignupPostalAddress('서울 강남구'), null);
  assert.equal(splitSignupPostalAddress('123 Main Street, USA'), null);
});

test('approved default native lookup sends only base address to popup and saves unit details locally with DOB', async () => {
  const j = job(), before = clone(j), base = '서울특별시 강남구 테헤란로 123';
  const m = nativePage(j, { postal: { choices: [base], autoClose: false } });
  const result = await applySignupProfileV2(m.page, j, MEMBER, BASE, { recordProgress: m.recordProgress });
  assert.equal(result.birthDate.status, 'verified'); assert.equal(result.address.status, 'verified');
  assert.equal(m.stored().birthDate, '1990-01-02'); assert.equal(m.stored().address, base);
  assert.equal(m.stored().detail, '합성빌딩 704호'); assert.equal(m.saves(), 1);
  assert.deepEqual(m.events.filter(e => e.operation === 'postal-query'), [{ operation: 'postal-query', value: base }]);
  assert.doesNotMatch(JSON.stringify(m.events.filter(e => e.operation.startsWith('postal-'))), /704|합성빌딩|01000000001|19900102|합성회원/);
  assert.deepEqual(m.events.filter(e => e.operation === 'fill' && e.field === 'detail'),
    [{ operation: 'fill', field: 'detail', value: '합성빌딩 704호' }]);
  assert.equal(m.popupClosed(), true); assert.equal(m.events.filter(e => e.operation === 'popup-close').length, 1);
  const repeat = await run(m, j, { lookupApproved: true });
  assert.equal(repeat.birthDate.status, 'already_equal'); assert.equal(repeat.address.status, 'already_equal');
  assert.equal(m.saves(), 1); assert.deepEqual(j, before);
});
test('DOB conflict preserves DOB while an exact approved popup address independently saves once', async () => {
  const j = job(), base = '서울특별시 강남구 테헤란로 123';
  const m = nativePage(j, { birthDate: '1989-01-02', postal: { choices: [base] } });
  const result = await run(m, j, { lookupApproved: true });
  assert.equal(result.birthDate.status, 'conflict'); assert.equal(result.address.status, 'verified');
  assert.equal(m.stored().birthDate, '1989-01-02'); assert.equal(m.stored().address, base);
  assert.equal(m.stored().detail, '합성빌딩 704호'); assert.equal(m.saves(), 1);
  assert(!m.events.some(e => ['fill', 'type'].includes(e.operation) && e.field === 'birthDate'));
  assert.equal(m.popupClosed(), true);
});
for (const [label, postal] of Object.entries({
  duplicate: { choices: ['서울특별시 강남구 테헤란로 123', '서울특별시 강남구 테헤란로 123'] },
  equivalentAmbiguity: { choices: ['서울특별시 강남구 테헤란로 123', '서울 강남구 테헤란로 123'] },
  differentNumber: { choices: ['서울특별시 강남구 테헤란로 124'] },
  emptyResults: { choices: [] },
  selectedReadbackMismatch: { choices: ['서울특별시 강남구 테헤란로 123'], selected: '서울특별시 다른구 테헤란로 123' },
})) test('postal ' + label + ' rejects address mutation, closes popup and still permits independent DOB', async () => {
  const j = job(), m = nativePage(j, { postal }), result = await run(m, j, { lookupApproved: true });
  assert.equal(result.birthDate.status, 'verified'); assert.equal(result.address.status, 'review');
  assert.equal(result.address.reason, 'postal_exact_match_unavailable');
  assert.equal(m.stored().address, ''); assert.equal(m.stored().detail, ''); assert.equal(m.saves(), 1);
  assert(!m.events.some(e => e.operation === 'fill' && e.field === 'detail'));
  if (label !== 'selectedReadbackMismatch') assert(!m.events.some(e => e.operation === 'postal-select'));
  assert.equal(m.popupClosed(), true);
});

// Extract only the orchestration function, never import the executable queue processor.
const require = createRequire(new URL('../../firebase/kangsain-functions/functions/package.json', import.meta.url));
const ts = require('typescript');
test('actual native readiness predicate waits for member grade after phone has hydrated',()=>{
  const src=new URL('../lib/instructor-signup-profile-v2-writer.mjs',import.meta.url);
  const ast=ts.createSourceFile(src.pathname,readFileSync(src,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  let predicate;
  const visit=n=>{if(ts.isCallExpression(n)&&n.expression.getText(ast)==='target.waitForFunction')predicate=n.arguments[0].getText(ast);ts.forEachChild(n,visit);};visit(ast);assert(predicate);
  const phoneInput={value:'01000000001',getClientRects:()=>[1],getAttribute:()=> '휴대폰 번호'};
  const gradeInput={value:'',getClientRects:()=>[1],getAttribute:()=> '선택'};
  const check=vm.runInNewContext('('+predicate+')',{document:{querySelectorAll:()=>[phoneInput,gradeInput]}});
  assert.equal(check('01000000001'),false);gradeInput.value='강사회원';assert.equal(check('01000000001'),true);
  gradeInput.value='일반회원';assert.equal(check('01000000001'),false);
});
const worker = new URL('../process-studiomate-memo-write-jobs.mjs', import.meta.url);
const tree = ts.createSourceFile(worker.pathname, readFileSync(worker, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const writeMemoDeclaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'writeMemo');
assert(writeMemoDeclaration, 'writeMemo declaration required');

const memoPresenceDeclarations = ['bodyContainsMemoContent', 'normalizeMemoText'].map(name => {
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert(declaration, name + ' declaration required');
  return declaration.getText(tree);
}).join('\n');
const bodyContainsMemoContent = vm.runInNewContext(memoPresenceDeclarations + '\nbodyContainsMemoContent', {
  signupProfileMemoPresent,
  holdingMemoContentPresent: () => assert.fail('Signup memo must not use holding matcher'),
}, { timeout: 1000 });
const fullCompletionMemo = '[ARCHIVE PILATES 강사회원 가입서 완료]\n완료 시각: 2025-12-30 15:36:27.123 KST\n문서 ID: ' + DOC;
for (const [label, body] of [
  ['wrong provider completion milliseconds', fullCompletionMemo.replace('15:36:27.123', '15:36:27.124')],
  ['missing provider completion time', fullCompletionMemo.split('\n').filter(line => !line.startsWith('완료 시각:')).join('\n')],
]) test('same completion header and document with ' + label + ' is not an existing full memo', () => {
  assert.equal(bodyContainsMemoContent('회원 메모\n' + body, fullCompletionMemo), false);
});
test('exact full completion memo matches normalized whitespace, including actual completion time', () => {
  const body = '\t회원 메모\r\n' + fullCompletionMemo.replace(/ /g, '\t  ').replace(/\n/g, ' \r\n\t') + '\n기타 메모';
  assert.equal(bodyContainsMemoContent(body, fullCompletionMemo), true);
});

function memoOrchestrator(j, m) {
  const events = [], memos = new Set();
  const ref = path => ({ path, get: async () => ({
    data: () => ({ status: 'done', synthetic: true }), get: key => key === 'claimToken' ? j.claimToken : 'processing',
  }) });
  const db = { collection: name => ({ doc: id => { events.push(['read-reference', name, id]); return ref(name + '/' + id); } }),
    doc: path => ref(path), runTransaction: async action => action({ get: async r => r.get(), update: (_ref,patch) => { events.push(['progress',patch]); } }) };
  const ctx = { db, Date, config: { baseUrl: BASE }, admin: { firestore: { Timestamp: { now: () => NOW } } },
    resolveStudioMateMemberId: async () => MEMBER,
    assertSignupProfileV2Source: () => {}, // The actual validator is covered in the integration suite.
    applySignupProfileV2: (page, job, memberId, baseUrl, options) => applySignupProfileV2(page, job, memberId, baseUrl, { ...options, lookupApproved: false }),
    studioMateMemoExists: async (_page, _memberId, content) => memos.has(content),
    writeMemoViaBrowserRequest: async () => assert.fail('v2 must use native memo UI only'),
    writeMemoViaUi: async (_page, memberId, content, options) => { assert.equal(memberId, MEMBER); if(options?.beforeSave)await options.beforeSave(); events.push(['memo-write']); memos.add(content); },
    assertSignupProfileSource: () => assert.fail('v1 must not run'), applySignupBirthDate: () => assert.fail('v1 must not run'),
  };
  const writeMemo = vm.runInNewContext(writeMemoDeclaration.getText(tree) + '\nwriteMemo', ctx, { timeout: 1000 });
  return { run: () => writeMemo(m.page, j, 'synthetic-authorization'), events, memos };
}

test('completion memo writes independently of profile conflict/deferred address in a registration-free baseline', async () => {
  const j = job(); j.registrationId = ''; j.profileSourceJobId = 'completed_signup_profile_baseline_v2_' + DOC;
  const m = nativePage(j, { birthDate: '1989-01-02' }), q = memoOrchestrator(j, m), result = await q.run();
  assert.equal(result.profileStatus.birthDate.status, 'conflict');
  assert.equal(result.profileStatus.address.status, 'awaiting_address_lookup_approval');
  assert(q.memos.has(j.content)); assert.equal(m.saves(), 0);
  assert.equal(q.events.filter(e => e[0] === 'memo-write').length, 1);
  const repeat = await q.run(); assert.equal(repeat.alreadyExists, true);
  assert.equal(q.events.filter(e => e[0] === 'memo-write').length, 1);
});
test('regular registration orchestration must read a DocumentSnapshot before data(), then write the independent memo', async () => {
  const j = job(), m = nativePage(j, { birthDate: '1989-01-02' }), q = memoOrchestrator(j, m);
  const result = await q.run();
  assert.equal(result.profileStatus.birthDate.status, 'conflict'); assert(q.memos.has(j.content));
  assert(q.events.some(e => e[0] === 'read-reference' && e[1] === 'instructorLessonRegistrations'));
});
test('v2 records native memo intent before its single save and never replays an unresolved intent',async()=>{
  const j=job(),m=nativePage(j,{birthDate:'1989-01-02'}),q=memoOrchestrator(j,m);
  await q.run();
  const intent=q.events.findIndex(e=>e[0]==='progress'&&e[1]?.memoWriteState==='intent');
  assert(intent>=0&&intent<q.events.findIndex(e=>e[0]==='memo-write'));
  const unknown=job();unknown.memoWriteState='intent';
  const blocked=memoOrchestrator(unknown,nativePage(unknown,{birthDate:'1989-01-02'}));
  await assert.rejects(blocked.run(),error=>error.nonRetryable===true);
  assert.equal(blocked.events.filter(e=>e[0]==='memo-write').length,0);
  blocked.memos.add(unknown.content);
  assert.equal((await blocked.run()).alreadyExists,true);
  assert.equal(blocked.events.filter(e=>e[0]==='memo-write').length,0);
});

const declares = (node, name) => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => declaration.name.getText(tree) === name);
const selectionStart = tree.statements.findIndex(node => declares(node, 'args'));
const selectionEnd = tree.statements.findIndex(node => declares(node, 'config'));
const valueArgDeclaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'valueArg');
const loadJobsDeclaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'loadPendingJobs');
const holdingProjection = tree.statements.find(node => ts.isIfStatement(node) && node.thenStatement.getText(tree).includes('result.holdingMemoProjection'));
assert(selectionStart >= 0 && selectionEnd > selectionStart && valueArgDeclaration && loadJobsDeclaration && holdingProjection);
function boundedSelection(argv, env = {}) {
  // Evaluate only argument declarations/validation and the holding guard expression.
  // No imports, admin initialization, queue worker, scheduler or browser is executed.
  const declarations = tree.statements.slice(selectionStart, selectionEnd).map(node => node.getText(tree)).join('\n');
  return vm.runInNewContext(declarations + '\n' + valueArgDeclaration.getText(tree)
    + `\n({apply,jobId,signupJobIds,holdingProjectionEnabled:(${holdingProjection.expression.getText(tree)})})`,
  { process: { argv: ['node', 'synthetic-worker', ...argv], env } }, { timeout: 1000 });
}
const signupId = i => 'instructor_member_completion_' + i.toString(16).padStart(32, '0');

test('bounded selector accepts 1..10 exact v2 IDs and disables unrelated holding projection', () => {
  for (const count of [1, 10]) {
    const ids = Array.from({ length: count }, (_, i) => signupId(i + 1));
    for (const args of [['--apply', '--signup-job-ids=' + ids.join(',')], ['--apply', '--signup-job-ids', ids.join(',')]]) {
      const selected = boundedSelection(args);
      assert.equal(selected.apply, true); assert.equal(selected.holdingProjectionEnabled, false);
      assert.deepEqual(Array.from(selected.signupJobIds), ids);
    }
  }
});
for (const [label, args, env] of [
  ['over ten', ['--signup-job-ids=' + Array.from({ length: 11 }, (_, i) => signupId(i + 1)).join(',')]],
  ['duplicate ID', ['--signup-job-ids=' + [signupId(1), signupId(1)].join(',')]],
  ['foreign ID', ['--signup-job-ids=holding_delivery_memo_other']],
  ['empty list item', ['--signup-job-ids=' + signupId(1) + ',']],
  ['mixed job-id', ['--job-id=other', '--signup-job-ids=' + signupId(1)]],
  ['environment job-id', ['--signup-job-ids=' + signupId(1)], { STUDIOMATE_MEMO_WRITE_JOB_ID: 'other' }],
  ['empty explicit selector', ['--apply', '--signup-job-ids=']],
  ['missing explicit selector value', ['--apply', '--signup-job-ids']],
  ['multiple selector flags', ['--apply', '--signup-job-ids=' + signupId(1), '--signup-job-ids=' + signupId(2)]],
]) test('bounded selector rejects ' + label + ' instead of falling through to an unscoped run', () => {
  assert.throws(() => boundedSelection(args, env));
});

function boundedLoader(ids, change = () => {}) {
  const calls = [], rows = ids.map(id => ({ id, data: { jobId: id, source: 'instructor_member_eformsign',
    profileUpdate: { version: 2 }, status: 'pending' }, exists: true }));
  change(rows);
  const db = { doc: path => ({ path }), getAll: async (...refs) => {
    calls.push(refs.map(ref => ref.path));
    return rows.map(row => ({ id: row.id, exists: row.exists, ref: { path: 'studiomateMemoWriteJobs/' + row.id },
      data: () => clone(row.data), get: field => row.data?.[field] }));
  }, collection: () => assert.fail('Bounded selection must never scan the general queue') };
  const load = vm.runInNewContext(loadJobsDeclaration.getText(tree) + '\nloadPendingJobs',
    { signupJobIds: ids, jobId: '', db, timestampMillis: () => assert.fail('Unscoped sort must not run') }, { timeout: 1000 });
  return { load, calls };
}
test('bounded loader fetches only exact requested documents, skips terminal statuses and never broadens scope', async () => {
  const ids = Array.from({ length: 4 }, (_, i) => signupId(i + 1));
  const f = boundedLoader(ids, rows => { rows[1].data.status = 'retry'; rows[2].data.status = 'done'; rows[3].data.status = 'failed'; });
  const result = await f.load(1);
  assert.deepEqual(Array.from(result, row => row.data.jobId), ids.slice(0, 2));
  assert.deepEqual(f.calls, [ids.map(id => 'studiomateMemoWriteJobs/' + id)]);
});
for (const [label, change] of Object.entries({
  missingDocument: rows => { rows[0].exists = false; }, foreignSource: rows => { rows[0].data.source = 'holding_notice_delivery'; },
  wrongVersion: rows => { rows[0].data.profileUpdate.version = 1; }, wrongStoredId: rows => { rows[0].data.jobId = signupId(9); },
})) test('bounded loader rejects ' + label + ' without replacing it with another queue item', async () => {
  const f = boundedLoader([signupId(1)], change);
  await assert.rejects(f.load(10)); assert.equal(f.calls.length, 1);
});
