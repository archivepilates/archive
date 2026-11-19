import assert from "node:assert/strict";
import test from "node:test";
import {
  instructorLessonManagementNumberFor,
  normalizeInstructorLessonManagementNumber,
} from "../../firebase/kangsain-functions/functions/src/alimtalk/instructorLessonManagement";
import { isTeamInstructorLessonBooking } from "../../firebase/kangsain-functions/functions/src/alimtalk/instructorLessonBookingPolicy";
import type { BookingDoc } from "../../firebase/kangsain-functions/functions/src/types/models";

test("maps the August Korean StudioMate titles to date-specific support and movement pages", () => {
  assert.equal(
    instructorLessonManagementNumberFor({
      title: "8월 강사레슨 A",
      lessonDate: "2026-08-29",
    }),
    "support-movement-260829",
  );
  assert.equal(
    instructorLessonManagementNumberFor({
      title: "8월 강사레슨 D",
      lessonDate: "2026. 8. 30.",
    }),
    "support-movement-260830",
  );
});

test("keeps the existing English topic fallback for future StudioMate titles", () => {
  assert.equal(
    instructorLessonManagementNumberFor({
      title: "ARCHIVE METHOD circulation",
      lessonDate: "2026-05-30",
    }),
    "archive-method-circulation-260530",
  );
});

test("maps both October teams to the shared date-specific material", () => {
  for (const lessonDate of ["2026-10-24", "2026-10-25"]) {
    for (const team of ["A", "B", "C", "D"]) {
      assert.equal(instructorLessonManagementNumberFor({
        title: `10월 강사레슨 ${team}`, lessonDate,
      }), `external-feedback-${lessonDate.slice(2).replace(/-/g, "")}`);
    }
  }
});

test("does not turn an unmapped team-only title into a material URL", () => {
  for (const title of ["11월 강사레슨 A", "11월 강사레슨 B", "강사레슨 team"]) {
    assert.equal(instructorLessonManagementNumberFor({ title, lessonDate: "2026-11-21" }), "");
  }
});

test("routes verified Team passes to date-specific Team material without guessing a topic", () => {
  for (const ticketName of ["Team 강사레슨", "Team강사레슨", "팀 강사레슨"]) {
    const teamLesson = isTeamInstructorLessonBooking({ ticketName } as BookingDoc);
    assert.equal(teamLesson, true);
    assert.equal(instructorLessonManagementNumberFor({
      title: "강사레슨 (Team)", lessonDate: "2026-11-20", teamLesson,
    }), "team-261120");
    assert.equal(instructorLessonManagementNumberFor({
      title: "강사레슨 (Team)", lessonDate: "2026-11-21", teamLesson,
    }), "team-261121");
  }
});

test("keeps an explicit Team material topic and avoids ordinary-class date overrides", () => {
  assert.equal(instructorLessonManagementNumberFor({
    title: "강사레슨 external-feedback", lessonDate: "2026-11-21", teamLesson: true,
  }), "external-feedback-261121");
  assert.equal(instructorLessonManagementNumberFor({
    title: "강사레슨 Team", lessonDate: "2026-10-24", teamLesson: true,
  }), "team-261024");
});

test("never treats a class label or an ordinary pass as a canonical Team pass", () => {
  for (const ticketName of ["강사레슨 (2T)", "일반 그룹", "Team PT", "", "Team 강사레슨 체험"]) {
    assert.equal(isTeamInstructorLessonBooking({ ticketName } as BookingDoc), false);
  }
});

test("normalizes historical test identifiers out of management numbers", () => {
  assert.equal(
    normalizeInstructorLessonManagementNumber("circulation-kg02-260530"),
    "circulation-260530",
  );
});
