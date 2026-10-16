import { requireValue } from './errors.mjs';

const ORIGIN = 'https://api.studiomate.kr';
const STUDIO = '5330';
const STATUSES = new Set(['booked', 'booking_waiting', 'booking_confirmed', 'attendance',
  'absence', 'noshow', 'cancel']);
const CLASS_TYPES = new Map([['G', 'group'], ['P', 'private'], ['group', 'group'], ['private', 'private']]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);

function check(condition, code = 'LIVE_SOURCE_INCOMPLETE') {
  requireValue(condition, code, 'StudioMate 원본의 범위·식별자·형식을 확인하지 못했습니다. 저장 자료나 빈 결과로 대체하지 않았습니다.');
}

function nativeId(value) {
  check((typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value))
    || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0),
  'LIVE_IDENTITY_MISMATCH');
  return String(value);
}

function integer(value) {
  check((typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    || (typeof value === 'string' && /^(0|[1-9]\d{0,15})$/.test(value)
      && Number.isSafeInteger(Number(value))));
  return Number(value);
}

function label(value) {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= 500
    && !/[\u0000-\u001f\u007f]/.test(value));
  return value.normalize('NFC').trim();
}

function scope(row, memberId, requiredStudio = false) {
  check(object(row));
  if (requiredStudio || own(row, 'studio_id')) {
    check(nativeId(row.studio_id) === STUDIO, 'LIVE_IDENTITY_MISMATCH');
  }
  if (own(row, 'member_id')) {
    check(nativeId(row.member_id) === memberId, 'LIVE_IDENTITY_MISMATCH');
  }
}

function sourceUrl(value, path, allowed) {
  let url;
  try { url = new URL(value); } catch { check(false, 'LIVE_IDENTITY_MISMATCH'); }
  check(url.origin === ORIGIN && url.pathname === path && !url.username && !url.password
    && !url.hash, 'LIVE_IDENTITY_MISMATCH');
  const seen = new Set();
  for (const key of url.searchParams.keys()) {
    check(allowed.includes(key) && !seen.has(key), 'LIVE_IDENTITY_MISMATCH');
    seen.add(key);
  }
  return url.searchParams;
}

function pagination(meta, rows, count, params, sizeKey, options, cap) {
  check(object(meta) && Array.isArray(rows) && object(options));
  const page = integer(meta.current_page), perPage = integer(meta.per_page);
  const total = integer(meta.total), lastPage = integer(meta.last_page);
  check(total <= cap && perPage > 0 && perPage <= 50, 'SOURCE_LIMIT');
  check(page > 0 && lastPage === Math.max(1, Math.ceil(total / perPage)) && page <= lastPage);
  check(integer(options.page) === page && integer(count) === total);
  check(integer(params.get('page') ?? 1) === page);
  if (params.has(sizeKey)) check(integer(params.get(sizeKey)) === perPage);
  if (options.total != null) check(integer(options.total) === total);
  if (options.perPage != null) check(integer(options.perPage) === perPage);
  check(rows.length === Math.min(perPage, Math.max(0, total - (page - 1) * perPage)));
  return { page, perPage, total, lastPage };
}

// Compare wall-clock components before UTC conversion to reject rolled-over dates.
function kstTimestamp(value, midnight = false) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31
    || hour > 23 || minute > 59 || second > 59 || (midnight && (hour || minute || second))) return null;
  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1
    || wall.getUTCDate() !== day) return null;
  return new Date(wall.getTime() - 9 * 3600000).toISOString();
}

function phone(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Do not strip masks, country codes, letters or partial numbers into valid identities.
  return /^(?:010[ -]?\d{4}[ -]?\d{4}|01[16789][ -]?\d{3,4}[ -]?\d{4})$/.test(trimmed)
    ? trimmed.replace(/[ -]/g, '') : null;
}

