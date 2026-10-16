import type { BookingDoc } from "../types/models";

export function isInstructorLessonBooking(booking: BookingDoc): boolean {
  if (/강사레슨/i.test(booking.ticketName || "")) return true;
  return [booking.ticketClassType, booking.ticketType].some((value) =>
    /^(I|INSTRUCTOR)$/i.test(String(value || "").trim()) || /강사레슨/i.test(String(value || "")),
  );
}
