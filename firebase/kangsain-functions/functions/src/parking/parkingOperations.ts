import type { CallableRequest } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { db } from "../config/firebase";
import { requireManager, requireStaff } from "../security/authGuards";
import type { BookingDoc, StaffDoc } from "../types/models";
import { nowTimestamp, todayKst } from "../utils/date";
import { AppError } from "../utils/errors";
import {
  PARKING_DISCOUNT_UNIT_HOURS as DISCOUNT_UNIT_HOURS,
  PARKING_MAX_AUTO_DISCOUNT_HOURS as MAX_AUTO_DISCOUNT_HOURS,
  STAFF_REQUIRED_DISCOUNT_HOURS,
} from "./parkingDiscountPolicy";

const PARKING_VEHICLES = "parkingVehicles";
const PARKING_DISCOUNT_JOBS = "parkingDiscountJobs";
const VEHICLE_MAX_COUNT = 4;
const DISCOUNT_NAME = "2시간 할인";
const APPLY_AFTER_START_MINUTES = 10;
const SCHEDULED_BOOKING_LOOKBACK_MINUTES = 75;

type ParkingOwnerType = "member" | "staff" | "visitor";

type ParkingVehicleDoc = {
  vehicleId: string;
  studioId: string;
  status: "active" | "archived";
  ownerType: ParkingOwnerType;
  ownerId: string;
  ownerName: string;
  ownerPhone: string;
  ownerPhoneLast4: string;
  memberId?: string;
  staffId?: string;
  validDate?: string;
  carNumber: string;
  carNumberLast4: string;
  label: string;
  isDefault: boolean;
  note?: string;
  source: "core_parking";
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  updatedByUid: string;
};

type ResolvedOwner = {
  ownerId: string;
  ownerName: string;
  ownerPhone: string;
  memberId?: string;
  staffId?: string;
  matchStatus: "matched" | "unresolved";
  matchReason: string;
};

type ParkingDashboardVehicle = Pick<
  ParkingVehicleDoc,
  | "vehicleId"
  | "ownerType"
  | "ownerName"
  | "ownerPhone"
  | "memberId"
  | "staffId"
  | "validDate"
  | "carNumber"
  | "carNumberLast4"
  | "label"
  | "status"
  | "updatedAt"
>;

type ParkingDashboardJob = {
  id: string;
  jobId?: string;
  status?: string;
  reason?: string;
  lastError?: string;
  ownerType?: string;
  memberName?: string;
  staffName?: string;
  ownerName?: string;
  carNumberLast4?: string;
  requestedDiscountHours?: number;
  result?: Record<string, unknown>;
  createdAt?: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;
  completedAt?: FirebaseFirestore.Timestamp | null;
};

