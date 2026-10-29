import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEAM_EVENT = Object.freeze({
  title: "ARCHIVE PILATES Team 강사레슨 · ARCHIVE METHOD #9 외부 피드백2",
  date: "2026-11-21",
  dateText: "2026년 11월 21일(토)",
  timeText: "13:30~15:20",
  location: "ARCHIVE PILATES 명지",
  url: "https://in.archivepilates.com/method/team-261121/calendar/",
  icsName: "archive-method-261121.ics",
  uid: "team-261121@archivepilates.com",
  start: "20261121T043000Z",
  end: "20261121T062000Z",
  composition: "은영쌤 리포머 + 블럭\n민진쌤 바렐 + 스틱",
  sessions: Object.freeze([
    Object.freeze({ lectureId: "98585018", start: "13:30", end: "14:20", room: "리포머",
      teacher: "은영쌤", equipment: "리포머 + 블럭",
      description: "ARCHIVE METHOD #9 외부 피드백2 · 팀 단독 강사레슨 · 은영쌤 리포머+블럭" }),
    Object.freeze({ lectureId: "98585168", start: "14:30", end: "15:20", room: "바렐",
      teacher: "민진쌤", equipment: "바렐 + 스틱",
      description: "ARCHIVE METHOD #9 외부 피드백2 · 팀 단독 강사레슨 · 민진쌤 바렐+스틱" }),
  ]),
});

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const TEAM_CALENDAR_DIR = path.join(ROOT, "archivein/method/team-261121/calendar");
const htmlEscape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const icsEscape = value => String(value).replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/[,;]/g, "\\$&");

// Match the existing calendar renderer: 75 octets includes the continuation space.
export function foldIcsLine(line) {
  let output = "", width = 0;
  for (const character of line) {
    const bytes = Buffer.byteLength(character, "utf8");
    if (width + bytes > 75) { output += "\r\n "; width = 1; }
    output += character;
    width += bytes;
  }
  return output;
}

export function renderTeamCalendarIcs(stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")) {
  if (!/^\d{8}T\d{6}Z$/.test(stamp)) throw new Error("Invalid UTC calendar stamp.");
  const e = TEAM_EVENT;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ARCHIVE PILATES//Team Instructor Lesson//KO",
    "CALSCALE:GREGORIAN", "BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp}`,
    `DTSTART:${e.start}`, `DTEND:${e.end}`, `SUMMARY:${icsEscape(e.title)}`,
    `LOCATION:${icsEscape(e.location)}`, `DESCRIPTION:${icsEscape(e.composition)}`,
    `URL:${e.url}`, "END:VEVENT", "END:VCALENDAR"];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

