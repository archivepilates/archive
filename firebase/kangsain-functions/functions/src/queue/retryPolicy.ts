import { Timestamp } from "firebase-admin/firestore";

const DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export function nextRetryAt(attempts: number): Timestamp {
  const delay = DELAYS_MS[Math.max(0, Math.min(attempts - 1, DELAYS_MS.length - 1))];
  return Timestamp.fromDate(new Date(Date.now() + delay));
}

