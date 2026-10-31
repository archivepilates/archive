import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readStudentShareLedgers, validatedShareEntries, STUDENT_SHARE_SOURCES } from './imweb-student-share-policy.mjs';
import { acquireStudioMateBrowserLock } from './studiomate-browser-lock.mjs';
import { runStudentShareAccess } from '../e261017-access.mjs';
import { sendAutomationHealthEmail } from './automation-failure-notifications.mjs';

export const EXPIRY_WORKER_DIR = path.join(os.homedir(), 'ArchiveIN/automation/student-share-expiry');
export const EXPIRY_WORKER_POLICY = 'student-share-expiry-worker-v1';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const HOUR = 3600000;

export function expiryPlan(ledgers, now, previous = {}) {
  if (!Number.isFinite(now) || !Array.isArray(ledgers) || ledgers.length !== STUDENT_SHARE_SOURCES.length
    || new Set(ledgers.map(row => row.source)).size !== STUDENT_SHARE_SOURCES.length
    || ledgers.some(row => !STUDENT_SHARE_SOURCES.includes(row.source))) throw Error('INVALID_EXPIRY_SOURCE_SET');
  const entries = ledgers.flatMap(({ source, state }) => [...validatedShareEntries(state, source, now)]
    .map(([code, entry]) => ({ source: source.policyId, code, ...entry })));
  if (entries.some(row => row.adopted === false)) throw Error('UNADOPTED_GRANT_REQUIRES_REVIEW');
  const fingerprint = hash(entries.map(row => [row.source, row.code, row.status, row.grantedAt, row.expiresAt,
    row.revocation?.status || null]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const active = entries.filter(row => row.status === 'active');
  const due = active.filter(row => Date.parse(row.expiresAt) <= now);
  const unknown = active.some(row => ['intent','result_unknown'].includes(row.revocation?.status));
  const next = active.map(row => Date.parse(row.expiresAt)).filter(time => time > now).sort((a,b) => a-b)[0];
  const base = { fingerprint, active: active.length, due: due.length, nextExpiryAt: next ? new Date(next).toISOString() : null };
  if (unknown) return { ...base, status: 'blocked_unknown_result' };
  if (!active.length) return { ...base, status: 'complete' };
  if (!due.length) return { ...base, status: 'not_due' };
  if (previous.fingerprint === fingerprint && Date.parse(previous.nextReviewAt) > now)
    return { ...base, status: 'backoff', nextReviewAt: previous.nextReviewAt };
  return { ...base, status: 'due' };
}

export function privateJson(file, fallback) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) throw Error('UNSAFE_EXPIRY_STATE');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
}

export function savePrivateJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try { fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  const parent = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}

