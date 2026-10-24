import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { GROUP, POLICY_ID, entitlementFromGrant, removalPlan, verifyRemoval, reconcile } from '../e261017-access.mjs';
import { STAFF_GRADE, STAFF_GROUP } from '../lib/imweb-staff-video-policy.mjs';
import { E261017_SHARE, A261024_SHARE, B261024_SHARE, STUDENT_SHARE_SOURCES } from '../lib/imweb-student-share-policy.mjs';

const start = '2026-10-18T01:16:33.501Z';
const end = '2026-11-27T01:16:33.501Z';
const code = 'm20261018abcdef';
const grant = { status: 'group_verified', beforeGroups: ['paid'], afterGroups: ['paid', GROUP],
  existingGroupsPreserved: true, verifiedAt: start };
const member = { memberCode: code, uid: 'fixture-only', siteCode: 'S20260516852c71a014d08',
  unitCode: 'u2026051698c99ea234719', group: ['paid', GROUP, 'staff'], point: 3000, coupon: [] };
const entitlement = () => entitlementFromGrant(code, grant, Date.parse(start));
const staffStart = '2026-10-25T01:16:33.501Z';
const staffStartMs = Date.parse(staffStart);
const staffEndMs = staffStartMs + 40 * 86400000;
const staffEnd = new Date(staffEndMs).toISOString();

function staffReceipt(source) {
  const groups = ['paid', source.groupCode, STAFF_GROUP];
  return { kind: 'student_share_existing_staff', status: 'group_verified',
    beforeGroups: [...groups], afterGroups: [...groups], existingGroupsPreserved: true,
    beforeGrade: STAFF_GRADE, afterGrade: STAFF_GRADE, verifiedAt: staffStart,
    attendanceEvidence: { source: 'studiomate_live_lesson_detail', status: 'both_sessions_attended',
      memberCode: code, date: '2026-10-24', lessonIds: [...source.lessonIds] } };
}

test('forty days use the first verified grant instant, not lesson date or check date', () => {
  const e = entitlement(); assert.equal(e.expiresAt, end); assert.equal(e.grantedAt, start);
  assert.equal(removalPlan(member, e, Date.parse(end) - 1).action, 'not_due');
  assert.equal(removalPlan(member, e, Date.parse(end)).action, 'remove_group_only');
});
test('ambiguous original grant, missing timezone and future evidence are rejected', () => {
  for (const bad of [{ ...grant, beforeGroups: [GROUP] }, { ...grant, status: 'grant_intent' },
    { ...grant, verifiedAt: '2026-10-18' }, { ...grant, existingGroupsPreserved: false }]) {
    assert.throws(() => entitlementFromGrant(code, bad, Date.parse(start)));
  }
  assert.throws(() => entitlementFromGrant(code, grant, Date.parse(start) - 1), /future/);
  for (const delta of [-86400000, 86400000]) {
    assert.throws(() => entitlementFromGrant(code, { ...grant,
      grantedAt: new Date(Date.parse(start) + delta).toISOString() }, Date.parse(start) + 86400000), /Conflicting/);
  }
  assert.equal(entitlementFromGrant(code, { ...grant, grantedAt: start }, Date.parse(start)).expiresAt, end);
});
test('expiration removes only E-team group and preserves all other permissions and purchases', () => {
  const plan = removalPlan(member, entitlement(), Date.parse(end));
  assert.deepEqual(plan.afterGroups, ['paid', 'staff']);
  verifyRemoval(member, { ...member, group: plan.afterGroups }, plan.afterGroups);
  assert.throws(() => verifyRemoval(member, { ...member, point: 0, group: plan.afterGroups }, plan.afterGroups));
  assert.throws(() => verifyRemoval(member, { ...member, group: [] }, plan.afterGroups));
});
test('native staff grade defers expiry without extending the original grant clock', () => {
  const e = entitlement(); const snapshot = structuredClone(e);
  assert.equal(removalPlan({ ...member, grade: STAFF_GRADE }, e, Date.parse(end)).action, 'staff_access_preserved');
  assert.deepEqual(e, snapshot);
  assert.equal(removalPlan({ ...member, group: [...member.group, STAFF_GROUP] }, e, Date.parse(end)).action, 'remove_group_only');
  assert.equal(removalPlan({ ...member, grade: STAFF_GRADE }, e, Date.parse(end)-1).action, 'not_due');
  assert.equal(removalPlan(member, e, Date.parse(end)+1).action, 'remove_group_only');
});
test('wrong scope, tampered expiry and ambiguous group data stop before mutation', () => {
  for (const bad of [{ ...member, memberCode: 'm123' }, { ...member, siteCode: 'other' },
    { ...member, unitCode: 'other' }, { ...member, group: [{}] }]) {
    assert.throws(() => removalPlan(bad, entitlement(), Date.parse(end)));
  }
  assert.throws(() => removalPlan(member, { ...entitlement(), expiresAt: start }, Date.parse(end)));
});
test('revoked entries remain terminal; unknown writes are not automatically repeated', () => {
  const e = entitlement(); e.revocation = { status: 'intent' };
  assert.equal(removalPlan(member, e, Date.parse(end)).action, 'review_unknown_result');
  assert.equal(removalPlan({ ...member, group: ['paid'] }, e, Date.parse(end)).action, 'reconcile_absent_unknown');
  e.status = 'revoked'; assert.equal(removalPlan(member, e, Date.parse(end)).action, 'terminal');
});