export function renderTeamCalendarHtml() {
  const e = TEAM_EVENT;
  const googleUrl = new URL("https://calendar.google.com/calendar/render");
  googleUrl.search = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${e.start}/${e.end}`,
    details: e.composition, location: e.location, ctz: "Asia/Seoul" }).toString();
  const cells = Array.from({ length: 35 }, (_, i) => {
    const day = i + 1;
    if (day > 30) return '<td class="empty" aria-hidden="true"></td>';
    return day === 21 ? `<td class="event-day"><time datetime="${e.date}" aria-label="11월 21일 토요일 Team 강사레슨">21</time><span>Team</span></td>` : `<td>${day}</td>`;
  });
  const weeks = Array.from({ length: 5 }, (_, i) => `<tr>${cells.slice(i * 7, i * 7 + 7).join("")}</tr>`).join("\n");
  const sessions = e.sessions.map(s => `<li data-lecture-id="${s.lectureId}"><p class="session-time"><time>${s.start}</time><span>~</span><time>${s.end}</time></p><div><h3>${s.teacher}</h3><p>${s.equipment}</p><p class="room">${s.room} 룸</p></div></li>`).join("\n");
  return `<!doctype html>
<html lang="ko" data-event-date="${e.date}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#ffffff">
<meta name="description" content="${htmlEscape(`${e.dateText} ${e.timeText} · ${e.title}`)}">
<title>${htmlEscape(e.title)}</title>
<link rel="canonical" href="${e.url}">
<link rel="icon" href="/logo120.png">
<style>
:root{color-scheme:light;--ink:#222725;--muted:#59635e;--line:#dfe5e1;--red:#b91920;--green:#27634d}
*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",system-ui,sans-serif;letter-spacing:0;word-break:keep-all;overflow-wrap:anywhere}
main{width:min(100%,64rem);margin:auto;padding:2rem 1rem 3rem}img{max-width:100%}.brand{display:flex;align-items:center;gap:.75rem;margin-bottom:1.5rem}.brand img{width:44px;height:44px;object-fit:contain;flex-shrink:0}.brand p{margin:0;font-size:14px;font-weight:750}
header{padding-bottom:1.5rem;border-bottom:1px solid var(--line)}h1{font-size:24px;line-height:1.4;margin:0 0 .5rem}h1 span{display:block}h1 .course{font-size:18px;margin-top:.35rem;font-weight:650}h2{font-size:18px;margin:0 0 1rem}h3{font-size:16px;margin:0}p{margin:0}.date{color:var(--green);font-weight:700}.layout{display:grid;gap:2rem;padding:1.75rem 0}.layout>*{min-width:0}
table{border-collapse:collapse;table-layout:fixed;width:100%;text-align:center}caption{text-align:left;font-weight:750;font-size:18px;margin-bottom:1rem}th{color:var(--muted);font-size:12px;padding:.5rem 0;border-bottom:1px solid var(--line)}td{height:54px;font-size:14px;vertical-align:middle;border-bottom:1px solid var(--line)}th:first-child,td:first-child{color:var(--red)}td.event-day{background:#edf5f0;color:var(--green);font-weight:800}td.event-day time{display:block}td.event-day span{display:block;font-size:11px;line-height:1.2}td.empty{border-bottom-color:transparent}
.schedule{border-top:1px solid var(--line);padding-top:1.5rem}.sessions{padding:0;margin:0;list-style:none}.sessions li{display:grid;grid-template-columns:6.5rem minmax(0,1fr);gap:1rem;padding:1rem 0;border-top:1px solid var(--line)}.sessions li:first-child{padding-top:0;border-top:0}.session-time{display:flex;flex-wrap:wrap;align-content:start;column-gap:.25rem;color:var(--muted);font-size:14px;font-variant-numeric:tabular-nums}.room{font-size:13px;color:var(--muted);margin-top:.25rem}.venue{padding-top:1rem;border-top:1px solid var(--line)}.venue span{display:block;color:var(--muted);font-size:13px;margin-bottom:.25rem}
.save{border-top:1px solid var(--line);padding-top:1.5rem}.actions{display:grid;gap:.75rem}a.button{display:flex;align-items:center;justify-content:center;gap:.6rem;min-width:0;min-height:48px;padding:.75rem 1rem;border:1px solid var(--line);border-radius:6px;color:var(--ink);text-decoration:none;font-weight:700;font-size:14px;text-align:center}a.primary{background:var(--red);border-color:var(--red);color:#fff}a.button:hover{border-color:var(--ink)}a.primary:hover{background:#99151b}a:focus-visible{outline:3px solid var(--green);outline-offset:4px}.icon{font-size:19px;line-height:1;flex-shrink:0}footer{color:var(--muted);font-size:12px;padding-top:1.5rem}
@media(min-width:700px){main{padding:2.5rem 2rem 3rem}.layout{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:3rem}.schedule{border-top:0;padding-top:0}td{height:56px}.actions{grid-template-columns:1fr 1fr}}
</style>
</head>
<body><main>
<div class="brand"><img src="/logo120.png" width="44" height="44" alt="ARCHIVE PILATES 심볼"><p>ARCHIVE PILATES</p></div>
<header><h1>ARCHIVE PILATES Team 강사레슨<span class="course">ARCHIVE METHOD #9 외부 피드백2</span></h1><p class="date">${e.dateText} · ${e.timeText}</p></header>
<div class="layout">
<section aria-label="2026년 11월 캘린더"><table><caption>2026년 11월</caption><thead><tr>${["일", "월", "화", "수", "목", "금", "토"].map(day => `<th scope="col">${day}</th>`).join("")}</tr></thead><tbody>${weeks}</tbody></table></section>
<section class="schedule" aria-labelledby="sessions-title"><h2 id="sessions-title">수업 일정</h2><ol class="sessions">${sessions}</ol><p class="venue"><span>장소</span>${e.location}</p></section>
</div>
<section class="save" aria-labelledby="save-title"><h2 id="save-title">캘린더에 추가</h2><div class="actions"><a class="button primary" href="./${e.icsName}" download="${e.icsName}"><span class="icon" aria-hidden="true">↓</span>일정 파일 다운로드</a><a class="button" href="${htmlEscape(googleUrl.href)}" target="_blank" rel="noopener noreferrer"><span class="icon" aria-hidden="true">+</span>Google 캘린더에 추가</a></div></section>
<footer>ARCHIVE PILATES · Team 강사레슨</footer>
</main></body>
</html>
`;
}

export async function buildTeamCalendar({ check = false } = {}) {
  const htmlPath = path.join(TEAM_CALENDAR_DIR, "index.html");
  const icsPath = path.join(TEAM_CALENDAR_DIR, TEAM_EVENT.icsName);
  const html = renderTeamCalendarHtml();
  if (check) {
    const saved = await readFile(icsPath, "utf8");
    const stamp = saved.match(/^DTSTAMP:(\d{8}T\d{6}Z)\r$/m)?.[1];
    if (!stamp || await readFile(htmlPath, "utf8") !== html || saved !== renderTeamCalendarIcs(stamp)) throw new Error("Team calendar artifacts differ from the approved static schedule.");
  } else {
    await mkdir(TEAM_CALENDAR_DIR, { recursive: true });
    await writeFile(htmlPath, html, "utf8");
    await writeFile(icsPath, renderTeamCalendarIcs(), "utf8");
  }
  return { check, files: [htmlPath, icsPath] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check") || process.argv.length > 3) throw new Error("Only --check is supported.");
  console.log(JSON.stringify(await buildTeamCalendar({ check: process.argv.includes("--check") })));
}
