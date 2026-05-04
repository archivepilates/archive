import type { BookingDoc } from "../types/models";
import { refs } from "./refs";

export async function upsertBookingIfChanged(booking: BookingDoc): Promise<boolean> {
  const ref = refs.booking(booking.bookingId);
  const current = await ref.get();
  if (current.exists && current.data()?.sourceHash === booking.sourceHash && current.data()?.syncStatus !== "pending") return false;
  await ref.set(booking, { merge: true });
  return true;
}

export async function getBooking(bookingId: string): Promise<BookingDoc | null> {
  const snap = await refs.booking(bookingId).get();
  return snap.exists ? snap.data() ?? null : null;
}

export async function getBookingsByLecture(studioId: string, lectureId: string): Promise<BookingDoc[]> {
  const snap = await refs.bookings()
    .where("studioId", "==", studioId)
    .where("lectureId", "==", lectureId)
    .get();
  return snap.docs.map((doc) => doc.data());
}

export async function getBookingsByStaffDate(studioId: string, staffId: string, date: string): Promise<BookingDoc[]> {
  const snap = await refs.bookings()
    .where("studioId", "==", studioId)
    .where("staffId", "==", staffId)
    .where("lectureDate", "==", date)
    .get();
  return snap.docs.map((doc) => doc.data());
}

export async function getRecentMemberBookings(studioId: string, memberIds: string[], startDate: string, endDate: string): Promise<BookingDoc[]> {
  if (!memberIds.length) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < memberIds.length; i += 10) chunks.push(memberIds.slice(i, i + 10));
  const results = await Promise.all(chunks.map((chunk) => refs.bookings()
    .where("studioId", "==", studioId)
    .where("memberId", "in", chunk)
    .where("lectureDate", ">=", startDate)
    .where("lectureDate", "<=", endDate)
    .get()));
  return results.flatMap((snap) => snap.docs.map((doc) => doc.data()));
}

