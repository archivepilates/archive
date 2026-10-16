import { createHash } from "node:crypto";

const TICKET_NAME = "강사레슨 (2T)";
const STATUSES = new Set(["reserved", "waiting", "cancelled", "attended", "absent", "noshow"]);
const ACTIVE = new Set(["reserved", "waiting"]);
const requireValue = (condition, reason) => {
  if (!condition) throw new Error(`Instructor cancellation: ${reason}`);
};
const record = (value) => value !== null && typeof value === "object"
  && Object.getPrototypeOf(value) === Object.prototype;
const text = (value) => typeof value === "string" && value.trim() === value && value.length > 0;

function nativeId(value) {
  requireValue((typeof value === "string" && /^[1-9]\d{0,63}$/.test(value))
    || (Number.isSafeInteger(value) && value > 0), "invalid native ID");
  return String(value);
}

function day(value) {
  requireValue(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value), "invalid date");
  const instant = Date.parse(`${value}T00:00:00Z`);
  requireValue(Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value,
    "invalid date");
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    requireValue(Object.keys(value).length === value.length, "incomplete JSON array");
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  requireValue(record(value), "invalid JSON evidence");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function fingerprint(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function freeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function normalizeJob(job) {
  requireValue(record(job), "missing job");
  const studioId = nativeId(job.studioId);
  requireValue(studioId === "5330", "wrong studio");
  requireValue(text(job.memberName) && typeof job.memberPhone === "string"
    && /^010\d{8}$/.test(job.memberPhone), "invalid member name or phone");
  requireValue(job.ticketName === TICKET_NAME, "wrong ticket name");
  requireValue(typeof job.reason === "string" && job.reason.trim().length >= 2
    && job.reason.trim().length <= 200, "invalid reason");
  return {
    studioId, memberId: nativeId(job.memberId), memberName: job.memberName, memberPhone: job.memberPhone,
    lessonDate: day(job.lessonDate), ticketName: TICKET_NAME, reason: job.reason.trim(),
    expectedTicketId: job.expectedTicketId == null ? null : nativeId(job.expectedTicketId),
  };
}

function normalizeSnapshot(snapshot, job) {
  requireValue(record(snapshot) && snapshot.complete === true && record(snapshot.member), "incomplete snapshot");
  const member = { ...snapshot.member, memberId: nativeId(snapshot.member.memberId),
    studioId: nativeId(snapshot.member.studioId) };
  requireValue(member.memberId === job.memberId && member.studioId === job.studioId
    && member.name === job.memberName && member.phone === job.memberPhone, "member identity mismatch");
  requireValue(Array.isArray(snapshot.tickets), "incomplete ticket list");
  const ids = new Set();
  const tickets = snapshot.tickets.map((ticket) => {
    requireValue(record(ticket), "invalid ticket");
    const row = { ...ticket, userTicketId: nativeId(ticket.userTicketId), productId: nativeId(ticket.productId),
      memberId: nativeId(ticket.memberId), studioId: nativeId(ticket.studioId) };
    requireValue(row.memberId === job.memberId && row.studioId === job.studioId, "ticket ownership mismatch");
    requireValue(!ids.has(row.userTicketId), "duplicate issued ticket ID");
    ids.add(row.userTicketId);
    return row;
  }).sort((a, b) => a.userTicketId.localeCompare(b.userTicketId));
  const bookings = snapshot.bookings;
  requireValue(record(bookings) && bookings.complete === true && Array.isArray(bookings.rows)
    && Number.isSafeInteger(bookings.total) && bookings.total >= 0 && bookings.total <= 2
    && bookings.rows.length === bookings.total, "incomplete or excessive booking list");
  const keys = new Set();
  const rows = bookings.rows.map((row) => {
    requireValue(record(row) && text(row.key) && !keys.has(row.key), "invalid or duplicate booking key");
    keys.add(row.key);
    requireValue(day(row.date) === job.lessonDate, "out-of-scope booking date");
    requireValue(typeof row.startTime === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.startTime)
      && text(row.title) && text(row.staff) && STATUSES.has(row.status), "unknown booking evidence");
    return { ...row };
  }).sort((a, b) => a.key.localeCompare(b.key));
  // Detach all caller-owned evidence before freezing or retaining it in a plan.
  return JSON.parse(canonicalJson({ member, complete: true, tickets,
    bookings: { complete: true, total: bookings.total, rows } }));
}

