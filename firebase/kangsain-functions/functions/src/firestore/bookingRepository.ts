import type { BookingDoc } from "../types/models";
import { refs } from "./refs";

export async function upsertBookingIfChanged(booking: BookingDoc): Promise<boolean> {
  const ref = refs.booking(booking.bookingId);
  const current = await ref.get();
  if (current.exists && current.data()?.sourceHash === booking.sourceHash && current.data()?.syncStatus !== "pending")
    return false;
  await ref.set(booking, { merge: true });
  return true;
}

export async function getBooking(bookingId: string): Promise<BookingDoc | null> {
  const snap = await refs.booking(bookingId).get();
  return snap.exists ? (snap.data() ?? null) : null;
}

export async function getBookingsByLecture(studioId: string, lectureId: string): Promise<BookingDoc[]> {
  const snap = await refs.bookings().where("studioId", "==", studioId).where("lectureId", "==", lectureId).get();
  return snap.docs.map((doc) => doc.data());
}

export async function getBookingsByStaffDate(studioId: string, staffId: string, date: string): Promise<BookingDoc[]> {
  const snap = await refs
    .bookings()
    .where("studioId", "==", studioId)
    .where("staffId", "==", staffId)
    .where("lectureDate", "==", date)
    .get();
  return snap.docs.map((doc) => doc.data());
}

export async function getRecentMemberBookings(
  studioId: string,
  memberIds: string[],
  startDate: string,
  endDate: string,
): Promise<BookingDoc[]> {
  if (!memberIds.length) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < memberIds.length; i += 10) chunks.push(memberIds.slice(i, i + 10));
  const results = await Promise.all(
    chunks.map((chunk) =>
      refs
        .bookings()
        .where("studioId", "==", studioId)
        .where("memberId", "in", chunk)
        .where("lectureDate", ">=", startDate)
        .where("lectureDate", "<=", endDate)
        .get(),
    ),
  );
  return results.flatMap((snap) => snap.docs.map((doc) => doc.data()));
}

export async function staffHasHandledMember(studioId: string, staffId: string, memberId: string): Promise<boolean> {
  const snap = await refs
    .bookings()
    .where("studioId", "==", studioId)
    .where("staffId", "==", staffId)
    .where("memberId", "==", memberId)
    .limit(1)
    .get();
  return !snap.empty;
}

export async function searchBookingsByMemberPhone(
  studioId: string,
  phone: string,
  startDate: string,
): Promise<BookingDoc[]> {
  const snap = await refs
    .bookings()
    .where("studioId", "==", studioId)
    .where("memberPhone", "==", phone)
    .where("lectureDate", ">=", startDate)
    .orderBy("lectureDate", "desc")
    .limit(25)
    .get();
  return snap.docs.map((doc) => doc.data());
}

export async function searchBookingsByMemberName(
  studioId: string,
  query: string,
  startDate: string,
): Promise<BookingDoc[]> {
  const snap = await refs
    .bookings()
    .where("studioId", "==", studioId)
    .where("memberName", ">=", query)
    .where("memberName", "<", `${query}\uf8ff`)
    .orderBy("memberName", "asc")
    .orderBy("lectureDate", "desc")
    .limit(50)
    .get();
  return snap.docs.map((doc) => doc.data()).filter((booking) => booking.lectureDate >= startDate);
}
