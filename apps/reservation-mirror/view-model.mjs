import {DateTime} from 'luxon';
export const ENTITIES = ['members', 'entitlements', 'bookings', 'occurrences', 'staff', 'products'];
const text = (v) => typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 200) : null;
const first = (...v) => v.find((x) => x !== undefined && x !== null && x !== '') ?? null;
const num = (...v) => { const x = first(...v); return x !== null && Number.isFinite(Number(x)) ? Number(x) : null; };
const stamp = (v) => v?.toDate ? v.toDate().toISOString() : typeof v === 'string' ? v : null;
const day = (v) => { const s = stamp(v); if (!s) return null; const d = DateTime.fromISO(s, {zone: 'Asia/Seoul'}).setZone('Asia/Seoul'); return d.isValid ? d.toISODate() : null; };
const key = (v) => (text(v) || '').normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
const group = (s) => ['booked', 'booking_confirmed', 'booking_waiting'].includes(s) ? 'booked' : ['attendance', 'absence', 'noshow', 'checkIn'].includes(s) ? 'after' : 'other';
function bookingStatus(r) {
  const attendance = r.attendanceStatus;
  if (['attended', 'attendance', 'present'].includes(attendance)) return 'attendance';
  if (['absent', 'absence'].includes(attendance)) return 'absence';
  if (['noshow', 'no_show'].includes(attendance)) return 'noshow';
  const s = text(first(r.status, r.appStatus, r.bookingStatus, r.state, r.sourceStatus));
  return ({cancelled: 'cancel', canceled: 'cancel', waiting: 'booking_waiting', wait: 'booking_waiting', reserved: 'booked', confirmed: 'booking_confirmed', attended: 'attendance', absent: 'absence'})[s] || s;
}
const base = (id, r) => ({id, sourceId: text(r.id) || id});
export function viewModel(entity, id, r, context = {}) {
  const p = r.profile || {}, ticket = r.ticket || {}, member = r.member || {}, lecture = r.lecture || {};
  let row;
  if (entity === 'members') row = {...base(id, r), name: text(first(r.name, p.name, r.memberName)), phone: text(first(r.phone, r.mobile, p.mobile)), status: text(first(r.status, r.memberStatus)), nativeId: text(first(r.studiomateMemberId, r.nativeMemberId)), sourceUpdatedAt: stamp(first(r.sourceUpdatedAt, r.updatedAt, r.updated_at))};
  if (entity === 'entitlements') row = {...base(id, r), memberId: text(first(context.memberId, r.memberId, r.member_id, r.user_id, r.user?.id)), memberName: text(first(context.memberName, r.memberName, member.profile?.name, member.name)), title: text(first(r.title, r.name, r.ticketName, ticket.title)), productType: text(first(r.productType, ticket.type)), availableClassType: text(first(r.availableClassType, r.available_class_type, r.classType, ticket.available_class_type)), totalUnits: num(r.totalUnits, r.max_coupon, r.maxCount), remainingUnits: num(r.remainingUnits, r.remaining_coupon, r.remainingCount), bookableUnits: num(r.bookableUnits, r.usable_coupon, r.usableCount), cancellableUnits: num(r.cancellableUnits, r.remaining_cancel, r.cancelableCount), validFrom: stamp(first(r.validFrom, r.availability_start_at, r.availableFrom, r.startDate)), validThrough: stamp(first(r.validThrough, r.expire_at, r.expiresAt, r.endDate)), status: text(first(r.status, r.ticket_usable_status, r.ticketStatus)), holding: typeof first(r.is_holding, r.holding) === 'boolean' ? first(r.is_holding, r.holding) : null, weeklyLimit: num(r.booking_limit_per_week, ticket.booking_limit_per_week), monthlyLimit: num(r.booking_limit_per_month, ticket.booking_limit_per_month)};
  if (entity === 'bookings') { const status = text(first(r.status, r.sourceStatus, r.appStatus, r.bookingStatus, r.state)); const startAt = stamp(first(r.startAt, r.start_on, r.lessonStartAt, lecture.start_on, r.lectureStartAt)); row = {...base(id, r), memberId: text(first(r.memberId, member.id, r.member_id)), memberName: text(first(r.memberName, member.profile?.name, member.name)), occurrenceId: text(first(r.occurrenceId, r.lectureId, lecture.id, r.lecture_id)), title: text(first(r.title, r.lessonTitle, r.lectureTitle, lecture.course?.title, r.course?.title)), startAt, endAt: stamp(first(r.endAt, r.end_on, r.lectureEndAt, lecture.end_on)), staffName: text(first(r.staffName, r.instructorName, lecture.staff?.profile?.name, r.staff?.profile?.name)), status, statusGroup: group(status), localDate: text(first(r.localDate, r.lessonDate, r.lectureDate, day(startAt)))}; }
  if (entity === 'occurrences') { const startAt = stamp(first(r.startAt, r.start_on, r.lessonStartAt)); row = {...base(id, r), title: text(first(r.title, r.lessonTitle, r.course?.title)), startAt, endAt: stamp(first(r.endAt, r.end_on)), localDate: text(first(r.localDate, r.date, r.lessonDate, day(startAt))), staffName: text(first(r.staffName, r.instructorName, r.staff?.profile?.name, r.staff?.name)), roomName: text(first(r.roomName, r.room?.title, r.room?.name)), capacity: num(r.capacity, r.max_trainee), occupiedCount: num(r.occupiedCount, r.current_trainee_count, r.bookingCount), waitingCount: num(r.waitingCount, r.current_waiting_count, r.waitCount), state: text(first(r.state, r.status))}; }
  if (entity === 'staff') row = {...base(id, r), name: text(first(r.name, p.name)), active: typeof first(r.active, r.isActive) === 'boolean' ? first(r.active, r.isActive) : null};
  if (entity === 'products') row = {...base(id, r), title: text(first(r.title, r.name)), productType: text(first(r.productType, r.type)), availableClassType: text(first(r.availableClassType, r.available_class_type)), totalUnits: num(r.totalUnits, r.max_coupon), weeklyLimit: num(r.weeklyLimit, r.booking_limit_per_week), monthlyLimit: num(r.monthlyLimit, r.booking_limit_per_month)};
  if (!row) throw new Error('Unsupported entity');
  if (entity === 'bookings') { row.status = bookingStatus(r); row.statusGroup = group(row.status); }
  row.nameKey = key(first(row.name, row.memberName, row.title));
  return row;
}
export function publicRow(row) {
  const allowed = ['id', 'name', 'phone', 'status', 'sourceUpdatedAt', 'memberId', 'memberName', 'title', 'productType', 'availableClassType', 'totalUnits', 'remainingUnits', 'bookableUnits', 'cancellableUnits', 'validFrom', 'validThrough', 'holding', 'weeklyLimit', 'monthlyLimit', 'occurrenceId', 'startAt', 'endAt', 'staffName', 'localDate', 'roomName', 'capacity', 'occupiedCount', 'waitingCount', 'state', 'active', 'sourceAsOf', 'identityKind', 'sourceType'];
  const safe = Object.fromEntries(allowed.filter(k => Object.hasOwn(row, k)).map(k => [k, row[k]]));
  if (['issued_pass_product_reference', 'derived_label_not_product_master'].includes(row.sourceType)) safe.totalUnits = null;
  return safe;
}
