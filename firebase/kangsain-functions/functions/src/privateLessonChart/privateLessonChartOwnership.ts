export function matchesPrivateChartRecord(request: Record<string, any>, requestId: string, record: Record<string, any>): boolean {
  return Boolean(request.requestId === requestId && record.recordId === requestId && record.requestId === requestId &&
    ["staffId", "studioId", "memberId", "bookingId", "lessonDate"].every(field =>
      typeof request[field] === "string" && request[field].trim() && record[field] === request[field]));
}

export function matchesPrivateChartBooking(request: Record<string, any>, requestId: string, booking: Record<string, any>, bookingId: string): boolean {
  return Boolean(request.requestId === requestId && request.bookingId === bookingId && booking.bookingId === bookingId &&
    typeof request.lessonDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(request.lessonDate) &&
    booking.archiveBooking?.isCanonical !== false && booking.sessionOrder?.counted !== false && !booking.supersededByBookingId &&
    !["cancelled", "canceled", "deleted"].includes(String(booking.appStatus || "")) &&
    !/missing_from_latest_reservation_import|stale|lecture_deleted|deleted|cancel|취소|삭제/i.test(String(booking.sourceStatus || "")) &&
    !["cancelled", "canceled", "deleted"].includes(String(request.status || "")) &&
    isPrivateChartLesson(booking) && request.lessonDate === booking.lectureDate &&
    ["staffId", "studioId", "memberId"].every(field =>
      typeof request[field] === "string" && request[field].trim() && request[field] === booking[field]));
}

export function isPrivateChartLesson(booking: Record<string, any>): boolean {
  if (booking.lessonType === "group") return false;
  if (booking.lessonType === "private" || booking.lessonType === "semi_private") return true;
  const text = `${booking.ticketName || ""} ${booking.ticketClassType || ""} ${booking.ticketType || ""} ${booking.title || ""} ${booking.lectureTitle || ""}`;
  return /프라이빗|개인|1:1|PRIVATE|\bP\b/i.test(text);
}
