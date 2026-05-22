import type { CallableRequest } from "firebase-functions/v2/https";
import { refs } from "../firestore/refs";
import type { PrivateAvailabilitySource, PrivateAvailabilityStatus, StaffDoc } from "../types/models";
import { nowTimestamp } from "../utils/date";
import { AppError } from "../utils/errors";

const STATUSES: PrivateAvailabilityStatus[] = ["available", "confirm", "request", "unavailable"];
const SOURCES: PrivateAvailabilitySource[] = ["manual", "monthly_alimtalk", "weekly_check", "import"];
const AVAILABLE_STATUSES: PrivateAvailabilityStatus[] = ["available", "confirm", "request"];

export async function adminSavePrivateAvailabilitySlotHandler(request: CallableRequest, actor: StaffDoc) {
  const action = clean(request.data?.action, 30);
  if (action === "list") return adminListPrivateAvailabilitySlotsHandler(request, actor);

  const staffId = clean(request.data?.staffId, 80);
  const date = clean(request.data?.date, 20);
  const startTime = clean(request.data?.startTime, 10);
  const endTime = clean(request.data?.endTime || nextHour(startTime), 10);
  const status = clean(request.data?.status, 30) as PrivateAvailabilityStatus;
  const source = clean(request.data?.source || "manual", 40) as PrivateAvailabilitySource;
  const memo = clean(request.data?.memo, 500);

  if (!staffId) throw new AppError("INVALID_ARGUMENT", "강사를 선택하세요");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError("INVALID_ARGUMENT", "날짜 형식이 올바르지 않습니다");
  if (!validTime(startTime) || !validTime(endTime)) throw new AppError("INVALID_ARGUMENT", "시간 형식이 올바르지 않습니다");
  if (toMinutes(endTime) <= toMinutes(startTime)) throw new AppError("INVALID_ARGUMENT", "종료 시간이 시작 시간보다 늦어야 합니다");
  if (!STATUSES.includes(status)) throw new AppError("INVALID_ARGUMENT", "상태값이 올바르지 않습니다");
  if (!SOURCES.includes(source)) throw new AppError("INVALID_ARGUMENT", "출처값이 올바르지 않습니다");

  const staffSnap = await refs.staff(staffId).get();
  const target = staffSnap.data();
  if (!target || !target.active || target.studioId !== actor.studioId) {
    throw new AppError("NOT_FOUND", "선택한 강사를 찾을 수 없습니다");
  }
  if (AVAILABLE_STATUSES.includes(status)) {
    const conflict = await findLectureConflict(actor.studioId, target, date, startTime, endTime);
    if (conflict) {
      throw new AppError(
        "FAILED_PRECONDITION",
        `${target.name} ${date} ${startTime}-${endTime}은 ARCHIVE PILATES 수업 시간입니다`,
      );
    }
  }

  const slotId = `${actor.studioId}_${staffId}_${date}_${startTime.replace(":", "")}`;
  const existing = (await refs.privateAvailabilitySlot(slotId).get()).data();
  const now = nowTimestamp();
  await refs.privateAvailabilitySlot(slotId).set(
    {
      slotId,
      studioId: actor.studioId,
      staffId,
      staffName: target.name,
      date,
      startTime,
      endTime,
      status,
      source,
      memo,
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

export async function adminListPrivateAvailabilitySlotsHandler(request: CallableRequest, actor: StaffDoc) {
  const startDate = clean(request.data?.startDate, 20);
  const endDate = clean(request.data?.endDate, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new AppError("INVALID_ARGUMENT", "조회 기간이 올바르지 않습니다");
  }

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
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function normalizeName(value: unknown): string {
  return String(value || "").replace(/\s+/g, "").trim();
}
