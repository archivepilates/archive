import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { stableHash } from "../utils/hash";

export const INSTRUCTOR_LESSON_PARKING_COLLECTION = "instructorLessonParkingPreRegistrations";
export const INSTRUCTOR_LESSON_PARKING_BASE_URL = "https://in.archivepilates.com/parking/";
export const INSTRUCTOR_LESSON_PARKING_BUTTON_URL =
  "https://in.archivepilates.com/s/#{주차링크ID}/";
export const INSTRUCTOR_LESSON_PARKING_PREVIEW_URL =
  "https://in.archivepilates.com/parking/?preview=1";
export const PARKING_REGISTRATION_CLOSE_AFTER_START_MINUTES = 20;
export const PARKING_REGISTRATION_EXPIRE_AFTER_START_HOURS = 4;

export function instructorLessonParkingRequestId(input: {
  memberId: string;
  lessonDate: string;
  managementNumber: string;
}): string {
  return `ipr-${stableHash(input).slice(0, 16)}`;
}

export function instructorLessonParkingAccessToken(requestId: string, secret: string): string {
  if (!requestId || !secret) return "";
  return createHmac("sha256", secret)
    .update(`instructor-parking:${requestId}`)
    .digest("hex")
    .slice(0, 32);
}

export function instructorLessonParkingAccessTokenHash(token: string): string {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

export function instructorLessonParkingTokenMatches(token: string, expectedHash: string): boolean {
  const actual = instructorLessonParkingAccessTokenHash(token);
  const expected = String(expectedHash || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export function instructorLessonParkingTargetUrl(requestId: string, accessToken: string): string {
  const url = new URL(INSTRUCTOR_LESSON_PARKING_BASE_URL);
  url.searchParams.set("id", requestId);
  url.searchParams.set("token", accessToken);
  return url.toString();
}

export function parkingRegistrationCloseMs(startMs: number): number {
  return startMs + PARKING_REGISTRATION_CLOSE_AFTER_START_MINUTES * 60 * 1000;
}

export function parkingRegistrationExpireMs(startMs: number): number {
  return startMs + PARKING_REGISTRATION_EXPIRE_AFTER_START_HOURS * 60 * 60 * 1000;
}

export function mergeParkingBookingIds(...values: string[]): string {
  const bookingIds = values
    .flatMap((value) => String(value || "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(bookingIds)].sort().join(",");
}

export function earliestIsoDateTime(...values: string[]): string {
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] || "";
}

export function normalizeParkingCarNumber(value: unknown): string {
  return String(value == null ? "" : value)
    .trim()
    .replace(/[\s-]/g, "")
    .toUpperCase();
}

export function validParkingCarNumber(value: string): boolean {
  return value.length >= 6 && value.length <= 12 && /\d{4}$/.test(value);
}

export function parkingCarLast4(value: string): string {
  return String(value || "").replace(/\D/g, "").slice(-4);
}

export function maskParkingCarNumber(value: string): string {
  const normalized = normalizeParkingCarNumber(value);
  if (normalized.length <= 4) return normalized;
  return `${normalized.slice(0, -4)} ${normalized.slice(-4)}`;
}

export function parkingVehicleId(ownerType: string, ownerId: string, carNumber: string): string {
  return `pv_${ownerType}_${safeId(ownerId) || hashSmall(ownerId)}_${hashSmall(carNumber)}`;
}

function hashSmall(value: string): string {
  let hash = 0;
  for (const char of String(value || "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(36).slice(0, 8);
}

function safeId(value: unknown): string {
  const id = String(value == null ? "" : value)
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_");
  return id.length >= 4 && id.length <= 120 ? id : "";
}
