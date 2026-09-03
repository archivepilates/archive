import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { db } from "../config/firebase";
import { privateSurveyWebhookSecret } from "../config/secrets";
import type { AlimtalkCandidateDoc, BookingDoc } from "../types/models";
import { nowTimestamp } from "../utils/date";
import { ensureShortLink, shortLinkIdForTarget, shortUrlForId } from "../utils/shortLinks";
import {
  INSTRUCTOR_LESSON_PARKING_COLLECTION,
  earliestIsoDateTime,
  type InstructorLessonParkingPreviewInput,
  instructorLessonParkingAccessToken,
  instructorLessonParkingAccessTokenHash,
  instructorLessonParkingPreviewTargetUrl,
  instructorLessonParkingRequestId,
  instructorLessonParkingTargetUrl,
  instructorLessonParkingTokenMatches,
  maskParkingCarNumber,
  mergeParkingBookingIds,
  normalizeParkingCarNumber,
  parkingCarLast4,
  parkingRegistrationCloseMs,
  parkingRegistrationExpireMs,
  parkingVehicleId,
  validParkingCarNumber,
} from "./instructorLessonParkingContract";

type RegistrationStatus = "pending" | "registered";

type InstructorLessonParkingRequestDoc = {
  schemaVersion: 1;
  requestId: string;
  studioId: string;
  memberId: string;
  memberName: string;
  memberPhoneLast4: string;
  bookingIds: string[];
  lessonDate: string;
  lessonStartAt: FirebaseFirestore.Timestamp;
  managementNumber: string;
  sourceCandidateId: string;
  shortLinkId: string;
  shortUrl: string;
  accessTokenHash: string;
  status: RegistrationStatus;
  registrationClosesAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  registeredVehicleId?: string;
  registeredCarLast4?: string;
  registeredAt?: FirebaseFirestore.Timestamp;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};

class PublicParkingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function attachInstructorLessonParkingPayload(
  candidate: AlimtalkCandidateDoc,
  secret = privateSurveyWebhookSecret.value(),
): AlimtalkCandidateDoc {
  if (candidate.type !== "instructor_lesson_material") return candidate;
  const payload = candidate.payload || {};
  const lessonDate = String(payload.lessonDate || payload.lectureDate || "").trim();
  const lessonStartAt = earliestIsoDateTime(String(payload.lessonStartAt || ""));
  const managementNumber = String(payload.managementNumber || payload.materialNumber || "").trim();
  const bookingIds = mergeParkingBookingIds(String(payload.parkingBookingIds || ""), String(payload.bookingId || ""));
  if (!candidate.memberId || !lessonDate || !lessonStartAt || !managementNumber || !bookingIds || !secret) return candidate;

  const requestId = instructorLessonParkingRequestId({
    memberId: candidate.memberId,
    lessonDate,
    managementNumber,
  });
  const accessToken = instructorLessonParkingAccessToken(requestId, secret);
  const targetUrl = instructorLessonParkingTargetUrl(requestId, accessToken);
  const parkingLinkId = shortLinkIdForTarget("parking_pre_registration", targetUrl);
  return {
    ...candidate,
    payload: {
      ...payload,
      parkingRequestId: requestId,
      parkingAccessToken: accessToken,
      parkingLinkId,
      parkingShortUrl: shortUrlForId(parkingLinkId),
      parkingBookingIds: bookingIds,
      lessonStartAt,
    },
  };
}

