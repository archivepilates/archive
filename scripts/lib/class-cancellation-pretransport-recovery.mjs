import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {privateDirectory, savePrivateJson} from './class-cancellation-correction-ledger.mjs';
import {evaluateClassCancellation} from './class-cancellation-policy.mjs';

const VERSION = 'class_cancellation_pretransport_recovery_v1';
const RESOLUTION = 'class_cancellation_pretransport_resolution_v1';
const PROOF = 'before_submit_blocked_transport_gate_never_armed';
const DAY = 86_400_000;
const FIELDS = ['date', 'startTime', 'staffName', 'lessonType', 'category', 'title', 'room'];
const APPROVAL_FIELDS = ['version', 'approvalRef', 'originalKey', 'originalDigest', 'approvedAt', 'expiresAt',
  'proof', 'date', 'startTime', 'expectedDeadline'];
const RESOLUTION_FIELDS = ['version', 'originalKey', 'originalDigest', 'childKey', 'childDigest', 'approvalRef', 'approvalDigest', 'resolvedAt'];
const BOUND_FIELDS = ['key', 'parentKey', 'parentDigest', 'approvalRef', 'approval', 'row', 'policy'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = reason => {throw Error(`Pretransport recovery: ${reason}`);};
const key = value => {if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('invalid key/digest'); return value;};

export function fingerprintClassCorrectionRecord(record) {
  if (!object(record)) fail('record required');
  return sha(JSON.stringify(record));
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    || value.startsWith('0000')) fail('valid zoned ISO timestamp required');
  const date = value.slice(0, 10), day = Date.parse(`${date}T00:00:00Z`), time = Date.parse(value);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date || !Number.isFinite(time)) fail('invalid timestamp date');
  return time;
}

export function validatePretransportRecoveryApproval(approval, current) {
  if (!object(approval) || Object.keys(approval).length !== APPROVAL_FIELDS.length
    || APPROVAL_FIELDS.some(field => !Object.hasOwn(approval, field)) || approval.version !== VERSION
    || typeof approval.approvalRef !== 'string' || !/^call_[A-Za-z0-9_]{1,160}$/.test(approval.approvalRef)
    || approval.proof !== PROOF) fail('explicit bound approval and never-armed proof required');
  key(approval.originalKey); key(approval.originalDigest);
  const start = timestamp(approval.approvedAt), end = timestamp(approval.expiresAt);
  if (end <= start || end - start > DAY) fail('approval interval must be positive and at most 24h');
  if (current !== undefined && (!Number.isFinite(current) || current < start || current >= end)) fail('approval not active or expired');
  const target = evaluateClassCancellation({date: approval.date, startTime: approval.startTime,
    staffName: 'Approval schema', lessonType: '\uadf8\ub8f9', category: '\uadf8\ub8f9', title: 'Approval schema', room: ''});
  if (target.status !== 'enforce' || target.rule !== 'previous_day_21'
    || target.expectedDeadline !== approval.expectedDeadline) fail('valid weekend date/time/deadline target required');
}

function validateParent(parent, approval) {
  if (!object(parent) || parent.key !== approval.originalKey || parent.status !== 'unknown'
    || parent.reason !== 'before_submit_blocked' || parent.submittedAt != null || parent.verifiedAt != null
    || parent.transport != null || parent.transportRequest != null || parent.transportArmed === true
    || fingerprintClassCorrectionRecord(parent) !== approval.originalDigest) fail('unchanged before-submit unknown parent required');
  const row = parent.row;
  if (!object(row) || FIELDS.some(field => typeof row[field] !== 'string')
    || row.date !== approval.date || row.startTime !== approval.startTime) fail('parent class target mismatch');
  const policy = evaluateClassCancellation(row);
  if (policy.status !== 'enforce' || policy.rule !== 'previous_day_21'
    || !isDeepStrictEqual(parent.policy, policy) || policy.expectedDeadline !== approval.expectedDeadline) fail('parent policy target mismatch');
}

const recoveryKeyFor = approval => sha(JSON.stringify([
  approval.originalKey, approval.originalDigest, approval.approvalRef, approval.version,
]));

