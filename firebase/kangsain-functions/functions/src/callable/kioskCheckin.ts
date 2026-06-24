import type { CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { getBooking } from "../firestore/bookingRepository";
import { refs } from "../firestore/refs";
import { rebuildInstructorView } from "../sync/rebuildInstructorViews";
import { requireManager, requireStaff } from "../security/authGuards";
import type { BookingDoc, MemberProfileDoc } from "../types/models";
import { todayKst, nowTimestamp } from "../utils/date";
import { AppError } from "../utils/errors";

const PARKING_DISCOUNT_JOBS = "parkingDiscountJobs";
const CHECKIN_EVENTS = "checkinEvents";
const VEHICLE_MAX_COUNT = 4;
const PARKING_DISCOUNT_UNIT_HOURS = 2;
const PARKING_MAX_AUTO_DISCOUNT_HOURS = 4;

type KioskAccess = {
  studioId: string;
  actorUid: string;
};

type VehicleRecord = {
  vehicleId: string;
  carNumber: string;
  carNumberLast4: string;
  label: string;
  isDefault: boolean;
  source: "core_checkin";
  registeredAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};

type CheckinBookingResult = {
  bookingId: string;
  memberId: string;
  memberName: string;
  memberPhoneLast4: string;
  lectureId: string;
  lessonTitle: string;
  lessonType: string;
  staffName: string;
  startAtText: string;
  endAtText: string;
  attendanceStatus: string;
  appStatus: string;
  ticketName: string;
  alreadyCheckedIn: boolean;
  parkingDiscountJobId?: string;
  parkingStatus?: string;
  parkingReason?: string;
};

type CheckinMemberResult = {
  memberId: string;
  memberName: string;
  phoneLast4: string;
  vehicles: Array<{
    vehicleId: string;
    carNumber: string;
    carNumberLast4: string;
    label: string;
    isDefault: boolean;
  }>;
  bookings: CheckinBookingResult[];
};

export async function lookupKioskCheckinHandler(
  request: CallableRequest,
): Promise<{ ok: true; date: string; matches: CheckinMemberResult[] }> {
  const access = await requireKioskAccess(request);
  const phoneLast4 = digitsOnly(request.data?.phoneLast4);
  if (!/^\d{4}$/.test(phoneLast4)) throw new AppError("INVALID_ARGUMENT", "휴대폰번호 뒤 4자리가 필요합니다");

  const date = String(request.data?.date || todayKst());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError("INVALID_ARGUMENT", "조회 날짜가 올바르지 않습니다");

  const snap = await refs.bookings().where("studioId", "==", access.studioId).where("lectureDate", "==", date).get();
  const rows = snap.docs
    .map((doc) => doc.data())
    .filter((booking) => booking.appStatus === "reserved")
    .filter((booking) => digitsOnly(booking.memberPhone).endsWith(phoneLast4))
    .sort((a, b) => toMillis(a.lectureStartAt) - toMillis(b.lectureStartAt));

  const memberIds = [...new Set(rows.map((booking) => booking.memberId).filter(Boolean))];
  const profiles = new Map<string, MemberProfileDoc>();
  await Promise.all(
    memberIds.map(async (memberId) => {
      const profile = await refs.memberProfile(memberId).get();
      const data = profile.data();
      if (profile.exists && data) profiles.set(memberId, data);
    }),
  );

  const byMember = new Map<string, CheckinMemberResult>();
  for (const booking of rows) {
    const memberId = booking.memberId || `phone_${phoneLast4}`;
    const profile = profiles.get(memberId);
    const entry =
      byMember.get(memberId) ||
      ({
        memberId,
        memberName: booking.memberName || profile?.name || "회원",
        phoneLast4,
        vehicles: publicVehicles(profile),
        bookings: [],
      } satisfies CheckinMemberResult);
    entry.bookings.push(publicBooking(booking));
    byMember.set(memberId, entry);
  }

  return { ok: true, date, matches: [...byMember.values()] };
}

export async function submitKioskCheckinHandler(request: CallableRequest): Promise<{
  ok: true;
  bookingId: string;
  attendanceStatus: "attended";
  attendanceJobId: null;
  checkinEventId: string;
  studioMateWriteStatus: "not_requested";
  parkingDiscountJobId: string | null;
  vehicleSaved: boolean;
}> {
  const access = await requireKioskAccess(request);
  const bookingId = stringValue(request.data?.bookingId);
  const memberId = stringValue(request.data?.memberId);
  const carNumber = normalizeCarNumber(request.data?.carNumber);
  const saveVehicle = request.data?.saveVehicle !== false && Boolean(carNumber);
  const applyParking = request.data?.applyParking !== false && Boolean(carNumber);

  if (!bookingId || !memberId) throw new AppError("INVALID_ARGUMENT", "예약과 회원 정보가 필요합니다");
  const booking = await getBooking(bookingId);
  if (!booking) throw new AppError("INVALID_ARGUMENT", "예약을 찾을 수 없습니다");
  if (booking.studioId !== access.studioId && booking.studioId !== DEFAULT_STUDIO_ID) {
    throw new AppError("PERMISSION_DENIED", "다른 지점 예약은 처리할 수 없습니다");
  }
  if (booking.memberId !== memberId) throw new AppError("INVALID_ARGUMENT", "예약 회원 정보가 일치하지 않습니다");
  if (booking.appStatus !== "reserved")
    throw new AppError("INVALID_ARGUMENT", "예약확정 수업만 출석체크할 수 있습니다");
  if (booking.lectureDate !== todayKst()) throw new AppError("INVALID_ARGUMENT", "오늘 예약만 출석체크할 수 있습니다");
  if (carNumber && !validCarNumber(carNumber)) throw new AppError("INVALID_ARGUMENT", "차량번호를 다시 확인하세요");

  const now = nowTimestamp();
  let vehicleSaved = false;
  if (saveVehicle) {
    await saveMemberVehicle({ memberId, carNumber, uid: access.actorUid, now });
    vehicleSaved = true;
  }

  const parkingDiscountJobId = applyParking ? parkingJobId(booking.bookingId, carNumber) : null;
  await markBookingCheckedInAndMaybeCreateParkingJob({
    booking,
    bookingId,
    carNumber,
    uid: access.actorUid,
    now,
    parkingDiscountJobId,
  });

  await rebuildInstructorView({ studioId: booking.studioId, staffId: booking.staffId, date: booking.lectureDate });

  return {
    ok: true,
    bookingId,
    attendanceStatus: "attended",
    attendanceJobId: null,
    checkinEventId: checkinEventId(booking.bookingId),
    studioMateWriteStatus: "not_requested",
    parkingDiscountJobId,
    vehicleSaved,
  };
}

export async function getKioskParkingJobStatusHandler(request: CallableRequest): Promise<{
  ok: true;
  jobId: string;
  status: string;
  reason: string;
  lastError: string;
}> {
  const access = await requireKioskAccess(request);
  const jobId = stringValue(request.data?.jobId);
  if (!jobId) throw new AppError("INVALID_ARGUMENT", "주차등록 작업 ID가 필요합니다");

  const snap = await db.collection(PARKING_DISCOUNT_JOBS).doc(jobId).get();
  const job = snap.data() as
    | {
        studioId?: string;
        status?: string;
        reason?: string;
        lastError?: string;
      }
    | undefined;
  if (!snap.exists || !job) throw new AppError("INVALID_ARGUMENT", "주차등록 작업을 찾지 못했습니다");
  if (job.studioId && job.studioId !== access.studioId) {
    throw new AppError("PERMISSION_DENIED", "다른 지점 주차등록 작업은 확인할 수 없습니다");
  }

  return {
    ok: true,
    jobId,
    status: stringValue(job.status || "pending"),
    reason: stringValue(job.reason),
    lastError: stringValue(job.lastError),
  };
}

async function requireKioskAccess(request: CallableRequest): Promise<KioskAccess> {
  if (request.auth?.uid) {
    const staff = await requireStaff(request);
    requireManager(staff);
    return {
      studioId: staff.studioId || DEFAULT_STUDIO_ID,
      actorUid: request.auth.uid,
    };
  }
  return {
    studioId: DEFAULT_STUDIO_ID,
    actorUid: "public-checkin",
  };
}

function publicBooking(booking: BookingDoc): CheckinBookingResult {
  const extra = booking as unknown as Record<string, unknown>;
  return {
    bookingId: booking.bookingId,
    memberId: booking.memberId,
    memberName: booking.memberName,
    memberPhoneLast4: digitsOnly(booking.memberPhone).slice(-4),
    lectureId: booking.lectureId,
    lessonTitle: booking.ticketName || booking.lessonType || "수업",
    lessonType: booking.lessonType || "unknown",
    staffName: booking.staffName,
    startAtText: timeText(booking.lectureStartAt),
    endAtText: timeText(booking.lectureEndAt),
    attendanceStatus: booking.attendanceStatus,
    appStatus: booking.appStatus,
    ticketName: booking.ticketName,
    alreadyCheckedIn: booking.attendanceStatus === "attended" || Boolean(extra.kioskCheckinAt),
    parkingDiscountJobId: stringValue(extra.parkingDiscountJobId),
    parkingStatus: stringValue(extra.parkingStatus),
    parkingReason: stringValue(extra.parkingReason),
  };
}

function publicVehicles(profile?: MemberProfileDoc): CheckinMemberResult["vehicles"] {
  const rawVehicles = Array.isArray((profile as unknown as { vehicles?: unknown[] })?.vehicles)
    ? (profile as unknown as { vehicles: VehicleRecord[] }).vehicles || []
    : [];
  return rawVehicles
    .filter((vehicle) => vehicle?.carNumber)
    .slice(0, VEHICLE_MAX_COUNT)
    .map((vehicle) => ({
      vehicleId: vehicle.vehicleId,
      carNumber: vehicle.carNumber,
      carNumberLast4: vehicle.carNumberLast4 || carLast4(vehicle.carNumber),
      label: vehicle.label || maskCarNumber(vehicle.carNumber),
      isDefault: Boolean(vehicle.isDefault),
    }));
}

async function saveMemberVehicle(input: {
  memberId: string;
  carNumber: string;
  uid: string;
  now: FirebaseFirestore.Timestamp;
}): Promise<void> {
  const profileRef = db.collection("memberProfiles").doc(input.memberId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(profileRef);
    const profile = snap.data() as (MemberProfileDoc & { vehicles?: VehicleRecord[] }) | undefined;
    const current = Array.isArray(profile?.vehicles) ? profile?.vehicles || [] : [];
    const vehicleId = `vehicle_${carLast4(input.carNumber)}_${hashSmall(input.carNumber)}`;
    const nextVehicle: VehicleRecord = {
      vehicleId,
      carNumber: input.carNumber,
      carNumberLast4: carLast4(input.carNumber),
      label: maskCarNumber(input.carNumber),
      isDefault: true,
      source: "core_checkin",
      registeredAt: current.find((vehicle) => vehicle.vehicleId === vehicleId)?.registeredAt || input.now,
      updatedAt: input.now,
    };
    const nextVehicles = [nextVehicle, ...current.filter((vehicle) => vehicle.vehicleId !== vehicleId)]
      .slice(0, VEHICLE_MAX_COUNT)
      .map((vehicle, index) => ({ ...vehicle, isDefault: index === 0 }));
    tx.set(
      profileRef,
      {
        memberId: input.memberId,
        vehicles: nextVehicles,
        defaultVehicleNumber: input.carNumber,
        defaultVehicleLast4: carLast4(input.carNumber),
        vehicleUpdatedAt: input.now,
        vehicleUpdatedByUid: input.uid,
        updatedAt: input.now,
      },
      { merge: true },
    );
  });
}

