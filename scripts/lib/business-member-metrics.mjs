import { monthKey } from "../dashboard-export-utils.mjs";

const METRIC_FIELDS = ["수강권보유회원수", "예약이용회원수", "출석회원수"];

export function metricMonths(snapshot, currentMonth, requested = []) {
  const valid = (month) => /^20\d{2}-(0[1-9]|1[0-2])$/.test(month) && month >= "2025-01" && month <= currentMonth;
  if (requested.length) {
    if (requested.some((month) => !valid(month))) throw new Error("Invalid or future metric month");
    return [...new Set(requested)].sort();
  }
  const [year, number] = currentMonth.split("-").map(Number);
  const previousMonth = new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7);
  const existing = new Map((snapshot.월별회원지표 || []).map((row) => [monthKey(row.월), row]));
  return [...new Set([currentMonth, previousMonth, ...(snapshot.summary || []).map((row) => monthKey(row.월 || row.기준월))])]
    .filter(valid)
    .filter((month) => month >= previousMonth || !METRIC_FIELDS.every((field) => Number.isInteger(existing.get(month)?.[field]) && existing.get(month)[field] >= 0))
    .sort();
}

export function ticketMemberCounts(values, months) {
  const [headers, ...rows] = values || [];
  const monthIndex = headers?.indexOf("기준월");
  const countIndex = headers?.indexOf("회원수");
  const listIndex = headers?.indexOf("회원목록");
  if ([monthIndex, countIndex, listIndex].some((index) => index == null || index < 0)) throw new Error("Ticket-member sheet required columns missing");
  const wanted = new Set(months);
  const result = new Map();
  for (const row of rows) {
    const month = monthKey(row[monthIndex]);
    if (!wanted.has(month)) continue;
    if (result.has(month)) throw new Error(`Duplicate ticket-member month: ${month}`);
    const raw = row[countIndex];
    const count = raw === "" || raw == null ? null : Number(raw);
    const members = String(row[listIndex] || "").split(/\s*,\s*/).map((item) => item.trim()).filter(Boolean);
    const phones = members.map((item) => item.match(/01\d[-\d\s)]{7,}/)?.[0]?.replace(/\D/g, "") || "");
    if (!Number.isInteger(count) || count < 0 || phones.some((phone) => !/^01\d{8,9}$/.test(phone)) || new Set(phones).size !== count || members.length !== count) {
      throw new Error(`Ticket-member count/list mismatch: ${month}`);
    }
    result.set(month, count);
  }
  for (const month of months) if (!result.has(month)) throw new Error(`Ticket-member source month missing: ${month}`);
  return result;
}

export function mergeMetricRows(currentRows, rows) {
  const replacements = new Map(rows.map((row) => [row.월, row]));
  const merged = new Map((currentRows || []).map((row) => [monthKey(row.월), row]));
  for (const [month, row] of replacements) merged.set(month, row);
  return [...merged.values()].sort((a, b) => monthKey(a.월).localeCompare(monthKey(b.월)));
}

export function freshMetricRows(currentRows, rows) {
  const existing = new Map((currentRows || []).map((row) => [monthKey(row.월), row]));
  return rows.filter((row) => {
    const previous = Date.parse(existing.get(row.월)?.집계시각 || "");
    const incoming = Date.parse(row.집계시각 || "");
    return !Number.isFinite(previous) || !Number.isFinite(incoming) || previous <= incoming;
  });
}

export async function collectMetricRows({ months, counts, fetchBookings, summarize, now, source }) {
  const rows = [];
  for (const month of months) {
    const bookings = await fetchBookings(month);
    // Empty canonical queries may indicate an import gap, not a genuine zero-member month.
    if (!bookings.length) throw new Error(`Booking source empty; metrics not overwritten: ${month}`);
    rows.push({
      ...summarize(month, bookings, counts.get(month)),
      집계시각: now,
      집계상태: "complete",
      수강권원천: source,
      수강권산출기준: "정산 시트 월별 유효회원 수와 전화번호 고유회원 목록 일치 검증",
    });
  }
  return rows;
}