function validateTarget(evidence, parent) {
  if (!object(evidence) || !object(evidence.row)
    || FIELDS.some(field => evidence.row[field] !== parent.row[field])
    || !isDeepStrictEqual(evidence.policy, parent.policy)) fail('child class/policy target mismatch');
}

function validateChild(child, parent, approval, recoveryKey, {verified = false} = {}) {
  if (!object(child) || child.key !== recoveryKey || !Number.isInteger(child.revision) || child.revision < 1
    || child.parentKey !== approval.originalKey || child.parentDigest !== approval.originalDigest
    || child.approvalRef !== approval.approvalRef || !isDeepStrictEqual(child.approval, approval)
    || !['intent', 'submitted', 'unknown', 'verified', 'review'].includes(child.status)) fail('child parent/approval binding mismatch');
  validateTarget(child, parent);
  if (verified && child.status !== 'verified') fail('canonical verified child required');
  if (child.status === 'verified') {
    const time = timestamp(child.verifiedAt);
    if (time < timestamp(approval.approvedAt) || time >= timestamp(approval.expiresAt)) fail('child verification outside approval interval');
  }
}

async function resolutionFile(directory, originalKey) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('absolute private resolution directory required');
  await privateDirectory(directory);
  const stat = await fs.lstat(directory);
  if ((stat.mode & 0o777) !== 0o700) fail('resolution directory must be 0700');
  return path.join(directory, key(originalKey) + '.json');
}

async function readResolution(directory, originalKey) {
  const file = await resolutionFile(directory, originalKey);
  let stat;
  try {stat = await fs.lstat(file);} catch (error) {if (error.code === 'ENOENT') return null; throw error;}
  const safe = value => value.isFile() && !value.isSymbolicLink() && value.uid === process.getuid() && (value.mode & 0o777) === 0o600;
  if (!safe(stat)) fail('unsafe resolution file; owned 0600 required');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const actual = await handle.stat();
    if (!safe(actual) || actual.dev !== stat.dev || actual.ino !== stat.ino) fail('resolution file changed');
    const resolution = JSON.parse(await handle.readFile('utf8'));
    if (!object(resolution)) fail('invalid resolution JSON record');
    return resolution;
  } finally {await handle.close();}
}

async function validateResolution(resolution, parent, recoveryLedger, originalKey) {
  if (!object(resolution) || Object.keys(resolution).length !== RESOLUTION_FIELDS.length
    || RESOLUTION_FIELDS.some(field => !Object.hasOwn(resolution, field))
    || resolution.version !== RESOLUTION || resolution.originalKey !== originalKey
    || !object(parent) || fingerprintClassCorrectionRecord(parent) !== resolution.originalDigest) fail('resolution parent reference mismatch');
  key(resolution.childKey); key(resolution.childDigest);
  const child = await recoveryLedger.read(resolution.childKey);
  if (!object(child) || fingerprintClassCorrectionRecord(child) !== resolution.childDigest) fail('resolution child reference mismatch');
  const approval = child.approval;
  validatePretransportRecoveryApproval(approval); validateParent(parent, approval);
  if (approval.originalKey !== originalKey || approval.originalDigest !== resolution.originalDigest
    || approval.approvalRef !== resolution.approvalRef || fingerprintClassCorrectionRecord(approval) !== resolution.approvalDigest
    || recoveryKeyFor(approval) !== resolution.childKey) fail('resolution approval reference mismatch');
  validateChild(child, parent, approval, resolution.childKey, {verified: true});
  const resolvedAt = timestamp(resolution.resolvedAt);
  if (resolvedAt < timestamp(child.verifiedAt) || resolvedAt >= timestamp(approval.expiresAt)) fail('resolution outside verified approval interval');
  return child;
}

function dependencies(baseLedger, recoveryLedger) {
  if (baseLedger === recoveryLedger || [baseLedger, recoveryLedger].some(ledger =>
    ['read', 'claim', 'update'].some(method => typeof ledger?.[method] !== 'function'))) fail('separate canonical and recovery ledgers required');
}

/** The supplied approval is operator evidence, never inferred from an unknown record.
 * Caller retains the shared native lock and fresh native verification responsibilities.
 */