function fixture({ fail = false, unknown = false, source = E261017_SHARE, groups,
  grantAt = start } = {}) {
  const evidence = { ...structuredClone(grant), verifiedAt: grantAt, afterGroups: ['paid', source.groupCode] };
  let live = { ...structuredClone(member), group: groups ?? ['paid', source.groupCode, 'staff'] };
  let writes = 0; let saves = 0;
  const s = { accessPolicy: { id: source.policyId, approved: true, days: 40,
    basis: 'first_verified_grant', revocation: source.revocation }, manualImmediateGrants: { [code]: evidence },
    entitlements: { [code]: entitlementFromGrant(code, evidence, Date.parse(grantAt), source) }, untouched: { keep: true } };
  if (unknown) s.entitlements[code].revocation = { status: 'result_unknown' };
  const run = args => {
    if (args[0] === 'config') return { resolved_profile: { site_code: member.siteCode, unit_code: member.unitCode } };
    if (args[0] === 'order') return { data: { list: [], currentPage: 1, totalCount: 0, totalPage: 0 } };
    if (args[1] === 'list') return { data: { list: [structuredClone(live)], hasNext: false } };
    if (args[1] === 'get') return { data: structuredClone(live) };
    if (args[1] === 'groups') {
      assert.ok(STUDENT_SHARE_SOURCES.some(source => source.groupCode === args[3]));
      return { data: { list: live.group.includes(args[3]) ? [structuredClone(live)] : [] } };
    }
    if (args.includes('--dry-run')) return { confirmation_token: 'fixture-only' };
    writes++; if (fail) throw Error('fixture transport failure');
    live.group = JSON.parse(args[args.indexOf('--data') + 1]).groupCodes; return { statusCode: 200 };
  };
  return { s, run, save: () => saves++, get live() { return structuredClone(live); },
    get writes() { return writes; }, get saves() { return saves; } };
}

test('omitting the optional source retains the canonical E policy', () => {
  assert.equal(GROUP, E261017_SHARE.groupCode);
  assert.equal(POLICY_ID, E261017_SHARE.policyId);
  assert.deepEqual(entitlement(), entitlementFromGrant(code, grant, Date.parse(start), E261017_SHARE));
  assert.deepEqual(removalPlan(member, entitlement(), Date.parse(end)),
    removalPlan(member, entitlement(), Date.parse(end), E261017_SHARE));
});

