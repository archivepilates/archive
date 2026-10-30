import { AppError } from "../utils/errors";

export type InstructorCourseInput = {
  courseKind: "standard" | "team" | "waitlist";
  lessonTime?: string;
  lessonTopic?: string;
  paymentAmount?: number;
};

export function parseInstructorCourseInput(value: Record<string, unknown>): InstructorCourseInput {
  const kind = value.courseKind ?? "standard";
  if (kind !== "standard" && kind !== "team" && kind !== "waitlist") {
    throw new AppError("INVALID_ARGUMENT", "강사레슨 과정 구분을 확인하세요.");
  }
  if (kind === "standard" || kind === "waitlist") {
    if (["lessonTime", "lessonTopic", "paymentAmount"].some(key => value[key] !== undefined)) {
      throw new AppError("INVALID_ARGUMENT", "팀레슨 세부정보는 팀레슨 과정에서만 입력하세요.");
    }
    return { courseKind: kind };
  }
  const lessonTime = typeof value.lessonTime === "string" ? value.lessonTime.trim() : "";
  const lessonTopic = typeof value.lessonTopic === "string" ? value.lessonTopic.trim() : "";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(lessonTime)) {
    throw new AppError("INVALID_ARGUMENT", "팀레슨 시작 시간을 HH:mm으로 입력하세요.");
  }
  if (!lessonTopic || lessonTopic.length > 100 || /[\x00-\x1f\x7f]/.test(lessonTopic)) {
    throw new AppError("INVALID_ARGUMENT", "팀레슨 주제를 100자 이내로 입력하세요.");
  }
  if (typeof value.paymentAmount !== "number" || !Number.isSafeInteger(value.paymentAmount)
    || value.paymentAmount <= 0 || value.paymentAmount > 10_000_000) {
    throw new AppError("INVALID_ARGUMENT", "팀레슨 1인 결제금액을 확인하세요.");
  }
  return { courseKind: "team", lessonTime, lessonTopic, paymentAmount: value.paymentAmount };
}

export function sameInstructorCourse(existing: Record<string, any>, input: InstructorCourseInput): boolean {
  const existingKind = existing.courseKind || (existing.ticketName === "Team 강사레슨" ? "team" : "standard");
  return existingKind === input.courseKind && (input.courseKind !== "team"
    || (existing.lessonTime === input.lessonTime && existing.lessonTopic === input.lessonTopic
      && existing.paymentAmount === input.paymentAmount && existing.intakeOnly === true));
}

export function teamIntakeFields(input: InstructorCourseInput): Record<string, unknown> {
  if (input.courseKind !== "team") throw new AppError("INVALID_ARGUMENT", "팀레슨 접수가 아닙니다.");
  const review = (label: string, detail: string) => ({ status: "review_required", label, detail });
  return {
    ...input,
    ticketName: "Team 강사레슨",
    intakeOnly: true,
    mode: "team_intake",
    status: "action_required",
    nextAction: "팀레슨 접수 완료 · 수강권/가입서/안내 확인 대기",
    steps: {
      member: review("회원·등급 확인", "실시간 StudioMate 신원 확인 대기"),
      ticket: review("Team 강사레슨 발급", "일반 2T 발급 작업은 생성하지 않음"),
      bookings: review("팀레슨 예약", "원본 일정·정원 확인 대기"),
      eformsign: review("강사회원 가입서 판정", "기존 완료 문서 및 동의 확인 대기"),
      memo: review("가입서 완료 메모", "가입서 확인 후 별도 처리"),
      confirmation: review("예약확정 안내", "일정·주제 검증 전 자동 발송 차단"),
    },
  };
}

export function teamScheduleMetadata(rows: Record<string, any>[]): Record<string, string> {
  if (!rows.some(row => row.courseKind === "team")) return {};
  if (rows.some(row => row.courseKind !== "team")) return { courseKind: "team", metadataSource: "conflict" };
  const variants = new Set(rows.map(row => JSON.stringify([row.lessonTime, row.lessonTopic])));
  const first = rows[0];
  if (variants.size !== 1 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(first.lessonTime || "")
    || typeof first.lessonTopic !== "string" || !first.lessonTopic.trim()) {
    return { courseKind: "team", metadataSource: "conflict" };
  }
  return { courseKind: "team", lessonTime: first.lessonTime, lessonTopic: first.lessonTopic,
    metadataSource: "registration" };
}
