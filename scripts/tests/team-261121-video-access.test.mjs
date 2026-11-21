import assert from 'node:assert/strict';
import test from 'node:test';
import { matchNativeAccount, validateNativeRoster } from '../grant-team-261121-video-access.mjs';
import { SITE, UNIT } from '../lib/imweb-staff-video-policy.mjs';
import { TEAM261121_SHARE as source } from '../lib/imweb-student-share-policy.mjs';

const now = Date.parse('2026-11-21T08:00:00Z');
const names = ['Alpha Person', 'Beta Person', 'Gamma Person', 'Delta Person', 'Eta Person'];
const base = { source: 'StudioMate live lesson-detail DOM', date: source.lessonDate, studio: '5330',
  sessions: source.lessonIds.map(lessonId => ({ lessonId, observedAt: new Date(now - 1000).toISOString(),
    registeredCount: 5, rows: names.map((name, i) => ({ name, check: (4096 + i).toString(16), attendance: i % 2 ? '결석' : '출석' })) })) };

test('native eligibility binds both exact sessions and includes registered absentees', () => {
  assert.equal(validateNativeRoster(base, now).length, 5);
  const faults = [p => { p.sessions[0].rows[0].attendance = '취소'; },
    p => { p.sessions[1].rows[0].check = 'ab'; }, p => { p.sessions[1].lessonId = 'other'; },
    p => { p.sessions[0].observedAt = new Date(now - 3 * 3600000).toISOString(); },
    p => { p.sessions[0].rows.pop(); }];
  for (const alter of faults) {
    const bad = structuredClone(base);
    alter(bad);
    assert.throws(() => validateNativeRoster(bad, now));
  }
});

test('account binding requires the registered name and a unique full number', () => {
  const name = 'Alpha Person', number = '01000000000';
  let h = 2166136261;
  for (const c of `team261121-roster|${name}|${number}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const target = { name, check: (h >>> 0).toString(16) };
  const member = { name, callnum: '010-0000-0000', uid: 'synthetic@example.invalid', memberCode: 'm00001', siteCode: SITE, unitCode: UNIT };
  assert.deepEqual(matchNativeAccount(target, [member]), { status: 'matched', member });
  assert.equal(matchNativeAccount(target, []).status, 'no_member');
  assert.equal(matchNativeAccount(target, [{ ...member, callnum: '01000000001' }]).status, 'hold_identity');
  assert.equal(matchNativeAccount(target, [member, { ...member, name: 'Other Person', memberCode: 'm00002' }]).status, 'hold_identity');
  assert.throws(() => matchNativeAccount(target, [{ ...member, unitCode: 'other' }]));
});
