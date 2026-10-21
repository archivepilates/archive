import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash, createHmac, randomBytes } from 'node:crypto';

const require = createRequire(new URL('../firebase/kangsain-functions/functions/package.json', import.meta.url));
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const args = process.argv.slice(2);
if (args.length !== 1 || !['--enable-approved-probe', '--disable-probe', '--enable-verified-shadow',
  '--enable-approved-oauth-window', '--disable-oauth-window', '--inspect'].includes(args[0]))
  throw Error('Choose exactly one supported probe action');
const key = JSON.parse(fs.readFileSync('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json', 'utf8'));
if (key.project_id !== 'archive-pilates' || key.client_email !== 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com')
  throw Error('Wrong service account');
const app = initializeApp({ credential: cert(key), projectId: 'archive-pilates' });
const db = getFirestore(app);
const lane = 'workLanes/imweb-app-webhook-onboarding';
const ref = db.doc(`${lane}/private/config`);
const dir = path.join(os.homedir(), 'Library/Application Support/ARCHIVE PILATES/imweb-app-onboarding');
const privateFile = path.join(dir, 'probe-session.json');
if (args[0] === '--enable-approved-probe') {
  const now = Date.now();
  const token = randomBytes(32).toString('hex');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077))
    throw Error('Unsafe private directory');
  const config = { mode: 'probe', probeTokenHash: createHash('sha256').update(token).digest('hex'),
    probeEnabledAtMs: now, probeExpiresAtMs: now + 20 * 60_000, grantsAllowed: false, updatedAt: Timestamp.now() };
  await ref.set(config);
  fs.writeFileSync(privateFile, JSON.stringify({ token, expiresAtMs: config.probeExpiresAtMs,
    baseUrl: 'https://asia-northeast3-archive-pilates.cloudfunctions.net/imwebWebhookApi' }), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ enabled: true, expiresAt: new Date(config.probeExpiresAtMs).toISOString(), grantsAllowed: false }));
} else if (args[0] === '--enable-verified-shadow') {
  const proof = JSON.parse(fs.readFileSync(path.join(dir, 'authorization-proof.json'), 'utf8'));
  if (proof.header !== 'authorization' || proof.exactMatch !== true || !/^[a-f0-9]{64}$/.test(proof.valueSha256) ||
      !/^[a-f0-9]{64}$/.test(proof.sourceReceipt) || !(await db.doc(`${lane}/probeReceipts/${proof.sourceReceipt}`).get()).exists)
    throw Error('Provider authentication proof required');
  await ref.set({ mode: 'shadow', authorizationHeader: 'authorization', authorizationSha256: proof.valueSha256,
    proofReceipt: proof.sourceReceipt, probeExpiresAtMs: 0, grantsAllowed: false, updatedAt: Timestamp.now() });
  console.log(JSON.stringify({ shadowEnabled: true, probeDisabled: true, grantsAllowed: false }));
} else if (args[0] === '--enable-approved-oauth-window') {
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'secret-provision-receipt.json'), 'utf8'));
  if (receipt.appCode !== 'ga202609279410fb87e608a' ||
      !/^projects\/(?:archive-pilates|[0-9]+)\/secrets\/IMWEB_APP_OAUTH_CONNECTION\/versions\/[0-9]+$/.test(receipt.resource || ''))
    throw Error('Approved OAuth credential provisioning required');
  const now = Date.now();
  await ref.set({ oauthEnabledAtMs: now, oauthEnabledUntilMs: now + 20 * 60_000,
    oauthAttemptCount: 0, updatedAt: Timestamp.now() }, { merge: true });
  console.log(JSON.stringify({ oauthWindowEnabled: true, maxAttempts: 5, expiresAt: new Date(now + 20 * 60_000).toISOString() }));
} else if (args[0] === '--disable-oauth-window') {
  await ref.set({ oauthEnabledUntilMs: 0, updatedAt: Timestamp.now() }, { merge: true });
  console.log(JSON.stringify({ oauthWindowDisabled: true }));
} else if (args[0] === '--disable-probe') {
  await ref.set({ mode: 'disabled', probeExpiresAtMs: 0, updatedAt: Timestamp.now() }, { merge: true });
  console.log(JSON.stringify({ disabled: true }));
} else {
  const config = (await ref.get()).data();
  const receipts = await db.collection(`${lane}/probeReceipts`).get();
  const samples = await db.collection(`${lane}/verifiedSamples`).get();
  const shadow = await db.collection(`${lane}/shadowEvents`).get();
  const probe = fs.existsSync(privateFile) ? JSON.parse(fs.readFileSync(privateFile, 'utf8')) : null;
  const candidates = ['data', 'payload', 'event', 'eventType', 'event_type', 'eventCode', 'timestamp', 'time',
    'eventId', 'event_id', 'id', 'type', 'resource', 'site_code', 'createdAt', 'eventTime', 'event_time'];
  const names = probe ? Object.fromEntries(candidates.map(name =>
    [createHmac('sha256', probe.token).update(name).digest('hex'), name])) : {};
  const decode = value => Array.isArray(value) ? value.map(decode) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([k, v]) => [names[k] || k, decode(v)])) : value;
  console.log(JSON.stringify({ mode: config?.mode || 'unconfigured',
    probeActive: config?.mode === 'probe' && config?.probeExpiresAtMs > Date.now(),
    samples: samples.docs.map(d => ({ id: d.id, eventType: d.data().eventType, status: d.data().status })),
    shadowCount: shadow.size,
    receipts: receipts.docs.map(d => ({ id: d.id, ...decode(d.data()) })) }, null, 2));
}
await db.terminate();
