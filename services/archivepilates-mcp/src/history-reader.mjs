import { createHmac } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { requireValue } from './errors.mjs';

const project = 'vrmtkewdqgcrhpbeijhr';
const role = 'archive_history_mcp_reader';
const usageWarning = 'Supabase 사용량 확인이 필요하거나 무료 한도에 도달했습니다. 상세 조회를 하지 않았습니다.';
const statusValues = new Set(['booked', 'booking_waiting', 'booking_confirmed', 'attendance', 'absence', 'noshow', 'cancel']);
const endpoints = /^aws-[0-9]+-ap-northeast-2\.pooler\.supabase\.com$/;
const bookingTypes = new Set(['group', 'private', 'unknown']);
const eventTypes = new Set(['payment', 'refund', 'void', 'unknown']);
const sql = 'SELECT archive_history_ro.mcp_member_month($1::text,$2::date) AS result';
const octoberSql = 'SELECT archive_history_ro.mcp_october_booking_pass($1::text) AS result';
const partialMonth = '2026-10';
const partialScope = 'booking_issued_pass_only';
const maxRows = 200;

async function readPrivateJson(file) {
  if (!path.isAbsolute(file)) throw Error('Invalid config path');
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await fd.stat();
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) || info.size > 32768)
      throw Error('Invalid private config');
    const buffer = Buffer.alloc(32769);
    const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 32768) throw Error('Invalid private config');
    return JSON.parse(buffer.subarray(0, bytesRead).toString());
  } finally { await fd.close(); }
}

function connection(config) {
  const direct = config.host === `db.${project}.supabase.co`;
  if (config.project !== project || (!direct && !(typeof config.host === 'string' && endpoints.test(config.host)))
      || !/^[0-9a-f]{64}$/.test(config.hmacKey || '') || typeof config.password !== 'string'
      || config.password.length < 24 || typeof config.ca !== 'string' || !config.ca.startsWith('-----BEGIN CERTIFICATE-----'))
    throw Error('Invalid history config');
  return { host: config.host, port: 5432, database: 'postgres', user: direct ? role : `${role}.${project}`,
    password: config.password, ssl: { ca: config.ca, rejectUnauthorized: true },
    connectionTimeoutMillis: 4500, statement_timeout: 4500, query_timeout: 5000, application_name: 'archive-history-mcp' };
}

