import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import type { BookingDoc } from "../../firebase/kangsain-functions/functions/src/types/models";
import {
  earliestIsoDateTime,
  instructorLessonParkingAccessToken,
  instructorLessonParkingAccessTokenHash,
  instructorLessonParkingPreviewTargetUrl,
  instructorLessonParkingRequestId,
  instructorLessonParkingTargetUrl,
  instructorLessonParkingTokenMatches,
  mergeParkingBookingIds,
  normalizeParkingCarNumber,
  parkingCarLast4,
  parkingRegistrationCloseMs,
  parkingVehicleId,
  validParkingCarNumber,
} from "../../firebase/kangsain-functions/functions/src/parking/instructorLessonParkingContract";
import {
  currentParkingBookingIssue,
  selectParkingCarForJob,
} from "../../firebase/kangsain-functions/functions/src/parking/processParkingDiscountJob";

const startMs = Date.parse("2026-09-19T13:00:00+09:00");
const timestamp = (ms: number) => ({ toMillis: () => ms }) as FirebaseFirestore.Timestamp;

test("creates a stable recipient and lesson scoped capability token", () => {
  const requestId = instructorLessonParkingRequestId({
    memberId: "member-1",
    lessonDate: "2026-09-19",
    managementNumber: "external-feedback-260919",
  });
  const token = instructorLessonParkingAccessToken(requestId, "test-secret");
  assert.match(requestId, /^ipr-[a-f0-9]{16}$/);
  assert.match(token, /^[a-f0-9]{32}$/);
  assert.equal(instructorLessonParkingTokenMatches(token, instructorLessonParkingAccessTokenHash(token)), true);
  assert.equal(instructorLessonParkingTokenMatches(`${token.slice(0, -1)}0`, instructorLessonParkingAccessTokenHash(token)), false);
  const url = new URL(instructorLessonParkingTargetUrl(requestId, token));
  assert.equal(url.origin, "https://in.archivepilates.com");
  assert.equal(url.pathname, "/parking/");
  assert.equal(url.searchParams.get("id"), requestId);
});

test("merges two instructor lesson sessions and keeps the earliest start", () => {
  assert.equal(mergeParkingBookingIds("booking-b,booking-a", "booking-a", "booking-c"), "booking-a,booking-b,booking-c");
  assert.equal(
    earliestIsoDateTime("2026-09-19T05:10:00.000Z", "2026-09-19T04:00:00.000Z"),
    "2026-09-19T04:00:00.000Z",
  );
});

test("builds a lesson-scoped non-saving parking preview URL", () => {
  const url = new URL(
    instructorLessonParkingPreviewTargetUrl({
      memberName: "김기효",
      lessonDate: "2026-08-29",
      lessonStartAt: "2026-08-29T04:00:00.000Z",
    }),
  );
  assert.equal(url.pathname, "/parking/");
  assert.equal(url.searchParams.get("preview"), "1");
  assert.equal(url.searchParams.get("name"), "김기효");
  assert.equal(url.searchParams.get("lessonDate"), "2026-08-29");
  assert.equal(url.searchParams.get("lessonStartAt"), "2026-08-29T04:00:00.000Z");
  assert.equal(url.searchParams.has("id"), false);
  assert.equal(url.searchParams.has("token"), false);
});

test("accepts Korean vehicle numbers and closes registration before the one-time lookup", () => {
  const carNumber = normalizeParkingCarNumber("241고-2299");
  assert.equal(carNumber, "241고2299");
  assert.equal(validParkingCarNumber(carNumber), true);
  assert.equal(parkingCarLast4(carNumber), "2299");
  assert.equal(parkingRegistrationCloseMs(startMs), Date.parse("2026-09-19T13:20:00+09:00"));
});

test("uses a lesson-date scoped vehicle id instead of a permanent member default", () => {
  const firstDate = parkingVehicleId("member", "member-1_2026-09-19", "241고2299");
  const nextDate = parkingVehicleId("member", "member-1_2026-09-20", "241고2299");
  assert.notEqual(firstDate, nextDate);
});

