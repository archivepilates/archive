import fs from 'node:fs';
import path from 'node:path';
import { LOG_PATH } from './config.mjs';

const CODES = new Set(`CONFIG_INVALID CONFIG_UNKNOWN_FIELD CONFIG_IDENTITY CONFIG_ALLOWLIST CONFIG_MQTT_HOST
CONFIG_SUBSCRIPTIONS CONFIG_CERT_PATH CONFIG_FIREBASE_PATH CONFIG_MISSING CONFIG_READ_FAILED
TLS_MATERIAL_MISSING TLS_MATERIAL_INVALID CREDENTIAL_READ_FAILED FIREBASE_IDENTITY
LOCK_INVALID LOCK_IO_FAILED LOCK_BUSY LOCK_RELEASE_FAILED LEDGER_INVALID LEDGER_DEVICE LEDGER_WRITE_FAILED
EVENT_SIZE EVENT_JSON EVENT_SCHEMA EVENT_DEVICE EVENT_MESSAGE_ID EVENT_TOPIC SIGNAL_WRITE_FAILED
SUBSCRIPTION_ABORTED SUBSCRIPTION_NETWORK SUBSCRIPTION_AUTH SUBSCRIPTION_REJECTED
MQTT_ERROR MQTT_SUBSCRIBE_FAILED RECEIVER_SETUP_FAILED STATUS_WRITE_FAILED RUNTIME_GUARD
INSTALL_ARGUMENTS INSTALL_ALREADY_LOADED INSTALL_FAILED SHUTDOWN_TIMEOUT RECEIVER_FAILED`.split(/\s+/));

export const safeCode = error => CODES.has(error?.code) ? error.code : 'RECEIVER_FAILED';

export function createLogger({ file = LOG_PATH, now = Date.now, limit = 256 * 1024 } = {}) {
  const last = new Map();
  return code => {
    const value = CODES.has(code) ? code : 'RECEIVER_FAILED';
    if (last.has(value) && now() - last.get(value) < 60_000) return;
    last.set(value, now());
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) return;
        if (stat.size >= limit) fs.renameSync(file, `${file}.1`);
      } catch (error) { if (error.code !== 'ENOENT') return; }
      const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND
        | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
      try { fs.fchmodSync(fd, 0o600); fs.writeSync(fd, `${JSON.stringify({ code: value })}\n`); }
      finally { fs.closeSync(fd); }
    } catch { /* Logging must never expose the underlying error or credentials. */ }
  };
}