export async function registerParkingVehicleHandler(request: CallableRequest): Promise<{
  ok: true;
  vehicle: ParkingDashboardVehicle;
  matchStatus: string;
  matchReason: string;
}> {
  const staff = await requireManagerAccess(request);
  const ownerType = parseOwnerType(request.data?.ownerType);
  const ownerName =
    ownerType === "visitor" ? "방문객" : stringValue(request.data?.ownerName || request.data?.name);
  const ownerPhone = ownerType === "visitor" ? "" : digitsOnly(request.data?.ownerPhone || request.data?.phone);
  const carNumber = normalizeCarNumber(request.data?.carNumber);
  const note = stringValue(request.data?.note);
  const validDate = todayKst();

  if (ownerType !== "visitor" && !ownerName && !ownerPhone) throw new AppError("INVALID_ARGUMENT", "이름 또는 연락처가 필요합니다");
  if (!validCarNumber(carNumber)) throw new AppError("INVALID_ARGUMENT", "차량번호를 다시 확인하세요");

  const resolved =
    ownerType === "staff"
      ? await resolveStaffOwner({ staff, ownerName, ownerPhone })
      : ownerType === "visitor"
        ? resolveVisitorOwner({ ownerName, ownerPhone, carNumber, validDate })
        : await resolveMemberOwner({ staff, ownerName, ownerPhone });
  const now = nowTimestamp();
  const vehicleId = parkingVehicleId(ownerType, resolved.ownerId, carNumber);
  const vehicle: ParkingVehicleDoc = {
    vehicleId,
    studioId: staff.studioId || DEFAULT_STUDIO_ID,
    status: "active",
    ownerType,
    ownerId: resolved.ownerId,
    ownerName: resolved.ownerName || ownerName || resolved.ownerPhone || "이름 없음",
    ownerPhone: resolved.ownerPhone || ownerPhone,
    ownerPhoneLast4: digitsOnly(resolved.ownerPhone || ownerPhone).slice(-4),
    memberId: resolved.memberId,
    staffId: resolved.staffId,
    validDate: ownerType === "visitor" ? validDate : undefined,
    carNumber,
    carNumberLast4: carLast4(carNumber),
    label: maskCarNumber(carNumber),
    isDefault: true,
    note,
    source: "core_parking",
    createdAt: now,
    updatedAt: now,
    updatedByUid: request.auth?.uid || "operator",
  };

  await db.runTransaction(async (tx) => {
    const ref = db.collection(PARKING_VEHICLES).doc(vehicleId);
    const current = await tx.get(ref);
    tx.set(
      ref,
      {
        ...vehicle,
        createdAt: current.exists ? current.get("createdAt") || now : now,
      },
      { merge: true },
    );
    if (vehicle.memberId) {
      upsertOwnerVehicleMirror(tx, db.collection("memberProfiles").doc(vehicle.memberId), vehicle);
    }
    if (vehicle.staffId) {
      upsertOwnerVehicleMirror(tx, db.collection("staffs").doc(vehicle.staffId), vehicle);
    }
  });

  return {
    ok: true,
    vehicle: publicVehicle(vehicle),
    matchStatus: resolved.matchStatus,
    matchReason: resolved.matchReason,
  };
}

export async function getParkingDashboardHandler(request: CallableRequest): Promise<{
  ok: true;
  vehicles: ParkingDashboardVehicle[];
  jobs: ParkingDashboardJob[];
  config: {
    discountUnitHours: number;
    maxAutoDiscountHours: number;
    applyAfterStartMinutes: number;
    scheduledBookingLookbackMinutes: number;
  };
}> {
  const staff = await requireManagerAccess(request);
  const [vehicles, jobs] = await Promise.all([
    loadParkingVehicles(staff.studioId || DEFAULT_STUDIO_ID),
    loadRecentParkingJobs(staff.studioId || DEFAULT_STUDIO_ID),
  ]);
  return {
    ok: true,
    vehicles: vehicles.slice(0, 40).map(publicVehicle),
    jobs: jobs.slice(0, 40),
    config: {
      discountUnitHours: DISCOUNT_UNIT_HOURS,
      maxAutoDiscountHours: MAX_AUTO_DISCOUNT_HOURS,
      applyAfterStartMinutes: APPLY_AFTER_START_MINUTES,
      scheduledBookingLookbackMinutes: SCHEDULED_BOOKING_LOOKBACK_MINUTES,
    },
  };
}

