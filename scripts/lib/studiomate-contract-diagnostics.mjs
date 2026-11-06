import { types } from 'node:util';

const PHASES = new Set([
  'create', 'seal_reserve', 'seal_upload', 'seal_finalize',
  'signature_prepare', 'signature_message', 'readback',
]);
const KINDS = new Set(['preflight', 'transport', 'http', 'invalid_response', 'unknown']);
const METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT']);
const DIAGNOSTIC_KEYS = new Set(['schemaVersion', 'phase', 'kind', 'httpStatus', 'method', 'ambiguous']);

function ownData(value, key) {
  // Descriptor reads skip accessors; proxies can execute code even for descriptors.
  if (value === null || typeof value !== 'object' || types.isProxy(value)) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function httpStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function method(value) {
  if (typeof value !== 'string') return null;
  const upper = value.toUpperCase();
  return METHODS.has(upper) ? upper : null;
}

export function sanitizeContractDiagnostic(error, options = {}) {
  const phase = ownData(options, 'phase');
  if (!PHASES.has(phase)) throw new TypeError('contract_diagnostic_phase_invalid');

  const explicitStatus = ownData(error, 'httpStatus');
  const nativeStatus = ownData(error, 'status');
  const status = httpStatus(explicitStatus) ?? httpStatus(nativeStatus);
  const explicitKind = ownData(error, 'errorKind');
  // A native status of zero denotes no HTTP response, not an HTTP status code.
  const kind = KINDS.has(explicitKind) ? explicitKind
    : status !== null ? 'http'
      : nativeStatus === 0 ? 'transport' : 'unknown';

  return Object.freeze({
    schemaVersion: 1,
    phase,
    kind,
    httpStatus: status,
    method: method(ownData(error, 'method')) ?? method(ownData(options, 'method')),
    ambiguous: ownData(error, 'ambiguous') === true,
  });
}

export function isContractDiagnostic(value) {
  if (value === null || typeof value !== 'object' || types.isProxy(value)) return false;
  // Journal records must serialize as plain data, with no inherited toJSON hooks.
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== DIAGNOSTIC_KEYS.size || keys.some(key => !DIAGNOSTIC_KEYS.has(key))) return false;
  const data = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return false;
    data[key] = descriptor.value;
  }
  return data.schemaVersion === 1 && PHASES.has(data.phase) && KINDS.has(data.kind) &&
    (data.httpStatus === null || httpStatus(data.httpStatus) !== null) &&
    (data.method === null || METHODS.has(data.method)) && typeof data.ambiguous === 'boolean';
}
