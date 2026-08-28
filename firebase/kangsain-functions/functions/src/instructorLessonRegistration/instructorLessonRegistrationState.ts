type StepValue = { status?: unknown; detail?: unknown } | undefined;

export function deriveInstructorLessonRegistrationState(input: {
  mode?: unknown;
  steps?: Record<string, StepValue> | null;
}): { status: string; nextAction: string } {
  const mode = String(input.mode || "");
  const steps = input.steps || {};
  const status = (key: string) => String(steps[key]?.status || "pending");
  const failed = (key: string) => ["review_required", "failed"].includes(status(key));

  if (["member", "ticket", "eformsign", "memo", "bookings", "confirmation"].some(failed)) {
    return { status: "action_required", nextAction: "확인필요 항목 검토" };
  }
  if (!["new_member", "returning_member"].includes(mode)) {
    return { status: "processing", nextAction: "StudioMate 회원 유형 확인" };
  }
  if (status("member") !== "verified" || status("ticket") !== "verified") {
    return { status: "processing", nextAction: "회원·수강권 검증 중" };
  }
  if (mode === "new_member") {
    if (status("eformsign") !== "verified") {
      return { status: "waiting_signature", nextAction: "강사회원 가입서 발송·작성 대기" };
    }
    if (status("memo") !== "verified") {
      return { status: "memo_pending", nextAction: "StudioMate 가입서 완료 메모 반영 대기" };
    }
  }
  if (!["verified", "not_required"].includes(status("bookings"))) {
    return { status: "booking_pending", nextAction: "StudioMate 반배정·예약 후 CORE에서 예약 완료 확인" };
  }
  if (["verified", "not_required"].includes(status("confirmation"))) {
    return { status: "completed", nextAction: "없음" };
  }
  return { status: "confirmation_pending", nextAction: "강사레슨 예약확정 알림톡 발송 대기" };
}