export async function upsertInstructorLessonParkingPreRegistration(
  candidate: AlimtalkCandidateDoc,
): Promise<void> {
  const payload = candidate.payload || {};
  const requestId = String(payload.parkingRequestId || "").trim();
  const accessToken = String(payload.parkingAccessToken || "").trim();
  const shortLinkId = String(payload.parkingLinkId || "").trim();
  const bookingIds = mergeParkingBookingIds(String(payload.parkingBookingIds || ""))
    .split(",")
    .filter(Boolean);
  const lessonDate = String(payload.lessonDate || payload.lectureDate || "").trim();
  const lessonStartAtText = earliestIsoDateTime(String(payload.lessonStartAt || ""));
  const managementNumber = String(payload.managementNumber || payload.materialNumber || "").trim();
  const lessonStartMs = Date.parse(lessonStartAtText);
  if (!requestId || !accessToken || !shortLinkId || !bookingIds.length || !lessonDate || !managementNumber) return;
  if (!Number.isFinite(lessonStartMs)) return;

  const targetUrl = instructorLessonParkingTargetUrl(requestId, accessToken);
  const link = await ensureShortLink({
    type: "parking_pre_registration",
    targetUrl,
    sourceId: candidate.candidateId,
  });
  if (link.linkId !== shortLinkId) throw new Error("parking short-link contract mismatch");

  const ref = db.collection(INSTRUCTOR_LESSON_PARKING_COLLECTION).doc(requestId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const previous = snap.data() as InstructorLessonParkingRequestDoc | undefined;
    const now = nowTimestamp();
    tx.set(
      ref,
      {
        schemaVersion: 1,
        requestId,
        studioId: candidate.studioId || DEFAULT_STUDIO_ID,
        memberId: candidate.memberId,
        memberName: candidate.memberName,
        memberPhoneLast4: String(candidate.memberPhone || "").replace(/\D/g, "").slice(-4),
        bookingIds,
        lessonDate,
        lessonStartAt: Timestamp.fromMillis(lessonStartMs),
        managementNumber,
        sourceCandidateId: candidate.candidateId,
        shortLinkId,
        shortUrl: link.shortUrl,
        accessTokenHash: instructorLessonParkingAccessTokenHash(accessToken),
        status: previous?.status === "registered" ? "registered" : "pending",
        registrationClosesAt: Timestamp.fromMillis(parkingRegistrationCloseMs(lessonStartMs)),
        expiresAt: Timestamp.fromMillis(parkingRegistrationExpireMs(lessonStartMs)),
        createdAt: previous?.createdAt || now,
        updatedAt: now,
      } satisfies InstructorLessonParkingRequestDoc,
      { merge: true },
    );
  });
}

export function instructorLessonParkingPreviewLinkId(input: InstructorLessonParkingPreviewInput): string {
  return shortLinkIdForTarget("parking_pre_registration", instructorLessonParkingPreviewTargetUrl(input));
}

export async function ensureInstructorLessonParkingPreviewShortLink(
  input: InstructorLessonParkingPreviewInput,
): Promise<string> {
  const targetUrl = instructorLessonParkingPreviewTargetUrl(input);
  const link = await ensureShortLink({
    type: "parking_pre_registration",
    targetUrl,
    sourceId: `instructor-lesson-parking-preview:${input.lessonDate}`,
  });
  return link.linkId;
}

export async function instructorLessonParkingPreRegistrationApiHandler(
  request: any,
  response: any,
): Promise<void> {
  setPublicHeaders(request, response);
  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }
  if (!['GET', 'POST'].includes(String(request.method || '').toUpperCase())) {
    response.status(405).json({ ok: false, error: "method_not_allowed", message: "지원하지 않는 요청입니다." });
    return;
  }

  const requestId = String(request.query?.id || request.body?.id || "").trim();
  try {
    if (request.method === "GET") {
      const registration = await readAuthorizedParkingRequest(requestId, request.query?.token);
      const activeBookings = await activeRequestBookings(registration);
      if (!activeBookings.length) {
        throw new PublicParkingError(409, "reservation_unavailable", "현재 유효한 강사레슨 예약이 없습니다.");
      }
      response.status(200).json(publicRegistrationResponse(registration));
      return;
    }

    const result = await registerInstructorLessonParkingVehicle({
      requestId,
      accessToken: request.body?.token,
      carNumber: request.body?.carNumber,
    });
    response.status(200).json(result);
  } catch (err) {
    const normalized = publicParkingError(err);
    logger.warn("instructor lesson parking pre-registration rejected", {
      requestId,
      code: normalized.code,
      status: normalized.status,
    });
    response.status(normalized.status).json({
      ok: false,
      error: normalized.code,
      message: normalized.message,
    });
  }
}

