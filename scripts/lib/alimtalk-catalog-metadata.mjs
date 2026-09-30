// Editorial purpose/ownership, not an eligibility implementation. Targets and schedules
// are projected from backend policy constants by generate-alimtalk-catalog.mjs.
export const purposes = {
  membership_welcome: "가입 완료·이용 안내",
  reservation_open: "주간 예약 오픈 안내",
  new_member: "이전 신규회원 안내",
  onsite_welcome: "이전 현장 가입서·이용 안내",
  ticket_expiring: "그룹권 잔여기간 사실 안내",
  remaining_low: "그룹권 잔여횟수 사실 안내",
  private_count_low: "프라이빗권 잔여횟수 사실 안내",
  private_ticket_expiring: "프라이빗권 잔여기간 사실 안내",
  long_absence: "유효회원 수업 복귀 지원",
  private_survey: "첫 프라이빗 수업 사전설문",
  group_survey: "첫 그룹수업 사전확인",
  staff_private_survey: "담당강사에게 프라이빗 설문 전달",
  staff_group_survey: "담당강사에게 첫 그룹수업 설문 전달",
  staff_private_chart: "담당강사의 당일 프라이빗 기록 안내",
  instructor_lesson_confirmation: "강사레슨 수강 등록 확정",
  instructor_lesson_material: "강사레슨 자료·배정·방문 안내",
  private_lesson_report: "회원용 프라이빗 수업 리포트 전달",
  inbody_report: "회원용 인바디 리포트 전달",
  pricing_info: "요청한 수강료 안내 전달",
  recommended_meal_survey: "추천식단 설문·리포트 링크 전달",
  recommended_meal_report: "승인된 추천식단 리포트 전달",
};

export const supplemental = {
  KA01TP2607050825481844FfRze7o9Pw: { state: "unconnected", purpose: "예약 수업의 강사 변경 공지", target: "중앙 정책 미연결 · 자동 발송 대상 정의 없음", timing: "중앙 발송 경로 미연결" },
  KA01TP2607050825471794qyKK2E0URD: { state: "unconnected", purpose: "예약 수업의 일정 변경 공지", target: "중앙 정책 미연결 · 자동 발송 대상 정의 없음", timing: "중앙 발송 경로 미연결" },
  KA01TP260606215619915xrfx4W0JsZf: { state: "separate_project", purpose: "면접 일정 선택 안내", target: "ARCHIVE APPLY 지원자 · 별도 프로젝트 대상 정책 미조회", timing: "별도 프로젝트 운영·배포 상태 미조회" },
  KA01TP260521072937354Ve2n5cEapDL: { state: "archived", purpose: "이전 그룹 사전확인 제출 전달", target: "현재 중앙 템플릿 매핑 없음", timing: "현재 발송 시기 정의 없음" },
  KA01TP260519093416836f1EHZYJ00uM: { state: "archived", purpose: "이전 프라이빗 설문 제출 전달", target: "현재 v2와 분리된 구버전", timing: "현재 발송 시기 정의 없음" },
};

export const timingBasisLabels = {
  today: "기준일 당일 후보",
  same_or_before_today: "기준일 이전·당일의 업무 완료 조건",
  recent_new_member: "등록일 기준 기간 조건",
  manual: "운영자 단건 요청·검토",
};
