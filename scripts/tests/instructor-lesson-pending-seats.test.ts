import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInstructorLessonScheduleSummaries,
  type InstructorLessonScheduleSummary,
} from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonSchedule";

const date = "2099-11-29";
const range = { startDate: date, endDate: date };

function holder(index: number) {
  return {
    id: `profile-${index}`,
    memberId: `native-${index}`,
    name: `Synthetic instructor ${index}`,
    phone: `0100000${String(index).padStart(4, "0")}`,
    activeTicketNames: ["강사레슨 (2T)"],
    activeTickets: [{ name: "강사레슨 (2T)", availableFrom: date }],
  };
}

function registration(index: number) {
  const member = holder(index);
  return {
    registrationId: `registration-${index}`,
    memberName: member.name,
    memberPhone: member.phone,
    lessonDate: date,
    status: "queued",
    source: { type: "archive_core_operator" },
    operatorChecks: { paymentConfirmed: true, seatConfirmed: true },
    steps: { member: { status: "pending" }, ticket: { status: "pending" } },
  };
}

function booking(index: number) {
  const member = holder(index);
  return {
    bookingId: `booking-${index}`,
    memberId: member.memberId,
    memberName: member.name,
    memberPhone: member.phone,
    lectureDate: date,
    startTime: "13:00",
    staffId: "synthetic-staff",
    ticketName: "강사레슨 (2T)",
    appStatus: "reserved",
  };
}

type ScheduleInput = Parameters<typeof buildInstructorLessonScheduleSummaries>[0];

function summarize(input: Omit<ScheduleInput, "startDate" | "endDate">) {
  const summaries = buildInstructorLessonScheduleSummaries({ ...range, ...input });
  assert.equal(summaries.length, 1);
  return summaries[0];
}

function rosterOf(summary: InstructorLessonScheduleSummary) {
  assert.ok(summary.roster);
  assert.equal(summary.roster.length, summary.occupiedCount);
  assert.equal(new Set(summary.roster.map((row) => row.memberKey)).size, summary.occupiedCount);
  return summary.roster;
}

test("one ticket plus two approved queued registrations occupy three seats before native ids exist", () => {
  const registrations = [
    { ...registration(0), status: "completed", steps: { ticket: { status: "verified" } } },
    registration(1),
    { ...registration(2), source: { type: "imweb_paid_order" } },
  ];
  const input = { ticketHolders: [holder(0)], registrations };
  const before = JSON.stringify(input);
  const summary = summarize(input);

  assert.equal(summary.countSource, "tickets");
  assert.equal(summary.ticketHolderCount, 1);
  assert.equal(summary.confirmedPendingRegistrationCount, 2);
  assert.equal(summary.registrationCount, 3);
  assert.equal(summary.capacity, 10);
  assert.equal(summary.occupiedCount, 3);
  assert.equal(summary.remainingSeats, 7);
  assert.equal(summary.overbookedCount, 0);
  assert.deepEqual(
    rosterOf(summary).map(({ memberName, memberId, registrationId }) => ({ memberName, memberId, registrationId })),
    registrations.map((row, index) => ({
      memberName: row.memberName,
      memberId: index === 0 ? holder(0).memberId : null,
      registrationId: row.registrationId,
    })),
  );
  assert.equal(JSON.stringify(input), before);
});

const excludedRegistrations: Array<[string, Record<string, unknown>]> = [
  ["missing operator checks", { operatorChecks: undefined }],
  ["unapproved payment", { operatorChecks: { paymentConfirmed: false, seatConfirmed: true } }],
  ["unapproved seat", { operatorChecks: { paymentConfirmed: true, seatConfirmed: false } }],
  ["missing payment approval", { operatorChecks: { seatConfirmed: true } }],
  ["missing seat approval", { operatorChecks: { paymentConfirmed: true } }],
  ["truthy non-boolean approvals", { operatorChecks: { paymentConfirmed: "true", seatConfirmed: 1 } }],
  ["Imweb order review", { source: { type: "imweb_order_review" } }],
  ["external order review", { externalOrderReviewRequired: true }],
  ["cancellation object", { cancellation: { status: "pending" } }],
  ["cancellation pending", { status: "cancellation_pending" }],
  ["cancellation review", { status: "cancellation_review" }],
  ["cancelled", { status: "cancelled" }],
  ["canceled", { status: "canceled" }],
  ["rejected", { status: "rejected" }],
  ["simulation", { newMemberSimulation: true }],
  ["nested simulation", { evidence: { newMemberSimulation: true } }],
];

