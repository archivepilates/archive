#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
assert.ok(args.includes('--live-read-only'), 'Explicit --live-read-only required');
const ids = args.filter(arg => arg.startsWith('--candidate-id=')).map(arg => arg.slice(15));
if (!ids.length) ids.push('validation_readonly_absent_20261016');
assert.ok(ids.length <= 10 && ids.every(id => /^[A-Za-z0-9_-]{1,160}$/.test(id)));
const root = new URL('../', import.meta.url);
const backend = createRequire(new URL('firebase/kangsain-functions/functions/package.json', root));
const mcp = createRequire(new URL('services/archivepilates-mcp/package.json', root));
const { Client } = await import(pathToFileURL(mcp.resolve('@modelcontextprotocol/sdk/client/index.js')));
const { StdioClientTransport } = await import(pathToFileURL(mcp.resolve('@modelcontextprotocol/sdk/client/stdio.js')));
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(homedir(), 'ArchiveIN/secrets/google/archive-codex-operator.json');
process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
const admin = backend('firebase-admin/app');
const { getFirestore } = backend('firebase-admin/firestore');
const key = JSON.parse(await readFile(credentialPath, 'utf8'));
assert.equal(key.project_id, 'archive-pilates');
assert.equal(key.client_email, 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com');
const app = admin.initializeApp({ credential: admin.cert(key), projectId: 'archive-pilates' }, 'target-validation-audit');
const db = getFirestore(app);
const directory = await mkdtemp(path.join(tmpdir(), 'alimtalk-validation-mcp-'));
const client = new Client({ name: 'archive-target-validation-audit', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('services/archivepilates-mcp/src/index.mjs', root))], stderr: 'pipe',
  env: { ...process.env, ARCHIVE_MCP_OPERATOR_STAFF_ID: '1979746', ARCHIVE_MCP_STATE_DIR: directory,
    ARCHIVE_MCP_READ_ONLY: 'true', ARCHIVE_MCP_ENABLE_MEMO_WRITES: 'false' } });
const report = { mode: 'live_read_only', checkedAt: new Date().toISOString(), checks: [],
  messagesSent: false, browserOpened: false, memberDataWritten: false };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const snapshot = async () => {
  const docs = await db.getAll(...ids.flatMap(id => [db.doc(`alimtalkCandidates/${id}`), db.doc(`alimtalkSends/${id}`)]));
  return digest(docs.map(doc => ({ path: doc.ref.path, exists: doc.exists, data: doc.data() || null })));
};
try {
  const before = await snapshot();
  const mcpStatuses = [];
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 9);
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint));
  assert.ok(tools.some(tool => tool.name === 'messages_validate_target'));
  for (const id of ids) {
    const start = performance.now();
    const result = await client.callTool({ name: 'messages_validate_target', arguments: { candidateId: id } }, undefined, { timeout: 60000 });
    assert.ok(!result.isError);
    const value = result.structuredContent;
    assert.equal(value.allowedForExternalActions, false);
    assert.equal(value.liveReadback, false);
    mcpStatuses.push(value.results[0].status);
    report.checks.push({ surface: 'fresh_stdio_mcp', candidateHash: digest(id).slice(0, 12),
      status: value.results[0].status, stages: value.results[0].checks, elapsedMs: Math.round(performance.now() - start) });
  }
  if (args.includes('--live-callable')) {
    const url = 'https://asia-northeast3-archive-pilates.cloudfunctions.net/getAlimtalkTargetValidation';
    const call = async (data, token) => {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ data }), signal: AbortSignal.timeout(60000) });
      return { status: response.status, body: await response.json() };
    };
    const denied = await call({ candidateIds: [ids[0]] });
    assert.equal(denied.status, 401); assert.equal(denied.body.error.status, 'UNAUTHENTICATED');
    report.checks.push({ surface: 'live_callable_unauthenticated', status: 'denied_401' });
    if (args.includes('--operator-auth')) {
      // Existing owner only: no account creation, password update or persisted token file.
      const staff = (await db.doc('staffs/1979746').get()).data();
      assert.ok(staff?.active && ['owner', 'manager'].includes(staff.role) && staff.studioId === '5330' && staff.uid);
      const { getAuth } = backend('firebase-admin/auth');
      const auth = getAuth(app);
      await auth.getUser(staff.uid);
      const customToken = await auth.createCustomToken(staff.uid);
      const config = await readFile(new URL('core/firebase-config.js', root), 'utf8');
      const apiKey = config.match(/apiKey:\s*"([^"]+)"/)[1];
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }), signal: AbortSignal.timeout(30000) });
      const session = await response.json();
      assert.ok(response.ok && session.idToken);
      const verified = await auth.verifyIdToken(session.idToken);
      assert.equal(verified.uid, staff.uid);
      const value = await call({ candidateIds: ids }, session.idToken);
      assert.equal(value.status, 200); assert.equal(value.body.result.readOnly, true);
      assert.equal(value.body.result.allowedForExternalActions, false);
      assert.equal(value.body.result.results.length, ids.length);
      assert.deepEqual(value.body.result.results.map(row => row.status), mcpStatuses);
      const invalid = await call({ candidateIds: ['../invalid'] }, session.idToken);
      assert.equal(invalid.status, 400); assert.equal(invalid.body.error.status, 'INVALID_ARGUMENT');
      report.checks.push({ surface: 'live_callable_existing_operator', statuses: value.body.result.results.map(row => row.status),
        malformedIdRejected: true, credentialChanges: false, tokensPersisted: false });
    }
  }
  assert.equal(await snapshot(), before, 'Candidate/send records changed during read-only validation; investigate before claiming no-write proof.');
  report.candidateAndSendRecordsUnchanged = true;
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} finally {
  await client.close(); await transport.close();
  await admin.deleteApp(app);
  await rm(directory, { recursive: true, force: true });
}
