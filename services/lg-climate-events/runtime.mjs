import fs from 'node:fs';
import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import { CONFIG_PATH, FIREBASE_CREDENTIAL_PATH, fault, mqttOptions, validateConfig } from './config.mjs';
import { acquireLock } from './lock.mjs';
import { createLedger } from './ledger.mjs';
import { createEventSubscriptions } from './subscriptions.mjs';
import { createWorker } from './worker.mjs';
import { createLogger, safeCode } from './logger.mjs';

export function readPrivateFile(file, { maxBytes = 1024 * 1024, privateMode = false } = {}) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes || (privateMode
      && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()))) throw fault('CREDENTIAL_READ_FAILED');
    return fs.readFileSync(fd);
  } catch { throw fault('CREDENTIAL_READ_FAILED'); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

export function loadConfiguration(file = CONFIG_PATH) {
  try {
    if (!fs.existsSync(file)) throw fault('CONFIG_MISSING');
    return validateConfig(JSON.parse(readPrivateFile(file, { privateMode: true, maxBytes: 32_768 })));
  } catch (error) {
    if (error.code?.startsWith('CONFIG_')) throw error;
    throw fault('CONFIG_READ_FAILED');
  }
}

export function loadTlsMaterial(config, now = Date.now()) {
  const material = { cert: readPrivateFile(config.certificatePath),
    key: readPrivateFile(config.privateKeyPath, { privateMode: true }), ca: readPrivateFile(config.caPath) };
  try {
    const certificate = new X509Certificate(material.cert);
    const ca = new X509Certificate(material.ca);
    if (!ca.ca || Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now
      || Date.parse(ca.validFrom) > now || Date.parse(ca.validTo) <= now) throw fault('TLS_MATERIAL_INVALID');
    const publicKey = createPublicKey(createPrivateKey(material.key)).export({ type: 'spki', format: 'der' });
    if (!certificate.publicKey.export({ type: 'spki', format: 'der' }).equals(publicKey)) throw fault('TLS_MATERIAL_INVALID');
    createSecureContext({ ...material, minVersion: 'TLSv1.2' });
  } catch { throw fault('TLS_MATERIAL_INVALID'); }
  return material;
}

export async function runReceiver() {
  process.umask(0o077);
  // DEBUG can make dependencies log packet bodies; refuse it in the daemon.
  if (process.env.DEBUG || process.env.NODE_DEBUG || process.env.GRPC_TRACE) throw fault('CONFIG_INVALID');
  const log = createLogger();
  const release = acquireLock();
  let app; let deleteApp; let worker; let signalHandler;
  let interrupted = false;
  const termination = new Promise(resolve => {
    signalHandler = () => { interrupted = true; resolve(); };
  });
  process.once('SIGTERM', signalHandler); process.once('SIGINT', signalHandler);
  const bounded = async (operation, ms) => {
    let timer;
    try { return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(fault('SHUTDOWN_TIMEOUT')), ms);
    })]); } finally { clearTimeout(timer); }
  };
  try {
    const config = loadConfiguration();
    const material = loadTlsMaterial(config);
    const credentials = JSON.parse(readPrivateFile(config.firebaseCredentialPath ?? FIREBASE_CREDENTIAL_PATH, { privateMode: true }));
    if (credentials.project_id !== 'archive-pilates'
      || credentials.client_email !== 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com') throw fault('FIREBASE_IDENTITY');
    const { initializeApp, cert, deleteApp: dispose } = await import('firebase-admin/app');
    deleteApp = dispose;
    const { getFirestore } = await import('firebase-admin/firestore');
    const { connect } = await import('mqtt');
    app = initializeApp({ credential: cert(credentials), projectId: 'archive-pilates' }, 'lg-climate-events');
    const firestore = getFirestore(app);
    const client = connect(mqttOptions(config, material));
    const ledger = createLedger({ allowedDeviceIds: config.allowedDeviceIds });
    worker = createWorker({ config, client, firestore, ledger,
      renewSubscriptions: createEventSubscriptions({ config }), log });
    if (!interrupted) worker.start();
    await termination;
  } finally {
    if (signalHandler) { process.off('SIGTERM', signalHandler); process.off('SIGINT', signalHandler); }
    try {
      if (worker) await bounded(worker.stop(), 20_000);
    } catch (error) { log(safeCode(error)); }
    try { if (app) await bounded(deleteApp(app), 5000); }
    catch (error) { log(safeCode(error)); }
    finally { release(); }
  }
}
