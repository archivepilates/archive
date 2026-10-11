#!/usr/bin/env node
// Main runs this only after deployment and explicit approval of synthetic live QA.
// Required env: GOOGLE_APPLICATION_CREDENTIALS, CORE_QA_MANAGER_UID.
// Run: node scripts/verify-core-instructor-access-live.mjs --run-live
// Synthetic-only REST + Playwright QA; no members, bookings, sends, StudioMate,
// or manager mutations. Auth storage stays in memory; screenshots contain no secrets.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import vm from 'node:vm';
import { collectCoreAuthTokens } from './lib/core-auth-storage.mjs';
import { firestoreRestDenied } from './lib/firestore-rest-denial.mjs';

const PROJECT = 'archive-pilates';
const OPERATOR = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const CORE_ORIGIN = 'https://core.archivepilates.com';
const SCREENSHOTS = '/tmp/core-instructor-access-live';
const WIDTHS = [320, 390, 768, 1440];
const RAW_COLLECTIONS = [
  'staffs', 'staffHrCards', 'memberProfiles', 'memberContactIndex', 'members',
  'member360Cards', 'dashboardSnapshots', 'dashboardMonthlyMetrics',
  'ticketLiabilityReports', 'refundCases', 'privateSurveyRequests',
  'privateSurveyResponses', 'privateLessonChartRequests', 'privateLessonChartRecords',
  'privateLessonSessions', 'privateSessionLedger', 'alimtalkCandidates', 'alimtalkSends',
];
const report = { executionRequested: false, completed: false, interrupted: false, checks: {} };
const controller = new AbortController();

function verify(condition) {
  if (!condition) throw new Error('QA assertion failed');
}

async function check(name, operation) {
  report.checks[name] = false;
  await operation();
  report.checks[name] = true;
}

function fields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => {
    if (typeof value === 'string') return [key, { stringValue: value }];
    if (typeof value === 'boolean') return [key, { booleanValue: value }];
    if (Number.isSafeInteger(value)) return [key, { integerValue: String(value) }];
    throw new Error('Unsupported synthetic field');
  }));
}

async function jsonRequest(url, { token, body, method = body ? 'POST' : 'GET' } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
  });
  // Never print or include response/error bodies in assertions or thrown errors.
  const payload = await response.text();
  let parsed;
  try { parsed = JSON.parse(payload); } catch {
    report.transportFailure = { status: response.status, json: false };
    throw new Error('Non-JSON transport response');
  }
  return { status: response.status, body: parsed };
}

function callableDenied(response, allowUnauthenticated = false) {
  return response.status === 403 && response.body?.error?.status === 'PERMISSION_DENIED' ||
    allowUnauthenticated && response.status === 401 && response.body?.error?.status === 'UNAUTHENTICATED';
}

function firestoreDenied(response) {
  return firestoreRestDenied(response);
}

function callableResult(response) {
  verify(response.status === 200 && !response.body?.error);
  const result = response.body?.result ?? response.body?.data;
  verify(result && typeof result === 'object');
  return result;
}

async function waitForAuthCutoff(cutoff) {
  verify(Number.isSafeInteger(cutoff) && cutoff >= 0);
  // auth_time has whole-second precision. Wait to the persisted cutoff + one
  // full second, then assert the actual issued claim rather than retrying blindly.
  const target = (cutoff + 1) * 1000;
  verify(target - Date.now() <= 30_000);
  while (Date.now() < target) {
    await delay(target - Date.now(), undefined, { signal: controller.signal });
  }
}

function managerAuthState(user) {
  return {
    uid: user.uid, email: user.email, disabled: user.disabled,
    customClaims: user.customClaims, tokensValidAfterTime: user.tokensValidAfterTime,
  };
}