function ticket(row, memberId) {
  scope(row, memberId, true);
  const userTicketId = nativeId(row.id);
  scope(row.ticket, memberId);
  check(nativeId(row.ticket_id) === nativeId(row.ticket.id), 'LIVE_IDENTITY_MISMATCH');
  check(typeof row.active === 'boolean' && typeof row.ticket_usable === 'boolean'
    && typeof row.is_holding === 'boolean' && (row.is_shared === 0 || row.is_shared === 1));
  const name = label(row.ticket.title), type = label(row.ticket.type);
  check(typeof row.ticket.available_class_type === 'string'
    && row.ticket.available_class_type.length <= 500
    && !/[\u0000-\u001f\u007f]/.test(row.ticket.available_class_type));
  const sourceClass = row.ticket.available_class_type.trim();
  const classType = CLASS_TYPES.get(sourceClass) ?? null;
  let availableFrom = kstTimestamp(row.availability_start_at, true);
  let expiresAt = kstTimestamp(row.expire_at, true);
  if (availableFrom && expiresAt && availableFrom > expiresAt) availableFrom = expiresAt = null;
  return { userTicketId, name, classType, type,
    status: row.is_holding ? '\uc815\uc9c0' : row.active && row.ticket_usable ? 'active' : 'inactive',
    availableFrom, expiresAt,
    remainingCount: type !== 'period' && Number.isSafeInteger(row.remaining_coupon)
      && row.remaining_coupon >= 0 ? row.remaining_coupon : null };
}

// The browser adapter must supply UI-generated GET responses; this module performs no requests.
export function normalizeMemberPage(body, url, options) {
  const params = sourceUrl(url, '/v2/staff/members', ['page', 'limit', 'sort_name', 'with']);
  check(params.get('sort_name') === 'asc' && (params.get('with') ?? '').split(/[;,]/)
    .map(value => value.trim()).includes('tickets.ticket'), 'LIVE_IDENTITY_MISMATCH');
  check(object(body) && object(body.count));
  const meta = pagination(body.meta, body.data, body.count.total_count, params, 'limit', options, 2000);
  const seen = new Set();
  const profiles = Array.from(body.data, row => {
    check(object(row));
    const memberId = nativeId(row.id);
    scope(row, memberId);
    check(!seen.has(memberId), 'LIVE_IDENTITY_MISMATCH');
    seen.add(memberId);
    check(Array.isArray(row.userTickets) && row.userTickets.length <= 100);
    const issued = new Set();
    const activeTickets = Array.from(row.userTickets, raw => {
      const projected = ticket(raw, memberId);
      check(!issued.has(projected.userTicketId), 'LIVE_IDENTITY_MISMATCH');
      issued.add(projected.userTicketId);
      return projected;
    });
    return { _id: memberId, memberId, studioId: STUDIO, name: label(row.name),
      phone: phone(row.mobile), activeTickets };
  });
  return { profiles, ...meta };
}

export function normalizeBookingPage(body, url, options) {
  check(object(options));
  const memberId = nativeId(options.memberId);
  const params = sourceUrl(url, `/staff/member/${memberId}/booking`, ['page', 'per_page', 'with', 'order_by']);
  check(object(body) && object(body.bookings) && object(body.kind));
  const meta = pagination(body.bookings, body.bookings.data, body.kind.total_count,
    params, 'per_page', options, 20000);
  const seen = new Set();
  const records = Array.from(body.bookings.data, row => {
    scope(row, memberId, true);
    const bookingId = nativeId(row.id), userTicketId = nativeId(row.user_ticket_id);
    check(!seen.has(bookingId), 'LIVE_IDENTITY_MISMATCH');
    seen.add(bookingId);
    check(row.deleted_at === null && STATUSES.has(row.status));
    scope(row.lecture, memberId, true);
    check(nativeId(row.lecture_id) === nativeId(row.lecture.id), 'LIVE_IDENTITY_MISMATCH');
    check(['G', 'P'].includes(row.lecture.type) && object(row.lecture.instructor));
    const startAt = kstTimestamp(row.lecture.start_on), endAt = kstTimestamp(row.lecture.end_on);
    check(startAt !== null && endAt !== null && endAt > startAt);
    return { bookingId, userTicketId, lectureDate: row.lecture.start_on.slice(0, 10),
      startAt, endAt, staffName: label(row.lecture.instructor.name),
      lessonType: row.lecture.type === 'G' ? 'group' : 'private', sourceStatus: row.status };
  });
  return { records, ...meta };
}
