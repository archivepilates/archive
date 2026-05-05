import { Timestamp } from "firebase-admin/firestore";
import { TIMEZONE } from "../config/constants";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function todayKst(): string {
  return formatDateKst(new Date());
}

export function formatDateKst(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00.000+09:00`);
  base.setDate(base.getDate() + days);
  return formatDateKst(base);
}

export function dateRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let current = startDate;
  while (current <= endDate) {
    out.push(current);
    current = addDays(current, 1);
  }
  return out;
}

export function parseStudioMateDateTime(value: string | null | undefined): Timestamp | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(`${normalized}${/[zZ]|[+-]\d\d:?\d\d$/.test(normalized) ? "" : "+09:00"}`);
  if (Number.isNaN(date.getTime())) return null;
  return Timestamp.fromDate(date);
}

export function nowTimestamp(): Timestamp {
  return Timestamp.now();
}

export { TIMEZONE };