async function markBookingCheckedInAndMaybeCreateParkingJob(input: {
  booking: BookingDoc;
  bookingId: string;
  carNumber: string;
  uid: string;
  now: FirebaseFirestore.Timestamp;
  parkingDiscountJobId: string | null;
}): Promise<void> {
  const bookingRef = db.collection("bookings").doc(input.bookingId);
  const checkinEventRef = db.collection(CHECKIN_EVENTS).doc(checkinEventId(input.booking.bookingId));
  const jobRef = input.parkingDiscountJobId
    ? db.collection(PARKING_DISCOUNT_JOBS).doc(input.parkingDiscountJobId)
    : null;
  await db.runTransaction(async (tx) => {
    const checkinEventSnap = await tx.get(checkinEventRef);
    if (jobRef && input.parkingDiscountJobId) {
      const snap = await tx.get(jobRef);
      if (!snap.exists) {
        tx.create(jobRef, {
          jobId: input.parkingDiscountJobId,
          status: "pending",
          dryRun: false,
          studioId: input.booking.studioId,
          memberId: input.booking.memberId,
          memberName: input.booking.memberName,
          bookingId: input.booking.bookingId,
          lectureId: input.booking.lectureId,
          lessonDate: input.booking.lectureDate,
          carNumber: input.carNumber,
          carNumberLast4: carLast4(input.carNumber),
          expectedCarNumber: input.carNumber,
          discountName: "2시간 할인",
          requestedDiscountHours: PARKING_MAX_AUTO_DISCOUNT_HOURS,
          maxAutoDiscountHours: PARKING_MAX_AUTO_DISCOUNT_HOURS,
          discountUnitHours: PARKING_DISCOUNT_UNIT_HOURS,
          requestedBy: input.uid,
          source: "core_checkin",
          createdAt: input.now,
          updatedAt: input.now,
        });
      }
    }
    tx.set(
      bookingRef,
      {
        attendanceStatus: "attended",
        kioskCheckinAt: input.now,
        kioskCheckinByUid: input.uid,
        kioskCheckinSource: "core_checkin",
        kioskCheckinWriteMode: "core_only",
        studioMateAttendanceWriteStatus: "not_requested",
        studioMateAttendanceWriteReason: "studiomate_api_disabled",
        parkingDiscountJobId: input.parkingDiscountJobId,
        parkingCarLast4: input.carNumber ? carLast4(input.carNumber) : "",
        parkingStatus: input.parkingDiscountJobId ? "pending" : "not_requested",
        lastChangedBy: input.uid,
        updatedAt: input.now,
      },
      { merge: true },
    );
    tx.set(
      checkinEventRef,
      {
        eventId: checkinEventRef.id,
        status: "done",
        studioId: input.booking.studioId,
        memberId: input.booking.memberId,
        memberName: input.booking.memberName,
        bookingId: input.booking.bookingId,
        lectureId: input.booking.lectureId,
        lessonDate: input.booking.lectureDate,
        lectureStartAt: input.booking.lectureStartAt || null,
        staffId: input.booking.staffId,
        staffName: input.booking.staffName,
        attendanceStatus: "attended",
        source: "core_checkin",
        writeMode: "core_only",
        studioMateWriteStatus: "not_requested",
        studioMateWriteReason: "studiomate_api_disabled",
        parkingDiscountJobId: input.parkingDiscountJobId,
        parkingCarLast4: input.carNumber ? carLast4(input.carNumber) : "",
        checkedInByUid: input.uid,
        checkedInAt: input.now,
        updatedAt: input.now,
        ...(checkinEventSnap.exists ? { repeatedAt: input.now } : { createdAt: input.now }),
      },
      { merge: true },
    );
  });
}

