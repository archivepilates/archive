import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInstructorLessonScheduleSummaries,
  type InstructorLessonScheduleSummary,
} from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonSchedule";

const date = "2026-09-19";
const range = { startDate: date, endDate: "2026-09-20" };

function holder(index: number, lessonDate = date) {
  return {
    id: `profile-${index}`,
    memberId: `member-${index}`,
    name: `Member ${index}`,
    phone: `0102345${String(index).padStart(4, "0")}`,
    activeTicketNames: ["강사레슨 (2T)"],
    activeTickets: [{ name: "강사레슨 (2T)", availableFrom: lessonDate }],
  };
}

function registration(index: number, status = "completed", lessonDate = date) {
  const member = holder(index);
  return {
    id: `registration-${index}`,
    memberName: member.name,
    memberPhone: member.phone,
    lessonDate,
    status,
  };
}

function booking(index: number, startTime = "13:00") {
  const member = holder(index);
  return {
    id: `booking-${index}-${startTime}`,
    memberId: member.memberId,
    memberName: member.name,
    memberPhone: member.phone,
    lectureDate: date,
    startTime,
    staffId: "staff-a",
    ticketName: "강사레슨 (2T)",
    appStatus: "reserved",
  };
}

function rosterOf(summary: InstructorLessonScheduleSummary) {
  assert.ok(summary.roster);
  assert.equal(summary.roster.length, summary.occupiedCount);
  assert.equal(new Set(summary.roster.map((row) => row.memberKey)).size, summary.occupiedCount);
  for (const row of summary.roster) {
    assert.ok(row.memberName.trim());
    assert.deepEqual(
      Object.keys(row).sort(),
      ["memberId", "memberKey", "memberName", ...(row.registrationId ? ["registrationId"] : [])].sort(),
    );
  }
  return summary.roster;
}

test("ten ticket holders produce ten roster rows even with nine registrations and eleven bookings", () => {
  const ticketHolders = Array.from({ length: 10 }, (_, index) => holder(index));
  ticketHolders[9].name = "";
  const [summary] = buildInstructorLessonScheduleSummaries({
    ...range,
    ticketHolders: [...ticketHolders, holder(0)],
    bookings: Array.from({ length: 11 }, (_, index) => booking(index)),
    registrations: Array.from({ length: 9 }, (_, index) => registration(index)),
  });
  const roster = rosterOf(summary);

  assert.equal(summary.countSource, "tickets");
  assert.equal(summary.occupiedCount, 10);
  assert.equal(summary.ticketHolderCount, 10);
  assert.equal(summary.bookingMemberCount, 11);
  assert.equal(summary.registrationCount, 9);
  assert.deepEqual(
    roster.map((row) => row.memberId),
    ticketHolders.map((row) => row.memberId),
  );
  assert.equal(roster[9].memberName, "이름 미확인");
  assert.equal(roster[9].registrationId, undefined);
  assert.deepEqual(
    roster.slice(0, 9).map((row) => row.registrationId),
    Array.from({ length: 9 }, (_, index) => `registration-${index}`),
  );
});

test("booking roster uses canonical occurrences, dedupes sessions, and preserves inactive exclusions", () => {
  const real = booking(0);
  const fallback = { ...real, id: "excel_booking_duplicate", memberId: "excel_0", memberName: "Fallback" };
  const excluded = [
    { ...booking(1), appStatus: "cancelled" },
    { ...booking(2), active: false },
    { ...booking(3), archiveBooking: { isCanonical: false } },
    { ...booking(4), supersededByBookingId: "replacement" },
    { ...booking(5), sourceStatus: "missing_from_latest_reservation_import" },
    { ...booking(6), reconcileStatus: "stale" },
    { ...booking(7), sourceStatus: "duplicate" },
    { ...booking(8), sourceStatus: "lecture_deleted" },
    { ...booking(9), sourceStatus: "cancelled" },
    { ...booking(10), ticketName: "Other lesson" },
    { ...booking(11), lectureDate: "2026-10-01" },
  ];
  const [summary] = buildInstructorLessonScheduleSummaries({
    ...range,
    bookings: [fallback, real, booking(0, "14:10"), ...excluded],
    registrations: [registration(0, "processing"), registration(12)],
  });
  const roster = rosterOf(summary);

  assert.equal(summary.countSource, "bookings");
  assert.equal(summary.bookingMemberCount, 1);
  assert.equal(summary.registrationCount, 2);
  assert.equal(roster[0].memberId, real.memberId);
  assert.equal(roster[0].memberName, real.memberName);
  assert.equal(roster[0].registrationId, "registration-0");
});

test("ticket roster excludes date-matched synthetic members and uses only current ticket dates", () => {
  const summaries = buildInstructorLessonScheduleSummaries({
    ...range,
    ticketHolders: [
      holder(0),
      holder(0, "2026-09-20"),
      holder(1),
      holder(2),
      { ...holder(2), activeTickets: [...holder(2).activeTickets, ...holder(2).activeTickets] },
      { ...holder(3), activeTickets: [] },
      { ...holder(4), activeTicketNames: ["Other lesson"] },
      { ...holder(5, "2026-10-01"), instructorLessonDates: [date] },
    ],
    registrations: [
      { ...registration(0), newMemberSimulation: true },
      { ...registration(1), evidence: { newMemberSimulation: true } },
      registration(2, "cancelled"),
    ],
  });

  assert.deepEqual(
    summaries.map((summary) => summary.date),
    [date, "2026-09-20"],
  );
  assert.deepEqual(
    rosterOf(summaries[0]).map((row) => row.memberId),
    ["member-2"],
  );
  assert.equal(summaries[0].registrationCount, 0);
  assert.equal(summaries[0].roster?.[0].registrationId, undefined);
  assert.deepEqual(
    rosterOf(summaries[1]).map((row) => row.memberId),
    ["member-0"],
  );
});

