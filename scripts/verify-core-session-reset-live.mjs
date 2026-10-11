#!/usr/bin/env node
// Explicit synthetic live QA. No real account, member, booking or note mutation.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import vm from 'node:vm';

assert(process.argv.includes('--run-live'), 'Explicit live verification required');
const require = createRequire(new URL('../firebase/kangsain-functions/functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const credentials = JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
assert.equal(credentials.client_email, 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com');
assert.equal(credentials.project_id, 'archive-pilates');
const configContext = { window: {} };
vm.runInNewContext(await readFile(new URL('../core/firebase-config.js', import.meta.url), 'utf8'), configContext);
const config = configContext.window.KANGSAIN_FIREBASE_CONFIG;
assert(config?.apiKey && config.projectId === 'archive-pilates', 'Wrong QA project');
const app = admin.initializeApp({ projectId: 'archive-pilates', credential: admin.credential.cert(credentials) });
const auth = app.auth(), db = app.firestore(), resources = [], checks = [];
async function request(url, token, data) {
  const response = await fetch(url, { method: data ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(30_000) });
  return { status: response.status, body: await response.json() };
}
const call = (name, token) => request(`https://asia-northeast3-archive-pilates.cloudfunctions.net/${name}`, token, { data: {} });
const getNote = (uid, token) => request(`https://firestore.googleapis.com/v1/projects/archive-pilates/databases/(default)/documents/sequenceNotes/${uid}`, token);
try {
  for (const role of ['manager', 'instructor']) {
    const id = `core_session_qa_${randomUUID().replaceAll('-', '')}`, email = `${id}@example.invalid`;
    const password = randomBytes(24).toString('base64url');
    resources.push({ id, auth: false, staff: false });
    const resource = resources.at(-1);
    await auth.createUser({ uid: id, email, password }); resource.auth = true;
    await auth.setCustomUserClaims(id, { role, staffId: id, studioId: 'core-session-isolated-qa' });
    const staff = { uid: id, staffId: id, studioId: 'core-session-isolated-qa', name: 'CORE Session QA', email,
      role, active: true, employmentStatus: 'current', employmentSource: 'studiomate_staff_tab_browser_scan',
      coreAccessEnabled: true, coreMustChangePassword: false, coreAuthAfter: Math.floor(Date.now() / 1000) - 1,
      createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() };
    await db.doc(`staffs/${id}`).create(staff); resource.staff = true;
    const signIn = async () => {
      const login = await request(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.apiKey}`, null,
        { email, password, returnSecureToken: true });
      assert.equal(login.status, 200, 'Synthetic sign-in failed');
      assert(login.body.idToken, 'Synthetic token missing');
      return login.body.idToken;
    };
    const oldToken = await signIn();
    assert.equal((await call('getCoreAccessSession', oldToken)).status, 200, 'Before-reset access failed');
    assert.equal((await getNote(id, oldToken)).status, 404, 'Before-reset rules failed');
    const cutoff = Math.floor(Date.now() / 1000) + 1;
    await db.doc(`staffs/${id}`).update({ coreAuthAfter: cutoff });
    await auth.revokeRefreshTokens(id);
    for (const name of ['getCoreAccessSession', 'getCoreInstructorWorkspace']) {
      assert.equal((await call(name, oldToken)).body?.error?.status, 'UNAUTHENTICATED', 'Old callable token was accepted');
    }
    assert.equal((await getNote(id, oldToken)).status, 403, 'Old Firestore token was accepted');
    await delay(Math.max(0, (cutoff + 1) * 1000 - Date.now()));
    const newToken = await signIn(), claims = await auth.verifyIdToken(newToken, true);
    assert(claims.auth_time >= cutoff, 'Fresh authentication not established');
    assert.equal((await call('getCoreAccessSession', newToken)).status, 200, 'Fresh session denied');
    assert.equal((await getNote(id, newToken)).status, 404, 'Fresh rules denied');
    assert.equal((await call('getCoreInstructorWorkspace', newToken)).status, role === 'instructor' ? 200 : 403,
      'Shared guard or role boundary changed');
    checks.push({ role, oldSessionBlocked: true, freshLoginAllowed: true, passwordPreserved: true });
  }
} finally {
  for (const resource of resources.reverse()) {
    if (resource.staff) await db.doc(`staffs/${resource.id}`).delete();
    if (resource.auth) await auth.deleteUser(resource.id);
    assert(!(await db.doc(`staffs/${resource.id}`).get()).exists, 'Synthetic staff cleanup failed');
    await assert.rejects(auth.getUser(resource.id), { code: 'auth/user-not-found' });
  }
  await app.delete();
}
console.log(JSON.stringify({ checks, cleanup: 'complete', realMemberWrites: 0 }));
