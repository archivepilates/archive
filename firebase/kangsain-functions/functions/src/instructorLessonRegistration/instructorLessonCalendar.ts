import type { Request, Response } from "express";
import { resolveNotionLessonSchedule, type NotionLessonSchedule } from "./instructorLessonNotionSchedule";

const htmlEscape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const icsEscape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/[,;]/g, "\\$&");

export function renderInstructorLessonCalendar(schedule: NotionLessonSchedule, format: "html" | "ics"): string {
  if (format === "ics") {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ARCHIVE PILATES//Instructor Lessons//KO", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
      `UID:${schedule.managementNumber}@archivepilates.com`, `DTSTAMP:${schedule.icsStart}`, `DTSTART:${schedule.icsStart}`, `DTEND:${schedule.icsEnd}`,
      `SUMMARY:${icsEscape(schedule.title)}`, "LOCATION:ARCHIVE PILATES 명지", `DESCRIPTION:${icsEscape(schedule.lessonComposition)}`, "END:VEVENT", "END:VCALENDAR"];
    // RFC 5545 line folding is byte-based; never split a UTF-8 character.
    return lines.map((line) => {
      let result = "", width = 0;
      for (const char of line) {
        const bytes = Buffer.byteLength(char);
        if (width + bytes > 75) { result += "\r\n "; width = 1; }
        result += char; width += bytes;
      }
      return result;
    }).join("\r\n") + "\r\n";
  }
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>강사레슨 일정 · ARCHIVE PILATES</title><style>*{box-sizing:border-box}body{margin:0;font:16px/1.6 system-ui,sans-serif;color:#202020;background:#fff}main{max-width:40rem;margin:3rem auto;padding:1.5rem}img{width:64px;height:64px;object-fit:contain}h1{font-size:24px;overflow-wrap:anywhere}p{white-space:pre-line}a{display:inline-flex;align-items:center;min-height:48px;padding:10px 20px;background:#b91920;color:white;border-radius:6px;text-decoration:none}a:focus-visible{outline:3px solid #202020;outline-offset:4px}</style><main><img src="/logo120.png" alt="ARCHIVE PILATES"><p>ARCHIVE PILATES</p><h1>${htmlEscape(schedule.title)}</h1><p>${htmlEscape(schedule.lessonDateText)}<br>${htmlEscape(schedule.lessonTimeText)}</p><p>${htmlEscape(schedule.lessonComposition)}</p><p>ARCHIVE PILATES 명지</p><a href="${htmlEscape(schedule.icsUrl)}">캘린더에 추가</a></main></html>`;
}

export async function instructorLessonCalendarApiHandler(request: Request, response: Response): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") { response.set("Allow", "GET, HEAD").status(405).send("Method not allowed"); return; }
  const match = request.path.match(/^\/(?:archivein\/)?method\/notion-(\d{6})\/calendar\/(?:archive-method-(\d{6})\.ics)?$/);
  if (!match || (match[2] && match[2] !== match[1])) { response.status(404).send("일정을 찾을 수 없습니다."); return; }
  try {
    const schedule = await resolveNotionLessonSchedule(`20${match[1].slice(0, 2)}-${match[1].slice(2, 4)}-${match[1].slice(4, 6)}`);
    const format = match[2] ? "ics" : "html";
    response.set("Cache-Control", "public, max-age=60, s-maxage=300");
    response.set("X-Content-Type-Options", "nosniff");
    if (format === "ics") response.set("Content-Disposition", `attachment; filename="archive-method-${match[1]}.ics"`);
    response.type(format === "ics" ? "text/calendar; charset=utf-8" : "html").send(renderInstructorLessonCalendar(schedule, format));
  } catch {
    response.set("Cache-Control", "no-store").status(503).send("수업 일정을 확인하고 있습니다. 잠시 후 다시 열어 주세요.");
  }
}
