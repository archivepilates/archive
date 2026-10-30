export function isInstructorLessonWaitlist(value: Record<string, any> | null | undefined): boolean {
  return value?.waitlistOnly === true || value?.courseKind === "waitlist"
    || value?.mode === "waitlist" || value?.status === "waitlisted";
}

export function instructorLessonWaitlistFields(now: unknown): Record<string, unknown> {
  return {
    courseKind: "waitlist", waitlistOnly: true, intakeOnly: true,
    mode: "waitlist", status: "waitlisted", paymentMethod: "none", ticketName: "",
    waitlistedAt: now,
    operatorChecks: { paymentConfirmed: false, seatConfirmed: false },
    nextAction: "결원 확인 후 운영자 확정 접수", lastError: null,
    steps: Object.fromEntries(["member", "ticket", "bookings", "eformsign", "memo", "confirmation"].map(key =>
      [key, { status: "not_required", label: "수강대기", detail: "미입금 대기 · 자동 처리 없음" }])),
  };
}
