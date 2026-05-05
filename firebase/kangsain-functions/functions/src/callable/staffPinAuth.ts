import { randomBytes, randomInt, timingSafeEqual, pbkdf2Sync } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { AppError } from "../utils/errors";
import { refs } from "../firestore/refs";
import { getStaffByPhone } from "../firestore/staffRepository";
import { requireManager } from "../security/authGuards";
import type { StaffDoc } from "../types/models";
import { nowTimestamp } from "../utils/date";

const HASH_ITERATIONS = 120000;
const KEY_LENGTH = 32;
const MAX_FAILED_COUNT = 5;
const LOCK_MINUTES = 10;

export async function loginStaffWithPinHandler(request: CallableRequest): Promise<{ token: string; staffName: string }> {
  const phone = digitsOnly(request.data?.phone);
  const pin = stringValue(request.data?.pin);
  if (!phone || !pin) throw new AppError("INVALID_ARGUMENT", "휴대폰번호와 비밀번호를 입력하세요");

  const staff = await getStaffByPhone(phone);
  if (!staff || !staff.active) throw new AppError("PERMISSION_DENIED", "강사 연락처를 찾을 수 없습니다");
  assertNotLocked(staff);
  if (!staff.pinHash || !staff.pinSalt) throw new AppError("PERMISSION_DENIED", "먼저 비밀번호를 설정하세요");

  if (!verifySecret(pin, staff.pinSalt, staff.pinHash)) {
    await recordFailedLogin(staff);
    throw new AppError("PERMISSION_DENIED", "휴대폰번호 또는 비밀번호가 맞지 않습니다");
  }

  await refs.staff(staff.staffId).set({ loginFailedCount: 0, loginLockedUntil: null, updatedAt: nowTimestamp() }, { merge: true });
  return issueStaffToken(staff);
}

export async function setupStaffPinWithTempCodeHandler(
  request: CallableRequest,
): Promise<{ token: string; staffName: string }> {
  const phone = digitsOnly(request.data?.phone);
  const tempCode = stringValue(request.data?.tempCode);
  const pin = stringValue(request.data?.pin);
  if (!phone || !tempCode || !validPin(pin)) {
    throw new AppError("INVALID_ARGUMENT", "휴대폰번호, 임시코드, 4자리 이상 비밀번호를 입력하세요");
  }

  const staff = await getStaffByPhone(phone);
  if (!staff || !staff.active) throw new AppError("PERMISSION_DENIED", "강사 연락처를 찾을 수 없습니다");
  if (!staff.tempCodeHash || !staff.tempCodeSalt) throw new AppError("PERMISSION_DENIED", "발급된 임시코드가 없습니다");
  if (staff.tempCodeExpiresAt?.toMillis() && staff.tempCodeExpiresAt.toMillis() < Date.now()) {
    throw new AppError("PERMISSION_DENIED", "임시코드가 만료되었습니다");
  }
  if (!verifySecret(tempCode, staff.tempCodeSalt, staff.tempCodeHash)) {
    throw new AppError("PERMISSION_DENIED", "임시코드가 맞지 않습니다");
  }

  const pinSecret = hashSecret(pin);
  await refs.staff(staff.staffId).set(
    {
      pinHash: pinSecret.hash,
      pinSalt: pinSecret.salt,
      pinSetAt: nowTimestamp(),
      tempCodeHash: null,
      tempCodeSalt: null,
      tempCodeExpiresAt: null,
      loginFailedCount: 0,
      loginLockedUntil: null,
      updatedAt: nowTimestamp(),
    } as unknown as Partial<StaffDoc>,
    { merge: true },
  );

  return issueStaffToken(staff);
}

export async function adminIssueStaffTempCodeHandler(
  request: CallableRequest,
  manager: StaffDoc,
): Promise<{ staffId: string; staffName: string; phoneLast4: string; tempCode: string; expiresAt: string }> {
  requireManager(manager);
  const staffId = stringValue(request.data?.staffId);
  const phone = digitsOnly(request.data?.phone);
  const tempCode = stringValue(request.data?.tempCode) || String(randomInt(100000, 1000000));
  const expiresHours = Math.min(Math.max(Number(request.data?.expiresHours || 72), 1), 24 * 14);
  const staff = staffId ? (await refs.staff(staffId).get()).data() : phone ? await getStaffByPhone(phone) : null;
  if (!staff || !staff.active) throw new AppError("INVALID_ARGUMENT", "강사를 찾을 수 없습니다");

  const secret = hashSecret(tempCode);
  const expiresAt = Timestamp.fromMillis(Date.now() + expiresHours * 60 * 60 * 1000);
  await refs.staff(staff.staffId).set(
    {
      tempCodeHash: secret.hash,
      tempCodeSalt: secret.salt,
      tempCodeIssuedAt: nowTimestamp(),
      tempCodeExpiresAt: expiresAt,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  return {
    staffId: staff.staffId,
    staffName: staff.name,
    phoneLast4: staff.phoneLast4 || staff.phone?.slice(-4) || "",
    tempCode,
    expiresAt: expiresAt.toDate().toISOString(),
  };
}

async function issueStaffToken(staff: StaffDoc): Promise<{ token: string; staffName: string }> {
  const uid = staff.uid || `staff_${staff.staffId}`;
  await refs.staff(staff.staffId).set({ uid, updatedAt: nowTimestamp() }, { merge: true });
  const token = await getAuth().createCustomToken(uid, {
    staffId: staff.staffId,
    studioId: staff.studioId,
    role: staff.role,
  });
  return { token, staffName: staff.name };
}

async function recordFailedLogin(staff: StaffDoc): Promise<void> {
  const failedCount = (staff.loginFailedCount || 0) + 1;
  const lockedUntil =
    failedCount >= MAX_FAILED_COUNT ? Timestamp.fromMillis(Date.now() + LOCK_MINUTES * 60 * 1000) : null;
  await refs.staff(staff.staffId).set(
    {
      loginFailedCount: failedCount,
      loginLockedUntil: lockedUntil,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
}

function assertNotLocked(staff: StaffDoc): void {
  const lockedUntil = staff.loginLockedUntil?.toMillis();
  if (lockedUntil && lockedUntil > Date.now()) {
    throw new AppError("PERMISSION_DENIED", "로그인이 잠시 잠겼습니다. 잠시 후 다시 시도하세요");
  }
}

function validPin(pin: string): boolean {
  return /^\d{4,12}$/.test(pin);
}

function hashSecret(secret: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(secret, salt, HASH_ITERATIONS, KEY_LENGTH, "sha256").toString("hex");
  return { salt, hash };
}

function verifySecret(secret: string, salt: string, expectedHash: string): boolean {
  const actual = pbkdf2Sync(secret, salt, HASH_ITERATIONS, KEY_LENGTH, "sha256");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function digitsOnly(value: unknown): string {
  return stringValue(value).replace(/\D/g, "");
}
