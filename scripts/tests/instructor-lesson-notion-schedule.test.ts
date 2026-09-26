import assert from "node:assert/strict";
import test from "node:test";
import { parseNotionLessonSchedule, resolveNotionLessonSchedule } from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonNotionSchedule";
import { renderInstructorLessonCalendar, instructorLessonCalendarApiHandler } from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonCalendar";

const rich = (value: string) => [{ plain_text: value }];
const block = (type: string, value: string) => ({ type, [type]: { rich_text: rich(value) } });
function fixture() {
  return {
    page: { id: "3c5d49ea-e4bf-801f-8b82-c9106ee4ce11", parent: { page_id: "198d49ea-e4bf-8001-895b-f0378d58c641" }, properties: { title: { type: "title", title: rich("10월 아카이브 강사레슨") } } },
    blocks: [block("heading_2", "2026년 10월 강사 레슨 일정 안내"), block("heading_3", "ARCHIVE METHOD\n#9 외부 피드백2\n10/24(토), 25(일) 13:00 ~ 15:10"), block("paragraph", "모집 정원 : 총 20명 (하루 10명)"),
      { type: "table", children: [
        { type: "table_row", table_row: { cells: [rich("A팀"), rich("민진쌤 바렐+스틱\n→ 은영쌤 리포머+블럭")] } },
        { type: "table_row", table_row: { cells: [rich("B팀"), rich("은영쌤 리포머+블럭\n→ 민진쌤 바렐+스틱")] } },
      ] }, block("divider", ""), block("paragraph", "ex) 9월 19일 김00 예약합니다 / 9월 20일 김00 예약합니다")],
  };
}

test("공식 일정만 추출하고 예시의 이전 날짜를 무시한다", () => {
  const { page, blocks } = fixture();
  const rows = parseNotionLessonSchedule(page, blocks);
  assert.deepEqual(rows.map((r) => r.lessonDate), ["2026-10-24", "2026-10-25"]);
  assert.equal(rows[0].lessonComposition, "민진쌤 바렐+스틱\n은영쌤 리포머+블럭");
  assert.equal(rows[0].icsStart, "20261024T040000Z");
  assert.equal(rows[0].icsEnd, "20261024T061000Z");
  assert.equal(rows[0].capacity, 10);
  assert.equal(rows[0].managementNumber, "notion-261024");
});

test("요일·연도·시간·팀 구성 오류와 모호한 공식 제목은 발송 설정으로 사용하지 않는다", () => {
  for (const transform of [
    (b: any[]) => { b[1] = block("heading_3", "ARCHIVE METHOD\n#9 외부 피드백2\n10/24(일), 25(일) 13:00 ~ 15:10"); },
    (b: any[]) => { b[0] = block("heading_2", "2027년 10월 강사 레슨 일정 안내"); },
    (b: any[]) => { b[1] = block("heading_3", "ARCHIVE METHOD\n#9 외부 피드백2\n10/24(토) 15:00 ~ 13:10"); },
    (b: any[]) => { b[3].children[1].table_row.cells[1] = rich("다른 수업"); },
    (b: any[]) => { b.push(b[1]); },
    (b: any[]) => { b[2] = block("paragraph", "총 20명"); },
  ]) {
    const { page, blocks } = fixture(); transform(blocks);
    assert.throws(() => parseNotionLessonSchedule(page, blocks));
  }
});

test("페이지 이동·폐기는 거부하고 원본 내용 변경 시 지문이 달라진다", () => {
  const { page, blocks } = fixture();
  assert.throws(() => parseNotionLessonSchedule({ ...page, archived: true }, blocks));
  assert.throws(() => parseNotionLessonSchedule({ ...page, parent: { page_id: "unrelated" } }, blocks));
  const first = parseNotionLessonSchedule(page, blocks)[0];
  blocks[1] = block("heading_3", "ARCHIVE METHOD\n#9 외부 피드백2\n10/24(토), 25(일) 14:00 ~ 16:10");
  const second = parseNotionLessonSchedule(page, blocks)[0];
  assert.notEqual(first.sourceFingerprint, second.sourceFingerprint);
  assert.equal(first.managementNumber, second.managementNumber);
});

test("캘린더 시간·한글 UTF-8 줄접기·HTML escaping을 검증한다", () => {
  const { page, blocks } = fixture();
  const schedule = parseNotionLessonSchedule(page, blocks)[0];
  const ics = renderInstructorLessonCalendar(schedule, "ics");
  assert.match(ics, /DTSTART:20261024T040000Z\r\n/);
  assert.match(ics, /DTEND:20261024T061000Z\r\n/);
  assert.ok(ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75));
  const html = renderInstructorLessonCalendar({ ...schedule, title: "<script>alert(1)</script>" }, "html");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes(schedule.icsUrl));
});

test("캘린더는 잘못된 경로와 쓰기 요청을 노션 조회 전에 거부한다", async () => {
  for (const [method, path, expected] of [["POST", "/method/notion-261024/calendar/", 405], ["GET", "/method/notion-261024/calendar/archive-method-261025.ics", 404]]) {
    let status = 0;
    const response: any = { set() { return this; }, status(value: number) { status = value; return this; }, send() { return this; } };
    await instructorLessonCalendarApiHandler({ method, path } as any, response);
    assert.equal(status, expected);
  }
});

test("해당 월의 공식 노션 페이지를 찾아 일정과 캘린더를 연결한다", async () => {
  const { page, blocks } = fixture();
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.NOTION_TOKEN;
  process.env.NOTION_TOKEN = "test-only-token";
  let requests = 0;
  globalThis.fetch = (async (url: any) => {
    requests++;
    const path = String(url);
    let payload: any;
    if (path.includes("blocks/198d49")) payload = { results: [{ id: page.id, type: "child_page", child_page: { title: "10월 아카이브 강사레슨" } }], has_more: false };
    else if (path.includes("/pages/")) payload = page;
    else if (path.includes("blocks/table-id/")) payload = { results: (blocks[3] as any).children, has_more: false };
    else payload = { results: blocks.map((b) => b.type === "table" ? { id: "table-id", type: "table", has_children: true } : b), has_more: false };
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
  try {
    const schedule = await resolveNotionLessonSchedule("2026-10-24");
    assert.equal(schedule.lessonDateText, "2026년 10월 24일(토)");
    assert.equal(requests, 4);
    assert.equal((await resolveNotionLessonSchedule("2026-10-25")).lessonDate, "2026-10-25");
    assert.equal(requests, 5);
    await assert.rejects(resolveNotionLessonSchedule("2026-10-26"), /공식 일정이 없습니다/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.NOTION_TOKEN; else process.env.NOTION_TOKEN = originalToken;
  }
});
