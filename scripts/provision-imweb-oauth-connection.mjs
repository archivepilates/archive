import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { generateKeyPairSync, privateDecrypt, constants, randomBytes } from 'node:crypto';

const dir = path.join(os.homedir(), 'Library/Application Support/ARCHIVE PILATES/imweb-app-onboarding');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const dirStat = fs.lstatSync(dir);
if (!dirStat.isDirectory() || dirStat.isSymbolicLink() || dirStat.uid !== process.getuid() || (dirStat.mode & 0o077))
  throw Error('unsafe_private_directory');
const files = Object.fromEntries(['private.pem', 'public.pem', 'credential-handoff.enc', 'secret-provision-receipt.json']
  .map(name => [name, path.join(dir, name)]));
const privateRead = file => {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o077)) throw Error('unsafe_private_file');
  return fs.readFileSync(file, 'utf8');
};
const action = process.argv.slice(2);
if (action.length !== 1) throw Error('one_action_required');
const cleanup = () => {
  for (const name of ['private.pem', 'credential-handoff.enc', 'public.pem']) {
    if (fs.existsSync(files[name])) { privateRead(files[name]); fs.unlinkSync(files[name]); }
  }
};
if (action[0] === '--prepare-encrypted-handoff') {
  if (Object.values(files).some(file => fs.existsSync(file))) throw Error('existing_handoff_requires_review');
  const pair = generateKeyPairSync('rsa', { modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  fs.writeFileSync(files['private.pem'], pair.privateKey, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(files['public.pem'], pair.publicKey, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ prepared: true, privatePlaintextCredentialsStored: false }));
} else if (action[0] === '--store-approved-connection') {
  if (fs.existsSync(files['secret-provision-receipt.json'])) {
    const receipt = JSON.parse(privateRead(files['secret-provision-receipt.json']));
    if (receipt.appCode !== 'ga202609279410fb87e608a' ||
        !/^projects\/(?:archive-pilates|[0-9]+)\/secrets\/IMWEB_APP_OAUTH_CONNECTION\/versions\/[0-9]+$/.test(receipt.resource || ''))
      throw Error('invalid_existing_provision_receipt');
    cleanup(); console.log(JSON.stringify({ alreadyProvisioned: true, localHandoffRemoved: true }));
    process.exit(0);
  }
  const plaintext = privateDecrypt({ key: privateRead(files['private.pem']), oaepHash: 'sha256',
    padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(privateRead(files['credential-handoff.enc']), 'base64'));
  try {
  let handoff;
  try { handoff = JSON.parse(plaintext.toString('utf8')); } catch { throw Error('invalid_encrypted_handoff'); }
  if (!handoff || typeof handoff.clientId !== 'string' || !/^[^\s\p{Cc}]{1,256}$/u.test(handoff.clientId) ||
      typeof handoff.clientSecret !== 'string' || !/^[^\s\p{Cc}]{16,256}$/u.test(handoff.clientSecret)) throw Error('invalid_app_config');
  const require = createRequire(new URL('../firebase/kangsain-functions/functions/package.json', import.meta.url));
  const { cert } = require('firebase-admin/app');
  const key = JSON.parse(fs.readFileSync('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json', 'utf8'));
  if (key.project_id !== 'archive-pilates' || key.client_email !== 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com')
    throw Error('wrong_service_account');
  const credential = cert(key);
  const access = await credential.getAccessToken();
  const api = async (resource, method = 'GET', body) => {
    const response = await fetch(`https://secretmanager.googleapis.com/v1/${resource}`, { method,
      headers: { Authorization: `Bearer ${access.access_token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw Error(`secret_manager_${response.status}`);
    return response.json();
  };
  const resource = 'projects/archive-pilates/secrets/IMWEB_APP_OAUTH_CONNECTION';
  const existing = await fetch(`https://secretmanager.googleapis.com/v1/${resource}`, {
    headers: { Authorization: `Bearer ${access.access_token}` }, signal: AbortSignal.timeout(30_000) });
  if (existing.status !== 404) throw Error(existing.ok ? 'existing_secret_requires_review' : `secret_manager_${existing.status}`);
  const created = await api('projects/archive-pilates/secrets?secretId=IMWEB_APP_OAUTH_CONNECTION', 'POST', { replication: { automatic: {} } });
  if (!/^projects\/(?:archive-pilates|[0-9]+)\/secrets\/IMWEB_APP_OAUTH_CONNECTION$/.test(created.name || ''))
    throw Error('invalid_secret_resource');
  const value = { clientId: handoff.clientId, clientSecret: handoff.clientSecret, encryptionKey: randomBytes(32).toString('base64') };
  const result = await api(`${resource}:addVersion`, 'POST', { payload: { data: Buffer.from(JSON.stringify(value)).toString('base64') } });
  if (!String(result.name).startsWith(`${created.name}/versions/`)) throw Error('invalid_secret_response');
  fs.writeFileSync(files['secret-provision-receipt.json'], JSON.stringify({ resource: result.name,
    appCode: 'ga202609279410fb87e608a', createdAt: new Date().toISOString(), plaintextStoredLocally: false }), { flag: 'wx', mode: 0o600 });
  cleanup();
  console.log(JSON.stringify({ stored: true, resource: result.name, plaintextStoredLocally: false }));
  } finally { plaintext.fill(0); cleanup(); }
} else throw Error('unsupported_action');