for (const [reason, patch] of excludedRegistrations) {
  for (const source of ["tickets", "bookings", "none"] as const) {
    test(`${reason} cannot add a pending seat with ${source} as the authoritative source`, () => {
      const summary = summarize({
        lectures: [{ date, title: "ARCHIVE METHOD" }],
        ticketHolders: source === "tickets" ? [holder(0)] : [],
        bookings: source === "bookings" ? [booking(0)] : [],
        registrations: [{ ...registration(1), ...patch }],
      });

      assert.equal(summary.countSource, source);
      assert.equal(summary.confirmedPendingRegistrationCount, 0);
      assert.equal(summary.occupiedCount, source === "none" ? 0 : 1);
      assert.equal(summary.remainingSeats, source === "none" ? 10 : 9);
      assert.ok(rosterOf(summary).every((row) => row.registrationId !== "registration-1"));
    });
  }
}

test("unapproved registrations retain their raw audit count but not seats without native sources", () => {
  const summary = summarize({
    registrations: [
      { ...registration(1), operatorChecks: {} },
      { ...registration(2), source: { type: "imweb_order_review" } },
      { ...registration(3), externalOrderReviewRequired: true },
    ],
  });

  assert.equal(summary.registrationCount, 3);
  assert.equal(summary.confirmedPendingRegistrationCount, 0);
  assert.equal(summary.countSource, "none");
  assert.equal(summary.occupiedCount, 0);
  assert.equal(summary.remainingSeats, 10);
  assert.deepEqual(rosterOf(summary), []);
});

test("one issued ticket and two unapproved target registrations retain one of ten occupied seats", () => {
  const summary = summarize({
    ticketHolders: [holder(0)],
    registrations: [1, 2].map((index) => ({ ...registration(index), operatorChecks: {} })),
  });

  assert.equal(summary.countSource, "tickets");
  assert.equal(summary.capacity, 10);
  assert.equal(summary.registrationCount, 2);
  assert.equal(summary.confirmedPendingRegistrationCount, 0);
  assert.equal(summary.occupiedCount, 1);
  assert.equal(summary.remainingSeats, 9);
  assert.equal(rosterOf(summary).filter((row) => row.registrationId).length, 0);
});

for (const memberPhone of ["01000000000", "010-0000-0000", "+82 10-0000-0000", "821000000000"]) {
  test(`an approved pending registration matching a ticket via ${memberPhone} never doubles the seat`, () => {
    const summary = summarize({
      ticketHolders: [holder(0)],
      registrations: [{ ...registration(0), memberPhone }],
    });

    assert.equal(summary.countSource, "tickets");
    assert.equal(summary.occupiedCount, 1);
    assert.equal(summary.remainingSeats, 9);
    assert.deepEqual(rosterOf(summary).map((row) => row.registrationId), ["registration-0"]);
    assert.equal(summary.roster?.[0].memberId, holder(0).memberId);
  });
}

