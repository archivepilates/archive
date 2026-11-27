type StepValue = { status?: unknown; detail?: unknown } | undefined;

export function hasVerifiedPairedInstructorBooking(row: Record<string, any> | null | undefined): boolean {
  const proof = row?.nativeBooking;
  const nativeId = (id: unknown) => typeof id === "string" && /^[1-9]\d{0,15}$/.test(id);
  const pair = (ids: unknown) => Array.isArray(ids) && ids.length === 2 && ids.every(nativeId) && ids[0] !== ids[1];
  return row?.bookingAutomation === "same_group_pair_v1" && row.steps?.bookings?.status === "verified"
    && proof?.status === "verified" && /^[A-Z]$/.test(proof.group || "") && proof.lessonDate === row.lessonDate
    && nativeId(proof.memberId) && proof.memberId === String(row.evidence?.studiomateMemberId || "")
    && nativeId(proof.userTicketId) && proof.userTicketId === String(row.evidence?.ticketId || "")
    && pair(proof.bookingIds) && pair(proof.lectureIds);
}

export function deriveInstructorLessonRegistrationState(input: {
  mode?: unknown;
  bookingAutomation?: unknown;
  steps?: Record<string, StepValue> | null;
}): { status: string; nextAction: string } {
  const mode = String(input.mode || "");
  if (mode === "waitlist") return { status: "waitlisted", nextAction: "결원 확인 후 운영자 확정 접수" };
  const requiresSignup = ["new_member", "team_intake"].includes(mode);
  const steps = input.steps || {};
  const status = (key: string) => String(steps[key]?.status || "pending");
  const failed = (key: string) => ["review_required", "failed"].includes(status(key));

  if (["member", "ticket", "eformsign", "memo", "confirmation"].some(failed)) {
    return { status: "action_required", nextAction: "확인필요 항목 검토" };
  }
  if (!["new_member", "returning_member", "team_intake"].includes(mode)) {
    return { status: "processing", nextAction: "StudioMate 회원 유형 확인" };
  }
  if (status("member") !== "verified" || status("ticket") !== "verified") {
    return { status: "processing", nextAction: "회원·수강권 검증 중" };
  }
  if (input.bookingAutomation === "same_group_pair_v1" && status("bookings") !== "verified") {
    return failed("bookings") ? { status: "action_required", nextAction: "StudioMate 예약 원본 확인" }
      : { status: "booking_pending", nextAction: "StudioMate 두 세션 예약 대기" };
  }
  if (requiresSignup) {
    if (status("eformsign") !== "verified") {
      return { status: "waiting_signature", nextAction: "강사회원 가입서 발송·작성 대기" };
    }
    if (status("memo") !== "verified") {
      return { status: "memo_pending", nextAction: "StudioMate 가입서 완료 메모 반영 대기" };
    }
  }
  if (status("confirmation") === "verified" || (mode !== "team_intake" && status("confirmation") === "not_required")) {
    return { status: "completed", nextAction: "없음" };
  }
  return { status: "confirmation_pending", nextAction: mode === "team_intake"
    ? "팀레슨 예약확정 안내 확인 대기" : "수강권 발급 후 예약확정 알림톡 자동 발송 대기" };
}
