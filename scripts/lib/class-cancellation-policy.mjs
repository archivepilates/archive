import { isDeepStrictEqual } from "node:util";

const VERSION = "class_cancellation_policy_v1";
const MAX_ROWS = 1000;
const MINUTE = 60_000;
const DAY = 1440 * MINUTE;
const EXCLUDED = new Set([
  "강사레슨", "강사레슨(team)", "야외수업", "workshop", "신규강사 체험",
  "프라이빗 그룹", "키즈 그룹", "아카이브 레벨링",
]);
const CATEGORIES = new Set(["그룹", "프라이빗", ...EXCLUDED]);
const TYPES = new Set(["그룹", "프라이빗"]);
const IDENTITY = ["date", "startTime", "staffName", "lessonType", "category", "title", "room"];
// Keep trusted source/calendar snapshots private. Serialized plans must be prepared again.
const prepared = new WeakMap();
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const blocked = reason => ({ status: "blocked", reason });

function dateMillis(value) {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)
    || value.startsWith("0000")) return NaN;
  const millis = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value ? millis : NaN;
}

function timeMinutes(value) {
  if (typeof value !== "string" || !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) return NaN;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

function nativeDeadline(value) {
  if (typeof value !== "string") return null;
  const match = /^([0-9]{4}-[0-9]{2}-[0-9]{2}) ((?:[01][0-9]|2[0-3]):[0-5][0-9]):([0-5][0-9])(?: ?까지)?$/.exec(value);
  return match && Number.isFinite(dateMillis(match[1])) ? `${match[1]} ${match[2]}:${match[3]}` : null;
}

function identityError(row) {
  if (!record(row)) return "invalid_row";
  if (!Number.isFinite(dateMillis(row.date))) return "invalid_date";
  if (!Number.isFinite(timeMinutes(row.startTime))) return "invalid_start_time";
  for (const field of IDENTITY) {
    if (!Object.hasOwn(row, field) || typeof row[field] !== "string"
      || (field !== "room" && !row[field].trim()
        && !(field === "category" && row.lessonType === "프라이빗" && row.category === ""))) return `invalid_${field}`;
  }
  if (!TYPES.has(row.lessonType)) return "unknown_lesson_type";
  if (!CATEGORIES.has(row.category) && !(row.lessonType === "프라이빗" && row.category === "")) return "unknown_category";
  if (row.lessonType === "그룹" && row.category === "프라이빗") return "ambiguous_class_category";
  if (Object.hasOwn(row, "cancelDeadline") && nativeDeadline(row.cancelDeadline) === null) return "invalid_cancel_deadline";
  return null;
}

function key(row) {
  return JSON.stringify(IDENTITY.map(field => row[field]));
}

function calendarError(calendar, date) {
  if (!record(calendar)) return "verified_calendar_required";
  if (!Number.isFinite(dateMillis(calendar.from)) || !Number.isFinite(dateMillis(calendar.through))
    || calendar.from > calendar.through || !Array.isArray(calendar.dates)
    || typeof calendar.sourceReference !== "string" || !calendar.sourceReference.trim()
    || typeof calendar.verifiedAt !== "string") return "malformed_calendar";
  const stamp = /^([0-9]{4}-[0-9]{2}-[0-9]{2})T((?:[01][0-9]|2[0-3]):[0-5][0-9]):[0-5][0-9](?:\.[0-9]{1,3})?(Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/.exec(calendar.verifiedAt);
  if (!stamp || !Number.isFinite(dateMillis(stamp[1])) || !Number.isFinite(Date.parse(calendar.verifiedAt))) return "malformed_calendar";
  const dates = new Set();
  for (const holiday of calendar.dates) {
    if (!Number.isFinite(dateMillis(holiday)) || holiday < calendar.from || holiday > calendar.through || dates.has(holiday)) return "malformed_calendar";
    dates.add(holiday);
  }
  if (date < calendar.from || date > calendar.through) return "calendar_outside_coverage";
  return null;
}

function normalizeCalendar(calendar) {
  if (!record(calendar) || calendarError(calendar, calendar.from)) return calendar;
  return { from: calendar.from, through: calendar.through, dates: [...calendar.dates].sort(),
    sourceReference: calendar.sourceReference.trim(), verifiedAt: new Date(calendar.verifiedAt).toISOString() };
}

export function evaluateClassCancellation(row, { calendar } = {}) {
  const reason = identityError(row);
  if (reason) return blocked(reason);
  if (row.lessonType === "프라이빗" || EXCLUDED.has(row.category)) return { status: "excluded" };
  const day = dateMillis(row.date);
  const weekend = [0, 6].includes(new Date(day).getUTCDay());
  if (!weekend) {
    const error = calendarError(calendar, row.date);
    if (error) return blocked(error);
  }
  const previousDay = weekend || calendar.dates.includes(row.date);
  const start = timeMinutes(row.startTime);
  const lead = previousDay ? start + 180 : 360;
  // These UTC values are calendar arithmetic coordinates for KST wall-clock text.
  const deadline = new Date(day + (previousDay ? -DAY + 21 * 60 * MINUTE : (start - lead) * MINUTE));
  const text = deadline.toISOString();
  if (!Number.isFinite(dateMillis(text.slice(0, 10)))) return blocked("deadline_out_of_range");
  return {
    status: "enforce",
    rule: previousDay ? "previous_day_21" : "weekday_6_hours",
    expectedDeadline: `${text.slice(0, 10)} ${text.slice(11, 16)}:00`,
    leadHours: Math.floor(lead / 60),
    leadMinutes: lead % 60,
  };
}

export function prepareClassCancellationPlan(rows, { operation, calendar } = {}) {
  const plan = { ok: false, version: VERSION, operation: operation ?? null, rows: [], batches: [], blocked: [],
    readOnly: true, requiresNativeReadback: true };
  if (!["create", "copy", "edit"].includes(operation)) {
    plan.blocked.push({ index: null, reason: "invalid_operation" });
    return plan;
  }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    plan.blocked.push({ index: null, reason: "invalid_row_count" });
    return plan;
  }
  let source;
  let calendarSnapshot;
  try {
    source = Array.from(structuredClone(rows));
    calendarSnapshot = normalizeCalendar(structuredClone(calendar));
  } catch {
    plan.blocked.push({ index: null, reason: "uncloneable_input" });
    return plan;
  }
  if (calendarSnapshot !== undefined) plan.calendar = structuredClone(calendarSnapshot);
  const results = Array.from(source, row => evaluateClassCancellation(row, { calendar: calendarSnapshot }));
  const counts = new Map();
  source.forEach((row, index) => {
    if (results[index].status !== "blocked") counts.set(key(row), (counts.get(key(row)) || 0) + 1);
  });
  const batches = new Map();
  source.forEach((row, index) => {
    const result = results[index];
    const output = structuredClone(row);
    plan.rows.push(output);
    const reason = result.status === "blocked" ? result.reason : counts.get(key(row)) > 1 ? "duplicate_class_key" : null;
    if (reason) {
      plan.blocked.push({ index, reason });
      return;
    }
    if (result.status === "enforce") {
      const { rule, leadHours, leadMinutes, expectedDeadline } = result;
      output.cancellation = { deadline: expectedDeadline, leadHours, leadMinutes, rule };
      const batchKey = JSON.stringify([rule, leadHours, leadMinutes]);
      if (!batches.has(batchKey)) batches.set(batchKey, { rule, leadHours, leadMinutes, keys: [] });
      batches.get(batchKey).keys.push(key(row));
    }
  });
  plan.batches = [...batches.values()];
  plan.ok = plan.blocked.length === 0;
  if (plan.ok) prepared.set(plan, { source, calendar: calendarSnapshot, snapshot: structuredClone(plan) });
  return plan;
}

export function assertClassCancellationDraft(preparedPlan, draftRows) {
  const binding = record(preparedPlan) && prepared.get(preparedPlan);
  if (!binding || !isDeepStrictEqual(preparedPlan, binding.snapshot)) throw new Error("invalid_or_tampered_prepared_plan");
  const recomputed = prepareClassCancellationPlan(binding.source, {
    operation: binding.snapshot.operation, calendar: binding.calendar,
  });
  if (!recomputed.ok || !isDeepStrictEqual(recomputed, binding.snapshot)) throw new Error("invalid_prepared_policy");
  if (!Array.isArray(draftRows) || draftRows.length !== preparedPlan.rows.length) throw new Error("draft_row_count_mismatch");
  const expected = new Map(preparedPlan.rows.map(row => [key(row), row]));
  const seen = new Set();
  let enforcedCount = 0;
  for (const row of draftRows) {
    const reason = identityError(row);
    if (reason) throw new Error(`invalid_draft_row:${reason}`);
    const classKey = key(row);
    if (seen.has(classKey)) throw new Error("duplicate_draft_class_key");
    seen.add(classKey);
    const planned = expected.get(classKey);
    if (!planned) throw new Error("unexpected_draft_class_key");
    const result = evaluateClassCancellation(row, { calendar: binding.calendar });
    if (result.status === "enforce") {
      if (nativeDeadline(row.cancelDeadline) !== result.expectedDeadline) throw new Error("draft_cancellation_deadline_mismatch");
      if (Object.hasOwn(row, "cancellation") && !isDeepStrictEqual(row.cancellation, planned.cancellation)) {
        throw new Error("draft_cancellation_fields_mismatch");
      }
      enforcedCount++;
    } else if (result.status !== "excluded" || row.cancelDeadline !== planned.cancelDeadline
      || !isDeepStrictEqual(row.cancellation, planned.cancellation)) {
      throw new Error("excluded_draft_settings_changed");
    }
  }
  return { ok: true, version: VERSION, operation: preparedPlan.operation, verification: "draft_only",
    rowCount: draftRows.length, enforcedCount, excludedCount: draftRows.length - enforcedCount,
    readOnly: true, requiresNativeReadback: true };
}