export async function removeParkingVehicleHandler(request: CallableRequest): Promise<{
  ok: true;
  vehicleId: string;
  alreadyRemoved: boolean;
  replacementVehicleId: string | null;
}> {
  const staff = await requireManagerAccess(request);
  const vehicleId = stringValue(request.data?.vehicleId);
  if (!/^pv_[A-Za-z0-9_-]{5,116}$/.test(vehicleId)) {
    throw new AppError("INVALID_ARGUMENT", "삭제할 차량 정보를 다시 확인하세요");
  }

  const vehicleRef = db.collection(PARKING_VEHICLES).doc(vehicleId);
  const vehicleSnap = await vehicleRef.get();
  if (!vehicleSnap.exists) throw new AppError("NOT_FOUND", "등록 차량을 찾지 못했습니다");

  const vehicle = vehicleSnap.data() as ParkingVehicleDoc;
  const studioId = staff.studioId || DEFAULT_STUDIO_ID;
  if (vehicle.studioId !== studioId) throw new AppError("PERMISSION_DENIED", "다른 지점 차량은 삭제할 수 없습니다");
  if (vehicle.status === "archived") {
    return { ok: true, vehicleId, alreadyRemoved: true, replacementVehicleId: null };
  }

  const replacement =
    (await loadParkingVehicles(studioId)).find(
      (candidate) =>
        candidate.vehicleId !== vehicleId &&
        candidate.ownerType === vehicle.ownerType &&
        candidate.ownerId === vehicle.ownerId,
    ) || null;
  const now = nowTimestamp();
  let alreadyRemoved = false;

  await db.runTransaction(async (tx) => {
    const currentSnap = await tx.get(vehicleRef);
    if (!currentSnap.exists) throw new AppError("NOT_FOUND", "등록 차량을 찾지 못했습니다");
    const current = currentSnap.data() as ParkingVehicleDoc;
    if (current.status === "archived") {
      alreadyRemoved = true;
      return;
    }

    const ownerRef =
      current.memberId
        ? db.collection("memberProfiles").doc(current.memberId)
        : current.staffId
          ? db.collection("staffs").doc(current.staffId)
          : null;
    const ownerSnap = ownerRef ? await tx.get(ownerRef) : null;

    tx.set(
      vehicleRef,
      {
        status: "archived",
        archivedAt: now,
        archivedByUid: request.auth?.uid || "operator",
        updatedAt: now,
        updatedByUid: request.auth?.uid || "operator",
      },
      { merge: true },
    );

    if (ownerRef && ownerSnap?.exists) {
      const currentMirrors = Array.isArray(ownerSnap.get("vehicles")) ? ownerSnap.get("vehicles") : [];
      const remainingMirrors = currentMirrors.filter(
        (item: Record<string, unknown>) => stringValue(item?.vehicleId) !== vehicleId,
      );
      if (replacement) {
        const otherMirrors = remainingMirrors.filter(
          (item: Record<string, unknown>) => stringValue(item?.vehicleId) !== replacement.vehicleId,
        );
        tx.set(
          ownerRef,
          {
            vehicles: [ownerVehicleMirror(replacement), ...otherMirrors].map((item, index) => ({
              ...item,
              isDefault: index === 0,
            })),
            defaultVehicleNumber: replacement.carNumber,
            defaultVehicleLast4: replacement.carNumberLast4,
            vehicleUpdatedAt: now,
            vehicleUpdatedByUid: request.auth?.uid || "operator",
            updatedAt: now,
          },
          { merge: true },
        );
      } else {
        tx.set(
          ownerRef,
          {
            vehicles: remainingMirrors,
            defaultVehicleNumber: FieldValue.delete(),
            defaultVehicleLast4: FieldValue.delete(),
            vehicleUpdatedAt: now,
            vehicleUpdatedByUid: request.auth?.uid || "operator",
            updatedAt: now,
          },
          { merge: true },
        );
      }
    }
  });

  return {
    ok: true,
    vehicleId,
    alreadyRemoved,
    replacementVehicleId: replacement?.vehicleId || null,
  };
}

export async function runParkingAutoApplyNowHandler(request: CallableRequest): Promise<{
  ok: true;
  date: string;
  created: number;
  existing: number;
  skippedNotDue: number;
  skippedNoVehicle: number;
  candidates: number;
  visitorCandidates: number;
  visitorCreated: number;
  visitorExisting: number;
}> {
  const staff = await requireManagerAccess(request);
  return await createDueParkingDiscountJobs({
    studioId: staff.studioId || DEFAULT_STUDIO_ID,
    requestedByUid: request.auth?.uid || "operator",
    source: "core_parking_manual_run",
    date: String(request.data?.date || todayKst()),
    includeVisitors: true,
    scanMode: "full_day",
  });
}

