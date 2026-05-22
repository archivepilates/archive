import type { CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { TIMEZONE } from "../config/constants";
import { refs } from "../firestore/refs";
import type { PrivateAvailabilitySource, PrivateAvailabilityStatus, StaffDoc } from "../types/models";
import { nowTimestamp } from "../utils/date";
import { AppError } from "../utils/errors";

const STATUSES: PrivateAvailabilityStatus[] = ["available", "confirm", "request", "unavailable"];
const SOURCES: PrivateAvailabilitySource[] = ["manual", "monthly_alimtalk", "weekly_check", "import"];
const AVAILABLE_STATUSES: PrivateAvailabilityStatus[] = ["available", "confirm", "request"];
const TIME_ROWS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
const EXCLUDED_INSTRUCTOR_NAMES = new Set(["운영자", "김기효"]);
const FALLBACK_STAFF_COLORS = ["#6d7d58", "#426b8f", "#9b5148", "#a8742a", "#6f5f91", "#2f6fa3", "#7b6f46", "#8b5d5d"];

interface BusyRow {
  id: string;
  kind: "lecture" | "other";
  date: string;
  start: string;
  end: string;
  title: string;
  status: string;
  studioId: string;
  staffIds: string[];
  staffNames: string[];
}

interface ResolvedInstructor {
  staffId: string;
  name: string;
  role: string;
  active: boolean;
  color: string;
}

export async function adminSavePrivateAvailabilitySlotHandler(request: CallableRequest, actor: StaffDoc) {
  const action = clean(request.data?.action, 30);
  if (action === "list") return adminListPrivateAvailabilitySlotsHandler(request, actor);
  if (action === "getWeek") return adminGetPrivateScheduleWeekHandler(request, actor);
  if (action === "updateSlots") return adminUpdatePrivateAvailabilitySlotsHandler(request, actor);

  const { payload, target, existing } = await validateSlotPayload(request.data || {}, actor);
  const slotId = `${actor.studioId}_${payload.staffId}_${payload.date}_${payload.startTime.replace(":", "")}`;
  const now = nowTimestamp();
  await refs.privateAvailabilitySlot(slotId).set(
    {
      slotId,
      studioId: actor.studioId,
      staffId: payload.staffId,
      staffName: target.name,
      date: payload.date,
      startTime: payload.startTime,
      endTime: payload.endTime,
      status: payload.status,
      source: payload.source,
      memo: payload.memo,
      checkedAt: now,
      checkedByUid: request.auth?.uid || "",
      createdByUid: existing?.createdByUid || request.auth?.uid || "",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    },
    { merge: true },
  );
  return { ok: true, slotId };
}

export async function adminGetPrivateScheduleWeekHandler(request: CallableRequest, actor: StaffDoc) {
  const startDate = clean(request.data?.startDate, 20);
  const endDate = clean(request.data?.endDate, 20);
  validateDateRange(startDate, endDate);

  const [staffSnap, lectureSnap, otherSnap, availabilitySnap] = await Promise.all([
    refs.staffs().get(),
    refs.lectures().where("date", ">=", startDate).where("date", "<=", endDate).get(),
    db.collection("otherSchedules").where("date", ">=", startDate).where("date", "<=", endDate).get(),
    refs.privateAvailabilitySlots().where("date", ">=", startDate).where("date", "<=", endDate).get(),
  ]);

  const instructors = staffSnap.docs
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter(({ data }) => data.studioId === actor.studioId && data.active && data.role !== "viewer" && !EXCLUDED_INSTRUCTOR_NAMES.has(data.name))
    .map(({ id, data }) => ({
      staffId: data.staffId || id,
      name: data.name,
      role: data.role,
      active: data.active,
      color: staffColorFromData(data, id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const lectures = lectureSnap.docs
    .map((doc) => normalizeBusy(doc.id, doc.data() as unknown as Record<string, unknown>, "lecture"))
    .filter((row) => row.studioId === actor.studioId)
    .filter((row) => row.status !== "deleted");
  const otherSchedules = otherSnap.docs
    .map((doc) => normalizeBusy(doc.id, doc.data(), "other"))
    .filter((row) => row.studioId === actor.studioId)
    .filter((row) => row.status !== "deleted");
  const manualSlots = new Map(
    availabilitySnap.docs
      .map((doc) => doc.data())
      .filter((slot) => slot.studioId === actor.studioId)
      .map((slot) => [`${slot.staffId}_${slot.date}_${slot.startTime}`, slot] as const),
  );

  const slots = datesBetween(startDate, endDate).flatMap((date) =>
    TIME_ROWS.flatMap((time) =>
      instructors.map((instructor) =>
        buildResolvedSlot({
          instructor,
          date,
          time,
          lectures,
          otherSchedules,
          manualSlot: manualSlots.get(`${instructor.staffId}_${date}_${time}`),
        }),
      ),
    ),
  );

  return {
    instructors,
    slots,
    generatedAt: new Date().toISOString(),
    source: "server_resolved",
  };
}

export async function adminUpdatePrivateAvailabilitySlotsHandler(request: CallableRequest, actor: StaffDoc) {
  const rawSlots = Array.isArray(request.data?.slots) ? request.data.slots : [];
  if (!rawSlots.length) throw new AppError("INVALID_ARGUMENT", "저장할 슬롯이 없습니다");
  if (rawSlots.length > 500) throw new AppError("INVALID_ARGUMENT", "한 번에 저장할 슬롯은 500개 이하로 선택하세요");

  const rows = await Promise.all(
    rawSlots.map((raw: Record<string, unknown>) => validateSlotPayload(raw, actor, { skipLectureConflicts: true })),
  );
  const skipped = rows.filter((row) => row.skipped);
  const targets = rows.filter((row) => !row.skipped);
  const now = nowTimestamp();
  const batch = db.batch();
  targets.forEach(({ payload, target, existing }) => {
    const slotId = `${actor.studioId}_${payload.staffId}_${payload.date}_${payload.startTime.replace(":", "")}`;
    batch.set(
      refs.privateAvailabilitySlot(slotId),
      {
        slotId,
        studioId: actor.studioId,
        staffId: payload.staffId,
        staffName: target.name,
        date: payload.date,
        startTime: payload.startTime,
        endTime: payload.endTime,
        status: payload.status,
        source: payload.source,
        memo: payload.memo,
        checkedAt: now,
        checkedByUid: request.auth?.uid || "",
        createdByUid: existing?.createdByUid || request.auth?.uid || "",
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      },
      { merge: true },
    );
  });
  if (targets.length) await batch.commit();
  return {
    ok: true,
    savedCount: targets.length,
    skippedCount: skipped.length,
    skipped: skipped.map((row) => row.reason).filter(Boolean),
  };
}

export async function adminListPrivateAvailabilitySlotsHandler(request: CallableRequest, actor: StaffDoc) {
  const startDate = clean(request.data?.startDate, 20);
  const endDate = clean(request.data?.endDate, 20);
  validateDateRange(startDate, endDate);

  const snap = await refs
    .privateAvailabilitySlots()
    .where("date", ">=", startDate)
    .where("date", "<=", endDate)
    .orderBy("date")
    .limit(2000)
    .get();

  return {
    slots: snap.docs
      .map((doc) => doc.data())
      .filter((slot) => slot.studioId === actor.studioId)
      .map((slot) => ({
        slotId: slot.slotId,
        staffId: slot.staffId,
        staffName: slot.staffName,
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        status: slot.status,
        source: slot.source,
        memo: slot.memo,
        checkedAt: slot.checkedAt?.toDate().toISOString() || "",
      })),
  };
}

export async function adminDeletePrivateAvailabilitySlotHandler(request: CallableRequest, actor: StaffDoc) {
  const slotId = clean(request.data?.slotId, 180);
  if (!slotId) throw new AppError("INVALID_ARGUMENT", "slotId가 필요합니다");
  const ref = refs.privateAvailabilitySlot(slotId);
  const snap = await ref.get();
  const slot = snap.data();
  if (!slot) return { ok: true, deleted: false };
  if (slot.studioId !== actor.studioId) throw new AppError("PERMISSION_DENIED", "다른 지점 슬롯은 삭제할 수 없습니다");
  await ref.delete();
  return { ok: true, deleted: true };
}

async function validateSlotPayload(
  raw: Record<string, unknown>,
  actor: StaffDoc,
  options: { skipLectureConflicts?: boolean } = {},
) {
  const payload = {
    staffId: clean(raw?.staffId, 80),
    date: clean(raw?.date, 20),
    startTime: clean(raw?.startTime, 10),
    endTime: clean(raw?.endTime || nextHour(clean(raw?.startTime, 10)), 10),
    status: clean(raw?.status, 30) as PrivateAvailabilityStatus,
    source: clean(raw?.source || "manual", 40) as PrivateAvailabilitySource,
    memo: clean(raw?.memo, 500),
  };
  if (!payload.staffId) throw new AppError("INVALID_ARGUMENT", "강사를 선택하세요");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) throw new AppError("INVALID_ARGUMENT", "날짜 형식이 올바르지 않습니다");
  if (!validTime(payload.startTime) || !validTime(payload.endTime)) throw new AppError("INVALID_ARGUMENT", "시간 형식이 올바르지 않습니다");
  if (toMinutes(payload.endTime) <= toMinutes(payload.startTime)) {
    throw new AppError("INVALID_ARGUMENT", "종료 시간이 시작 시간보다 늦어야 합니다");
  }
  if (!STATUSES.includes(payload.status)) throw new AppError("INVALID_ARGUMENT", "상태값이 올바르지 않습니다");
  if (!SOURCES.includes(payload.source)) throw new AppError("INVALID_ARGUMENT", "출처값이 올바르지 않습니다");

  const staffSnap = await refs.staff(payload.staffId).get();
  const target = staffSnap.data();
  if (!target || !target.active || target.studioId !== actor.studioId) {
    throw new AppError("NOT_FOUND", "선택한 강사를 찾을 수 없습니다");
  }
  if (AVAILABLE_STATUSES.includes(payload.status)) {
    const centerClosed = await isCenterClosed(actor.studioId, payload.date);
    if (centerClosed) {
      const reason = `${payload.date} 센터 휴일`;
      if (options.skipLectureConflicts) return { skipped: true, reason, payload, target, existing: undefined };
      throw new AppError("FAILED_PRECONDITION", `${payload.date}은 센터 휴일입니다`);
    }
    const conflict = await findLectureConflict(actor.studioId, target, payload.date, payload.startTime, payload.endTime);
    if (conflict) {
      const reason = `${target.name} ${payload.date} ${payload.startTime}-${payload.endTime} ARCHIVE PILATES 수업 시간`;
      if (options.skipLectureConflicts) {
        return { skipped: true, reason, payload, target, existing: undefined };
      }
      throw new AppError(
        "FAILED_PRECONDITION",
        `${target.name} ${payload.date} ${payload.startTime}-${payload.endTime}은 ARCHIVE PILATES 수업 시간입니다`,
      );
    }
  }

  const slotId = `${actor.studioId}_${payload.staffId}_${payload.date}_${payload.startTime.replace(":", "")}`;
  const existing = (await refs.privateAvailabilitySlot(slotId).get()).data();
  return { skipped: false, payload, target, existing };
}

function validateDateRange(startDate: string, endDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new AppError("INVALID_ARGUMENT", "조회 기간이 올바르지 않습니다");
  }
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    throw new AppError("INVALID_ARGUMENT", "조회 기간이 올바르지 않습니다");
  }
  if ((end.getTime() - start.getTime()) / 86400000 > 62) {
    throw new AppError("INVALID_ARGUMENT", "조회 기간은 62일 이하로 선택하세요");
  }
}

function datesBetween(startDate: string, endDate: string): string[] {
  const result: string[] = [];
  const end = new Date(`${endDate}T00:00:00Z`);
  for (let cursor = new Date(`${startDate}T00:00:00Z`); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    result.push(cursor.toISOString().slice(0, 10));
  }
  return result;
}

function buildResolvedSlot({
  instructor,
  date,
  time,
  lectures,
  otherSchedules,
  manualSlot,
}: {
  instructor: ResolvedInstructor;
  date: string;
  time: string;
  lectures: BusyRow[];
  otherSchedules: BusyRow[];
  manualSlot?: {
    slotId: string;
    startTime: string;
    endTime: string;
    status: PrivateAvailabilityStatus;
    source: PrivateAvailabilitySource;
    memo: string;
    checkedAt: FirebaseFirestore.Timestamp | null;
  };
}) {
  const endTime = nextHour(time);
  const archiveBusy = lectures.filter((item) => busyMatches(item, instructor, date, time, endTime));
  if (archiveBusy.length) {
    return {
      type: "busy",
      lockedByLecture: true,
      instructor,
      date,
      time,
      endTime,
      reason: archiveBusy.map((item) => `ARCHIVE PILATES 수업 · ${item.title}`).join(" / "),
      source: "ARCHIVE PILATES 수업",
      checkedAt: "",
    };
  }

  if (!hasAnyLectureOnDate(lectures, date)) {
    return {
      type: "unavailable",
      lockedByCenterHoliday: true,
      instructor,
      date,
      time,
      endTime,
      memo: "",
      sourceKey: "manual",
      source: "센터 휴일",
      checkedAt: "자동 불가",
    };
  }

  if (manualSlot) {
    const type = manualSlot.status === "unavailable" ? "unavailable" : manualSlot.status;
    return {
      type,
      slotId: manualSlot.slotId,
      instructor,
      date,
      time,
      endTime: manualSlot.endTime || endTime,
      memo: manualSlot.memo || "",
      sourceKey: manualSlot.source || "manual",
      source: sourceLabel(manualSlot.source),
      checkedAt: manualSlot.checkedAt?.toDate().toISOString() || "수동 확인",
    };
  }

  if (!hasLectureOnDate(lectures, instructor, date)) {
    return {
      type: "unavailable",
      autoUnavailable: true,
      instructor,
      date,
      time,
      endTime,
      memo: "",
      sourceKey: "manual",
      source: "ARCHIVE PILATES 수업 없는 날",
      checkedAt: "자동 불가",
    };
  }

  const otherBusy = otherSchedules.filter((item) => busyMatches(item, instructor, date, time, endTime));
  if (otherBusy.length) {
    return {
      type: "busy",
      instructor,
      date,
      time,
      endTime,
      reason: otherBusy.map((item) => `외부/기타 일정 · ${item.title}`).join(" / "),
      source: "기타 일정",
      checkedAt: "",
    };
  }

  return {
    type: "available",
    virtual: true,
    instructor,
    date,
    time,
    endTime,
    memo: "",
    sourceKey: "manual",
    source: "센터 수업 외 우선 가능",
    checkedAt: "알림톡 확인 전",
  };
}

function normalizeBusy(id: string, data: Record<string, unknown>, kind: "lecture" | "other"): BusyRow {
  const staffNames = Array.isArray(data.staffNames) && data.staffNames.length ? data.staffNames : [data.staffName];
  const staffIds = Array.isArray(data.staffIds) && data.staffIds.length ? data.staffIds : [data.staffId];
  return {
    id,
    kind,
    date: String(data.date || ""),
    start: timestampToTime(data.startAt as FirebaseFirestore.Timestamp | null | undefined),
    end: timestampToTime(data.endAt as FirebaseFirestore.Timestamp | null | undefined),
    title: String(data.title || data.divisionName || data.category || (kind === "lecture" ? "ARCHIVE PILATES 수업" : "기타 일정")),
    status: String(data.status || "scheduled"),
    studioId: String(data.studioId || ""),
    staffIds: staffIds.filter(Boolean).map(String),
    staffNames: staffNames.filter(Boolean).map(String),
  };
}

function hasLectureOnDate(lectures: BusyRow[], instructor: { staffId: string; name: string }, date: string): boolean {
  return lectures.some((lecture) => {
    if (lecture.date !== date) return false;
    return lecture.staffIds.includes(instructor.staffId) || lecture.staffNames.map(normalizeName).includes(normalizeName(instructor.name));
  });
}

function hasAnyLectureOnDate(lectures: BusyRow[], date: string): boolean {
  return lectures.some((lecture) => lecture.date === date);
}

async function isCenterClosed(studioId: string, date: string): Promise<boolean> {
  const snap = await refs.lectures().where("date", "==", date).get();
  return !snap.docs.some((doc) => {
    const lecture = doc.data();
    return lecture.studioId === studioId && String(lecture.status || "").toLowerCase() !== "deleted";
  });
}

function busyMatches(
  busy: BusyRow,
  instructor: { staffId: string; name: string },
  date: string,
  startTime: string,
  endTime: string,
): boolean {
  if (busy.date !== date || !rangesOverlap(startTime, endTime, busy.start, busy.end)) return false;
  return busy.staffIds.includes(instructor.staffId) || busy.staffNames.map(normalizeName).includes(normalizeName(instructor.name));
}

function sourceLabel(source: PrivateAvailabilitySource): string {
  if (source === "monthly_alimtalk") return "월간 알림톡";
  if (source === "weekly_check") return "주간 확인";
  if (source === "import") return "가져오기";
  return "수동 입력";
}

function staffColorFromData(data: StaffDoc, fallbackKey = ""): string {
  const candidates = [
    data.privateScheduleColor,
    data.archiveInColor,
    data.scheduleColor,
    data.calendarColor,
    data.lessonColor,
    data.color,
    data.themeColor,
    data.backgroundColor,
    data.hexColor,
  ];
  const value = candidates.find(isHexColor);
  return value || colorFromKey(data.staffId || data.name || fallbackKey);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function colorFromKey(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return FALLBACK_STAFF_COLORS[hash % FALLBACK_STAFF_COLORS.length];
}

function clean(value: unknown, max: number): string {
  return String(value || "").trim().slice(0, max);
}

function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function toMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function nextHour(value: string): string {
  if (!validTime(value)) return "";
  const min = toMinutes(value) + 60;
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

async function findLectureConflict(
  studioId: string,
  staff: StaffDoc,
  date: string,
  startTime: string,
  endTime: string,
): Promise<boolean> {
  const snap = await refs.lectures().where("studioId", "==", studioId).where("date", "==", date).get();
  const staffNames = new Set([staff.name, ...(staff.visibleLectureStaffNames || [])].map(normalizeName).filter(Boolean));
  return snap.docs.some((doc) => {
    const lecture = doc.data();
    if (String(lecture.status || "").toLowerCase() === "deleted") return false;
    const sameStaff = lecture.staffId === staff.staffId || staffNames.has(normalizeName(lecture.staffName));
    if (!sameStaff) return false;
    return rangesOverlap(startTime, endTime, timestampToTime(lecture.startAt), timestampToTime(lecture.endAt));
  });
}

function rangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const aStart = toMinutes(startA);
  const aEnd = toMinutes(endA || startA);
  const bStart = toMinutes(startB);
  const bEnd = toMinutes(endB || startB);
  return aStart < bEnd && bStart < aEnd;
}

function timestampToTime(value: FirebaseFirestore.Timestamp | null | undefined): string {
  if (!value) return "";
  const date = value.toDate();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value || "00";
  const minute = parts.find((part) => part.type === "minute")?.value || "00";
  return `${hour}:${minute}`;
}

function normalizeName(value: unknown): string {
  return String(value || "").replace(/\s+/g, "").trim();
}