test("registration fallback retains existing eligible statuses and excludes cancelled and synthetic rows", () => {
  const statuses = ["queued", "processing", "completed", "failed", "needs_review"];
  const [summary] = buildInstructorLessonScheduleSummaries({
    ...range,
    registrations: [
      ...statuses.map((status, index) => registration(index, status)),
      registration(0, "queued"),
      registration(5, " CANCELLED "),
      registration(6, "canceled"),
      registration(7, "rejected"),
      { ...registration(8), newMemberSimulation: true },
      { ...registration(9), evidence: { newMemberSimulation: true } },
      registration(10, "completed", "2026-10-01"),
      { registrationId: "registration-anonymous", lessonDate: date, status: "queued" },
    ],
  });
  const roster = rosterOf(summary);

  assert.equal(summary.countSource, "registrations");
  assert.equal(summary.registrationCount, 6);
  assert.deepEqual(
    roster.map((row) => row.registrationId),
    [...statuses.map((_, index) => `registration-${index}`), "registration-anonymous"],
  );
  assert.ok(roster.every((row) => row.memberId === null));
  assert.equal(roster[5].memberName, "이름 미확인");
});

test("registration correlation uses normalized identity and date, not a shared name", () => {
  const [summary] = buildInstructorLessonScheduleSummaries({
    ...range,
    ticketHolders: [holder(0), holder(1), holder(2), holder(3)],
    registrations: [
      { ...registration(0, "failed"), memberPhone: "+82 10-2345-0000" },
      { ...registration(4), memberName: holder(1).name },
      registration(2, "completed", "2026-09-20"),
      registration(3, "rejected"),
    ],
  });
  const roster = rosterOf(summary);

  assert.equal(roster[0].registrationId, "registration-0");
  assert.ok(roster.slice(1).every((row) => row.registrationId === undefined));
});

test("ambiguous registration ids do not select an arbitrary registration", () => {
  const [summary] = buildInstructorLessonScheduleSummaries({
    ...range,
    ticketHolders: [holder(0)],
    registrations: [registration(0), { ...registration(0), id: "registration-other" }],
  });

  assert.equal(summary.registrationCount, 1);
  assert.equal(rosterOf(summary)[0].registrationId, undefined);
});

test("roster exposes only display fields and an opaque stable key, never phone or raw evidence", () => {
  const input = {
    ...range,
    ticketHolders: [{ ...holder(0), email: "private@example.invalid", memo: "PRIVATE_MEMO" }],
    registrations: [{ ...registration(0), evidence: { privateAnswer: "PRIVATE_ANSWER" } }],
  };
  const before = JSON.stringify(input);
  const [summary] = buildInstructorLessonScheduleSummaries(input);
  const roster = rosterOf(summary);
  const json = JSON.stringify(roster);

  assert.match(roster[0].memberKey, /^member:[a-f0-9]{64}$/);
  assert.ok(!json.includes(holder(0).phone));
  assert.doesNotMatch(json, /phone|email|memo|evidence|PRIVATE_|example\.invalid/i);
  assert.equal(JSON.stringify(input), before);
  const [normalized] = buildInstructorLessonScheduleSummaries({
    ...range,
    ticketHolders: [{ ...holder(0), phone: "+82 10-2345-0000" }],
  });
  assert.equal(rosterOf(normalized)[0].memberKey, roster[0].memberKey);
});

test("member ids come from real profile or resolved member identifiers, not booking or registration ids", () => {
  const [tickets] = buildInstructorLessonScheduleSummaries({
    ...range,
    ticketHolders: [
      { ...holder(0), memberId: "", id: "real-profile" },
      { ...holder(1), memberId: "excel_member", id: "excel_profile", name: "" },
      { ...holder(2), memberId: "", id: "excel_anonymous" },
      { ...holder(3), memberId: "alphabetic-id", phone: "" },
    ],
    registrations: [{ ...registration(1), evidence: { studiomateMemberId: "resolved-member" } }],
  });
  const ticketRoster = rosterOf(tickets);
  assert.deepEqual(
    ticketRoster.map((row) => row.memberId),
    ["real-profile", "resolved-member", null, "alphabetic-id"],
  );
  assert.equal(ticketRoster[1].memberName, "Member 1");

  const [bookings] = buildInstructorLessonScheduleSummaries({
    ...range,
    bookings: [{ ...booking(0), memberId: "" }],
  });
  assert.equal(rosterOf(bookings)[0].memberId, null);
  const [registrations] = buildInstructorLessonScheduleSummaries({
    ...range,
    registrations: [registration(0), { ...registration(1), studiomateMemberId: "resolved-top-level" }],
  });
  assert.deepEqual(
    rosterOf(registrations).map((row) => row.memberId),
    [null, "resolved-top-level"],
  );
});

test("empty lecture schedules include an empty roster", () => {
  const [summary] = buildInstructorLessonScheduleSummaries({
    ...range,
    lectures: [{ date, title: "ARCHIVE METHOD" }],
  });

  assert.equal(summary.countSource, "none");
  assert.deepEqual(rosterOf(summary), []);
});