async function readAuthorizedParkingRequest(
  requestIdInput: unknown,
  accessTokenInput: unknown,
): Promise<InstructorLessonParkingRequestDoc> {
  const requestId = String(requestIdInput || "").trim();
  const accessToken = String(accessTokenInput || "").trim();
  if (!/^ipr-[a-f0-9]{16}$/.test(requestId) || !/^[a-f0-9]{32}$/.test(accessToken)) {
    throw new PublicParkingError(403, "invalid_link", "주차 사전등록 링크가 올바르지 않습니다.");
  }
  const snap = await db.collection(INSTRUCTOR_LESSON_PARKING_COLLECTION).doc(requestId).get();
  const registration = snap.data() as InstructorLessonParkingRequestDoc | undefined;
  if (!registration || !instructorLessonParkingTokenMatches(accessToken, registration.accessTokenHash)) {
    throw new PublicParkingError(403, "invalid_link", "주차 사전등록 링크가 올바르지 않습니다.");
  }
  if (registration.expiresAt.toMillis() < Date.now()) {
    throw new PublicParkingError(410, "expired", "주차 사전등록 기간이 종료되었습니다.");
  }
  return registration;
}

async function activeRequestBookings(
  registration: InstructorLessonParkingRequestDoc,
): Promise<BookingDoc[]> {
  const snaps = await Promise.all(registration.bookingIds.map((bookingId) => db.collection("bookings").doc(bookingId).get()));
  return snaps
    .filter((snap) => snap.exists)
    .map((snap) => snap.data() as BookingDoc)
    .filter((booking) => validRequestBooking(booking, registration));
}