for (const source of [A261024_SHARE, B261024_SHARE]) {
  test(`${source.policyId} converts an unchanged STAFF receipt without requiring a fake transition`, () => {
    const receipt = staffReceipt(source);
    const before = structuredClone(receipt);
    const entry = entitlementFromGrant(code, receipt, staffStartMs, source);
    assert.deepEqual(entry, { policyId: source.policyId, memberCode: code, groupCode: source.groupCode,
      grantedAt: staffStart, expiresAt: staffEnd, status: 'active',
      grantEvidence: 'manualImmediateGrants:independent_attendance_share_on_staff' });
    assert.deepEqual(receipt, before);
    const unannotated = structuredClone(receipt); delete unannotated.kind;
    assert.throws(() => entitlementFromGrant(code, unannotated, staffStartMs, source), /Student-share evidence/);
  });

  test(`${source.policyId} converter rejects a valid attendance receipt belonging to another member`, () => {
    const receipt = staffReceipt(source);
    receipt.attendanceEvidence.memberCode = 'm002';
    const before = structuredClone(receipt);
    assert.throws(() => entitlementFromGrant(code, receipt, staffStartMs, source));
    assert.deepEqual(receipt, before);
  });

  test(`${source.policyId} rejects a miskeyed STAFF receipt before all provider reads and saves`, () => {
    const f = fixture({ source, grantAt: staffStart });
    const receipt = staffReceipt(source); receipt.attendanceEvidence.memberCode = 'm002';
    f.s.manualImmediateGrants[code] = receipt;
    f.s.entitlements = {};
    const before = structuredClone(f.s);
    assert.throws(() => reconcile(f.s, { source, apply: true, adopt: true, now: staffStartMs,
      run: () => assert.fail('Receipt identity must fail before provider access'), save: f.save }), /Student-share evidence/);
    assert.deepEqual(f.s, before); assert.equal(f.writes, 0); assert.equal(f.saves, 0);
  });

  test(`${source.policyId} STAFF receipt adoption and deferral preserve the first clock without group writes`, () => {
    const receipt = staffReceipt(source);
    const f = fixture({ source, grantAt: staffStart, groups: [...receipt.afterGroups] });
    f.s.manualImmediateGrants[code] = receipt;
    f.s.entitlements = {};
    const originalReceipt = structuredClone(receipt);
    let isStaff = true;
    const calls = [];
    const run = args => {
      calls.push(structuredClone(args));
      const response = f.run(args);
      if (args[1] === 'get') response.data.grade = isStaff ? STAFF_GRADE : 'ordinary';
      return response;
    };
    for (const now of [staffStartMs, staffStartMs + 86400000, staffEndMs, staffEndMs + 86400000]) {
      reconcile(f.s, { source, apply: true, adopt: true, now, run, save: f.save });
      assert.equal(f.s.entitlements[code].grantedAt, staffStart);
      assert.equal(f.s.entitlements[code].expiresAt, staffEnd);
      assert.deepEqual(f.s.manualImmediateGrants[code], originalReceipt);
      assert.deepEqual(f.live.group, originalReceipt.beforeGroups);
      assert.equal(f.writes, 0);
    }
    assert.equal(calls.some(args => args[1] === 'update'), false);
    isStaff = false;
    reconcile(f.s, { source, apply: true, adopt: true, now: staffEndMs + 86400000 + 1, run, save: f.save });
    assert.equal(f.writes, 1);
    assert.deepEqual(f.live.group, ['paid', STAFF_GROUP]);
    assert.equal(f.s.entitlements[code].status, 'revoked');
    assert.equal(f.s.entitlements[code].grantedAt, staffStart);
    assert.equal(f.s.entitlements[code].expiresAt, staffEnd);
    assert.deepEqual(f.s.manualImmediateGrants[code], originalReceipt);
  });
}

