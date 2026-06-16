import { logger } from "firebase-functions";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { errorMessage } from "../utils/errors";
import {
  getIparkingAccountConfigs,
  IparkingApiError,
  IparkingCarInfo,
  IparkingClient,
  IparkingDiscountProduct,
} from "./iparkingClient";

const PARKING_DISCOUNT_JOBS = "parkingDiscountJobs";
const DEFAULT_DISCOUNT_NAME = "2시간 할인";
const DEFAULT_IPARKING_STOR_SEQ = Number(process.env.IPARKING_STOR_SEQ || "287798");
const DEFAULT_IPARKING_PARK_SEQ = Number(process.env.IPARKING_PARK_SEQ || "5068");

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
  memberId?: string;
  memberName?: string;
  bookingId?: string;
  requestedBy?: string;
  source?: string;
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
      metrics.push({ account: account.label, ...elapsedMetric("login", loginStartedAt) });

      const searchStartedAt = Date.now();
      const cars = await client.searchCars(params);
      metrics.push({
        account: account.label,
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
  const shouldApply = job.dryRun === false;

  try {
    if (!/^\d{4}$/.test(last4)) throw new Error("차량번호 뒤 4자리가 필요합니다");
    await ref.set(
      {
        status: "running",
        startedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        attempts: FieldValue.increment(1),
        lastError: null,
      },
      { merge: true },
    );

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

    const productStartedAt = Date.now();
    const products = await client.listProducts({ storSeq, parkSeq, inotSeq: Number(car.inot_seq) });
    const product = selectProduct(products, discountName);
    metrics.push(elapsedMetric("product_list", productStartedAt));
    if (!product) {
      await setJobStatus(ref, {
        status: "manual_review",
        reason: "discount_ticket_not_found",
        lastError: `${discountName} 할인권을 찾지 못했습니다`,
        result: {
          car: publicCar(car),
          products: products.map(publicProduct),
          metrics,
          totalMs: Date.now() - requestedAt,
        },
      });
      return;
    }

    const resolvedStorSeq = Number(product.stor_seq || storSeq);
    const resolvedParkSeq = Number(product.park_seq || parkSeq);
    if (!Number.isFinite(resolvedStorSeq) || !Number.isFinite(resolvedParkSeq)) {
      throw new Error("할인권 적용에 필요한 상점/주차장 ID가 없습니다");
    }

    const appliedStartedAt = Date.now();
    const applied = await client.listAppliedDiscounts({
      storSeq: resolvedStorSeq,
      parkSeq: resolvedParkSeq,
      inotSeq: Number(car.inot_seq),
      searchOption: 1,
    });
    metrics.push(elapsedMetric("applied_list", appliedStartedAt));

    const sameDiscount = applied.find(
      (item) => item.discount_key === product.discount_key || item.disc_name === product.disc_name,
    );
    if (sameDiscount) {
      await setJobStatus(ref, {
        status: "success",
        reason: "already_applied",
        lastError: null,
        result: {
          alreadyApplied: true,
          car: publicCar(car),
          product: publicProduct(product),
          appliedDiscounts: applied,
          metrics,
          totalMs: Date.now() - requestedAt,
        },
      });
      return;
    }
    if (applied.length > 0) {
      await setJobStatus(ref, {
        status: "manual_review",
        reason: "existing_discount_conflict",
        lastError: "이미 다른 주차 할인이 적용되어 있습니다",
        result: {
          car: publicCar(car),
          product: publicProduct(product),
          appliedDiscounts: applied,
          metrics,
          totalMs: Date.now() - requestedAt,
        },
      });
      return;
    }

    if (!shouldApply) {
      await setJobStatus(ref, {
        status: "eligible",
        reason: "dry_run",
        lastError: null,
        result: { car: publicCar(car), product: publicProduct(product), metrics, totalMs: Date.now() - requestedAt },
      });
      return;
    }

    const applyStartedAt = Date.now();
    await client.applyDiscount({
      storSeq: resolvedStorSeq,
      parkSeq: resolvedParkSeq,
      inotSeq: Number(car.inot_seq),
      carNumber: car.car_number,
      product,
      memo: "ARCHIVE PILATES 출석체크 자동 주차등록",
    });
    metrics.push(elapsedMetric("apply_discount", applyStartedAt));

    await setJobStatus(ref, {
      status: "success",
      reason: "applied",
      lastError: null,
      result: {
        alreadyApplied: false,
        car: publicCar(car),
        product: publicProduct(product),
        metrics,
        totalMs: Date.now() - requestedAt,
      },
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

export async function createParkingDiscountJobForTest(data: ParkingDiscountJob): Promise<{ jobId: string }> {
  const ref = await db.collection(PARKING_DISCOUNT_JOBS).add({
    ...data,
    status: data.status || "pending",
    dryRun: data.dryRun ?? true,
    discountName: data.discountName || DEFAULT_DISCOUNT_NAME,
    source: data.source || "manual_test",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { jobId: ref.id };
}