export async function createDueParkingDiscountJobs(input: {
  studioId?: string;
  requestedByUid?: string;
  source?: string;
  date?: string;
  includeVisitors?: boolean;
  scanMode?: "scheduled_window" | "full_day";
}): Promise<{
  ok: true;
  date: string;
  created: number;
  existing: number;
  skippedNotDue: number;
  skippedNoVehicle: number;
  candidates: number;
  visitorCandidates: number;
  visitorCreated: number;
  visitorExisting: number;
}> {
  const studioId = input.studioId || DEFAULT_STUDIO_ID;
  const date = input.date || todayKst();
  const now = nowTimestamp();
  const nowMs = now.toMillis();
  const scanMode = input.scanMode || "scheduled_window";
  const bookings = await loadParkingCandidateBookings({ studioId, date, nowMs, scanMode });
  if (!bookings.length && !input.includeVisitors) {
    return {
      ok: true,
      date,
      created: 0,
      existing: 0,
      skippedNotDue: 0,
      skippedNoVehicle: 0,
      candidates: 0,
      visitorCandidates: 0,
      visitorCreated: 0,
      visitorExisting: 0,
    };
  }
  const vehicles = await loadParkingVehicles(studioId, date);

  const memberVehicles = vehicles.filter((vehicle) => vehicle.ownerType === "member");
  const staffVehicles = vehicles.filter((vehicle) => vehicle.ownerType === "staff");
  const visitorVehicles = vehicles.filter((vehicle) => vehicle.ownerType === "visitor" && vehicle.validDate === date);
  const queuedMemberKeys = new Set<string>();
  const queuedStaffKeys = new Set<string>();
  let created = 0;
  let existing = 0;
  let skippedNotDue = 0;
  let skippedNoVehicle = 0;
  let candidates = 0;
  let visitorCandidates = 0;
  let visitorCreated = 0;
  let visitorExisting = 0;

  for (const booking of bookings) {
    const startMs = timestampMs(booking.lectureStartAt);
    if (!startMs || nowMs < startMs + APPLY_AFTER_START_MINUTES * 60 * 1000) {
      skippedNotDue += 1;
      continue;
    }
    candidates += 1;

    const memberVehicle = findMemberVehicle(memberVehicles, booking);
    if (memberVehicle) {
      const bookingDate = booking.lectureDate || date;
      const key = `${bookingDate}_${booking.memberId || booking.memberPhone}_${memberVehicle.vehicleId}`;
      if (!queuedMemberKeys.has(key)) {
        queuedMemberKeys.add(key);
        const result = await createParkingJob({
          booking,
          vehicle: memberVehicle,
          jobId: `parking_auto_m_${safeId(key) || hashSmall(key)}`,
          ownerType: "member",
          source: input.source || "core_parking_scheduler",
          requestedByUid: input.requestedByUid || "scheduler",
          now,
        });
        if (result === "created") created += 1;
        else existing += 1;
      }
    } else {
      skippedNoVehicle += 1;
    }

    const staffVehicle = findStaffVehicle(staffVehicles, booking);
    if (staffVehicle) {
      const staffKey = booking.staffId || booking.staffName || "staff";
      const bookingDate = booking.lectureDate || date;
      const key = `${bookingDate}_${staffKey}_${staffVehicle.vehicleId}`;
      if (!queuedStaffKeys.has(key)) {
        queuedStaffKeys.add(key);
        const result = await createParkingJob({
          booking,
          vehicle: staffVehicle,
          jobId: `parking_auto_s_${safeId(key) || hashSmall(key)}`,
          ownerType: "staff",
          source: input.source || "core_parking_scheduler",
          requestedByUid: input.requestedByUid || "scheduler",
          now,
        });
        if (result === "created") created += 1;
        else existing += 1;
      }
    }
  }

  if (input.includeVisitors) {
    visitorCandidates = visitorVehicles.length;
    candidates += visitorCandidates;
    for (const vehicle of visitorVehicles) {
      const key = `${date}_${vehicle.vehicleId}`;
      const result = await createVisitorParkingJob({
        date,
        vehicle,
        jobId: `parking_auto_v_${safeId(key) || hashSmall(key)}`,
        source: input.source || "core_parking_manual_run",
        requestedByUid: input.requestedByUid || "operator",
        now,
      });
      if (result === "created") {
        created += 1;
        visitorCreated += 1;
      } else {
        existing += 1;
        visitorExisting += 1;
      }
    }
  }

  return {
    ok: true,
    date,
    created,
    existing,
    skippedNotDue,
    skippedNoVehicle,
    candidates,
    visitorCandidates,
    visitorCreated,
    visitorExisting,
  };
}