export async function runExpiryWorker({ apply = false, directory = EXPIRY_WORKER_DIR, now = Date.now,
  readLedgers = readStudentShareLedgers, execute = runStudentShareAccess,
  notify = event => sendAutomationHealthEmail({ area: '강사레슨영상', title: '40일 만료 회수',
    link: 'https://core.archivepilates.com/rules/#student-share-expiry-worker' }, event),
  acquire = acquireStudioMateBrowserLock } = {}) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) throw Error('UNSAFE_EXPIRY_DIRECTORY');
  const config = privateJson(path.join(directory, 'config.json'));
  if (config.policy !== EXPIRY_WORKER_POLICY || config.approved !== true || config.sourceAutomationId !== 'e-2')
    throw Error('EXPIRY_ACTIVATION_UNVERIFIED');
  if (config.enabled !== true) return { ok: true, status: 'disabled', remoteCalls: 0 };
  const release = await acquire({ lockPath: path.join(directory, 'worker.lock'), owner: 'student-share-expiry-worker', waitMs: 0, staleMs: HOUR });
  const file = path.join(directory, 'state.json');
  let state;
  try {
    state = privateJson(file, { version: 1 });
    if (state.version !== 1 || state.nextReviewAt != null && (!Number.isFinite(Date.parse(state.nextReviewAt))
      || Date.parse(state.nextReviewAt) > now() + 24 * HOUR)) throw Error('INVALID_EXPIRY_CHECKPOINT');
    if (apply && state.pendingNotice) {
      try {
        let receipt = await notify({ ...state.pendingNotice, reconcileOnly: true });
        if (receipt?.notFound) receipt = await notify(state.pendingNotice);
        if (!receipt?.messageId) throw Error('EXPIRY_OPERATOR_NOTICE_UNVERIFIED');
        state.notifiedKey = state.pendingNoticeKey || state.lastErrorKey;
        delete state.pendingNotice; delete state.pendingNoticeKey;
        savePrivateJson(file, state);
      } catch {
        return { ok: false, status: 'notification_pending', errorCode: 'EXPIRY_OPERATOR_NOTICE_UNVERIFIED', retryWrites: false };
      }
    }
    const plan = expiryPlan(readLedgers(), now(), state);
    if (!apply) return { ok: true, ...plan, mode: 'read_only', remoteCalls: 0 };
    state = { ...state, ...plan, checkedAt: new Date(now()).toISOString() };
    if (plan.status === 'blocked_unknown_result') throw Object.assign(Error('EXPIRY_UNKNOWN_RESULT'), { code: 'EXPIRY_UNKNOWN_RESULT' });
    if (plan.status !== 'due') {
      if (['not_due','complete'].includes(plan.status)) {
        delete state.notifiedKey; delete state.firstFailureAt;
        delete state.lastErrorCode; delete state.lastErrorKey;
      }
      savePrivateJson(file, state); return { ok: true, ...plan, remoteCalls: 0 };
    }
    const results = await execute({ args: ['--apply'] });
    if (!Array.isArray(results) || results.length !== STUDENT_SHARE_SOURCES.length
      || results.some(row => row.ok !== true || row.mode !== 'apply')
      || new Set(results.map(row => row.source)).size !== STUDENT_SHARE_SOURCES.length
      || results.some(row => !STUDENT_SHARE_SOURCES.some(source => source.policyId === row.source)
        || !Array.isArray(row.outcomes))) throw Error('EXPIRY_RESULT_UNVERIFIED');
    const after = expiryPlan(readLedgers(), now());
    if (after.status === 'blocked_unknown_result') throw Error('EXPIRY_RESULT_UNVERIFIED');
    const removed = results.flatMap(row => row.outcomes).filter(row => ['remove_group_only','reconcile_absent_unknown','already_absent'].includes(row.action)).length;
    state = { ...state, ...after, lastRunAt: new Date(now()).toISOString(), removed,
      nextReviewAt: after.due ? new Date(Math.min(now() + 24 * HOUR, Date.parse(after.nextExpiryAt) || Infinity)).toISOString() : null,
      lastErrorCode: null, lastErrorKey: null };
    delete state.notifiedKey; delete state.firstFailureAt;
    savePrivateJson(file, state);
    return { ok: true, status: 'processed', active: after.active, due: after.due, removed, nextExpiryAt: after.nextExpiryAt };
  } catch (error) {
    if (!apply || !state || error.message === 'INVALID_EXPIRY_CHECKPOINT') throw error;
    const busy = error.code === 'STUDIOMATE_BROWSER_BUSY';
    const code = busy ? 'EXPIRY_SHARED_LOCK_BUSY' : error.code === 'EXPIRY_UNKNOWN_RESULT' ? error.code : 'EXPIRY_REVIEW_REQUIRED';
    const key = hash([code, state.fingerprint || null]);
    const current = new Date(now()).toISOString();
    state = { ...state, status: busy ? 'deferred_lock' : 'review_required', lastErrorCode: code,
      nextReviewAt: new Date(now() + (busy ? 60000 : 30 * 60000)).toISOString() };
    const first = state.lastErrorKey === key ? state.firstFailureAt : current;
    state.firstFailureAt = first; state.lastErrorKey = key;
    if ((!busy || now() - Date.parse(first) >= 30 * 60000) && state.notifiedKey !== key) {
      state.pendingNotice = { type: 'failure', noticeVersion: 2, errorCode: code, firstFailureAt: first,
        observedAt: current, consecutiveFailures: 1 };
      state.pendingNoticeKey = key;
      savePrivateJson(file, state);
      const receipt = await notify(state.pendingNotice);
      if (!receipt?.messageId) throw Error('EXPIRY_OPERATOR_NOTICE_UNVERIFIED');
      state.notifiedKey = key; delete state.pendingNotice; delete state.pendingNoticeKey;
    }
    savePrivateJson(file, state);
    return { ok: false, status: state.status, errorCode: code, retryWrites: false };
  } finally { await release(); }
}