function selectTarget(snapshot, job) {
  const matches = snapshot.tickets.filter((ticket) => ticket.title === TICKET_NAME
    && day(ticket.availabilityStartAt) <= job.lessonDate && day(ticket.expireAt) >= job.lessonDate);
  requireValue(matches.length === 1, "missing or ambiguous same-day pass");
  const target = matches[0];
  requireValue(day(target.availabilityStartAt) === job.lessonDate && day(target.expireAt) === job.lessonDate,
    "wrong pass period");
  requireValue(job.expectedTicketId === null || target.userTicketId === job.expectedTicketId,
    "expected issued ticket ID mismatch");
  requireValue(target.isShared === false && target.maxCoupon === 2 && target.remainingCoupon === 2,
    "shared, unknown or consumed pass");
  requireValue(text(target.paymentFingerprint), "missing payment fingerprint");
  return target;
}

export function buildInstructorCancellationPlan(job, snapshot, now = new Date()) {
  requireValue(now instanceof Date && Number.isFinite(now.getTime()), "invalid clock");
  const input = normalizeJob(job);
  const today = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  requireValue(input.lessonDate >= today, "past lesson date");
  const before = normalizeSnapshot(snapshot, input);
  const target = selectTarget(before, input);
  requireValue(target.usable === true, "pass is not usable");
  for (const row of before.bookings.rows) {
    requireValue(ACTIVE.has(row.status) || row.status === "cancelled", "booking has attendance or consumption");
    if (ACTIVE.has(row.status)) {
      requireValue(Date.parse(`${row.date}T${row.startTime}:00+09:00`) >= now.getTime(),
        "active booking already started");
    }
  }
  const evidence = { job: input, snapshot: before, plannedAt: now.toISOString(), userTicketId: target.userTicketId,
    productId: target.productId, bookingCount: before.bookings.total,
    activeBookingCount: before.bookings.rows.filter((row) => ACTIVE.has(row.status)).length };
  return freeze({ ...evidence, fingerprint: fingerprint(evidence) });
}

export function assertInstructorCancellationReadback(plan, after) {
  requireValue(record(plan), "missing cancellation plan");
  const rebuilt = buildInstructorCancellationPlan(plan.job, plan.snapshot, new Date(plan.plannedAt));
  requireValue(canonicalJson(rebuilt) === canonicalJson(plan), "plan fingerprint or evidence mismatch");
  const observed = normalizeSnapshot(after, plan.job);
  requireValue(canonicalJson(observed.member) === canonicalJson(plan.snapshot.member), "member readback changed");
  requireValue(observed.tickets.length === plan.snapshot.tickets.length, "ticket set changed or target missing");
  const target = observed.tickets.find((ticket) => ticket.userTicketId === plan.userTicketId);
  requireValue(target && target.usable === false, "target retirement not verified");
  for (const before of plan.snapshot.tickets) {
    const current = observed.tickets.find((ticket) => ticket.userTicketId === before.userTicketId);
    requireValue(current, "ticket missing from readback");
    const expected = before.userTicketId === plan.userTicketId ? { ...before, usable: false } : before;
    requireValue(canonicalJson(current) === canonicalJson(expected), "pass period, payment or ticket evidence changed");
  }
  const expectedBookings = { ...plan.snapshot.bookings,
    rows: plan.snapshot.bookings.rows.map((row) => ({ ...row, status: "cancelled" })) };
  requireValue(canonicalJson(observed.bookings) === canonicalJson(expectedBookings),
    "reservation cascade incomplete or booking evidence changed");
  return freeze({ nativeVerified: true, userTicketId: plan.userTicketId, productId: plan.productId,
    bookingCount: plan.bookingCount, cancelledBookingCount: plan.activeBookingCount,
    paymentUnchanged: true, unrelatedTicketsUnchanged: true, fingerprint: plan.fingerprint });
}
