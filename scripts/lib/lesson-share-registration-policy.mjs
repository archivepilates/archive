export const LESSON_VIDEO_ELIGIBILITY_POLICY_ID = 'registered-including-absentees-v1';

// Native registration is required; cancellation and unknown states remain ineligible.
export function isRegisteredLessonAttendance(value) {
  return value === '출석' || value === '결석';
}
