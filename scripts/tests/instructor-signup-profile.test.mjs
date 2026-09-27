import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  SIGNUP_PROFILE_VERSION, SIGNUP_PROFILE_FIELDS, normalizeSignupBirthDate,
  parseSignupProfile, readCompletedSignupProfile, signupProfileMemo, signupProfileMemoPresent,
  birthDateWriteDecision, assertSignupProfileSource, applySignupBirthDate,
} from '../lib/instructor-signup-profile.mjs';
import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID } from '../lib/instructor-lesson-registration-contract.mjs';

const NOW = new Date('2026-09-28T12:00:00Z');
const DOCUMENT_ID = 'a'.repeat(32);
const MEMBER_ID = '123456';
const BASE_URL = 'https://arcpilates.studiomate.kr';
beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: NOW }));

function fixture() {
  const source = {
    registrationId: 'synthetic-registration', studioId: '5330', documentId: DOCUMENT_ID,
    studiomateMemberId: MEMBER_ID, memberName: 'Synthetic Instructor', memberPhone: '01000000001',
    status: 'done', profileMemoJobId: `instructor_member_profile_${DOCUMENT_ID}`,
  };
  const fields = {
    memberName: source.memberName, memberPhone: source.memberPhone, birthDate: '1990-01-02',
    affiliation: 'Synthetic Studio', career: 'Synthetic experience', address: 'Synthetic address',
  };
  const profile = parseSignupProfile(fields, source, DOCUMENT_ID, NOW);
  source.submittedProfile = profile;
  const job = {
    jobId: source.profileMemoJobId, registrationId: source.registrationId,
    source: 'instructor_member_eformsign', studioId: source.studioId,
    memberId: MEMBER_ID, studiomateMemberId: MEMBER_ID,
    memberName: source.memberName, memberPhone: source.memberPhone,
    profileUpdate: { version: SIGNUP_PROFILE_VERSION, documentId: DOCUMENT_ID, birthDate: profile.birthDate },
    content: signupProfileMemo(profile),
  };
  const registration = {
    registrationId: source.registrationId, studioId: source.studioId,
    studiomateMemberId: MEMBER_ID, memberName: source.memberName, memberPhone: source.memberPhone,
  };
  return { source, fields, profile, job, registration };
}

for (const [input, expected] of [
  ['1990-01-02', '1990-01-02'], ['1990/1/2', '1990-01-02'], ['1990.1.2', '1990-01-02'],
  ['1990\uB144 1\uC6D4 2\uC77C', '1990-01-02'], ['19900102', '1990-01-02'],
  ['900102', '1990-01-02'], ['000229', '2000-02-29'], ['2000-02-29', '2000-02-29'],
  [' 1990-01-02 ', '1990-01-02'], ['', ''], ['  ', ''], [undefined, ''], [null, ''],
]) {
  test(`DOB normalizes ${JSON.stringify(input)}`, () => {
    assert.equal(normalizeSignupBirthDate(input, NOW), expected);
  });
}
for (const input of ['1990-02-29', '2001-02-30', '1990-13-01', '1990-01-00',
  '01/02/1990', 'not-a-date', '1990-1', '2026-09-29', '2027-01-01', '1925-01-01']) {
  test(`DOB rejects invalid or future value ${input}`, () => {
    assert.throws(() => normalizeSignupBirthDate(input, NOW));
  });
}

test('profile binds normalized identity to the canonical document and template without mutation', () => {
  const { fields, source } = fixture();
  fields.memberPhone = '+82 10-0000-0001';
  fields.memberName = ' Synthetic Instructor ';
  const before = structuredClone({ fields, source });
  const profile = parseSignupProfile(fields, source, DOCUMENT_ID, NOW);
  assert.equal(profile.memberPhone, '01000000001');
  assert.equal(profile.memberName, source.memberName);
  assert.equal(profile.documentId, DOCUMENT_ID);
  assert.equal(profile.templateId, INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID);
  assert.equal(profile.version, SIGNUP_PROFILE_VERSION);
  assert.deepEqual({ fields, source }, before);
});

for (const [label, change] of [
  ['name', f => { f.fields.memberName = 'Other Synthetic Instructor'; }],
  ['phone', f => { f.fields.memberPhone = '01000000002'; }],
  ['blank phone', f => { f.fields.memberPhone = ''; }],
  ['member id', f => { f.source.studiomateMemberId = 'excel_synthetic'; }],
  ['studio', f => { f.source.studioId = 'other'; }],
  ['document', f => { f.source.documentId = 'b'.repeat(32); }],
  ['DOB', f => { f.fields.birthDate = '2026-02-30'; }],
  ['oversize detail', f => { f.fields.address = 'x'.repeat(1001); }],
]) {
  test(`profile rejects mismatched ${label}`, () => {
    const f = fixture(); change(f);
    assert.throws(() => parseSignupProfile(f.fields, f.source, DOCUMENT_ID, NOW));
  });
}

