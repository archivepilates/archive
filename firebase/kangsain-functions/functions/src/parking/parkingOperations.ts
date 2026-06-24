import type { CallableRequest } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { db } from "../config/firebase";
import { requireManager, requireStaff } from "../security/authGuards";
import type { BookingDoc, StaffDoc } from "../types/models";
import { nowTimestamp, todayKst } from "../utils/date";
import { AppError } from "../utils/errors";

const PARKING_VEHICLES = "parkingVehicles";
const PARKING_DISCOUNT_JOBS = "parkingDiscountJobs";
const VEHICLE_MAX_COUNT = 4;
const DISCOUNT_NAME = "2시간 할인";
const DISCOUNT_UNIT_HOURS = 2;
const MAX_AUTO_DISCOUNT_HOURS = 4;
const APPLY_AFTER_START_MINUTES = 10;

type ParkingOwnerType = "member" | "staff";

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
  const ownerType = stringValue(request.data?.ownerType) === "staff" ? "staff" : "member";
  const ownerName = stringValue(request.data?.ownerName || request.data?.name);
  const ownerPhone = digitsOnly(request.data?.ownerPhone || request.data?.phone);
  const carNumber = normalizeCarNumber(request.data?.carNumber);
  const note = stringValue(request.data?.note);

  if (!ownerName && !ownerPhone) throw new AppError("INVALID_ARGUMENT", "이름 또는 연락처가 필요합니다");
  if (!validCarNumber(carNumber)) throw new AppError("INVALID_ARGUMENT", "차량번호를 다시 확인하세요");

  const resolved =
    ownerType === "staff"
      ? await resolveStaffOwner({ staff, ownerName, ownerPhone })
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
    },
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
}> {
  const staff = await requireManagerAccess(request);
  return await createDueParkingDiscountJobs({
    studioId: staff.studioId || DEFAULT_STUDIO_ID,
    requestedByUid: request.auth?.uid || "operator",
    source: "core_parking_manual_run",
    date: String(request.data?.date || todayKst()),
  });
}

export async function createDueParkingDiscountJobs(input: {
  studioId?: string;
  requestedByUid?: string;
  source?: string;
  date?: string;
}): Promise<{
  ok: true;
  date: string;
  created: number;
  existing: number;
  skippedNotDue: number;
  skippedNoVehicle: number;
  candidates: number;
}> {
  const studioId = input.studioId || DEFAULT_STUDIO_ID;
  const date = input.date || todayKst();
  const now = nowTimestamp();
  const nowMs = now.toMillis();
  const vehicles = await loadParkingVehicles(studioId);
  const bookingSnap = await db
    .collection("bookings")
    .where("studioId", "==", studioId)
    .where("lectureDate", "==", date)
    .where("appStatus", "==", "reserved")
    .get();
  const bookings = bookingSnap.docs
    .map((doc) => doc.data() as BookingDoc)
    .sort((a, b) => timestampMs(a.lectureStartAt) - timestampMs(b.lectureStartAt));

  const memberVehicles = vehicles.filter((vehicle) => vehicle.ownerType === "member");
  const staffVehicles = vehicles.filter((vehicle) => vehicle.ownerType === "staff");
  const queuedMemberKeys = new Set<string>();
  const queuedStaffKeys = new Set<string>();
  let created = 0;
  let existing = 0;
  let skippedNotDue = 0;
  let skippedNoVehicle = 0;
  let candidates = 0;

  for (const booking of bookings) {
    const startMs = timestampMs(booking.lectureStartAt);
    if (!startMs || nowMs < startMs + APPLY_AFTER_START_MINUTES * 60 * 1000) {
      skippedNotDue += 1;
      continue;
    }
    candidates += 1;

    const memberVehicle = findMemberVehicle(memberVehicles, booking);
    if (memberVehicle) {
      const key = `${date}_${booking.memberId || booking.memberPhone}_${memberVehicle.vehicleId}`;
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
      const key = `${date}_${staffKey}_${staffVehicle.vehicleId}`;
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

  return { ok: true, date, created, existing, skippedNotDue, skippedNoVehicle, candidates };
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

function upsertOwnerVehicleMirror(
  tx: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
  vehicle: ParkingVehicleDoc,
): void {
  const mirror = {
    vehicleId: vehicle.vehicleId,
    carNumber: vehicle.carNumber,
    carNumberLast4: vehicle.carNumberLast4,
    label: vehicle.label,
    isDefault: true,
    source: vehicle.source,
    registeredAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
  };
  tx.set(
    ref,
    {
      vehicles: FieldValue.arrayUnion(mirror),
      defaultVehicleNumber: vehicle.carNumber,
      defaultVehicleLast4: vehicle.carNumberLast4,
      vehicleUpdatedAt: vehicle.updatedAt,
      vehicleUpdatedByUid: vehicle.updatedByUid,
      updatedAt: vehicle.updatedAt,
    },
    { merge: true },
  );
}

async function loadParkingVehicles(studioId: string): Promise<ParkingVehicleDoc[]> {
  const snap = await db.collection(PARKING_VEHICLES).where("studioId", "==", studioId).where("status", "==", "active").limit(500).get();
  return snap.docs
    .map((doc) => doc.data() as ParkingVehicleDoc)
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
    requestedDiscountHours: MAX_AUTO_DISCOUNT_HOURS,
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

function publicVehicle(vehicle: ParkingVehicleDoc): ParkingDashboardVehicle {
  return {
    vehicleId: vehicle.vehicleId,
    ownerType: vehicle.ownerType,
    ownerName: vehicle.ownerName,
    ownerPhone: vehicle.ownerPhone,
    memberId: vehicle.memberId,
    staffId: vehicle.staffId,
    carNumber: vehicle.carNumber,
    carNumberLast4: vehicle.carNumberLast4,
    label: vehicle.label,
    status: vehicle.status,
    updatedAt: vehicle.updatedAt,
  };
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
