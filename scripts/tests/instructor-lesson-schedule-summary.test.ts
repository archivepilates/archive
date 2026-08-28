import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInstructorLessonRegistrationCounts,
  buildInstructorLessonScheduleSummaries,
  INSTRUCTOR_LESSON_DEFAULT_CAPACITY,
} from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonSchedule";

test("실제 예약이 있으면 수강권 보유 인원보다 예약 고유 인원을 우선한다", () => {
  const bookings = Array.from({ length: 10 }, (_, index) => [
    booking(index, "13:00", "staff-a"),
    booking(index, "14:10", "staff-b"),
  ]).flat();
  const ticketHolders = Array.from({ length: 8 }, (_, index) =>
    holder(index, "2026-08-30"),
  );
  const [summary] = buildInstructorLessonScheduleSummaries({
    startDate: "2026-08-28",
    endDate: "2026-12-31",
    lectures: lecturePair("2026-08-30"),
    bookings,
    ticketHolders,
  });

  assert.equal(summary.countSource, "bookings");
  assert.equal(summary.bookingMemberCount, 10);
  assert.equal(summary.ticketHolderCount, 8);
  assert.equal(summary.occupiedCount, 10);
  assert.equal(summary.remainingSeats, 0);
});

test("반배정 전 일정은 강사레슨 수강권 보유 인원으로 남은 좌석을 계산한다", () => {
  const [summary] = buildInstructorLessonScheduleSummaries({
    startDate: "2026-08-28",
    endDate: "2026-12-31",
    ticketHolders: Array.from({ length: 9 }, (_, index) =>
      holder(index, "2026-09-19"),
    ),
  });

  assert.equal(summary.countSource, "tickets");
  assert.equal(summary.capacity, INSTRUCTOR_LESSON_DEFAULT_CAPACITY);
  assert.equal(summary.occupiedCount, 9);
  assert.equal(summary.remainingSeats, 1);
  assert.equal(summary.sessionCount, 0);
});

test("수강권 발급 전에는 취소되지 않은 CORE 접수 인원을 사용한다", () => {
  const registrations = [
    registration(0, "queued"),
    registration(1, "processing"),
    registration(2, "completed"),
    registration(3, "cancelled"),
  ];
  const [summary] = buildInstructorLessonScheduleSummaries({
    startDate: "2026-08-28",
    endDate: "2026-12-31",
    registrations,
  });

  assert.equal(summary.countSource, "registrations");
  assert.equal(summary.registrationCount, 3);
  assert.equal(summary.remainingSeats, 7);
});

test("수업 정원이 있으면 같은 시작 시간의 병렬 수업 정원을 합산한다", () => {
  const [summary] = buildInstructorLessonScheduleSummaries({
    startDate: "2026-08-28",
    endDate: "2026-12-31",
    lectures: lecturePair("2026-09-20"),
    ticketHolders: Array.from({ length: 5 }, (_, index) =>
      holder(index, "2026-09-20"),
    ),
  });

  assert.equal(summary.capacitySource, "lecture");
  assert.equal(summary.capacity, 10);
  assert.equal(summary.remainingSeats, 5);
});

test("취소·대체된 예약과 엑셀 중복 예약은 좌석을 늘리지 않는다", () => {
  const real = booking(0, "13:00", "staff-a");
  const duplicate = { ...real, bookingId: "excel_booking_duplicate" };
  const cancelled = { ...booking(1, "13:00", "staff-a"), appStatus: "cancel" };
  const superseded = {
    ...booking(2, "13:00", "staff-a"),
    sourceStatus: "superseded_by_latest_reservation_import",
  };
  const [summary] = buildInstructorLessonScheduleSummaries({
    startDate: "2026-08-28",
    endDate: "2026-12-31",
    lectures: lecturePair("2026-08-30"),
    bookings: [real, duplicate, cancelled, superseded],
  });

  assert.equal(summary.bookingMemberCount, 1);
  assert.equal(summary.remainingSeats, 9);
});

