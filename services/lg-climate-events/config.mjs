import path from 'node:path';
import { checkServerIdentity } from 'node:tls';

export const CONFIG_PATH = '/Users/archivepilates/ArchiveIN/secrets/lg/thinq-events.json';
export const FIREBASE_CREDENTIAL_PATH = '/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json';
export const LOCK_PATH = '/Users/archivepilates/ArchiveIN/automation/locks/lg-climate-events.lock';
export const STATE_PATH = '/Users/archivepilates/ArchiveIN/automation/state/lg-climate-events.json';
export const LOG_PATH = '/Users/archivepilates/ArchiveIN/automation/logs/lg-climate-events.log';
export const RUNTIME = '/Users/archivepilates/dev/archive-in-runtime';
export const NODE = '/opt/homebrew/bin/node';
export const VERSION = 'lg_climate_events_v1';
export const MAX_PAYLOAD_BYTES = 64 * 1024;

export function fault(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

const text = (value, max = 4096) => typeof value === 'string' && value.length > 0
  && value.length <= max && !/[\u0000-\u0020\u007f]/u.test(value);
const absolute = value => text(value) && path.isAbsolute(value) && path.resolve(value) === value;

export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fault('CONFIG_INVALID');
  const keys = ['pat', 'clientId', 'allowedDeviceIds', 'mqttHost', 'certificatePath',
    'privateKeyPath', 'caPath', 'subscriptions', 'firebaseCredentialPath'];
  if (Object.keys(input).some(key => !keys.includes(key))) throw fault('CONFIG_UNKNOWN_FIELD');
  if (!text(input.pat) || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(input.clientId ?? '')) {
    throw fault('CONFIG_IDENTITY');
  }
  if (!Array.isArray(input.allowedDeviceIds) || input.allowedDeviceIds.length !== 8
    || new Set(input.allowedDeviceIds).size !== 8
    || input.allowedDeviceIds.some(id => !/^[a-z\d][a-z\d_-]{0,255}$/i.test(id))) {
    throw fault('CONFIG_ALLOWLIST');
  }
  if (!text(input.mqttHost, 253)) throw fault('CONFIG_MQTT_HOST');
  const match = /^(?:mqtts:\/\/)?([a-z\d-]+\.iot\.[a-z\d-]+\.amazonaws\.com)(?::8883)?$/i.exec(input.mqttHost);
  if (!match) throw fault('CONFIG_MQTT_HOST');
  if (!Array.isArray(input.subscriptions) || input.subscriptions.length < 1 || input.subscriptions.length > 32
    || new Set(input.subscriptions).size !== input.subscriptions.length
    || input.subscriptions.some(topic => !text(topic, 1024) || /[+#]/.test(topic))) {
    throw fault('CONFIG_SUBSCRIPTIONS');
  }
  for (const key of ['certificatePath', 'privateKeyPath', 'caPath']) {
    if (!absolute(input[key])) throw fault('CONFIG_CERT_PATH');
  }
  const firebaseCredentialPath = input.firebaseCredentialPath ?? FIREBASE_CREDENTIAL_PATH;
  if (!absolute(firebaseCredentialPath)) throw fault('CONFIG_FIREBASE_PATH');
  return Object.freeze({ ...input, mqttHost: match[1].toLowerCase(), firebaseCredentialPath,
    allowedDeviceIds: Object.freeze([...input.allowedDeviceIds]),
    subscriptions: Object.freeze([...input.subscriptions]) });
}

export function mqttOptions(config, { cert, key, ca }) {
  if (![cert, key, ca].every(value => Buffer.isBuffer(value) && value.length)) throw fault('TLS_MATERIAL_MISSING');
  return {
    protocol: 'mqtts', host: config.mqttHost, port: 8883, servername: config.mqttHost,
    cert, key, ca, rejectUnauthorized: true, checkServerIdentity,
    minVersion: 'TLSv1.2', clientId: config.clientId, protocolVersion: 4,
    clean: false, keepalive: 30, connectTimeout: 15_000,
    reconnectPeriod: 0, resubscribe: false, queueQoSZero: false, manualConnect: true,
  };
}
