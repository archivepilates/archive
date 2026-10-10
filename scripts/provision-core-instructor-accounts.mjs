#!/usr/bin/env node
import assert from 'node:assert/strict';
import admin from '../firebase/kangsain-functions/functions/node_modules/firebase-admin/lib/index.js';

const apply = process.argv.includes('--apply');
const initialPassword = process.env.CORE_INSTRUCTOR_INITIAL_PASSWORD;
if (apply) assert(typeof initialPassword === 'string' && initialPassword.length >= 6, 'Initial password environment required');
const selected = (process.argv.find(arg => arg.startsWith('--staff-ids=')) || '').slice(12).split(',').filter(Boolean);
assert(selected.length > 0 && selected.every(id => /^\d+$/.test(id)), 'Explicit canonical staff IDs required');
assert(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'Operator service-account environment required');
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'archive-pilates' });
const db = admin.firestore(), auth = admin.auth();
try {
  const snapshot = await db.collection('staffs').get();
  const all = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
  const plans = [];
  const managerBefore = all.filter(s => ['owner', 'manager'].includes(s.role));
  const managerAuthBefore = await Promise.all(managerBefore.filter(s => s.uid).map(async s => {
    const user = await auth.getUser(s.uid);
    return { uid: user.uid, email: user.email, disabled: user.disabled, claims: user.customClaims,
      tokensValidAfterTime: user.tokensValidAfterTime };
  }));
  for (const id of selected) {
    const staff = all.find(s => s.id === id);
    assert(staff && staff.staffId === id && staff.studiomateStaffId === id && staff.studioId === '5330', 'Canonical staff mismatch');
    assert(staff.role === 'instructor' && staff.active === true && staff.employmentStatus === 'current' &&
      staff.employmentSource === 'studiomate_staff_tab_browser_scan', 'Only current instructors can be provisioned');
    const age = Date.now() - Date.parse(staff.employmentSyncedAt);
    assert(Number.isFinite(age) && age >= -60000 && age < 48 * 3600000, 'Current full staff scan required');
    assert(/^010\d{8}$/.test(staff.phone), 'Complete staff phone required');
    assert(all.filter(s => s.phone === staff.phone).length === 1, 'Ambiguous staff phone');
    if (staff.coreAccessEnabled === true) { plans.push({ staff, skip: true }); continue; }
    const email = `p${staff.phone}@archivepilates.com`;
    let user;
    try { user = await auth.getUserByEmail(email); } catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
    assert(!user || (!staff.uid || staff.uid === user.uid) && user.customClaims?.staffId === id &&
      user.customClaims?.studioId === staff.studioId && user.customClaims?.role === 'instructor', 'Existing Auth identity mismatch');
    assert(!staff.uid || all.filter(s => s.uid === staff.uid).length === 1, 'Ambiguous staff UID');
    plans.push({ staff, email, user });
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', plans: plans.map(p => ({ staffId: p.staff.id,
    name: p.staff.name, phoneLast4: p.staff.phone.slice(-4), action: p.skip ? 'already_provisioned_no_reset' : p.user ? 'enroll_existing_uid' : 'create_instructor_uid' })) }));
  if (apply) {
    for (const plan of plans.filter(p => !p.skip)) {
      const { staff, email } = plan;
      const user = plan.user || await auth.createUser({ uid: `core_staff_${staff.id}`, email, password: initialPassword, displayName: staff.name });
      if (plan.user) await auth.updateUser(user.uid, { password: initialPassword });
      await auth.setCustomUserClaims(user.uid, { ...user.customClaims, role: 'instructor', staffId: staff.id, studioId: staff.studioId });
      await auth.revokeRefreshTokens(user.uid);
      await db.doc(`staffs/${staff.id}`).update({ uid: user.uid, email, coreAccessEnabled: true, coreMustChangePassword: true,
        coreAuthAfter: Math.floor(Date.now() / 1000) + 1, coreAccountProvisionedAt: admin.firestore.Timestamp.now(),
        coreAccessPolicy: 'studio_current_instructor_20261011' });
    }
    for (const before of managerBefore) {
      const after = (await db.doc(`staffs/${before.id}`).get()).data();
      assert.deepEqual(after, Object.fromEntries(Object.entries(before).filter(([key]) => key !== 'id')), 'Manager document changed');
    }
    for (const before of managerAuthBefore) {
      const user = await auth.getUser(before.uid);
      assert.deepEqual({ uid: user.uid, email: user.email, disabled: user.disabled, claims: user.customClaims,
        tokensValidAfterTime: user.tokensValidAfterTime }, before, 'Manager authentication changed');
    }
    const ready = await Promise.all(selected.map(id => db.doc(`staffs/${id}`).get()));
    console.log(JSON.stringify({ ok: true, verified: ready.map(d => ({ staffId: d.id, enabled: d.data().coreAccessEnabled,
      mustChangePassword: d.data().coreMustChangePassword, preservedUid: plans.find(p => p.staff.id === d.id).staff.uid
        ? d.data().uid === plans.find(p => p.staff.id === d.id).staff.uid : true })) }));
  }
} finally { await admin.app().delete(); }