async function loadParkingCandidateBookings(input: {
  studioId: string;
  date: string;
  nowMs: number;
  scanMode: "scheduled_window" | "full_day";
}): Promise<BookingDoc[]> {
  let query: FirebaseFirestore.Query = db
    .collection("bookings")
    .where("studioId", "==", input.studioId)
    .where("appStatus", "==", "reserved");

  if (input.scanMode === "full_day") {
    query = query.where("lectureDate", "==", input.date);
  } else {
    const dueUpperMs = input.nowMs - APPLY_AFTER_START_MINUTES * 60 * 1000;
    const dueLowerMs = dueUpperMs - SCHEDULED_BOOKING_LOOKBACK_MINUTES * 60 * 1000;
    query = query
      .where("lectureStartAt", ">=", Timestamp.fromMillis(dueLowerMs))
      .where("lectureStartAt", "<=", Timestamp.fromMillis(dueUpperMs));
  }

  const snap = await query.get();
  return snap.docs
    .map((doc) => doc.data() as BookingDoc)
    .sort((a, b) => timestampMs(a.lectureStartAt) - timestampMs(b.lectureStartAt));
}

async function requireManagerAccess(request: CallableRequest): Promise<StaffDoc> {
  const staff = await requireStaff(request);
  requireManager(staff);
  return staff;
}