for (const source of [A261024_SHARE, B261024_SHARE]) {
  const other = source === A261024_SHARE ? B261024_SHARE : A261024_SHARE;
  test(`${source.policyId} expiry removes only its own team and preserves E and the other team`, () => {
    const groups = ['paid', GROUP, source.groupCode, other.groupCode, 'staff'];
    const f = fixture({ source, groups });
    const before = f.live;
    const original = structuredClone(f.s.entitlements[code]);
    assert.equal(removalPlan(f.live, original, Date.parse(end) - 1, source).action, 'not_due');
    reconcile(f.s, { source, run: f.run, now: Date.parse(end), apply: true, save: f.save });
    assert.equal(f.writes, 1);
    assert.deepEqual(f.live.group, groups.filter(group => group !== source.groupCode));
    verifyRemoval(before, f.live, f.live.group);
    assert.equal(f.s.entitlements[code].status, 'revoked');
    assert.equal(f.s.entitlements[code].revocation.status, 'verified');
    assert.equal(f.s.entitlements[code].grantedAt, original.grantedAt);
    assert.equal(f.s.entitlements[code].expiresAt, original.expiresAt);
    reconcile(f.s, { source, run: f.run, now: Date.parse(end) + 1, apply: true, save: f.save });
    assert.equal(f.writes, 1);
  });

  test(`${source.policyId} adoption and staff deferral never restart the first grant clock`, () => {
    const f = fixture({ source });
    const expected = structuredClone(f.s.entitlements[code]);
    f.s.entitlements = {};
    const run = args => {
      const response = f.run(args);
      if (args[1] === 'get') response.data.grade = STAFF_GRADE;
      return response;
    };
    for (const now of [Date.parse(start) + 86400000, Date.parse(end), Date.parse(end) + 86400000]) {
      reconcile(f.s, { source, run, now, apply: true, adopt: true, save: f.save });
      assert.deepEqual(f.s.entitlements[code], expected);
      assert.equal(f.writes, 0);
    }
    assert.equal(removalPlan(f.live, f.s.entitlements[code], Date.parse(end) + 86400000, source).action,
      'remove_group_only');
  });

  test(`${source.policyId} cannot adopt, revoke or reset another team's evidence`, () => {
    const f = fixture({ source });
    const before = structuredClone(f.s);
    assert.throws(() => reconcile(f.s, { source: other, now: Date.parse(end), apply: true,
      run: () => assert.fail('Cross-team policy must fail before provider reads'), save: f.save }), /Approved/);
    assert.throws(() => removalPlan(f.live, f.s.entitlements[code], Date.parse(end), other), /scope mismatch/);
    assert.throws(() => entitlementFromGrant(code, f.s.manualImmediateGrants[code], Date.parse(start), other));
    assert.deepEqual(f.s, before); assert.equal(f.writes, 0); assert.equal(f.saves, 0);
    const entry = f.s.entitlements[code];
    entry.grantedAt = new Date(Date.parse(start) + 1).toISOString();
    entry.expiresAt = new Date(Date.parse(end) + 1).toISOString();
    assert.throws(() => reconcile(f.s, { source, now: Date.parse(end), apply: true,
      run: () => assert.fail('Shifted first grant must fail before provider reads'), save: f.save }), /Student-share/);
    assert.equal(f.writes, 0); assert.equal(f.saves, 0);
  });

  test(`${source.policyId} unknown removal is not replayed across team isolation`, () => {
    const f = fixture({ source, unknown: true });
    const before = structuredClone(f.s);
    assert.throws(() => reconcile(f.s, { source, run: f.run, now: Date.parse(end), apply: true,
      save: f.save }), /unresolved/);
    assert.deepEqual(f.s, before); assert.equal(f.writes, 0); assert.equal(f.saves, 0);
  });
}

