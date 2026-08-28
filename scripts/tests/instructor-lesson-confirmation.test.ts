import assert from "node:assert/strict";
import test from "node:test";
import type { BookingDoc } from "../../firebase/kangsain-functions/functions/src/types/models";
import {
  activeInstructorLessonBooking,
  instructorLessonConfirmationCandidateId,
  instructorLessonConfirmationScheduleFor,
} from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonConfirmation";
import { deriveInstructorLessonRegistrationState } from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonRegistrationState";

test("승인된 강사레슨 일정은 캘린더 관리번호와 두 세션 문구를 고정한다", () => {
  const schedule = instructorLessonConfirmationScheduleFor("2026-09-19");
  assert.ok(schedule);
  assert.equal(schedule.managementNumber, "external-feedback-260919");
  assert.equal(schedule.lessonTimeText, "13:00~15:10");
  assert.equal(
    schedule.lessonComposition,
    "민진T 리포머 + 폼롤러\n은영T 바렐 + 토닝볼",
  );
  assert.equal(
    schedule.calendarUrl,
    "https://in.archivepilates.com/method/external-feedback-260919/calendar/",
  );
  assert.equal(instructorLessonConfirmationScheduleFor("2026-09-21"), null);
});

test("예약확정 후보는 전화번호 표기 차이를 정규화하고 수업일별로 분리한다", () => {
  const first = instructorLessonConfirmationCandidateId({
    phone: "010-8648-8585",
    lessonDate: "2026-09-19",
    managementNumber: "external-feedback-260919",
  });
  assert.equal(
    first,
    instructorLessonConfirmationCandidateId({
      phone: "+82 10 8648 8585",
      lessonDate: "2026-09-19",
      managementNumber: "external-feedback-260919",
    }),
  );
  assert.notEqual(
    first,
    instructorLessonConfirmationCandidateId({
      phone: "01086488585",
      lessonDate: "2026-09-20",
      managementNumber: "external-feedback-260920",
    }),
  );
});

test("취소·대체·비정규 예약은 예약확정 발송 원천에서 제외한다", () => {
  assert.equal(activeInstructorLessonBooking(booking()), true);
  assert.equal(
    activeInstructorLessonBooking(booking({ appStatus: "cancel" })),
    false,
  );
  assert.equal(
    activeInstructorLessonBooking(
      booking({ sourceStatus: "missing_from_latest_reservation_import" }),
    ),
    false,
  );
  assert.equal(
    activeInstructorLessonBooking(
      booking({ supersededByBookingId: "booking-new" }),
    ),
    false,
  );
  assert.equal(
    activeInstructorLessonBooking(
      booking({ archiveBooking: { isCanonical: false } }),
    ),
    false,
  );
});

test("예약과 알림톡 결과가 모두 확인돼야 등록 완료가 된다", () => {
  const ready = {
    member: { status: "verified" },
    ticket: { status: "verified" },
    eformsign: { status: "not_required" },
    memo: { status: "not_required" },
    bookings: { status: "verified" },
  };
  assert.equal(
    deriveInstructorLessonRegistrationState({
      mode: "returning_member",
      steps: { ...ready, confirmation: { status: "queued" } },
    }).status,
    "confirmation_pending",
  );
  assert.equal(
    deriveInstructorLessonRegistrationState({
      mode: "returning_member",
      steps: { ...ready, confirmation: { status: "verified" } },
    }).status,
    "completed",
  );
});

function booking(overrides: Record<string, unknown> = {}): BookingDoc {
  return {
    bookingId: "booking-1",
    lectureId: "lecture-1",
    studioId: "5330",
    memberId: "member-1",
    memberName: "테스트",
    memberPhone: "01012345678",
    memberRegisteredAt: null,
    staffId: "staff-1",
    staffName: "강사",
    lectureDate: "2026-09-19",
    lectureStartAt: null,
    lectureEndAt: null,
    sourceStatus: "예약",
    appStatus: "reserved",
    attendanceStatus: "unchecked",
    syncStatus: "synced",
    ticketName: "강사레슨 (2T)",
    ticketRemainingCount: 2,
    ticketExpiresAt: null,
    ticketExpiryLevel: "normal",
    memberTagIds: [],
    lastMemoPreview: "",
    lastMemoAt: null,
    lastChangedBy: "test",
    sourceHash: "source",
    sourceUpdatedAt: null,
    syncedAt: null as never,
    updatedAt: null as never,
    ...overrides,
  } as BookingDoc;
}
