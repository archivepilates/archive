import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const methodRoot = join(root, "archivein", "method");
const expectedAddress = "부산광역시 강서구 명지국제2로28번길 34 에코팰리스 704호";
const expectedLocation = `ARCHIVE PILATES 명지, ${expectedAddress}`;
const failures = [];
let validated = 0;

function fail(file, message) {
  failures.push(`${file}: ${message}`);
}

for (const entry of readdirSync(methodRoot)) {
  const slugPath = join(methodRoot, entry);
  if (!statSync(slugPath).isDirectory()) continue;

  const match = entry.match(/-(\d{6})$/);
  const calendarPath = join(slugPath, "calendar");
  if (!match || !statSafe(calendarPath)) continue;

  const dateToken = match[1];
  const year = `20${dateToken.slice(0, 2)}`;
  const month = dateToken.slice(2, 4);
  const day = dateToken.slice(4, 6);
  const isoDate = `${year}-${month}-${day}`;
  const htmlPath = join(calendarPath, "index.html");
  const icsName = `archive-method-${dateToken}.ics`;
  const icsPath = join(calendarPath, icsName);

  if (!statSafe(htmlPath)) {
    fail(relative(htmlPath), "index.html is missing");
    continue;
  }
  if (!statSafe(icsPath)) {
    fail(relative(icsPath), "calendar file is missing");
    continue;
  }

  const html = readFileSync(htmlPath, "utf8");
  const icsBuffer = readFileSync(icsPath);
  const ics = icsBuffer.toString("utf8");
  const htmlFile = relative(htmlPath);
  const icsFile = relative(icsPath);

  if (!html.includes(`data-event-date="${isoDate}"`)) {
    fail(htmlFile, `data-event-date must be ${isoDate}`);
  }
  if (!html.includes(`href="./${icsName}"`)) {
    fail(htmlFile, `ICS link must point to ./${icsName}`);
  }
  if (!html.includes(`dates=${year}${month}${day}T040000Z%2F${year}${month}${day}T061000Z`)) {
    fail(htmlFile, "Google Calendar dates must match 13:00-15:10 KST");
  }
  if (!html.includes("https://archivepilates.notion.site/lessons9")) {
    fail(htmlFile, "September detail link is missing");
  }
  if (!html.includes(expectedAddress)) {
    fail(htmlFile, "ARCHIVE PILATES address is missing or stale");
  }
  if (!html.includes("../../assets/method-calendar.css")) {
    fail(htmlFile, "shared calendar stylesheet is missing");
  }

  const googleHref = html.match(/href="(https:\/\/calendar\.google\.com\/calendar\/render\?[^\"]+)"/)?.[1];
  if (!googleHref) {
    fail(htmlFile, "Google Calendar link is missing");
  } else {
    const googleUrl = new URL(googleHref.replaceAll("&amp;", "&"));
    if (googleUrl.searchParams.get("location") !== expectedLocation) {
      fail(htmlFile, "Google Calendar location is missing or stale");
    }
  }

  for (const marker of [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    `UID:archive-method-8-external-feedback-${dateToken}@archivepilates.com`,
    `DTSTART:${year}${month}${day}T040000Z`,
    `DTEND:${year}${month}${day}T061000Z`,
    "SUMMARY:ARCHIVE METHOD #8 외부 피드백",
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ]) {
    if (!ics.includes(marker)) fail(icsFile, `missing ${marker}`);
  }

  const unfoldedIcs = ics.replace(/\r\n[ \t]/g, "");
  const expectedIcsLocation = expectedLocation.replaceAll("\\", "\\\\").replaceAll(",", "\\,").replaceAll(";", "\\;");
  if (!unfoldedIcs.includes(`LOCATION:${expectedIcsLocation}`)) {
    fail(icsFile, "calendar location is missing or stale");
  }

  if (icsBuffer.includes(Buffer.from("\n")) && /(^|[^\r])\n/.test(ics)) {
    fail(icsFile, "ICS lines must use CRLF");
  }
  for (const [index, line] of ics.split("\r\n").entries()) {
    if (Buffer.byteLength(line, "utf8") > 75) {
      fail(icsFile, `line ${index + 1} exceeds 75 octets`);
    }
  }

  validated += 1;
}

if (!validated) failures.push("No ARCHIVE METHOD calendar routes found");

if (failures.length) {
  console.error(`ARCHIVE METHOD calendar validation failed (${failures.length})`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log(`ARCHIVE METHOD calendar validation passed (${validated} routes)`);

function statSafe(path) {
  try {
    return statSync(path).isFile() || statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function relative(path) {
  return path.slice(root.length + 1);
}