test('empty optional details and DOB produce an explicit memo without undefined values', () => {
  const { source, fields } = fixture();
  for (const key of ['birthDate', 'affiliation', 'career', 'address']) fields[key] = '';
  const profile = parseSignupProfile(fields, source, DOCUMENT_ID, NOW);
  assert.equal(profile.birthDate, '');
  assert.equal(signupProfileMemo(profile), [
    '[ARCHIVE PILATES \uAC15\uC0AC\uD68C\uC6D0 \uAC00\uC785\uC11C \uC815\uBCF4]',
    '\uAC15\uC0AC \uACBD\uB825: \uBBF8\uAE30\uC7AC', '\uC18C\uC18D: \uBBF8\uAE30\uC7AC',
    '\uC8FC\uC18C: \uBBF8\uAE30\uC7AC', `\uC774\uD3FC\uC2F8\uC778 \uBB38\uC11C: ${DOCUMENT_ID}`,
  ].join('\n'));
});

test('old completion memo with the same document cannot stand in for profile details', () => {
  const { profile } = fixture();
  const baseline = ['[ARCHIVE PILATES \uAC15\uC0AC\uD68C\uC6D0 \uAC00\uC785\uC11C \uC644\uB8CC]',
    'Synthetic consent completion', `\uC774\uD3FC\uC2F8\uC778 \uBB38\uC11C: ${DOCUMENT_ID}`].join('\n');
  assert.equal(signupProfileMemoPresent(baseline, signupProfileMemo(profile)), false);
});

test('profile memo requires every interior detail, not just its header and document tail', () => {
  const content = signupProfileMemo(fixture().profile);
  const lines = content.split('\n');
  for (const index of [1, 2, 3]) {
    const missing = lines.filter((_, i) => i !== index).join('\n');
    assert.equal(signupProfileMemoPresent(missing, content), false);
  }
  assert.equal(signupProfileMemoPresent(content.replace('Synthetic address', 'Different synthetic address'), content), false);
});

test('profile memo accepts whitespace-normalized complete text and rejects empty expected text', () => {
  const content = signupProfileMemo(fixture().profile);
  assert.equal(signupProfileMemoPresent(`Synthetic heading\n${content.replace(/\n/g, '\r\n  \t')}\nSynthetic footer`, content), true);
  assert.equal(signupProfileMemoPresent(content, ''), false);
  assert.equal(signupProfileMemoPresent(content, '  \n '), false);
});

function evidence() {
  return { found: true, documentId: DOCUMENT_ID, text: '\uC644\uB8CC Synthetic document',
    href: `https://www.eformsign.com/eform/document/view_service.html?document_id=${DOCUMENT_ID}&form_id=${INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID}` };
}
for (const [label, change] of [
  ['unsigned', e => { e.text = 'In progress'; }],
  ['not found', e => { e.found = false; }],
  ['document id', e => { e.documentId = 'b'.repeat(32); }],
  ['document URL', e => { e.href = e.href.replace(DOCUMENT_ID, 'b'.repeat(32)); }],
  ['template', e => { e.href = e.href.replace(INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID, 'b'.repeat(32)); }],
  ['origin', e => { e.href = e.href.replace('www.eformsign.com', 'example.invalid'); }],
]) {
  test(`extraction rejects ${label} before navigating`, async () => {
    const e = evidence(); change(e);
    await assert.rejects(readCompletedSignupProfile({ goto: async () => assert.fail('must not navigate') }, fixture().source, e));
  });
}

for (const language of ['완료', 'Completed']) test(`verified ${language} signed-form extraction reads the six mapped fields using a mocked page`, async () => {
  const { source, fields, profile } = fixture();
  const selectors = [];
  const frame = { locator: selector => {
    selectors.push(selector);
    const key = Object.keys(SIGNUP_PROFILE_FIELDS).find(k => selector === `#${SIGNUP_PROFILE_FIELDS[k]}`);
    assert.ok(key);
    return { waitFor: async () => {}, count: async () => 1, inputValue: async () => fields[key] };
  } };
  const page = {
    goto: async url => assert.equal(url, evidence().href),
    locator: selector => {
      assert.equal(selector, '#viewer_frame');
      return { waitFor: async () => {}, elementHandle: async () => ({ contentFrame: async () => ({ waitForFunction: async () => {} }) }) };
    },
    frameLocator: selector => { assert.equal(selector, '#viewer_frame'); return frame; },
  };
  assert.deepEqual(await readCompletedSignupProfile(page, source, { ...evidence(), text: `${language} Synthetic document` }), profile);
  for (const id of Object.values(SIGNUP_PROFILE_FIELDS)) assert.ok(selectors.includes(`#${id}`));
});