async function resolveMemberOwner(input: {
  staff: StaffDoc;
  ownerName: string;
  ownerPhone: string;
}): Promise<ResolvedOwner> {
  const studioId = input.staff.studioId || DEFAULT_STUDIO_ID;
  const phone = input.ownerPhone;
  const name = input.ownerName;
  const docs: Array<Record<string, unknown>> = [];
  if (phone) {
    const byProfile = await db
      .collection("memberProfiles")
      .where("studioId", "==", studioId)
      .where("phone", "==", phone)
      .limit(3)
      .get();
    docs.push(...byProfile.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    if (!docs.length) {
      const byBooking = await db
        .collection("bookings")
        .where("studioId", "==", studioId)
        .where("memberPhone", "==", phone)
        .limit(10)
        .get();
      docs.push(...byBooking.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    }
  }
  if (!docs.length && name) {
    const byName = await db
      .collection("memberProfiles")
      .where("studioId", "==", studioId)
      .where("name", "==", name)
      .limit(3)
      .get();
    docs.push(...byName.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  }
  const byMemberId = new Map<string, Record<string, unknown>>();
  for (const doc of docs) {
    const memberId = stringValue(doc.memberId || doc.id);
    if (memberId) byMemberId.set(memberId, doc);
  }
  if (byMemberId.size === 1) {
    const [memberId, doc] = [...byMemberId.entries()][0];
    return {
      ownerId: memberId,
      memberId,
      ownerName: stringValue(doc.memberName || doc.name || name),
      ownerPhone: digitsOnly(doc.memberPhone || doc.phone || phone),
      matchStatus: "matched",
      matchReason: "member_exact_match",
    };
  }
  return unresolvedOwner("member", name, phone, byMemberId.size ? "multiple_member_candidates" : "member_not_found");
}

async function resolveStaffOwner(input: {
  staff: StaffDoc;
  ownerName: string;
  ownerPhone: string;
}): Promise<ResolvedOwner> {
  const studioId = input.staff.studioId || DEFAULT_STUDIO_ID;
  const phone = input.ownerPhone;
  const name = input.ownerName;
  const docs: Array<Record<string, unknown>> = [];
  if (phone) {
    const snap = await db
      .collection("staffs")
      .where("studioId", "==", studioId)
      .where("phone", "==", phone)
      .limit(3)
      .get();
    docs.push(...snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  }
  if (!docs.length && name) {
    const snap = await db
      .collection("staffs")
      .where("studioId", "==", studioId)
      .where("name", "==", name)
      .limit(3)
      .get();
    docs.push(...snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  }
  const activeDocs = docs.filter((doc) => doc.active !== false);
  if (activeDocs.length === 1) {
    const doc = activeDocs[0];
    const staffId = stringValue(doc.staffId || doc.id);
    return {
      ownerId: staffId,
      staffId,
      ownerName: stringValue(doc.name || name),
      ownerPhone: digitsOnly(doc.phone || phone),
      matchStatus: "matched",
      matchReason: "staff_exact_match",
    };
  }
  return unresolvedOwner("staff", name, phone, activeDocs.length ? "multiple_staff_candidates" : "staff_not_found");
}

function unresolvedOwner(ownerType: ParkingOwnerType, name: string, phone: string, reason: string): ResolvedOwner {
  const raw = phone || name || ownerType;
  return {
    ownerId: `unresolved_${hashSmall(`${ownerType}_${raw}`)}`,
    ownerName: name,
    ownerPhone: phone,
    matchStatus: "unresolved",
    matchReason: reason,
  };
}

function resolveVisitorOwner(input: {
  ownerName: string;
  ownerPhone: string;
  carNumber: string;
  validDate: string;
}): ResolvedOwner {
  const raw = [input.validDate, input.carNumber].filter(Boolean).join("_");
  return {
    ownerId: `visitor_${input.validDate}_${hashSmall(raw)}`,
    ownerName: input.ownerName || "방문객",
    ownerPhone: input.ownerPhone,
    matchStatus: "matched",
    matchReason: "visitor_one_day",
  };
}

function upsertOwnerVehicleMirror(
  tx: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
  vehicle: ParkingVehicleDoc,
): void {
  tx.set(
    ref,
    {
      vehicles: FieldValue.arrayUnion(ownerVehicleMirror(vehicle)),
      defaultVehicleNumber: vehicle.carNumber,
      defaultVehicleLast4: vehicle.carNumberLast4,
      vehicleUpdatedAt: vehicle.updatedAt,
      vehicleUpdatedByUid: vehicle.updatedByUid,
      updatedAt: vehicle.updatedAt,
    },
    { merge: true },
  );
}

function ownerVehicleMirror(vehicle: ParkingVehicleDoc): Record<string, unknown> {
  return {
    vehicleId: vehicle.vehicleId,
    carNumber: vehicle.carNumber,
    carNumberLast4: vehicle.carNumberLast4,
    label: vehicle.label,
    isDefault: true,
    source: vehicle.source,
    registeredAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
  };
}

async function loadParkingVehicles(studioId: string, date = todayKst()): Promise<ParkingVehicleDoc[]> {
  const snap = await db.collection(PARKING_VEHICLES).where("studioId", "==", studioId).where("status", "==", "active").limit(500).get();
  return snap.docs
    .map((doc) => doc.data() as ParkingVehicleDoc)
    .filter((vehicle) => vehicle.ownerType !== "visitor" || vehicle.validDate === date)
    .sort((a, b) => timestampMs(b.updatedAt) - timestampMs(a.updatedAt));
}

async function loadRecentParkingJobs(studioId: string): Promise<ParkingDashboardJob[]> {
  const snap = await db.collection(PARKING_DISCOUNT_JOBS).where("studioId", "==", studioId).limit(200).get();
  return snap.docs
    .map((doc) => ({ ...(doc.data() as ParkingDashboardJob), id: doc.id }))
    .sort((a, b) => timestampMs(b.updatedAt || b.createdAt) - timestampMs(a.updatedAt || a.createdAt));
}

function findMemberVehicle(vehicles: ParkingVehicleDoc[], booking: BookingDoc): ParkingVehicleDoc | null {
  const byId = vehicles.find((vehicle) => vehicle.memberId && vehicle.memberId === booking.memberId);
  if (byId) return byId;
  const phone = digitsOnly(booking.memberPhone);
  return vehicles.find((vehicle) => vehicle.ownerPhone && digitsOnly(vehicle.ownerPhone) === phone) || null;
}

function findStaffVehicle(vehicles: ParkingVehicleDoc[], booking: BookingDoc): ParkingVehicleDoc | null {
  const byId = vehicles.find((vehicle) => vehicle.staffId && vehicle.staffId === booking.staffId);
  if (byId) return byId;
  const staffName = stringValue(booking.staffName);
  return vehicles.find((vehicle) => vehicle.ownerName === staffName) || null;
}

async function createParkingJob(input: {
  booking: BookingDoc;
  vehicle: ParkingVehicleDoc;
  jobId: string;
  ownerType: ParkingOwnerType;
  source: string;
  requestedByUid: string;
  now: FirebaseFirestore.Timestamp;
}): Promise<"created" | "existing"> {
  const ref = db.collection(PARKING_DISCOUNT_JOBS).doc(input.jobId);
  const snap = await ref.get();
  if (snap.exists) return "existing";
  const requestedDiscountHours =
    input.ownerType === "staff" ? STAFF_REQUIRED_DISCOUNT_HOURS : MAX_AUTO_DISCOUNT_HOURS;
  await ref.create({
    jobId: input.jobId,
    status: "pending",
    dryRun: false,
    studioId: input.booking.studioId,
    ownerType: input.ownerType,
    memberId: input.ownerType === "member" ? input.booking.memberId || input.vehicle.memberId || "" : "",
    memberName: input.ownerType === "member" ? input.booking.memberName || input.vehicle.ownerName : "",
    staffId: input.booking.staffId,
    staffName: input.booking.staffName,
    bookingId: input.booking.bookingId,
    lectureId: input.booking.lectureId,
    lessonDate: input.booking.lectureDate,
    lectureStartAt: input.booking.lectureStartAt || null,
    carNumber: input.vehicle.carNumber,
    carNumberLast4: input.vehicle.carNumberLast4,
    expectedCarNumber: input.vehicle.carNumber,
    discountName: DISCOUNT_NAME,
    parkingPolicy: input.ownerType === "staff" ? "staff_fixed_4h" : "standard",
    requestedDiscountHours,
    maxAutoDiscountHours: MAX_AUTO_DISCOUNT_HOURS,
    discountUnitHours: DISCOUNT_UNIT_HOURS,
    requestedBy: input.requestedByUid,
    source: input.source,
    autoApplyDelayMinutes: APPLY_AFTER_START_MINUTES,
    autoApplyDueAt: dueTimestamp(input.booking.lectureStartAt),
    createdAt: input.now,
    updatedAt: input.now,
  });
  return "created";
}

async function createVisitorParkingJob(input: {
  date: string;
  vehicle: ParkingVehicleDoc;
  jobId: string;
  source: string;
  requestedByUid: string;
  now: FirebaseFirestore.Timestamp;
}): Promise<"created" | "existing"> {
  const ref = db.collection(PARKING_DISCOUNT_JOBS).doc(input.jobId);
  const snap = await ref.get();
  if (snap.exists) return "existing";
  await ref.create({
    jobId: input.jobId,
    status: "pending",
    dryRun: false,
    studioId: input.vehicle.studioId,
    ownerType: "visitor",
    ownerId: input.vehicle.ownerId,
    ownerName: input.vehicle.ownerName || "방문객",
    visitorName: input.vehicle.ownerName || "방문객",
    lessonDate: input.date,
    carNumber: input.vehicle.carNumber,
    carNumberLast4: input.vehicle.carNumberLast4,
    expectedCarNumber: input.vehicle.carNumber,
    discountName: DISCOUNT_NAME,
    requestedDiscountHours: MAX_AUTO_DISCOUNT_HOURS,
    maxAutoDiscountHours: MAX_AUTO_DISCOUNT_HOURS,
    discountUnitHours: DISCOUNT_UNIT_HOURS,
    requestedBy: input.requestedByUid,
    source: input.source,
    validDate: input.vehicle.validDate || input.date,
    createdAt: input.now,
    updatedAt: input.now,
  });
  return "created";
}

function publicVehicle(vehicle: ParkingVehicleDoc): ParkingDashboardVehicle {
  const isVisitor = vehicle.ownerType === "visitor";
  return {
    vehicleId: vehicle.vehicleId,
    ownerType: vehicle.ownerType,
    ownerName: isVisitor ? "방문객" : vehicle.ownerName,
    ownerPhone: isVisitor ? "" : vehicle.ownerPhone,
    memberId: vehicle.memberId,
    staffId: vehicle.staffId,
    validDate: vehicle.validDate,
    carNumber: vehicle.carNumber,
    carNumberLast4: vehicle.carNumberLast4,
    label: vehicle.label,
    status: vehicle.status,
    updatedAt: vehicle.updatedAt,
  };
}

function parseOwnerType(value: unknown): ParkingOwnerType {
  const raw = stringValue(value);
  if (raw === "staff" || raw === "visitor") return raw;
  return "member";
}

function dueTimestamp(value: FirebaseFirestore.Timestamp | null | undefined): FirebaseFirestore.Timestamp | null {
  const ms = timestampMs(value);
  if (!ms) return null;
  return Timestamp.fromMillis(ms + APPLY_AFTER_START_MINUTES * 60 * 1000);
}

function timestampMs(value: unknown): number {
  if (!value) return 0;
  if (typeof (value as { toMillis?: unknown }).toMillis === "function") return (value as FirebaseFirestore.Timestamp).toMillis();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function parkingVehicleId(ownerType: ParkingOwnerType, ownerId: string, carNumber: string): string {
  return `pv_${ownerType}_${safeId(ownerId) || hashSmall(ownerId)}_${hashSmall(carNumber)}`;
}

function normalizeCarNumber(value: unknown): string {
  return stringValue(value).replace(/[\s-]/g, "").toUpperCase();
}

function validCarNumber(value: string): boolean {
  return value.length >= 6 && value.length <= 12 && /\d{4}$/.test(value);
}

function carLast4(value: string): string {
  return value.replace(/\D/g, "").slice(-4);
}

function maskCarNumber(value: string): string {
  const normalized = normalizeCarNumber(value);
  if (normalized.length <= 4) return normalized;
  return `${normalized.slice(0, -4)} ${normalized.slice(-4)}`;
}

function hashSmall(value: string): string {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(36).slice(0, 8);
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function safeId(value: unknown): string {
  const id = stringValue(value).replace(/[^A-Za-z0-9_-]/g, "_");
  return id.length >= 4 && id.length <= 120 ? id : "";
}

function digitsOnly(value: unknown): string {
  return stringValue(value).replace(/\D/g, "");
}