export function historyResult(value, month, now) {
  const source = { kind: 'supabase_closed_month_snapshot', month, queriedAt: new Date(now).toISOString(),
    liveReadback: false, allowedForExternalActions: false };
  const invalid = () => requireValue(false, 'HISTORY_EVIDENCE_INVALID', '검증된 적재 응답을 확인하지 못했습니다.');
  const partial = month === partialMonth;
  const states = partial ? ['not_loaded','partial_no_verified_rows','record_limit','partial_member_found']
    : ['not_loaded','no_member_rows','record_limit','member_found'];
  if (!value || !states.includes(value.state) || value.month !== month
      || (partial && value.scope !== partialScope)) invalid();
  if (partial) Object.assign(source, { kind: 'supabase_verified_partial_snapshot',
    scope: partialScope, coverage: 'verified_subset', transactionCoverage: 'not_collected' });
  if (value.state === 'not_loaded') return { ok: true, source, status: 'not_loaded', history: null };
  const observedAt = typeof value.observedAt === 'string' ? Date.parse(value.observedAt) : NaN;
  const loadedAt = typeof value.loadedAt === 'string' ? Date.parse(value.loadedAt) : NaN;
  const [y, m] = month.split('-').map(Number);
  if (!(observedAt >= Date.UTC(y, m, 1) - 9 * 3600000 && loadedAt >= observedAt && loadedAt <= now + 60_000)) invalid();
  Object.assign(source, { observedAt: new Date(observedAt).toISOString(), loadedAt: new Date(loadedAt).toISOString() });
  if (value.state === 'no_member_rows' || value.state === 'partial_no_verified_rows')
    return { ok: true, source, status: value.state, history: null };
  requireValue(value.state !== 'record_limit', 'HISTORY_LIMIT', '이 회원의 적재 이력이 조회 한도를 넘었습니다. 일부를 전체처럼 반환하지 않습니다.');
  const dayInMonth = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
    && day.startsWith(`${month}-`) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
  if (partial) {
    if (!Array.isArray(value.bookings) || !Array.isArray(value.issuedPasses)
        || !value.bookings.length || !value.issuedPasses.length
        || value.bookings.length + value.issuedPasses.length > maxRows) invalid();
    const issuedPasses = value.issuedPasses.map((pass, i) => {
      if (pass?.ref !== i + 1) invalid();
      return { ref: pass.ref };
    });
    const refs = new Set(issuedPasses.map(pass => pass.ref));
    const used = new Set();
    const bookings = value.bookings.map(row => {
      if (!dayInMonth(row?.day) || !['group','private'].includes(row.type)
        || !['attendance','absence','noshow','cancel'].includes(row.status) || !refs.has(row.passRef)) invalid();
      used.add(row.passRef);
      return { day: row.day, type: row.type, status: row.status, passRef: row.passRef };
    });
    if (used.size !== refs.size) invalid();
    return { ok: true, source, status: value.state, history: { bookings, issuedPasses } };
  }
  if (typeof value.name !== 'string' || !/^[\p{L}\p{M}][\p{L}\p{M}\p{Nd} .'’·-]{0,79}$/u.test(value.name)
      || /\p{Nd}{5,}/u.test(value.name)
      || !Array.isArray(value.attendance) || !Array.isArray(value.purchaseEvents)
      || value.attendance.length + value.purchaseEvents.length > maxRows) invalid();
  const attendance = value.attendance.map(row => {
    if (!dayInMonth(row?.day) || !bookingTypes.has(row.type) || !statusValues.has(row.status)) invalid();
    return { day: row.day, type: row.type, status: row.status };
  });
  const purchaseEvents = value.purchaseEvents.map(row => {
    if (!dayInMonth(row?.day) || !eventTypes.has(row.kind)) invalid();
    return { day: row.day, kind: row.kind };
  });
  return { ok: true, source, status: 'member_found', history: { nameAtLoad: value.name, attendance, purchaseEvents } };
}

export function createHistoryReader(configPath, { read = readPrivateJson, Client = pg.Client, now = Date.now } = {}) {
  let pending = false;
  return async ({ memberId, month }, { signal } = {}) => {
    requireValue(!pending, 'HISTORY_BUSY', '다른 Supabase 이력 조회가 끝난 뒤 다시 시도해 주세요.');
    requireValue(typeof memberId === 'string' && /^[1-9]\d{0,15}$/.test(memberId)
      && typeof month === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(month), 'INVALID_ARGUMENT', '원본 회원과 월을 확인해 주세요.');
    pending = true;
    let client;
    try {
      if (signal?.aborted) throw Error('Canceled');
      const settings = await read(configPath);
      const settingsView = connection(settings);
      const usage = await read(`${configPath}.usage.json`).catch(() => null);
      const age = now() - Date.parse(usage?.observedAt);
      requireValue(usage?.project === project && age >= 0 && age < 24 * 3600000
        && Number.isSafeInteger(usage.egressBytes) && usage.egressBytes >= 0 && usage.egressBytes < 4_000_000_000,
      'HISTORY_USAGE_HOLD', usageWarning);
      if (signal?.aborted) throw Error('Canceled');
      client = new Client(settingsView);
      client.on('error', () => {});
      const key = createHmac('sha256', Buffer.from(settings.hmacKey, 'hex'))
        .update(`archive-ops:studiomate:5330:member:${memberId}`).digest('hex');
      await client.connect();
      if (signal?.aborted) throw Error('Canceled');
      const data = month === partialMonth ? await client.query(octoberSql, [key])
        : await client.query(sql, [key, `${month}-01`]);
      if (signal?.aborted || data.rows.length !== 1) throw Error('Incomplete history response');
      return historyResult(data.rows[0].result, month, now());
    } catch (error) {
      if (['HISTORY_USAGE_HOLD','HISTORY_EVIDENCE_INVALID','HISTORY_LIMIT'].includes(error?.code) && error?.safe === true) throw error;
      requireValue(false, 'SOURCE_UNAVAILABLE', 'Supabase 이력 조회에 실패했습니다. StudioMate 데이터로 대체하지 않았습니다.');
    } finally {
      try { await client?.end(); } catch { /* The failed connection is never reused. */ }
      pending = false;
    }
  };
}