export async function createApprovedPretransportRecovery({baseLedger, recoveryLedger, resolutionDirectory, approval, now} = {}) {
  dependencies(baseLedger, recoveryLedger);
  if (typeof now !== 'function') fail('live clock function required');
  approval = structuredClone(approval);
  let lastTime = -Infinity;
  const time = () => {
    const value = now(), ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : timestamp(value);
    if (!Number.isFinite(ms) || ms < lastTime) fail('invalid or regressing clock');
    lastTime = ms; return ms;
  };
  const parentFor = async () => {
    validatePretransportRecoveryApproval(approval, time());
    const parent = await baseLedger.read(approval.originalKey);
    validateParent(parent, approval);
    return parent;
  };
  const targetKey = approval?.originalKey;
  await parentFor();
  const recoveryKey = recoveryKeyFor(approval);
  if (await readResolution(resolutionDirectory, targetKey) !== null) fail('existing resolution cannot be overwritten or replayed');
  const only = requested => {if (requested !== targetKey) fail('outside the approved single-key scope');};
  const readChild = async parent => {
    const child = await recoveryLedger.read(recoveryKey);
    if (child !== null) validateChild(child, parent, approval, recoveryKey);
    return child;
  };
  const ledger = {
    async read(requested) {only(requested); return readChild(await parentFor());},
    async claim(requested, evidence) {
      only(requested);
      const parent = await parentFor(); validateTarget(evidence, parent);
      if (evidence.status !== 'intent' || BOUND_FIELDS.slice(0, 5).some(field => Object.hasOwn(evidence, field))) fail('unbound intent evidence required');
      if (await readResolution(resolutionDirectory, targetKey) !== null) fail('existing resolution blocks recovery claim');
      if (await readChild(parent) !== null) return false;
      const won = await recoveryLedger.claim(recoveryKey, {...structuredClone(evidence), parentKey: targetKey,
        parentDigest: approval.originalDigest, approvalRef: approval.approvalRef, approval: structuredClone(approval)});
      await readChild(await parentFor());
      return won;
    },
    async update(requested, patch) {
      only(requested);
      const parent = await parentFor();
      if (!object(patch) || BOUND_FIELDS.some(field => Object.hasOwn(patch, field))) fail('child binding is immutable');
      const child = await readChild(parent);
      if (child === null) fail('missing child claim');
      const next = {...child, ...structuredClone(patch)};
      validateChild(next, parent, approval, recoveryKey);
      await recoveryLedger.update(recoveryKey, patch);
      await readChild(await parentFor());
    },
  };
  return {ledger, targetKey, recoveryKey, async complete() {
    const parent = await parentFor(), child = await readChild(parent);
    validateChild(child, parent, approval, recoveryKey, {verified: true});
    const resolution = {version: RESOLUTION, originalKey: targetKey, originalDigest: approval.originalDigest,
      childKey: recoveryKey, childDigest: fingerprintClassCorrectionRecord(child), approvalRef: approval.approvalRef,
      approvalDigest: fingerprintClassCorrectionRecord(approval), resolvedAt: new Date(time()).toISOString()};
    await validateResolution(resolution, parent, recoveryLedger, targetKey);
    const file = await resolutionFile(resolutionDirectory, targetKey);
    await parentFor();
    await savePrivateJson(file, resolution);
    await validateResolution(await readResolution(resolutionDirectory, targetKey), await parentFor(), recoveryLedger, targetKey);
    return resolution;
  }};
}

export function withResolvedPretransportRecoveries({baseLedger, recoveryLedger, resolutionDirectory} = {}) {
  dependencies(baseLedger, recoveryLedger);
  return {
    async read(requested) {
      key(requested);
      const parent = await baseLedger.read(requested), resolution = await readResolution(resolutionDirectory, requested);
      if (resolution === null) return parent;
      await validateResolution(resolution, parent, recoveryLedger, requested);
      // Only this derived read is verified. The canonical parent remains terminal unknown.
      return {...parent, status: 'verified', originalStatus: parent.status, recoveryKey: resolution.childKey};
    },
    claim: (...args) => baseLedger.claim(...args),
    update: (...args) => baseLedger.update(...args),
  };
}