test('canonical source check returns the exact profile without mutation', () => {
  const f = fixture(); const before = structuredClone(f);
  assert.equal(assertSignupProfileSource(f.job, f.source, f.registration), f.profile);
  assert.deepEqual(f, before);
});
for (const [label, change] of [
  ['missing profile', f => { delete f.source.submittedProfile; }],
  ['incomplete source', f => { f.source.status = 'waiting_completion'; }],
  ['profile version', f => { f.profile.version = 999; }],
  ['queue source', f => { f.job.source = 'member_signup'; }],
  ['queue studio', f => { f.job.studioId = 'other'; }],
  ['source studio', f => { f.source.studioId = 'other'; }],
  ['registration studio', f => { f.registration.studioId = 'other'; }],
  ['queue job id', f => { f.job.jobId = 'other'; }],
  ['source queue binding', f => { f.source.profileMemoJobId = 'other'; }],
  ['registration binding', f => { f.job.registrationId = 'other'; }],
  ['queue document', f => { f.job.profileUpdate.documentId = 'b'.repeat(32); }],
  ['queue version', f => { f.job.profileUpdate.version = 999; }],
  ['queue DOB', f => { f.job.profileUpdate.birthDate = '1991-01-02'; }],
  ['member id', f => { f.job.memberId = '999'; }],
  ['resolved member id', f => { f.job.studiomateMemberId = '999'; }],
  ['registration member id', f => { f.registration.studiomateMemberId = '999'; }],
  ['job phone', f => { f.job.memberPhone = '01000000002'; }],
  ['job name', f => { f.job.memberName = 'Other Synthetic Instructor'; }],
  ['registration phone', f => { f.registration.memberPhone = '01000000002'; }],
  ['registration name', f => { f.registration.memberName = 'Other Synthetic Instructor'; }],
  ['changed memo details', f => { f.job.content = f.job.content.replace('Synthetic address', 'Changed synthetic address'); }],
]) {
  test(`canonical source rejects ${label}`, () => {
    const f = fixture(); change(f);
    assert.throws(() => assertSignupProfileSource(f.job, f.source, f.registration));
  });
}

for (const key of ['documentId', 'templateId']) {
  test(`canonical source rejects a changed submittedProfile.${key}`, () => {
    const f = fixture(); f.profile[key] = 'b'.repeat(32);
    f.job.content = signupProfileMemo(f.profile);
    assert.throws(() => assertSignupProfileSource(f.job, f.source, f.registration));
  });
}

test('DOB decision writes only empty fields and never overwrites a conflict', () => {
  assert.equal(birthDateWriteDecision('', '1990-01-02'), 'write');
  assert.equal(birthDateWriteDecision('  ', '1990-01-02'), 'write');
  assert.equal(birthDateWriteDecision('1990-01-02', '1990-01-02'), 'already_equal');
  assert.equal(birthDateWriteDecision('1990-01-02', ''), 'not_provided');
  assert.throws(() => birthDateWriteDecision('1991-01-02', '1990-01-02'));
});