test("ticket issuance and subsequent ticket mirroring do not increase an already admitted seat", () => {
  const pending = registration(1);
  const verified = {
    ...pending,
    status: "completed",
    evidence: { studiomateMemberId: holder(1).memberId },
    steps: { ticket: { status: "verified" } },
  };
  const stages = [
    summarize({ ticketHolders: [holder(0)], registrations: [pending] }),
    summarize({ ticketHolders: [holder(0)], registrations: [verified] }),
    summarize({ ticketHolders: [holder(0), holder(1)], registrations: [verified] }),
  ];

  for (const summary of stages) {
    assert.equal(summary.countSource, "tickets");
    assert.equal(summary.occupiedCount, 2);
    assert.equal(summary.remainingSeats, 8);
    assert.equal(rosterOf(summary).filter((row) => row.registrationId === pending.registrationId).length, 1);
  }
  assert.equal(stages[0].confirmedPendingRegistrationCount, 1);
  assert.equal(stages[1].confirmedPendingRegistrationCount, 0);
  assert.equal(stages[2].confirmedPendingRegistrationCount, 0);
  assert.equal(stages[0].roster?.find((row) => row.registrationId === pending.registrationId)?.memberId, null);
  assert.equal(stages[2].roster?.find((row) => row.registrationId === pending.registrationId)?.memberId, holder(1).memberId);
});

test("a resolved native member awaiting issuance does not inherit another member's issued ticket flag", () => {
  const pending = {
    ...registration(1),
    ticketName: "강사레슨 (2T)",
    evidence: { studiomateMemberId: "102" },
    steps: { member: { status: "verified" }, ticket: { status: "pending" } },
  };
  const summary = summarize({
    ticketHolders: [{ ...holder(0), memberId: "101" }],
    registrations: [pending],
  });
  const roster = rosterOf(summary);

  assert.equal(summary.countSource, "tickets");
  assert.equal(summary.occupiedCount, 2);
  assert.equal(summary.confirmedPendingRegistrationCount, 1);
  assert.equal(roster.find((row) => row.memberId === "101")?.issuedTicketVerified, true);
  const row = roster.find((item) => item.registrationId === pending.registrationId);
  assert.ok(row);
  assert.equal(row.memberId, "102");
  assert.equal(row.issuedTicketVerified, false);
});

test("active ticket profiles and verified registration tickets each set their own issued ticket flag", () => {
  const summary = summarize({
    ticketHolders: [{ ...holder(0), memberId: "101" }],
    registrations: [{
      ...registration(1),
      operatorChecks: {},
      evidence: { studiomateMemberId: "102" },
      steps: { ticket: { status: "verified" } },
    }],
  });

  assert.equal(summary.occupiedCount, 2);
  assert.equal(summary.ticketHolderCount, 1);
  assert.equal(summary.verifiedRegistrationCount, 1);
  assert.equal(summary.confirmedPendingRegistrationCount, 0);
  assert.deepEqual(
    rosterOf(summary).map((row) => [row.memberId, row.issuedTicketVerified]),
    [["101", true], ["102", true]],
  );
});

test("later issuance flips the same roster identity's issued flag without changing occupancy", () => {
  const pending = { ...registration(1), evidence: { studiomateMemberId: "102" } };
  const verified = { ...pending, steps: { ticket: { status: "verified" } } };
  const base = { ...holder(0), memberId: "101" };
  const issuedProfile = { ...holder(1), memberId: "102" };
  const stages = [
    summarize({ ticketHolders: [base], registrations: [pending] }),
    summarize({ ticketHolders: [base], registrations: [verified] }),
    summarize({ ticketHolders: [base, issuedProfile], registrations: [pending] }),
    summarize({ ticketHolders: [base, issuedProfile], registrations: [verified] }),
  ];
  const rows = stages.map((summary) => {
    assert.equal(summary.occupiedCount, 2);
    assert.equal(summary.remainingSeats, 8);
    const matching = rosterOf(summary).filter((row) => row.registrationId === pending.registrationId);
    assert.equal(matching.length, 1);
    assert.equal(matching[0].memberId, "102");
    return matching[0];
  });

  assert.deepEqual(rows.map((row) => row.issuedTicketVerified), [false, true, true, true]);
  assert.equal(new Set(rows.map((row) => row.memberKey)).size, 1);
});

