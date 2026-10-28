import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isLocalImwebWriteQuotaFailure } from './imweb-read-failure.mjs';

const DIGEST = /^[a-f0-9]{64}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9_.:/#-]{0,255}$/;
const FRESH_MS = 120000;
const TRIGGER = Object.freeze({ classification: 'write_quota_exceeded', quotaScope: 'local_cli', dispatchState: 'blocked_before_dispatch' });
class NativeFollowupError extends Error {
  constructor(code) { super(`Imweb native follow-up: ${code}`); this.code = code; }
}
const fail = code => { throw new NativeFollowupError(code); };
const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
function keys(value, required, optional = []) {
  if (!object(value) || required.some(key => !Object.hasOwn(value, key))
      || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('INVALID_METADATA');
}
function ref(value) {
  if (typeof value !== 'string' || !REF.test(value)) fail('INVALID_REFERENCE');
  return value;
}
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      || !Number.isFinite(Date.parse(value))) fail('INVALID_TIMESTAMP');
  return new Date(value).toISOString();
}
function canonical(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if ((!object(value) && !Array.isArray(value)) || seen.has(value)) fail('INVALID_PAYLOAD');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    const indices = Object.keys(value);
    if (indices.length !== value.length || indices.some((key, index) => key !== String(index))) fail('INVALID_PAYLOAD');
    result = `[${value.map(item => canonical(item, seen)).join(',')}]`;
  } else {
    result = `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], seen)}`).join(',')}}`;
  }
  seen.delete(value);
  return result;
}

// Hash in memory; never persist request bodies, credentials or CLI output.
export const imwebPayloadDigest = value => createHash('sha256').update(canonical(value)).digest('hex');
function digest(value) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail('INVALID_DIGEST');
  return value;
}
function references(values) {
  if (!Array.isArray(values) || !values.length || values.length > 100
      || new Set(values).size !== values.length) fail('INVALID_SCOPE');
  return values.map(ref).sort();
}
function operation(value) {
  keys(value, ['canonicalActionKey', 'siteCode', 'unitCode', 'approvedScope', 'payloadDigest',
    'approvalRef', 'ledgerRef', 'approvedAt', 'approvalExpiresAt']);
  keys(value.approvedScope, ['action', 'targetIds', 'fields']);
  const result = {
    canonicalActionKey: ref(value.canonicalActionKey), siteCode: ref(value.siteCode), unitCode: ref(value.unitCode),
    approvedScope: { action: ref(value.approvedScope.action), targetIds: references(value.approvedScope.targetIds),
      fields: references(value.approvedScope.fields) },
    payloadDigest: digest(value.payloadDigest), approvalRef: ref(value.approvalRef), ledgerRef: ref(value.ledgerRef),
    approvedAt: instant(value.approvedAt), approvalExpiresAt: instant(value.approvalExpiresAt),
  };
  if (result.approvedAt >= result.approvalExpiresAt) fail('INVALID_APPROVAL');
  return result;
}
function assertApproval(value, now) {
  if (now < value.approvedAt || now >= value.approvalExpiresAt) fail('STALE_APPROVAL');
}

function continuationRequired(record) {
  const code = record.status === 'prepared' ? 'IMWEB_NATIVE_ADMIN_REQUIRED' : 'IMWEB_WRITE_RECONCILIATION_REQUIRED';
  return Object.assign(new Error(`Imweb approved write: ${code}`), {
    code, canonicalActionKey: record.operation.canonicalActionKey, status: record.status,
  });
}

// execute must reject CLI failure envelopes, as the existing JSON adapters do.
// The caller supplies exactly one approved CLI operation. There is no UI callback:
// native continuation is an explicit handoff, never a successful CLI result.
export async function runApprovedImwebWrite({ operation: input, payload, execute, store }) {
  const op = operation(input);
  if (imwebPayloadDigest(payload) !== op.payloadDigest) fail('OPERATION_PAYLOAD_MISMATCH');
  if (typeof execute !== 'function' || !['beginCli', 'acceptCli', 'prepare'].every(name => typeof store?.[name] === 'function')) fail('INVALID_EXECUTOR');
  const reservation = store.beginCli({ operation: op });
  if (!reservation.created) throw continuationRequired(reservation.record);
  let result;
  try { result = await execute(payload); }
  catch (error) {
    if (!isLocalImwebWriteQuotaFailure(error)) throw error;
    const handoff = store.prepare({ operation: op, failure: error });
    throw continuationRequired(handoff.record);
  }
  store.acceptCli({ operation: op });
  return result;
}

// This is a local evidence journal, not an executor or an approval source. The trusted
// active Codex caller owns fresh canonical approval/ledger checks, CUA, domain locks,
// policy/time gates and external readback. Opaque refs must not contain private data.
export function createImwebNativeFollowupStore({ directory, io = fs, now = () => new Date().toISOString() }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory) fail('INVALID_DIRECTORY');
  const clock = () => instant(now());
  const filename = key => path.join(directory, `${imwebPayloadDigest(ref(key))}.json`);
  const lock = path.join(directory, '.native-followup.lock');
  function safeDirectory() {
    const stat = io.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) fail('UNSAFE_DIRECTORY');
    // Reject symlink ancestors as well as a symlink journal directory.
    for (let parent = path.dirname(directory); parent !== path.dirname(parent); parent = path.dirname(parent)) {
      if (io.lstatSync(parent).isSymbolicLink()) fail('UNSAFE_DIRECTORY');
    }
  }
  function locked(action) {
    let fd;
    try {
      safeDirectory();
      try { fd = io.openSync(lock, 'wx', 0o600); }
      catch (error) { if (error.code === 'EEXIST') fail('FOLLOWUP_BUSY'); throw error; }
      try { return action(); }
      finally {
        try { io.closeSync(fd); } finally { io.unlinkSync(lock); }
      }
    } catch (error) {
      if (error instanceof NativeFollowupError) throw error;
      fail('FOLLOWUP_PERSISTENCE_FAILED');
    }
  }
  function read(key) {
    let fd;
    try {
      try { fd = io.openSync(filename(key), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      const stat = io.fstatSync(fd);
      if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o077 || stat.nlink !== 1 || stat.size > 65536) fail('UNSAFE_RECORD');
      const record = JSON.parse(io.readFileSync(fd, 'utf8'));
      keys(record, ['version', 'operation', 'operationDigest', 'trigger', 'status', 'createdAt', 'updatedAt', 'claim', 'readback']);
      const normalized = operation(record.operation);
      if (record.version !== 1 || normalized.canonicalActionKey !== key
          || record.operationDigest !== imwebPayloadDigest(normalized)
          || (record.trigger !== null && imwebPayloadDigest(record.trigger) !== imwebPayloadDigest(TRIGGER))
          || !['cli_pending', 'cli_accepted', 'prepared', 'claimed', 'result_unknown', 'verified'].includes(record.status)) fail('INVALID_RECORD');
      const createdAt = instant(record.createdAt), updatedAt = instant(record.updatedAt);
      if (createdAt > updatedAt || createdAt < normalized.approvedAt || createdAt >= normalized.approvalExpiresAt) fail('INVALID_RECORD');
      if (record.claim !== null) {
        keys(record.claim, ['id', 'turnId', 'claimedAt', 'preflightRef']);
        ref(record.claim.id); ref(record.claim.turnId); ref(record.claim.preflightRef); instant(record.claim.claimedAt);
        if (record.claim.claimedAt < createdAt || record.claim.claimedAt > updatedAt) fail('INVALID_RECORD');
      }
      if ((record.status === 'claimed' && !record.claim)
          || (record.status === 'prepared' && (record.claim !== null || record.readback !== null))
          || (['prepared', 'claimed'].includes(record.status) && record.trigger === null)
          || (['cli_pending', 'cli_accepted'].includes(record.status) && (record.claim !== null || record.readback !== null || record.trigger !== null))
          || (record.status === 'result_unknown' && record.readback === null)) fail('INVALID_RECORD');
      if (record.readback !== null) validateReadback(record, record.readback, null);
      if (record.status === 'verified' && record.readback?.outcome !== 'applied') fail('INVALID_RECORD');
      return record;
    } finally { if (fd !== undefined) io.closeSync(fd); }
  }
  function write(record) {
    const temp = path.join(directory, `.native-${randomUUID()}.tmp`);
    let fd;
    try {
      fd = io.openSync(temp, 'wx', 0o600);
      io.writeFileSync(fd, JSON.stringify(record)); io.fsyncSync(fd); io.closeSync(fd); fd = undefined;
      io.renameSync(temp, filename(record.operation.canonicalActionKey));
      const parent = io.openSync(directory, 'r');
      try { io.fsyncSync(parent); } finally { io.closeSync(parent); }
    } finally {
      try { if (fd !== undefined) io.closeSync(fd); }
      finally { try { io.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    }
  }
  function existing(key) {
    const record = read(key);
    if (!record) fail('FOLLOWUP_NOT_FOUND');
    return record;
  }
  function validateReadback(record, value, at) {
    keys(value, ['siteCode', 'unitCode', 'scopeDigest', 'source', 'evidenceRef', 'observedAt',
      'outcome', 'canonicalOutcome', 'observedPayloadDigest', 'invariantsPreserved']);
    const observedAt = instant(value.observedAt);
    if (value.siteCode !== record.operation.siteCode || value.unitCode !== record.operation.unitCode
        || value.scopeDigest !== imwebPayloadDigest(record.operation.approvedScope)
        || value.source !== 'independent_readback' || !['not_applied', 'applied', 'unknown'].includes(value.outcome)
        || !['not_dispatched', 'applied', 'unknown'].includes(value.canonicalOutcome)
        || typeof value.invariantsPreserved !== 'boolean') fail('READBACK_BINDING_CONFLICT');
    ref(value.evidenceRef);
    if (at && (Date.parse(at) - Date.parse(observedAt) < 0
        || Date.parse(at) - Date.parse(observedAt) > FRESH_MS)) fail('READBACK_STALE');
    if (value.observedPayloadDigest !== null) digest(value.observedPayloadDigest);
    if (value.outcome === 'applied' && (value.canonicalOutcome !== 'applied'
        || value.observedPayloadDigest !== record.operation.payloadDigest
        || value.invariantsPreserved !== true)) fail('READBACK_BINDING_CONFLICT');
    return { ...value, observedAt };
  }
  function complete(record, readback, at) {
    const proof = validateReadback(record, readback, at);
    if (record.claim && (proof.observedAt < record.claim.claimedAt || proof.evidenceRef === record.claim.preflightRef)) fail('READBACK_BEFORE_CLAIM');
    if (record.status === 'verified') {
      if (proof.outcome !== 'applied') fail('ALREADY_VERIFIED');
      return record;
    }
    record.status = proof.outcome === 'applied' ? 'verified' : 'result_unknown';
    record.readback = proof; record.updatedAt = at;
    write(record);
    return record;
  }
  return Object.freeze({
    get(canonicalActionKey) { return locked(() => read(canonicalActionKey)); },
    beginCli({ operation: input }) {
      return locked(() => {
        const op = operation(input), at = clock(), fingerprint = imwebPayloadDigest(op);
        assertApproval(op, at);
        const prior = read(op.canonicalActionKey);
        if (prior) {
          if (prior.operationDigest !== fingerprint) fail('OPERATION_CONFLICT');
          return { created: false, record: prior };
        }
        const record = { version: 1, operation: op, operationDigest: fingerprint, trigger: null, status: 'cli_pending',
          createdAt: at, updatedAt: at, claim: null, readback: null };
        write(record);
        assertApproval(op, clock());
        return { created: true, record };
      });
    },
    acceptCli({ operation: input }) {
      return locked(() => {
        const op = operation(input), record = existing(op.canonicalActionKey);
        if (record.operationDigest !== imwebPayloadDigest(op)) fail('OPERATION_CONFLICT');
        if (record.status !== 'cli_pending') fail('RECONCILIATION_REQUIRED');
        record.status = 'cli_accepted'; record.updatedAt = clock();
        write(record);
        return record;
      });
    },
    prepare({ operation: input, failure }) {
      return locked(() => {
        const op = operation(input), at = clock();
        assertApproval(op, at);
        if (!isLocalImwebWriteQuotaFailure(failure)) fail('QUOTA_NOT_PROVEN_LOCAL');
        const prior = read(op.canonicalActionKey), fingerprint = imwebPayloadDigest(op);
        if (prior) {
          if (prior.operationDigest !== fingerprint) fail('OPERATION_CONFLICT');
          if (prior.status === 'cli_pending') {
            prior.status = 'prepared'; prior.trigger = { ...TRIGGER }; prior.updatedAt = at;
            write(prior);
          }
          return { created: false, record: prior };
        }
        const record = { version: 1, operation: op, operationDigest: fingerprint, trigger: { ...TRIGGER }, status: 'prepared',
          createdAt: at, updatedAt: at, claim: null, readback: null };
        write(record);
        return { created: true, record };
      });
    },
    // This is the single-use native claim; executor is a trusted caller attestation,
    // not CUA runtime detection. A crash from here
    // is potentially applied: no lease expiry, automatic reclaim or browser callback.
    claim({ operation: input, executor, readback }) {
      return locked(() => {
        const op = operation(input), at = clock(), record = existing(op.canonicalActionKey);
        if (record.operationDigest !== imwebPayloadDigest(op)) fail('OPERATION_CONFLICT');
        assertApproval(op, at);
        keys(executor, ['kind', 'turnId']);
        if (executor.kind !== 'active_codex_turn') fail('CLAIM_REQUIRES_ACTIVE_CODEX_TURN');
        ref(executor.turnId);
        if (record.status !== 'prepared') fail('RECONCILIATION_REQUIRED');
        const proof = validateReadback(record, readback, at);
        if (proof.outcome !== 'not_applied' || proof.canonicalOutcome !== 'not_dispatched'
            || !proof.invariantsPreserved) fail('RECONCILIATION_REQUIRED');
        const claimAt = clock();
        assertApproval(op, claimAt); validateReadback(record, proof, claimAt);
        record.status = 'claimed'; record.updatedAt = claimAt;
        record.claim = { id: randomUUID(), turnId: executor.turnId, claimedAt: claimAt, preflightRef: proof.evidenceRef };
        record.readback = proof;
        write(record);
        assertApproval(op, clock());
        return { canonicalActionKey: op.canonicalActionKey, claimId: record.claim.id, turnId: executor.turnId };
      });
    },
    verify({ canonicalActionKey, claimId, readback }) {
      return locked(() => {
        const record = existing(canonicalActionKey);
        if (!record.claim || record.claim.id !== claimId) fail('CLAIM_MISMATCH');
        if (readback?.outcome !== 'applied') fail('RECONCILIATION_REQUIRED');
        return complete(record, readback, clock());
      });
    },
    // Readback may resolve an already-applied action even after approval expires.
    // Absence/ambiguity NEVER restores a claimable state.
    reconcile({ canonicalActionKey, readback }) {
      return locked(() => complete(existing(canonicalActionKey), readback, clock()));
    },
  });
}
