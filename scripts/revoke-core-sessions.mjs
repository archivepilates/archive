#!/usr/bin/env node
// One-time operator action; passwords, roles and content are never changed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';

const require = createRequire(new URL('../firebase/kangsain-functions/functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const ids = ['1979746', 'operator_01029244425', '1983525', '2222464', '2849322', '4817346'];
const apply = process.argv.includes('--apply');
assert(!apply || process.argv.includes('--approved-core-session-reset=20261011'), 'Explicit approved operation required');
const credential = JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
assert.equal(credential.project_id, 'archive-pilates');
assert.equal(credential.client_email, 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com');
const app = admin.initializeApp({ projectId: 'archive-pilates', credential: admin.credential.cert(credential) });
const db = app.firestore(), auth = app.auth(), results = [];
try {
  const targets = [];
  for (const id of ids) {
    const ref = db.doc(`staffs/${id}`), staff = (await ref.get()).data();
    assert(staff?.active === true && typeof staff.uid === 'string', `Missing or inactive target ${id}`);
    assert(['owner', 'manager'].includes(staff.role) || staff.role === 'instructor' &&
      staff.coreAccessEnabled === true && staff.employmentStatus === 'current' &&
      staff.employmentSource === 'studiomate_staff_tab_browser_scan', `Ineligible target ${id}`);
    const user = await auth.getUser(staff.uid);
    if (id === '1979746') assert.equal(user.email, 'p01086488585@archivepilates.com', 'Owner rules binding changed');
    if (id === 'operator_01029244425') assert.equal(user.email, 'p01029244425@archivepilates.com', 'Manager rules binding changed');
    assert(!user.disabled && user.customClaims?.staffId === id && user.customClaims?.role === staff.role &&
      user.customClaims?.studioId === staff.studioId, `Identity mismatch ${id}`);
    targets.push({ id, ref, staff, user });
  }
  const cutoff = Math.floor(Date.now() / 1000) + 1;
  if (apply) await db.runTransaction(async tx => {
    const current = await tx.getAll(...targets.map(t => t.ref));
    for (let i = 0; i < targets.length; i++) {
      assert(isDeepStrictEqual(current[i].data(), targets[i].staff), 'Staff changed during preflight');
      assert(Number(targets[i].staff.corePasswordChangeLockUntil || 0) <= Date.now(), 'Password change in progress');
      tx.update(targets[i].ref, {
        coreAuthAfter: Math.max(cutoff, Number(targets[i].staff.coreAuthAfter || 0)),
        coreSessionResetAt: admin.firestore.Timestamp.now(), coreSessionResetReason: 'operator_requested_20261011',
      });
    }
  });
  for (const target of targets) {
    if (apply) {
      await auth.revokeRefreshTokens(target.user.uid);
      const user = await auth.getUser(target.user.uid), staff = (await target.ref.get()).data();
      assert(isDeepStrictEqual(staff, { ...target.staff,
        coreAuthAfter: Math.max(cutoff, Number(target.staff.coreAuthAfter || 0)),
        coreSessionResetAt: staff.coreSessionResetAt, coreSessionResetReason: 'operator_requested_20261011' }), 'Unexpected staff mutation');
      assert(isDeepStrictEqual(user.customClaims, target.user.customClaims), 'Claims changed');
      assert.equal(user.email, target.user.email);
      assert.equal(user.disabled, target.user.disabled);
      assert(Date.parse(user.tokensValidAfterTime) >= (cutoff - 1) * 1000, 'Revocation not persisted');
    }
    results.push({ staffId: target.id, role: target.staff.role, cutoff: apply ? cutoff : null, revoked: apply });
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', count: results.length, results }));
} catch (error) {
  console.error(JSON.stringify({ failed: true, completed: results, message: error.message }));
  process.exitCode = 1;
} finally {
  await app.delete();
}
