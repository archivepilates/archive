#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
assert.ok(args.includes('--live-read-only'));
const operationId = args.find(arg => arg.startsWith('--operation-id='))?.slice(15);
assert.match(operationId || '', /^holding_operator_notice_[a-f0-9]{64}$/);
const root = new URL('../', import.meta.url);
const backend = createRequire(new URL('firebase/kangsain-functions/functions/package.json', root));
const mcp = createRequire(new URL('services/archivepilates-mcp/package.json', root));
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
assert.ok(credentialPath);
const key = JSON.parse(await readFile(credentialPath, 'utf8'));
assert.equal(key.project_id, 'archive-pilates');
assert.equal(key.client_email, 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com');
const { Client } = await import(pathToFileURL(mcp.resolve('@modelcontextprotocol/sdk/client/index.js')));
const { StdioClientTransport } = await import(pathToFileURL(mcp.resolve('@modelcontextprotocol/sdk/client/stdio.js')));
const admin = backend('firebase-admin/app');
const { getFirestore } = backend('firebase-admin/firestore');
const app = admin.initializeApp({ credential: admin.cert(key), projectId: 'archive-pilates' }, 'member-operation-verification');
const db = getFirestore(app);
const directory = await mkdtemp(path.join(tmpdir(), 'member-operation-mcp-'));
const client = new Client({ name: 'archive-member-operation-verification', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('services/archivepilates-mcp/src/index.mjs', root))], stderr: 'pipe',
  env: { ...process.env, ARCHIVE_MCP_OPERATOR_STAFF_ID: '1979746', ARCHIVE_MCP_STATE_DIR: directory,
    ARCHIVE_MCP_READ_ONLY: 'true', ARCHIVE_MCP_ENABLE_MEMO_WRITES: 'false' } });
const memoId = operationId.replace('holding_operator_notice_', 'holding_notice_memo_');
const refs = ['holdingNoticeEvents', 'alimtalkCandidates', 'alimtalkSends', 'holdingNoticeClaims', 'memberMemos', 'studiomateMemoWriteJobs']
  .map((collection, index) => db.doc(`${collection}/${index < 4 ? operationId : memoId}`));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const snapshot = async () => digest((await db.getAll(...refs)).map(doc => ({ path: doc.ref.path, data: doc.data() ?? null })));
const report = { checkedAt: new Date().toISOString(), mode: 'live_read_only', checks: [], browserOpened: false, providerCalls: 0 };
try {
  const before = await snapshot();
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 9);
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint));
  const input = { kind: 'holding', operationId };
  const started = performance.now();
  const response = await client.callTool({ name: 'operations_get_progress', arguments: input }, undefined, { timeout: 60000 });
  assert.ok(!response.isError);
  const value = response.structuredContent;
  assert.equal(value.readOnly, true); assert.equal(value.allowedForExternalActions, false); assert.equal(value.liveReadback, false);
  assert.equal(value.operationId, operationId); assert.equal(value.stages.length, 6);
  assert.ok(!/memberPhone|memberName|contentHash|"content":/.test(JSON.stringify(value)));
  report.checks.push({ surface: 'fresh_stdio_mcp', toolCount: tools.length, status: value.status,
    stages: value.stages, elapsedMs: Math.round(performance.now() - started) });
  if (args.includes('--live-callable')) {
    const call = async (data, token) => {
      const r = await fetch('https://asia-northeast3-archive-pilates.cloudfunctions.net/getMemberOperationProgress', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ data }), signal: AbortSignal.timeout(60000) });
      return { status: r.status, data: await r.json() };
    };
    assert.equal((await call(input)).status, 401);
    report.checks.push({ surface: 'callable_unauthenticated', status: 'denied_401' });
    const staff = (await db.doc('staffs/1979746').get()).data();
    assert.ok(staff?.active && ['owner', 'manager'].includes(staff.role) && staff.studioId === '5330' && staff.uid);
    const auth = backend('firebase-admin/auth').getAuth(app);
    const customToken = await auth.createCustomToken(staff.uid);
    const config = await readFile(new URL('core/firebase-config.js', root), 'utf8');
    const apiKey = config.match(/apiKey:\s*"([^"]+)"/)[1];
    const signedIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }), signal: AbortSignal.timeout(30000) });
    const session = await signedIn.json();
    assert.ok(signedIn.ok && session.idToken);
    assert.equal((await auth.verifyIdToken(session.idToken)).uid, staff.uid);
    const checked = await call(input, session.idToken);
    assert.equal(checked.status, 200);
    assert.deepEqual(checked.data.result.stages, value.stages);
    assert.equal(checked.data.result.allowedForExternalActions, false);
    assert.equal((await call({ kind: 'holding', operationId: '../invalid' }, session.idToken)).status, 400);
    report.checks.push({ surface: 'callable_existing_owner', status: checked.data.result.status,
      malformedIdRejected: true, accountRolePasswordChanges: false, tokensPersisted: false });
  }
  assert.equal(await snapshot(), before, 'Canonical source changed during verification; inspect before claiming no-write proof.');
  console.log(JSON.stringify({ ok: true, ...report, canonicalRecordsUnchanged: true }, null, 2));
} finally {
  await client.close(); await transport.close(); await admin.deleteApp(app);
  await rm(directory, { recursive: true, force: true });
}