test('A and B on one member expire independently without migrating or extending either first grant', () => {
  const laterStart = new Date(Date.parse(start) + 86400000).toISOString();
  const a = fixture({ source: A261024_SHARE,
    groups: ['paid', GROUP, A261024_SHARE.groupCode, B261024_SHARE.groupCode, 'staff'] });
  const b = fixture({ source: B261024_SHARE, grantAt: laterStart });
  const originalA = structuredClone(a.s.entitlements[code]);
  const originalB = structuredClone(b.s.entitlements[code]);
  reconcile(a.s, { source: A261024_SHARE, run: a.run, now: Date.parse(end), apply: true, save: a.save });
  reconcile(b.s, { source: B261024_SHARE, run: a.run, now: Date.parse(end), apply: true, save: b.save });
  assert.deepEqual(a.live.group, ['paid', GROUP, B261024_SHARE.groupCode, 'staff']);
  assert.deepEqual(b.s.entitlements[code], originalB);
  assert.equal(a.writes, 1);
  reconcile(b.s, { source: B261024_SHARE, run: a.run, now: Date.parse(end) + 86400000,
    apply: true, save: b.save });
  assert.deepEqual(a.live.group, ['paid', GROUP, 'staff']);
  assert.equal(a.writes, 2);
  for (const [state, original] of [[a.s, originalA], [b.s, originalB]]) {
    assert.equal(state.entitlements[code].grantedAt, original.grantedAt);
    assert.equal(state.entitlements[code].expiresAt, original.expiresAt);
  }
});
test('dry-run never writes, saves or removes permission', () => {
  const f = fixture(); const before = structuredClone(f.s);
  reconcile(f.s, { run: f.run, now: Date.parse(end), save: f.save });
  assert.equal(f.writes, 0); assert.equal(f.saves, 0); assert.deepEqual(f.s, before);
});
test('adoption is idempotent and does not restart the clock', () => {
  const f = fixture(); const before = structuredClone(f.s.entitlements);
  reconcile(f.s, { run: f.run, now: Date.parse(start) + 86400000, adopt: true, apply: true, save: f.save });
  assert.deepEqual(f.s.entitlements, before); assert.equal(f.writes, 0);
  f.s.entitlements = {};
  reconcile(f.s, { run: f.run, now: Date.parse(start) + 86400000, adopt: true, apply: true, save: f.save });
  assert.equal(f.s.entitlements[code].expiresAt, end); assert.equal(f.writes, 0);
});
test('shifting both entitlement dates cannot override the original verified receipt', () => {
  const f = fixture(); const e = f.s.entitlements[code];
  e.grantedAt = new Date(Date.parse(e.grantedAt) + 86400000).toISOString();
  e.expiresAt = new Date(Date.parse(e.expiresAt) + 86400000).toISOString();
  assert.throws(() => reconcile(f.s, { run: f.run, now: Date.parse(end), apply: true, save: f.save }), /Student-share/);
  assert.equal(f.writes, 0); assert.equal(f.saves, 0);
});
test('apply removes only target group, independently reads back and does not repeat', () => {
  const f = fixture();
  reconcile(f.s, { run: f.run, now: Date.parse(end), apply: true, save: f.save });
  assert.equal(f.writes, 1); assert.equal(f.s.entitlements[code].status, 'revoked');
  assert.equal(f.s.entitlements[code].revocation.status, 'verified');
  assert.deepEqual(f.s.untouched, { keep: true });
  reconcile(f.s, { run: f.run, now: Date.parse(end) + 1, apply: true, save: f.save });
  assert.equal(f.writes, 1);
});
test('staff expiry replay keeps the original active entitlement without a write', () => {
  const f = fixture(); const run = args => {
    const result = f.run(args);
    if (args[1] === 'get') result.data.grade = STAFF_GRADE;
    return result;
  };
  const original = structuredClone(f.s.entitlements[code]);
  const outcomes = reconcile(f.s, { run, now: Date.parse(end), apply: true, save: f.save });
  assert.equal(outcomes[0].action, 'staff_access_preserved');
  assert.equal(f.writes, 0); assert.deepEqual(f.s.entitlements[code], original);
});
test('an expired manual E grant does not revoke a valid later purchase after staff exit', () => {
  const f = fixture(); let orderReads = 0;
  const purchase = { orderNo: 101, memberCode: code, orderStatus: 'CLOSED',
    sections: [{ orderSectionStatus: 'PURCHASE_CONFIRMATION', sectionItems: [{
      productInfo: { groupPassCode: GROUP, groupPassDayCnt: 40 } }] }],
    payments: [{ paymentStatus: 'PAYMENT_COMPLETE', isCancel: 'N', paymentCompleteTime: '2026-11-20T01:00:00Z' }] };
  const run = args => {
    if (args[0] === 'order') { orderReads++; return { data: { list: [purchase], currentPage: 1, totalCount: 1, totalPage: 1 } }; }
    return f.run(args);
  };
  const original = structuredClone(f.s.entitlements[code]);
  const outcomes = reconcile(f.s, { run, now: Date.parse(end), apply: true, save: f.save });
  assert.equal(outcomes[0].action, 'purchased_access_preserved');
  assert.equal(orderReads, 1); assert.equal(f.writes, 0);
  assert.deepEqual(f.s.entitlements[code], original);
});
test('a group added during the E purchase scan is not overwritten', () => {
  const f = fixture(); let scanned = false;
  const run = args => {
    const result = f.run(args);
    if (args[0] === 'order') scanned = true;
    if (scanned && args[1] === 'get') result.data.group.push('new-manual-permission');
    return result;
  };
  assert.throws(() => reconcile(f.s, { run, now: Date.parse(end), apply: true, save: f.save }), /readback mismatch/);
  assert.equal(f.writes, 0); assert.equal(f.s.entitlements[code].revocation, undefined);
});
test('incomplete or duplicated E purchase pages prevent a permission write', () => {
  for (const list of [[{ orderNo: 1 }, { orderNo: 1 }], []]) {
    const f = fixture(); const run = args => args[0] === 'order'
      ? { data: { list, currentPage: 1, totalCount: 2, totalPage: 1 } } : f.run(args);
    assert.throws(() => reconcile(f.s, { run, now: Date.parse(end), apply: true, save: f.save }), /duplicate|Incomplete/);
    assert.equal(f.writes, 0);
  }
});
test('uncertain write is durably recorded and blocked until independently reconciled', () => {
  const f = fixture({ fail: true });
  assert.throws(() => reconcile(f.s, { run: f.run, now: Date.parse(end), apply: true, save: f.save }), /reconcile/);
  assert.equal(f.writes, 1); assert.equal(f.s.entitlements[code].revocation.status, 'result_unknown');
  assert.throws(() => reconcile(f.s, { run: f.run, now: Date.parse(end), apply: true, save: f.save }), /unresolved/);
  assert.equal(f.writes, 1);
});
test('unapproved policy blocks every read and write', () => {
  const f = fixture(); f.s.accessPolicy.approved = false;
  assert.throws(() => reconcile(f.s, { run: () => { throw Error('must not run'); } }), /Approved/);
});
test('unknown-result recovery only reads when the group is already absent', () => {
  const f = fixture();
  const lostReadback = args => {
    if (args[1] === 'groups') throw Error('fixture lost readback');
    return f.run(args);
  };
  assert.throws(() => reconcile(f.s, { run: lostReadback, now: Date.parse(end), apply: true, save: f.save }), /reconcile/);
  assert.equal(f.writes, 1);
  reconcile(f.s, { run: f.run, now: Date.parse(end), apply: true, save: f.save });
  assert.equal(f.s.entitlements[code].status, 'revoked'); assert.equal(f.writes, 1);
  assert.equal(f.s.entitlements[code].revocation.status, 'verified_reconciled');
});
test('unknown writes with missing unrelated groups never become terminal', () => {
  for (const status of ['intent', 'result_unknown']) {
    const f = fixture();
    const lostReadback = args => { if (args[1] === 'groups') throw Error('fixture'); return f.run(args); };
    assert.throws(() => reconcile(f.s, { run: lostReadback, now: Date.parse(end), apply: true, save: f.save }));
    f.s.entitlements[code].revocation.status = status;
    const missing = args => {
      const result = f.run(args); if (args[1] === 'get') result.data.group = []; return result;
    };
    assert.throws(() => reconcile(f.s, { run: missing, now: Date.parse(end), apply: true, save: f.save }), /preservation reconciliation/);
    assert.equal(f.s.entitlements[code].status, 'active'); assert.equal(f.writes, 1);
  }
});
test('a concurrent unrelated group change blocks the write before intent', () => {
  const f = fixture(); let reads = 0;
  const racing = args => {
    const response = f.run(args);
    if (args[1] === 'get' && ++reads === 2) response.data.group.push('new-purchase');
    return response;
  };
  assert.throws(() => reconcile(f.s, { run: racing, now: Date.parse(end), apply: true, save: f.save }), /readback mismatch/);
  assert.equal(f.writes, 0); assert.equal(f.s.entitlements[code].revocation, undefined);
});
test('missing entitlement collection is unchanged in read-only adoption', () => {
  const f = fixture(); delete f.s.entitlements; const before = structuredClone(f.s);
  reconcile(f.s, { run: f.run, now: Date.parse(start), adopt: true, save: f.save });
  assert.deepEqual(f.s, before); assert.equal(f.writes, 0); assert.equal(f.saves, 0);
});
test('a 501-member site completes pagination before processing recorded grants', () => {
  const f = fixture(); let pages = 0;
  const paginated = args => {
    if (args[1] !== 'list') return f.run(args);
    pages++;
    const rows = pages === 11 ? [member] : Array.from({ length: 50 }, (_, i) => ({ ...member,
      memberCode: `m${(pages * 50 + i).toString(16)}`, uid: `fixture-${pages}-${i}` }));
    return { data: { list: rows, hasNext: pages < 11, nextCursor: `cursor-${pages}` } };
  };
  reconcile(f.s, { run: paginated, now: Date.parse(start) });
  assert.equal(pages, 11); assert.equal(f.writes, 0);
});
test('failed durable intent persistence prevents the provider write', () => {
  const f = fixture();
  assert.throws(() => reconcile(f.s, { run: f.run, now: Date.parse(end), apply: true,
    save: () => { throw Error('fixture disk failure'); } }), /disk failure/);
  assert.equal(f.writes, 0);
});
test('CLI rejects time overrides and respects a held shared lock before any provider access', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'e-team-offline-test-'));
  try {
    const directory = path.join(home, 'Library/Application Support/ARCHIVE PILATES/student-share-e-261017');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    const stateFile = path.join(directory, 'state.json');
    fs.writeFileSync(stateFile, JSON.stringify(fixture().s), { mode: 0o600 });
    const file = path.join(directory, 'run.lock'); fs.writeFileSync(file, 'fixture-owned', { mode: 0o600 });
    const script = path.resolve('scripts/e261017-access.mjs');
    const options = { encoding: 'utf8', timeout: 5000,
      env: { ...process.env, HOME: home, IMWEB_CLI_BIN: path.join(home, 'forbidden-provider') } };
    const override = spawnSync(process.execPath, [script, '--now=2099-01-01'], options);
    assert.equal(override.status, 1); assert.match(override.stderr, /time override is forbidden/);
    const held = spawnSync(process.execPath, [script, '--apply'], options);
    assert.equal(held.status, 1); assert.match(held.stderr, /EEXIST/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'fixture-owned');
    fs.unlinkSync(file);
    fs.chmodSync(stateFile, 0o640);
    const failed = spawnSync(process.execPath, [script], options);
    assert.equal(failed.status, 1); assert.match(failed.stderr, /Unsafe share ledger/);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.lstatSync(stateFile).mode & 0o777, 0o640);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('CLI read-only main iterates every registered synthetic ledger without saving or provider writes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'registered-share-offline-test-'));
  try {
    const files = STUDENT_SHARE_SOURCES.map(source => {
      const directory = path.join(home, 'Library/Application Support/ARCHIVE PILATES', source.lane);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const file = path.join(directory, 'state.json');
      const state = fixture({ source }).s;
      state.manualImmediateGrants = {}; state.entitlements = {};
      fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
      return { directory, file, before: fs.readFileSync(file, 'utf8') };
    });
    const provider = path.join(home, 'synthetic-imweb');
    fs.writeFileSync(provider, `#!${process.execPath}
      const args = process.argv.slice(2);
      if (args.slice(-2).join(' ') === 'config context') {
        console.log(JSON.stringify({ resolved_profile: ${JSON.stringify({ site_code: member.siteCode, unit_code: member.unitCode })} }));
      } else if (args.includes('member') && args.includes('list')) {
        console.log(JSON.stringify({ data: { list: [], hasNext: false } }));
      } else { throw Error('Unexpected provider command in offline fixture'); }
    `, { mode: 0o700 });
    const result = spawnSync(process.execPath, [path.resolve('scripts/e261017-access.mjs')], {
      encoding: 'utf8', timeout: 5000, env: { ...process.env, HOME: home, IMWEB_CLI_BIN: provider },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const results = result.stdout.trim().split(/\n(?=\{)/).map(value => JSON.parse(value));
    assert.deepEqual(results.map(value => value.source),
      STUDENT_SHARE_SOURCES.map(source => source.policyId));
    for (const value of results) {
      assert.equal(value.ok, true);
      assert.equal(value.mode, 'read_only');
      assert.deepEqual(value.outcomes, []);
    }
    for (const item of files) {
      assert.equal(fs.readFileSync(item.file, 'utf8'), item.before);
      assert.deepEqual(fs.readdirSync(item.directory), ['state.json']);
    }
    assert.equal(fs.existsSync(path.join(home, 'ArchiveIN/automation/locks/imweb-member-groups.lock')), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
