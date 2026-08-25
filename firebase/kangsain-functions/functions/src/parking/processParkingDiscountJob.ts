import { logger } from "firebase-functions";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import type { BookingDoc } from "../types/models";
import { errorMessage } from "../utils/errors";
import {
  getIparkingAccountConfigs,
  IparkingApiError,
  IparkingCarInfo,
  IparkingClient,
  IparkingDiscountProduct,
  resolveIparkingAccountStoreSeq,
} from "./iparkingClient";
import {
  PARKING_APPLY_AFTER_START_MINUTES,
  PARKING_DISCOUNT_UNIT_HOURS,
  PARKING_MAX_AUTO_DISCOUNT_HOURS,
  resolveParkingDiscountPolicy,
} from "./parkingDiscountPolicy";
import { sendParkingNoEntryAlert } from "./parkingOperatorAlerts";

const PARKING_DISCOUNT_JOBS = "parkingDiscountJobs";
const DEFAULT_DISCOUNT_NAME = "2시간 할인";
const DEFAULT_IPARKING_STOR_SEQ = Number(process.env.IPARKING_STOR_SEQ || "287798");
const DEFAULT_IPARKING_PARK_SEQ = Number(process.env.IPARKING_PARK_SEQ || "5068");
const DEFAULT_REQUESTED_DISCOUNT_HOURS = 2;
const BOOKING_FRESHNESS_MS = 24 * 60 * 60 * 1000;

type ParkingDiscountJob = {
  status?: string;
  dryRun?: boolean;
  storSeq?: number | string;
  parkSeq?: number | string;
  parkName?: string;
  carNumber?: string;
  carNumberLast4?: string;
  expectedCarNumber?: string;
  expectedEnterDatetime?: string;
  discountName?: string;
  requestedDiscountHours?: number | string;
  maxAutoDiscountHours?: number | string;
  discountUnitHours?: number | string;
  ownerType?: string;
  memberId?: string;
  memberName?: string;
  staffId?: string;
  staffName?: string;
  ownerName?: string;
  visitorName?: string;
  bookingId?: string;
  lessonDate?: string;
  lectureStartAt?: FirebaseFirestore.Timestamp | null;
  requestedBy?: string;
  source?: string;
  operatorAlertStatus?: string;
  operatorAlertType?: string;
};

type JobStatus = "running" | "eligible" | "success" | "manual_review" | "error";

type StatusPatch = {
  status: JobStatus;
  reason?: string;
  lastError?: string | null;
  retryable?: boolean;
  result?: Record<string, unknown>;
};

function normalizeCarNumber(value: unknown): string {
  return String(value || "").replace(/[\s-]/g, "");
}

function carLast4(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.slice(-4);
}