async function run() {
  let app, db, auth, managerBefore, managerRef, browser, loginPage, readyStorageState;
  const browserContexts = [];
  let uiPasswordChanges = 0, uiUnexpectedWrite = false;
  let authAttempted = false;
  const documentsToClean = new Map();
  const runId = randomUUID().replaceAll('-', '');
  const uid = `qa_core_instructor_${runId}`;
  const staffId = `qa_core_staff_${runId}`;
  const studioId = `qa_core_studio_${runId}`;
  const otherUid = `qa_core_other_${runId}`; // Ownership fixture, not another Auth account.
  const noteId = `qa_core_note_${runId}`;
  const crossNoteId = `qa_core_cross_${runId}`;
  // Login maps the numeric field to p<number>@archivepilates.com. 000 is not
  // a physical-phone prefix; this alias must never be stored as staff.phone.
  const loginAlias = `000${BigInt(`0x${randomBytes(8).toString('hex')}`).toString().padStart(20, '0')}`;
  const email = `p${loginAlias}@archivepilates.com`;
  const marker = `ARCHIVE CORE synthetic QA ${runId}`;
  const initialPassword = '111111';
  const newPassword = `QA!${randomBytes(24).toString('base64url')}`;
  const imageData = 'data:image/jpeg;base64,/9j/2Q==';
  const imageId = `${noteId}_${createHash('sha256').update(imageData).digest('hex')}`;
  const crossImageId = `${crossNoteId}_${createHash('sha256').update(imageData).digest('hex')}`;
  const onSignal = () => {
    report.interrupted = true;
    controller.abort();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    let config, serviceAccount, managerUid;
    await check('productionEnvironmentValidated', async () => {
      verify(process.argv.length === 3 && process.argv[2] === '--run-live');
      report.executionRequested = true;
      verify(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
      for (const key of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT']) {
        verify(!process.env[key] || process.env[key] === PROJECT);
      }
      verify(process.env.GOOGLE_APPLICATION_CREDENTIALS);
      managerUid = process.env.CORE_QA_MANAGER_UID;
      verify(typeof managerUid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(managerUid) &&
        !managerUid.startsWith('qa_core_'));
      const context = { window: {} };
      vm.runInNewContext(await readFile(new URL('../core/firebase-config.js', import.meta.url), 'utf8'),
        context, { timeout: 1000 });
      config = context.window.KANGSAIN_FIREBASE_CONFIG;
      verify(config?.projectId === PROJECT && config.functionsRegion === 'asia-northeast3' &&
        typeof config.apiKey === 'string' && config.apiKey.length > 0);
      serviceAccount = JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
      verify(serviceAccount.type === 'service_account' && serviceAccount.project_id === PROJECT &&
        serviceAccount.client_email === OPERATOR);
    });
    const require = createRequire(new URL('../firebase/kangsain-functions/functions/package.json', import.meta.url));
    const admin = require('firebase-admin');
    const browserRequire = createRequire(new URL('../package.json', import.meta.url));
    const { chromium } = browserRequire('playwright');
    const { parseEvaluationResultValue } = browserRequire(join(dirname(browserRequire.resolve('playwright-core')),
      'lib/utils/isomorphic/utilityScriptSerializers.js'));
    app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: PROJECT }, `core-qa-${runId}`);
    db = app.firestore();
    auth = app.auth();
    const timestamp = () => admin.firestore.Timestamp.now();
    const documentRoot = `projects/${PROJECT}/databases/(default)/documents`;
    const firestoreBase = `https://firestore.googleapis.com/v1/${documentRoot}`;
    const identityBase = 'https://identitytoolkit.googleapis.com/v1/accounts:';
    const functionBase = `https://${config.functionsRegion}-${PROJECT}.cloudfunctions.net/`;
    const call = (name, token, data = {}) => jsonRequest(`${functionBase}${name}`, { token, body: { data } });
    const get = (path, token) => jsonRequest(`${firestoreBase}/${path}`, { token });
    const commit = (writes, token) => jsonRequest(`${firestoreBase}:commit`, { token, body: { writes } });
    const identity = (method, body) => jsonRequest(`${identityBase}${method}?key=${encodeURIComponent(config.apiKey)}`, { body });
    const signIn = async password => {
      const response = await identity('signInWithPassword', { email, password, returnSecureToken: true });
      verify(response.status === 200 && response.body?.localId === uid && typeof response.body?.idToken === 'string');
      return response.body.idToken;
    };
    const verifyInstructorToken = async (token, cutoff) => {
      const claims = await auth.verifyIdToken(token);
      verify(claims.uid === uid && claims.aud === PROJECT && claims.role === 'instructor' &&
        claims.staffId === staffId && claims.studioId === studioId &&
        claims.firebase?.sign_in_provider === 'password' && Number.isSafeInteger(claims.auth_time) &&
        claims.auth_time >= cutoff);
      return claims;
    };
    const uiContext = async (width, storageState) => {
      const context = await browser.newContext({ viewport: { width, height: 1000 },
        ...(storageState ? { storageState } : {}), serviceWorkers: 'block' });
      browserContexts.push(context);
      context.setDefaultTimeout(30_000);
      context.setDefaultNavigationTimeout(45_000);
      // Inspect the real workspace response before releasing it to the DOM.
      // A scope regression must fail closed, never screenshot member content.
      await context.route(`${functionBase}getCoreInstructorWorkspace`, async route => {
        try {
          const response = await route.fetch({ timeout: 30_000 });
          const result = callableResult({ status: response.status(), body: await response.json() });
          verify(Array.isArray(result.lessons) && result.lessons.length === 0 &&
            Array.isArray(result.privateTasks) && result.privateTasks.length === 0);
          await route.fulfill({ response });
        } catch {
          uiUnexpectedWrite = true;
          await route.abort();
        }
      });
      // Passive sequence inspection must never become a write, even if a UI
      // regression starts an autosave. Do not collect request bodies or traces.
      await context.route('https://firestore.googleapis.com/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        if (/:(commit|batchWrite)$|\/Write\//.test(path) || ['PUT', 'PATCH', 'DELETE'].includes(request.method())) {
          uiUnexpectedWrite = true;
          await route.abort();
        } else await route.continue();
      });
      context.on('request', request => {
        if (new URL(request.url()).pathname.endsWith('/completeCoreFirstLogin') && request.method() === 'POST') {
          uiPasswordChanges += 1;
        }
      });
      return context;
    };
    const uiLogin = async (page, password) => {
      await page.getByLabel('휴대폰번호', { exact: true }).fill(loginAlias);
      await page.getByLabel('비밀번호', { exact: true }).fill(password);
      await page.getByRole('button', { name: '로그인', exact: true }).click();
    };
    const screenshot = async (page, label, width) => {
      verify(new URL(page.url()).origin === CORE_ORIGIN);
      await page.waitForFunction(() => document.fonts.status === 'loaded');
      verify(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      // Password fields are masked even when empty; no tokens or auth state
      // are written to disk. UUID filenames avoid clobbering concurrent QA.
      await page.screenshot({ path: `${SCREENSHOTS}/${runId}-${label}-${width}.png`, fullPage: true,
        mask: [page.getByLabel('비밀번호', { exact: true }),
          page.getByLabel('새 비밀번호', { exact: true }), page.getByLabel('새 비밀번호 확인', { exact: true })] });
    };
    const instructorShell = async page => {
      await page.getByRole('navigation', { name: '강사 메뉴', exact: true }).waitFor({ state: 'visible' });
      await page.getByRole('main', { name: '강사 업무', exact: true }).waitFor({ state: 'visible' });
      verify(await page.evaluate(() => {
        const root = document.getElementById('coreInstructorAccess');
        return root && [...document.body.children].every(element =>
          element === root || element.id === 'coreLoginGate' ||
          ['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName) ||
          (element.hidden && element.inert && getComputedStyle(element).display === 'none'));
      }));
    };
    const note = ownerUid => ({
      ownerUid, revision: 1, payload: JSON.stringify({ syntheticRun: runId, moves: [] }),
      title: marker, teacher: 'QA', equipment: 'Reformer', date: '', goal: 'Synthetic access check',
      moveCount: 0, deleted: false,
    });
    const noteWrite = (id, data, create = false) => ({
      update: { name: `${documentRoot}/sequenceNotes/${id}`, fields: fields(data) },
      currentDocument: { exists: !create },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    });
    const imageWrite = (id, parentId, ownerUid) => ({
      update: { name: `${documentRoot}/sequenceNoteImages/${id}`,
        fields: fields({ ownerUid, noteId: parentId, dataUrl: imageData }) },
      currentDocument: { exists: false },
    });
    const trackAbsentDocument = async (path, expected) => {
      verify(!(await db.doc(path).get()).exists);
      // Track before attempting a write: a timed-out request may have committed.
      documentsToClean.set(path, expected);
    };

    await check('managerSessionAllowedWithoutClaimMutation', async () => {
      report.managerStage = 'identity';
      const user = await auth.getUser(managerUid);
      verify(!user.disabled);
      const staffRows = await db.collection('staffs').where('uid', '==', managerUid).limit(2).get();
      verify(staffRows.size === 1);
      const document = staffRows.docs[0], staff = document.data();
      verify(staff.uid === managerUid && staff.active === true && ['owner', 'manager'].includes(staff.role));
      managerRef = document.ref;
      managerBefore = { auth: managerAuthState(user), staff };
      // No additional claims and never set/update/revoke the existing manager.
      const customToken = await auth.createCustomToken(managerUid);
      report.managerStage = 'sign_in';
      const login = await identity('signInWithCustomToken', { token: customToken, returnSecureToken: true });
      report.managerLogin = { status: login.status,
        hasToken: typeof login.body?.idToken === 'string', errorCode: login.body?.error?.code };
      // Custom-token sign-in does not return localId. The verified ID token
      // below is authoritative for the existing manager's UID and claims.
      verify(login.status === 200 && typeof login.body?.idToken === 'string');
      const managerToken = login.body.idToken;
      report.managerStage = 'verify_token';
      const claims = await auth.verifyIdToken(managerToken);
      report.managerStage = 'claims';
      verify(claims.uid === managerUid && claims.aud === PROJECT);
      for (const [key, value] of Object.entries(user.customClaims || {})) {
        verify(isDeepStrictEqual(claims[key], value));
      }
      report.managerStage = 'callable';
      const result = callableResult(await call('getCoreAccessSession', managerToken));
      report.managerStage = 'result';
      verify(result.role === 'manager' && result.staffId === staff.staffId && result.mustChangePassword === false);
      delete report.managerStage;
      delete report.managerLogin;
    });

    const staffRef = db.doc(`staffs/${staffId}`);
    let provisioningCutoff;
    await check('isolatedInstructorProvisionedWithoutPhone', async () => {
      try {
        await auth.getUser(uid);
        throw new Error('Synthetic Auth collision');
      } catch (error) {
        verify(error.code === 'auth/user-not-found');
      }
      await trackAbsentDocument(staffRef.path, { kind: 'staff' });
      authAttempted = true;
      await auth.createUser({ uid, email, password: initialPassword, displayName: marker });
      await auth.setCustomUserClaims(uid, { role: 'instructor', staffId, studioId });
      provisioningCutoff = Math.floor(Date.now() / 1000) + 1;
      await staffRef.create({
        staffId, uid, email, studioId, name: marker, role: 'instructor', active: true,
        studiomateStaffId: staffId, visibleLectureStaffNames: [], manualTest: true, qaRunId: runId,
        employmentStatus: 'current', employmentSource: 'studiomate_staff_tab_browser_scan',
        employmentSyncedAt: new Date().toISOString(), coreAccessEnabled: true,
        coreMustChangePassword: true, coreAuthAfter: provisioningCutoff,
        createdAt: timestamp(), updatedAt: timestamp(),
      });
      const staff = (await staffRef.get()).data();
      verify(staff?.qaRunId === runId && !Object.hasOwn(staff, 'phone') && !Object.hasOwn(staff, 'phoneLast4'));
    });

    let oldToken, oldClaims;
    await check('initialPasswordLoginAfterProvisioningCutoff', async () => {
      await waitForAuthCutoff(provisioningCutoff);
      oldToken = await signIn(initialPassword);
      oldClaims = await verifyInstructorToken(oldToken, provisioningCutoff);
    });
    await check('pendingSessionAllowed', async () => {
      const result = callableResult(await call('getCoreAccessSession', oldToken));
      verify(result.role === 'instructor' && result.staffId === staffId && result.mustChangePassword === true);
    });
    await check('pendingWorkspaceDenied', async () => {
      verify(callableDenied(await call('getCoreInstructorWorkspace', oldToken)));
    });
    await check('uiInitialLoginAndPasswordDialogFourViewports', async () => {
      await mkdir(SCREENSHOTS, { recursive: true, mode: 0o700 });
      browser = await chromium.launch({ headless: true });
      const context = await uiContext(WIDTHS[0]);
      loginPage = await context.newPage();
      await loginPage.goto(`${CORE_ORIGIN}/`);
      await uiLogin(loginPage, initialPassword);
      const dialog = loginPage.getByRole('dialog', { name: '새 비밀번호 설정', exact: true });
      await dialog.waitFor({ state: 'visible' });
      for (const width of WIDTHS) {
        await loginPage.setViewportSize({ width, height: 1000 });
        verify(await dialog.getByLabel('새 비밀번호', { exact: true }).isVisible() &&
          await dialog.getByLabel('새 비밀번호 확인', { exact: true }).isVisible() &&
          await dialog.getByRole('button', { name: '변경 후 다시 로그인', exact: true }).isVisible());
        verify(await loginPage.evaluate(() => {
          const root = document.getElementById('coreInstructorAccess');
          return root && root.querySelector('[role="dialog"]') &&
            [...document.body.children].every(element => element === root || element.id === 'coreLoginGate' ||
              ['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName) || element.hidden && element.inert);
        }));
        await screenshot(loginPage, 'first-password', width);
      }
      verify(uiPasswordChanges === 0);
    });
    await check('firstPasswordChangeViaUiExactlyOnceRequiresFreshLogin', async () => {
      const dialog = loginPage.getByRole('dialog', { name: '새 비밀번호 설정', exact: true });
      await dialog.getByLabel('새 비밀번호', { exact: true }).fill(newPassword);
      await dialog.getByLabel('새 비밀번호 확인', { exact: true }).fill(newPassword);
      const completed = loginPage.waitForResponse(response =>
        new URL(response.url()).pathname.endsWith('/completeCoreFirstLogin') && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: '변경 후 다시 로그인', exact: true }).click();
      const response = await completed;
      const payload = await response.json();
      report.firstChangeResponse = { status: response.status(), errorStatus: payload.error?.status,
        callCount: uiPasswordChanges,
        authPermissionMissing: /insufficient permission|permission.denied|not authorized/i.test(String(payload.error?.message || '')) };
      const result = callableResult({ status: response.status(), body: payload });
      verify(result.ok === true && result.requireFreshLogin === true && uiPasswordChanges === 1);
      await loginPage.getByRole('button', { name: '로그인', exact: true }).waitFor({ state: 'visible' });
      verify(!await dialog.isVisible());
      delete report.firstChangeResponse;
    });
    let cutoff;
    await check('persistedAuthCutoffRejectsOriginalToken', async () => {
      const staff = (await staffRef.get()).data();
      cutoff = staff?.coreAuthAfter;
      verify(staff?.qaRunId === runId && staff.coreMustChangePassword === false &&
        Number.isSafeInteger(cutoff) && cutoff > oldClaims.auth_time &&
        staff.corePasswordChangeLockUntil === 0 && !Object.hasOwn(staff, 'phone'));
    });
    await check('oldTokenWorkspaceDenied', async () => {
      verify(callableDenied(await call('getCoreInstructorWorkspace', oldToken), true));
    });
    await check('oldTokenSessionDenied', async () => {
      verify(callableDenied(await call('getCoreAccessSession', oldToken), true));
    });
    await check('oldPasswordDenied', async () => {
      const response = await identity('signInWithPassword', { email, password: initialPassword, returnSecureToken: true });
      verify(response.status === 400 && ['INVALID_PASSWORD', 'INVALID_LOGIN_CREDENTIALS'].includes(response.body?.error?.message));
    });
    let token;
    await check('newPasswordLoginAfterPersistedCutoff', async () => {
      await waitForAuthCutoff(cutoff);
      token = await signIn(newPassword);
      await verifyInstructorToken(token, cutoff);
    });
    await check('readySessionAllowed', async () => {
      const result = callableResult(await call('getCoreAccessSession', token));
      verify(result.role === 'instructor' && result.staffId === staffId && result.mustChangePassword === false);
    });
    await check('readyWorkspaceEmpty', async () => {
      const result = callableResult(await call('getCoreInstructorWorkspace', token));
      verify(Array.isArray(result.lessons) && result.lessons.length === 0 &&
        Array.isArray(result.privateTasks) && result.privateTasks.length === 0);
    });
    await check('uiFreshPasswordLoginAndInMemoryIndexedDbState', async () => {
      report.uiReadyStage = 'cutoff';
      await waitForAuthCutoff(cutoff);
      report.uiReadyStage = 'login';
      await uiLogin(loginPage, newPassword);
      report.uiReadyStage = 'shell';
      await instructorShell(loginPage);
      report.uiReadyStage = 'heading';
      await loginPage.getByRole('heading', { name: '오늘의 수업', exact: true }).waitFor({ state: 'visible' });
      report.uiReadyStage = 'empty_workspace';
      await loginPage.waitForFunction(() => document.querySelector('[data-core-instructor-content]')?.textContent
        .includes('오늘 예정된 수업이 없습니다.'));
      report.uiReadyStage = 'storage_state';
      readyStorageState = await loginPage.context().storageState({ indexedDB: true });
      // Validate the actual browser-issued token, not just the parallel REST login.
      const tokens = collectCoreAuthTokens(readyStorageState, {
        origin: CORE_ORIGIN, apiKey: config.apiKey, uid, decodeIndexedDB: parseEvaluationResultValue,
      });
      report.uiReadyTokenCount = tokens.size;
      report.uiReadyStage = 'browser_token';
      verify(tokens.size === 1);
      await verifyInstructorToken([...tokens][0], cutoff);
      delete report.uiReadyStage;
      delete report.uiReadyTokenCount;
    });
    for (const width of WIDTHS) {
      await check(`uiScopedRoutesAndSequenceFrame_${width}`, async () => {
        const context = await uiContext(width, readyStorageState);
        const page = await context.newPage();
        for (const [label, path, heading] of [
          ['home', '/', '오늘의 수업'],
          ['private', '/private/', '프라이빗 기록'],
          ['forbidden', '/business/', '접근할 수 없는 페이지'],
          ['sequence', '/sequence/', null],
        ]) {
          await page.goto(`${CORE_ORIGIN}${path}`);
          await instructorShell(page);
          if (heading) await page.getByRole('heading', { name: heading, exact: true }).waitFor({ state: 'visible' });
          if (label === 'home' || label === 'private') {
            const empty = label === 'home' ? '오늘 예정된 수업이 없습니다.' : '연결된 프라이빗 기록이 없습니다.';
            await page.waitForFunction(text => document.querySelector('[data-core-instructor-content]')?.textContent.includes(text), empty);
          }
          if (label === 'sequence') {
            await page.waitForFunction(expectedUid => {
              const frame = document.querySelector('[data-sequence-studio]');
              return window.archiveSequenceStore?.uid === expectedUid && frame?.dataset.authReady === 'true' &&
                !frame.hidden && frame.contentDocument?.readyState === 'complete' &&
                !!frame.contentDocument?.getElementById('survey');
            }, uid);
            verify(await page.evaluate(() => {
              const frame = document.querySelector('[data-sequence-studio]'), box = frame.getBoundingClientRect();
              return frame.contentWindow.location.origin === location.origin && box.width > 0 && box.height > 0 &&
                box.left >= 0 && box.right <= innerWidth + 1 &&
                frame.contentDocument.documentElement.scrollWidth <= frame.contentWindow.innerWidth + 1;
            }));
          }
          await screenshot(page, label, width);
        }
        await context.close();
      });
    }
    await check('uiExactlyOnePasswordChangeAndNoSequenceWrites', async () =>
      verify(uiPasswordChanges === 1 && !uiUnexpectedWrite));

    for (const collection of RAW_COLLECTIONS) {
      const path = `${collection}/${collection === 'staffs' ? staffId : `qa_probe_${runId}`}`;
      await check(`raw_${collection}_getDenied`, async () => verify(firestoreDenied(await get(path, token))));
      await check(`raw_${collection}_queryDenied`, async () => {
        // Exact synthetic document-name filter: even permissive rules cannot
        // return a real member, financial record, survey, or send to this harness.
        const response = await jsonRequest(`${firestoreBase}:runQuery`, { token, body: { structuredQuery: {
          from: [{ collectionId: collection }], limit: 1,
          where: { fieldFilter: { field: { fieldPath: '__name__' }, op: 'EQUAL',
            value: { referenceValue: `${documentRoot}/${path}` } } },
        } } });
        report.rawQueryDiagnostic = { collection, status: response.status,
          errorStatus: response.body?.error?.status,
          streamedErrorStatuses: Array.isArray(response.body) ? response.body.map(row => row?.error?.status).filter(Boolean) : [],
          hasDocument: Array.isArray(response.body) && response.body.some(row => row?.document) };
        verify(firestoreDenied(response));
        delete report.rawQueryDiagnostic;
      });
    }

    await check('ownSequenceAndImageCreatedViaIdToken', async () => {
      await trackAbsentDocument(`sequenceNotes/${noteId}`, { kind: 'note', ownerUid: uid });
      await trackAbsentDocument(`sequenceNoteImages/${imageId}`, { kind: 'image', ownerUid: uid, noteId });
      const response = await commit([noteWrite(noteId, note(uid), true), imageWrite(imageId, noteId, uid)], token);
      verify(response.status === 200 && Array.isArray(response.body?.writeResults) && response.body.writeResults.length === 2);
    });
    await check('ownSequenceAndImageReadable', async () => {
      const sequence = await get(`sequenceNotes/${noteId}`, token);
      const image = await get(`sequenceNoteImages/${imageId}`, token);
      verify(sequence.status === 200 && sequence.body?.fields?.ownerUid?.stringValue === uid &&
        sequence.body.fields.title?.stringValue === marker && sequence.body.fields.deleted?.booleanValue === false &&
        image.status === 200 && image.body?.fields?.ownerUid?.stringValue === uid &&
        image.body.fields.noteId?.stringValue === noteId);
    });
    await check('crossUidFixturesIsolated', async () => {
      await trackAbsentDocument(`sequenceNotes/${crossNoteId}`, { kind: 'note', ownerUid: otherUid });
      await trackAbsentDocument(`sequenceNoteImages/${crossImageId}`, { kind: 'image', ownerUid: otherUid, noteId: crossNoteId });
      await db.doc(`sequenceNotes/${crossNoteId}`).create({ ...note(otherUid), updatedAt: timestamp() });
      await db.doc(`sequenceNoteImages/${crossImageId}`).create({ ownerUid: otherUid, noteId: crossNoteId, dataUrl: imageData });
    });
    await check('crossUidSequenceReadDenied', async () => verify(firestoreDenied(await get(`sequenceNotes/${crossNoteId}`, token))));
    await check('crossUidImageReadDenied', async () => verify(firestoreDenied(await get(`sequenceNoteImages/${crossImageId}`, token))));
    await check('crossUidSequenceWriteDenied', async () => {
      verify(firestoreDenied(await commit([noteWrite(crossNoteId, { ...note(otherUid), revision: 2, deleted: true })], token)));
    });
    await check('ownSequencePhysicalDeleteDenied', async () => {
      verify(firestoreDenied(await commit([{ delete: `${documentRoot}/sequenceNotes/${noteId}` }], token)));
    });
    await check('ownSequenceTombstoneAndImageDeleteAllowed', async () => {
      const response = await commit([
        noteWrite(noteId, { ...note(uid), revision: 2, deleted: true }),
        { delete: `${documentRoot}/sequenceNoteImages/${imageId}` },
      ], token);
      verify(response.status === 200 && Array.isArray(response.body?.writeResults) && response.body.writeResults.length === 2);
      const sequence = await get(`sequenceNotes/${noteId}`, token);
      const image = await get(`sequenceNoteImages/${imageId}`, token);
      verify(sequence.status === 200 && sequence.body?.fields?.deleted?.booleanValue === true &&
        sequence.body.fields.revision?.integerValue === '2' && image.status === 404 &&
        image.body?.error?.status === 'NOT_FOUND');
    });
    await check('ownTombstoneCannotBeRestored', async () => {
      verify(firestoreDenied(await commit([noteWrite(noteId, { ...note(uid), revision: 3 })], token)));
    });
    await check('inactiveEmploymentWorkspaceDenied', async () => {
      const staff = (await staffRef.get()).data();
      verify(staff?.qaRunId === runId && staff.uid === uid);
      await staffRef.update({ employmentStatus: 'inactive', updatedAt: timestamp() });
      verify(callableDenied(await call('getCoreInstructorWorkspace', token)));
    });
    await check('inactiveEmploymentSequenceDenied', async () => verify(firestoreDenied(await get(`sequenceNotes/${noteId}`, token))));
    await check('syntheticContactQueueAbsent', async () => {
      const staff = (await staffRef.get()).data();
      verify(staff?.qaRunId === runId && !Object.hasOwn(staff, 'phone') && !Object.hasOwn(staff, 'phoneLast4'));
      // The staff contact trigger returns before writing when phone is absent.
      verify(!(await db.doc(`memberContactIndex/staff_${staffId}`).get()).exists);
      verify((await db.collection('contactSyncJobs').where('memberId', '==', `staff_${staffId}`).limit(1).get()).empty);
    });
    report.completed = true;
  } finally {
    // Close browser-owned state before deleting the synthetic identity. No
    // persistent profile, trace, HAR, or storage-state file is ever created.
    await check('cleanup_browserContexts', async () => {
      let closed = true;
      for (const context of browserContexts) {
        try { await context.close(); } catch { closed = false; }
      }
      verify(closed);
    }).catch(() => {});
    if (browser) await check('cleanup_browser', () => browser.close()).catch(() => {});
    readyStorageState = undefined;
    // Independent cleanup attempts: one failed removal must not skip the rest.
    // No date/prefix sweeps, recursive deletes, or deletion of manager resources.
    if (db) {
      for (const kind of ['image', 'note', 'staff']) {
        await check(`cleanup_${kind}`, async () => {
          let clean = true;
          for (const [path, expected] of documentsToClean) {
            if (expected.kind !== kind) continue;
            try {
              const ref = db.doc(path), snapshot = await ref.get();
              if (snapshot.exists) {
                const data = snapshot.data();
                verify(kind === 'staff'
                  ? data.qaRunId === runId && data.uid === uid && data.staffId === staffId && data.studioId === studioId
                  : kind === 'note'
                    ? data.ownerUid === expected.ownerUid && data.title === marker
                    : data.ownerUid === expected.ownerUid && data.noteId === expected.noteId && data.dataUrl === imageData);
                await ref.delete({ lastUpdateTime: snapshot.updateTime });
              }
              verify(!(await ref.get()).exists);
            } catch { clean = false; }
          }
          verify(clean);
        }).catch(() => {});
      }
    }
    if (auth && authAttempted) {
      await check('cleanup_auth', async () => {
        try {
          const user = await auth.getUser(uid);
          verify(user.uid === uid && user.email === email && user.displayName === marker);
          await auth.deleteUser(uid);
        } catch (error) {
          verify(error.code === 'auth/user-not-found');
        }
        try {
          await auth.getUser(uid);
          throw new Error('Synthetic Auth remains');
        } catch (error) { verify(error.code === 'auth/user-not-found'); }
      }).catch(() => {});
    }
    if (managerBefore) {
      await check('managerDocumentAndAuthClaimsPreserved', async () => {
        verify(isDeepStrictEqual((await managerRef.get()).data(), managerBefore.staff));
        verify(isDeepStrictEqual(managerAuthState(await auth.getUser(managerBefore.auth.uid)), managerBefore.auth));
      }).catch(() => {});
    }
    if (app) await check('adminAppClosed', () => app.delete()).catch(() => {});
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

// Swallow raw SDK/REST exceptions; only fixed check labels and booleans leave the process.
try { await run(); } catch { report.completed = false; }
const cleanupChecks = Object.entries(report.checks).filter(([name]) => name.startsWith('cleanup_') || name === 'adminAppClosed');
report.cleanupComplete = cleanupChecks.length > 0 && cleanupChecks.every(([, passed]) => passed);
report.ok = report.completed && !report.interrupted && Object.values(report.checks).every(Boolean);
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exitCode = report.ok ? 0 : 1;