function checkinEventId(bookingId: string): string {
  return `checkin_${safeId(bookingId) || hashSmall(bookingId)}`;
}

function parkingJobId(bookingId: string, carNumber: string): string {
  return `parking_${bookingId}_${carLast4(carNumber)}`;
}

function timeText(value: FirebaseFirestore.Timestamp | null | undefined): string {
  if (!value) return "";
  const date = value.toDate();
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace("24:", "00:");
}

function toMillis(value: FirebaseFirestore.Timestamp | null | undefined): number {
  return value?.toMillis?.() || 0;
}

function normalizeCarNumber(value: unknown): string {
  return stringValue(value).replace(/[\s-]/g, "").toUpperCase();
}

function carLast4(value: string): string {
  return value.replace(/\D/g, "").slice(-4);
}

function validCarNumber(value: string): boolean {
  return value.length >= 6 && value.length <= 12 && /\d{4}$/.test(value);
}

function maskCarNumber(value: string): string {
  const normalized = normalizeCarNumber(value);
  if (normalized.length <= 4) return normalized;
  return `${normalized.slice(0, -4)} ${normalized.slice(-4)}`;
}

function hashSmall(value: string): string {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(36).slice(0, 6);
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function safeId(value: unknown): string {
  const id = stringValue(value);
  return /^[A-Za-z0-9_-]{4,80}$/.test(id) ? id : "";
}

function digitsOnly(value: unknown): string {
  return stringValue(value).replace(/\D/g, "");
}
