const KST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function isPrivateBooking(booking) {
  if (String(booking?.lessonType || "") === "group") return false;
  if (["private", "semi_private"].includes(String(booking?.lessonType || ""))) return true;
  const text = [
    booking?.ticketName,
    booking?.ticketClassType,
    booking?.ticketType,
    booking?.title,
    booking?.lectureTitle,
  ].join(" ");
  return /프라이빗|개인|1:1|PRIVATE|\bP\b/i.test(text);
}

export function inactivePrivateBookingReason(booking, options = {}) {
  if (!booking) return "missing_booking";
  if (booking.archiveBooking?.isCanonical === false) {
    return String(booking.sessionOrder?.excludedReason || "duplicate_source");
  }
  const excludedReason = String(booking.sessionOrder?.excludedReason || "");
  if (booking.sessionOrder?.counted === false && /duplicate|missing|stale|cancel|superseded/i.test(excludedReason)) {
    return excludedReason || "session_order_excluded";
  }
  const appStatus = String(booking.appStatus || "");
  if (appStatus && appStatus !== "reserved") return `booking_app_status_${appStatus}`;
  const status = String(booking.status || "");
  if (["cancelled", "canceled", "superseded"].includes(status)) return `booking_status_${status}`;
  const attendanceStatus = String(booking.attendanceStatus || "");
  if (["absent", "late_cancel"].includes(attendanceStatus)) return `attendance_status_${attendanceStatus}`;
  if (isPastUncheckedBooking(booking, options)) return "past_unchecked_attendance";
  const sourceStatus = String(booking.sourceStatus || "");
  if (/missing_from_latest_reservation_import|stale|lecture_deleted|deleted|cancel/i.test(sourceStatus)) {
    return sourceStatus;
  }
  if (!isPrivateBooking(booking)) return "not_private_booking";
  return "";
}

export function isExcludedPrivateBooking(booking, options = {}) {
  return !isCountablePrivateBooking(booking, options);
}

export function isCountablePrivateBooking(booking, options = {}) {
  const bookingId = String(booking?.bookingId || booking?.id || "");
  if (bookingId.startsWith("usage_booking_")) return false;
  return !inactivePrivateBookingReason(booking, options);
}

export function isPastUncheckedBooking(booking, options = {}) {
  if (String(booking?.attendanceStatus || "unchecked") === "attended") return false;
  const lectureDate = String(booking?.lectureDate || dateFromTimestampLike(booking?.lectureStartAt) || "");
  const today = String(options.todayKst || KST_DATE_FORMATTER.format(options.now || new Date()));
  return Boolean(lectureDate && lectureDate < today);
}

function dateFromTimestampLike(value) {
  const millis = timestampMillisFromValue(value);
  return millis ? KST_DATE_FORMATTER.format(new Date(millis)) : "";
}

function timestampMillisFromValue(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value === "number") return value;
  if (typeof value === "object" && Number.isFinite(Number(value._seconds))) {
    return Number(value._seconds) * 1000 + Math.floor(Number(value._nanoseconds || 0) / 1e6);
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}