test("blocks iParking lookup when the current booking was cancelled, moved, or stale", () => {
  const job = {
    bookingId: "booking-1",
    lessonDate: "2026-09-19",
    lectureStartAt: timestamp(startMs),
  };
  const current = {
    bookingId: "booking-1",
    appStatus: "reserved",
    lectureDate: "2026-09-19",
    lectureStartAt: timestamp(startMs),
    syncedAt: timestamp(startMs - 60_000),
  } as BookingDoc;
  const lookupMs = startMs + 30 * 60_000;
  assert.equal(currentParkingBookingIssue(job, current, lookupMs), "");
  assert.match(currentParkingBookingIssue(job, { ...current, appStatus: "cancel" }, lookupMs), /cancel/);
  assert.match(
    currentParkingBookingIssue(job, { ...current, lectureStartAt: timestamp(startMs + 10 * 60_000) }, lookupMs),
    /시작시각/,
  );
  assert.match(
    currentParkingBookingIssue(
      job,
      {
        ...current,
        sourceUpdatedAt: timestamp(startMs - 25 * 60 * 60_000),
        syncedAt: timestamp(startMs - 25 * 60 * 60_000),
        updatedAt: timestamp(startMs - 25 * 60 * 60_000),
      },
      lookupMs,
    ),
    /24시간/,
  );
  assert.match(currentParkingBookingIssue(job, current, startMs + 29 * 60_000), /30분 전/);
});

test("staff parking ignores lesson-time entry matching and selects the latest exact vehicle", () => {
  const cars = [
    { inot_seq: 1, car_number: "42도0761", enter_datetime: "2026-08-29 08:10" },
    { inot_seq: 2, car_number: "42도0761", enter_datetime: "2026-08-29 12:40" },
    { inot_seq: 3, car_number: "11가9461", enter_datetime: "2026-08-29 12:54" },
  ];
  const selected = selectParkingCarForJob(
    {
      ownerType: "staff",
      staffId: "2222464",
      carNumber: "42도0761",
      expectedEnterDatetime: "2026-08-29 09:00",
    },
    cars,
  );
  assert.equal(selected?.inot_seq, 2);
});

test("member parking ignores lesson-time entry matching when the registered vehicle matches", () => {
  const selected = selectParkingCarForJob(
    {
      ownerType: "member",
      memberId: "member-1",
      carNumber: "42도0761",
      expectedEnterDatetime: "2026-08-29 09:00",
    },
    [{ inot_seq: 1, car_number: "42도0761", enter_datetime: "2026-08-29 08:10" }],
  );
  assert.equal(selected?.inot_seq, 1);
});

test("member parking never selects a different vehicle that shares the last four digits", () => {
  const selected = selectParkingCarForJob(
    {
      ownerType: "member",
      memberId: "member-1",
      carNumber: "42도0761",
      expectedEnterDatetime: "2026-08-29 09:00",
    },
    [{ inot_seq: 1, car_number: "11가0761", enter_datetime: "2026-08-29 09:00" }],
  );
  assert.equal(selected, null);
});

test("legacy member parking remains a member job when instructor fields are also present", () => {
  const selected = selectParkingCarForJob(
    {
      memberId: "member-1",
      staffId: "staff-1",
      carNumber: "42도0761",
      expectedEnterDatetime: "2026-08-29 09:00",
    },
    [{ inot_seq: 1, car_number: "42도0761", enter_datetime: "2026-08-29 08:10" }],
  );
  assert.equal(selected?.inot_seq, 1);
});

test("visitor parking keeps the expected entry-time safeguard", () => {
  const selected = selectParkingCarForJob(
    {
      ownerType: "visitor",
      carNumber: "42도0761",
      expectedEnterDatetime: "2026-08-29 09:00",
    },
    [{ inot_seq: 1, car_number: "42도0761", enter_datetime: "2026-08-29 08:10" }],
  );
  assert.equal(selected, null);
});

test("public page never mirrors the pre-registered car into the permanent member profile", () => {
  const source = fs.readFileSync(
    new URL(
      "../../firebase/kangsain-functions/functions/src/parking/instructorLessonParkingPreRegistration.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /validDate: currentRequest\.lessonDate/);
  assert.doesNotMatch(source, /defaultVehicleNumber/);
  assert.doesNotMatch(source, /memberProfiles/);
});

test("parking preview reads the current lesson metadata and never hardcodes a future class", () => {
  const source = fs.readFileSync(
    new URL("../../archivein/parking/index.html", import.meta.url),
    "utf8",
  );
  assert.match(source, /params\.get\("lessonDate"\)/);
  assert.match(source, /params\.get\("lessonStartAt"\)/);
  assert.match(source, /실제 차량번호는 저장되지 않습니다/);
  assert.doesNotMatch(source, /2026-09-19/);
});