async function registerInstructorLessonParkingVehicle(input: {
  requestId: string;
  accessToken: unknown;
  carNumber: unknown;
}): Promise<Record<string, unknown>> {
  const registration = await readAuthorizedParkingRequest(input.requestId, input.accessToken);
  const carNumber = normalizeParkingCarNumber(input.carNumber);
  if (!validParkingCarNumber(carNumber)) {
    throw new PublicParkingError(400, "invalid_car_number", "차량번호를 다시 확인해 주세요.");
  }
  if (Date.now() > registration.registrationClosesAt.toMillis()) {
    throw new PublicParkingError(409, "registration_closed", "주차 사전등록 시간이 종료되었습니다.");
  }

  const requestRef = db.collection(INSTRUCTOR_LESSON_PARKING_COLLECTION).doc(registration.requestId);
  const vehicleId = parkingVehicleId(
    "member",
    `${registration.memberId}_${registration.lessonDate}`,
    carNumber,
  );
  const vehicleRef = db.collection("parkingVehicles").doc(vehicleId);
  const now = nowTimestamp();

  await db.runTransaction(async (tx) => {
    const currentRequestSnap = await tx.get(requestRef);
    const currentRequest = currentRequestSnap.data() as InstructorLessonParkingRequestDoc | undefined;
    if (!currentRequest || !instructorLessonParkingTokenMatches(String(input.accessToken || ""), currentRequest.accessTokenHash)) {
      throw new PublicParkingError(403, "invalid_link", "주차 사전등록 링크가 올바르지 않습니다.");
    }
    if (Date.now() > currentRequest.registrationClosesAt.toMillis()) {
      throw new PublicParkingError(409, "registration_closed", "주차 사전등록 시간이 종료되었습니다.");
    }

    const bookingRefs = currentRequest.bookingIds.map((bookingId) => db.collection("bookings").doc(bookingId));
    const bookingSnaps: FirebaseFirestore.DocumentSnapshot[] = [];
    for (const bookingRef of bookingRefs) bookingSnaps.push(await tx.get(bookingRef));
    const vehicleSnap = await tx.get(vehicleRef);
    const previousVehicleId = String(currentRequest.registeredVehicleId || "");
    const previousVehicleRef = previousVehicleId && previousVehicleId !== vehicleId
      ? db.collection("parkingVehicles").doc(previousVehicleId)
      : null;
    const previousVehicleSnap = previousVehicleRef ? await tx.get(previousVehicleRef) : null;
    const validBookings = bookingSnaps
      .filter((snap) => snap.exists)
      .map((snap) => ({ ref: snap.ref, booking: snap.data() as BookingDoc }))
      .filter(({ booking }) => validRequestBooking(booking, currentRequest));
    if (!validBookings.length) {
      throw new PublicParkingError(409, "reservation_unavailable", "현재 유효한 강사레슨 예약이 없습니다.");
    }

    const vehicle = {
      vehicleId,
      studioId: currentRequest.studioId || DEFAULT_STUDIO_ID,
      status: "active",
      ownerType: "member",
      ownerId: `${currentRequest.memberId}_${currentRequest.lessonDate}`,
      ownerName: currentRequest.memberName,
      ownerPhone: "",
      ownerPhoneLast4: currentRequest.memberPhoneLast4,
      memberId: currentRequest.memberId,
      validDate: currentRequest.lessonDate,
      carNumber,
      carNumberLast4: parkingCarLast4(carNumber),
      label: maskParkingCarNumber(carNumber),
      isDefault: true,
      source: "instructor_lesson_pre_registration",
      createdAt: vehicleSnap.get("createdAt") || now,
      updatedAt: now,
      updatedByUid: "public:instructor-lesson-parking",
    };
    tx.set(vehicleRef, vehicle, { merge: true });
    if (previousVehicleRef && previousVehicleSnap?.exists) {
      tx.set(
        previousVehicleRef,
        {
          status: "archived",
          archivedAt: now,
          archivedByUid: "public:instructor-lesson-parking",
          updatedAt: now,
          updatedByUid: "public:instructor-lesson-parking",
        },
        { merge: true },
      );
    }

    for (const { ref } of validBookings) {
      tx.set(
        ref,
        {
          parkingPreRegistrationId: currentRequest.requestId,
          parkingVehicleId: vehicleId,
          parkingCarLast4: vehicle.carNumberLast4,
          parkingStatus: "pre_registered",
          parkingPreRegistrationStatus: "registered",
          parkingPreRegisteredAt: now,
        },
        { merge: true },
      );
    }
    tx.set(
      requestRef,
      {
        status: "registered",
        registeredVehicleId: vehicleId,
        registeredCarLast4: vehicle.carNumberLast4,
        registeredAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  });

  return {
    ok: true,
    requestId: registration.requestId,
    status: "registered",
    carLast4: parkingCarLast4(carNumber),
    message: "차량번호 사전등록이 완료되었습니다.",
  };
}

function validRequestBooking(
  booking: BookingDoc,
  registration: InstructorLessonParkingRequestDoc,
): boolean {
  return (
    booking.appStatus === "reserved" &&
    booking.memberId === registration.memberId &&
    booking.studioId === registration.studioId &&
    booking.lectureDate === registration.lessonDate
  );
}

function publicRegistrationResponse(registration: InstructorLessonParkingRequestDoc): Record<string, unknown> {
  const closed = Date.now() > registration.registrationClosesAt.toMillis();
  return {
    ok: true,
    requestId: registration.requestId,
    memberName: registration.memberName,
    lessonDate: registration.lessonDate,
    lessonStartAt: registration.lessonStartAt.toDate().toISOString(),
    registrationClosesAt: registration.registrationClosesAt.toDate().toISOString(),
    status: closed ? "closed" : registration.status,
    carLast4: registration.registeredCarLast4 || "",
    canEdit: !closed,
  };
}

function setPublicHeaders(request: any, response: any): void {
  const origin = String(request.get?.("Origin") || "");
  if (["https://in.archivepilates.com", "https://archive-pilates.web.app"].includes(origin)) {
    response.set("Access-Control-Allow-Origin", origin);
    response.set("Vary", "Origin");
  }
  response.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type");
  response.set("Cache-Control", "no-store");
  response.set("Referrer-Policy", "no-referrer");
  response.set("X-Content-Type-Options", "nosniff");
  response.set("X-Robots-Tag", "noindex, nofollow, noarchive");
}

function publicParkingError(err: unknown): PublicParkingError {
  if (err instanceof PublicParkingError) return err;
  logger.error("instructor lesson parking pre-registration failed", {
    message: err instanceof Error ? err.message : String(err),
  });
  return new PublicParkingError(500, "server_error", "잠시 후 다시 확인해 주세요.");
}
