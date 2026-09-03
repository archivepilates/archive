import assert from "node:assert/strict";
import test from "node:test";
import {
  instructorLessonManagementNumberFor,
  normalizeInstructorLessonManagementNumber,
} from "../../firebase/kangsain-functions/functions/src/alimtalk/instructorLessonManagement";

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

test("normalizes historical test identifiers out of management numbers", () => {
  assert.equal(
    normalizeInstructorLessonManagementNumber("circulation-kg02-260530"),
    "circulation-260530",
  );
});
