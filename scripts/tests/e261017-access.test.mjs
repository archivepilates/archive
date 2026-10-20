import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { GROUP, POLICY_ID, entitlementFromGrant, removalPlan, verifyRemoval, reconcile } from '../e261017-access.mjs';
import { STAFF_GRADE, STAFF_GROUP } from '../lib/imweb-staff-video-policy.mjs';

const start = '2026-10-18T01:16:33.501Z';
const end = '2026-11-27T01:16:33.501Z';
const code = 'm20261018abcdef';
const grant = { status: 'group_verified', beforeGroups: ['paid'], afterGroups: ['paid', GROUP],
  existingGroupsPreserved: true, verifiedAt: start };
const member = { memberCode: code, uid: 'fixture-only', siteCode: 'S20260516852c71a014d08',
  unitCode: 'u2026051698c99ea234719', group: ['paid', GROUP, 'staff'], point: 3000, coupon: [] };
const entitlement = () => entitlementFromGrant(code, grant, Date.parse(start));

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

function fixture({ fail = false, unknown = false } = {}) {
  let live = structuredClone(member); let writes = 0; let saves = 0;
  const s = { accessPolicy: { id: POLICY_ID, approved: true, days: 40,
    basis: 'first_verified_grant', revocation: 'e_team_group_only' }, manualImmediateGrants: { [code]: grant },
    entitlements: { [code]: entitlement() }, untouched: { keep: true } };
  if (unknown) s.entitlements[code].revocation = { status: 'result_unknown' };
  const run = args => {
    if (args[0] === 'config') return { resolved_profile: { site_code: member.siteCode, unit_code: member.unitCode } };
    if (args[0] === 'order') return { data: { list: [], currentPage: 1, totalCount: 0, totalPage: 0 } };
    if (args[1] === 'list') return { data: { list: [structuredClone(live)], hasNext: false } };
    if (args[1] === 'get') return { data: structuredClone(live) };
    if (args[1] === 'groups') return { data: { list: live.group.includes(GROUP) ? [structuredClone(live)] : [] } };
    if (args.includes('--dry-run')) return { confirmation_token: 'fixture-only' };
    writes++; if (fail) throw Error('fixture transport failure');
    live.group = JSON.parse(args[args.indexOf('--data') + 1]).groupCodes; return { statusCode: 200 };
  };
  return { s, run, save: () => saves++, get writes() { return writes; }, get saves() { return saves; } };
}
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
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'run.lock'); fs.writeFileSync(file, 'fixture-owned');
    const script = path.resolve('scripts/e261017-access.mjs');
    const options = { encoding: 'utf8', env: { ...process.env, HOME: home } };
    const override = spawnSync(process.execPath, [script, '--now=2099-01-01'], options);
    assert.equal(override.status, 1); assert.match(override.stderr, /time override is forbidden/);
    const held = spawnSync(process.execPath, [script, '--apply'], options);
    assert.equal(held.status, 1); assert.match(held.stderr, /EEXIST/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'fixture-owned');
    fs.unlinkSync(file);
    const failed = spawnSync(process.execPath, [script], options);
    assert.equal(failed.status, 1); assert.equal(fs.existsSync(file), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
