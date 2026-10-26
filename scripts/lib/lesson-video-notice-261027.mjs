import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { memberDispatchWindow } from './member-dispatch-window.mjs';

export const PURPOSE = 'external_feedback2_upload_complete_261024_261025';
export const DUE_AT = '2026-10-26T09:00:00+09:00';
export const EXPIRES_AT = '2026-10-26T23:00:00+09:00';
export const RECIPIENT_POLICY = 'registered_all';
export const PRIVATE_ROOT = path.join(os.homedir(), 'Library/Application Support/ARCHIVE PILATES/lesson-video-notices-261026');
export const SESSIONS = Object.freeze([
  ['A', '2026-10-24', '97134106'], ['A', '2026-10-24', '97134121'],
  ['B', '2026-10-24', '97177049'], ['B', '2026-10-24', '97177091'],
  ['C', '2026-10-25', '97134107'], ['C', '2026-10-25', '97134122'],
  ['D', '2026-10-25', '97177137'], ['D', '2026-10-25', '97177166'],
].map(([team, date, lessonId]) => Object.freeze({ team, date, lessonId })));

function requireThat(ok, code) { if (!ok) throw new Error(code); }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const time = value => value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function normalizeName(value) {
  requireThat(typeof value === 'string', 'invalid_name');
  const result = value.normalize('NFC').replace(/\s+/gu, '');
  requireThat(result.length > 0 && !/[\p{Cc}\p{Cf}]/u.test(result), 'invalid_name');
  return result;
}

export function normalizePhone(value) {
  requireThat(typeof value === 'string' && /^[+\d\s()-]+$/.test(value), 'invalid_phone');
  let phone = value.replace(/[\s()-]/g, '');
  if (phone.startsWith('+82')) phone = `0${phone.slice(3)}`;
  requireThat(/^0\d{8,10}$/.test(phone), 'invalid_phone');
  return phone;
}

function teamsOf(teams) {
  requireThat(Array.isArray(teams) && teams.length > 0 && teams.every(t => ['A', 'B', 'C', 'D'].includes(t)), 'invalid_teams');
  requireThat(new Set(teams).size === teams.length, 'duplicate_teams');
  return [...teams].sort();
}

export function createActionKey({ name, phone, teams, purpose = PURPOSE }) {
  requireThat(purpose === PURPOSE, 'invalid_purpose');
  return sha256(JSON.stringify([purpose, normalizeName(name), normalizePhone(phone), teamsOf(teams)]));
}

export function dispatchGuard(now = Date.now()) {
  const ms = time(now);
  if (!Number.isFinite(ms)) return { allowed: false, status: 'deferred', reason: 'invalid_clock' };
  if (ms < Date.parse(DUE_AT)) return { allowed: false, status: 'deferred', reason: 'before_due' };
  if (ms >= Date.parse(EXPIRES_AT)) return { allowed: false, status: 'deferred', reason: 'expired' };
  const window = memberDispatchWindow(ms);
  if (!window.allowed) return { allowed: false, status: 'deferred', reason: window.reason };
  if (new Date(ms + 9 * 3600000).toISOString().slice(0, 10) !== '2026-10-26')
    return { allowed: false, status: 'deferred', reason: 'wrong_date' };
  return { allowed: true };
}

function validateSource(source, now) {
  requireThat(object(source) && source.source === 'StudioMate live lesson-detail DOM', 'non_native_source');
  const age = time(now) - time(source.verifiedAt);
  requireThat(Number.isFinite(age) && age >= 0 && age < 2 * 3600000, 'stale_source');
  requireThat(Array.isArray(source.sessions) && source.sessions.length === 8, 'missing_sessions');
  const seen = new Set(), names = new Map(), byTeam = new Map();
  for (const session of source.sessions) {
    const canonical = SESSIONS.find(s => s.lessonId === String(session.lessonId));
    requireThat(canonical && canonical.team === session.team && canonical.date === session.date, 'unexpected_session');
    requireThat(!seen.has(canonical.lessonId), 'duplicate_session');
    seen.add(canonical.lessonId);
    requireThat(Array.isArray(session.rows) && session.rows.length === 5, 'registered_count_mismatch');
    const rows = new Map();
    for (const row of session.rows) {
      const name = normalizeName(row.name), phone = normalizePhone(row.phone);
      requireThat(['출석', '결석'].includes(row.attendance), 'unknown_attendance');
      requireThat(!names.has(phone) || names.get(phone) === name, 'conflicting_phone_names');
      requireThat(!rows.has(phone), 'duplicate_registered_phone');
      names.set(phone, name);
      rows.set(phone, { name, phone, attendance: row.attendance });
    }
    const ordered = [...rows.values()].sort((a, b) => a.phone.localeCompare(b.phone));
    if (byTeam.has(session.team))
      requireThat(JSON.stringify(ordered) === JSON.stringify(byTeam.get(session.team)), 'same_team_roster_changed');
    else byTeam.set(session.team, ordered);
  }
  return byTeam;
}

