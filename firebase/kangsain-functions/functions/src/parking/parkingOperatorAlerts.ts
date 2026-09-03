import { sendOperationsEmail } from "../google/driveDocsMailer";

const CORE_PARKING_URL = "https://in.archivepilates.com/core/#parkingTools";
const PARKING_REPORT_LABEL = "주차등록 보고";

export type ParkingNoEntryAlertInput = {
  jobId: string;
  lessonDate?: string;
  lectureStartAt?: unknown;
  memberName?: string;
  staffName?: string;
  ownerName?: string;
  visitorName?: string;
  carNumberLast4?: string;
  requestedDiscountHours?: number | string;
};

export function buildParkingNoEntryAlertEmail(input: ParkingNoEntryAlertInput): {
  subject: string;
  body: string;
} {
  const lessonDate = String(input.lessonDate || "날짜 확인필요");
  const lessonDateTime = formatLessonDateTime(lessonDate, input.lectureStartAt);
  const ownerName = String(
    input.memberName || input.staffName || input.ownerName || input.visitorName || "대상 확인필요",
  );
  const carNumberLast4 = String(input.carNumberLast4 || "");
  const maskedCarNumber = /^\d{4}$/.test(carNumberLast4) ? `****${carNumberLast4}` : "확인필요";
  const discountHours = Number(input.requestedDiscountHours || 0);
  const requestedDiscount = Number.isFinite(discountHours) && discountHours > 0 ? `${discountHours}시간` : "확인필요";

  return {
    subject: `[주차등록][확인필요] 입차기록 없음 · ${lessonDate}`,
    body: [
      "주체: ARCHIVE IN / 주차등록 자동화",
      "",
      "결론: 수업 시작 30분 후 입차 기록을 찾지 못해 주차 할인을 적용하지 않았습니다.",
      "",
      "핵심",
      `- 수업일시: ${lessonDateTime}`,
      `- 대상: ${ownerName}`,
      `- 차량: ${maskedCarNumber}`,
      `- 요청 할인: ${requestedDiscount}`,
      "",
      "검증",
      "- iParking 입차 조회: 1회",
      "- 작업 상태: manual_review / no_entry",
      `- 작업 ID: ${input.jobId}`,
      "",
      "주의",
      "- 자동 재조회는 실행하지 않습니다.",
      "",
      "다음",
      "- CORE 주차등록에서 입차 여부를 확인하고 필요하면 수동 처리해 주세요.",
      CORE_PARKING_URL,
    ].join("\n"),
  };
}

export async function sendParkingNoEntryAlert(input: ParkingNoEntryAlertInput): Promise<void> {
  const email = buildParkingNoEntryAlertEmail(input);
  await sendOperationsEmail({
    ...email,
    status: "attention",
    domainLabel: PARKING_REPORT_LABEL,
  });
}

function formatLessonDateTime(lessonDate: string, value: unknown): string {
  const date = timestampDate(value);
  if (!date) return lessonDate;
  const time = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace("24:", "00:");
  return `${lessonDate} ${time}`;
}

function timestampDate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}