test("현재 활성 수강권 날짜를 사용하고 누적된 과거 날짜는 다시 세지 않는다", () => {
  const summaries = buildInstructorLessonScheduleSummaries({
    startDate: "2026-08-28",
    endDate: "2026-12-31",
    ticketHolders: [
      {
        ...holder(0, "2026-09-19"),
        activeTickets: [
          {
            name: "강사레슨 (2T)",
            availableFrom: "2026-09-20T00:00:00+09:00",
          },
        ],
      },
    ],
  });

  assert.deepEqual(summaries.map((item) => item.date), ["2026-09-20"]);
  assert.equal(summaries[0].ticketHolderCount, 1);
});

test("스텝 수강권은 예약 전 좌석에서 제외하고 강사회원 수강권만 센다", () => {
  const [summary] = buildInstructorLessonScheduleSummaries({
    startDate: "2026-08-28",
    endDate: "2026-12-31",
    ticketHolders: [
      activeHolder(0, "2026-09-19", "강사회원"),
      activeHolder(1, "2026-09-19", "스텝"),
    ],
  });

  assert.equal(summary.ticketHolderCount, 1);
  assert.equal(summary.remainingSeats, 9);
});

test("신규회원 E2E 시뮬레이션은 접수와 같은 날짜의 테스트 수강권 모두 제외한다", () => {
  const [summary] = buildInstructorLessonScheduleSummaries({
    startDate: "2026-08-28",
    endDate: "2026-12-31",
    ticketHolders: [
      activeHolder(0, "2026-09-20", "강사회원"),
      activeHolder(1, "2026-09-20", "강사회원"),
    ],
    registrations: [
      {
        ...registration(0, "completed"),
        newMemberSimulation: true,
      },
    ],
  });

  assert.equal(summary.ticketHolderCount, 1);
  assert.equal(summary.registrationCount, 0);
  assert.equal(summary.occupiedCount, 1);
});

test("대시보드 상태 카운트는 합성 테스트 등록을 제외한다", () => {
  const counts = buildInstructorLessonRegistrationCounts(
    [
      registration(0, "completed"),
      { ...registration(1, "completed"), evidence: { newMemberSimulation: true } },
      registration(2, "failed"),
    ],
    ["completed", "failed"],
  );

  assert.deepEqual(counts, { completed: 1, failed: 1 });
});

function lecturePair(date: string) {
  return [
    {
      lectureId: `${date}-a`,
      date,
      title: "ARCHIVE METHOD 강사레슨 A",
      startAt: `${date}T13:00:00+09:00`,
      endAt: `${date}T14:00:00+09:00`,
      capacity: 5,
    },
    {
      lectureId: `${date}-b`,
      date,
      title: "ARCHIVE METHOD 강사레슨 B",
      startAt: `${date}T13:00:00+09:00`,
      endAt: `${date}T14:00:00+09:00`,
      capacity: 5,
    },
  ];
}

function booking(index: number, time: string, staffId: string) {
  return {
    bookingId: `booking-${index}-${time}`,
    lectureId: `2026-08-30-${time}`,
    lectureDate: "2026-08-30",
    lectureStartAt: `2026-08-30T${time}:00+09:00`,
    memberId: `member-${index}`,
    memberPhone: `0101234${String(index).padStart(4, "0")}`,
    staffId,
    ticketName: "강사레슨 (2T)",
    appStatus: "reserved",
    sourceStatus: "예약",
  };
}

function holder(index: number, date: string) {
  return {
    memberId: `member-${index}`,
    phone: `0101234${String(index).padStart(4, "0")}`,
    activeTicketNames: ["강사레슨 (2T)"],
    instructorLessonDates: [date],
  };
}

function activeHolder(index: number, date: string, memberGrade: string) {
  return {
    memberId: `member-${index}`,
    phone: `0105678${String(index).padStart(4, "0")}`,
    memberGrade,
    activeTicketNames: ["강사레슨 (2T)"],
    activeTickets: [{ name: "강사레슨 (2T)", availableFrom: `${date}T00:00:00+09:00` }],
    instructorLessonDates: [date],
  };
}

function registration(index: number, status: string) {
  return {
    registrationId: `registration-${index}`,
    memberPhone: `0105678${String(index).padStart(4, "0")}`,
    lessonDate: "2026-09-20",
    status,
  };
}