// This plan is canonical native roster selection, never a CRM/read-model selection.
export function createPlan(source, recipientPolicy, now = Date.now()) {
  requireThat(['attended_only', 'registered_all'].includes(recipientPolicy), 'invalid_recipient_policy');
  const byTeam = validateSource(source, now), recipients = new Map();
  for (const [team, rows] of byTeam) for (const row of rows) {
    if (recipientPolicy === 'attended_only' && row.attendance !== '출석') continue;
    if (!recipients.has(row.phone)) recipients.set(row.phone, { name: row.name, phone: row.phone, teams: [] });
    recipients.get(row.phone).teams.push(team);
  }
  requireThat(recipients.size > 0, 'empty_recipient_set');
  return [...recipients.values()].map(row => ({ ...row, teams: teamsOf(row.teams), actionKey: createActionKey(row) }))
    .sort((a, b) => a.actionKey.localeCompare(b.actionKey));
}

export function renderMessage(recipient, senderNumber) {
  requireThat(typeof recipient.subject === 'string' && recipient.subject.trim().length > 0, 'invalid_subject');
  requireThat(typeof recipient.text === 'string' && recipient.text.trim().length > 0, 'invalid_text');
  requireThat(Buffer.byteLength(recipient.subject, 'utf8') <= 40, 'subject_exceeds_40_utf8_bytes');
  requireThat(Buffer.byteLength(recipient.text, 'utf8') <= 2000, 'text_exceeds_2000_utf8_bytes');
  requireThat(recipient.textSha256 === sha256(recipient.text), 'approved_text_drift');
  requireThat(recipient.actionKey === createActionKey(recipient), 'invalid_action_key');
  return { to: normalizePhone(recipient.phone), from: normalizePhone(senderNumber), type: 'LMS',
    subject: recipient.subject, text: recipient.text,
    customFields: { archiveActionKey: recipient.actionKey, purpose: PURPOSE } };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function approvedManifestSha256(state) {
  const { sends, ...manifest } = state;
  return sha256(canonicalJson(manifest));
}

export function validateManifest(state, source, now = Date.now()) {
  requireThat(object(state) && state.schemaVersion === 1 && state.purpose === PURPOSE, 'invalid_manifest');
  requireThat(state.dueAt === DUE_AT && state.expiresAt === EXPIRES_AT, 'invalid_schedule');
  requireThat(object(state.approval) && state.approval.approved === true && state.approval.source === 'direct_user_request', 'approval_required');
  requireThat(Number.isFinite(time(state.approval.approvedAt)) && time(state.approval.approvedAt) <= time(now), 'invalid_approval_time');
  normalizePhone(state.senderNumber);
  requireThat(state.recipientPolicy === RECIPIENT_POLICY, 'registered_all_approval_required');
  const plan = createPlan(source, state.recipientPolicy, now);
  requireThat(Array.isArray(state.recipients) && state.recipients.length === plan.length, 'recipient_set_changed');
  const expected = new Map(plan.map(r => [r.actionKey, r])), seen = new Set();
  for (const row of state.recipients) {
    const key = createActionKey(row);
    requireThat(row.actionKey === key && expected.has(key) && !seen.has(key), 'recipient_binding_changed');
    seen.add(key);
    renderMessage(row, state.senderNumber);
  }
  requireThat(object(state.sends), 'invalid_send_ledger');
  for (const [key, send] of Object.entries(state.sends)) {
    requireThat(expected.has(key) && object(send) && typeof send.status === 'string', 'invalid_send_record');
  }
  return plan;
}

function assertNoSymlinkAncestors(root) {
  let current = path.parse(path.resolve(root)).root;
  for (const part of path.resolve(root).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    requireThat(!stat.isSymbolicLink() && stat.isDirectory(), 'unsafe_root_path');
  }
}

function assertPrivate(target, directory = false) {
  const stat = fs.lstatSync(target);
  requireThat(!stat.isSymbolicLink() && stat.uid === process.getuid() &&
    (stat.mode & 0o777) === (directory ? 0o700 : 0o600) &&
    (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1), 'unsafe_private_permissions');
  return stat;
}

export function validatePrivateRoot(root) {
  assertNoSymlinkAncestors(root);
  assertPrivate(root, true);
  // Unknown children are not followed or ignored: every file here is private state.
  for (const entry of fs.readdirSync(root)) assertPrivate(path.join(root, entry));
}

function readPrivate(target) {
  const before = assertPrivate(target);
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    requireThat(opened.ino === before.ino && opened.dev === before.dev, 'private_file_changed');
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}

function syncDirectory(root) {
  const fd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function atomicWritePrivate(target, value) {
  const root = path.dirname(target);
  validatePrivateRoot(root);
  const temp = path.join(root, `.tmp-${randomUUID()}`);
  let fd;
  try {
    fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, target);
    syncDirectory(root);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function createDurableFile(target, value) {
  validatePrivateRoot(path.dirname(target));
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  const created = fs.fstatSync(fd);
  try {
    fs.writeFileSync(fd, value); fs.fsyncSync(fd);
    syncDirectory(path.dirname(target));
  } catch (error) {
    // Acquisition failed before this lock could authorize any work. Remove only our inode.
    const current = fs.lstatSync(target);
    if (current.ino === created.ino && current.dev === created.dev) fs.unlinkSync(target);
    throw error;
  } finally { fs.closeSync(fd); }
}

function acquireLock(root) {
  const target = path.join(root, `dispatch-${sha256(PURPOSE)}.lock`);
  const token = randomUUID();
  // Never remove another owner's lock, including a dead owner's ambiguous intent.
  createDurableFile(target, JSON.stringify({ purpose: PURPOSE, pid: process.pid, token }));
  return () => {
    const owner = JSON.parse(readPrivate(target));
    requireThat(owner.pid === process.pid && owner.token === token, 'lock_owner_changed');
    fs.unlinkSync(target);
    syncDirectory(root);
  };
}

function load(root, now) {
  validatePrivateRoot(root);
  const state = JSON.parse(readPrivate(path.join(root, 'state.json')));
  const source = JSON.parse(readPrivate(path.join(root, 'fresh-source.json')));
  const plan = validateManifest(state, source, now);
  const digest = approvedManifestSha256(state), pin = path.join(root, 'approved-manifest.sha256');
  if (fs.existsSync(pin)) requireThat(readPrivate(pin) === digest, 'frozen_manifest_changed');
  return { state, source, plan, digest };
}

function noNextPage(response, requireCursor = false) {
  requireThat(object(response) && (!requireCursor || Object.hasOwn(response, 'nextKey')) &&
    (response.nextKey === undefined || response.nextKey === null || response.nextKey === ''), 'incomplete_provider_history');
}

// LMS history is keyed by messageId; ATA/template parsers must not be used here.
export function parseLmsHistory(response, recipient) {
  noNextPage(response);
  requireThat(object(response.messageList) && !response.errorCode && !response.error, 'invalid_lms_history');
  if (response.limit !== undefined) requireThat(response.limit === 500, 'incomplete_history_limit');
  const entries = Object.entries(response.messageList);
  requireThat(entries.length < 500, 'history_at_page_limit');
  return entries.map(([id, row]) => {
    const customFields = object(row) && !Object.hasOwn(row, 'customFields') ? {} : row?.customFields;
    requireThat(object(row) && row.messageId === id && typeof row.text === 'string' && row.type === 'LMS' &&
      object(customFields) && typeof row.groupId === 'string' && row.groupId.length > 0 &&
      typeof row.statusCode === 'string' && /^\d{4}$/.test(row.statusCode), 'invalid_lms_history_row');
    requireThat(normalizePhone(row.to) === normalizePhone(recipient.phone), 'history_recipient_mismatch');
    return { ...row, customFields };
  });
}

function matchingHistory(rows, recipient, senderNumber, acceptedReceipts = []) {
  return rows.flatMap(row => {
    const keyed = row.customFields.archiveActionKey === recipient.actionKey;
    const sameText = sha256(row.text) === recipient.textSha256;
    const knownReceipt = acceptedReceipts.some(receipt => receipt.messageId === row.messageId && receipt.groupId === row.groupId);
    if (!keyed && !sameText && !knownReceipt) return [];
    let sameSender = false;
    try { sameSender = normalizePhone(row.from) === normalizePhone(senderNumber); } catch { /* Unverifiable sender. */ }
    const approved = sameText && sameSender && row.customFields.purpose === PURPOSE;
    // A key alone is a replay fence, never evidence that the approved message was delivered.
    return [{ ...row, archiveApprovalConflict: keyed && !approved || knownReceipt && !(sameText && sameSender), archiveApprovalVerified: approved,
      archivePayloadVerified: sameText && sameSender,
      archiveMetadataAbsent: !Object.hasOwn(row.customFields, 'archiveActionKey') && !Object.hasOwn(row.customFields, 'purpose') }];
  });
}

export function providerOutcome(row) {
  if (row.statusCode === '4000') return 'delivered';
  if (['2000', '3000'].includes(row.statusCode)) return 'accepted';
  if (/^[123]\d{3}$/.test(row.statusCode)) return 'failed';
  return 'result_unknown';
}

function receipts(rows) {
  return rows.map(row => ({ messageId: row.messageId, groupId: row.groupId, statusCode: row.statusCode }));
}

function mergeReceipts(previous = [], current = []) {
  return [...new Map([...previous, ...current].map(row => [row.messageId, row])).values()];
}

function historyOutcome(rows, acceptedReceipts = []) {
  if (rows.some(row => row.archiveApprovalConflict)) return 'attention_required';
  // Only original POST acknowledgements can bind a metadata-free readback, never adopted history.
  const bound = row => row.archivePayloadVerified && row.archiveMetadataAbsent && acceptedReceipts.some(receipt =>
    receipt.messageId === row.messageId && receipt.groupId === row.groupId);
  if (rows.some(row => !row.archiveApprovalVerified && !bound(row))) return 'result_unknown';
  if (rows.length !== 1) return 'result_unknown';
  return providerOutcome(rows[0]);
}

async function history(request, recipient, senderNumber, now, acceptedReceipts = []) {
  const params = new URLSearchParams({ to: normalizePhone(recipient.phone), type: 'LMS', dateType: 'CREATED',
    startDate: '2026-10-24T00:00:00+09:00', endDate: new Date(time(now)).toISOString(), limit: '500' });
  return matchingHistory(parseLmsHistory(await request(`/messages/v4/list?${params}`, 'GET'), recipient), recipient, senderNumber, acceptedReceipts);
}

export function validateActiveSender(response, senderNumber, now) {
  requireThat(Array.isArray(response), 'unknown_sender_schema');
  const numbers = response.map(row => {
    if (typeof row === 'string') return normalizePhone(row);
    requireThat(object(row) && row.status === 'ACTIVE' && typeof row.phoneNumber === 'string', 'unknown_sender_schema');
    if (row.expireAt != null) requireThat(Number.isFinite(time(row.expireAt)) && time(row.expireAt) > time(now), 'expired_sender');
    return normalizePhone(row.phoneNumber);
  });
  requireThat(numbers.includes(normalizePhone(senderNumber)), 'sender_not_active');
}

function blacklist(response, senderNumber) {
  noNextPage(response, true);
  requireThat(Array.isArray(response.blackList) && response.blackList.length < 1000, 'unknown_blacklist_schema');
  return new Set(response.blackList.map(row => {
    requireThat(object(row) && ['DENIAL', 'SPAM'].includes(row.type) &&
      normalizePhone(row.senderNumber) === normalizePhone(senderNumber), 'unknown_blacklist_row');
    return normalizePhone(row.recipientNumber);
  }));
}

function blockNumbers(response) {
  noNextPage(response, true);
  requireThat(Array.isArray(response.blockNumbers) && response.blockNumbers.length < 1000, 'unknown_blocknumbers_schema');
  return new Set(response.blockNumbers.map(row => {
    requireThat(object(row), 'unknown_blocknumbers_row');
    return normalizePhone(row.phoneNumber);
  }));
}

async function exclusions(request, state, now) {
  validateActiveSender(await request('/senderid/v1/numbers/active', 'GET'), state.senderNumber, now);
  const black = blacklist(await request(`/iam/v1/black/?${new URLSearchParams({ senderNumber: normalizePhone(state.senderNumber), limit: '1000' })}`, 'GET'), state.senderNumber);
  const excluded = new Set();
  for (const recipient of state.recipients) {
    const phone = normalizePhone(recipient.phone);
    const blocked = blockNumbers(await request(`/iam/v1/block/numbers/?${new URLSearchParams({ phoneNumber: phone, limit: '1000' })}`, 'GET'));
    if (black.has(phone) || blocked.has(phone)) excluded.add(recipient.actionKey);
  }
  return excluded;
}

function responseReceipt(response) {
  if (!object(response)) return { status: 'result_unknown', receipts: [] };
  const groupId = response.groupInfo?.groupId;
  const rows = Array.isArray(response.messageList) ? response.messageList : [];
  const failed = Array.isArray(response.failedMessageList) ? response.failedMessageList : [];
  const ids = [...rows, ...failed].filter(row => object(row) && typeof row.messageId === 'string')
    .map(row => ({ messageId: row.messageId, ...(typeof groupId === 'string' ? { groupId } : {}), statusCode: row.statusCode }));
  if (typeof groupId === 'string' && rows.length === 1 && failed.length === 0 && rows[0].statusCode === '2000' && ids.length === 1)
    return { status: 'accepted_pending_readback', groupId, receipts: ids };
  if (typeof groupId === 'string' && response.groupInfo?.count?.registeredSuccess === 1 && failed.length === 0)
    return { status: 'accepted_pending_readback', groupId, receipts: ids };
  if (rows.length === 0 && failed.length === 1 && ids.length === 1)
    return { status: 'failed', ...(typeof groupId === 'string' ? { groupId } : {}), receipts: ids };
  return { status: 'result_unknown', ...(typeof groupId === 'string' ? { groupId } : {}), receipts: ids };
}

export async function runLessonVideoNotice({ mode = 'plan', root = PRIVATE_ROOT, clock = Date.now,
  makeRequest, writeAtomic = atomicWritePrivate } = {}) {
  requireThat(['plan', 'apply'].includes(mode), 'invalid_mode');
  // Before filesystem mutations, helper import, authentication, lock, or provider reads.
  const initialGuard = dispatchGuard(clock());
  if (mode === 'apply' && !initialGuard.allowed) return { ...initialGuard, attempted: 0 };
  let loaded = load(root, clock());
  if (mode === 'plan') return { status: 'planned', recipients: loaded.plan.length, attempted: 0,
    actionKeyHashes: loaded.plan.map(row => sha256(row.actionKey)) };
  const release = acquireLock(root);
  const result = { status: 'processed', recipients: loaded.plan.length, attempted: 0, excluded: 0,
    deferred: 0, reconciled: 0, outcomes: {} };
  try {
    loaded = load(root, clock());
    const digest = loaded.digest;
    const guard = dispatchGuard(clock());
    if (!guard.allowed) return { ...guard, attempted: 0 };
    requireThat(typeof makeRequest === 'function', 'request_factory_required');
    const request = await makeRequest();
    const excluded = await exclusions(request, loaded.state, clock());
    // The entire live preflight must pass before any new claim/pin is created.
    for (const recipient of loaded.state.recipients) {
      const rows = await history(request, recipient, loaded.state.senderNumber, clock(), loaded.state.sends[recipient.actionKey]?.acceptedReceipts);
      if (rows.some(row => row.archiveApprovalConflict))
        return { ...result, status: 'attention_required', reason: 'provider_action_key_conflict', outcomes: { attention_required: 1 } };
    }
    const count = status => { result.outcomes[status] = (result.outcomes[status] || 0) + 1; };
    for (const recipient of loaded.state.recipients) {
      const beforeRecipient = dispatchGuard(clock());
      if (!beforeRecipient.allowed) { result.deferred++; count('deferred'); result.status = 'deferred'; break; }
      const current = load(root, clock());
      requireThat(current.digest === digest, 'approved_manifest_changed_during_run');
      const state = current.state;
      const key = recipient.actionKey, intentFile = path.join(root, `intent-${key}.json`);
      const previous = state.sends[key];
      const hasIntent = fs.existsSync(intentFile);
      const matches = await history(request, recipient, state.senderNumber, clock(), previous?.acceptedReceipts);
      const save = send => {
        state.sends[key] = send;
        writeAtomic(path.join(root, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
      };
      if (matches.length) {
        save({ ...previous, status: historyOutcome(matches, previous?.acceptedReceipts), receipts: mergeReceipts(previous?.receipts, receipts(matches)),
          readbackAt: new Date(time(clock())).toISOString() });
        result.reconciled++; count(state.sends[key].status);
        if (state.sends[key].status === 'attention_required') { result.status = 'attention_required'; break; }
        if (state.sends[key].status === 'result_unknown') result.status = 'attention_required';
        continue;
      }
      if (previous || hasIntent) {
        // A durable intent is a permanent replay fence, including crashes before POST.
        count(previous?.status || 'result_unknown'); continue;
      }
      if (excluded.has(key)) { result.excluded++; count('excluded'); continue; }
      // Repeat active-sender and exclusions before this recipient, not just at task start.
      const currentExcluded = await exclusions(request, { ...state, recipients: [recipient] }, clock());
      if (currentExcluded.has(key)) { result.excluded++; count('excluded'); continue; }
      const beforeIntent = dispatchGuard(clock());
      if (!beforeIntent.allowed) { result.deferred++; count('deferred'); result.status = 'deferred'; break; }
      const latest = load(root, clock());
      requireThat(latest.digest === digest, 'approved_manifest_changed_during_run');
      requireThat(canonicalJson(latest.state.sends) === canonicalJson(state.sends), 'send_ledger_changed_during_run');
      const message = renderMessage(recipient, state.senderNumber);
      const pin = path.join(root, 'approved-manifest.sha256');
      if (!fs.existsSync(pin)) atomicWritePrivate(pin, digest);
      if (!dispatchGuard(clock()).allowed) { result.deferred++; result.status = 'deferred'; break; }
      const intent = { status: 'intent', attemptToken: randomUUID(), ownerPid: process.pid,
        actionKey: key, purpose: PURPOSE, manifestSha256: digest, textSha256: recipient.textSha256,
        intentAt: new Date(time(clock())).toISOString() };
      atomicWritePrivate(intentFile, JSON.stringify(intent));
      save(intent);
      // No asynchronous work between this real-clock check and the irreversible POST.
      const beforePost = dispatchGuard(clock());
      if (!beforePost.allowed) {
        save({ ...intent, status: 'deferred_before_post' });
        result.deferred++; count('deferred'); result.status = 'deferred'; break;
      }
      result.attempted++;
      let receipt;
      try {
        receipt = responseReceipt(await request('/messages/v4/send-many/detail', 'POST', {
          messages: [message], strict: true, allowDuplicates: false, showMessageList: true,
        }));
      } catch {
        receipt = { status: 'result_unknown', receipts: [] };
      }
      save({ ...intent, ...receipt, acceptedReceipts: receipt.status === 'accepted_pending_readback' ? structuredClone(receipt.receipts) : [],
        responseAt: new Date(time(clock())).toISOString() });
      try {
        const readback = await history(request, recipient, state.senderNumber, clock(), state.sends[key].acceptedReceipts);
        if (readback.length) save({ ...state.sends[key], status: historyOutcome(readback, state.sends[key].acceptedReceipts),
          receipts: mergeReceipts(state.sends[key].receipts, receipts(readback)), readbackAt: new Date(time(clock())).toISOString() });
      } catch {
        // Accepted/unknown remain replay-fenced; a readback error is never transport failure.
      }
      count(state.sends[key].status);
      if (['result_unknown', 'attention_required'].includes(state.sends[key].status)) { result.status = 'attention_required'; break; }
    }
    return result;
  } finally { release(); }
}