// The mock separates persisted data from editor draft values so reload is meaningful.
function mockProfilePage(job, options = {}) {
  const events = [];
  let stored = options.current ?? '';
  let draft = stored;
  let currentUrl = '';
  const field = { inputValue: async () => draft,
    fill: async value => { events.push('fill'); draft = value; }, press: async () => {} };
  const visibleOnly = locator => ({ filter: options => { assert.deepEqual(options, { visible: true }); return locator; } });
  const phoneValue = options.phone ?? job.memberPhone;
  const page = {
    goto: async url => { events.push('load'); currentUrl = options.wrongId ? url.replace(MEMBER_ID, '999') : url; draft = stored; },
    url: () => currentUrl,
    getByRole: (role, { name } = {}) => {
      if (role === 'textbox') return { and: locator => locator };
      if (role === 'heading') return { waitFor: async () => { assert.equal(name, job.memberName); } };
      if (name === '\uD68C\uC6D0\uC815\uBCF4 \uC218\uC815') return { click: async () => { events.push('editor'); } };
      assert.equal(name, '\uD68C\uC6D0 \uC218\uC815 \uC644\uB8CC');
      return { click: async () => { events.push('save'); if (options.saveError) throw new Error('synthetic save error'); if (options.persist !== false) stored = draft; } };
    },
    getByPlaceholder: placeholder => {
      if (placeholder === '\uD734\uB300\uD3F0 \uBC88\uD638') return visibleOnly({ waitFor: async () => {}, inputValue: async () => phoneValue });
      if (placeholder === '\uC774\uB984\uC744 \uC785\uB825\uD574\uC8FC\uC138\uC694') return visibleOnly({ inputValue: async () => options.name ?? job.memberName });
      assert.equal(placeholder, '\uC0DD\uB144\uC6D4\uC77C (YYYY-MM-DD)'); return visibleOnly(field);
    },
    waitForFunction: async (_, { expectedPhone }) => {
      if (phoneValue.replace(/\D/g, '') !== expectedPhone) throw new Error('synthetic identity timeout');
    },
    waitForURL: async url => assert.equal(currentUrl, url),
  };
  return { page, events, stored: () => stored };
}

test('DOB save requires a persisted readback and replay is a no-op', async () => {
  const { job } = fixture(); const mock = mockProfilePage(job);
  assert.equal(await applySignupBirthDate(mock.page, job, MEMBER_ID, BASE_URL), 'verified');
  assert.equal(mock.stored(), job.profileUpdate.birthDate);
  assert.deepEqual(mock.events, ['load', 'editor', 'fill', 'save', 'load', 'editor']);
  assert.equal(await applySignupBirthDate(mock.page, job, MEMBER_ID, BASE_URL), 'already_equal');
  assert.equal(mock.events.filter(e => e === 'save').length, 1);
});

for (const [label, options] of [
  ['readback mismatch', { persist: false }], ['save failure', { saveError: true }],
]) {
  test(`DOB rejects ${label}`, async () => {
    const { job } = fixture(); const mock = mockProfilePage(job, options);
    await assert.rejects(applySignupBirthDate(mock.page, job, MEMBER_ID, BASE_URL));
    assert.equal(mock.stored(), '');
    assert.equal(mock.events.filter(e => e === 'save').length, 1);
  });
}

for (const [label, options] of [
  ['name mismatch', { name: 'Other Synthetic Instructor' }],
  ['phone mismatch', { phone: '01000000002' }], ['id mismatch', { wrongId: true }],
  ['existing DOB conflict', { current: '1991-01-02' }],
]) {
  test(`DOB ${label} blocks fill and save`, async () => {
    const { job } = fixture(); const mock = mockProfilePage(job, options);
    await assert.rejects(applySignupBirthDate(mock.page, job, MEMBER_ID, BASE_URL));
    assert.equal(mock.events.includes('fill'), false);
    assert.equal(mock.events.includes('save'), false);
    assert.equal(mock.stored(), options.current ?? '');
  });
}

test('empty DOB and an already matching DOB do not save', async () => {
  for (const empty of [true, false]) {
    const { job } = fixture(); if (empty) job.profileUpdate.birthDate = '';
    const mock = mockProfilePage(job, { current: '1990-01-02' });
    assert.equal(await applySignupBirthDate(mock.page, job, MEMBER_ID, BASE_URL), empty ? 'not_provided' : 'already_equal');
    assert.equal(mock.events.includes('save'), false);
  }
});

for (const [label, change] of [
  ['foreign source', job => { job.source = 'member_signup'; }],
  ['foreign studio', job => { job.studioId = 'other'; }],
  ['wrong member', job => { job.studiomateMemberId = '999'; }],
  ['invalid DOB', job => { job.profileUpdate.birthDate = '1990-02-30'; }],
]) {
  test(`DOB ${label} is rejected before navigation`, async () => {
    const { job } = fixture(); change(job);
    const mock = mockProfilePage(job);
    await assert.rejects(applySignupBirthDate(mock.page, job, MEMBER_ID, BASE_URL));
    assert.deepEqual(mock.events, []);
  });
}

test('DOB rejects another origin before navigation and ignores absent profileUpdate', async () => {
  const { job } = fixture(); const mock = mockProfilePage(job);
  await assert.rejects(applySignupBirthDate(mock.page, job, MEMBER_ID, 'https://example.invalid'));
  assert.deepEqual(mock.events, []);
  delete job.profileUpdate;
  assert.equal(await applySignupBirthDate(mock.page, job, MEMBER_ID, BASE_URL), 'not_requested');
  assert.deepEqual(mock.events, []);
});
