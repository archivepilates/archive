import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const { initializeApp, cert } = require('../firebase/kangsain-functions/functions/node_modules/firebase-admin/app');
const { getFirestore, Timestamp } = require('../firebase/kangsain-functions/functions/node_modules/firebase-admin/firestore');
const args = process.argv.slice(2);
if (args.length !== 1 || !['--enable-approved-probe', '--disable-probe', '--inspect'].includes(args[0]))
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
} else if (args[0] === '--disable-probe') {
  await ref.set({ mode: 'disabled', probeExpiresAtMs: 0, updatedAt: Timestamp.now() }, { merge: true });
  console.log(JSON.stringify({ disabled: true }));
} else {
  const config = (await ref.get()).data();
  const receipts = await db.collection(`${lane}/probeReceipts`).get();
  console.log(JSON.stringify({ mode: config?.mode || 'unconfigured',
    probeActive: config?.mode === 'probe' && config?.probeExpiresAtMs > Date.now(),
    receipts: receipts.docs.map(d => ({ id: d.id, ...d.data() })) }, null, 2));
}
await db.terminate();
