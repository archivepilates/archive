import path from "node:path";

const KST_TIME_ZONE = "Asia/Seoul";

export function expectedMonthlySettlementMonth(now = new Date()) {
  const parts = kstParts(now);
  const beforeMonthlyRunGrace = parts.day === 1 && parts.hour * 60 + parts.minute < 11 * 60;
  const monthsBack = beforeMonthlyRunGrace ? 2 : 1;
  const monthIndex = parts.year * 12 + (parts.month - 1) - monthsBack;
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  return `${year}${String(month).padStart(2, "0")}`;
}

export function monthlySettlementIndexPath(home, now = new Date()) {
  const month = expectedMonthlySettlementMonth(now);
  return path.join(
    home,
    "Library/CloudStorage/GoogleDrive-home@archivepilates.com/내 드라이브/아카이브필라테스/아카이브필라테스/03_재무_대출_정산/아카이브 월말정산",
    month,
    `아카이브 정산명세서 ${month}_INDEX.html`,
  );
}

function kstParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}