function normalizeMinute(value: unknown): string {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})[일\sT]*(\d{1,2}):(\d{2})/);
  if (!match) return raw.slice(0, 16);
  const [, year, month, day, hour, minute] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${hour.padStart(2, "0")}:${minute}`;
}

function publicCar(car: IparkingCarInfo): Record<string, unknown> {
  return {
    carNumber: car.car_number,
    enterDatetime: car.enter_datetime,
    inotSeq: car.inot_seq,
    parkSeq: car.park_seq,
    parkName: car.park_name,
    durationMinutes: car.inot_duration,
    discountDuration: car.discount_duration,
  };
}

function publicProduct(product: IparkingDiscountProduct): Record<string, unknown> {
  return {
    discountKey: product.discount_key,
    discountName: product.disc_name,
    remainAmount: product.remain_amount,
    maxUsableCount: product.max_usable_count,
    todayCount: product.fdk_today_count,
    storSeq: product.stor_seq,
    parkSeq: product.park_seq,
  };
}

function selectCar(job: ParkingDiscountJob, cars: IparkingCarInfo[]): IparkingCarInfo | null {
  const expected = normalizeCarNumber(job.expectedCarNumber || job.carNumber);
  const expectedMinute = normalizeMinute(job.expectedEnterDatetime);
  let candidates = cars;
  if (expected.length > 4) {
    candidates = candidates.filter((car) => normalizeCarNumber(car.car_number) === expected);
  }
  if (expectedMinute) {
    candidates = candidates.filter((car) => normalizeMinute(car.enter_datetime) === expectedMinute);
  }
  if (candidates.length === 1) return candidates[0];
  if (!expectedMinute && cars.length === 1) return cars[0];
  return null;
}

function selectProduct(products: IparkingDiscountProduct[], discountName: string): IparkingDiscountProduct | null {
  const exact = products.find((product) => product.disc_name === discountName);
  if (exact) return exact;
  return products.find((product) => product.disc_name?.includes(discountName)) || null;
}

function numericSetting(value: unknown, fallback: number, label: string): number {
  const numberValue = Number(value || fallback);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`${label} 설정값이 올바르지 않습니다`);
  }
  return numberValue;
}

function elapsedMetric(name: string, startedAt: number): Record<string, unknown> {
  return { name, ms: Date.now() - startedAt };
}

async function searchCarsAcrossAccounts(params: {
  carNumberLast4: string;
  storSeq: number;
  parkSeq: number;
  parkName?: string;
}): Promise<{
  client: IparkingClient;
  cars: IparkingCarInfo[];
  accountLabel: string;
  metrics: Record<string, unknown>[];
}> {
  const accounts = getIparkingAccountConfigs();
  if (!accounts.length) throw new IparkingApiError("iParking 로그인 Secret이 설정되지 않았습니다", undefined, false);

  const metrics: Record<string, unknown>[] = [];
  let fallbackClient: IparkingClient | null = null;
  let lastError: unknown = null;
  for (const account of accounts) {
    const client = new IparkingClient(account);
    fallbackClient = fallbackClient || client;
    try {
      const loginStartedAt = Date.now();
      await client.login();
      const accountStoreSeq = resolveIparkingAccountStoreSeq(account, params.storSeq);
      metrics.push({
        account: account.label,
        role: account.role,
        storeSeq: accountStoreSeq,
        ...elapsedMetric("login", loginStartedAt),
      });

      const searchStartedAt = Date.now();
      const cars = await client.searchCars({ ...params, storSeq: accountStoreSeq });
      metrics.push({
        account: account.label,
        role: account.role,
        storeSeq: accountStoreSeq,
        count: cars.length,
        ...elapsedMetric("car_search", searchStartedAt),
      });
      if (cars.length > 0 || account === accounts[accounts.length - 1]) {
        return { client, cars, accountLabel: account.label, metrics };
      }
    } catch (error) {
      lastError = error;
      metrics.push({
        account: account.label,
        name: "account_error",
        message: errorMessage(error),
      });
    }
  }
  if (fallbackClient) {
    if (lastError) throw lastError;
    return { client: fallbackClient, cars: [], accountLabel: "none", metrics };
  }
  throw new IparkingApiError("iParking 계정을 확인할 수 없습니다", undefined, false);
}

async function setJobStatus(ref: FirebaseFirestore.DocumentReference, patch: StatusPatch): Promise<void> {
  await ref.set(
    {
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
      completedAt: patch.status === "running" ? null : FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  if (patch.status !== "running") {
    const current = (await ref.get()).data() as ParkingDiscountJob | undefined;
    const bookingId = String(current?.bookingId || "");
    if (bookingId) {
      await db
        .collection("bookings")
        .doc(bookingId)
        .set(
          {
            parkingStatus: patch.status,
            parkingReason: patch.reason || "",
            parkingLastError: patch.lastError || null,
            parkingUpdatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
    }
  }
}

async function applyDiscountAcrossAccounts(params: {
  car: IparkingCarInfo;
  storSeq: number;
  parkSeq: number;
  discountName: string;
  targetHours: number;
  unitHours: number;
  shouldApply: boolean;
  metrics: Record<string, unknown>[];
  requestedAt: number;
}): Promise<{
  appliedHours: number;
  alreadyAppliedHours: number;
  attempts: Record<string, unknown>[];
  products: Record<string, unknown>[];
}> {
  const accounts = getIparkingAccountConfigs();
  const attempts: Record<string, unknown>[] = [];
  const products: Record<string, unknown>[] = [];
  let appliedHours = 0;
  let alreadyAppliedHours = 0;

  for (const account of accounts) {
    if (appliedHours + alreadyAppliedHours >= params.targetHours) break;
    const client = new IparkingClient(account);
    try {
      const loginStartedAt = Date.now();
      await client.login();
      const accountStoreSeq = resolveIparkingAccountStoreSeq(account, params.storSeq);
      params.metrics.push({
        account: account.label,
        role: account.role,
        storeSeq: accountStoreSeq,
        ...elapsedMetric("login_for_apply", loginStartedAt),
      });

      const productStartedAt = Date.now();
      const accountProducts = await client.listProducts({
        storSeq: accountStoreSeq,
        parkSeq: params.parkSeq,
        inotSeq: Number(params.car.inot_seq),
      });
      params.metrics.push({
        account: account.label,
        role: account.role,
        storeSeq: accountStoreSeq,
        ...elapsedMetric("product_list", productStartedAt),
      });
      const product = selectProduct(accountProducts, params.discountName);
      if (!product) {
        attempts.push({
          account: account.label,
          role: account.role,
          storeSeq: accountStoreSeq,
          status: "skipped",
          reason: "discount_ticket_not_found",
        });
        continue;
      }
      products.push({ account: account.label, role: account.role, ...publicProduct(product) });

      const productStoreSeq = Number(product.stor_seq || accountStoreSeq);
      if (productStoreSeq !== accountStoreSeq) {
        attempts.push({
          account: account.label,
          role: account.role,
          storeSeq: accountStoreSeq,
          status: "skipped",
          reason: "product_store_mismatch",
          productStoreSeq,
        });
        continue;
      }
      const resolvedStorSeq = accountStoreSeq;
      const resolvedParkSeq = Number(product.park_seq || params.parkSeq);
      if (!Number.isFinite(resolvedStorSeq) || !Number.isFinite(resolvedParkSeq)) {
        attempts.push({
          account: account.label,
          role: account.role,
          storeSeq: accountStoreSeq,
          status: "skipped",
          reason: "invalid_product_location",
        });
        continue;
      }

      const appliedStartedAt = Date.now();
      const applied = await client.listAppliedDiscounts({
        storSeq: resolvedStorSeq,
        parkSeq: resolvedParkSeq,
        inotSeq: Number(params.car.inot_seq),
        searchOption: 1,
      });
      params.metrics.push({ account: account.label, ...elapsedMetric("applied_list", appliedStartedAt) });

      const sameAccountDiscount = applied.find((item) => item.discount_key === product.discount_key);
      if (sameAccountDiscount) {
        alreadyAppliedHours += params.unitHours;
        attempts.push({
          account: account.label,
          role: account.role,
          storeSeq: resolvedStorSeq,
          status: "already_applied",
          hours: params.unitHours,
          product: publicProduct(product),
          appliedDiscounts: applied,
        });
        continue;
      }

      if (!params.shouldApply) {
        attempts.push({
          account: account.label,
          role: account.role,
          storeSeq: resolvedStorSeq,
          status: "eligible",
          hours: params.unitHours,
          product: publicProduct(product),
          appliedDiscounts: applied,
        });
        continue;
      }

      const applyStartedAt = Date.now();
      await client.applyDiscount({
        storSeq: resolvedStorSeq,
        parkSeq: resolvedParkSeq,
        inotSeq: Number(params.car.inot_seq),
        carNumber: params.car.car_number,
        product,
        memo: `ARCHIVE PILATES 자동 주차등록 ${params.unitHours}시간`,
      });
      params.metrics.push({ account: account.label, ...elapsedMetric("apply_discount", applyStartedAt) });

      const verifyStartedAt = Date.now();
      const appliedAfter = await client.listAppliedDiscounts({
        storSeq: resolvedStorSeq,
        parkSeq: resolvedParkSeq,
        inotSeq: Number(params.car.inot_seq),
        searchOption: 1,
      });
      params.metrics.push({ account: account.label, ...elapsedMetric("applied_verify", verifyStartedAt) });
      if (!appliedAfter.some((item) => item.discount_key === product.discount_key)) {
        throw new IparkingApiError(`${account.label} 할인 적용 결과를 확인할 수 없습니다`, undefined, true);
      }

      appliedHours += params.unitHours;
      attempts.push({
        account: account.label,
        role: account.role,
        storeSeq: resolvedStorSeq,
        status: "applied",
        hours: params.unitHours,
        product: publicProduct(product),
        appliedDiscountsBefore: applied,
        appliedDiscountsAfter: appliedAfter,
      });
    } catch (error) {
      attempts.push({
        account: account.label,
        role: account.role,
        storeSeq: resolveIparkingAccountStoreSeq(account, params.storSeq),
        status: "error",
        message: errorMessage(error),
        retryable: error instanceof IparkingApiError ? error.retryable : false,
      });
    }
  }

  return { appliedHours, alreadyAppliedHours, attempts, products };
}

export async function processParkingDiscountJobSnapshot(snap: QueryDocumentSnapshot): Promise<void> {
  const ref = snap.ref;
  const job = snap.data() as ParkingDiscountJob;
  if (job.status && job.status !== "pending") {
    logger.info("parking discount job skipped because status is not pending", { jobId: snap.id, status: job.status });
    return;
  }
  const requestedAt = Date.now();
  const metrics: Record<string, unknown>[] = [];
  const discountName = String(job.discountName || DEFAULT_DISCOUNT_NAME);
  const rawCarNumber = normalizeCarNumber(job.carNumber || job.expectedCarNumber || "");
  const last4 = String(job.carNumberLast4 || carLast4(rawCarNumber));
  const storSeq = numericSetting(job.storSeq, DEFAULT_IPARKING_STOR_SEQ, "iParking storSeq");
  const defaultParkSeq = numericSetting(job.parkSeq, DEFAULT_IPARKING_PARK_SEQ, "iParking parkSeq");
  const parkingPolicy = resolveParkingDiscountPolicy(job);
  const { requestedDiscountHours, maxAutoDiscountHours, discountUnitHours } = parkingPolicy;
  const shouldApply = job.dryRun === false;

  try {
    if (!/^\d{4}$/.test(last4)) throw new Error("차량번호 뒤 4자리가 필요합니다");
    const claim = await claimCurrentParkingJob(ref, job, {
      parkingPolicy: parkingPolicy.policy,
      requestedDiscountHours,
      maxAutoDiscountHours,
      discountUnitHours,
    });
    if (!claim.claimed) {
      logger.info("parking discount job stopped before iParking lookup", {
        jobId: snap.id,
        reason: claim.reason,
      });
      return;
    }

    const {
      client,
      cars,
      accountLabel,
      metrics: accountMetrics,
    } = await searchCarsAcrossAccounts({
      carNumberLast4: last4,
      storSeq,
      parkSeq: defaultParkSeq,
      parkName: job.parkName,
    });
    metrics.push(...accountMetrics);
    if (cars.length === 0) {
      await setJobStatus(ref, {
        status: "manual_review",
        reason: "no_entry",
        lastError: "입차 기록을 찾지 못했습니다",
        result: { carNumberLast4: last4, metrics, totalMs: Date.now() - requestedAt },
      });
      await notifyNoEntryOnce(ref, snap.id, job, last4, requestedDiscountHours);
      return;
    }
    await ref.set({ accountLabel, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    const car = selectCar(job, cars);
    if (!car) {
      await setJobStatus(ref, {
        status: "manual_review",
        reason: "multiple_or_mismatched_entries",
        lastError: "차량 후보가 여러 건이거나 예상 차량/입차시각과 다릅니다",
        result: { carNumberLast4: last4, candidates: cars.map(publicCar), metrics, totalMs: Date.now() - requestedAt },
      });
      return;
    }

    const parkSeq = Number(car.park_seq || defaultParkSeq);
    if (!Number.isFinite(parkSeq)) throw new Error("주차장 ID를 확인할 수 없습니다");

    const discountResult = await applyDiscountAcrossAccounts({
      car,
      storSeq,
      parkSeq,
      discountName,
      targetHours: requestedDiscountHours,
      unitHours: discountUnitHours,
      shouldApply,
      metrics,
      requestedAt,
    });
    const totalSatisfiedHours = discountResult.appliedHours + discountResult.alreadyAppliedHours;
    const result = {
      car: publicCar(car),
      requestedDiscountHours,
      maxAutoDiscountHours,
      discountUnitHours,
      appliedHours: discountResult.appliedHours,
      alreadyAppliedHours: discountResult.alreadyAppliedHours,
      totalSatisfiedHours,
      attempts: discountResult.attempts,
      products: discountResult.products,
      metrics,
      totalMs: Date.now() - requestedAt,
    };
    if (!shouldApply) {
      await setJobStatus(ref, {
        status: "eligible",
        reason: "dry_run",
        lastError: null,
        result,
      });
      return;
    }
    if (totalSatisfiedHours >= requestedDiscountHours) {
      await setJobStatus(ref, {
        status: "success",
        reason: discountResult.appliedHours > 0 ? "applied" : "already_applied",
        lastError: null,
        result,
      });
      return;
    }
    await setJobStatus(ref, {
      status: discountResult.appliedHours > 0 ? "manual_review" : "error",
      reason: discountResult.appliedHours > 0 ? "partial_discount_applied" : "discount_apply_failed",
      retryable: discountResult.attempts.some((attempt) => Boolean(attempt.retryable)),
      lastError: `${requestedDiscountHours}시간 중 ${totalSatisfiedHours}시간만 적용/확인되었습니다`,
      result,
    });
  } catch (err) {
    const retryable = err instanceof IparkingApiError ? err.retryable : false;
    logger.error("processParkingDiscountJob failed", {
      jobId: snap.id,
      message: errorMessage(err),
      retryable,
    });
    await setJobStatus(ref, {
      status: "error",
      reason: retryable ? "retryable_api_error" : "api_error",
      retryable,
      lastError: errorMessage(err),
      result: { metrics, totalMs: Date.now() - requestedAt },
    });
  }
}

async function claimCurrentParkingJob(
  ref: FirebaseFirestore.DocumentReference,
  job: ParkingDiscountJob,
  policy: {
    parkingPolicy: string;
    requestedDiscountHours: number;
    maxAutoDiscountHours: number;
    discountUnitHours: number;
  },
): Promise<{ claimed: boolean; reason: string }> {
  return await db.runTransaction(async (tx) => {
    const currentSnap = await tx.get(ref);
    const current = currentSnap.data() as ParkingDiscountJob | undefined;
    if (!current || (current.status && current.status !== "pending")) {
      return { claimed: false, reason: `job_status_${current?.status || "missing"}` };
    }

    let bookingIssue = "";
    const bookingId = String(current.bookingId || job.bookingId || "");
    let bookingRef: FirebaseFirestore.DocumentReference | null = null;
    if (bookingId) {
      bookingRef = db.collection("bookings").doc(bookingId);
      const bookingSnap = await tx.get(bookingRef);
      bookingIssue = currentParkingBookingIssue(current, bookingSnap.data() as BookingDoc | undefined);
    }

    if (bookingIssue) {
      tx.set(
        ref,
        {
          status: "manual_review",
          reason: "booking_not_current",
          lastError: bookingIssue,
          retryable: false,
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      if (bookingRef) {
        tx.set(
          bookingRef,
          {
            parkingStatus: "manual_review",
            parkingReason: "booking_not_current",
            parkingLastError: bookingIssue,
            parkingUpdatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      return { claimed: false, reason: bookingIssue };
    }

    tx.set(
      ref,
      {
        status: "running",
        startedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        attempts: FieldValue.increment(1),
        lastError: null,
        ...policy,
      },
      { merge: true },
    );
    return { claimed: true, reason: "" };
  });
}

export function currentParkingBookingIssue(
  job: ParkingDiscountJob,
  booking: BookingDoc | undefined,
  nowMs = Date.now(),
): string {
  if (!job.bookingId) return "";
  if (!booking) return "연결 예약을 찾을 수 없습니다";
  if (booking.appStatus !== "reserved") return `현재 예약 상태가 ${booking.appStatus || "unknown"}입니다`;
  if (job.lessonDate && booking.lectureDate !== job.lessonDate) return "수업일이 변경되었습니다";
  const jobStartMs = timestampMillis(job.lectureStartAt);
  const bookingStartMs = timestampMillis(booking.lectureStartAt);
  if (!jobStartMs || !bookingStartMs || jobStartMs !== bookingStartMs) return "수업 시작시각이 변경되었습니다";
  if (nowMs < bookingStartMs + PARKING_APPLY_AFTER_START_MINUTES * 60 * 1000) {
    return `수업 시작 ${PARKING_APPLY_AFTER_START_MINUTES}분 전에는 입차 조회를 실행하지 않습니다`;
  }
  const syncedAtMs = Math.max(
    timestampMillis(booking.sourceUpdatedAt),
    timestampMillis(booking.syncedAt),
    timestampMillis(booking.updatedAt),
  );
  if (!syncedAtMs || nowMs - syncedAtMs > BOOKING_FRESHNESS_MS) return "StudioMate 예약 데이터가 24시간 이내 동기화되지 않았습니다";
  return "";
}

function timestampMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as FirebaseFirestore.Timestamp).toMillis();
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function notifyNoEntryOnce(
  ref: FirebaseFirestore.DocumentReference,
  jobId: string,
  job: ParkingDiscountJob,
  carNumberLast4: string,
  requestedDiscountHours: number,
): Promise<void> {
  const claimed = await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const currentJob = current.data() as ParkingDiscountJob | undefined;
    if (currentJob?.operatorAlertStatus || currentJob?.operatorAlertType) return false;
    tx.set(
      ref,
      {
        operatorAlertType: "no_entry",
        operatorAlertStatus: "sending",
        operatorAlertAttemptedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  });
  if (!claimed) return;

  try {
    await sendParkingNoEntryAlert({
      jobId,
      lessonDate: job.lessonDate,
      lectureStartAt: job.lectureStartAt,
      memberName: job.memberName,
      staffName: job.staffName,
      ownerName: job.ownerName,
      visitorName: job.visitorName,
      carNumberLast4,
      requestedDiscountHours,
    });
    await ref.set(
      {
        operatorAlertStatus: "sent",
        operatorAlertSentAt: FieldValue.serverTimestamp(),
        operatorAlertLastError: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    logger.error("parking no-entry alert email failed", {
      jobId,
      message: errorMessage(err),
    });
    await ref.set(
      {
        operatorAlertStatus: "failed",
        operatorAlertLastError: errorMessage(err),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
}

export async function createParkingDiscountJobForTest(data: ParkingDiscountJob): Promise<{ jobId: string }> {
  const ref = await db.collection(PARKING_DISCOUNT_JOBS).add({
    ...data,
    status: data.status || "pending",
    dryRun: data.dryRun ?? true,
    discountName: data.discountName || DEFAULT_DISCOUNT_NAME,
    requestedDiscountHours: data.requestedDiscountHours || DEFAULT_REQUESTED_DISCOUNT_HOURS,
    maxAutoDiscountHours: data.maxAutoDiscountHours || PARKING_MAX_AUTO_DISCOUNT_HOURS,
    discountUnitHours: data.discountUnitHours || PARKING_DISCOUNT_UNIT_HOURS,
    source: data.source || "manual_test",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { jobId: ref.id };
}