test("bookings merge approved pending seats without tickets and dedupe matching bookings", () => {
  const summary = summarize({
    bookings: [booking(0), { ...booking(0), bookingId: "booking-second-session", startTime: "14:10" }],
    registrations: [registration(0), registration(1), { ...registration(2), status: "processing" }],
  });

  assert.equal(summary.countSource, "bookings");
  assert.equal(summary.ticketHolderCount, 0);
  assert.equal(summary.bookingMemberCount, 1);
  assert.equal(summary.occupiedCount, 3);
  assert.equal(summary.remainingSeats, 7);
  assert.deepEqual(rosterOf(summary).map((row) => row.registrationId).sort(), ["registration-0", "registration-1", "registration-2"]);
  assert.equal(summary.roster?.[0].memberId, holder(0).memberId);
});

test("ticket precedence does not union unrelated bookings when pending seats are merged", () => {
  const summary = summarize({
    ticketHolders: [holder(0)],
    bookings: [booking(0), booking(3)],
    registrations: [registration(1), registration(2)],
  });

  assert.equal(summary.countSource, "tickets");
  assert.equal(summary.bookingMemberCount, 2);
  assert.equal(summary.confirmedPendingRegistrationCount, 2);
  assert.equal(summary.occupiedCount, 3);
  assert.ok(rosterOf(summary).every((row) => row.memberName !== holder(3).name));
});

test("approved registration-only seats retain the compatible registrations count source", () => {
  const summary = summarize({ registrations: [registration(1), registration(2)] });

  assert.equal(summary.countSource, "registrations");
  assert.equal(summary.registrationCount, 2);
  assert.equal(summary.confirmedPendingRegistrationCount, 2);
  assert.equal(summary.occupiedCount, 2);
  assert.equal(summary.remainingSeats, 8);
  assert.deepEqual(rosterOf(summary).map((row) => row.registrationId), ["registration-1", "registration-2"]);
  assert.ok(summary.roster?.every((row) => row.memberId === null));
});

test("verified issued tickets remain authoritative even without original approval checks", () => {
  const summary = summarize({
    registrations: [{
      ...registration(1),
      operatorChecks: {},
      evidence: { studiomateMemberId: holder(1).memberId },
      steps: { ticket: { status: "verified" } },
    }],
  });

  assert.equal(summary.countSource, "tickets");
  assert.equal(summary.verifiedRegistrationCount, 1);
  assert.equal(summary.confirmedPendingRegistrationCount, 0);
  assert.equal(summary.occupiedCount, 1);
  assert.equal(rosterOf(summary)[0].memberId, holder(1).memberId);
});

test("pending seats above capacity preserve actual occupancy and report overbooking", () => {
  const summary = summarize({
    ticketHolders: Array.from({ length: 9 }, (_, index) => holder(index)),
    registrations: [registration(9), registration(10), registration(11)],
  });

  assert.equal(summary.countSource, "tickets");
  assert.equal(summary.capacity, 10);
  assert.equal(summary.confirmedPendingRegistrationCount, 3);
  assert.equal(summary.occupiedCount, 12);
  assert.equal(summary.remainingSeats, 0);
  assert.equal(summary.overbookedCount, 2);
  assert.equal(rosterOf(summary).length, 12);
});

test("pending registrations remain scoped to their exact lesson date and normalized identity", () => {
  const summary = summarize({
    ticketHolders: [holder(0)],
    registrations: [
      registration(1),
      { ...registration(1), memberPhone: "+82 10-0000-0001" },
      { ...registration(2), memberName: holder(1).name },
      { ...registration(3), lessonDate: "2099-11-28" },
    ],
  });

  assert.equal(summary.confirmedPendingRegistrationCount, 2);
  assert.equal(summary.occupiedCount, 3);
  assert.equal(summary.remainingSeats, 7);
  assert.deepEqual(rosterOf(summary).map((row) => row.registrationId).filter(Boolean).sort(), ["registration-1", "registration-2"]);
});
