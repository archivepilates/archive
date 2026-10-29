import assert from "node:assert/strict";
import test from "node:test";
import { parseInstructorCourseInput, sameInstructorCourse, teamIntakeFields, teamScheduleMetadata }
  from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonTeamIntake";
import { buildInstructorLessonScheduleSummaries }
  from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonSchedule";
import { instructorLessonTicketConfirmationIssue, queueInstructorLessonConfirmationOnTicketVerifiedHandler }
  from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonConfirmation";

const input = { courseKind: "team", lessonTime: "14:00", lessonTopic: "ARCHIVE METHOD #1 합성 테스트", paymentAmount: 80000 };
test("legacy standard default is unchanged, custom input cannot be silently dropped", () => {
  assert.deepEqual(parseInstructorCourseInput({}), { courseKind: "standard" });
  assert.throws(() => parseInstructorCourseInput({ paymentAmount: 80000 }));
  assert.throws(() => parseInstructorCourseInput({ courseKind: "other" }));
});
test("Team input validates exact time topic and numeric amount", () => {
  assert.deepEqual(parseInstructorCourseInput(input), input);
  for (const patch of [{ lessonTime: "24:00" }, { lessonTime: "14:60" }, { lessonTopic: "" },
    { lessonTopic: "x".repeat(101) }, { lessonTopic: "bad\ntext" }, { paymentAmount: "80000" },
    { paymentAmount: 0 }, { paymentAmount: 1.5 }, { paymentAmount: Infinity }]) {
    assert.throws(() => parseInstructorCourseInput({ ...input, ...patch }));
  }
});
test("Team plan is review-only, never a regular issuance or signed/completed state", () => {
  const fields = teamIntakeFields(parseInstructorCourseInput(input)) as any;
  assert.equal(fields.ticketName, "Team 강사레슨");
  assert.equal(fields.status, "action_required");
  assert.equal(fields.intakeOnly, true);
  assert.equal(fields.mode, "team_intake");
  assert.ok(Object.values(fields.steps).every((step: any) => step.status === "review_required"));
  assert.ok(sameInstructorCourse(fields, parseInstructorCourseInput(input)));
  for (const patch of [{ lessonTime: "15:00" }, { lessonTopic: "other" }, { paymentAmount: 70000 },
    { courseKind: "standard" }, { intakeOnly: false }]) {
    assert.equal(sameInstructorCourse({ ...fields, ...patch }, parseInstructorCourseInput(input)), false);
  }
  assert.ok(sameInstructorCourse({ ticketName: "강사레슨 (2T)" }, { courseKind: "standard" }));
});
test("six confirmed Team intakes count immediately, with no invented end time or native capacity", () => {
  const registrations = Array.from({ length: 6 }, (_, i) => ({
    ...teamIntakeFields(parseInstructorCourseInput(input)), memberName: `합성 ${i}`,
    memberPhone: `0100000000${i}`, lessonDate: "2026-11-20", registrationId: `synthetic-${i}`,
    operatorChecks: { paymentConfirmed: true, seatConfirmed: true }, source: { type: "archive_core_operator" },
  }));
  const result = buildInstructorLessonScheduleSummaries({ startDate: "2026-11-01", endDate: "2026-11-30", registrations });
  assert.equal(result.length, 1);
  const day = result[0];
  assert.equal(day.occupiedCount, 6);
  assert.equal(day.startAt, "2026-11-20T05:00:00.000Z");
  assert.equal(day.endAt, null);
  assert.equal(day.sessionCount, 0);
  assert.equal(day.capacitySource, "default");
  assert.equal(day.lessonTopic, input.lessonTopic);
  assert.equal(day.roster?.length, 6);
  assert.ok(day.roster?.every(row => !row.issuedTicketVerified));
  assert.ok(!JSON.stringify(day).includes("0100000000"));
  assert.equal(teamScheduleMetadata([{ ...input }, { ...input, lessonTime: "15:00" }]).metadataSource, "conflict");
  assert.equal(teamScheduleMetadata([{ ...input }, { courseKind: "standard" }]).metadataSource, "conflict");
  const mixed = buildInstructorLessonScheduleSummaries({ startDate: "2026-11-01", endDate: "2026-11-30", registrations,
    lectures: [{ date: "2026-11-20", title: "강사레슨 (2T)", startAt: "2026-11-20T00:00:00Z", capacity: 5 }] })[0];
  assert.equal(mixed.metadataSource, "conflict");
  assert.equal(mixed.capacitySource, "default");
  assert.equal(mixed.startAt, null);
  registrations[0].status = "cancelled";
  assert.equal(buildInstructorLessonScheduleSummaries({ startDate: "2026-11-01", endDate: "2026-11-30", registrations })[0].occupiedCount, 5);
});
test("Team intake cannot trigger or manually queue a regular confirmation even with verified ticket steps", async () => {
  const registration = { intakeOnly: true, courseKind: "team", ticketName: "강사레슨 (2T)",
    operatorChecks: { paymentConfirmed: true, seatConfirmed: true },
    steps: { member: { status: "verified" }, ticket: { status: "verified" } } };
  assert.match(instructorLessonTicketConfirmationIssue(registration), /팀레슨 접수 전용/);
  const result = await queueInstructorLessonConfirmationOnTicketVerifiedHandler({ registrationId: "synthetic", after: registration });
  assert.equal(result.skipped, "team_intake_only");
});
