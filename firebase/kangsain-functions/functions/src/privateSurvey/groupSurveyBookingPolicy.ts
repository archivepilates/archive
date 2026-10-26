export const OUTDOOR_GROUP_SURVEY_EXCLUSION_REASON = "야외수업 예약 일반 그룹 설문 제외";

export function isOutdoorGroupSurveyBooking(
  source?: { ticketName?: unknown; ticketClassType?: unknown; ticketType?: unknown } | null,
): boolean {
  return [source?.ticketName, source?.ticketClassType, source?.ticketType].some((value) =>
    typeof value === "string" && /야외|outdoor/i.test(value.normalize("NFKC").replace(/\s+/g, "")),
  );
}
